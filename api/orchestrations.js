import crypto from 'crypto'

const REDIS_URL   = process.env.KV_REST_API_URL
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN
const KEY      = 'cids:orchestrations'
const CONN_KEY = 'cids:connections'

// ─── Redis helpers ────────────────────────────────────────────────────────────

async function redisGetArr(key) {
  const resp = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['GET', key]]),
  })
  const data = await resp.json()
  const result = data[0]?.result
  if (!result) return []
  try {
    const parsed = JSON.parse(result)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

async function redisGetObj(key) {
  const resp = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['GET', key]]),
  })
  const data = await resp.json()
  const result = data[0]?.result
  if (!result) return null
  try { return JSON.parse(result) } catch { return null }
}

async function redisSet(key, value) {
  const resp = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['SET', key, JSON.stringify(value)]]),
  })
  if (!resp.ok) throw new Error(`Redis set failed: ${resp.status}`)
}

// ─── Validation ───────────────────────────────────────────────────────────────

const VALID_STRATEGIES = new Set(['stop', 'continue', 'retry'])

function validateStep(s) {
  if (!s.taskName?.trim()) throw new Error('taskName requerido en cada step')
  if (s.errorStrategy && !VALID_STRATEGIES.has(s.errorStrategy)) {
    throw new Error('errorStrategy debe ser: stop, continue o retry')
  }
  const maxR = Number(s.maxRetries ?? 0)
  return {
    id:              s.id || crypto.randomUUID(),
    taskName:        s.taskName.trim(),
    agentName:       s.agentName   || null,
    profileName:     s.profileName || null,
    globalVariables: Array.isArray(s.globalVariables)
      ? s.globalVariables.map(v => ({ name: String(v.name ?? ''), value: String(v.value ?? '') }))
      : [],
    errorStrategy:   s.errorStrategy || 'stop',
    maxRetries:      Math.min(5, Math.max(0, Math.trunc(maxR))),
    retryDelaySec:   Math.min(3600, Math.max(0, Number(s.retryDelaySec ?? 30))),
  }
}

function validateNodeData(data = {}) {
  return {
    taskName:        data.taskName        || null,
    label:           data.label           || data.taskName || 'Sin nombre',
    agentName:       data.agentName       || null,
    profileName:     data.profileName     || null,
    globalVariables: Array.isArray(data.globalVariables) ? data.globalVariables : [],
    errorStrategy:   VALID_STRATEGIES.has(data.errorStrategy) ? data.errorStrategy : 'stop',
    maxRetries:      Math.min(5, Math.max(0, Number(data.maxRetries ?? 0))),
    retryDelaySec:   Math.min(3600, Math.max(0, Number(data.retryDelaySec ?? 30))),
    children:        Array.isArray(data.children) ? data.children : [],
    runStatus:       undefined, // never persist transient run state in node data
  }
}

function validateNode(n) {
  if (!n.id) throw new Error('Cada nodo requiere id')
  // Normalize React Flow internal types to storage types
  const type = n.type === 'orchTask' ? 'task' : n.type === 'orchGroup' ? 'group' : n.type
  if (!['task', 'group'].includes(type)) throw new Error(`Tipo de nodo inválido: ${n.type}`)
  return {
    id:       n.id,
    type,
    position: { x: Number(n.position?.x ?? 0), y: Number(n.position?.y ?? 0) },
    style:    n.style || undefined,
    parentId: n.parentId || undefined,
    extent:   n.parentId ? 'parent' : undefined,
    data:     validateNodeData(n.data || {}),
  }
}

function validateEdge(e) {
  if (!e.id || !e.source || !e.target) throw new Error('Cada edge requiere id, source y target')
  return { id: e.id, source: e.source, target: e.target }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!REDIS_URL || !REDIS_TOKEN) return res.status(500).json({ error: 'Redis no configurado' })

  try {
    // ── GET: list orchestrations by connectionId ──────────────────────────────
    if (req.method === 'GET') {
      const { connectionId } = req.query
      if (!connectionId) return res.status(400).json({ error: 'connectionId requerido' })
      const all = await redisGetArr(KEY)
      return res.json(all.filter(o => o.connectionId === connectionId))
    }

    // ── POST: create ──────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { connectionId, name, steps = [], nodes = [], edges = [] } = req.body || {}
      if (!connectionId) return res.status(400).json({ error: 'connectionId requerido' })
      if (!name?.trim()) return res.status(400).json({ error: 'name requerido' })
      const connections = await redisGetArr(CONN_KEY)
      if (!connections.find(c => c.id === connectionId)) {
        return res.status(404).json({ error: 'Conexión no encontrada' })
      }
      const now = new Date().toISOString()
      const orch = {
        id: crypto.randomUUID(),
        connectionId,
        name: name.trim(),
        nodes: nodes.map(validateNode),
        edges: edges.map(validateEdge),
        steps: steps.map(validateStep), // legacy compat
        createdAt: now,
        updatedAt: now,
      }
      const all = await redisGetArr(KEY)
      await redisSet(KEY, [...all, orch])
      return res.status(201).json(orch)
    }

    // ── PUT: update name / nodes / edges ──────────────────────────────────────
    if (req.method === 'PUT') {
      const { id, name, steps, nodes, edges } = req.body || {}
      if (!id) return res.status(400).json({ error: 'id requerido' })
      const all = await redisGetArr(KEY)
      const idx = all.findIndex(o => o.id === id)
      if (idx === -1) return res.status(404).json({ error: 'Orquestación no encontrada' })
      const updated = { ...all[idx], updatedAt: new Date().toISOString() }
      if (name  !== undefined) updated.name  = name.trim()
      if (nodes !== undefined) updated.nodes = nodes.map(validateNode)
      if (edges !== undefined) updated.edges = edges.map(validateEdge)
      if (steps !== undefined) updated.steps = steps.map(validateStep)
      all[idx] = updated
      await redisSet(KEY, all)
      return res.json(updated)
    }

    // ── DELETE: remove orchestration ──────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { id } = req.body || {}
      if (!id) return res.status(400).json({ error: 'id requerido' })
      const run = await redisGetObj(`cids:orch_run:${id}`)
      if (run?.status === 'running') {
        return res.status(409).json({ error: 'No se puede eliminar con una ejecución activa' })
      }
      const all = await redisGetArr(KEY)
      const filtered = all.filter(o => o.id !== id)
      if (filtered.length === all.length) return res.status(404).json({ error: 'Orquestación no encontrada' })
      await redisSet(KEY, filtered)
      return res.json({ ok: true })
    }

    return res.status(405).json({ error: 'Método no permitido' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

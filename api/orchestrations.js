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
  if (maxR < 0 || maxR > 5) throw new Error('maxRetries debe estar entre 0 y 5')
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
      const { connectionId, name, steps = [] } = req.body || {}
      if (!connectionId)   return res.status(400).json({ error: 'connectionId requerido' })
      if (!name?.trim())   return res.status(400).json({ error: 'name requerido' })
      const connections = await redisGetArr(CONN_KEY)
      if (!connections.find(c => c.id === connectionId)) {
        return res.status(404).json({ error: 'Conexión no encontrada' })
      }
      const validatedSteps = steps.map(validateStep)
      const now = new Date().toISOString()
      const orch = {
        id: crypto.randomUUID(),
        connectionId,
        name: name.trim(),
        steps: validatedSteps,
        createdAt: now,
        updatedAt: now,
      }
      const all = await redisGetArr(KEY)
      await redisSet(KEY, [...all, orch])
      return res.status(201).json(orch)
    }

    // ── PUT: update name / steps ──────────────────────────────────────────────
    if (req.method === 'PUT') {
      const { id, name, steps } = req.body || {}
      if (!id) return res.status(400).json({ error: 'id requerido' })
      const all = await redisGetArr(KEY)
      const idx = all.findIndex(o => o.id === id)
      if (idx === -1) return res.status(404).json({ error: 'Orquestación no encontrada' })
      const updated = { ...all[idx], updatedAt: new Date().toISOString() }
      if (name    !== undefined) updated.name  = name.trim()
      if (steps   !== undefined) updated.steps = steps.map(validateStep)
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

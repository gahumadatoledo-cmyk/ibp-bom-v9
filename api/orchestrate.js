import crypto from 'crypto'
import { redisGet, decrypt, logon, buildBody, buildEnvelope, soapCall as rawSoapCall, parseResponse } from './soap.js'

const REDIS_URL   = process.env.KV_REST_API_URL
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN

const SUCCESS_CODES      = new Set(['SUCCESS', 'SUCCESS_WITH_ERRORS_D', 'SUCCESS_WITH_ERRORS_E'])
const TERMINAL_ERR_CODES = new Set(['ERROR', 'TERMINATED', 'TERMINATION_FAILED', 'UNKNOWN'])
const TERMINAL_RUN       = new Set(['success', 'error', 'cancelled'])
const DONE_NODE          = new Set(['success', 'success_with_errors', 'error', 'skipped', 'cancelled'])

const SOAP_ACTIONS = {
  runTask:               'function=runTask',
  getTaskStatusByRunId2: 'function=getTaskStatusByRunId2',
  cancelTask:            'function=cancelTask',
}

// ─── Redis helpers ────────────────────────────────────────────────────────────

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

async function redisSetObj(key, value, exSeconds = 172800) {
  const resp = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['SET', key, JSON.stringify(value), 'EX', exSeconds]]),
  })
  if (!resp.ok) throw new Error(`Redis set failed: ${resp.status}`)
}

async function redisSetNx(key, value, exSeconds) {
  const resp = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['SET', key, value, 'NX', 'EX', exSeconds]]),
  })
  if (!resp.ok) throw new Error(`Redis set NX failed: ${resp.status}`)
  const data = await resp.json()
  return data[0]?.result === 'OK'
}

async function redisDel(key) {
  const resp = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['DEL', key]]),
  })
  if (!resp.ok) throw new Error(`Redis del failed: ${resp.status}`)
}

async function withRunLock(orchestrationId, fn) {
  const lockKey = `cids:orch_run_lock:${orchestrationId}`
  const lockToken = crypto.randomUUID()
  const acquired = await redisSetNx(lockKey, lockToken, 15)
  if (!acquired) return null
  try {
    return await fn()
  } finally {
    try {
      const current = await redisGetObj(lockKey)
      if (current === lockToken) await redisDel(lockKey)
    } catch {
      // lock expires automatically (EX), swallow cleanup errors
    }
  }
}

// ─── SOAP proxy ───────────────────────────────────────────────────────────────

async function soapRequest(connectionId, operation, params) {
  const connections = await redisGet('cids:connections')
  const conn = connections.find(c => c.id === connectionId)
  if (!conn) throw new Error('Conexión no encontrada')
  const { serviceUrl, orgName, user, password: encPw, isProduction } = conn
  if (!serviceUrl || !orgName || !user || !encPw) throw new Error('Conexión incompleta')
  const password   = decrypt(encPw)
  const sessionId  = await logon(serviceUrl, orgName, user, password, isProduction)
  const soapAction = SOAP_ACTIONS[operation] || `function=${operation}`
  const version    = operation === 'getTaskStatusByRunId2' ? '2.0' : null
  const body       = buildBody(operation, params)
  const envelope   = buildEnvelope(body, sessionId, version)
  const { ok, status, text } = await rawSoapCall(serviceUrl, soapAction, envelope)
  if (!ok) {
    const m = text.match(/<(?:[\w]+:)?faultstring[^>]*>([\s\S]*?)<\/(?:[\w]+:)?faultstring>/i)
    throw new Error(m ? m[1].trim() : `SOAP error HTTP ${status}`)
  }
  return parseResponse(operation, text)
}

// ─── Graph utilities ──────────────────────────────────────────────────────────

// Kahn's algorithm: returns array of waves (each wave = nodeIds that can run in parallel)
// nodeList must be pre-filtered (top-level or group children, never mixed)
function buildWaves(nodeList, edges) {
  const inDegree = {}, adjList = {}
  for (const n of nodeList) { inDegree[n.id] = 0; adjList[n.id] = [] }
  for (const e of edges) {
    if (e.source in adjList && e.target in inDegree) {
      adjList[e.source].push(e.target)
      inDegree[e.target]++
    }
  }
  const waves = []
  let ready = nodeList.filter(n => inDegree[n.id] === 0).map(n => n.id)
  while (ready.length > 0) {
    waves.push([...ready])
    const next = []
    for (const id of ready) for (const d of adjList[id]) if (--inDegree[d] === 0) next.push(d)
    ready = next
  }
  return waves
}

// Migrate legacy steps[] to nodes/edges for execution
function migrateStepsToNodes(steps) {
  const nodes = steps.map((s, i) => ({
    id: s.id, type: 'task', parentId: null,
    position: { x: 100, y: 80 + i * 180 },
    data: { ...s, label: s.taskName },
  }))
  const edges = steps.slice(0, -1).map((s, i) => ({
    id: `e-${s.id}-${steps[i + 1].id}`,
    source: s.id, target: steps[i + 1].id,
  }))
  return { nodes, edges }
}

function resolveGraph(orch) {
  if (orch.nodes && orch.nodes.length > 0) return { nodes: orch.nodes, edges: orch.edges || [] }
  return migrateStepsToNodes(orch.steps || [])
}

// ─── Orchestration lookup ─────────────────────────────────────────────────────

async function getOrchestration(orchestrationId) {
  const all = await redisGet('cids:orchestrations')
  return all.find(o => o.id === orchestrationId) || null
}

// ─── Node state initializer ───────────────────────────────────────────────────

function initNodeState(node, allNodes) {
  if (node.type === 'group') {
    const children = allNodes.filter(n => n.parentId === node.id)
    return {
      nodeId: node.id, type: 'group', status: 'pending',
      startedAt: null, finishedAt: null, error: null,
      groupWaves: [], currentGroupWave: 0,
      children: Object.fromEntries(children.map(c => [c.id, {
        nodeId: c.id, status: 'pending', sapRunId: null, sapStatusCode: null,
        startedAt: null, finishedAt: null, error: null, retryCount: 0, retryAt: null,
      }])),
    }
  }
  return {
    nodeId: node.id, type: 'task', status: 'pending',
    startedAt: null, finishedAt: null, error: null,
    sapRunId: null, sapStatusCode: null, retryCount: 0, retryAt: null,
  }
}

// ─── Task execution helpers ───────────────────────────────────────────────────

async function launchTask(connectionId, nodeDef, defaults = {}) {
  const result = await soapRequest(connectionId, 'runTask', {
    taskName:        nodeDef.data.taskName,
    agentName:       nodeDef.data.agentName   || defaults.agentName  || undefined,
    profileName:     nodeDef.data.profileName || defaults.profileName || undefined,
    globalVariables: nodeDef.data.globalVariables || [],
  })
  if (!result.runId) throw new Error('SAP no retornó runId')
  return result.runId
}

async function pollSapStatus(connectionId, sapRunId) {
  const r = await soapRequest(connectionId, 'getTaskStatusByRunId2', { runId: sapRunId })
  return (r.statusCode || '').toUpperCase()
}

// ─── Group wave helper ────────────────────────────────────────────────────────

async function launchGroupWave(run, ns, waveIds, allNodes, defaults) {
  if (!waveIds || waveIds.length === 0) return
  await Promise.allSettled(waveIds.map(async childId => {
    const childDef = allNodes.find(n => n.id === childId)
    const cs = ns.children[childId]
    if (!childDef || !cs || cs.status !== 'pending') return
    cs.status = 'running'; cs.startedAt = new Date().toISOString()
    try { cs.sapRunId = await launchTask(run.connectionId, childDef, defaults) }
    catch (e) { cs.status = 'error'; cs.finishedAt = new Date().toISOString(); cs.error = e.message }
  }))
}

// ─── Execute a wave: launch all nodes in parallel ────────────────────────────

async function executeWave(run, waveIndex, allNodes, allEdges) {
  const waveNodeIds = run.waves[waveIndex]
  const defaults = { agentName: run.defaultAgent, profileName: run.defaultProfile }

  await Promise.allSettled(waveNodeIds.map(async nodeId => {
    const nodeDef = allNodes.find(n => n.id === nodeId)
    if (!nodeDef) return
    const ns = run.nodes[nodeId]

    if (nodeDef.type === 'task') {
      ns.status = 'running'; ns.startedAt = new Date().toISOString()
      try { ns.sapRunId = await launchTask(run.connectionId, nodeDef, defaults) }
      catch (e) { ns.status = 'error'; ns.finishedAt = new Date().toISOString(); ns.error = e.message }

    } else if (nodeDef.type === 'group') {
      ns.status = 'running'; ns.startedAt = new Date().toISOString()
      const groupChildren = allNodes.filter(n => n.parentId === nodeId)
      if (groupChildren.length === 0) {
        ns.status = 'success'; ns.finishedAt = new Date().toISOString(); return
      }
      const groupEdges = allEdges.filter(e =>
        groupChildren.some(c => c.id === e.source) && groupChildren.some(c => c.id === e.target)
      )
      const groupWaves = buildWaves(groupChildren, groupEdges)
      ns.groupWaves = groupWaves
      ns.currentGroupWave = 0
      await launchGroupWave(run, ns, groupWaves[0], allNodes, defaults)
    }
  }))
  return run
}

// ─── Poll helpers ─────────────────────────────────────────────────────────────

function applyTaskResult(ns, code, strategy, maxRetries, retryDelaySec) {
  if (SUCCESS_CODES.has(code)) {
    ns.status = code === 'SUCCESS' ? 'success' : 'success_with_errors'
    ns.sapStatusCode = code; ns.finishedAt = new Date().toISOString()
  } else if (TERMINAL_ERR_CODES.has(code)) {
    if (strategy === 'retry' && ns.retryCount < maxRetries) {
      ns.status = 'pending'; ns.sapRunId = null; ns.sapStatusCode = null
      ns.retryCount++; ns.error = `SAP: ${code} (intento ${ns.retryCount}/${maxRetries})`
      ns.retryAt = new Date(Date.now() + retryDelaySec * 1000).toISOString()
    } else {
      ns.status = 'error'; ns.sapStatusCode = code
      ns.finishedAt = new Date().toISOString(); ns.error = `SAP: ${code}`
    }
  }
}

async function pollTaskNode(run, nodeId, nodeDef) {
  const ns = run.nodes[nodeId]
  const defaults = { agentName: run.defaultAgent, profileName: run.defaultProfile }
  // Re-launch if pending retry and delay elapsed
  if (ns.status === 'pending' && ns.retryAt && new Date(ns.retryAt).getTime() <= Date.now()) {
    ns.status = 'running'; ns.retryAt = null; ns.sapRunId = null
    try { ns.sapRunId = await launchTask(run.connectionId, nodeDef, defaults) }
    catch (e) { ns.status = 'error'; ns.finishedAt = new Date().toISOString(); ns.error = e.message }
    return
  }
  if (ns.status !== 'running' || !ns.sapRunId) return
  let code
  try { code = await pollSapStatus(run.connectionId, ns.sapRunId) }
  catch { return }
  applyTaskResult(ns, code,
    nodeDef.data?.errorStrategy || 'stop',
    nodeDef.data?.maxRetries    || 0,
    nodeDef.data?.retryDelaySec || 30)
}

async function pollGroupNode(run, nodeId, nodeDef, allNodes, allEdges) {
  const ns = run.nodes[nodeId]
  if (!['running', 'pending'].includes(ns.status)) return
  const groupChildren = allNodes.filter(n => n.parentId === nodeId)
  if (groupChildren.length === 0) { ns.status = 'success'; ns.finishedAt = new Date().toISOString(); return }

  const defaults = { agentName: run.defaultAgent, profileName: run.defaultProfile }

  // Lazily initialize groupWaves for runs stored before this refactor
  if (!ns.groupWaves || ns.groupWaves.length === 0) {
    const groupEdges = allEdges.filter(e =>
      groupChildren.some(c => c.id === e.source) && groupChildren.some(c => c.id === e.target)
    )
    ns.groupWaves = buildWaves(groupChildren, groupEdges)
    ns.currentGroupWave = 0
  }

  const currentWaveIds = ns.groupWaves[ns.currentGroupWave]
  if (!currentWaveIds) return

  // Poll all children in current wave
  await Promise.allSettled(currentWaveIds.map(async childId => {
    const childDef = allNodes.find(n => n.id === childId)
    const cs = ns.children[childId]
    if (!childDef || !cs) return
    // Retry re-launch
    if (cs.status === 'pending' && cs.retryAt && new Date(cs.retryAt).getTime() <= Date.now()) {
      cs.retryAt = null
      try { cs.sapRunId = await launchTask(run.connectionId, childDef, defaults); cs.status = 'running' }
      catch (e) { cs.status = 'error'; cs.finishedAt = new Date().toISOString(); cs.error = e.message }
      return
    }
    if (cs.status !== 'running' || !cs.sapRunId) return
    let code
    try { code = await pollSapStatus(run.connectionId, cs.sapRunId) }
    catch { return }
    applyTaskResult(cs, code,
      childDef.data?.errorStrategy || 'stop',
      childDef.data?.maxRetries    || 0,
      childDef.data?.retryDelaySec || 30)
  }))

  // Check if current wave is done
  const waveDone = currentWaveIds.every(id => DONE_NODE.has(ns.children[id]?.status))
  if (!waveDone) return

  // Check for blocking errors in current wave
  const hasBlockingError = currentWaveIds.some(id => {
    if (ns.children[id]?.status !== 'error') return false
    const childDef = allNodes.find(n => n.id === id)
    return (childDef?.data?.errorStrategy || 'stop') === 'stop'
  })

  if (hasBlockingError) {
    for (const waveIds of ns.groupWaves.slice(ns.currentGroupWave + 1)) {
      for (const id of waveIds) if (ns.children[id]) ns.children[id].status = 'skipped'
    }
    ns.status = 'error'; ns.finishedAt = new Date().toISOString()
    return
  }

  // Advance to next wave or mark group done
  if (ns.currentGroupWave < ns.groupWaves.length - 1) {
    ns.currentGroupWave++
    await launchGroupWave(run, ns, ns.groupWaves[ns.currentGroupWave], allNodes, defaults)
  } else {
    const anyErr = Object.values(ns.children).some(cs => cs.status === 'error')
    ns.status = anyErr ? 'error' : 'success'
    ns.finishedAt = new Date().toISOString()
  }
}

// ─── Start run ────────────────────────────────────────────────────────────────

async function startRun(orchestrationId, defaultAgent = null, defaultProfile = null) {
  return withRunLock(orchestrationId, async () => {
    const orch = await getOrchestration(orchestrationId)
    if (!orch) throw new Error('Orquestación no encontrada')

    const { nodes, edges } = resolveGraph(orch)
    if (nodes.filter(n => !n.parentId).length === 0) throw new Error('La orquestación no tiene nodos')

    const RUN_KEY = `cids:orch_run:${orchestrationId}`
    const existing = await redisGetObj(RUN_KEY)
    if (existing?.status === 'running') {
      const err = new Error('Ya hay una ejecución activa'); err.statusCode = 409; throw err
    }

    const waves = buildWaves(nodes.filter(n => !n.parentId), edges)
    if (waves.length === 0) throw new Error('No se pudo determinar el orden de ejecución (¿ciclo detectado?)')

    let run = {
      runId: crypto.randomUUID(),
      orchestrationId, connectionId: orch.connectionId,
      status: 'running', currentWave: 0,
      startedAt: new Date().toISOString(), finishedAt: null,
      defaultAgent: defaultAgent || null, defaultProfile: defaultProfile || null,
      waves,
      nodes: Object.fromEntries(nodes.map(n => [n.id, initNodeState(n, nodes)])),
    }

    run = await executeWave(run, 0, nodes, edges)
    await redisSetObj(RUN_KEY, run)
    return run
  })
}

// ─── Tick ─────────────────────────────────────────────────────────────────────

async function tick(orchestrationId) {
  const locked = await withRunLock(orchestrationId, async () => {
    const RUN_KEY = `cids:orch_run:${orchestrationId}`
    let run = await redisGetObj(RUN_KEY)
    if (!run || TERMINAL_RUN.has(run.status)) return run

    const orch = await getOrchestration(orchestrationId)
    if (!orch) {
      run.status = 'error'; run.finishedAt = new Date().toISOString()
      await redisSetObj(RUN_KEY, run); return run
    }

    const { nodes, edges } = resolveGraph(orch)
    const waveNodeIds = run.waves[run.currentWave] || []

    // Poll all nodes in current wave
    await Promise.allSettled(waveNodeIds.map(async nodeId => {
      const nodeDef = nodes.find(n => n.id === nodeId)
      if (!nodeDef) return
      if (nodeDef.type === 'task')  await pollTaskNode(run, nodeId, nodeDef)
      if (nodeDef.type === 'group') await pollGroupNode(run, nodeId, nodeDef, nodes, edges)
    }))

    // Check if wave is complete
    const waveComplete = waveNodeIds.every(id => DONE_NODE.has(run.nodes[id]?.status))
    if (!waveComplete) { await redisSetObj(RUN_KEY, run); return run }

    // Check for blocking errors (errorStrategy === 'stop')
    const hasBlockingError = waveNodeIds.some(id => {
      if (run.nodes[id]?.status !== 'error') return false
      const nodeDef = nodes.find(n => n.id === id)
      return (nodeDef?.data?.errorStrategy || 'stop') === 'stop'
    })

    if (hasBlockingError) {
      run.status = 'error'; run.finishedAt = new Date().toISOString()
      for (const futureWave of run.waves.slice(run.currentWave + 1)) {
        for (const nid of futureWave) if (run.nodes[nid]) run.nodes[nid].status = 'skipped'
      }
    } else if (run.currentWave < run.waves.length - 1) {
      run.currentWave++
      run = await executeWave(run, run.currentWave, nodes, edges)
    } else {
      const anyErr = Object.values(run.nodes).some(ns => ns.status === 'error')
      run.status = anyErr ? 'error' : 'success'
      run.finishedAt = new Date().toISOString()
    }

    await redisSetObj(RUN_KEY, run)
    return run
  })
  if (locked !== null) return locked
  return redisGetObj(`cids:orch_run:${orchestrationId}`)
}

// ─── Cancel run ───────────────────────────────────────────────────────────────

async function cancelRun(orchestrationId) {
  const locked = await withRunLock(orchestrationId, async () => {
    const RUN_KEY = `cids:orch_run:${orchestrationId}`
    const run = await redisGetObj(RUN_KEY)
    if (!run) throw new Error('No hay ejecución registrada')
    if (TERMINAL_RUN.has(run.status)) {
      const err = new Error('La ejecución ya está en estado terminal'); err.statusCode = 409; throw err
    }

    const now = new Date().toISOString()
    // Cancel all running SAP tasks (best-effort)
    await Promise.allSettled(Object.values(run.nodes).flatMap(ns => {
      const tasks = []
      if (ns.type === 'task' && ns.status === 'running' && ns.sapRunId) {
        tasks.push(soapRequest(run.connectionId, 'cancelTask', { runId: ns.sapRunId }).catch(() => {}))
      }
      if (ns.type === 'group') {
        for (const cs of Object.values(ns.children || {})) {
          if (cs.status === 'running' && cs.sapRunId) {
            tasks.push(soapRequest(run.connectionId, 'cancelTask', { runId: cs.sapRunId }).catch(() => {}))
          }
        }
      }
      return tasks
    }))

    run.status = 'cancelled'; run.finishedAt = now
    for (const ns of Object.values(run.nodes)) {
      if (ns.status === 'running') ns.status = 'cancelled'
      ns.finishedAt = now
      if (ns.status === 'pending') ns.status = 'skipped'
      if (ns.type === 'group') {
        for (const cs of Object.values(ns.children || {})) {
          if (cs.status === 'running') { cs.status = 'cancelled'; cs.finishedAt = now }
          if (cs.status === 'pending') cs.status = 'skipped'
        }
      }
    }

    await redisSetObj(RUN_KEY, run)
    return run
  })
  if (locked !== null) return locked
  return redisGetObj(`cids:orch_run:${orchestrationId}`)
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!REDIS_URL || !REDIS_TOKEN) return res.status(500).json({ error: 'Redis no configurado' })

  try {
    if (req.method === 'POST') {
      const { orchestrationId, action, defaultAgent, defaultProfile } = req.body || {}
      if (!orchestrationId) return res.status(400).json({ error: 'orchestrationId requerido' })
      if (action !== 'start') return res.status(400).json({ error: 'action debe ser "start"' })
      const run = await startRun(orchestrationId, defaultAgent || null, defaultProfile || null)
      return res.status(201).json(run)
    }

    if (req.method === 'GET') {
      const { orchestrationId, action } = req.query
      if (!orchestrationId) return res.status(400).json({ error: 'orchestrationId requerido' })
      if (action === 'tick') return res.json(await tick(orchestrationId))
      return res.json(await redisGetObj(`cids:orch_run:${orchestrationId}`))
    }

    if (req.method === 'DELETE') {
      const { orchestrationId } = req.body || {}
      if (!orchestrationId) return res.status(400).json({ error: 'orchestrationId requerido' })
      return res.json(await cancelRun(orchestrationId))
    }

    return res.status(405).json({ error: 'Método no permitido' })
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message })
  }
}

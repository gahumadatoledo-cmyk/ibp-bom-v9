import crypto from 'crypto'
import { redisGet, decrypt, logon, buildBody, buildEnvelope, soapCall, parseResponse } from './soap.js'

const REDIS_URL   = process.env.KV_REST_API_URL
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN

// SAP status classification
const SUCCESS_CODES      = new Set(['SUCCESS', 'SUCCESS_WITH_ERRORS_D', 'SUCCESS_WITH_ERRORS_E'])
const TERMINAL_ERR_CODES = new Set(['ERROR', 'TERMINATED', 'TERMINATION_FAILED', 'UNKNOWN'])
// RUNNING, QUEUEING, IMPORTED, FETCHED → still in progress, no action

// ─── Redis helpers (run state: single objects with TTL) ───────────────────────

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

// ─── SOAP proxy (reuses soap.js internals) ────────────────────────────────────

async function soapRequest(connectionId, operation, params) {
  const connections = await redisGet('cids:connections')
  const conn = connections.find(c => c.id === connectionId)
  if (!conn) throw new Error('Conexión no encontrada')
  const { serviceUrl, orgName, user, password: encPw, isProduction } = conn
  if (!serviceUrl || !orgName || !user || !encPw) throw new Error('Conexión incompleta')
  const password  = decrypt(encPw)
  const sessionId = await logon(serviceUrl, orgName, user, password, isProduction)
  const body      = buildBody(operation, params)
  const envelope  = buildEnvelope(body, sessionId)
  const { ok, status, text } = await soapCall(serviceUrl, operation, envelope)
  if (!ok) {
    const m = text.match(/<(?:[\w]+:)?faultstring[^>]*>([\s\S]*?)<\/(?:[\w]+:)?faultstring>/i)
    throw new Error(m ? m[1].trim() : `SOAP error HTTP ${status}`)
  }
  return parseResponse(operation, text)
}

// ─── Orchestration lookup ─────────────────────────────────────────────────────

async function getOrchestration(orchestrationId) {
  const all = await redisGet('cids:orchestrations')
  return all.find(o => o.id === orchestrationId) || null
}

// ─── Step executor ────────────────────────────────────────────────────────────

async function executeStep(run, stepIdx, orch) {
  const step    = run.steps[stepIdx]
  const stepDef = orch.steps.find(s => s.id === step.stepId) || {}

  try {
    const result = await soapRequest(run.connectionId, 'runTask', {
      taskName:        stepDef.taskName        || step.taskName,
      agentName:       stepDef.agentName       || undefined,
      profileName:     stepDef.profileName     || undefined,
      globalVariables: stepDef.globalVariables || [],
    })
    if (!result.runId) throw new Error('SAP no retornó runId')
    run.steps[stepIdx] = {
      ...step,
      status:    'running',
      sapRunId:  result.runId,
      startedAt: new Date().toISOString(),
    }
    run.currentStepIndex = stepIdx
  } catch (e) {
    const errorStrategy = stepDef.errorStrategy || 'stop'
    run.steps[stepIdx] = {
      ...step,
      status:     'error',
      finishedAt: new Date().toISOString(),
      error:      e.message,
    }
    if (errorStrategy !== 'continue') {
      run.status     = 'error'
      run.finishedAt = new Date().toISOString()
    }
  }
  return run
}

// ─── State machine: check if all steps reached a terminal state ───────────────

function checkAllDone(run) {
  const DONE = new Set(['success', 'success_with_errors', 'error', 'skipped', 'cancelled'])
  if (!run.steps.every(s => DONE.has(s.status))) return run
  const hasErr   = run.steps.some(s => s.status === 'error')
  run.status     = hasErr ? 'error' : 'success'
  run.finishedAt = new Date().toISOString()
  return run
}

// ─── Start run ────────────────────────────────────────────────────────────────

async function startRun(orchestrationId) {
  const orch = await getOrchestration(orchestrationId)
  if (!orch)                throw new Error('Orquestación no encontrada')
  if (!orch.steps.length)   throw new Error('La orquestación no tiene pasos')

  const RUN_KEY = `cids:orch_run:${orchestrationId}`
  const existing = await redisGetObj(RUN_KEY)
  if (existing?.status === 'running') {
    const err = new Error('Ya hay una ejecución activa para esta orquestación')
    err.statusCode = 409
    throw err
  }

  const run = {
    runId:            crypto.randomUUID(),
    orchestrationId,
    connectionId:     orch.connectionId,
    status:           'running',
    currentStepIndex: 0,
    startedAt:        new Date().toISOString(),
    finishedAt:       null,
    steps: orch.steps.map(s => ({
      stepId:        s.id,
      taskName:      s.taskName,
      status:        'pending',
      sapRunId:      null,
      startedAt:     null,
      finishedAt:    null,
      sapStatusCode: null,
      retryCount:    0,
      retryAt:       null,
      error:         null,
    })),
  }

  const started = await executeStep(run, 0, orch)
  await redisSetObj(RUN_KEY, started)
  return started
}

// ─── Tick: advance state machine ──────────────────────────────────────────────

async function tick(orchestrationId) {
  const RUN_KEY = `cids:orch_run:${orchestrationId}`
  let run = await redisGetObj(RUN_KEY)
  if (!run) return null
  if (['success', 'error', 'cancelled'].includes(run.status)) return run

  const orch = await getOrchestration(orchestrationId)
  if (!orch) {
    run.status = 'error'; run.finishedAt = new Date().toISOString()
    await redisSetObj(RUN_KEY, run)
    return run
  }

  const now       = Date.now()
  const runningIdx = run.steps.findIndex(s => s.status === 'running')

  if (runningIdx !== -1) {
    // ── Check SAP status of the running step ──────────────────────────────────
    const step    = run.steps[runningIdx]
    const stepDef = orch.steps.find(s => s.id === step.stepId) || {}

    let sapStatus
    try {
      sapStatus = await soapRequest(run.connectionId, 'getTaskStatusByRunId2', { runId: step.sapRunId })
    } catch (e) {
      // Transient SOAP error — leave state unchanged, retry on next tick
      await redisSetObj(RUN_KEY, run)
      return run
    }

    const code = (sapStatus.statusCode || '').toUpperCase()

    if (SUCCESS_CODES.has(code)) {
      run.steps[runningIdx] = {
        ...step,
        status:        code === 'SUCCESS' ? 'success' : 'success_with_errors',
        sapStatusCode: code,
        finishedAt:    new Date().toISOString(),
      }
      // Advance: find next pending step
      const nextIdx = run.steps.findIndex((s, i) => i > runningIdx && s.status === 'pending')
      if (nextIdx !== -1) {
        run = await executeStep(run, nextIdx, orch)
      } else {
        run = checkAllDone(run)
      }

    } else if (TERMINAL_ERR_CODES.has(code)) {
      const errorStrategy = stepDef.errorStrategy || 'stop'
      const maxRetries    = stepDef.maxRetries    || 0
      const retryDelaySec = stepDef.retryDelaySec || 30

      if (errorStrategy === 'retry' && step.retryCount < maxRetries) {
        // Reset step to pending with a future retryAt
        run.steps[runningIdx] = {
          ...step,
          status:        'pending',
          sapRunId:      null,
          sapStatusCode: null,
          retryCount:    step.retryCount + 1,
          retryAt:       new Date(now + retryDelaySec * 1000).toISOString(),
          error:         `SAP: ${code} (intento ${step.retryCount + 1}/${maxRetries})`,
        }
      } else if (errorStrategy === 'continue') {
        run.steps[runningIdx] = {
          ...step,
          status:        'error',
          sapStatusCode: code,
          finishedAt:    new Date().toISOString(),
          error:         `SAP: ${code}`,
        }
        const nextIdx = run.steps.findIndex((s, i) => i > runningIdx && s.status === 'pending')
        if (nextIdx !== -1) {
          run = await executeStep(run, nextIdx, orch)
        } else {
          run = checkAllDone(run)
        }
      } else {
        // stop (default)
        run.steps[runningIdx] = {
          ...step,
          status:        'error',
          sapStatusCode: code,
          finishedAt:    new Date().toISOString(),
          error:         `SAP: ${code}`,
        }
        run.status     = 'error'
        run.finishedAt = new Date().toISOString()
      }
    }
    // else: still RUNNING/QUEUEING/IMPORTED/FETCHED — no state change

  } else {
    // ── No running step — find next pending (honoring retryAt) ───────────────
    const nextIdx = run.steps.findIndex(
      s => s.status === 'pending' && (!s.retryAt || new Date(s.retryAt).getTime() <= now)
    )
    if (nextIdx !== -1) {
      run = await executeStep(run, nextIdx, orch)
    } else {
      run = checkAllDone(run)
    }
  }

  await redisSetObj(RUN_KEY, run)
  return run
}

// ─── Cancel run ───────────────────────────────────────────────────────────────

async function cancelRun(orchestrationId) {
  const RUN_KEY = `cids:orch_run:${orchestrationId}`
  const run = await redisGetObj(RUN_KEY)
  if (!run) throw new Error('No hay ejecución registrada')
  if (['success', 'error', 'cancelled'].includes(run.status)) {
    const err = new Error('La ejecución ya está en estado terminal')
    err.statusCode = 409
    throw err
  }

  const runningStep = run.steps.find(s => s.status === 'running' && s.sapRunId)
  if (runningStep) {
    try {
      await soapRequest(run.connectionId, 'cancelTask', { runId: runningStep.sapRunId })
    } catch { /* best-effort: mark cancelled regardless */ }
  }

  const now  = new Date().toISOString()
  run.status     = 'cancelled'
  run.finishedAt = now
  run.steps = run.steps.map(s => {
    if (s.status === 'running') return { ...s, status: 'cancelled', finishedAt: now }
    if (s.status === 'pending') return { ...s, status: 'skipped' }
    return s
  })

  await redisSetObj(RUN_KEY, run)
  return run
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!REDIS_URL || !REDIS_TOKEN) return res.status(500).json({ error: 'Redis no configurado' })

  try {
    // POST { orchestrationId, action: 'start' }
    if (req.method === 'POST') {
      const { orchestrationId, action } = req.body || {}
      if (!orchestrationId) return res.status(400).json({ error: 'orchestrationId requerido' })
      if (action !== 'start') return res.status(400).json({ error: 'action debe ser "start"' })
      const run = await startRun(orchestrationId)
      return res.status(201).json(run)
    }

    // GET ?orchestrationId=X&action=tick  →  advance + return state
    // GET ?orchestrationId=X              →  return state (no advance)
    if (req.method === 'GET') {
      const { orchestrationId, action } = req.query
      if (!orchestrationId) return res.status(400).json({ error: 'orchestrationId requerido' })
      if (action === 'tick') {
        const run = await tick(orchestrationId)
        return res.json(run)
      }
      const run = await redisGetObj(`cids:orch_run:${orchestrationId}`)
      return res.json(run)
    }

    // DELETE { orchestrationId }
    if (req.method === 'DELETE') {
      const { orchestrationId } = req.body || {}
      if (!orchestrationId) return res.status(400).json({ error: 'orchestrationId requerido' })
      const run = await cancelRun(orchestrationId)
      return res.json(run)
    }

    return res.status(405).json({ error: 'Método no permitido' })
  } catch (e) {
    const status = e.statusCode || 500
    return res.status(status).json({ error: e.message })
  }
}

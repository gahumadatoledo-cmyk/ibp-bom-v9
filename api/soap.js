import crypto from 'crypto'

const REDIS_URL  = process.env.KV_REST_API_URL
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN
const KEY = 'cids:connections'

// ─── Redis helpers ────────────────────────────────────────────────────────────

async function redisGet(key) {
  const resp = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['GET', key]])
  })
  const data = await resp.json()
  const result = data[0]?.result
  if (!result) return []
  try {
    const parsed = JSON.parse(result)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function decrypt(text) {
  try {
    const secret = process.env.ENCRYPTION_SECRET || 'default-secret-change-me'
    const [ivHex, encrypted] = text.split(':')
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      Buffer.from(secret.padEnd(32).slice(0, 32)),
      Buffer.from(ivHex, 'hex')
    )
    return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8')
  } catch { return '' }
}

// ─── XML helpers ──────────────────────────────────────────────────────────────

/** Extract the inner text of the first matching tag (namespace-agnostic) */
function xmlVal(xml, tag) {
  const m = xml.match(new RegExp(`<(?:[\\w]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[\\w]+:)?${tag}>`, 'i'))
  return m ? m[1].trim() : null
}

/** Extract all occurrences of a tag as an array of raw XML strings */
function xmlAll(xml, tag) {
  const re = new RegExp(`<(?:[\\w]+:)?${tag}[^>]*>[\\s\\S]*?<\\/(?:[\\w]+:)?${tag}>`, 'gi')
  return [...xml.matchAll(re)].map(m => m[0])
}

/** Extract attribute value from tag opening */
function xmlAttr(xml, tag, attr) {
  const m = xml.match(new RegExp(`<(?:[\\w]+:)?${tag}[^>]*\\s${attr}="([^"]*)"`, 'i'))
  return m ? m[1] : null
}

/** Escape XML special characters */
function xe(s) {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Parse a SOAP fault if present */
function parseFault(xml) {
  const code   = xmlVal(xml, 'faultcode')   || xmlVal(xml, 'faultCode')
  const str    = xmlVal(xml, 'faultstring') || xmlVal(xml, 'faultString')
  if (code || str) {
    const detail = xmlVal(xml, 'message') || xmlVal(xml, 'detail') || xmlVal(xml, 'WebFaultException')
    return { faultCode: code, faultString: detail ? `${str} — ${detail}` : str }
  }
  return null
}

// ─── SOAP envelope builder ────────────────────────────────────────────────────

function buildEnvelope(body, sessionId, version) {
  let headerContent = ''
  if (sessionId) headerContent += `<SessionId>${xe(sessionId)}</SessionId>`
  if (version)   headerContent += `<web:Version>${xe(version)}</web:Version>`
  const header = headerContent ? `<soapenv:Header>${headerContent}</soapenv:Header>` : '<soapenv:Header/>'
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://webservices.dsod.sap.com/">
  ${header}
  <soapenv:Body>${body}</soapenv:Body>
</soapenv:Envelope>`
}

// ─── SOAP HTTP call ───────────────────────────────────────────────────────────

async function soapCall(serviceUrl, soapAction, envelopeXml) {
  const resp = await fetch(serviceUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction':   soapAction,
    },
    body: envelopeXml,
  })
  const text = await resp.text()
  return { ok: resp.ok, status: resp.status, text }
}

// ─── Logon ────────────────────────────────────────────────────────────────────

async function logon(serviceUrl, orgName, user, password, isProduction) {
  const body = `<web:logonRequest>
      <orgName>${xe(orgName)}</orgName>
      <userName>${xe(user)}</userName>
      <password>${xe(password)}</password>
      <isProduction>${isProduction ? 'true' : 'false'}</isProduction>
    </web:logonRequest>`
  const { ok, text, status } = await soapCall(serviceUrl, 'function=logon', buildEnvelope(body, null))
  if (!ok) {
    const fault = parseFault(text)
    throw new Error(fault?.faultString || `logon failed (HTTP ${status})`)
  }
  const sessionId = xmlVal(text, 'SessionID') || xmlVal(text, 'sessionID')
  if (!sessionId) throw new Error('logon response did not return SessionID')
  return sessionId
}

// ─── Operation builders ────────────────────────────────────────────────────────

function buildBody(operation, params = {}) {
  switch (operation) {

    case 'ping':
      return `<web:pingRequest><SessionID>${xe(params.sessionId)}</SessionID></web:pingRequest>`

    case 'logout':
      return `<web:logoutRequest><SessionID>${xe(params.sessionId)}</SessionID></web:logoutRequest>`

    case 'getProjects':
      return `<web:AllProjectsRequest/>`

    case 'getProjectTasks':
      return `<web:AllProjectTasksRequest><projectGuid>${xe(params.projectGuid)}</projectGuid></web:AllProjectTasksRequest>`

    case 'searchTasks':
      return `<web:searchTasksRequest><nameFilter>${xe(params.nameFilter || '')}</nameFilter></web:searchTasksRequest>`

    case 'getTaskInfo':
      return `<web:taskInfoResponse><taskGuid>${xe(params.taskGuid)}</taskGuid></web:taskInfoResponse>`

    case 'getAgents':
      return `<web:allAgentsRequest><activeOnly>${params.activeOnly ? 'true' : 'false'}</activeOnly></web:allAgentsRequest>`

    case 'getSystemConfigurations':
      return `<web:AllSystemConfigurationsRequest/>`

    case 'runTask': {
      const vars = (params.globalVariables || [])
        .map(v => `<variable name="${xe(v.name)}">${xe(v.value)}</variable>`)
        .join('\n      ')
      return `<web:TaskInfo>
        <taskName>${xe(params.taskName)}</taskName>
        <description>${xe(params.description || '')}</description>
        ${params.agentName  ? `<agentName>${xe(params.agentName)}</agentName>` : ''}
        ${params.agentGroup ? `<agentGroup>${xe(params.agentGroup)}</agentGroup>` : ''}
        ${params.profileName ? `<profileName>${xe(params.profileName)}</profileName>` : ''}
        ${vars ? `<globalVariables>${vars}</globalVariables>` : ''}
      </web:TaskInfo>`
    }

    case 'getTaskStatusByRunId2':
      return `<web:TaskStatusRequest><runId>${xe(params.runId)}</runId></web:TaskStatusRequest>`

    case 'getAllExecutedTasks2': {
      const startFrom = params.startDateFrom
        ? `<startDate><from>${xe(params.startDateFrom)}</from>${params.startDateTo ? `<to>${xe(params.startDateTo)}</to>` : ''}</startDate>`
        : ''
      const endFrom = params.endDateFrom
        ? `<endDate><from>${xe(params.endDateFrom)}</from>${params.endDateTo ? `<to>${xe(params.endDateTo)}</to>` : ''}</endDate>`
        : ''
      return `<web:executedTaskFilterRequest>
        ${params.taskName   ? `<taskName>${xe(params.taskName)}</taskName>` : ''}
        ${startFrom}
        ${endFrom}
        ${params.statusCode ? `<statusCode>${xe(params.statusCode)}</statusCode>` : ''}
      </web:executedTaskFilterRequest>`
    }

    case 'getTaskLogs': {
      const logBlock = (name, p) => p?.getLog
        ? `<${name}><getLog>true</getLog><pageNum>${p.pageNum || 1}</pageNum></${name}>`
        : ''
      return `<web:TaskLogsRequest>
        <runID>${xe(params.runId)}</runID>
        <base64Encode>${params.base64Encode !== false ? 'true' : 'false'}</base64Encode>
        ${logBlock('traceLog',   params.traceLog)}
        ${logBlock('monitorLog', params.monitorLog)}
        ${logBlock('errorLog',   params.errorLog)}
      </web:TaskLogsRequest>`
    }

    case 'cancelTask':
      return `<web:CancelTaskRequest><runId>${xe(params.runId)}</runId></web:CancelTaskRequest>`

    default:
      throw new Error(`Unknown operation: ${operation}`)
  }
}

// ─── Response parsers ─────────────────────────────────────────────────────────

function parseResponse(operation, xml) {
  const fault = parseFault(xml)
  if (fault) throw new Error(fault.faultString || fault.faultCode || 'SOAP fault')

  switch (operation) {

    case 'ping':
      return { message: xmlVal(xml, 'Message') || xmlVal(xml, 'message') }

    case 'logout':
      return { message: xmlVal(xml, 'LogoutMessage') || xmlVal(xml, 'logoutMessage') }

    case 'getProjects':
      return xmlAll(xml, 'return').map(p => ({
        name:        xmlVal(p, 'name'),
        guid:        xmlVal(p, 'guid'),
        description: xmlVal(p, 'description'),
      }))

    case 'getProjectTasks':
      return xmlAll(xml, 'return').map(t => ({
        taskName:    xmlVal(t, 'taskName'),
        description: xmlVal(t, 'description'),
        taskGuid:    xmlVal(t, 'taskGuid'),
        type:        xmlVal(t, 'type'),
      }))

    case 'searchTasks':
      return xmlAll(xml, 'return').map(t => ({
        taskName:    xmlVal(t, 'taskName'),
        description: xmlVal(t, 'description'),
        taskGuid:    xmlVal(t, 'taskGuid'),
        type:        xmlVal(t, 'type'),
      }))

    case 'getTaskInfo': {
      const vars = xmlAll(xml, 'globalVariables').map(v => ({
        name:         xmlVal(v, 'name'),
        description:  xmlVal(v, 'description'),
        dataType:     xmlVal(v, 'dataType'),
        defaultValue: xmlVal(v, 'defaultValue'),
        length:       xmlVal(v, 'length'),
      }))
      const props = xmlAll(xml, 'properties').map(p => ({
        name:    xmlVal(p, 'name'),
        value:   xmlVal(p, 'value'),
        caption: xmlVal(p, 'caption'),
      }))
      return {
        taskName:    xmlVal(xml, 'taskName'),
        taskGuid:    xmlVal(xml, 'taskGuid'),
        description: xmlVal(xml, 'description'),
        type:        xmlVal(xml, 'type'),
        globalVariables: vars,
        properties:      props,
      }
    }

    case 'getAgents':
      return xmlAll(xml, 'return').map(g => ({
        name:        xmlVal(g, 'name'),
        guid:        xmlVal(g, 'guid'),
        description: xmlVal(g, 'description'),
        agents: xmlAll(g, 'agents').map(a => ({
          name:          xmlVal(a, 'name'),
          guid:          xmlVal(a, 'guid'),
          description:   xmlVal(a, 'description'),
          lastConnected: xmlVal(a, 'lastConnected'),
          version:       xmlVal(a, 'version'),
          agentStatus:   xmlVal(a, 'agentStatus'),
        })),
      }))

    case 'getSystemConfigurations':
      return xmlAll(xml, 'return').map(s => ({
        name:        xmlVal(s, 'name'),
        guid:        xmlVal(s, 'guid'),
        description: xmlVal(s, 'description'),
        dsConfigurations: xmlAll(s, 'dsConfigurations').map(d => ({
          dataStoreName:              xmlVal(d, 'dataStoreName'),
          dataStoreConfigurationName: xmlVal(d, 'dataStoreConfigurationName'),
        })),
      }))

    case 'runTask':
      return { runId: xmlVal(xml, 'RunID') || xmlVal(xml, 'runId') || xmlVal(xml, 'RunId') }

    case 'getTaskStatusByRunId2': {
      const batchInfos = xmlAll(xml, 'uploadBatchInfos').map(b => ({
        id:        xmlVal(b, 'id'),
        name:      xmlVal(b, 'name'),
        startTime: xmlVal(b, 'startTime'),
      }))
      return {
        projectName:      xmlVal(xml, 'projectName'),
        jobId:            xmlVal(xml, 'jobId'),
        statusCode:       xmlVal(xml, 'statusCode'),
        statusMsg:        xmlVal(xml, 'statusMsg'),
        startTime:        xmlVal(xml, 'startTime'),
        endTime:          xmlVal(xml, 'endTime'),
        executionTime:    xmlVal(xml, 'executionTime'),
        description:      xmlVal(xml, 'description'),
        uploadBatchInfos: batchInfos,
      }
    }

    case 'getAllExecutedTasks2':
      return xmlAll(xml, 'return').map(r => {
        const attrs = {
          jobId:      xmlAttr(r, 'return', 'jobId'),
          startDate:  xmlAttr(r, 'return', 'startDate'),
          statusCode: xmlAttr(r, 'return', 'statusCode'),
          taskName:   xmlAttr(r, 'return', 'taskName'),
        }
        const runId = xmlVal(r, 'return') || r.replace(/<[^>]+>/g, '').trim()
        return { runId, ...attrs }
      })

    case 'getTaskLogs': {
      const parseLog = (name) => {
        const block = xmlVal(xml, name)
        if (!block) return null
        return {
          maxPage:       xmlVal(xml, 'maxPage'),
          pageNum:       xmlVal(xml, 'pageNum'),
          jobRunStatus:  xmlVal(xml, 'JobRunStatus'),
          messageLines:  xmlAll(xml, 'messageLines').map(l => l.replace(/<[^>]+>/g, '').trim()),
        }
      }
      return {
        traceLog:   parseLog('traceLog'),
        monitorLog: parseLog('monitorLog'),
        errorLog:   parseLog('errorLog'),
      }
    }

    case 'cancelTask':
      return {
        status:  xmlVal(xml, 'status')  || xmlVal(xml, 'Status'),
        message: xmlVal(xml, 'message') || xmlVal(xml, 'Message'),
      }

    default:
      return { raw: xml }
  }
}

// ─── Named exports for internal reuse ────────────────────────────────────────
export { redisGet, decrypt, xe, parseFault, buildEnvelope, soapCall, logon, buildBody, parseResponse }

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!REDIS_URL || !REDIS_TOKEN) return res.status(500).json({ error: 'Redis no configurado' })

  const { connectionId, operation, params = {} } = req.body || {}
  if (!connectionId) return res.status(400).json({ error: 'connectionId requerido' })
  if (!operation)    return res.status(400).json({ error: 'operation requerido' })

  // Resolve connection credentials
  const connections = await redisGet(KEY)
  const conn = connections.find(c => c.id === connectionId)
  if (!conn) return res.status(404).json({ error: 'Conexión no encontrada' })

  const { serviceUrl, orgName, user, password: encPw, isProduction } = conn
  if (!serviceUrl || !orgName || !user || !encPw) {
    return res.status(400).json({ error: 'Conexión incompleta — falta serviceUrl, orgName, user o password' })
  }

  const password = decrypt(encPw)

  const soapActionMap = {
    getProjects:             'function=getAllProjects',
    getProjectTasks:         'function=getAllProjectTasks',
    getSystemConfigurations: 'function=getAllSystemConfigurations',
    getAgents:               'function=getAllAgents',
    logout:                  'function=logoff',
  }
  const soapAction = soapActionMap[operation] || `function=${operation}`
  const version = ['getAllExecutedTasks2', 'getTaskStatusByRunId2'].includes(operation) ? '2.0' : null

  try {
    // Logon to get SessionID
    const sessionId = await logon(serviceUrl, orgName, user, password, isProduction)

    // Build and execute operation
    const body = buildBody(operation, params)
    const envelope = buildEnvelope(body, sessionId, version)
    const { ok, status, text } = await soapCall(serviceUrl, soapAction, envelope)

    if (!ok) {
      const fault = parseFault(text)
      return res.status(status).json({
        error: fault?.faultString || `SOAP error HTTP ${status}`,
        faultCode: fault?.faultCode,
        rawXml: fault ? undefined : text.slice(0, 2000),
      })
    }

    const result = parseResponse(operation, text)
    return res.json(result)

  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

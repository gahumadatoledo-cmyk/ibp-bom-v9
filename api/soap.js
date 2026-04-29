
// ─── XML helpers ──────────────────────────────────────────────────────────────

/** Extract the inner text of the first matching tag (namespace-agnostic) */
function xmlVal(xml, tag) {
  const m = xml.match(new RegExp(`<(?:[\\w]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w]+:)?${tag}>`, 'i'))
  return m ? m[1].trim() : null
}

/** Extract all occurrences of a tag as an array of raw XML strings */
function xmlAll(xml, tag) {
  const re = new RegExp(`<(?:[\\w]+:)?${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/(?:[\\w]+:)?${tag}>`, 'gi')
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

function sanitizeSessionId(xml = '') {
  return xml.replace(/<(?:[\w]+:)?SessionId>([\s\S]*?)<\/(?:[\w]+:)?SessionId>/gi, '<SessionId>[redacted]</SessionId>')
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
      return `<web:pingRequest/>`

    case 'logout':
      return `<web:logoutRequest><SessionID>${xe(params.sessionId)}</SessionID></web:logoutRequest>`

    case 'getProjects':
      return `<web:allProjectsRequest/>`

    case 'getProjectTasks':
      return `<web:allProjectTasksRequest><projectGuid>${xe(params.projectGuid)}</projectGuid></web:allProjectTasksRequest>`

    case 'searchTasks':
      return `<web:searchTasksRequest><nameFilter>${xe(params.nameFilter || '')}</nameFilter></web:searchTasksRequest>`

    case 'getTaskInfo':
      return `<web:taskInfoRequest><taskGuid>${xe(params.taskGuid)}</taskGuid></web:taskInfoRequest>`

    case 'getAgents':
      return `<web:allAgentsRequest><activeOnly>${params.activeOnly ? 'true' : 'false'}</activeOnly></web:allAgentsRequest>`

    case 'getSystemConfigurations':
      return `<web:allSystemConfigurationsRequest/>`

    case 'runTask': {
      const vars = (params.globalVariables || [])
        .map(v => `<variable name="${xe(v.name)}">${xe(v.value)}</variable>`)
        .join('\n      ')
      return `<web:runTaskRequest>
        <taskName>${xe(params.taskName)}</taskName>
        <description>${xe(params.description || '')}</description>
        ${params.agentName  ? `<agentName>${xe(params.agentName)}</agentName>` : ''}
        ${params.agentGroup ? `<agentGroup>${xe(params.agentGroup)}</agentGroup>` : ''}
        ${params.profileName ? `<profileName>${xe(params.profileName)}</profileName>` : ''}
        ${vars ? `<globalVariables>${vars}</globalVariables>` : ''}
      </web:runTaskRequest>`
    }

    case 'getTaskStatusByRunId2':
    case 'getTaskStatusByRunId':
      return `<web:taskStatusRequest><runId>${xe(params.runId)}</runId></web:taskStatusRequest>`

    case 'getAllExecutedTasks2':
    case 'getAllExecutedTasks': {
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
      return `<web:taskLogsRequest>
        <runID>${xe(params.runId)}</runID>
        <base64Encode>${params.base64Encode !== false ? 'true' : 'false'}</base64Encode>
        ${logBlock('traceLog',   params.traceLog)}
        ${logBlock('monitorLog', params.monitorLog)}
        ${logBlock('errorLog',   params.errorLog)}
      </web:taskLogsRequest>`
    }

    case 'cancelTask':
      return `<web:cancelTaskRequest><runId>${xe(params.runId)}</runId></web:cancelTaskRequest>`

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
      return xmlAll(xml, 'projects').map(p => ({
        name:        xmlVal(p, 'name'),
        guid:        xmlVal(p, 'guid'),
        description: xmlVal(p, 'description'),
      }))

    case 'getProjectTasks':
      return xmlAll(xml, 'tasks').map(t => ({
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
      let varElems = xmlAll(xml, 'globalVariable')
      if (varElems.length === 0) {
        const containers = xmlAll(xml, 'globalVariables')
        if (containers.length === 1) {
          const inner = xmlAll(containers[0], 'globalVariable')
          varElems = inner.length > 0 ? inner : xmlAll(containers[0], 'variable')
          if (varElems.length === 0) varElems = containers
        } else if (containers.length > 1) {
          varElems = containers
        }
      }
      if (varElems.length === 0) varElems = xmlAll(xml, 'variable')
      const vars = varElems.map(v => ({
        name:         xmlVal(v, 'name'),
        description:  xmlVal(v, 'description'),
        dataType:     xmlVal(v, 'dataType'),
        defaultValue: xmlVal(v, 'defaultValue'),
        length:       xmlVal(v, 'length'),
      })).filter(v => v.name)
      const propElems =
        xmlAll(xml, 'property').length > 0
          ? xmlAll(xml, 'property')
          : xmlAll(xml, 'properties')
      const props = propElems.map(p => ({
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
      return xmlAll(xml, 'agentGroups').map(g => ({
        name:        xmlVal(g, 'name'),
        guid:        xmlVal(g, 'guid'),
        description: xmlVal(g, 'description'),
        agents: xmlAll(g, 'agent').map(a => ({
          name:          xmlVal(a, 'name'),
          guid:          xmlVal(a, 'guid'),
          description:   xmlVal(a, 'description'),
          lastConnected: xmlVal(a, 'lastConnected'),
          version:       xmlVal(a, 'version'),
          agentStatus:   xmlVal(a, 'agentStatus'),
        })),
      }))

    case 'getSystemConfigurations':
      return xmlAll(xml, 'sysConfigurations').map(s => ({
        name:        xmlVal(s, 'name'),
        guid:        xmlVal(s, 'guid'),
        description: xmlVal(s, 'description'),
        dsConfigurations: xmlAll(s, 'dsConfiguration').map(d => ({
          dataStoreName:              xmlVal(d, 'dataStoreName'),
          dataStoreConfigurationName: xmlVal(d, 'dataStoreConfigurationName'),
        })),
      }))

    case 'runTask':
      return { runId: xmlVal(xml, 'RunID') || xmlVal(xml, 'runId') || xmlVal(xml, 'RunId') }

    case 'getTaskStatusByRunId2':
    case 'getTaskStatusByRunId': {
      const batchInfos = xmlAll(xml, 'uploadBatchInfos').map(b => ({
        id:        xmlVal(b, 'id'),
        name:      xmlVal(b, 'name'),
        startTime: xmlVal(b, 'startTime'),
      }))
      return {
        projectName:      xmlVal(xml, 'projectName'),
        jobId:            xmlVal(xml, 'jobId'),
        statusCode:       (xmlVal(xml, 'statusCode') || '').replace(/^TASK:/, ''),
        statusMsg:        xmlVal(xml, 'statusMsg'),
        startTime:        xmlVal(xml, 'startTime'),
        endTime:          xmlVal(xml, 'endTime'),
        executionTime:    xmlVal(xml, 'executionTime'),
        description:      xmlVal(xml, 'description'),
        uploadBatchInfos: batchInfos,
      }
    }

    case 'getAllExecutedTasks2':
    case 'getAllExecutedTasks': {
      const normalizeStatus = s => (s || '').replace(/^TASK:/, '')
      // Newer SAP format: <runId jobId="..." startDate="..." statusCode="TASK:SUCCESS" taskName="...">VALUE</runId>
      const runIdElems = xmlAll(xml, 'runId')
      if (runIdElems.length > 0) {
        return runIdElems.map(r => ({
          runId:      xmlVal(r, 'runId') || r.replace(/<[^>]+>/g, '').trim(),
          jobId:      xmlAttr(r, 'runId', 'jobId'),
          startDate:  xmlAttr(r, 'runId', 'startDate'),
          statusCode: normalizeStatus(xmlAttr(r, 'runId', 'statusCode')),
          taskName:   xmlAttr(r, 'runId', 'taskName'),
        }))
      }
      // Legacy format: <return jobId="..." ...>runId</return>
      return xmlAll(xml, 'return').map(r => ({
        runId:      xmlVal(r, 'return') || r.replace(/<[^>]+>/g, '').trim(),
        jobId:      xmlAttr(r, 'return', 'jobId'),
        startDate:  xmlAttr(r, 'return', 'startDate'),
        statusCode: normalizeStatus(xmlAttr(r, 'return', 'statusCode')),
        taskName:   xmlAttr(r, 'return', 'taskName'),
      }))
    }

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
export { xe, parseFault, buildEnvelope, soapCall, logon, buildBody, parseResponse }

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { connection, sessionId, operation, params = {} } = req.body || {}
  if (!connection?.hciUrl) return res.status(400).json({ error: 'connection.hciUrl requerido' })
  if (!sessionId)          return res.status(400).json({ error: 'sessionId requerido' })
  if (!operation)          return res.status(400).json({ error: 'operation requerido' })

  const { hciUrl, orgName, isProduction } = connection

  const soapActionMap = {
    getProjects:             'function=getAllProjects',
    getProjectTasks:         'function=getAllProjectTasks',
    getSystemConfigurations: 'function=getAllSystemConfigurations',
    getAgents:               'function=getAllAgents',
    logout:                  'function=logoff',
  }
  const soapAction = soapActionMap[operation] || `function=${operation}`
  const version = ['getAllExecutedTasks2', 'getTaskStatusByRunId2'].includes(operation) ? '2.0' : null
  const fallbackOperation = operation === 'getAllExecutedTasks2'
    ? 'getAllExecutedTasks'
    : operation === 'getTaskStatusByRunId2'
      ? 'getTaskStatusByRunId'
      : null

  try {
    let activeOperation = operation
    let activeSoapAction = soapAction
    let activeVersion = version
    let body = buildBody(activeOperation, params)
    let envelope = buildEnvelope(body, sessionId, activeVersion)
    let { ok, status, text } = await soapCall(hciUrl, activeSoapAction, envelope)

    // Some tenants expose non-v2 names only; retry automatically with alias.
    if (!ok && fallbackOperation) {
      const lower = text.toLowerCase()
      const unknownOp = lower.includes('unknown operation') || lower.includes('not recognized') || lower.includes('invalid function')
      if (unknownOp) {
        activeOperation = fallbackOperation
        activeSoapAction = `function=${activeOperation}`
        activeVersion = null
        body = buildBody(activeOperation, params)
        envelope = buildEnvelope(body, sessionId, activeVersion)
        ;({ ok, status, text } = await soapCall(hciUrl, activeSoapAction, envelope))
      }
    }

    if (!ok) {
      const fault = parseFault(text)
      const isSessionError = /session/i.test(fault?.faultCode || '') || /session/i.test(fault?.faultString || '')
      if (isSessionError) return res.status(401).json({ error: 'SESSION_EXPIRED' })
      return res.status(status).json({
        error: fault?.faultString || `SOAP error HTTP ${status}`,
        faultCode: fault?.faultCode,
        rawXml: fault ? undefined : text.slice(0, 2000),
      })
    }

    const result = parseResponse(activeOperation, text)
    if (params._debug) {
      return res.json({
        _result: result,
        _soapAction: activeSoapAction,
        _operation: activeOperation,
        _requestBodyXml: body,
        _requestEnvelopeXml: sanitizeSessionId(envelope),
        _rawXml: text,
      })
    }
    return res.json(result)

  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

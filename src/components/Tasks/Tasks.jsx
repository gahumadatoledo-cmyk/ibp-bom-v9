import { useState, useEffect, useCallback } from 'react'
import ProgressBar from '../ui/ProgressBar'
import TechLogs, { useTechLogs } from '../TechLogs'

async function soapCall(connectionId, operation, params = {}) {
  const res = await fetch('/api/soap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId, operation, params }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  if (data.error) throw new Error(data.error)
  return data
}

export default function Tasks({ connection }) {
  const [projects, setProjects]   = useState([])
  const [expanded, setExpanded]   = useState({})
  const [tasks, setTasks]         = useState({})     // projectGuid → tasks[]
  const [loadingP, setLoadingP]   = useState(true)
  const [loadingT, setLoadingT]   = useState({})
  const [error, setError]         = useState('')
  const [search, setSearch]       = useState('')
  const [runModal, setRunModal]   = useState(null)   // task object
  const [logs, addLog]            = useTechLogs()

  const load = useCallback(async () => {
    setLoadingP(true); setError('')
    const start = performance.now()
    try {
      const data = await soapCall(connection.id, 'getProjects')
      // Debug: backend wraps empty arrays with _rawXml for diagnosis
      const projects = Array.isArray(data) ? data : (data._data || [])
      const rawXml = data._rawXml || null
      addLog({ method: 'POST', path: 'getProjects', status: 200, duration: Math.round(performance.now() - start), detail: projects.length > 0 ? `${projects.length} proyectos` : `0 proyectos${rawXml ? ' · XML: ' + rawXml : ''}` })
      setProjects(projects)
    } catch (e) {
      addLog({ method: 'POST', path: 'getProjects', status: 0, duration: Math.round(performance.now() - start), detail: e.message })
      setError(e.message)
    } finally {
      setLoadingP(false)
    }
  }, [connection.id])

  useEffect(() => { load() }, [load])

  async function toggleProject(proj) {
    const guid = proj.guid
    if (expanded[guid]) { setExpanded(p => ({ ...p, [guid]: false })); return }
    setExpanded(p => ({ ...p, [guid]: true }))
    if (tasks[guid]) return
    setLoadingT(p => ({ ...p, [guid]: true }))
    const start = performance.now()
    try {
      const data = await soapCall(connection.id, 'getProjectTasks', { projectGuid: guid })
      addLog({ method: 'POST', path: 'getProjectTasks', status: 200, duration: Math.round(performance.now() - start), detail: `${data.length} tasks` })
      setTasks(p => ({ ...p, [guid]: Array.isArray(data) ? data : [] }))
    } catch (e) {
      addLog({ method: 'POST', path: 'getProjectTasks', status: 0, duration: Math.round(performance.now() - start), detail: e.message })
      setTasks(p => ({ ...p, [guid]: [] }))
    } finally {
      setLoadingT(p => ({ ...p, [guid]: false }))
    }
  }

  const filteredProjects = search.trim()
    ? projects.filter(p => {
        const q = search.toLowerCase()
        const matchProj = p.name?.toLowerCase().includes(q)
        const matchTask = (tasks[p.guid] || []).some(t => t.taskName?.toLowerCase().includes(q))
        return matchProj || matchTask
      })
    : projects

  return (
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box', position: 'relative' }}>
      <ProgressBar loading={loadingP} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexShrink: 0, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Projects & Tasks</div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
            {loadingP ? 'Cargando…' : `${projects.length} proyectos · ${connection.name}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text" placeholder="Buscar proyecto o task…" value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12, padding: '6px 12px', width: 240, outline: 'none' }}
          />
          <button onClick={load} disabled={loadingP} style={{
            background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 6,
            color: 'var(--text2)', fontSize: 11, fontWeight: 600, padding: '6px 12px', cursor: 'pointer',
          }}>↺ Refresh</button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(255,107,107,.1)', border: '1px solid rgba(255,107,107,.3)', borderRadius: 8, padding: '12px 16px', color: 'var(--red)', fontSize: 12, marginBottom: 14 }}>
          ✕ {error}
        </div>
      )}

      {/* Project tree */}
      <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        {filteredProjects.length === 0 && !loadingP ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text2)', fontSize: 12 }}>
            {search ? `Sin resultados para "${search}"` : 'Sin proyectos'}
          </div>
        ) : filteredProjects.map((proj, pi) => {
          const isExp = !!expanded[proj.guid]
          const projTasks = tasks[proj.guid] || []
          const isLoadingT = !!loadingT[proj.guid]
          const filteredTasks = search.trim()
            ? projTasks.filter(t => t.taskName?.toLowerCase().includes(search.toLowerCase()))
            : projTasks

          return (
            <div key={proj.guid} style={{ borderBottom: pi < filteredProjects.length - 1 ? '1px solid var(--border)' : 'none' }}>
              {/* Project row */}
              <div
                onClick={() => toggleProject(proj)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px',
                  cursor: 'pointer', background: isExp ? 'rgba(247,168,0,.05)' : 'transparent',
                  transition: 'background .15s',
                }}
                onMouseEnter={e => { if (!isExp) e.currentTarget.style.background = 'var(--bg2)' }}
                onMouseLeave={e => { if (!isExp) e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ color: 'var(--text3)', fontSize: 11, width: 14, textAlign: 'center', flexShrink: 0 }}>
                  {isLoadingT ? '…' : isExp ? '▾' : '▸'}
                </span>
                <span style={{ fontSize: 13, color: isExp ? 'var(--accent)' : '#fff', fontWeight: 600 }}>{proj.name}</span>
                {proj.description && (
                  <span style={{ fontSize: 11, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    — {proj.description}
                  </span>
                )}
                {isExp && projTasks.length > 0 && (
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>
                    {projTasks.length} tasks
                  </span>
                )}
              </div>

              {/* Tasks list */}
              {isExp && (
                <div style={{ borderTop: '1px solid var(--border)' }}>
                  {filteredTasks.length === 0 && !isLoadingT ? (
                    <div style={{ padding: '12px 40px', fontSize: 11, color: 'var(--text3)' }}>Sin tasks en este proyecto</div>
                  ) : filteredTasks.map((task, ti) => (
                    <TaskRow
                      key={task.taskGuid || ti}
                      task={task}
                      connectionId={connection.id}
                      onRun={() => setRunModal(task)}
                      isLast={ti === filteredTasks.length - 1}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <TechLogs logs={logs} />

      {/* Run modal */}
      {runModal && (
        <RunModal
          task={runModal}
          connectionId={connection.id}
          onClose={() => setRunModal(null)}
          onSuccess={() => setRunModal(null)}
          addLog={addLog}
        />
      )}
    </div>
  )
}

function TaskRow({ task, connectionId, onRun, isLast }) {
  const typeColor = task.type === 'PROCESS' ? 'var(--purple)' : 'var(--cyan)'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px 9px 40px',
      borderBottom: !isLast ? '1px solid var(--border)' : 'none',
      background: 'var(--bg)',
    }}>
      <span style={{
        fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 10,
        background: task.type === 'PROCESS' ? 'rgba(139,92,246,.15)' : 'rgba(6,182,212,.15)',
        color: typeColor, border: `1px solid ${typeColor}44`, flexShrink: 0, textTransform: 'uppercase',
      }}>{task.type || 'TASK'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.taskName}
        </div>
        {task.description && (
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {task.description}
          </div>
        )}
      </div>
      <button onClick={e => { e.stopPropagation(); onRun() }} style={{
        padding: '4px 12px', borderRadius: 5, border: '1px solid rgba(34,197,94,.35)',
        background: 'rgba(34,197,94,.08)', color: '#22c55e',
        fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
      }}>▶ Ejecutar</button>
    </div>
  )
}

function RunModal({ task, connectionId, onClose, onSuccess, addLog }) {
  const [step, setStep]           = useState('loading') // loading | form | running | done | error
  const [taskInfo, setTaskInfo]   = useState(null)
  const [agents, setAgents]       = useState([])
  const [profiles, setProfiles]   = useState([])
  const [agentName, setAgentName] = useState('')
  const [profileName, setProfileName] = useState('')
  const [varValues, setVarValues] = useState({})
  const [runId, setRunId]         = useState(null)
  const [errMsg, setErrMsg]       = useState('')

  useEffect(() => {
    async function init() {
      try {
        const [info, agentGroups, profs] = await Promise.all([
          soapCall(connectionId, 'getTaskInfo', { taskGuid: task.taskGuid }),
          soapCall(connectionId, 'getAgents', { activeOnly: true }),
          soapCall(connectionId, 'getSystemConfigurations'),
        ])
        setTaskInfo(info)
        // Flatten agents from groups
        const flatAgents = (Array.isArray(agentGroups) ? agentGroups : [])
          .flatMap(g => Array.isArray(g.agents) ? g.agents : [])
        setAgents(flatAgents)
        setProfiles(Array.isArray(profs) ? profs : [])
        // Pre-fill default values for variables
        const defaults = {}
        ;(info?.globalVariables || []).forEach(v => { defaults[v.name] = v.defaultValue || '' })
        setVarValues(defaults)
        setStep('form')
      } catch (e) {
        setErrMsg(e.message); setStep('error')
      }
    }
    init()
  }, [connectionId, task.taskGuid])

  async function handleRun() {
    setStep('running')
    const globalVariables = Object.entries(varValues)
      .filter(([, v]) => v !== '')
      .map(([name, value]) => ({ name, value }))
    const start = performance.now()
    try {
      const data = await soapCall(connectionId, 'runTask', {
        taskName: task.taskName,
        ...(agentName   ? { agentName }   : {}),
        ...(profileName ? { profileName } : {}),
        globalVariables,
      })
      addLog({ method: 'POST', path: 'runTask', status: 200, duration: Math.round(performance.now() - start), detail: `RunID: ${data.runId}` })
      setRunId(data.runId)
      setStep('done')
    } catch (e) {
      addLog({ method: 'POST', path: 'runTask', status: 0, duration: Math.round(performance.now() - start), detail: e.message })
      setErrMsg(e.message); setStep('error')
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500 }}>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 12, padding: 28, width: 'min(520px, 94vw)', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,.6)' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 4 }}>▶ Ejecutar task</div>
        <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 20 }}>{task.taskName}</div>

        {step === 'loading' && <div style={{ color: 'var(--text2)', fontSize: 12 }}>Cargando configuración…</div>}

        {step === 'form' && (
          <>
            {/* Agent selector */}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Agente (opcional)</label>
              <select value={agentName} onChange={e => setAgentName(e.target.value)} style={selectStyle}>
                <option value="">— Sin especificar —</option>
                {agents.map(a => (
                  <option key={a.guid} value={a.name}>{a.name} ({a.agentStatus?.replace('AGENT:', '')})</option>
                ))}
              </select>
            </div>

            {/* Profile selector */}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Configuración del sistema (opcional)</label>
              <select value={profileName} onChange={e => setProfileName(e.target.value)} style={selectStyle}>
                <option value="">— Sin especificar —</option>
                {profiles.map(p => (
                  <option key={p.guid} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Global variables */}
            {(taskInfo?.globalVariables || []).length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ ...labelStyle, marginBottom: 10 }}>Variables globales</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {taskInfo.globalVariables.map(v => (
                    <div key={v.name}>
                      <label style={{ ...labelStyle, color: 'var(--text2)' }}>{v.name}
                        {v.description && <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text3)', marginLeft: 6 }}>— {v.description}</span>}
                      </label>
                      <input
                        type="text"
                        value={varValues[v.name] || ''}
                        onChange={e => setVarValues(p => ({ ...p, [v.name]: e.target.value }))}
                        placeholder={v.defaultValue || `${v.dataType}`}
                        style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, padding: '7px 10px', width: '100%', boxSizing: 'border-box', outline: 'none' }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
              <button onClick={onClose} style={{ padding: '7px 18px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', color: 'var(--text2)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={handleRun} style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>▶ Ejecutar</button>
            </div>
          </>
        )}

        {step === 'running' && <div style={{ color: 'var(--text2)', fontSize: 12 }}>Enviando solicitud…</div>}

        {step === 'done' && (
          <div>
            <div style={{ color: 'var(--green)', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>✓ Task enviada</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 20 }}>
              RunID: <span style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>{runId}</span>
              <br />Puedes seguir el estado en la pestaña <strong>Task Monitor</strong>.
            </div>
            <button onClick={onSuccess} style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Cerrar</button>
          </div>
        )}

        {step === 'error' && (
          <div>
            <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 16 }}>✕ {errMsg}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={{ padding: '7px 18px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', color: 'var(--text2)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cerrar</button>
              <button onClick={() => setStep('loading')} style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: 'var(--bg3)', color: 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Reintentar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const labelStyle = { fontSize: 10, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: 5 }
const selectStyle = { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12, padding: '7px 10px', width: '100%', outline: 'none', cursor: 'pointer' }

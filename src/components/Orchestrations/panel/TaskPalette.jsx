import { useState, useEffect, useCallback } from 'react'

async function soapCall(connectionId, operation, params = {}) {
  const res = await fetch('/api/soap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId, operation, params }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

function DragChip({ task, style }) {
  function onDragStart(e) {
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData('application/x-orch-task', JSON.stringify({
      taskName: task.taskName,
      taskGuid: task.taskGuid,
      type: task.type,
    }))
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '5px 8px 5px 14px', cursor: 'grab',
        userSelect: 'none', transition: 'background .1s',
        ...style,
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <span style={{ fontSize: 9, color: 'var(--text3)', flexShrink: 0 }}>⠿</span>
      <span style={{
        fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 8, flexShrink: 0,
        background: task.type === 'PROCESS' ? 'rgba(139,92,246,.15)' : 'rgba(6,182,212,.15)',
        color: task.type === 'PROCESS' ? 'var(--purple)' : 'var(--cyan)',
        border: `1px solid ${task.type === 'PROCESS' ? 'rgba(139,92,246,.3)' : 'rgba(6,182,212,.3)'}`,
        textTransform: 'uppercase',
      }}>{task.type || 'TASK'}</span>
      <span style={{
        fontSize: 11, color: 'var(--text)', flex: 1,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }} title={task.taskName}>{task.taskName}</span>
    </div>
  )
}

export default function TaskPalette({ connection, onAddGroup, collapsed = false, onToggle }) {
  const [projects, setProjects]     = useState([])
  const [expanded, setExpanded]     = useState({})
  const [tasks, setTasks]           = useState({})
  const [loadingP, setLoadingP]     = useState(true)
  const [loadingT, setLoadingT]     = useState({})
  const [search, setSearch]         = useState('')

  useEffect(() => {
    soapCall(connection.id, 'getProjects')
      .then(data => setProjects(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingP(false))
  }, [connection.id])

  async function toggleProject(proj) {
    const guid = proj.guid
    if (expanded[guid]) { setExpanded(p => ({ ...p, [guid]: false })); return }
    setExpanded(p => ({ ...p, [guid]: true }))
    if (tasks[guid]) return
    setLoadingT(p => ({ ...p, [guid]: true }))
    try {
      const data = await soapCall(connection.id, 'getProjectTasks', { projectGuid: guid })
      setTasks(p => ({ ...p, [guid]: Array.isArray(data) ? data : [] }))
    } catch {
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

  if (collapsed) {
    return (
      <div
        onClick={onToggle}
        title="Expandir panel de tasks"
        style={{
          width: 28, flexShrink: 0, borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          background: 'var(--bg2)', cursor: 'pointer', userSelect: 'none',
          paddingTop: 12, gap: 8,
        }}
      >
        <span style={{ fontSize: 10, color: 'var(--text3)', writingMode: 'vertical-rl', letterSpacing: '0.1em', transform: 'rotate(180deg)' }}>
          TASKS
        </span>
        <span style={{ fontSize: 24, color: 'var(--text3)' }}>›</span>
      </div>
    )
  }

  return (
    <div style={{
      width: 210, flexShrink: 0, borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', background: 'var(--bg2)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Task Palette
          </div>
          <button
            onClick={onToggle}
            title="Contraer panel"
            style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '0 2px' }}
          >‹</button>
        </div>
        <input
          type="text"
          placeholder="Buscar tasks…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'var(--bg3)', border: '1px solid var(--border)',
            borderRadius: 5, color: 'var(--text)', fontSize: 11,
            padding: '5px 8px', outline: 'none',
          }}
        />
      </div>

      {/* Project tree */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loadingP ? (
          <div style={{ padding: '16px 12px', fontSize: 11, color: 'var(--text2)' }}>Cargando proyectos…</div>
        ) : filteredProjects.length === 0 ? (
          <div style={{ padding: '16px 12px', fontSize: 11, color: 'var(--text3)' }}>Sin proyectos</div>
        ) : filteredProjects.map(proj => {
          const isExp = !!expanded[proj.guid]
          const projTasks = tasks[proj.guid] || []
          const isLoadingT = !!loadingT[proj.guid]
          const filteredTasks = search.trim()
            ? projTasks.filter(t => t.taskName?.toLowerCase().includes(search.toLowerCase()))
            : projTasks

          return (
            <div key={proj.guid} style={{ borderBottom: '1px solid var(--border)' }}>
              <div
                onClick={() => toggleProject(proj)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 10px', cursor: 'pointer',
                  background: isExp ? 'rgba(247,168,0,.05)' : 'transparent',
                }}
                onMouseEnter={e => { if (!isExp) e.currentTarget.style.background = 'var(--bg3)' }}
                onMouseLeave={e => { if (!isExp) e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ color: 'var(--text3)', fontSize: 10, width: 12, textAlign: 'center', flexShrink: 0 }}>
                  {isLoadingT ? '…' : isExp ? '▾' : '▸'}
                </span>
                <span style={{
                  fontSize: 11, fontWeight: 600, color: isExp ? 'var(--accent)' : 'var(--text)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                }} title={proj.name}>{proj.name}</span>
              </div>

              {isExp && (
                <div>
                  {filteredTasks.length === 0 && !isLoadingT
                    ? <div style={{ padding: '6px 14px', fontSize: 10, color: 'var(--text3)' }}>Sin tasks</div>
                    : filteredTasks.map(t => (
                      <DragChip key={t.taskGuid || t.taskName} task={t} style={{}} />
                    ))
                  }
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Add group button */}
      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <button
          onClick={onAddGroup}
          style={{
            width: '100%', padding: '6px 8px', borderRadius: 6,
            border: '1px dashed rgba(41,171,226,.4)',
            background: 'rgba(41,171,226,.06)', color: 'var(--cyan)',
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}
        >
          + Nuevo grupo
        </button>
      </div>
    </div>
  )
}

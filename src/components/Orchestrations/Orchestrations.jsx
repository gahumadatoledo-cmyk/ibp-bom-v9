import { useState, useEffect, useRef, useCallback } from 'react'

const POLL_MS = 5000
const TERMINAL = new Set(['success', 'error', 'cancelled'])

const STEP_COLORS = {
  pending:             '#64748b',
  running:             '#3b82f6',
  success:             '#34d399',
  success_with_errors: '#fbbf24',
  error:               '#ff6b6b',
  cancelled:           '#94a3b8',
  skipped:             '#475569',
}

const RUN_COLORS = {
  running:   '#3b82f6',
  success:   '#34d399',
  error:     '#ff6b6b',
  cancelled: '#94a3b8',
}

const STRATEGY_LABELS = { stop: 'Detener', continue: 'Continuar', retry: 'Reintentar' }

// ─── Sub-components ────────────────────────────────────────────────────────────

function StepBadge({ status }) {
  const icons = {
    pending:             '○',
    running:             '◉',
    success:             '✓',
    success_with_errors: '⚠',
    error:               '✕',
    cancelled:           '⊘',
    skipped:             '–',
  }
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, color: STEP_COLORS[status] || '#64748b',
      fontFamily: 'var(--mono)', minWidth: 14, display: 'inline-block', textAlign: 'center',
    }}>
      {icons[status] || '○'}
    </span>
  )
}

function RunBadge({ status }) {
  const labels = { running: 'Ejecutando', success: 'Completado', error: 'Error', cancelled: 'Cancelado' }
  if (!status || status === 'idle') return null
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
      background: (RUN_COLORS[status] || '#64748b') + '22',
      color: RUN_COLORS[status] || '#64748b',
      border: `1px solid ${(RUN_COLORS[status] || '#64748b')}44`,
      fontFamily: 'var(--mono)', letterSpacing: '0.04em',
    }}>
      {labels[status] || status}
    </span>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function Orchestrations({ connection }) {
  const [orchs, setOrchs]         = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [run, setRun]             = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [saving, setSaving]       = useState(false)
  const [starting, setStarting]   = useState(false)
  const [cancelling, setCancelling] = useState(false)

  // Name editing
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue]     = useState('')
  const nameRef = useRef(null)

  // Add step panel
  const [showAddStep, setShowAddStep]     = useState(false)
  const [stepSearch, setStepSearch]       = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const searchTimer = useRef(null)

  // Step config expand
  const [expandedStep, setExpandedStep] = useState(null)

  // DnD
  const dragIdx   = useRef(null)
  const [dragOverIdx, setDragOverIdx] = useState(null)

  // Polling
  const pollRef = useRef(null)

  const selected  = orchs.find(o => o.id === selectedId)
  const isRunning = run?.status === 'running'

  // ─── Load orchestrations ──────────────────────────────────────────────────
  const loadOrchs = useCallback(async () => {
    try {
      const res = await fetch(`/api/orchestrations?connectionId=${connection.id}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setOrchs(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [connection.id])

  useEffect(() => { loadOrchs() }, [loadOrchs])

  // ─── Load run state on selection change ──────────────────────────────────
  useEffect(() => {
    if (!selectedId) { setRun(null); return }
    fetch(`/api/orchestrate?orchestrationId=${selectedId}`)
      .then(r => r.json())
      .then(setRun)
      .catch(() => setRun(null))
  }, [selectedId])

  // ─── Polling ──────────────────────────────────────────────────────────────
  const doTick = useCallback(async () => {
    if (!selectedId) return
    try {
      const res  = await fetch(`/api/orchestrate?orchestrationId=${selectedId}&action=tick`)
      const data = await res.json()
      setRun(data)
      if (data && TERMINAL.has(data.status)) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    } catch { /* silent */ }
  }, [selectedId])

  useEffect(() => {
    if (isRunning && !pollRef.current) {
      pollRef.current = setInterval(doTick, POLL_MS)
    } else if (!isRunning && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [isRunning, doTick])

  // ─── Orchestration CRUD ───────────────────────────────────────────────────
  async function createOrch() {
    const name = prompt('Nombre de la nueva orquestación:')?.trim()
    if (!name) return
    try {
      const res = await fetch('/api/orchestrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: connection.id, name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setOrchs(prev => [...prev, data])
      setSelectedId(data.id)
    } catch (e) { alert(e.message) }
  }

  async function deleteOrch(id) {
    if (!confirm('¿Eliminar esta orquestación?')) return
    try {
      const res = await fetch('/api/orchestrations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setOrchs(prev => prev.filter(o => o.id !== id))
      if (selectedId === id) setSelectedId(null)
    } catch (e) { alert(e.message) }
  }

  async function saveSteps(steps) {
    if (!selectedId) return
    setSaving(true)
    try {
      const res = await fetch('/api/orchestrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedId, steps }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setOrchs(prev => prev.map(o => o.id === selectedId ? data : o))
    } catch (e) { alert(e.message) }
    setSaving(false)
  }

  async function commitName() {
    if (!nameValue.trim() || !selectedId) { setEditingName(false); return }
    try {
      const res = await fetch('/api/orchestrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedId, name: nameValue }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setOrchs(prev => prev.map(o => o.id === selectedId ? data : o))
    } catch (e) { alert(e.message) }
    setEditingName(false)
  }

  // ─── Run controls ─────────────────────────────────────────────────────────
  async function handleStart() {
    if (!selectedId || isRunning || !selected?.steps.length) return
    setStarting(true)
    try {
      const res = await fetch('/api/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orchestrationId: selectedId, action: 'start' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setRun(data)
    } catch (e) { alert(e.message) }
    setStarting(false)
  }

  async function handleCancel() {
    if (!selectedId || !isRunning) return
    setCancelling(true)
    try {
      const res = await fetch('/api/orchestrate', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orchestrationId: selectedId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setRun(data)
    } catch (e) { alert(e.message) }
    setCancelling(false)
  }

  // ─── DnD ──────────────────────────────────────────────────────────────────
  function onDragStart(e, idx) {
    dragIdx.current = idx
    e.dataTransfer.effectAllowed = 'move'
  }
  function onDragOver(e, idx) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIdx(idx)
  }
  function onDrop(e, idx) {
    e.preventDefault()
    const from = dragIdx.current
    if (from === null || from === idx) { setDragOverIdx(null); return }
    const steps = [...selected.steps]
    const [moved] = steps.splice(from, 1)
    steps.splice(idx, 0, moved)
    setDragOverIdx(null)
    dragIdx.current = null
    saveSteps(steps)
  }
  function onDragEnd() { dragIdx.current = null; setDragOverIdx(null) }

  // ─── Step management ──────────────────────────────────────────────────────
  function triggerSearch(q) {
    clearTimeout(searchTimer.current)
    setStepSearch(q)
    if (!q.trim() || q.length < 2) { setSearchResults([]); return }
    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const res = await fetch('/api/soap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId: connection.id, operation: 'searchTasks', params: { nameFilter: q } }),
        })
        const data = await res.json()
        setSearchResults(Array.isArray(data) ? data : [])
      } catch { setSearchResults([]) }
      setSearchLoading(false)
    }, 400)
  }

  function addStep(task) {
    const steps = [...(selected?.steps || []), {
      taskName:        task.taskName,
      agentName:       null,
      profileName:     null,
      globalVariables: [],
      errorStrategy:   'stop',
      maxRetries:      0,
      retryDelaySec:   30,
    }]
    saveSteps(steps)
    setShowAddStep(false)
    setStepSearch('')
    setSearchResults([])
  }

  function removeStep(idx) {
    const steps = selected.steps.filter((_, i) => i !== idx)
    if (expandedStep === idx) setExpandedStep(null)
    saveSteps(steps)
  }

  function updateStep(idx, patch) {
    const steps = selected.steps.map((s, i) => i === idx ? { ...s, ...patch } : s)
    saveSteps(steps)
  }

  // ─── Computed run progress ────────────────────────────────────────────────
  function getRunStep(stepId) {
    return run?.steps.find(s => s.stepId === stepId) || null
  }

  function runProgress() {
    if (!run) return null
    const done = run.steps.filter(s => !['pending', 'running'].includes(s.status)).length
    return `${done}/${run.steps.length}`
  }

  // ─── Styles ───────────────────────────────────────────────────────────────
  const btn = (color, disabled) => ({
    padding: '6px 14px', borderRadius: 6, border: 'none',
    background: disabled ? 'var(--bg3)' : color + '22',
    color: disabled ? 'var(--text2)' : color,
    border: `1px solid ${disabled ? 'var(--border)' : color + '44'}`,
    fontSize: 11, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', transition: 'all .15s',
  })

  const input = {
    background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6,
    color: 'var(--text)', fontSize: 12, padding: '5px 10px',
    fontFamily: 'var(--font)', outline: 'none', width: '100%', boxSizing: 'border-box',
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ padding: 40, color: 'var(--text2)', fontSize: 12 }}>Cargando orquestaciones…</div>
  )

  if (error) return (
    <div style={{ padding: 40, color: '#ff6b6b', fontSize: 12 }}>{error}</div>
  )

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left panel: orchestration list ─────────────────────────────────── */}
      <div style={{
        width: 220, flexShrink: 0, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', background: 'var(--bg2)',
      }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Orquestaciones
          </span>
          <button onClick={createOrch} title="Nueva orquestación" style={{
            background: 'none', border: 'none', color: 'var(--accent)', fontSize: 18,
            cursor: 'pointer', lineHeight: 1, padding: 0,
          }}>+</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {orchs.length === 0 && (
            <div style={{ padding: '20px 14px', fontSize: 11, color: 'var(--text2)', textAlign: 'center' }}>
              Sin orquestaciones.<br />
              <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={createOrch}>Crear una</span>
            </div>
          )}
          {orchs.map(o => (
            <div
              key={o.id}
              onClick={() => setSelectedId(o.id)}
              style={{
                padding: '9px 14px', cursor: 'pointer', fontSize: 12,
                background: selectedId === o.id ? 'var(--bg3)' : 'transparent',
                borderLeft: selectedId === o.id ? '2px solid var(--accent)' : '2px solid transparent',
                color: selectedId === o.id ? 'var(--text)' : 'var(--text2)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                transition: 'all .1s',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
              <button
                onClick={e => { e.stopPropagation(); deleteOrch(o.id) }}
                title="Eliminar"
                style={{ background: 'none', border: 'none', color: '#ff6b6b44', cursor: 'pointer', fontSize: 14, padding: '0 0 0 6px', flexShrink: 0, lineHeight: 1 }}
                onMouseEnter={e => e.currentTarget.style.color = '#ff6b6b'}
                onMouseLeave={e => e.currentTarget.style.color = '#ff6b6b44'}
              >×</button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right panel: detail view ─────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selected ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>⚙</div>
              Selecciona una orquestación o crea una nueva
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>

            {/* Header: name + controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              {editingName ? (
                <input
                  ref={nameRef}
                  value={nameValue}
                  onChange={e => setNameValue(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={e => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setEditingName(false) }}
                  style={{ ...input, fontSize: 16, fontWeight: 700, width: 'auto', flex: 1 }}
                  autoFocus
                />
              ) : (
                <h2
                  onClick={() => { setEditingName(true); setNameValue(selected.name) }}
                  title="Click para editar"
                  style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: 0, cursor: 'text', flex: 1 }}
                >
                  {selected.name}
                </h2>
              )}

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {run && <RunBadge status={run.status} />}
                {isRunning && run && (
                  <span style={{ fontSize: 10, color: '#3b82f6', fontFamily: 'var(--mono)' }}>
                    {runProgress()}
                  </span>
                )}
                {saving && <span style={{ fontSize: 10, color: 'var(--text2)' }}>Guardando…</span>}

                <button
                  onClick={handleStart}
                  disabled={isRunning || !selected.steps.length || starting}
                  style={btn('#34d399', isRunning || !selected.steps.length || starting)}
                >
                  {starting ? 'Iniciando…' : '▶ Iniciar'}
                </button>

                {isRunning && (
                  <button
                    onClick={handleCancel}
                    disabled={cancelling}
                    style={btn('#ff6b6b', cancelling)}
                  >
                    {cancelling ? 'Cancelando…' : '■ Cancelar'}
                  </button>
                )}
              </div>
            </div>

            {/* Run status message */}
            {run && TERMINAL.has(run.status) && (
              <div style={{
                padding: '8px 12px', borderRadius: 6, marginBottom: 16, fontSize: 11,
                background: (RUN_COLORS[run.status] || '#64748b') + '11',
                border: `1px solid ${(RUN_COLORS[run.status] || '#64748b')}33`,
                color: RUN_COLORS[run.status] || '#64748b',
                fontFamily: 'var(--mono)',
              }}>
                {run.status === 'success' && `✓ Completado — ${run.startedAt ? new Date(run.startedAt).toLocaleString() : ''}`}
                {run.status === 'error'   && `✕ Error en paso ${run.steps.findIndex(s => s.status === 'error') + 1}`}
                {run.status === 'cancelled' && '⊘ Cancelado por el usuario'}
              </div>
            )}

            {/* Step list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {selected.steps.map((step, idx) => {
                const rs      = getRunStep(step.id)
                const isDragOver = dragOverIdx === idx
                const stepColor = STEP_COLORS[rs?.status || 'pending']

                return (
                  <div
                    key={step.id}
                    draggable={!isRunning}
                    onDragStart={e => onDragStart(e, idx)}
                    onDragOver={e => onDragOver(e, idx)}
                    onDrop={e => onDrop(e, idx)}
                    onDragEnd={onDragEnd}
                    style={{
                      background: 'var(--bg2)', border: `1px solid ${isDragOver ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 8, overflow: 'hidden',
                      transition: 'border-color .15s',
                      opacity: dragIdx.current === idx ? 0.5 : 1,
                    }}
                  >
                    {/* Step header row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' }}>
                      {/* Drag handle */}
                      {!isRunning && (
                        <span style={{ color: 'var(--text2)', cursor: 'grab', fontSize: 14, userSelect: 'none', flexShrink: 0 }}>⠿</span>
                      )}
                      {/* Step number */}
                      <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'var(--mono)', flexShrink: 0, minWidth: 16 }}>
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      {/* Status icon */}
                      <StepBadge status={rs?.status || 'pending'} />
                      {/* Task name */}
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {step.taskName}
                      </span>
                      {/* SAP run ID when running */}
                      {rs?.sapRunId && (
                        <span style={{ fontSize: 10, color: '#3b82f6', fontFamily: 'var(--mono)', flexShrink: 0 }}>
                          #{rs.sapRunId.slice(-8)}
                        </span>
                      )}
                      {/* Error strategy badge */}
                      <span style={{
                        fontSize: 9, padding: '1px 6px', borderRadius: 8, flexShrink: 0,
                        background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border)',
                        fontFamily: 'var(--mono)', letterSpacing: '0.04em',
                      }}>
                        {step.errorStrategy}
                      </span>
                      {/* Expand/collapse config (only when not running) */}
                      {!isRunning && (
                        <button
                          onClick={() => setExpandedStep(expandedStep === idx ? null : idx)}
                          style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 10, padding: 0, flexShrink: 0 }}
                        >
                          {expandedStep === idx ? '▲' : '▼'}
                        </button>
                      )}
                      {/* Remove */}
                      {!isRunning && (
                        <button
                          onClick={() => removeStep(idx)}
                          style={{ background: 'none', border: 'none', color: '#ff6b6b44', cursor: 'pointer', fontSize: 14, padding: 0, flexShrink: 0 }}
                          onMouseEnter={e => e.currentTarget.style.color = '#ff6b6b'}
                          onMouseLeave={e => e.currentTarget.style.color = '#ff6b6b44'}
                        >×</button>
                      )}
                    </div>

                    {/* Error message */}
                    {rs?.error && (
                      <div style={{ padding: '4px 12px 8px', fontSize: 10, color: '#ff6b6b', fontFamily: 'var(--mono)' }}>
                        {rs.error}
                      </div>
                    )}

                    {/* Retry info */}
                    {rs?.status === 'pending' && rs?.retryAt && (
                      <div style={{ padding: '4px 12px 8px', fontSize: 10, color: '#fbbf24', fontFamily: 'var(--mono)' }}>
                        Reintento en {new Date(rs.retryAt).toLocaleTimeString()} ({rs.retryCount} intentos)
                      </div>
                    )}

                    {/* Expanded config */}
                    {expandedStep === idx && !isRunning && (
                      <div style={{ borderTop: '1px solid var(--border)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          {/* Agent name */}
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 120 }}>
                            <span style={{ fontSize: 10, color: 'var(--text2)' }}>Agente (opcional)</span>
                            <input
                              style={input}
                              value={step.agentName || ''}
                              onChange={e => updateStep(idx, { agentName: e.target.value || null })}
                              placeholder="Nombre del agente"
                            />
                          </label>
                          {/* Profile name */}
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 120 }}>
                            <span style={{ fontSize: 10, color: 'var(--text2)' }}>Perfil (opcional)</span>
                            <input
                              style={input}
                              value={step.profileName || ''}
                              onChange={e => updateStep(idx, { profileName: e.target.value || null })}
                              placeholder="Nombre del perfil"
                            />
                          </label>
                        </div>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          {/* Error strategy */}
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 100 }}>
                            <span style={{ fontSize: 10, color: 'var(--text2)' }}>En caso de error</span>
                            <select
                              style={{ ...input, cursor: 'pointer' }}
                              value={step.errorStrategy}
                              onChange={e => updateStep(idx, { errorStrategy: e.target.value })}
                            >
                              <option value="stop">Detener orquestación</option>
                              <option value="continue">Continuar al siguiente</option>
                              <option value="retry">Reintentar</option>
                            </select>
                          </label>
                          {/* Retries (only when strategy = retry) */}
                          {step.errorStrategy === 'retry' && (
                            <>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 80 }}>
                                <span style={{ fontSize: 10, color: 'var(--text2)' }}>Máx reintentos</span>
                                <input
                                  type="number" min={1} max={5} style={input}
                                  value={step.maxRetries}
                                  onChange={e => updateStep(idx, { maxRetries: Number(e.target.value) })}
                                />
                              </label>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 100 }}>
                                <span style={{ fontSize: 10, color: 'var(--text2)' }}>Espera (seg)</span>
                                <input
                                  type="number" min={5} max={3600} style={input}
                                  value={step.retryDelaySec}
                                  onChange={e => updateStep(idx, { retryDelaySec: Number(e.target.value) })}
                                />
                              </label>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Empty state */}
              {selected.steps.length === 0 && !showAddStep && (
                <div style={{
                  padding: '24px', border: '1px dashed var(--border)', borderRadius: 8,
                  textAlign: 'center', color: 'var(--text2)', fontSize: 12,
                }}>
                  Sin pasos. Agrega tareas para construir la secuencia.
                </div>
              )}

              {/* Add step panel */}
              {!isRunning && (
                <div style={{ marginTop: 8 }}>
                  {!showAddStep ? (
                    <button
                      onClick={() => setShowAddStep(true)}
                      style={{
                        width: '100%', padding: '8px', borderRadius: 6, border: '1px dashed var(--border)',
                        background: 'transparent', color: 'var(--accent)', cursor: 'pointer',
                        fontSize: 12, transition: 'all .15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                    >
                      + Agregar tarea
                    </button>
                  ) : (
                    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <input
                          style={{ ...input, flex: 1 }}
                          placeholder="Buscar tarea por nombre (mín. 2 caracteres)…"
                          value={stepSearch}
                          onChange={e => triggerSearch(e.target.value)}
                          autoFocus
                        />
                        <button
                          onClick={() => { setShowAddStep(false); setStepSearch(''); setSearchResults([]) }}
                          style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 14 }}
                        >✕</button>
                      </div>

                      {searchLoading && (
                        <div style={{ fontSize: 11, color: 'var(--text2)', padding: '4px 0' }}>Buscando…</div>
                      )}

                      {searchResults.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 200, overflowY: 'auto' }}>
                          {searchResults.map(t => (
                            <div
                              key={t.taskGuid || t.taskName}
                              onClick={() => addStep(t)}
                              style={{
                                padding: '6px 10px', borderRadius: 5, cursor: 'pointer',
                                background: 'var(--bg3)', fontSize: 12, color: 'var(--text)',
                                display: 'flex', alignItems: 'center', gap: 8,
                                transition: 'background .1s',
                              }}
                              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                              onMouseLeave={e => e.currentTarget.style.background = 'var(--bg3)'}
                            >
                              <span style={{ fontSize: 9, color: 'var(--text2)', fontFamily: 'var(--mono)', flexShrink: 0 }}>
                                {t.type || 'TASK'}
                              </span>
                              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {t.taskName}
                              </span>
                              <span style={{ color: 'var(--accent)', fontSize: 16, flexShrink: 0 }}>+</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {!searchLoading && stepSearch.length >= 2 && searchResults.length === 0 && (
                        <div style={{ fontSize: 11, color: 'var(--text2)', padding: '4px 0' }}>Sin resultados.</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

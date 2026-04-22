import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import TechLogs, { useTechLogs } from '../TechLogs'
import ProgressBar from '../ui/ProgressBar'

const REFRESH_MS = 30000

const STATUS_META = {
  'RUNNING':               { label: 'Running',             bg: 'rgba(59,130,246,.15)',  color: '#3b82f6', border: 'rgba(59,130,246,.3)'  },
  'SUCCESS':               { label: 'Success',             bg: 'rgba(52,211,153,.15)',  color: '#34d399', border: 'rgba(52,211,153,.3)'  },
  'SUCCESS_WITH_ERRORS_D': { label: 'Success w/ errors D', bg: 'rgba(251,191,36,.15)',  color: '#fbbf24', border: 'rgba(251,191,36,.3)'  },
  'SUCCESS_WITH_ERRORS_E': { label: 'Success w/ errors E', bg: 'rgba(249,115,22,.15)',  color: '#f97316', border: 'rgba(249,115,22,.3)'  },
  'ERROR':                 { label: 'Error',               bg: 'rgba(255,107,107,.15)', color: '#ff6b6b', border: 'rgba(255,107,107,.3)' },
  'QUEUEING':              { label: 'Queueing',            bg: 'rgba(139,92,246,.15)',  color: '#8b5cf6', border: 'rgba(139,92,246,.3)'  },
  'IMPORTED':              { label: 'Imported',            bg: 'rgba(6,182,212,.15)',   color: '#06b6d4', border: 'rgba(6,182,212,.3)'   },
  'FETCHED':               { label: 'Fetched',             bg: 'rgba(6,182,212,.1)',    color: '#22d3ee', border: 'rgba(6,182,212,.2)'   },
  'TERMINATED':            { label: 'Terminated',          bg: 'rgba(156,163,175,.15)', color: '#9ca3af', border: 'rgba(156,163,175,.3)' },
  'TERMINATION_FAILED':    { label: 'Termination failed',  bg: 'rgba(249,115,22,.12)',  color: '#f97316', border: 'rgba(249,115,22,.25)' },
  'UNKNOWN':               { label: 'Unknown',             bg: 'rgba(75,85,99,.15)',    color: '#6b7280', border: 'rgba(75,85,99,.3)'    },
}

const CANCELABLE = new Set(['RUNNING', 'QUEUEING', 'IMPORTED', 'FETCHED'])

function fmtDate(epochMs) {
  if (!epochMs) return '—'
  try { return new Date(parseInt(epochMs)).toLocaleString() } catch { return epochMs }
}

function isoNow(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000)
  return d.toISOString().slice(0, 16)
}

function toIso(localDatetime) {
  if (!localDatetime) return undefined
  return new Date(localDatetime).toISOString()
}

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

export default function TaskMonitor({ connection }) {
  const [rows, setRows]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [activeStatus, setActive] = useState('ALL')
  const [search, setSearch]       = useState('')
  const [lastRefresh, setLast]    = useState(null)
  const [selectedRow, setSelected]= useState(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelMsg, setCancelMsg]   = useState('')
  const [logsModal, setLogsModal]   = useState(null) // runId
  const [colWidths, setColWidths]   = useState({})
  const resizing = useRef(null)
  const timerRef = useRef(null)
  const [logs, addLog] = useTechLogs()
  const addLogRef = useRef(addLog)
  addLogRef.current = addLog

  const [fromDate, setFromDate] = useState(() => isoNow(-7))
  const [toDate,   setToDate]   = useState(() => isoNow(0))

  const MAX_DAYS = 90
  const rangeDays = fromDate && toDate
    ? Math.round((new Date(toDate) - new Date(fromDate)) / 86400000)
    : null
  const rangeExceeded = rangeDays !== null && rangeDays > MAX_DAYS

  function handleFromChange(val) {
    setFromDate(val)
    if (val && toDate) {
      const diff = Math.round((new Date(toDate) - new Date(val)) / 86400000)
      if (diff > MAX_DAYS) setToDate(new Date(new Date(val).getTime() + MAX_DAYS * 86400000).toISOString().slice(0, 16))
    }
  }

  function handleToChange(val) {
    setToDate(val)
    if (val && fromDate) {
      const diff = Math.round((new Date(val) - new Date(fromDate)) / 86400000)
      if (diff > MAX_DAYS) setFromDate(new Date(new Date(val).getTime() - MAX_DAYS * 86400000).toISOString().slice(0, 16))
    }
  }

  const loadTasks = useCallback(async () => {
    if (rangeExceeded) { setError(`El rango no puede superar ${MAX_DAYS} días (SAP CI-DS limit)`); return }
    setLoading(true); setError('')
    const start = performance.now()
    try {
      const data = await soapCall(connection.id, 'getAllExecutedTasks2', {
        startDateFrom: toIso(fromDate),
        startDateTo:   toIso(toDate),
      })
      addLogRef.current({ method: 'POST', path: 'getAllExecutedTasks2', status: 200, duration: Math.round(performance.now() - start), detail: `${data.length} tasks` })
      setRows(Array.isArray(data) ? data : [])
      setLast(new Date())
    } catch (e) {
      addLogRef.current({ method: 'POST', path: 'getAllExecutedTasks2', status: 0, duration: Math.round(performance.now() - start), detail: e.message })
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [connection.id, fromDate, toDate])

  useEffect(() => {
    loadTasks()
    timerRef.current = setInterval(loadTasks, REFRESH_MS)
    return () => clearInterval(timerRef.current)
  }, [loadTasks])

  async function handleCancel() {
    if (!selectedRow) return
    if (!window.confirm(`¿Cancelar la ejecución de "${selectedRow.taskName}"?\n\nRunID: ${selectedRow.runId}`)) return
    setCancelling(true); setCancelMsg('')
    const start = performance.now()
    try {
      const data = await soapCall(connection.id, 'cancelTask', { runId: selectedRow.runId })
      addLog({ method: 'POST', path: 'cancelTask', status: 200, duration: Math.round(performance.now() - start), detail: data.status })
      setCancelMsg('ok')
      await loadTasks()
      setTimeout(() => { setSelected(null); setCancelMsg('') }, 2500)
    } catch (e) {
      addLog({ method: 'POST', path: 'cancelTask', status: 0, duration: Math.round(performance.now() - start), detail: e.message })
      setCancelMsg(e.message)
    } finally {
      setCancelling(false)
    }
  }

  const sorted = [...rows].sort((a, b) => {
    const av = parseInt(a.startDate) || 0, bv = parseInt(b.startDate) || 0
    return bv - av
  })

  const filteredBase = sorted.filter(r => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (r.taskName || '').toLowerCase().includes(q) ||
           (r.statusCode || '').toLowerCase().includes(q) ||
           String(r.runId || '').includes(q)
  })

  const countByStatus = {}
  filteredBase.forEach(r => { countByStatus[r.statusCode] = (countByStatus[r.statusCode] || 0) + 1 })

  const filtered = filteredBase.filter(r => activeStatus === 'ALL' || r.statusCode === activeStatus)

  const presentStatuses = [...new Set(filteredBase.map(r => r.statusCode).filter(Boolean))]

  const COLS = useMemo(() => [
    { key: 'statusCode', label: 'Estado',    w: 200, render: v => <StatusBadge code={v} /> },
    { key: 'taskName',   label: 'Task',      w: 280 },
    { key: 'startDate',  label: 'Inicio',    w: 180, render: v => fmtDate(v) },
    { key: 'runId',      label: 'RunID',     w: 120 },
    { key: 'jobId',      label: 'JobID',     w: 150 },
  ].map(c => ({ ...c, w: colWidths[c.key] ?? c.w })), [colWidths])

  function onResizeStart(col, e) {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX, startW = colWidths[col] ?? COLS.find(c => c.key === col)?.w ?? 140
    resizing.current = { col, startX, startW }
    function onMove(e) {
      if (!resizing.current) return
      const { col, startX, startW } = resizing.current
      setColWidths(w => ({ ...w, [col]: Math.max(60, startW + e.clientX - startX) }))
    }
    function onUp() {
      resizing.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const isCancelable = selectedRow && CANCELABLE.has(selectedRow.statusCode)

  return (
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box', position: 'relative' }}>
      <ProgressBar loading={loading || cancelling} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexShrink: 0, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Task Monitor</div>
          <div style={{ fontSize: 11, color: 'var(--text2)' }}>
            {loading ? 'Cargando…' : `${filtered.length} de ${rows.length} ejecuciones`}
            {lastRefresh && !loading && <span style={{ marginLeft: 8, opacity: .6 }}>· {lastRefresh.toLocaleTimeString()}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="datetime-local" value={fromDate} onChange={e => handleFromChange(e.target.value)} style={{ ...inputStyle, borderColor: rangeExceeded ? 'var(--red)' : undefined }} />
          <span style={{ color: 'var(--text2)', fontSize: 11 }}>→</span>
          <input type="datetime-local" value={toDate}   onChange={e => handleToChange(e.target.value)}   style={{ ...inputStyle, borderColor: rangeExceeded ? 'var(--red)' : undefined }} />
          {rangeDays !== null && (
            <span style={{ fontSize: 10, color: rangeExceeded ? 'var(--red)' : 'var(--text3)', fontWeight: rangeExceeded ? 700 : 400, whiteSpace: 'nowrap' }}>
              {rangeExceeded ? `⚠ máx ${MAX_DAYS}d` : `${rangeDays}d`}
            </span>
          )}
          <input type="text" placeholder="Buscar…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, width: 180 }} />
          <button onClick={loadTasks} disabled={loading} style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text2)', fontSize: 11, fontWeight: 600, padding: '6px 12px', cursor: 'pointer' }}>↺ Refresh</button>
          <span style={{ fontSize: 10, color: 'var(--text3)', padding: '4px 8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6 }}>🔄 Auto {REFRESH_MS / 1000}s</span>
        </div>
      </div>

      {/* Status filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexShrink: 0, flexWrap: 'wrap' }}>
        <FilterBtn active={activeStatus === 'ALL'} onClick={() => setActive('ALL')} label="Todos" count={filteredBase.length} meta={{ bg: 'rgba(59,130,246,.1)', color: '#3b82f6', border: 'rgba(59,130,246,.3)' }} />
        {presentStatuses.map(s => (
          <FilterBtn key={s} active={activeStatus === s} onClick={() => setActive(s)}
            label={STATUS_META[s]?.label || s} count={countByStatus[s] || 0} meta={STATUS_META[s] || STATUS_META['UNKNOWN']} />
        ))}
      </div>

      {error && <div style={{ background: 'rgba(255,107,107,.1)', border: '1px solid rgba(255,107,107,.3)', borderRadius: 8, padding: '12px 16px', color: 'var(--red)', fontSize: 12, marginBottom: 14 }}>✕ {error}</div>}

      {/* Table */}
      {!error && (
        <div style={{ overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, flex: 1 }}>
          <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: '100%', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg2)', position: 'sticky', top: 0, zIndex: 1 }}>
                {COLS.map(col => (
                  <th key={col.key} style={{ width: col.w, minWidth: col.w, padding: '9px 12px', textAlign: 'left', color: 'var(--text2)', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)', position: 'relative', userSelect: 'none' }}>
                    {col.label}
                    <span style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: 'col-resize' }} onMouseDown={e => onResizeStart(col.key, e)} onClick={e => e.stopPropagation()} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr><td colSpan={COLS.length} style={{ padding: '32px 12px', textAlign: 'center', color: 'var(--text2)' }}>Cargando…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={COLS.length} style={{ padding: '32px 12px', textAlign: 'center', color: 'var(--text2)' }}>Sin resultados</td></tr>
              ) : filtered.map((row, i) => {
                const isSel = selectedRow?.runId === row.runId
                return (
                  <tr key={row.runId || i} onClick={() => setSelected(isSel ? null : row)} style={{ background: isSel ? 'rgba(247,168,0,.08)' : i % 2 === 0 ? 'var(--bg)' : 'var(--bg2)', outline: isSel ? '1px solid rgba(247,168,0,.35)' : 'none', cursor: 'pointer' }}>
                    {COLS.map(col => (
                      <td key={col.key} style={{ padding: '7px 12px', color: isSel ? '#fff' : 'var(--text)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: col.w, maxWidth: col.w }} title={String(row[col.key] ?? '')}>
                        {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Action bar */}
      {selectedRow && (
        <div style={{ marginTop: 12, padding: '12px 16px', flexShrink: 0, background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 2 }}>Ejecución seleccionada</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {selectedRow.taskName}
              <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>RunID: {selectedRow.runId}</span>
            </div>
          </div>

          {cancelMsg === 'ok' && <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>✓ Cancelación enviada</span>}
          {cancelMsg && cancelMsg !== 'ok' && <span style={{ fontSize: 11, color: 'var(--red)', maxWidth: 280 }}>✕ {cancelMsg}</span>}

          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={() => setLogsModal(selectedRow.runId)} style={{ padding: '6px 16px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: '1px solid rgba(6,182,212,.4)', background: 'rgba(6,182,212,.1)', color: 'var(--cyan)', cursor: 'pointer' }}>
              📋 Ver logs
            </button>
            <button onClick={handleCancel} disabled={!isCancelable || cancelling}
              title={!isCancelable ? 'Solo se pueden cancelar tasks en ejecución/cola' : ''}
              style={{ padding: '6px 16px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: '1px solid rgba(255,107,107,.4)', background: isCancelable ? 'rgba(255,107,107,.12)' : 'transparent', color: isCancelable ? 'var(--red)' : 'var(--text3)', cursor: isCancelable ? 'pointer' : 'not-allowed', opacity: cancelling ? .6 : 1 }}>
              {cancelling ? 'Cancelando…' : '✕ Cancelar'}
            </button>
            <button onClick={() => { setSelected(null); setCancelMsg('') }} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600, border: '1px solid var(--border)', background: 'none', color: 'var(--text2)', cursor: 'pointer' }}>
              Deseleccionar
            </button>
          </div>
        </div>
      )}

      <TechLogs logs={logs} />

      {logsModal && (
        <LogsModal
          runId={logsModal}
          connectionId={connection.id}
          onClose={() => setLogsModal(null)}
        />
      )}
    </div>
  )
}

function StatusBadge({ code }) {
  const m = STATUS_META[code] || STATUS_META['UNKNOWN']
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: m.bg, color: m.color, border: `1px solid ${m.border}`, whiteSpace: 'nowrap' }}>
      {m.label}
    </span>
  )
}

function FilterBtn({ active, onClick, label, count, meta }) {
  return (
    <button onClick={onClick} style={{ padding: '4px 12px', borderRadius: 20, border: `1px solid ${active ? meta.border : 'var(--border)'}`, background: active ? meta.bg : 'transparent', color: active ? meta.color : 'var(--text2)', fontSize: 11, fontWeight: active ? 700 : 400, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all .15s' }}>
      {label}
      <span style={{ background: active ? meta.border : 'var(--border)', color: active ? meta.color : 'var(--text2)', borderRadius: 10, padding: '0 5px', fontSize: 10, fontWeight: 700 }}>{count}</span>
    </button>
  )
}

function LogsModal({ runId, connectionId, onClose }) {
  const [activeLog, setActiveLog] = useState('monitorLog')
  const [data, setData]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/soap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            connectionId, operation: 'getTaskLogs',
            params: { runId, traceLog: { getLog: true }, monitorLog: { getLog: true }, errorLog: { getLog: true } }
          }),
        })
        const d = await res.json()
        if (!res.ok || d.error) throw new Error(d.error || 'Error')
        setData(d)
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [runId, connectionId])

  const LOG_TABS = [
    { key: 'monitorLog', label: 'Monitor' },
    { key: 'traceLog',   label: 'Trace'   },
    { key: 'errorLog',   label: 'Error'   },
  ]

  const currentLog = data?.[activeLog]
  const lines = currentLog?.messageLines || []

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500 }}>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 12, width: 'min(720px, 95vw)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(0,0,0,.6)' }}>
        {/* Modal header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Logs de ejecución</div>
            <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 2 }}>RunID: {runId}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Log type tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 20px', flexShrink: 0 }}>
          {LOG_TABS.map(t => (
            <button key={t.key} onClick={() => setActiveLog(t.key)} style={{ padding: '8px 16px', fontSize: 12, background: 'none', border: 'none', borderBottom: activeLog === t.key ? '2px solid var(--accent)' : '2px solid transparent', color: activeLog === t.key ? 'var(--text)' : 'var(--text2)', fontWeight: activeLog === t.key ? 600 : 400, cursor: 'pointer' }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Log content */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {loading ? (
            <div style={{ color: 'var(--text2)', fontSize: 12 }}>Cargando logs…</div>
          ) : error ? (
            <div style={{ color: 'var(--red)', fontSize: 12 }}>✕ {error}</div>
          ) : lines.length === 0 ? (
            <div style={{ color: 'var(--text3)', fontSize: 12 }}>Sin contenido en este log</div>
          ) : (
            <pre style={{ margin: 0, fontSize: 11, color: 'var(--text)', fontFamily: 'var(--mono)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {lines.join('\n')}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

const inputStyle = {
  background: 'var(--bg2)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--text)', fontSize: 11, padding: '6px 10px', outline: 'none',
}

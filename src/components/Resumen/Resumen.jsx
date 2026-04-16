import { useState, useEffect, useCallback, useRef } from 'react'
import ProgressBar from '../ui/ProgressBar'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from 'recharts'
import TechLogs, { useTechLogs } from '../TechLogs'

const REFRESH_MS = 5 * 60 * 1000

const STATUS_COLORS = {
  'RUNNING':               '#3b82f6',
  'SUCCESS':               '#34d399',
  'SUCCESS_WITH_ERRORS_D': '#fbbf24',
  'SUCCESS_WITH_ERRORS_E': '#f97316',
  'ERROR':                 '#ff6b6b',
  'QUEUEING':              '#8b5cf6',
  'IMPORTED':              '#06b6d4',
  'FETCHED':               '#22d3ee',
  'TERMINATED':            '#9ca3af',
  'TERMINATION_FAILED':    '#ef4444',
  'UNKNOWN':               '#6b7280',
}

const STATUS_LABELS = {
  'RUNNING': 'Running', 'SUCCESS': 'Success',
  'SUCCESS_WITH_ERRORS_D': 'Success w/err D', 'SUCCESS_WITH_ERRORS_E': 'Success w/err E',
  'ERROR': 'Error', 'QUEUEING': 'Queueing', 'IMPORTED': 'Imported',
  'FETCHED': 'Fetched', 'TERMINATED': 'Terminated',
  'TERMINATION_FAILED': 'Termination failed', 'UNKNOWN': 'Unknown',
}

function isoNow(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 16)
}
function toIso(localDatetime) {
  if (!localDatetime) return undefined
  return new Date(localDatetime).toISOString()
}
function dayLabel(epochMs) {
  if (!epochMs) return '?'
  return new Date(parseInt(epochMs)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
function fmtDuration(mins) {
  if (mins < 1) return `${Math.round(mins * 60)}s`
  if (mins < 60) return `${Math.round(mins)} min`
  const h = Math.floor(mins / 60), m = Math.round(mins % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
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

export default function Resumen({ connection }) {
  const [rows, setRows]           = useState([])
  const [agents, setAgents]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [lastRefresh, setLast]    = useState(null)
  const timerRef = useRef(null)
  const [logs, addLog] = useTechLogs()
  const addLogRef = useRef(addLog)
  addLogRef.current = addLog

  const [fromDate, setFromDate] = useState(() => isoNow(-7))
  const [toDate,   setToDate]   = useState(() => isoNow(0))

  const loadData = useCallback(async () => {
    setLoading(true); setError('')
    const start = performance.now()
    try {
      const [tasks, agentGroups] = await Promise.all([
        soapCall(connection.id, 'getAllExecutedTasks2', {
          startDateFrom: toIso(fromDate),
          startDateTo:   toIso(toDate),
        }),
        soapCall(connection.id, 'getAgents', { activeOnly: false }),
      ])
      addLogRef.current({ method: 'POST', path: 'getAllExecutedTasks2 + getAgents', status: 200, duration: Math.round(performance.now() - start), detail: `${tasks.length} tasks` })
      setRows(Array.isArray(tasks) ? tasks : [])
      const flat = (Array.isArray(agentGroups) ? agentGroups : [])
        .flatMap(g => Array.isArray(g.agents) ? g.agents : [])
      setAgents(flat)
      setLast(new Date())
    } catch (e) {
      addLogRef.current({ method: 'POST', path: 'resumen', status: 0, duration: Math.round(performance.now() - start), detail: e.message })
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [connection.id, fromDate, toDate])

  useEffect(() => {
    loadData()
    timerRef.current = setInterval(loadData, REFRESH_MS)
    return () => clearInterval(timerRef.current)
  }, [loadData])

  // KPIs
  const total    = rows.length
  const running  = rows.filter(r => r.statusCode === 'RUNNING').length
  const queued   = rows.filter(r => ['QUEUEING','IMPORTED','FETCHED'].includes(r.statusCode)).length
  const success  = rows.filter(r => r.statusCode === 'SUCCESS').length
  const failed   = rows.filter(r => r.statusCode === 'ERROR').length
  const warnings = rows.filter(r => ['SUCCESS_WITH_ERRORS_D','SUCCESS_WITH_ERRORS_E'].includes(r.statusCode)).length
  const successRate = total > 0 ? Math.round(((success + warnings) / total) * 100) : 0

  // Donut
  const statusCount = {}
  rows.forEach(r => { statusCount[r.statusCode] = (statusCount[r.statusCode] || 0) + 1 })
  const donutData = Object.entries(statusCount)
    .map(([code, count]) => ({ name: STATUS_LABELS[code] || code, value: count, code }))
    .sort((a, b) => b.value - a.value)

  // Bar by day
  const dayMap = {}
  rows.forEach(r => {
    const d = dayLabel(r.startDate)
    if (!dayMap[d]) dayMap[d] = { day: d, Exitosas: 0, Fallidas: 0, Otras: 0 }
    if (r.statusCode === 'SUCCESS') dayMap[d].Exitosas++
    else if (r.statusCode === 'ERROR' || r.statusCode === 'TERMINATION_FAILED') dayMap[d].Fallidas++
    else dayMap[d].Otras++
  })
  const barData = Object.values(dayMap).sort((a, b) => a.day.localeCompare(b.day)).slice(-14)

  // Top tasks
  const taskMap = {}
  rows.forEach(r => { const k = r.taskName || '—'; taskMap[k] = (taskMap[k] || 0) + 1 })
  const topTasks = Object.entries(taskMap).sort((a, b) => b[1] - a[1]).slice(0, 5)

  // Recent failed
  const recentFailed = [...rows]
    .filter(r => r.statusCode === 'ERROR' || r.statusCode === 'TERMINATION_FAILED')
    .sort((a, b) => (parseInt(b.startDate) || 0) - (parseInt(a.startDate) || 0))
    .slice(0, 5)

  if (error) return (
    <div style={{ padding: 32 }}>
      <div style={{ background: 'rgba(255,107,107,.1)', border: '1px solid rgba(255,107,107,.3)', borderRadius: 8, padding: '12px 16px', color: 'var(--red)', fontSize: 12 }}>✕ {error}</div>
      <TechLogs logs={logs} />
    </div>
  )

  if (loading && rows.length === 0) return (
    <div style={{ padding: 32, color: 'var(--text2)', fontSize: 13, position: 'relative' }}>
      <ProgressBar loading />
      Cargando resumen de {connection.name}…
    </div>
  )

  return (
    <div style={{ padding: 28, overflowY: 'auto', height: '100%', boxSizing: 'border-box', position: 'relative' }}>
      <ProgressBar loading={loading} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Resumen</div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
            {connection.name} · {total} ejecuciones en el período
            {lastRefresh && !loading && <span style={{ marginLeft: 8, opacity: .6 }}>· {lastRefresh.toLocaleTimeString()}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="datetime-local" value={fromDate} onChange={e => setFromDate(e.target.value)} style={inputStyle} />
          <span style={{ color: 'var(--text2)', fontSize: 11 }}>→</span>
          <input type="datetime-local" value={toDate}   onChange={e => setToDate(e.target.value)}   style={inputStyle} />
          <button onClick={loadData} disabled={loading} style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text2)', fontSize: 11, fontWeight: 600, padding: '6px 12px', cursor: 'pointer' }}>↺ Refresh</button>
          <span style={{ fontSize: 10, color: 'var(--text3)', padding: '4px 8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6 }}>Auto-refresh 5 min</span>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid-kpi">
        <KpiCard label="Total ejecuciones" value={total}       color="var(--text)" />
        <KpiCard label="En ejecución"       value={running}    color="var(--cyan)" />
        <KpiCard label="En cola"            value={queued}     color="var(--purple)" />
        <KpiCard label="Exitosas"           value={success}    color="var(--green)" />
        <KpiCard label="Fallidas"           value={failed}     color="var(--red)" />
        <KpiCard label="Tasa de éxito"      value={`${successRate}%`} color={successRate >= 90 ? 'var(--green)' : successRate >= 70 ? 'var(--accent)' : 'var(--red)'} />
      </div>

      {/* Charts */}
      <div className="grid-charts">
        <div style={cardStyle}>
          <div style={cardTitle}>Distribución por estado</div>
          {donutData.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={donutData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} dataKey="value">
                  {donutData.map((entry, i) => <Cell key={i} fill={STATUS_COLORS[entry.code] || '#6b7280'} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 8 }}>
            {donutData.map((d, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text2)' }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: STATUS_COLORS[d.code] || '#6b7280', flexShrink: 0 }} />
                {d.name} ({d.value})
              </div>
            ))}
          </div>
        </div>

        <div style={cardStyle}>
          <div style={cardTitle}>Ejecuciones por día</div>
          {barData.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={barData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--text2)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text2)' }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text2)' }} />
                <Bar dataKey="Exitosas" stackId="a" fill="#34d399" />
                <Bar dataKey="Fallidas" stackId="a" fill="#ff6b6b" />
                <Bar dataKey="Otras"    stackId="a" fill="#6b7280" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Bottom grid */}
      <div className="grid-stats">
        <div style={cardStyle}>
          <div style={cardTitle}>Top tasks ejecutadas</div>
          {topTasks.length === 0 ? <Empty /> : topTasks.map(([name, count], i) => (
            <RankRow key={i} rank={i+1} label={name} count={count} max={topTasks[0][1]} color="var(--cyan)" />
          ))}
        </div>

        <div style={cardStyle}>
          <div style={cardTitle}>Últimas fallidas</div>
          {recentFailed.length === 0
            ? <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 8 }}>✓ Sin fallos en el período</div>
            : recentFailed.map((r, i) => (
              <div key={i} style={{ padding: '7px 0', borderBottom: i < recentFailed.length-1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--red)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.taskName || '—'}</div>
                <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 2, fontFamily: 'var(--mono)' }}>RunID: {r.runId}</div>
              </div>
            ))
          }
        </div>

        <div style={cardStyle}>
          <div style={cardTitle}>Agentes</div>
          {agents.length === 0 ? <Empty /> : agents.slice(0, 8).map((a, i) => {
            const status = a.agentStatus?.replace('AGENT:', '') || 'UNKNOWN'
            const color = status === 'CONNECTED' ? 'var(--green)' : status === 'MAINTENANCE' ? 'var(--accent)' : 'var(--text3)'
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: i < agents.length-1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <div style={{ flex: 1, fontSize: 11, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                <div style={{ fontSize: 10, color, fontWeight: 600, flexShrink: 0 }}>{status}</div>
              </div>
            )
          })}
        </div>

        <div style={cardStyle}>
          <div style={cardTitle}>Warnings</div>
          {warnings === 0
            ? <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 8 }}>✓ Sin warnings en el período</div>
            : rows.filter(r => ['SUCCESS_WITH_ERRORS_D','SUCCESS_WITH_ERRORS_E'].includes(r.statusCode)).slice(0, 5).map((r, i) => (
              <div key={i} style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.taskName || '—'}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{r.statusCode === 'SUCCESS_WITH_ERRORS_D' ? 'Éxito con errores (ignorados)' : 'Éxito con errores (críticos)'}</div>
              </div>
            ))
          }
        </div>
      </div>

      <TechLogs logs={logs} />
    </div>
  )
}

function KpiCard({ label, value, color }) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, color: 'var(--text2)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

function RankRow({ rank, label, count, max, color }) {
  const pct = max > 0 ? (count / max) * 100 : 0
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <div style={{ fontSize: 11, color: 'var(--text)', display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
          <span style={{ color: 'var(--text3)', fontWeight: 700, flexShrink: 0 }}>#{rank}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color, flexShrink: 0, marginLeft: 8 }}>{count}</span>
      </div>
      <div style={{ height: 3, background: 'var(--border)', borderRadius: 2 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width .4s' }} />
      </div>
    </div>
  )
}

function Empty() { return <div style={{ fontSize: 12, color: 'var(--text3)', padding: '16px 0' }}>Sin datos en el período</div> }

const cardStyle = { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px' }
const cardTitle = { fontSize: 11, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }
const inputStyle = { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11, padding: '6px 10px', outline: 'none' }

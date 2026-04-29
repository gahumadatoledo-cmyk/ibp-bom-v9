import { useState } from 'react'
import { STATUS_COLORS } from './canvasUtils'

async function soapCall(connection, sessionId, operation, params = {}) {
  const { hciUrl, orgName, isProduction } = connection
  const res = await fetch('/api/soap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connection: { hciUrl, orgName, isProduction }, sessionId, operation, params }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

const STATUS_LABEL = {
  pending: 'Pendiente', running: 'Ejecutando', success: 'Completado',
  error: 'Error', cancelled: 'Cancelado', skipped: 'Omitido',
  success_with_errors: 'Completado con errores',
}

function formatTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function duration(start, end) {
  if (!start) return '—'
  const ms = (end ? new Date(end) : new Date()) - new Date(start)
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

function StatusBadge({ status }) {
  const color = STATUS_COLORS[status] || '#64748b'
  return (
    <span style={{
      fontSize: 9, padding: '1px 6px', borderRadius: 8, fontFamily: 'var(--mono)', fontWeight: 700,
      background: color + '22', color, border: `1px solid ${color}44`, flexShrink: 0,
    }}>
      {STATUS_LABEL[status] || status}
    </span>
  )
}

function SapLogsButton({ connection, sessionId, sapRunId }) {
  const [logs, setLogs]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen]     = useState(false)

  async function toggle() {
    if (open) { setOpen(false); return }
    if (logs)  { setOpen(true); return }
    setLoading(true)
    try {
      const data = await soapCall(connection, sessionId, 'getTaskLogs', {
        runId: sapRunId, errorLog: true, monitorLog: true,
      })
      setLogs(data)
    } catch (e) {
      setLogs({ _error: e.message })
    }
    setLoading(false)
    setOpen(true)
  }

  return (
    <div style={{ marginTop: 4 }}>
      <button onClick={toggle} disabled={loading} style={{
        fontSize: 9, padding: '2px 6px', borderRadius: 4, cursor: loading ? 'default' : 'pointer',
        background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text3)',
      }}>
        {loading ? '…' : open ? 'ocultar logs' : '📄 Logs SAP'}
      </button>
      {open && logs && (
        <pre style={{
          marginTop: 5, padding: '6px 8px', borderRadius: 4, fontSize: 9,
          background: 'var(--bg)', color: 'var(--text2)', overflow: 'auto',
          maxHeight: 180, border: '1px solid var(--border)', fontFamily: 'var(--mono)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          {logs._error ? `Error: ${logs._error}` : JSON.stringify(logs, null, 2)}
        </pre>
      )}
    </div>
  )
}

function NodeRow({ ns, nodeDef, connection, sessionId, indent }) {
  const name = nodeDef?.data?.label || nodeDef?.data?.taskName || ns.nodeId
  const isGroup = ns.type === 'group'
  const typeColor = isGroup ? '#a78bfa' : '#29ABE2'
  const typeLabel = isGroup ? 'grupo' : 'task'

  return (
    <div style={{
      paddingLeft: indent ? 20 : 0,
      borderLeft: indent ? '2px solid var(--border2)' : 'none',
      marginLeft: indent ? 12 : 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '7px 0', borderBottom: '1px solid var(--border)',
      }}>
        <span style={{
          fontSize: 9, padding: '1px 5px', borderRadius: 8, flexShrink: 0,
          background: typeColor + '22', color: typeColor, border: `1px solid ${typeColor}44`,
          fontFamily: 'var(--mono)',
        }}>{typeLabel}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 80, wordBreak: 'break-word' }}>
          {name}
        </span>
        <StatusBadge status={ns.status} />
        <span style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--mono)', flexShrink: 0 }}>
          {formatTime(ns.startedAt)}
        </span>
        <span style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--mono)', flexShrink: 0 }}>
          {duration(ns.startedAt, ns.finishedAt)}
        </span>
        {ns.sapRunId && (
          <span style={{ fontSize: 9, color: '#3b82f6', fontFamily: 'var(--mono)', flexShrink: 0 }}>
            #{String(ns.sapRunId).slice(-6)}
          </span>
        )}
      </div>
      {ns.error && (
        <div style={{ padding: '3px 0 5px', fontSize: 9, color: 'var(--red)', fontFamily: 'var(--mono)', wordBreak: 'break-all' }}>
          {ns.error}
        </div>
      )}
      {ns.sapRunId && (
        <SapLogsButton connection={connection} sessionId={sessionId} sapRunId={ns.sapRunId} />
      )}
    </div>
  )
}

export default function RunLogModal({ run, connection, sessionId, nodes = [], onClose }) {
  const overallColor = STATUS_COLORS[run.status] || '#64748b'

  const topLevel = Object.values(run.nodes)
    .filter(ns => {
      const def = nodes.find(n => n.id === ns.nodeId)
      return !def?.parentId
    })
    .sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''))

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10,
        width: 'min(640px, 95vw)', maxHeight: '85vh',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Log de ejecución</span>
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 10, fontFamily: 'var(--mono)', fontWeight: 700,
              background: overallColor + '22', color: overallColor, border: `1px solid ${overallColor}44`,
            }}>{run.status}</span>
            <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
              {formatTime(run.startedAt)} · {duration(run.startedAt, run.finishedAt)}
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Timeline */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
          {topLevel.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>Sin nodos ejecutados</div>
          ) : topLevel.map(ns => {
            const nodeDef = nodes.find(n => n.id === ns.nodeId)
            const children = ns.type === 'group' && ns.children
              ? Object.values(ns.children).sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''))
              : []
            return (
              <div key={ns.nodeId} style={{ marginTop: 8 }}>
                <NodeRow ns={ns} nodeDef={nodeDef} connection={connection} sessionId={sessionId} indent={false} />
                {children.map(cs => {
                  const childDef = nodes.find(n => n.id === cs.nodeId)
                  return <NodeRow key={cs.nodeId} ns={cs} nodeDef={childDef} connection={connection} sessionId={sessionId} indent />
                })}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={onClose} style={{
            padding: '6px 18px', borderRadius: 6, fontSize: 11, fontWeight: 600,
            background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border)', cursor: 'pointer',
          }}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}

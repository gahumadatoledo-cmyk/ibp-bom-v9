import { useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { STATUS_COLORS, STATUS_ICONS } from '../canvasUtils'

const STRATEGY_COLOR = { stop: '#64748b', continue: '#fbbf24', retry: '#3b82f6' }
const STRATEGY_LABEL = { stop: 'error: detener', continue: 'error: continuar', retry: 'error: reintentar' }
const RUNNING_GREEN = '#22c55e'

export default function TaskNode({ data, selected, id }) {
  const [hovered, setHovered] = useState(false)
  const status  = data.runStatus || 'pending'
  const color   = STATUS_COLORS[status]
  const icon    = STATUS_ICONS[status]
  const isActive = status === 'running'

  return (
    <div
      onClick={() => data.onSelect?.(id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 210, background: isActive ? `${RUNNING_GREEN}12` : 'var(--bg2)',
        border: `1.5px solid ${selected ? 'var(--accent)' : isActive ? RUNNING_GREEN : 'var(--border2)'}`,
        borderRadius: 10, overflow: 'hidden', cursor: 'pointer',
        boxShadow: selected ? '0 0 0 2px rgba(247,168,0,.25)' : isActive ? '0 0 0 2px rgba(34,197,94,.25)' : 'none',
        transition: 'border-color .2s, box-shadow .2s',
        userSelect: 'none',
      }}
    >
      {/* Status bar */}
      <div style={{
        height: 3, background: color, transition: 'background .3s',
        ...(isActive ? { animation: 'shimmer 1.5s infinite' } : {}),
      }} />

      {/* Header */}
      <div style={{
        padding: '8px 10px 6px', background: isActive ? `${RUNNING_GREEN}18` : 'var(--bg3)',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ fontSize: 11, color, fontWeight: 700, flexShrink: 0, fontFamily: 'var(--mono)' }}>
          {icon}
        </span>
        <span style={{
          fontSize: 11, fontWeight: 700, color: 'var(--text)',
          flex: 1, wordBreak: 'break-word', lineHeight: 1.35,
        }}>
          {data.label || data.taskName}
        </span>
        {hovered && data.onRunSingle && (
          <button
            onClick={e => { e.stopPropagation(); data.onRunSingle(id) }}
            title="Ejecutar solo este task"
            style={{
              background: '#34d39922', border: '1px solid #34d39944', borderRadius: 4,
              color: '#34d399', fontSize: 9, fontWeight: 700, padding: '2px 5px',
              cursor: 'pointer', flexShrink: 0, lineHeight: 1,
            }}
          >▶</button>
        )}
      </div>

      {/* Details */}
      <div style={{ padding: '6px 10px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {(data.agentName || data.profileName) && (
          <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--mono)', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {data.agentName   && <span>agent: {data.agentName}</span>}
            {data.profileName && <span>profile: {data.profileName}</span>}
          </div>
        )}
        {(data.globalVariables || []).filter(v => v.name).length > 0 && (
          <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
            vars: {(data.globalVariables).filter(v => v.name).length}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{
            fontSize: 8, padding: '1px 5px', borderRadius: 6, fontFamily: 'var(--mono)',
            background: (STRATEGY_COLOR[data.errorStrategy] || '#64748b') + '22',
            color: STRATEGY_COLOR[data.errorStrategy] || '#64748b',
            border: `1px solid ${(STRATEGY_COLOR[data.errorStrategy] || '#64748b')}44`,
          }}>
            {STRATEGY_LABEL[data.errorStrategy] || STRATEGY_LABEL.stop}
            {data.errorStrategy === 'retry' && data.maxRetries ? ` ×${data.maxRetries}` : ''}
          </span>
          {data.sapRunId && (
            <span style={{ fontSize: 9, color: '#3b82f6', fontFamily: 'var(--mono)' }}>
              #{String(data.sapRunId).slice(-6)}
            </span>
          )}
        </div>
        {data.error && (
          <div style={{ fontSize: 9, color: 'var(--red)', fontFamily: 'var(--mono)', wordBreak: 'break-all' }}>
            {data.error}
          </div>
        )}
      </div>

      <Handle
        type="target" position={Position.Left}
        style={{ background: 'var(--border2)', width: 8, height: 8, border: '1.5px solid var(--text3)' }}
      />
      <Handle
        type="source" position={Position.Right}
        style={{ background: 'var(--accent)', width: 8, height: 8, border: '1.5px solid #c98800' }}
      />
    </div>
  )
}

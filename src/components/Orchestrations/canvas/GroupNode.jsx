import { Handle, Position, NodeResizer } from '@xyflow/react'
import { STATUS_COLORS, STATUS_ICONS } from '../canvasUtils'

export default function GroupNode({ data, selected, id }) {
  const status   = data.runStatus || 'pending'
  const color    = STATUS_COLORS[status]
  const icon     = STATUS_ICONS[status]
  const isActive = status === 'running'

  return (
    <div
      onClick={() => data.onSelect?.(id)}
      style={{
        width: '100%', height: '100%',
        background: `rgba(41,171,226,${isActive ? '0.08' : '0.04'})`,
        border: `1.5px dashed ${selected ? 'var(--accent)' : isActive ? '#3b82f6' : 'rgba(41,171,226,0.4)'}`,
        borderRadius: 12, cursor: 'pointer',
        transition: 'border-color .2s, background .2s',
        userSelect: 'none', boxSizing: 'border-box',
      }}
    >
      <NodeResizer
        minWidth={260} minHeight={140}
        isVisible={selected}
        lineStyle={{ border: '1px dashed var(--accent)' }}
        handleStyle={{ background: 'var(--accent)', width: 8, height: 8, borderRadius: 2 }}
      />

      {/* Header */}
      <div style={{
        padding: '6px 10px',
        display: 'flex', alignItems: 'center', gap: 6,
        borderBottom: `1px solid rgba(41,171,226,${selected ? '0.3' : '0.15'})`,
      }}>
        <span style={{ fontSize: 11, color, fontWeight: 700, fontFamily: 'var(--mono)', flexShrink: 0 }}>
          {isActive ? '◉' : '⊞'}
        </span>
        <span style={{
          fontSize: 11, fontWeight: 700, color: '#29ABE2',
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {data.label || 'Grupo paralelo'}
        </span>
        <span style={{
          fontSize: 9, padding: '1px 5px', borderRadius: 6,
          background: color + '22', color, border: `1px solid ${color}44`,
          fontFamily: 'var(--mono)', flexShrink: 0,
        }}>{icon}</span>
      </div>

      {/* Child summary */}
      {data.childSummary && (
        <div style={{ padding: '4px 10px', fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
          {data.childSummary}
        </div>
      )}

      {/* Handles */}
      <Handle
        type="target" position={Position.Left}
        style={{ background: 'var(--border2)', width: 8, height: 8, border: '1.5px solid var(--text3)', top: '50%' }}
      />
      <Handle
        type="source" position={Position.Right}
        style={{ background: 'var(--cyan)', width: 8, height: 8, border: '1.5px solid #1a7fa0', top: '50%' }}
      />
    </div>
  )
}

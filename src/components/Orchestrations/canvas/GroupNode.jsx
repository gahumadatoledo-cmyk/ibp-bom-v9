import { Handle, Position, NodeResizer } from '@xyflow/react'
import { STATUS_COLORS, STATUS_ICONS } from '../canvasUtils'

const MODE_STYLES = {
  parallel: { color: '#29ABE2', r: 41,  g: 171, b: 226, label: '⊞ En paralelo'   },
  serial:   { color: '#F7A800', r: 247, g: 168, b: 0,   label: '→ En secuencia'  },
  hybrid:   { color: '#8B5CF6', r: 139, g: 92,  b: 246, label: '⟛ Híbrido'       },
}

export default function GroupNode({ data, selected, id }) {
  const status   = data.runStatus || 'pending'
  const color    = STATUS_COLORS[status]
  const icon     = STATUS_ICONS[status]
  const isActive = status === 'running'

  const mode   = data.groupMode || 'parallel'
  const ms     = MODE_STYLES[mode] || MODE_STYLES.parallel
  const { r, g, b } = ms
  const modeColor  = ms.color
  const modeLabel  = ms.label
  const bg         = `rgba(${r},${g},${b},${isActive ? 0.08 : 0.04})`
  const borderColor = selected ? 'var(--accent)' : isActive ? '#3b82f6' : `rgba(${r},${g},${b},0.4)`
  const hBorder     = `rgba(${r},${g},${b},${selected ? 0.3 : 0.15})`

  return (
    <div
      onClick={() => data.onSelect?.(id)}
      style={{
        width: '100%', height: '100%',
        background: bg,
        border: `1.5px dashed ${borderColor}`,
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
        borderBottom: `1px solid ${hBorder}`,
      }}>
        <span style={{ fontSize: 11, color, fontWeight: 700, fontFamily: 'var(--mono)', flexShrink: 0 }}>
          {isActive ? '◉' : '⊞'}
        </span>
        <span style={{
          fontSize: 11, fontWeight: 700, color: modeColor,
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {data.label || 'Grupo'}
        </span>
        <span style={{
          fontSize: 9, padding: '1px 5px', borderRadius: 6,
          background: modeColor + '22', color: modeColor, border: `1px solid ${modeColor}44`,
          fontFamily: 'var(--mono)', flexShrink: 0, marginRight: 4,
        }}>{modeLabel}</span>
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

export default function OrchList({ orchs, selectedId, onSelect, onCreate, onDelete }) {
  return (
    <div style={{
      width: 220, flexShrink: 0, borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', background: 'var(--bg2)',
    }}>
      <div style={{
        padding: '12px 14px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Orquestaciones
        </span>
        <button onClick={onCreate} title="Nueva orquestación" style={{
          background: 'none', border: 'none', color: 'var(--accent)',
          fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 0,
        }}>+</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {orchs.length === 0 && (
          <div style={{ padding: '20px 14px', fontSize: 11, color: 'var(--text2)', textAlign: 'center' }}>
            Sin orquestaciones.<br />
            <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={onCreate}>Crear una</span>
          </div>
        )}
        {orchs.map(o => (
          <div
            key={o.id}
            onClick={() => onSelect(o.id)}
            style={{
              padding: '9px 14px', cursor: 'pointer', fontSize: 12,
              background: selectedId === o.id ? 'var(--bg3)' : 'transparent',
              borderLeft: selectedId === o.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: selectedId === o.id ? 'var(--text)' : 'var(--text2)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              transition: 'all .1s',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {o.name}
            </span>
            <button
              onClick={e => { e.stopPropagation(); onDelete(o.id) }}
              title="Eliminar"
              style={{ background: 'none', border: 'none', color: '#ff6b6b44', cursor: 'pointer', fontSize: 14, padding: '0 0 0 6px', flexShrink: 0, lineHeight: 1 }}
              onMouseEnter={e => e.currentTarget.style.color = '#ff6b6b'}
              onMouseLeave={e => e.currentTarget.style.color = '#ff6b6b44'}
            >×</button>
          </div>
        ))}
      </div>
    </div>
  )
}

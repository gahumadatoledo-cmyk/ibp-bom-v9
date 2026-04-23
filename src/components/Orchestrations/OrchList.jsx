import { useState } from 'react'

export default function OrchList({ orchs, selectedId, onSelect, onCreate, onDelete, connectionId, collapsed = false, onToggle }) {
  const FAVS_KEY = `ibp-favs-${connectionId}`
  const [favs, setFavs] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(FAVS_KEY) || '[]')) } catch { return new Set() }
  })

  function toggleFav(e, id) {
    e.stopPropagation()
    const next = new Set(favs)
    if (next.has(id)) next.delete(id); else next.add(id)
    setFavs(next)
    localStorage.setItem(FAVS_KEY, JSON.stringify([...next]))
  }

  const sorted = [...orchs].sort((a, b) => {
    const af = favs.has(a.id) ? 0 : 1
    const bf = favs.has(b.id) ? 0 : 1
    return af - bf
  })

  if (collapsed) {
    return (
      <div
        onClick={onToggle}
        title="Expandir panel de orquestaciones"
        style={{
          width: 28, flexShrink: 0, borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          background: 'var(--bg2)', cursor: 'pointer', userSelect: 'none',
          paddingTop: 12, gap: 8,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', writingMode: 'vertical-rl', letterSpacing: '0.1em', transform: 'rotate(180deg)', textTransform: 'uppercase' }}>
          Orch
        </span>
        <span style={{ fontSize: 24, color: 'var(--text2)' }}>›</span>
      </div>
    )
  }

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={onCreate} title="Nueva orquestación" style={{
            background: 'none', border: 'none', color: 'var(--accent)',
            fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 0,
          }}>+</button>
          <button onClick={onToggle} title="Contraer panel" style={{
            background: 'none', border: 'none', color: 'var(--text2)',
            fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '0 2px',
          }}>‹</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {orchs.length === 0 && (
          <div style={{ padding: '20px 14px', fontSize: 11, color: 'var(--text2)', textAlign: 'center' }}>
            Sin orquestaciones.<br />
            <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={onCreate}>Crear una</span>
          </div>
        )}
        {sorted.map(o => {
          const isFav = favs.has(o.id)
          return (
            <div
              key={o.id}
              onClick={() => onSelect(o.id)}
              style={{
                padding: '9px 14px', cursor: 'pointer', fontSize: 12,
                background: selectedId === o.id ? 'var(--bg3)' : 'transparent',
                borderLeft: selectedId === o.id ? '2px solid var(--accent)' : isFav ? '2px solid #f7a80066' : '2px solid transparent',
                color: selectedId === o.id ? 'var(--text)' : 'var(--text2)',
                display: 'flex', alignItems: 'center', gap: 4,
                transition: 'all .1s',
              }}
            >
              <button
                onClick={e => toggleFav(e, o.id)}
                title={isFav ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: 12,
                  color: isFav ? '#f7a800' : 'var(--border2)', padding: 0, flexShrink: 0,
                  lineHeight: 1, transition: 'color .1s',
                }}
              >★</button>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {o.name}
              </span>
              <button
                onClick={e => { e.stopPropagation(); onDelete(o.id) }}
                title="Eliminar"
                style={{ background: 'none', border: 'none', color: '#ff6b6b44', cursor: 'pointer', fontSize: 14, padding: '0 0 0 2px', flexShrink: 0, lineHeight: 1 }}
                onMouseEnter={e => e.currentTarget.style.color = '#ff6b6b'}
                onMouseLeave={e => e.currentTarget.style.color = '#ff6b6b44'}
              >×</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

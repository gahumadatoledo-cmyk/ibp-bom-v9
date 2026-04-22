import { useState, useEffect } from 'react'

const selectStyle = {
  background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text)', fontSize: 12, padding: '7px 10px', width: '100%',
  boxSizing: 'border-box', outline: 'none', cursor: 'pointer',
}
const labelStyle = {
  fontSize: 10, fontWeight: 700, color: 'var(--text2)',
  textTransform: 'uppercase', letterSpacing: '.06em',
  display: 'block', marginBottom: 5,
}

export default function RunModal({ connection, onConfirm, onClose }) {
  const [agents,  setAgents]  = useState([])
  const [configs, setConfigs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [selectedAgent,  setSelectedAgent]  = useState('')
  const [selectedConfig, setSelectedConfig] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const [agRes, cfRes] = await Promise.all([
          fetch('/api/soap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connectionId: connection.id, operation: 'getAgents', params: { activeOnly: false } }),
          }),
          fetch('/api/soap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connectionId: connection.id, operation: 'getSystemConfigurations', params: {} }),
          }),
        ])
        const agData = await agRes.json()
        const cfData = await cfRes.json()
        const connected = (agData.agents || []).filter(a => a.status === 'CONNECTED')
        setAgents(connected)
        setConfigs(cfData.configurations || cfData.systemConfigurations || [])
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [connection.id])

  function handleConfirm() {
    onConfirm(selectedAgent || null, selectedConfig || null)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.55)', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border)',
        borderRadius: 10, width: 360, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 16px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Iniciar orquestación</div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
              Selecciona los valores por defecto para esta ejecución
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: 16 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text2)', fontSize: 12, padding: '20px 0' }}>
              Cargando agentes y configuraciones…
            </div>
          ) : error ? (
            <div style={{ color: 'var(--red)', fontSize: 12, padding: '10px 0' }}>{error}</div>
          ) : (
            <>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Agente por defecto</label>
                <select style={selectStyle} value={selectedAgent} onChange={e => setSelectedAgent(e.target.value)}>
                  <option value="">— Sin agente específico —</option>
                  {agents.map(a => (
                    <option key={a.name} value={a.name}>{a.name}</option>
                  ))}
                </select>
                {agents.length === 0 && (
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>No hay agentes conectados</div>
                )}
              </div>

              <div style={{ marginBottom: 6 }}>
                <label style={labelStyle}>Configuración de sistema</label>
                <select style={selectStyle} value={selectedConfig} onChange={e => setSelectedConfig(e.target.value)}>
                  <option value="">— Sin configuración específica —</option>
                  {configs.map(c => (
                    <option key={c.name || c.id} value={c.name || c.id}>{c.name || c.id}</option>
                  ))}
                </select>
              </div>

              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 10, lineHeight: 1.5 }}>
                Los nodos sin agente o perfil configurado usarán estos valores.
                Los nodos con valores propios los conservan.
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 16px', borderTop: '1px solid var(--border)',
          display: 'flex', gap: 8, justifyContent: 'flex-end',
        }}>
          <button onClick={onClose} style={{
            padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600,
            background: 'var(--bg3)', color: 'var(--text2)',
            border: '1px solid var(--border)', cursor: 'pointer',
          }}>
            Cancelar
          </button>
          <button onClick={handleConfirm} disabled={loading}
            style={{
              padding: '6px 16px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: loading ? 'var(--bg3)' : '#34d39922',
              color: loading ? 'var(--text2)' : '#34d399',
              border: `1px solid ${loading ? 'var(--border)' : '#34d39944'}`,
              cursor: loading ? 'default' : 'pointer',
            }}>
            ▶ Iniciar
          </button>
        </div>
      </div>
    </div>
  )
}

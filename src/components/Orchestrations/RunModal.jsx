import { useState, useEffect } from 'react'

async function soapCall(connectionId, operation, params = {}) {
  const res = await fetch('/api/soap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId, operation, params }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

const selectStyle = {
  background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text)', fontSize: 12, padding: '7px 10px', width: '100%',
  boxSizing: 'border-box', outline: 'none', cursor: 'pointer',
}
const inputStyle = {
  background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text)', fontSize: 12, padding: '7px 10px', width: '100%',
  boxSizing: 'border-box', outline: 'none',
}
const labelStyle = {
  fontSize: 10, fontWeight: 700, color: 'var(--text2)',
  textTransform: 'uppercase', letterSpacing: '.06em',
  display: 'block', marginBottom: 5,
}

function FieldRow({ label, count, rawData, children }) {
  const [showRaw, setShowRaw] = useState(false)
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <label style={labelStyle}>{label}</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, color: count === 0 ? '#f97316' : 'var(--text3)', fontFamily: 'var(--mono)' }}>
            {count} encontrado{count !== 1 ? 's' : ''}
          </span>
          {rawData !== null && (
            <button onClick={() => setShowRaw(v => !v)} style={{
              fontSize: 9, padding: '1px 5px', borderRadius: 4, cursor: 'pointer',
              background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text3)',
            }}>
              {showRaw ? 'ocultar' : 'raw'}
            </button>
          )}
        </div>
      </div>
      {children}
      {showRaw && (
        <pre style={{
          marginTop: 6, padding: '6px 8px', borderRadius: 6, fontSize: 9,
          background: 'var(--bg)', color: 'var(--text2)', overflow: 'auto',
          maxHeight: 120, border: '1px solid var(--border)', fontFamily: 'var(--mono)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          {JSON.stringify(rawData, null, 2)}
        </pre>
      )}
    </div>
  )
}

export default function RunModal({ connection, onConfirm, onClose }) {
  const [agents,     setAgents]     = useState([])
  const [configs,    setConfigs]    = useState([])
  const [rawAgents,  setRawAgents]  = useState(null)
  const [rawConfigs, setRawConfigs] = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)

  const [selectedAgent,  setSelectedAgent]  = useState('')
  const [selectedConfig, setSelectedConfig] = useState('')
  const [manualAgent,    setManualAgent]    = useState('')
  const [manualConfig,   setManualConfig]   = useState('')
  const [useManual,      setUseManual]      = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const [agentGroups, profs] = await Promise.all([
          soapCall(connection.id, 'getAgents', { activeOnly: false }),
          soapCall(connection.id, 'getSystemConfigurations'),
        ])
        setRawAgents(agentGroups)
        setRawConfigs(profs)
        const flat = (Array.isArray(agentGroups) ? agentGroups : [])
          .flatMap(g => Array.isArray(g.agents) ? g.agents : [])
        setAgents(flat)
        setConfigs(Array.isArray(profs) ? profs : [])
        if (flat.length === 0) setUseManual(true)
      } catch (e) {
        setError(e.message)
        setUseManual(true)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [connection.id])

  function handleConfirm() {
    const agent  = useManual ? (manualAgent.trim() || null)  : (selectedAgent  || null)
    const config = useManual ? (manualConfig.trim() || null) : (selectedConfig || null)
    onConfirm(agent, config)
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border)',
        borderRadius: 10, width: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
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
              Agente y configuración por defecto para nodos sin valores propios
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: 16 }}>
          {loading && (
            <div style={{ textAlign: 'center', color: 'var(--text2)', fontSize: 12, padding: '24px 0' }}>
              Cargando agentes y configuraciones…
            </div>
          )}

          {!loading && error && (
            <div style={{ marginBottom: 12 }}>
              <div style={{
                padding: '8px 10px', borderRadius: 6, fontSize: 11,
                background: 'rgba(255,107,107,.08)', border: '1px solid rgba(255,107,107,.2)',
                color: 'var(--red)', lineHeight: 1.5, marginBottom: 8,
              }}>
                Error al cargar desde SAP: {error}
              </div>
            </div>
          )}

          {!loading && (
            <>
              {/* Toggle manual / dropdown */}
              {!error && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                  <button onClick={() => setUseManual(v => !v)} style={{
                    fontSize: 9, padding: '2px 7px', borderRadius: 4, cursor: 'pointer',
                    background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)',
                  }}>
                    {useManual ? '← Usar dropdown' : 'Escribir manualmente →'}
                  </button>
                </div>
              )}

              {/* Agente */}
              <FieldRow label="Agente" count={agents.length} rawData={rawAgents}>
                {useManual ? (
                  <input
                    style={inputStyle}
                    value={manualAgent}
                    onChange={e => setManualAgent(e.target.value)}
                    placeholder="Nombre del agente (dejar vacío para default)"
                  />
                ) : (
                  <select style={selectStyle} value={selectedAgent} onChange={e => setSelectedAgent(e.target.value)}>
                    <option value="">— Sin agente específico —</option>
                    {agents.map(a => (
                      <option key={a.guid || a.name} value={a.name}>
                        {a.name}{a.agentStatus && a.agentStatus !== 'CONNECTED' ? ` (${a.agentStatus})` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </FieldRow>

              {/* Configuración */}
              <FieldRow label="Configuración de sistema" count={configs.length} rawData={rawConfigs}>
                {useManual ? (
                  <input
                    style={inputStyle}
                    value={manualConfig}
                    onChange={e => setManualConfig(e.target.value)}
                    placeholder="Nombre del perfil (dejar vacío para default)"
                  />
                ) : (
                  <select style={selectStyle} value={selectedConfig} onChange={e => setSelectedConfig(e.target.value)}>
                    <option value="">— Sin configuración específica —</option>
                    {configs.map(c => (
                      <option key={c.guid || c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                )}
              </FieldRow>

              <div style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1.5 }}>
                Si dejas ambos vacíos, SAP usará el agente y configuración por defecto del sistema.
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
          <button
            onClick={handleConfirm}
            disabled={loading}
            style={{
              padding: '6px 18px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: loading ? 'var(--bg3)' : '#34d39922',
              color: loading ? 'var(--text2)' : '#34d399',
              border: `1px solid ${loading ? 'var(--border)' : '#34d39944'}`,
              cursor: loading ? 'default' : 'pointer',
            }}
          >
            ▶ Iniciar
          </button>
        </div>
      </div>
    </div>
  )
}

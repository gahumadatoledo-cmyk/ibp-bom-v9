import { useState, useEffect } from 'react'

async function soapCall(connectionId, operation, params = {}) {
  const res = await fetch('/api/soap', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
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
const labelStyle = {
  fontSize: 10, fontWeight: 700, color: 'var(--text2)',
  textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 5,
}

export default function RunSingleModal({ connection, node, onClose }) {
  const [agents,      setAgents]      = useState([])
  const [configs,     setConfigs]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [running,     setRunning]     = useState(false)
  const [result,      setResult]      = useState(null)
  const [error,       setError]       = useState(null)
  const [agentName,   setAgentName]   = useState(node.data.agentName || '')
  const [profileName, setProfileName] = useState(node.data.profileName || '')

  useEffect(() => {
    Promise.all([
      soapCall(connection.id, 'getAgents', { activeOnly: false }),
      soapCall(connection.id, 'getSystemConfigurations'),
    ]).then(([agentGroups, profs]) => {
      const flat = (Array.isArray(agentGroups) ? agentGroups : [])
        .flatMap(g => Array.isArray(g.agents) ? g.agents : [])
      setAgents(flat)
      setConfigs(Array.isArray(profs) ? profs : [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [connection.id])

  async function handleRun() {
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const vars = (node.data.globalVariables || []).filter(v => v.name.trim())
      const res = await soapCall(connection.id, 'runTask', {
        taskName:        node.data.taskName,
        agentName:       agentName  || null,
        profileName:     profileName || null,
        globalVariables: vars,
      })
      setResult(res)
    } catch (e) {
      setError(e.message)
    }
    setRunning(false)
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10,
        width: 360, boxShadow: '0 8px 32px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Ejecutar task individual</div>
            <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 2, fontFamily: 'var(--mono)' }}>
              {node.data.taskName}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: 16 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text2)', fontSize: 12, padding: '20px 0' }}>Cargando…</div>
          ) : (
            <>
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Agente ({agents.length} disponibles)</label>
                <select style={selectStyle} value={agentName} onChange={e => setAgentName(e.target.value)}>
                  <option value="">— Default del sistema —</option>
                  {agents.map(a => (
                    <option key={a.guid || a.name} value={a.name}>{a.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Configuración ({configs.length} disponibles)</label>
                <select style={selectStyle} value={profileName} onChange={e => setProfileName(e.target.value)}>
                  <option value="">— Default del sistema —</option>
                  {configs.map(c => (
                    <option key={c.guid || c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>

              {(node.data.globalVariables || []).filter(v => v.name).length > 0 && (
                <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 6, background: 'var(--bg3)', border: '1px solid var(--border)', fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
                  Variables: {(node.data.globalVariables || []).filter(v => v.name).map(v => `${v.name}=${v.value || '""'}`).join(', ')}
                </div>
              )}

              {result && (
                <div style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(52,211,153,.08)', border: '1px solid rgba(52,211,153,.25)', fontSize: 11, color: '#34d399' }}>
                  Iniciado — RunID: <span style={{ fontFamily: 'var(--mono)' }}>{result.runId}</span>
                </div>
              )}
              {error && (
                <div style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(255,107,107,.08)', border: '1px solid rgba(255,107,107,.2)', fontSize: 11, color: 'var(--red)' }}>
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border)', cursor: 'pointer' }}>
            {result ? 'Cerrar' : 'Cancelar'}
          </button>
          {!result && (
            <button onClick={handleRun} disabled={loading || running} style={{
              padding: '6px 18px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: (loading || running) ? 'var(--bg3)' : '#34d39922',
              color: (loading || running) ? 'var(--text2)' : '#34d399',
              border: `1px solid ${(loading || running) ? 'var(--border)' : '#34d39944'}`,
              cursor: (loading || running) ? 'default' : 'pointer',
            }}>
              {running ? 'Iniciando…' : '▶ Ejecutar'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

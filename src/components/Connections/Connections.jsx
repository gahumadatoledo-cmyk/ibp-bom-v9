import { useState } from 'react'
import ConnectionForm from './ConnectionForm'
import ConnectionAvatar from './ConnectionAvatar'
import SapLoginModal from './SapLoginModal'
import TechLogs, { useTechLogs } from '../TechLogs'

export default function Connections({ connections, onAdd, onUpdate, onDelete, onSelect }) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [testTarget, setTestTarget] = useState(null) // conn being tested via login modal
  const [testResult, setTestResult] = useState({})
  const [logs, addLog] = useTechLogs()

  function handleEdit(conn) {
    setEditing(conn)
    setShowForm(true)
  }

  function handleNew() {
    setEditing(null)
    setShowForm(true)
  }

  function handleSave(conn) {
    if (editing) {
      onUpdate(conn)
    } else {
      onAdd(conn)
    }
    setShowForm(false)
    setEditing(null)
  }

  function handleDelete(id, name) {
    if (!confirm(`¿Eliminar la conexión "${name}"?`)) return
    onDelete(id)
  }

  function handleTest(conn) {
    setTestTarget(conn)
  }

  function handleTestSuccess(conn, sessionId) {
    const start = performance.now()
    const duration = Math.round(performance.now() - start)
    addLog({ method: 'POST', path: `sap-login (${conn.name})`, status: 200, duration, detail: 'Conexión exitosa' })
    setTestResult(p => ({ ...p, [conn.id]: 'ok' }))
    setTestTarget(null)
    // store sessionId for when user opens this connection
    sessionStorage.setItem(`sap_${conn.id}`, sessionId)
  }

  function handleTestCancel() {
    setTestTarget(null)
  }

  return (
    <div style={{ padding: 28, maxWidth: 900 }}>
      {/* Title */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>Conexiones</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3 }}>
            Gestiona los sistemas SAP CI-DS — las conexiones se guardan en este navegador
          </div>
        </div>
        <button onClick={handleNew} style={{
          background: 'var(--accent)', border: 'none', borderRadius: 7,
          color: '#000', fontWeight: 700, fontSize: 12, padding: '8px 18px',
        }}>
          + Nueva conexión
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ marginBottom: 24 }}>
          <ConnectionForm
            initial={editing}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditing(null) }}
          />
        </div>
      )}

      {/* Empty state */}
      {connections.length === 0 && !showForm && (
        <div style={{
          background: 'var(--bg2)', border: '1px dashed var(--border2)', borderRadius: 10,
          padding: '48px 24px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚡</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
            No hay conexiones configuradas
          </div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 20 }}>
            Agrega un sistema SAP CI-DS para empezar a gestionar tasks
          </div>
          <button onClick={handleNew} style={{
            background: 'var(--accent)', border: 'none', borderRadius: 7,
            color: '#000', fontWeight: 700, fontSize: 12, padding: '8px 18px',
          }}>
            + Nueva conexión
          </button>
        </div>
      )}

      {/* Connection cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {connections.map(conn => (
          <div key={conn.id} style={{
            background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '16px 20px',
            display: 'flex', alignItems: 'center', gap: 16,
          }}>
            <ConnectionAvatar name={conn.name} logoUrl={conn.logoUrl} size={40} />

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: '#fff', fontSize: 14 }}>{conn.name} ({conn.isProduction ? 'Productivo' : 'Sandbox'})</div>
              {conn.hciUrl && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conn.hciUrl}</div>}
            </div>

            {testResult[conn.id] && (
              <div style={{
                fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                background: testResult[conn.id] === 'ok' ? 'rgba(52,211,153,.15)' : 'rgba(255,107,107,.15)',
                color: testResult[conn.id] === 'ok' ? 'var(--green)' : 'var(--red)',
                border: `1px solid ${testResult[conn.id] === 'ok' ? 'rgba(52,211,153,.3)' : 'rgba(255,107,107,.3)'}`,
              }}>
                {testResult[conn.id] === 'ok' ? '✓ Conectado' : '✕ Error'}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button onClick={() => onSelect(conn.id)} style={btnStyle('var(--cyan)')}>Abrir</button>
              <button onClick={() => handleTest(conn)} style={btnStyle('var(--text2)')}>Probar</button>
              <button onClick={() => handleEdit(conn)} style={btnStyle('var(--text2)')}>Editar</button>
              <button onClick={() => handleDelete(conn.id, conn.name)} style={btnStyle('var(--red)')}>Eliminar</button>
            </div>
          </div>
        ))}
      </div>

      {testTarget && (
        <SapLoginModal
          connection={testTarget}
          onSuccess={sid => handleTestSuccess(testTarget, sid)}
          onCancel={handleTestCancel}
        />
      )}

      <TechLogs logs={logs} />
    </div>
  )
}

function btnStyle(color) {
  return {
    background: 'none', border: `1px solid ${color}33`,
    borderRadius: 6, color, fontSize: 11, fontWeight: 600,
    padding: '5px 12px', transition: 'all .15s',
  }
}

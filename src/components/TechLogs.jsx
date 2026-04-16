import { useState } from 'react'

export function useTechLogs() {
  const [logs, setLogs] = useState([])
  function addLog(entry) {
    setLogs(p => [{ ...entry, ts: Date.now() }, ...p].slice(0, 50))
  }
  return [logs, addLog]
}

export default function TechLogs({ logs }) {
  if (!logs || logs.length === 0) return null
  return (
    <div style={{ marginTop: 24, fontSize: 11, color: 'var(--text2)' }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Log de actividad</div>
      {logs.map((l, i) => (
        <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
          [{l.method}] {l.path} — {l.status} ({l.duration}ms) {l.detail}
        </div>
      ))}
    </div>
  )
}

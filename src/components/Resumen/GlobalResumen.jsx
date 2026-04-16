export default function GlobalResumen({ connections }) {
  return (
    <div style={{ padding: '2rem', color: 'var(--text)' }}>
      <h2>Resumen Global</h2>
      <p>En construcción — {connections.length} conexión(es)</p>
    </div>
  )
}

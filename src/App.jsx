import { useState, useEffect } from 'react'
import Header from './components/Header'
import Sidebar from './components/Sidebar/Sidebar'
import Connections from './components/Connections/Connections'
import SystemView from './components/System/SystemView'
import GlobalResumen from './components/Resumen/GlobalResumen'
import './App.css'

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 640)
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth <= 640)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return isMobile
}

const LS_KEY = 'ibp_connections'

function loadConnections() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') } catch { return [] }
}
function persistConnections(conns) {
  localStorage.setItem(LS_KEY, JSON.stringify(conns))
}

export default function App() {
  const [connections, setConnections] = useState(() => loadConnections())
  const [activeId, setActiveId] = useState('connections')
  const [sidebarExpanded, setSidebarExpanded] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false) // mobile drawer
  const isMobile = useIsMobile()

  // Auto-collapse sidebar when switching to mobile
  useEffect(() => {
    if (isMobile) setSidebarExpanded(false)
  }, [isMobile])

  function addConnection(conn) {
    const newConn = { ...conn, id: crypto.randomUUID() }
    const updated = [...connections, newConn]
    setConnections(updated)
    persistConnections(updated)
  }

  function updateConnection(conn) {
    const updated = connections.map(c => c.id === conn.id ? conn : c)
    setConnections(updated)
    persistConnections(updated)
  }

  function deleteConnection(id) {
    if (activeId === id) setActiveId('connections')
    const updated = connections.filter(c => c.id !== id)
    setConnections(updated)
    persistConnections(updated)
  }

  function handleSelect(id) {
    setActiveId(id)
    if (isMobile) setSidebarOpen(false)
  }

  const activeConn = connections.find(c => c.id === activeId)

  function renderMain() {
    if (activeId === 'connections') {
      return (
        <Connections
          connections={connections}
          onAdd={addConnection}
          onUpdate={updateConnection}
          onDelete={deleteConnection}
          onSelect={handleSelect}
        />
      )
    }
    if (activeId === 'resumen-general') {
      return <GlobalResumen connections={connections} />
    }
    if (activeConn) {
      return <SystemView connection={activeConn} />
    }
    return null
  }

  return (
    <>
      <Header onMenuToggle={isMobile ? () => setSidebarOpen(p => !p) : null} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>

        {/* Backdrop for mobile drawer */}
        <div
          className={`sidebar-backdrop${sidebarOpen ? ' open' : ''}`}
          onClick={() => setSidebarOpen(false)}
        />

        <Sidebar
          connections={connections}
          activeId={activeId}
          onSelect={handleSelect}
          expanded={sidebarExpanded}
          onToggle={() => setSidebarExpanded(p => !p)}
          loading={false}
          isMobile={isMobile}
          mobileOpen={sidebarOpen}
        />

        <main style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }}>
          {renderMain()}
        </main>
      </div>

      <div style={{
        position: 'fixed', bottom: 10, right: 14,
        fontSize: 10, color: 'var(--text2)', opacity: 0.45,
        fontFamily: 'monospace', pointerEvents: 'none', userSelect: 'none',
        zIndex: 9999,
      }}>
        v{__APP_VERSION__}
      </div>
    </>
  )
}

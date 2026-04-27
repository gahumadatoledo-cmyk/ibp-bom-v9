import { useState } from 'react'
import Tasks from '../Tasks/Tasks'
import TaskMonitor from '../Tasks/TaskMonitor'
import Resumen from '../Resumen/Resumen'
import Orchestrations from '../Orchestrations/Orchestrations'
import ConnectionAvatar from '../Connections/ConnectionAvatar'

const TABS = [
  { id: 'resumen',        label: 'Resumen'          },
  { id: 'tasks',          label: 'Projects & Tasks'  },
  { id: 'monitor',        label: 'Task Monitor'      },
  { id: 'orchestrations', label: 'Orquestaciones'    },
]

export default function SystemView({ connection }) {
  const [activeTab, setActiveTab]           = useState('resumen')
  const [headerCollapsed, setHeaderCollapsed] = useState(false)
  const [pendingTaskName, setPendingTaskName] = useState(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* System header — colapsable */}
      {!headerCollapsed && (
        <div style={{
          background: 'var(--bg2)', borderBottom: '1px solid var(--border)',
          padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0,
        }}>
          <ConnectionAvatar name={connection.name} logoUrl={connection.logoUrl} size={34} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: '#fff', fontSize: 14 }}>{connection.name}</div>
            <div style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'var(--mono)', marginTop: 1 }}>
              {connection.serviceUrl} · {connection.orgName} · {connection.isProduction ? 'Producción' : 'Sandbox'}
            </div>
          </div>
          <button
            onClick={() => setHeaderCollapsed(true)}
            title="Contraer cabecera"
            style={{
              background: 'none', border: 'none', color: 'var(--text3)',
              cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '2px 4px',
              borderRadius: 4, flexShrink: 0,
            }}
          >▴</button>
        </div>
      )}

      {/* Sub-tabs */}
      <div style={{
        display: 'flex', gap: 0, borderBottom: '1px solid var(--border)',
        background: 'var(--bg2)', padding: '0 16px', flexShrink: 0, alignItems: 'center',
      }}>
        {/* Mini-avatar visible solo cuando la cabecera está colapsada */}
        {headerCollapsed && (
          <button
            onClick={() => setHeaderCollapsed(false)}
            title={`${connection.name} — expandir cabecera`}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '0 8px 0 0', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
            }}
          >
            <ConnectionAvatar name={connection.name} logoUrl={connection.logoUrl} size={20} />
            <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>▾</span>
          </button>
        )}

        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '10px 16px', fontSize: 12, background: 'none', border: 'none',
            borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
            color: activeTab === tab.id ? 'var(--text)' : 'var(--text2)',
            fontWeight: activeTab === tab.id ? 600 : 400,
            cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap',
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {activeTab === 'resumen'        && <Resumen         connection={connection} />}
        {activeTab === 'tasks'          && <Tasks            connection={connection} onTaskRun={(name) => { setPendingTaskName(name); setActiveTab('monitor') }} />}
        {activeTab === 'monitor'        && <TaskMonitor      connection={connection} initialSearch={pendingTaskName} onSearchConsumed={() => setPendingTaskName(null)} />}
        {activeTab === 'orchestrations' && <Orchestrations   connection={connection} />}
      </div>
    </div>
  )
}

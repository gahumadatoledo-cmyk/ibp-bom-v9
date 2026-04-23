import { useState, useRef } from 'react'
import OrchList              from './OrchList'
import TaskPalette           from './panel/TaskPalette'
import OrchestrationsCanvas  from './canvas/OrchestrationsCanvas'
import NodeConfigPanel       from './canvas/NodeConfigPanel'
import RunModal              from './RunModal'
import RunSingleModal        from './RunSingleModal'
import RunLogModal           from './RunLogModal'
import { useOrchestration }  from './useOrchestration'
import { STATUS_COLORS }     from './canvasUtils'

function RunBadge({ status }) {
  const labels = { running: 'Ejecutando', success: 'Completado', error: 'Error', cancelled: 'Cancelado' }
  if (!status || status === 'idle') return null
  const color = STATUS_COLORS[status] || '#64748b'
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
      background: color + '22', color, border: `1px solid ${color}44`,
      fontFamily: 'var(--mono)',
    }}>
      {labels[status] || status}
    </span>
  )
}

export default function Orchestrations({ connection }) {
  const {
    orchs, loading, error, selected, selectedId, setSelectedId,
    run, isRunning, saving, starting, cancelling,
    createOrch, deleteOrch, saveGraph, commitName,
    handleStart, handleCancel,
  } = useOrchestration(connection)

  const [selectedNodeId, setSelectedNodeId]   = useState(null)
  const [editingName, setEditingName]         = useState(false)
  const [nameValue, setNameValue]             = useState('')
  const [showRunModal, setShowRunModal]       = useState(false)
  const [showLogModal, setShowLogModal]       = useState(false)
  const [lastRunParams, setLastRunParams]     = useState(null)
  const [runSingleNode, setRunSingleNode]     = useState(null)
  const [paletteCollapsed, setPaletteCollapsed]   = useState(false)
  const [orchListCollapsed, setOrchListCollapsed] = useState(false)
  const [orphanWarning, setOrphanWarning]         = useState(null)
  const [autoConnect, setAutoConnect]             = useState(false)
  const [fullscreen, setFullscreen]               = useState(false)
  const addGroupRef = useRef(() => {})
  const canvasRef   = useRef(null)

  function handleRunSingle(nodeId) {
    const node = selected?.nodes?.find(n => n.id === nodeId)
    if (node) setRunSingleNode(node)
  }

  const selectedNode = selected?.nodes?.find(n => n.id === selectedNodeId) || null

  function checkBeforeRun() {
    const nodes = selected?.nodes || []
    const hasGroups = nodes.some(n => !n.parentId && n.type === 'group')
    if (!hasGroups) return true
    const orphans = nodes.filter(n => !n.parentId && n.type === 'task')
    if (orphans.length > 0) {
      const names = orphans.map(n => n.data?.label || n.data?.taskName || 'Task').join(', ')
      setOrphanWarning(`Tasks fuera de grupo: ${names}`)
      setTimeout(() => setOrphanWarning(null), 6000)
      return false
    }
    return true
  }

  function handleNodeUpdate(nodeId, patch) {
    if (!selected) return
    if (patch === null) {
      canvasRef.current?.deleteNode(nodeId)
      const newNodes = selected.nodes.filter(n => n.id !== nodeId && n.parentId !== nodeId)
      const newEdges = selected.edges.filter(e => e.source !== nodeId && e.target !== nodeId)
      saveGraph(newNodes, newEdges)
      setSelectedNodeId(null)
      return
    }
    canvasRef.current?.patchNodeData(nodeId, patch)
    const newNodes = selected.nodes.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)
    saveGraph(newNodes, selected.edges)
  }

  if (loading) return <div style={{ padding: 40, color: 'var(--text2)', fontSize: 12 }}>Cargando orquestaciones…</div>
  if (error)   return <div style={{ padding: 40, color: 'var(--red)', fontSize: 12 }}>{error}</div>

  const hasNodes = (selected?.nodes?.filter(n => !n.parentId).length || 0) > 0
  const doneSteps = run ? Object.values(run.nodes || {}).filter(ns => !['pending','running'].includes(ns.status)).length : 0
  const totalSteps = run ? Object.values(run.nodes || {}).length : 0

  // ── Canvas + toolbar section (shared between normal and fullscreen) ──────────
  const canvasSection = selected && (
    <>
      {/* Task palette */}
      <TaskPalette
        connection={connection}
        onAddGroup={() => addGroupRef.current?.()}
        collapsed={paletteCollapsed}
        onToggle={() => setPaletteCollapsed(v => !v)}
      />

      {/* Canvas area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Toolbar */}
        <div style={{
          padding: '8px 14px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
          background: 'var(--bg2)', flexWrap: 'wrap',
        }}>
          {/* Fullscreen exit button (prominent, leftmost when in fullscreen) */}
          {fullscreen && (
            <button
              onClick={() => setFullscreen(false)}
              style={{
                ...actionBtn('#a78bfa', false),
                fontWeight: 700, fontSize: 13, padding: '5px 12px',
              }}
              title="Salir de pantalla completa (Esc)"
            >
              ✕ Salir
            </button>
          )}

          {/* Editable name */}
          {editingName ? (
            <input
              value={nameValue}
              autoFocus
              onChange={e => setNameValue(e.target.value)}
              onBlur={() => { commitName(nameValue); setEditingName(false) }}
              onKeyDown={e => {
                if (e.key === 'Enter')  { commitName(nameValue); setEditingName(false) }
                if (e.key === 'Escape') setEditingName(false)
              }}
              style={{
                background: 'var(--bg3)', border: '1px solid var(--border)',
                borderRadius: 5, color: 'var(--text)', fontSize: 14, fontWeight: 700,
                padding: '3px 8px', outline: 'none', minWidth: 160,
              }}
            />
          ) : (
            <span
              onClick={() => { setEditingName(true); setNameValue(selected.name) }}
              style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', cursor: 'text' }}
              title="Click para editar"
            >
              {selected.name}
            </span>
          )}

          <div style={{ flex: 1 }} />

          {/* Run state */}
          {run && <RunBadge status={run.status} />}
          {isRunning && totalSteps > 0 && (
            <span style={{ fontSize: 10, color: '#3b82f6', fontFamily: 'var(--mono)' }}>
              {doneSteps}/{totalSteps}
            </span>
          )}
          {saving && <span style={{ fontSize: 10, color: 'var(--text2)' }}>Guardando…</span>}

          {/* Auto-connect toggle */}
          <button
            onClick={() => setAutoConnect(v => !v)}
            style={actionBtn(autoConnect ? '#34d399' : null, false, autoConnect)}
            title="Conectar automáticamente cada task al anterior al soltarlo en el canvas"
          >
            ⚡{autoConnect ? ' Auto ON' : ' Auto'}
          </button>

          {/* Fullscreen enter button */}
          {!fullscreen && (
            <button
              onClick={() => setFullscreen(true)}
              style={actionBtn('#64748b', false)}
              title="Pantalla completa"
            >
              ⛶
            </button>
          )}

          {/* Run controls */}
          {run && (
            <button
              onClick={() => setShowLogModal(true)}
              style={actionBtn('#a78bfa', false)}
              title="Ver log de la última ejecución"
            >
              📋 Log
            </button>
          )}

          {lastRunParams && !isRunning && run && (
            <button
              onClick={() => handleStart(lastRunParams)}
              disabled={starting}
              style={actionBtn('#3b82f6', starting)}
              title={`Repetir con ${lastRunParams.agentName || 'default'} / ${lastRunParams.profileName || 'default'}`}
            >
              {starting ? 'Iniciando…' : '↺ Repetir'}
            </button>
          )}

          <button
            onClick={() => { if (checkBeforeRun()) setShowRunModal(true) }}
            disabled={isRunning || !hasNodes || starting}
            style={actionBtn('#34d399', isRunning || !hasNodes || starting)}
          >
            {starting ? 'Iniciando…' : '▶ Iniciar'}
          </button>

          {isRunning && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              style={actionBtn('#ff6b6b', cancelling)}
            >
              {cancelling ? 'Cancelando…' : '■ Cancelar'}
            </button>
          )}
        </div>

        {/* Orphan tasks warning */}
        {orphanWarning && (
          <div style={{
            padding: '7px 14px', background: 'rgba(251,191,36,.1)',
            borderBottom: '1px solid rgba(251,191,36,.3)',
            display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
          }}>
            <span style={{ fontSize: 11, color: '#fbbf24' }}>
              ⚠ Los siguientes tasks deben estar dentro de un grupo para poder iniciar: <strong>{orphanWarning}</strong>
            </span>
            <button onClick={() => setOrphanWarning(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#fbbf24', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
          </div>
        )}

        {/* Canvas + node config panel */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
          <OrchestrationsCanvas
            ref={canvasRef}
            key={selected.id}
            orchId={selected.id}
            initialNodes={selected.nodes || []}
            initialEdges={selected.edges || []}
            run={run}
            isRunning={isRunning}
            onSave={saveGraph}
            onNodeSelect={setSelectedNodeId}
            onAddGroup={addGroupRef}
            onRunSingle={handleRunSingle}
            autoConnect={autoConnect}
          />

          {selectedNode && (
            <NodeConfigPanel
              node={selectedNode}
              connection={connection}
              onUpdate={handleNodeUpdate}
              onClose={() => setSelectedNodeId(null)}
            />
          )}
        </div>
      </div>
    </>
  )

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* Orchestration list — hidden in fullscreen */}
      {!fullscreen && (
        <OrchList
          orchs={orchs}
          selectedId={selectedId}
          onSelect={id => { setSelectedId(id); setSelectedNodeId(null) }}
          onCreate={createOrch}
          onDelete={deleteOrch}
          connectionId={connection.id}
          collapsed={orchListCollapsed}
          onToggle={() => setOrchListCollapsed(v => !v)}
        />
      )}

      {!selected ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
            <div style={{ fontSize: 36, marginBottom: 10, opacity: 0.4 }}>⚙</div>
            Selecciona una orquestación o crea una nueva
          </div>
        </div>
      ) : fullscreen ? (
        /* ── Fullscreen overlay ─────────────────────────────────────────────── */
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          display: 'flex', background: 'var(--bg)', overflow: 'hidden',
        }}
          onKeyDown={e => { if (e.key === 'Escape') setFullscreen(false) }}
          tabIndex={-1}
        >
          {canvasSection}
        </div>
      ) : (
        /* ── Normal layout ──────────────────────────────────────────────────── */
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minWidth: 0 }}>
          {canvasSection}
        </div>
      )}

      {showRunModal && (
        <RunModal
          connection={connection}
          onConfirm={(agentName, profileName) => {
            setShowRunModal(false)
            setLastRunParams({ agentName, profileName })
            handleStart({ agentName, profileName })
          }}
          onClose={() => setShowRunModal(false)}
        />
      )}

      {runSingleNode && (
        <RunSingleModal
          connection={connection}
          node={runSingleNode}
          onClose={() => setRunSingleNode(null)}
        />
      )}

      {showLogModal && run && (
        <RunLogModal
          run={run}
          connection={connection}
          nodes={selected?.nodes || []}
          onClose={() => setShowLogModal(false)}
        />
      )}
    </div>
  )
}

function actionBtn(color, disabled, active = false) {
  if (!color) color = '#64748b'
  return {
    padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
    background: disabled ? 'var(--bg3)' : active ? color + '22' : color + '15',
    color:      disabled ? 'var(--text2)' : color,
    border:     `1px solid ${disabled ? 'var(--border)' : active ? color + '55' : color + '30'}`,
    cursor:     disabled ? 'default' : 'pointer', transition: 'all .15s',
    flexShrink: 0,
  }
}

import { useState, useRef } from 'react'
import OrchList            from './OrchList'
import TaskPalette         from './panel/TaskPalette'
import OrchestrationsCanvas from './canvas/OrchestrationsCanvas'
import NodeConfigPanel     from './canvas/NodeConfigPanel'
import RunModal            from './RunModal'
import { useOrchestration } from './useOrchestration'
import { STATUS_COLORS }   from './canvasUtils'

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

  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue]     = useState('')
  const [showRunModal, setShowRunModal] = useState(false)
  const addGroupRef = useRef(() => {})
  const canvasRef   = useRef(null)

  const selectedNode = selected?.nodes?.find(n => n.id === selectedNodeId) || null

  function handleNodeUpdate(nodeId, patch) {
    if (!selected) return
    if (patch === null) {
      // Delete node
      const newNodes = selected.nodes.filter(n => n.id !== nodeId && n.parentId !== nodeId)
      const newEdges = selected.edges.filter(e => e.source !== nodeId && e.target !== nodeId)
      saveGraph(newNodes, newEdges)
      setSelectedNodeId(null)
      return
    }
    // Cancel any stale canvas debounce and sync its internal node data
    canvasRef.current?.patchNodeData(nodeId, patch)
    const newNodes = selected.nodes.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)
    saveGraph(newNodes, selected.edges)
  }

  if (loading) return <div style={{ padding: 40, color: 'var(--text2)', fontSize: 12 }}>Cargando orquestaciones…</div>
  if (error)   return <div style={{ padding: 40, color: 'var(--red)', fontSize: 12 }}>{error}</div>

  const hasNodes = (selected?.nodes?.filter(n => !n.parentId).length || 0) > 0
  const doneSteps = run ? Object.values(run.nodes || {}).filter(ns => !['pending','running'].includes(ns.status)).length : 0
  const totalSteps = run ? Object.values(run.nodes || {}).length : 0

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Orchestration list ──────────────────────────────────────────────── */}
      <OrchList
        orchs={orchs}
        selectedId={selectedId}
        onSelect={id => { setSelectedId(id); setSelectedNodeId(null) }}
        onCreate={createOrch}
        onDelete={deleteOrch}
      />

      {!selected ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
            <div style={{ fontSize: 36, marginBottom: 10, opacity: 0.4 }}>⚙</div>
            Selecciona una orquestación o crea una nueva
          </div>
        </div>
      ) : (
        <>
          {/* ── Task palette ──────────────────────────────────────────────────── */}
          <TaskPalette
            connection={connection}
            onAddGroup={() => addGroupRef.current?.()}
          />

          {/* ── Canvas area ──────────────────────────────────────────────────── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Toolbar */}
            <div style={{
              padding: '8px 14px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
              background: 'var(--bg2)', flexWrap: 'wrap',
            }}>
              {/* Editable name */}
              {editingName ? (
                <input
                  value={nameValue}
                  autoFocus
                  onChange={e => setNameValue(e.target.value)}
                  onBlur={() => { commitName(nameValue); setEditingName(false) }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { commitName(nameValue); setEditingName(false) }
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

              {/* Run controls */}
              <button
                onClick={() => setShowRunModal(true)}
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

            {/* Canvas */}
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
              />

              {/* Config panel */}
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
      )}

      {showRunModal && (
        <RunModal
          connection={connection}
          onConfirm={(agentName, profileName) => {
            setShowRunModal(false)
            handleStart({ agentName, profileName })
          }}
          onClose={() => setShowRunModal(false)}
        />
      )}
    </div>
  )
}

function actionBtn(color, disabled) {
  return {
    padding: '5px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600,
    background: disabled ? 'var(--bg3)' : color + '22',
    color: disabled ? 'var(--text2)' : color,
    border: `1px solid ${disabled ? 'var(--border)' : color + '44'}`,
    cursor: disabled ? 'default' : 'pointer', transition: 'all .15s',
  }
}

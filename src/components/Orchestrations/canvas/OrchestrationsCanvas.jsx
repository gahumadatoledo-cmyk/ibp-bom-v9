import { useCallback, useEffect, useRef, useState, useImperativeHandle } from 'react'
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge, useReactFlow, Panel,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import TaskNode  from './TaskNode'
import GroupNode from './GroupNode'
import { STATUS_COLORS, autoLayout, hasCycle } from '../canvasUtils'

const NODE_TYPES = { orchTask: TaskNode, orchGroup: GroupNode }

const EDGE_DEFAULTS = {
  type: 'smoothstep',
  style: { stroke: '#2e4168', strokeWidth: 1.5 },
  animated: false,
}

function toRFNodes(nodes, run, onSelect, onRunSingle) {
  return nodes.map(n => {
    const rfType = n.type === 'task' ? 'orchTask' : n.type === 'group' ? 'orchGroup' : n.type
    const ns = run?.nodes?.[n.id]
    const runStatus = ns?.status || 'pending'
    let childSummary = null
    if ((rfType === 'orchGroup') && ns?.children) {
      const vals = Object.values(ns.children)
      if (vals.length) {
        const done = vals.filter(c => !['pending', 'running'].includes(c.status)).length
        childSummary = `${done}/${vals.length} completadas`
      }
    }
    return {
      ...n,
      type: rfType,
      data: { ...n.data, runStatus, sapRunId: ns?.sapRunId || null, childSummary, onSelect, onRunSingle: rfType === 'orchTask' ? onRunSingle : undefined },
    }
  })
}

function toRFEdges(edges, run, nodes) {
  return edges.map(e => {
    const targetNs = run?.nodes?.[e.target]
    const sourceNs = run?.nodes?.[e.source]
    const animated = sourceNs?.status === 'success' && targetNs?.status === 'running'
    return {
      ...e, ...EDGE_DEFAULTS,
      style: { stroke: animated ? '#F7A800' : '#2e4168', strokeWidth: 1.5 },
      animated,
    }
  })
}

// ─── Inner canvas (must be inside ReactFlowProvider) ─────────────────────────
// React 19: ref is a plain prop — no forwardRef needed

function CanvasInner({
  orchId, initialNodes, initialEdges, run, isRunning,
  onSave, onNodeSelect, onAddGroup: addGroupExternal, onRunSingle, ref,
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const rfInstance = useReactFlow()
  const saveTimer  = useRef(null)
  const [cycleErr, setCycleErr] = useState(false)

  // Exposes imperative helpers so the parent can sync canvas state without going
  // through the debounced save path (which could overwrite panel changes).
  useImperativeHandle(ref, () => ({
    patchNodeData: (nodeId, patch) => {
      clearTimeout(saveTimer.current)
      setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n))
    },
    deleteNode: (nodeId) => {
      clearTimeout(saveTimer.current)
      setNodes(nds => nds.filter(n => n.id !== nodeId && n.parentId !== nodeId))
      setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId))
    },
  }))

  // Re-init when orchestration changes
  useEffect(() => {
    setNodes(toRFNodes(initialNodes, run, handleNodeSelect, onRunSingle))
    setEdges(toRFEdges(initialEdges, run, initialNodes))
    setCycleErr(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orchId])

  // Merge run state without reinitializing layout
  useEffect(() => {
    if (!run) return
    setNodes(nds => toRFNodes(nds, run, handleNodeSelect, onRunSingle))
    setEdges(eds => toRFEdges(eds, run, nodes))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run])

  function handleNodeSelect(nodeId) { onNodeSelect(nodeId) }

  function debounced_save(nds, eds) {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const cleanNodes = nds.map(({ id, type, position, parentId, extent, style, data }) => ({
        id,
        type: type === 'orchTask' ? 'task' : type === 'orchGroup' ? 'group' : type,
        position,
        ...(parentId ? { parentId, extent } : {}),
        ...(style ? { style } : {}),
        data: {
          taskName: data.taskName, label: data.label,
          agentName: data.agentName, profileName: data.profileName,
          errorStrategy: data.errorStrategy, maxRetries: data.maxRetries,
          retryDelaySec: data.retryDelaySec,
          executionMode: data.executionMode || 'parallel',
          globalVariables: data.globalVariables || [],
          children: data.children || [],
        },
      }))
      const cleanEdges = eds.map(({ id, source, target }) => ({ id, source, target }))
      onSave(cleanNodes, cleanEdges)
    }, 600)
  }

  function handleNodesChange(changes) {
    onNodesChange(changes)
    // 'select' changes don't modify data or position — skip them to avoid
    // queuing a debounced save with stale canvas data after the user clicks a node
    if (changes.some(c => c.type !== 'select')) {
      setNodes(nds => { debounced_save(nds, edges); return nds })
    }
  }

  function handleEdgesChange(changes) {
    onEdgesChange(changes)
    setEdges(eds => { debounced_save(nodes, eds); return eds })
  }

  const onConnect = useCallback((params) => {
    const newEdge = { ...params, id: crypto.randomUUID(), ...EDGE_DEFAULTS }
    const newEdges = addEdge(newEdge, edges)
    if (hasCycle(nodes, newEdges)) { setCycleErr(true); setTimeout(() => setCycleErr(false), 2500); return }
    setEdges(newEdges)
    debounced_save(nodes, newEdges)
  }, [edges, nodes])

  const isValidConnection = useCallback((connection) => {
    return connection.source !== connection.target
  }, [])

  // ── Drop handler ──────────────────────────────────────────────────────────
  const onDragOver = useCallback((e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    const raw = e.dataTransfer.getData('application/x-orch-task')
    if (!raw) return
    const { taskName, taskGuid, type } = JSON.parse(raw)
    const position = rfInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY })

    // Check if dropped inside a group node
    const groupNode = nodes.find(n => n.type === 'orchGroup' && !n.parentId && n.style && (
      position.x >= n.position.x && position.x <= n.position.x + (n.style.width || 300) &&
      position.y >= n.position.y && position.y <= n.position.y + (n.style.height || 200)
    ))

    const newId = crypto.randomUUID()
    const newNode = {
      id: newId, type: 'orchTask',
      position: groupNode
        ? { x: position.x - groupNode.position.x, y: position.y - groupNode.position.y }
        : position,
      ...(groupNode ? { parentId: groupNode.id, extent: 'parent' } : {}),
      data: {
        taskName, label: taskName, agentName: null, profileName: null,
        errorStrategy: 'stop', maxRetries: 0, retryDelaySec: 30,
        globalVariables: [], children: [],
        runStatus: 'pending', onSelect: handleNodeSelect,
      },
    }

    const newNodes = [...nodes, newNode]
    setNodes(newNodes)
    debounced_save(newNodes, edges)
  }, [nodes, edges, rfInstance])

  // ── Add group ────────────────────────────────────────────────────────────
  function addGroup() {
    const center = rfInstance.screenToFlowPosition({
      x: window.innerWidth / 2, y: window.innerHeight / 2,
    })
    const newId = crypto.randomUUID()
    const newNode = {
      id: newId, type: 'orchGroup',
      position: { x: center.x - 150, y: center.y - 90 },
      style: { width: 300, height: 180 },
      data: {
        label: 'Grupo paralelo', children: [],
        executionMode: 'parallel',
        runStatus: 'pending', onSelect: handleNodeSelect,
      },
    }
    const newNodes = [...nodes, newNode]
    setNodes(newNodes)
    debounced_save(newNodes, edges)
  }
  // expose to parent via prop
  useEffect(() => { addGroupExternal.current = addGroup }, [nodes, edges])

  // ── Auto layout ──────────────────────────────────────────────────────────
  function handleAutoLayout() {
    const laid = autoLayout(nodes, edges)
    const updated = toRFNodes(laid, run, handleNodeSelect)
    setNodes(updated)
    debounced_save(updated, edges)
    setTimeout(() => rfInstance.fitView({ padding: 0.15 }), 50)
  }

  const nodeColor = (n) => STATUS_COLORS[n.data?.runStatus || 'pending'] || '#64748b'

  return (
    <div style={{ flex: 1, position: 'relative' }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        nodeTypes={NODE_TYPES}
        defaultEdgeOptions={EDGE_DEFAULTS}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        deleteKeyCode="Delete"
        style={{ background: 'var(--bg)' }}
      >
        <Background color="#243350" gap={20} size={1} />
        <Controls style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8 }} />
        <MiniMap
          nodeColor={nodeColor}
          style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8 }}
          maskColor="rgba(11,17,32,0.7)"
        />

        <Panel position="top-left" style={{ display: 'flex', gap: 8, margin: 8 }}>
          <button onClick={handleAutoLayout} style={toolbarBtn}>⊞ Auto Layout</button>
        </Panel>

        {cycleErr && (
          <Panel position="top-center" style={{ margin: 8 }}>
            <div style={{
              background: 'rgba(255,107,107,.15)', border: '1px solid rgba(255,107,107,.4)',
              borderRadius: 6, padding: '6px 12px', fontSize: 11, color: 'var(--red)',
            }}>
              ⚠ Ciclo detectado — esa conexión crearía un bucle
            </div>
          </Panel>
        )}

        {nodes.length === 0 && (
          <Panel position="center">
            <div style={{ textAlign: 'center', color: 'var(--text2)', pointerEvents: 'none' }}>
              <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>⬡</div>
              <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.5 }}>
                Arrastra tasks desde el panel izquierdo
              </div>
              <div style={{ fontSize: 11, marginTop: 4, opacity: 0.35 }}>
                Conecta los nodos para definir el orden de ejecución
              </div>
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  )
}

const toolbarBtn = {
  padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border2)',
  background: 'var(--bg2)', color: 'var(--text2)', fontSize: 11, fontWeight: 600,
  cursor: 'pointer',
}

// ─── Public wrapper (provides context) ───────────────────────────────────────

function OrchestrationsCanvas({ ref, ...props }) {
  return (
    <ReactFlowProvider>
      <CanvasInner ref={ref} {...props} />
    </ReactFlowProvider>
  )
}

export default OrchestrationsCanvas

// ─── Schema migration ─────────────────────────────────────────────────────────

export function migrateStepsToGraph(orch) {
  if (orch.nodes && orch.nodes.length > 0) return orch
  const steps = orch.steps || []
  if (steps.length === 0) return { ...orch, nodes: [], edges: [] }
  const GAP = 200
  const nodes = steps.map((s, i) => ({
    id: s.id, type: 'orchTask',
    position: { x: 120, y: 60 + i * GAP },
    data: { ...s, label: s.taskName, runStatus: 'pending' },
  }))
  const edges = steps.slice(0, -1).map((s, i) => ({
    id: `e-${s.id}-${steps[i + 1].id}`,
    source: s.id, target: steps[i + 1].id,
    type: 'smoothstep',
  }))
  return { ...orch, nodes, edges, _migrated: true }
}

// ─── Graph layout (left→right Sugiyama-lite) ──────────────────────────────────

export function autoLayout(nodes, edges) {
  const topLevel = nodes.filter(n => !n.parentId)
  const inDegree = {}
  const adjList  = {}
  for (const n of topLevel) { inDegree[n.id] = 0; adjList[n.id] = [] }
  for (const e of edges) {
    if (e.source in adjList && e.target in inDegree) {
      adjList[e.source].push(e.target)
      inDegree[e.target]++
    }
  }
  // Kahn waves → columns
  const colOf = {}
  let ready = topLevel.filter(n => inDegree[n.id] === 0).map(n => n.id)
  let col = 0
  while (ready.length > 0) {
    ready.forEach(id => { colOf[id] = col })
    const next = []
    for (const id of ready) {
      for (const d of adjList[id]) {
        if (--inDegree[d] === 0) next.push(d)
      }
    }
    ready = next; col++
  }
  // Group by column, distribute vertically
  const byCol = {}
  for (const [id, c] of Object.entries(colOf)) {
    byCol[c] = byCol[c] || []
    byCol[c].push(id)
  }
  const COL_W = 260, ROW_H = 160, PAD_Y = 60
  const positioned = { ...Object.fromEntries(nodes.map(n => [n.id, n])) }
  for (const [c, ids] of Object.entries(byCol)) {
    ids.forEach((id, i) => {
      positioned[id] = { ...positioned[id], position: { x: Number(c) * COL_W + 40, y: PAD_Y + i * ROW_H } }
    })
  }
  // Keep children relative to their parent
  return nodes.map(n => {
    if (n.parentId) return n
    return positioned[n.id] || n
  })
}

// ─── Cycle detection ──────────────────────────────────────────────────────────

export function hasCycle(nodes, edges) {
  const topLevel = nodes.filter(n => !n.parentId)
  const inDegree = {}
  const adjList  = {}
  for (const n of topLevel) { inDegree[n.id] = 0; adjList[n.id] = [] }
  for (const e of edges) {
    if (e.source in adjList && e.target in inDegree) {
      adjList[e.source].push(e.target); inDegree[e.target]++
    }
  }
  let ready = topLevel.filter(n => inDegree[n.id] === 0)
  let visited = 0
  while (ready.length > 0) {
    const next = []
    for (const n of ready) {
      visited++
      for (const d of adjList[n.id]) {
        if (--inDegree[d] === 0) next.push(topLevel.find(x => x.id === d))
      }
    }
    ready = next.filter(Boolean)
  }
  return visited < topLevel.length
}

// ─── Status colors (shared with run state) ───────────────────────────────────

export const STATUS_COLORS = {
  pending:             '#64748b',
  running:             '#22c55e',
  success:             '#34d399',
  success_with_errors: '#fbbf24',
  error:               '#ff6b6b',
  cancelled:           '#94a3b8',
  skipped:             '#475569',
}

export const STATUS_ICONS = {
  pending: '○', running: '◉', success: '✓',
  success_with_errors: '⚠', error: '✕', cancelled: '⊘', skipped: '–',
}

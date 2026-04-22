import { useState, useEffect, useRef, useCallback } from 'react'
import { migrateStepsToGraph } from './canvasUtils'

const POLL_MS = 5000
const TERMINAL = new Set(['success', 'error', 'cancelled'])

export function useOrchestration(connection) {
  const [orchs, setOrchs]     = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [run, setRun]         = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [saving, setSaving]   = useState(false)
  const [starting, setStarting]   = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const pollRef = useRef(null)

  const selected = orchs.find(o => o.id === selectedId) || null
  const isRunning = run?.status === 'running'

  // ── Load orchestrations ──────────────────────────────────────────────────
  const loadOrchs = useCallback(async () => {
    try {
      const res = await fetch(`/api/orchestrations?connectionId=${connection.id}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setOrchs(data.map(migrateStepsToGraph))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [connection.id])

  useEffect(() => { loadOrchs() }, [loadOrchs])

  // ── Load run state on selection change ───────────────────────────────────
  useEffect(() => {
    if (!selectedId) { setRun(null); return }
    fetch(`/api/orchestrate?orchestrationId=${selectedId}`)
      .then(r => r.json()).then(setRun).catch(() => setRun(null))
  }, [selectedId])

  // ── Polling ──────────────────────────────────────────────────────────────
  const doTick = useCallback(async () => {
    if (!selectedId) return
    try {
      const res  = await fetch(`/api/orchestrate?orchestrationId=${selectedId}&action=tick`)
      const data = await res.json()
      setRun(data)
      if (data && TERMINAL.has(data.status)) {
        clearInterval(pollRef.current); pollRef.current = null
      }
    } catch { /* silent */ }
  }, [selectedId])

  useEffect(() => {
    if (isRunning && !pollRef.current) pollRef.current = setInterval(doTick, POLL_MS)
    else if (!isRunning && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [isRunning, doTick])

  // ── CRUD ──────────────────────────────────────────────────────────────────
  async function createOrch() {
    const name = prompt('Nombre de la nueva orquestación:')?.trim()
    if (!name) return
    try {
      const res = await fetch('/api/orchestrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: connection.id, name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const migrated = migrateStepsToGraph(data)
      setOrchs(prev => [...prev, migrated])
      setSelectedId(migrated.id)
    } catch (e) { alert(e.message) }
  }

  async function deleteOrch(id) {
    if (!confirm('¿Eliminar esta orquestación?')) return
    try {
      const res = await fetch('/api/orchestrations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setOrchs(prev => prev.filter(o => o.id !== id))
      if (selectedId === id) setSelectedId(null)
    } catch (e) { alert(e.message) }
  }

  async function saveGraph(nodes, edges) {
    if (!selectedId) return
    // Optimistic: update local state immediately so controlled inputs don't revert
    // while the PUT request is in flight
    setOrchs(prev => prev.map(o => o.id === selectedId ? { ...o, nodes, edges } : o))
    setSaving(true)
    try {
      const res = await fetch('/api/orchestrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedId, nodes, edges }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
    } catch (e) { console.error('Save error:', e.message) }
    setSaving(false)
  }

  async function commitName(name) {
    if (!name?.trim() || !selectedId) return
    try {
      const res = await fetch('/api/orchestrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedId, name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setOrchs(prev => prev.map(o => o.id === selectedId ? { ...o, name } : o))
    } catch (e) { alert(e.message) }
  }

  async function handleStart({ agentName = null, profileName = null } = {}) {
    if (!selectedId || isRunning || starting) return
    setStarting(true)
    try {
      const res = await fetch('/api/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orchestrationId: selectedId, action: 'start',
          defaultAgent: agentName || null, defaultProfile: profileName || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setRun(data)
    } catch (e) { alert(e.message) }
    setStarting(false)
  }

  async function handleCancel() {
    if (!selectedId || !isRunning) return
    setCancelling(true)
    try {
      const res = await fetch('/api/orchestrate', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orchestrationId: selectedId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setRun(data)
    } catch (e) { alert(e.message) }
    setCancelling(false)
  }

  return {
    orchs, loading, error, selected, selectedId, setSelectedId,
    run, isRunning, saving, starting, cancelling,
    createOrch, deleteOrch, saveGraph, commitName, handleStart, handleCancel,
  }
}

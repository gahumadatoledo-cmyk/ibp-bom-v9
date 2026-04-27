import { useState, useEffect } from 'react'

async function soapCall(connectionId, operation, params = {}) {
  const res = await fetch('/api/soap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId, operation, params }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

const inputStyle = {
  background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text)', fontSize: 12, padding: '6px 10px', fontFamily: 'var(--font)',
  outline: 'none', width: '100%', boxSizing: 'border-box',
}
const selectStyle = {
  ...inputStyle, cursor: 'pointer',
}
const labelStyle = {
  fontSize: 10, fontWeight: 700, color: 'var(--text2)',
  textTransform: 'uppercase', letterSpacing: '.06em',
  display: 'block', marginBottom: 4,
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}

function initForm(data) {
  return {
    label:           data.label         || '',
    errorStrategy:   data.errorStrategy || 'stop',
    maxRetries:      data.maxRetries    ?? 1,
    retryDelaySec:   data.retryDelaySec ?? 30,
    globalVariables: Array.isArray(data.globalVariables) ? data.globalVariables.map(v => ({ ...v })) : [],
  }
}

export default function NodeConfigPanel({ node, connection, onUpdate, onClose }) {
  if (!node) return null
  const isGroup = node.type === 'orchGroup' || node.type === 'group'

  const [form, setForm]             = useState(() => initForm(node.data))
  const [dirty, setDirty]           = useState(false)
  const [saving, setSaving]         = useState(false)

  // SAP global variables for this task
  const [taskVars, setTaskVars]       = useState([])
  const [varsStatus, setVarsStatus]   = useState('idle') // idle | loading | loaded | error

  useEffect(() => {
    setForm(initForm(node.data))
    setDirty(false)
  }, [node.id])

  useEffect(() => {
    if (isGroup || !connection) return
    const guid = node.data.taskGuid
    const name = node.data.taskName
    if (!guid && !name) { setVarsStatus('idle'); return }

    setVarsStatus('loading')
    setTaskVars([])
    let cancelled = false

    async function load() {
      let taskGuid = guid
      // Fallback: look up guid by exact task name
      if (!taskGuid && name) {
        const results = await soapCall(connection.id, 'searchTasks', { nameFilter: name })
        if (cancelled) return
        const match = Array.isArray(results)
          ? results.find(r => r.taskName?.trim() === name?.trim())
          : null
        taskGuid = match?.taskGuid
      }
      if (!taskGuid) { if (!cancelled) setVarsStatus('error'); return }
      if (import.meta.env.DEV) {
        soapCall(connection.id, 'getTaskInfo', { taskGuid, _debug: true })
          .then(d => {
            console.log('[NodeConfig getTaskInfo request envelope]', d._requestEnvelopeXml)
            console.log('[NodeConfig getTaskInfo raw]', d._rawXml)
          })
          .catch(() => {})
      }
      const info = await soapCall(connection.id, 'getTaskInfo', { taskGuid })
      if (cancelled) return
      const vars = Array.isArray(info?.globalVariables) ? info.globalVariables : []
      setTaskVars(vars)
      setVarsStatus('loaded')
    }

    load().catch(() => { if (!cancelled) setVarsStatus('error') })
    return () => { cancelled = true }
  }, [node.id, node.data.taskGuid, node.data.taskName, connection?.id, isGroup])

  function patch(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    setDirty(true)
  }

  function addVar() {
    setForm(f => ({ ...f, globalVariables: [...f.globalVariables, { name: '', value: '' }] }))
    setDirty(true)
  }

  function removeVar(i) {
    setForm(f => ({ ...f, globalVariables: f.globalVariables.filter((_, j) => j !== i) }))
    setDirty(true)
  }

  function patchVar(i, field, value) {
    setForm(f => {
      const updated = f.globalVariables.map((v, j) => {
        if (j !== i) return v
        const next = { ...v, [field]: value }
        // Auto-fill value from SAP defaultValue when picking a name
        if (field === 'name' && !v.value) {
          const tv = taskVars.find(t => t.name === value)
          if (tv?.defaultValue) next.value = tv.defaultValue
        }
        return next
      })
      return { ...f, globalVariables: updated }
    })
    setDirty(true)
  }

  function handleSave() {
    setSaving(true)
    const update = {
      label:           form.label || node.data.taskName || 'Sin nombre',
      errorStrategy:   form.errorStrategy,
      maxRetries:      Number(form.maxRetries),
      retryDelaySec:   Number(form.retryDelaySec),
      globalVariables: form.globalVariables.filter(v => v.name.trim()),
    }
    onUpdate(node.id, update)
    setDirty(false)
    setSaving(false)
  }

  function handleDelete() {
    onUpdate(node.id, null)
    onClose()
  }

  // Build vars section header
  const varsHeader = varsStatus === 'loading'
    ? 'Variables globales — cargando…'
    : varsStatus === 'error'
      ? 'Variables globales — error al cargar'
      : varsStatus === 'loaded'
        ? `Variables globales (${taskVars.length} disponibles)`
        : 'Variables globales'

  const canAddVars = varsStatus === 'loaded' && taskVars.length > 0

  return (
    <div style={{
      width: 290, flexShrink: 0, borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', background: 'var(--bg2)', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
            {isGroup ? '⊞ Grupo' : '⬡ Task'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1, fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
            {node.data.taskName || node.data.label}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        {/* Label */}
        <Field label="Nombre visible">
          <input
            style={inputStyle}
            value={form.label}
            onChange={e => patch('label', e.target.value)}
            placeholder={node.data.taskName || 'Nombre del nodo'}
          />
        </Field>

        {/* Group info */}
        {isGroup && (
          <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 6, background: 'var(--bg3)', border: '1px solid var(--border)', fontSize: 10, color: 'var(--text3)', lineHeight: 1.5 }}>
            El orden lo determinan los edges entre sus tasks.<br />
            Sin edges → paralelo · Todos conectados → en secuencia · Mix → híbrido
          </div>
        )}

        {/* Task config */}
        {!isGroup && (
          <>
            <Field label="En caso de error">
              <select style={selectStyle}
                value={form.errorStrategy}
                onChange={e => patch('errorStrategy', e.target.value)}>
                <option value="stop">Detener orquestación</option>
                <option value="continue">Continuar al siguiente</option>
                <option value="retry">Reintentar</option>
              </select>
            </Field>

            {form.errorStrategy === 'retry' && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Máx reintentos</label>
                  <input type="number" min={1} max={5} style={inputStyle}
                    value={form.maxRetries}
                    onChange={e => patch('maxRetries', Number(e.target.value))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Espera (seg)</label>
                  <input type="number" min={5} max={3600} style={inputStyle}
                    value={form.retryDelaySec}
                    onChange={e => patch('retryDelaySec', Number(e.target.value))} />
                </div>
              </div>
            )}

            {/* Global variables — always dropdown, never free text */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={labelStyle}>{varsHeader}</label>
                {varsStatus === 'loading' && (
                  <span style={{ fontSize: 9, color: 'var(--text3)' }}>⏳</span>
                )}
                {varsStatus === 'error' && (
                  <span style={{ fontSize: 9, color: 'var(--red)' }}>Error SAP</span>
                )}
              </div>

              {/* Status message when no vars */}
              {varsStatus === 'loaded' && taskVars.length === 0 && (
                <div style={{ padding: '6px 8px', borderRadius: 5, background: 'var(--bg3)', border: '1px solid var(--border)', fontSize: 10, color: 'var(--text3)' }}>
                  Este task no tiene variables globales en SAP.
                </div>
              )}

              {/* Variable rows */}
              {form.globalVariables.map((v, i) => (
                <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  {varsStatus === 'loading' ? (
                    <div style={{ ...inputStyle, flex: 1, color: 'var(--text3)', fontSize: 11 }}>Cargando variables…</div>
                  ) : (
                    <select
                      style={{ ...selectStyle, flex: 1 }}
                      value={v.name}
                      onChange={e => patchVar(i, 'name', e.target.value)}
                    >
                      <option value="">— Seleccionar —</option>
                      {/* Preserve existing name if it was already set */}
                      {v.name && !taskVars.some(tv => tv.name === v.name) && (
                        <option value={v.name}>{v.name}</option>
                      )}
                      {taskVars.map(tv => (
                        <option key={tv.name} value={tv.name}>
                          {tv.name}{tv.description ? ` — ${tv.description}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    value={v.value}
                    onChange={e => patchVar(i, 'value', e.target.value)}
                    placeholder={varsStatus === 'loading' ? '…' : 'valor'}
                    disabled={varsStatus === 'loading'}
                  />
                  <button onClick={() => removeVar(i)} style={{
                    background: 'none', border: 'none', color: 'var(--red)',
                    cursor: 'pointer', fontSize: 16, padding: '0 4px', flexShrink: 0,
                  }}>×</button>
                </div>
              ))}

              {/* + Variable button — only when vars available */}
              {canAddVars ? (
                <button onClick={addVar} style={{
                  fontSize: 10, padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
                  background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)',
                }}>+ Variable</button>
              ) : varsStatus === 'idle' || varsStatus === 'error' ? (
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                  {varsStatus === 'error' ? 'No se pudieron cargar las variables del sistema.' : ''}
                </div>
              ) : null}
            </div>
          </>
        )}

        {/* Delete */}
        <div style={{ marginTop: 4 }}>
          <button
            onClick={handleDelete}
            style={{
              width: '100%', padding: '7px', borderRadius: 6,
              border: '1px solid rgba(255,107,107,.3)', background: 'rgba(255,107,107,.08)',
              color: 'var(--red)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Eliminar nodo
          </button>
        </div>

        {/* Save */}
        <div style={{ marginTop: 10, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              width: '100%', padding: '8px', borderRadius: 6,
              border: `1px solid ${dirty ? 'rgba(52,211,153,.5)' : 'rgba(52,211,153,.2)'}`,
              background: dirty ? 'rgba(52,211,153,.18)' : 'rgba(52,211,153,.06)',
              color: dirty ? '#34d399' : 'rgba(52,211,153,.5)',
              fontSize: 12, fontWeight: 700,
              cursor: saving ? 'default' : 'pointer',
              transition: 'all .15s',
            }}
          >
            {saving ? 'Guardando…' : dirty ? '✓ Guardar cambios' : '✓ Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

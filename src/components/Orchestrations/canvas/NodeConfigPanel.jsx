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

function DropdownOrText({ value, options, loading, emptyLabel, placeholder, onChange }) {
  if (loading) return <div style={{ ...inputStyle, color: 'var(--text3)' }}>Cargando…</div>
  if (options.length > 0) {
    return (
      <select style={{ ...inputStyle, cursor: 'pointer' }} value={value || ''} onChange={e => onChange(e.target.value || null)}>
        <option value="">{emptyLabel}</option>
        {options.map(o => (
          <option key={o.key} value={o.value}>{o.label}</option>
        ))}
      </select>
    )
  }
  return (
    <input
      style={inputStyle}
      value={value || ''}
      onChange={e => onChange(e.target.value || null)}
      placeholder={placeholder}
    />
  )
}

function initForm(data) {
  return {
    label:           data.label         || '',
    executionMode:   data.executionMode || 'parallel',
    agentName:       data.agentName     || '',
    profileName:     data.profileName   || '',
    errorStrategy:   data.errorStrategy || 'stop',
    maxRetries:      data.maxRetries    ?? 1,
    retryDelaySec:   data.retryDelaySec ?? 30,
    globalVariables: Array.isArray(data.globalVariables) ? data.globalVariables.map(v => ({ ...v })) : [],
  }
}

export default function NodeConfigPanel({ node, connection, onUpdate, onClose }) {
  if (!node) return null
  const isGroup = node.type === 'orchGroup' || node.type === 'group'

  const [form, setForm]   = useState(() => initForm(node.data))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const [agents,  setAgents]  = useState([])
  const [configs, setConfigs] = useState([])
  const [loadingOptions, setLoadingOptions] = useState(false)

  // Re-initialize form when switching to a different node
  useEffect(() => {
    setForm(initForm(node.data))
    setDirty(false)
  }, [node.id])

  useEffect(() => {
    if (isGroup || !connection) return
    setLoadingOptions(true)
    Promise.all([
      soapCall(connection.id, 'getAgents', { activeOnly: false }),
      soapCall(connection.id, 'getSystemConfigurations'),
    ])
      .then(([agentGroups, profs]) => {
        const flat = (Array.isArray(agentGroups) ? agentGroups : [])
          .flatMap(g => Array.isArray(g.agents) ? g.agents : [])
        setAgents(flat)
        setConfigs(Array.isArray(profs) ? profs : [])
      })
      .catch(() => {})
      .finally(() => setLoadingOptions(false))
  }, [node.id, connection?.id, isGroup])

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
    setForm(f => ({
      ...f,
      globalVariables: f.globalVariables.map((v, j) => j === i ? { ...v, [field]: value } : v),
    }))
    setDirty(true)
  }

  function handleSave() {
    setSaving(true)
    const update = {
      label:           form.label || node.data.taskName || 'Sin nombre',
      executionMode:   form.executionMode,
      agentName:       form.agentName  || null,
      profileName:     form.profileName || null,
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

        {/* Grupo: modo de ejecución */}
        {isGroup && (
          <Field label="Modo de ejecución interna">
            <div style={{ display: 'flex', gap: 8 }}>
              {['parallel', 'serial'].map(mode => {
                const active = form.executionMode === mode
                const label  = mode === 'parallel' ? '⊞ Paralelo' : '→ Serial'
                const color  = mode === 'parallel' ? '#29ABE2' : '#F7A800'
                return (
                  <button key={mode} onClick={() => patch('executionMode', mode)} style={{
                    flex: 1, padding: '6px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                    border: `1px solid ${active ? color + '44' : 'var(--border)'}`,
                    background: active ? color + '22' : 'var(--bg3)',
                    color: active ? color : 'var(--text2)',
                    cursor: 'pointer',
                  }}>
                    {label}
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 5, lineHeight: 1.4 }}>
              {form.executionMode === 'parallel'
                ? 'Todas las tasks del grupo se lanzan simultáneamente.'
                : 'Las tasks del grupo se ejecutan de una en una, en orden.'}
            </div>
          </Field>
        )}

        {/* Task: agente, perfil, estrategia */}
        {!isGroup && (
          <>
            <Field label="Agente">
              <DropdownOrText
                value={form.agentName}
                options={agents.map(a => ({
                  key: a.guid || a.name,
                  value: a.name,
                  label: a.name + (a.agentStatus && !a.agentStatus.includes('CONNECTED') ? ` (${a.agentStatus})` : ''),
                }))}
                loading={loadingOptions}
                emptyLabel="— Sin agente específico —"
                placeholder="Nombre del agente"
                onChange={v => patch('agentName', v || '')}
              />
            </Field>

            <Field label="Configuración de sistema">
              <DropdownOrText
                value={form.profileName}
                options={configs.map(c => ({ key: c.guid || c.name, value: c.name, label: c.name }))}
                loading={loadingOptions}
                emptyLabel="— Sin configuración específica —"
                placeholder="Nombre de la configuración"
                onChange={v => patch('profileName', v || '')}
              />
            </Field>

            <Field label="En caso de error">
              <select style={{ ...inputStyle, cursor: 'pointer' }}
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

            <Field label="Variables globales">
              {form.globalVariables.map((v, i) => (
                <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    value={v.name}
                    onChange={e => patchVar(i, 'name', e.target.value)}
                    placeholder="nombre"
                  />
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    value={v.value}
                    onChange={e => patchVar(i, 'value', e.target.value)}
                    placeholder="valor"
                  />
                  <button onClick={() => removeVar(i)} style={{
                    background: 'none', border: 'none', color: 'var(--red)',
                    cursor: 'pointer', fontSize: 16, padding: '0 4px', flexShrink: 0,
                  }}>×</button>
                </div>
              ))}
              <button onClick={addVar} style={{
                fontSize: 10, padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
                background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)',
              }}>+ Variable</button>
            </Field>
          </>
        )}

        {/* Eliminar */}
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

        {/* Guardar */}
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

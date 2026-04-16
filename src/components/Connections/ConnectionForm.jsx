import { useState } from 'react'

export default function ConnectionForm({ initial, onSaved, onCancel }) {
  const [form, setForm] = useState({
    name:         initial?.name        || '',
    serviceUrl:   initial?.serviceUrl  || '',
    orgName:      initial?.orgName     || '',
    user:         initial?.user        || '',
    password:     '',
    isProduction: initial?.isProduction ?? true,
    logoUrl:      initial?.logoUrl     || '',
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  function set(k, v) { setForm(p => ({ ...p, [k]: v })) }

  async function handleSave() {
    if (!form.name)       { setError('El nombre es obligatorio'); return }
    if (!form.serviceUrl) { setError('La URL del servicio es obligatoria'); return }
    if (!form.orgName)    { setError('El nombre de organización es obligatorio'); return }
    if (!form.user)       { setError('El usuario es obligatorio'); return }
    if (!initial && !form.password) { setError('La contraseña es obligatoria para conexiones nuevas'); return }

    setSaving(true); setError('')
    try {
      const body = {
        name:         form.name,
        serviceUrl:   form.serviceUrl.replace(/\/$/, ''),
        orgName:      form.orgName,
        user:         form.user,
        isProduction: form.isProduction,
        logoUrl:      form.logoUrl,
        ...(form.password ? { password: form.password } : {}),
      }
      if (initial) body.id = initial.id

      const res = await fetch('/api/connections', {
        method:  initial ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Error')
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 10, padding: 24 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 20 }}>
        {initial ? 'Editar conexión' : 'Nueva conexión'}
      </div>

      {/* Row 1: Name + Org */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <Field label="Nombre conexión" value={form.name} onChange={v => set('name', v)} placeholder="ej: CI-DS Producción" />
        <Field label="Organización (orgName)" value={form.orgName} onChange={v => set('orgName', v)} placeholder="miOrganizacion" mono />
      </div>

      {/* Row 2: Service URL full width */}
      <div style={{ marginBottom: 14 }}>
        <Field
          label="URL del servicio SOAP"
          value={form.serviceUrl}
          onChange={v => set('serviceUrl', v)}
          placeholder="https://us.cids.cloud.sap/webservices"
          mono
        />
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
          Kyma: https://&lt;host&gt;/webservices &nbsp;·&nbsp; Neo: https://&lt;host&gt;/DSoD/webservices
        </div>
      </div>

      {/* Row 3: User + Password + Repo */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
        <Field label="Usuario" value={form.user} onChange={v => set('user', v)} placeholder="WebServicesUser" mono />
        <Field
          label={initial ? 'Contraseña (vacío = mantener)' : 'Contraseña'}
          value={form.password}
          onChange={v => set('password', v)}
          type="password"
          placeholder={initial ? '••••••••' : 'Contraseña'}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.07em' }}>
            Repositorio
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            {[{ label: 'Producción', value: true }, { label: 'Sandbox', value: false }].map(opt => (
              <label key={String(opt.value)} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12, color: 'var(--text)' }}>
                <input
                  type="radio"
                  name="isProduction"
                  checked={form.isProduction === opt.value}
                  onChange={() => set('isProduction', opt.value)}
                  style={{ accentColor: 'var(--accent)' }}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Row 4: Logo URL */}
      <div style={{ marginBottom: 14 }}>
        <Field label="URL del logo (opcional)" value={form.logoUrl} onChange={v => set('logoUrl', v)} placeholder="https://empresa.com/logo.png" />
      </div>

      {error && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--red)' }}>✕ {error}</div>}

      <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={{
          background: 'none', border: '1px solid var(--border2)', borderRadius: 6,
          color: 'var(--text2)', fontSize: 12, fontWeight: 600, padding: '7px 18px',
        }}>Cancelar</button>
        <button type="button" disabled={saving} onClick={handleSave} style={{
          background: 'var(--accent)', border: 'none', borderRadius: 6,
          color: '#000', fontSize: 12, fontWeight: 700, padding: '7px 18px',
        }}>{saving ? 'Guardando...' : initial ? 'Guardar cambios' : 'Crear conexión'}</button>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text', mono }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.07em' }}>{label}</label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{
          background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
          color: 'var(--text)', fontFamily: mono ? 'var(--mono)' : 'var(--font)',
          fontSize: 12, padding: '8px 12px', outline: 'none', width: '100%', boxSizing: 'border-box',
        }}
        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
        onBlur={e => e.target.style.borderColor = 'var(--border)'}
      />
    </div>
  )
}

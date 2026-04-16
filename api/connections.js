import crypto from 'crypto'

const REDIS_URL   = process.env.KV_REST_API_URL
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN
const KEY = 'cids:connections'

async function redisGet(key) {
  const resp = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['GET', key]])
  })
  const data = await resp.json()
  const result = data[0]?.result
  if (!result) return []
  try {
    const parsed = JSON.parse(result)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

async function redisSet(key, value) {
  const resp = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['SET', key, JSON.stringify(value)]])
  })
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}))
    throw new Error(`Redis SET failed (${resp.status}): ${JSON.stringify(data)}`)
  }
}

function encrypt(text) {
  const secret = process.env.ENCRYPTION_SECRET || 'default-secret-change-me'
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(secret.padEnd(32).slice(0, 32)), iv)
  return iv.toString('hex') + ':' + cipher.update(text, 'utf8', 'hex') + cipher.final('hex')
}

function stripPassword(conn) {
  const { password, ...rest } = conn
  return rest
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({ error: 'Redis no configurado: faltan KV_REST_API_URL o KV_REST_API_TOKEN' })
  }

  try {
    const connections = await redisGet(KEY)

    if (req.method === 'GET') {
      return res.json(connections.map(stripPassword))
    }

    if (req.method === 'POST') {
      const { name, serviceUrl, orgName, user, password, isProduction, logoUrl } = req.body
      if (!name)       return res.status(400).json({ error: 'El nombre es obligatorio' })
      if (!serviceUrl) return res.status(400).json({ error: 'La URL del servicio es obligatoria' })
      if (!orgName)    return res.status(400).json({ error: 'El nombre de organización es obligatorio' })
      if (!user)       return res.status(400).json({ error: 'El usuario es obligatorio' })
      if (!password)   return res.status(400).json({ error: 'La contraseña es obligatoria para conexiones nuevas' })

      const newConn = {
        id:           crypto.randomUUID(),
        name,
        serviceUrl:   serviceUrl.replace(/\/$/, ''),
        orgName,
        user,
        password:     encrypt(password),
        isProduction: !!isProduction,
        logoUrl:      logoUrl || '',
      }
      connections.push(newConn)
      await redisSet(KEY, connections)
      return res.status(201).json(stripPassword(newConn))
    }

    const id = req.body?.id
    if (!id) return res.status(400).json({ error: 'Falta id' })

    if (req.method === 'PUT') {
      const idx = connections.findIndex(c => c.id === id)
      if (idx === -1) return res.status(404).json({ error: 'No encontrado' })
      const existing = connections[idx]
      const { name, serviceUrl, orgName, user, password, isProduction, logoUrl } = req.body

      connections[idx] = {
        ...existing,
        ...(name        !== undefined && { name }),
        ...(serviceUrl  !== undefined && { serviceUrl: serviceUrl.replace(/\/$/, '') }),
        ...(orgName     !== undefined && { orgName }),
        ...(user        !== undefined && { user }),
        // Only update password if a new one was provided
        ...(password    ? { password: encrypt(password) } : {}),
        ...(isProduction !== undefined && { isProduction: !!isProduction }),
        ...(logoUrl     !== undefined && { logoUrl }),
      }
      await redisSet(KEY, connections)
      return res.json(stripPassword(connections[idx]))
    }

    if (req.method === 'DELETE') {
      const idx = connections.findIndex(c => c.id === id)
      if (idx === -1) return res.status(404).json({ error: 'No encontrado' })
      connections.splice(idx, 1)
      await redisSet(KEY, connections)
      return res.json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: e.message })
  }
}

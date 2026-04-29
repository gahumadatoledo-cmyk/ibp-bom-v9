import { logon } from './soap.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { hciUrl, orgName, isProduction, user, password } = req.body || {}
  if (!hciUrl || !orgName || !user || !password) {
    return res.status(400).json({ error: 'hciUrl, orgName, user y password son requeridos' })
  }

  try {
    const sessionId = await logon(hciUrl, orgName, user, password, isProduction ?? true)
    return res.json({ sessionId })
  } catch (e) {
    return res.status(401).json({ error: e.message })
  }
}

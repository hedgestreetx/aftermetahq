// backend/src/api/server.ts
import express from 'express'
import cors from 'cors'
import { ENV } from '../lib/env'                 // ✅ import ENV before using it
import routesv1 from './routes.v1.ts'
import mintRouter from './mintTestnet.ts'

// ----------------------------------------------------------------------------
// CORS / App
// ----------------------------------------------------------------------------
const app = express()
app.use(cors({
  origin: ['http://localhost:5173'],            // add more origins if needed
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Request-Id'],
  credentials: false
}))
app.use(express.json())

// ----------------------------------------------------------------------------
// Minimal health + debug
// ----------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({
    service: 'aftermeta-backend',
    network: ENV.NETWORK,
    port: ENV.PORT,
  })
})

// ----------------------------------------------------------------------------
// 🔒 Lightweight TX monitor with aggressive backoff (no spam, no bloat)
// ----------------------------------------------------------------------------

// Node 18+ has global fetch. Do NOT import node-fetch here.
const WOC_NET = (ENV.NETWORK === 'mainnet' || ENV.NETWORK === 'livenet') ? 'main' : 'test'

type TxState = {
  txid: string
  confirmed: boolean
  confs: number
  nextCheckAt: number  // ms epoch
  attempts: number     // for backoff steps
  error?: string
}

const txCache = new Map<string, TxState>()
const BACKOFF_STEPS_SEC = [5, 15, 30, 60, 120, 300, 600] // cap at 10 min

function nextDelayMs(attempts: number) {
  const idx = Math.min(attempts, BACKOFF_STEPS_SEC.length - 1)
  return BACKOFF_STEPS_SEC[idx] * 1000
}

// Minimal status call — tiny JSON, not full tx
async function queryStatus(txid: string): Promise<{ confirmed: boolean; confs: number }> {
  const url = `https://api.whatsonchain.com/v1/bsv/${WOC_NET}/tx/${txid}/status`
  const r = await fetch(url, { method: 'GET' })
  if (!r.ok) throw new Error(`WOC status ${r.status}`)
  const j: any = await r.json()
  const confirmed = !!(j.confirmed ?? j.isConfirmed ?? false)
  const confs = Number(j.confirmations ?? j.confs ?? (confirmed ? 1 : 0))
  return { confirmed, confs: Number.isFinite(confs) ? confs : (confirmed ? 1 : 0) }
}

// Worker: scans cache every 5s and only hits WOC when a tx is due
setInterval(async () => {
  const now = Date.now()
  for (const s of txCache.values()) {
    if (s.confirmed) continue
    if (s.nextCheckAt > now) continue

    try {
      const { confirmed, confs } = await queryStatus(s.txid)
      s.error = undefined
      s.attempts++
      s.confirmed = confirmed
      s.confs = confs
      s.nextCheckAt = confirmed ? Number.POSITIVE_INFINITY : now + nextDelayMs(s.attempts)
    } catch (e: any) {
      s.error = String(e?.message || e)
      s.attempts++
      s.nextCheckAt = now + nextDelayMs(s.attempts)
    }
  }
}, 5000)

// Public endpoints for the frontend
app.post('/api/tx/watch', (req, res) => {
  const txid = String(req.body?.txid || '').trim()
  if (!/^[0-9a-f]{64}$/i.test(txid)) {
    return res.status(400).json({ ok: false, error: 'invalid txid' })
  }
  if (!txCache.has(txid)) {
    txCache.set(txid, {
      txid,
      confirmed: false,
      confs: 0,
      nextCheckAt: Date.now(), // check immediately once
      attempts: 0,
    })
  }
  res.json({ ok: true })
})

app.get('/api/tx/:txid/status', (req, res) => {
  const txid = String(req.params.txid || '').trim()
  const s = txCache.get(txid)
  if (!s) return res.status(404).json({ ok: false, error: 'unknown txid' })
  res.json({
    ok: true,
    txid: s.txid,
    confirmed: s.confirmed,
    confs: s.confs,
    nextCheckAt: s.nextCheckAt,
    attempts: s.attempts,
    error: s.error ?? null
  })
})

// ----------------------------------------------------------------------------
// Your existing routers
// ----------------------------------------------------------------------------
app.use(routesv1)
app.use(mintRouter)

// ----------------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------------
app.listen(ENV.PORT, () => {
  console.log(`✅ Backend running on http://localhost:${ENV.PORT}`)
})

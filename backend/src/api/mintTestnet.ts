import { Router } from 'express'
import { bsv } from 'scrypt-ts'
import { db } from '../lib/db'
import { ENV } from '../lib/env' // expects ENV.NETWORK = 'testnet' | 'mainnet'

// -----------------------------------------------------------------------------
// Chain config (avoid hardcoding testnet everywhere)
// -----------------------------------------------------------------------------
const WOC_NET = ENV.NETWORK === 'mainnet' ? 'main' : 'test'
const WOC_BASE = `https://api.whatsonchain.com/v1/bsv/${WOC_NET}`

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
async function fetchUtxos(address: string) {
  const res = await fetch(`${WOC_BASE}/address/${address}/unspent`)
  if (!res.ok) throw new Error(`Failed to fetch utxos (${res.status})`)
  const json = await res.json()
  if (!Array.isArray(json)) throw new Error('Invalid UTXO response')
  return json
}

async function broadcastTx(rawTx: string) {
  const res = await fetch(`${WOC_BASE}/tx/raw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txhex: rawTx }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.text()
}

function isHex(s: string, even = true) {
  if (typeof s !== 'string') return false
  if (even && s.length % 2 !== 0) return false
  return /^[0-9a-fA-F]+$/.test(s)
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

// Ensure schema & indexes exactly once per process
function ensureSchema() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS mint_tx (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      txid TEXT UNIQUE,
      pool_id TEXT,
      symbol TEXT,
      sats INTEGER,
      created_at INTEGER
    )
  `).run()

  // Add column if coming from older schema
  try { db.prepare(`ALTER TABLE mint_tx ADD COLUMN symbol TEXT`).run() } catch {}

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_mint_created ON mint_tx(created_at DESC)`).run()
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_mint_pool ON mint_tx(pool_id)`).run()
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_mint_symbol ON mint_tx(symbol)`).run()
}

ensureSchema()

// -----------------------------------------------------------------------------
const router = Router()

// POST /v1/mint  — real on-chain spend to pool locking script
router.post('/v1/mint', async (req, res) => {
  try {
    const raw = req.body || {}
    const wif: string = raw.wif
    const poolLockingScriptHex: string = raw.poolLockingScriptHex
    const poolId: string | undefined = raw.poolId
    const symbol: string | undefined = raw.symbol

    const spendSats = Number(raw.spendSats)
    if (!wif || !Number.isFinite(spendSats) || spendSats <= 0 || !poolLockingScriptHex) {
      return res.status(400).json({ ok: false, error: 'Missing fields' })
    }
    if (!isHex(poolLockingScriptHex)) {
      return res.status(400).json({ ok: false, error: 'locking_script_not_hex' })
    }

    // 1) Key + address (respect network)
    const privateKey = bsv.PrivateKey.fromWIF(wif)
    const address = privateKey.toAddress(ENV.NETWORK === 'mainnet' ? 'mainnet' : 'testnet').toString()

    // 2) Fetch UTXOs
    const utxosRaw = await fetchUtxos(address)
    if (utxosRaw.length === 0) throw new Error('No UTXOs found')

    // 3) Map UTXOs
    const utxos = utxosRaw.map((u: any) => ({
      txId: u.tx_hash,
      outputIndex: u.tx_pos,
      satoshis: u.value,
      script: bsv.Script.buildPublicKeyHashOut(address),
    }))

    // 4) Build + sign TX
    const tx = new bsv.Transaction()
      .from(utxos)
      .to(bsv.Script.fromHex(poolLockingScriptHex), spendSats)
      .change(address)
      .sign(privateKey)

    // 5) Broadcast
    const txid = await broadcastTx(tx.serialize())

    // 6) Insert denormalized mint record
    db.prepare(`
      INSERT OR IGNORE INTO mint_tx (txid, pool_id, symbol, sats, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      txid,
      poolId ?? 'unknown',
      (typeof symbol === 'string' && symbol.trim()) ? symbol.trim().toUpperCase() : 'UNKNOWN',
      spendSats,
      Date.now()
    )

    // 7) Respond
    res.json({ ok: true, txid })
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) })
  }
})

// GET /v1/mints?limit=50  — recent mints (join-free, includes symbol)
router.get('/v1/mints', (req, res) => {
  try {
    const limit = clamp(Number(req.query.limit ?? 50), 1, 500)
    const rows = db.prepare(`
      SELECT txid, pool_id, symbol, sats, created_at
      FROM mint_tx
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit)
    res.json({ ok: true, mints: rows })
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) })
  }
})

// GET /v1/mints/symbol/:symbol  — filter by token symbol
router.get('/v1/mints/symbol/:symbol', (req, res) => {
  try {
    const symbol = String(req.params.symbol || '').trim().toUpperCase()
    const limit = clamp(Number(req.query.limit ?? 100), 1, 1000)
    const rows = db.prepare(`
      SELECT txid, pool_id, symbol, sats, created_at
      FROM mint_tx
      WHERE symbol = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(symbol, limit)
    res.json({ ok: true, mints: rows })
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) })
  }
})

// GET /v1/mints/pool/:poolId  — filter by pool id
router.get('/v1/mints/pool/:poolId', (req, res) => {
  try {
    const poolId = String(req.params.poolId || '')
    const limit = clamp(Number(req.query.limit ?? 100), 1, 1000)
    const rows = db.prepare(`
      SELECT txid, pool_id, symbol, sats, created_at
      FROM mint_tx
      WHERE pool_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(poolId, limit)
    res.json({ ok: true, mints: rows })
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) })
  }
})

export default router

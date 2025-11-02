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

// GET /v1/mints
router.get('/v1/mints', (req, res) => {
  try {
    const clamp = (n: number, lo: number, hi: number) =>
      Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo

    const limit = clamp(Number(req.query.limit ?? 50), 1, 500)

    // Optional filters
    const poolId = typeof req.query.poolId === 'string' ? req.query.poolId.trim() : ''
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim().toUpperCase() : ''

    // Cursor-based pagination: pass the last seen (created_at, txid) to fetch older
    const cursorCreatedAt = req.query.cursorCreatedAt ? Number(req.query.cursorCreatedAt) : 0
    const cursorTxid = typeof req.query.cursorTxid === 'string' ? req.query.cursorTxid.trim() : ''

    // Build WHERE dynamically (safe, parameterized)
    const where: string[] = []
    const params: any[] = []

    if (poolId) { where.push('m.pool_id = ?'); params.push(poolId) }
    if (symbol) { where.push('(COALESCE(m.symbol, p.symbol) = ?)'); params.push(symbol) }

    // Strict “older than cursor” for deterministic paging
    if (cursorCreatedAt && cursorTxid) {
      where.push('(m.created_at < ? OR (m.created_at = ? AND m.txid < ?))')
      params.push(cursorCreatedAt, cursorCreatedAt, cursorTxid)
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    // Join pools to backfill symbol at read time
    const rows = db.prepare(
      `
      SELECT
        m.txid,
        m.pool_id,
        COALESCE(NULLIF(m.symbol, ''), p.symbol) AS symbol,
        m.sats,
        m.created_at
      FROM mint_tx m
      LEFT JOIN pools p ON p.id = m.pool_id
      ${whereSql}
      ORDER BY m.created_at DESC, m.txid DESC
      LIMIT ?
      `
    ).all(...params, limit) as any[]

    // next cursor (older than the last row returned)
    let nextCursor: { createdAt: number; txid: string } | null = null
    if (rows.length === limit) {
      const last = rows[rows.length - 1]
      nextCursor = { createdAt: Number(last.created_at), txid: String(last.txid) }
    }

    res.json({ ok: true, mints: rows, nextCursor })
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

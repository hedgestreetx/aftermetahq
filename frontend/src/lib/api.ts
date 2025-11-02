// frontend/src/lib/api.ts
// Unified Aftermeta API client (frontend → backend)

export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') ||
  'http://localhost:3000'

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------
function rid(): string {
  // Robust UUID without deps
  // Prefer Web Crypto, fallback to timestamp+rand
  try {
    // @ts-ignore
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch {}
  return `rid-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`
}

type HeadersMap = Record<string, string | number | boolean | undefined>

// Normalize headers (skip falsy)
function makeHeaders(extra?: HeadersMap): Record<string, string> {
  const base: Record<string, string> = { 'content-type': 'application/json' }
  if (!extra) return base
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined || v === null || v === false) continue
    base[k] = String(v)
  }
  return base
}

// -----------------------------------------------------------------------------
// Core JSON wrappers
// -----------------------------------------------------------------------------
async function j<T>(
  method: string,
  path: string,
  body?: unknown,
  headers?: HeadersMap
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: makeHeaders(headers),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('application/json')) {
    const preview = await res.text().catch(() => '')
    throw new Error(
      `Non-JSON from ${path} (status ${res.status}). CT:${ct}. Preview: ${preview.slice(0, 200)}`
    )
  }

  const data = (await res.json()) as any
  if (!res.ok || data?.ok === false) {
    const err = data?.error || `HTTP ${res.status}`
    throw new Error(err)
  }
  return data as T
}

// Idempotent POST (auto adds X-Request-Id; allow caller to pass one and reuse on retry)
async function jPostIdem<T>(
  path: string,
  body: unknown,
  requestId?: string
): Promise<T> {
  const reqId = requestId || rid()
  return j<T>('POST', path, body, { 'X-Request-Id': reqId })
}

// Plain POST (no idempotency header)
async function jPost<T>(path: string, body: unknown): Promise<T> {
  return j<T>('POST', path, body)
}

// -----------------------------------------------------------------------------
// Health / Admin
// -----------------------------------------------------------------------------
export function health() {
  return j<{ ok: true }>('GET', '/health')
}

export type AdminState = {
  ok: true
  network: 'testnet' | 'mainnet'
  feePerKb: number
  minConfs: number
  flags: {
    devBuyEnabled: boolean
    requireMinConfs: number
    maxSlippageBps: number
  }
  poolAddr: string
  poolLockingScriptHexLen: number
}
export function adminState() {
  return j<AdminState>('GET', '/v1/admin/state')
}

// -----------------------------------------------------------------------------
// UTXOs (testnet passthrough)
// -----------------------------------------------------------------------------
export function getUtxos(addr: string) {
  return j<{ ok: true; utxos: Array<{ tx_hash: string; tx_pos: number; value: number }> }>(
    'GET',
    `/v1/utxos/${encodeURIComponent(addr)}`
  )
}

// -----------------------------------------------------------------------------
// Pools (create + fetch + list)
// -----------------------------------------------------------------------------
export type Pool = {
  id: string
  symbol: string
  creator: string
  poolAddress: string
  lockingScriptHex: string
  maxSupply: number
  decimals: number
  creatorReserve: number
}
export type PoolRead = {
  ok: true
  pool: Pool
  supply: { mintedSupply: number; left: number; percentMinted: number }
}

export function createPool(input: {
  id?: string
  symbol: string
  creator: string
  poolAddress: string
  lockingScriptHex: string
  maxSupply: number
  decimals: number
  creatorReserve: number
}, requestId?: string) {
  // /v1/pools is protected by idempotency → send X-Request-Id
  return jPostIdem<{ ok: true; pool: Pool; supply: { minted: number } }>(
    '/v1/pools',
    input,
    requestId
  )
}

export function getPool(id: string) {
  return j<PoolRead>('GET', `/v1/pools/${encodeURIComponent(id)}`)
}

export function listPools() {
  return j<{ ok: true; pools: (Pool & { createdAt?: number })[] }>('GET', '/v1/pools')
}

// -----------------------------------------------------------------------------
// Pricing + Orders (off-chain simulation for now)
// -----------------------------------------------------------------------------
export function quoteBuy(body: { poolId: string; spendSats: number; maxSlippageBps: number }) {
  // Quotes typically don’t use idempotency; backend doesn’t require it
  return jPost<{ ok: true; quoteId: string; price: number; expiresAt: number }>(
    '/v1/quotes/buy',
    body
  )
}

export function orderBuy(body: { quoteId: string; poolId: string; spendSats: number }, requestId?: string) {
  // /v1/orders/buy is idempotent → send X-Request-Id
  return jPostIdem<{ ok: true; orderId: string; txid: string; filledTokens: number }>(
    '/v1/orders/buy',
    body,
    requestId
  )
}

// -----------------------------------------------------------------------------
// Real on-chain mint (testnet) — must carry X-Request-Id + pool linkage
// -----------------------------------------------------------------------------
export function mintToken(body: {
  wif?: string              // optional if you mint server-side by key
  spendSats: number
  poolLockingScriptHex?: string
  poolId: string            // REQUIRED: don’t mint without it
  symbol: string            // Send it so backend can validate mismatches early
}, requestId?: string) {
  // /v1/mint is idempotent → send X-Request-Id
  return jPostIdem<{ ok: true; txid: string; poolId: string; symbol: string }>(
    '/v1/mint',
    body,
    requestId
  )
}

// -----------------------------------------------------------------------------
// Mint history (backend already backfills symbol via JOIN)
// -----------------------------------------------------------------------------
export function getMintHistory(params?: {
  limit?: number
  poolId?: string
  symbol?: string
  cursorCreatedAt?: number
  cursorTxid?: string
}) {
  const q = new URLSearchParams()
  if (params?.limit) q.set('limit', String(params.limit))
  if (params?.poolId) q.set('poolId', params.poolId)
  if (params?.symbol) q.set('symbol', params.symbol.toUpperCase())
  if (params?.cursorCreatedAt) q.set('cursorCreatedAt', String(params.cursorCreatedAt))
  if (params?.cursorTxid) q.set('cursorTxid', String(params.cursorTxid))
  const suffix = q.toString() ? `?${q.toString()}` : ''
  return j<{
    ok: true
    mints: Array<{ txid: string; pool_id: string; symbol: string; sats: number; created_at: number }>
    nextCursor?: { createdAt: number; txid: string } | null
  }>('GET', `/v1/mints${suffix}`)
}

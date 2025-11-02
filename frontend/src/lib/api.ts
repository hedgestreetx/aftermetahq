// frontend/src/lib/api.ts
// Unified Aftermeta API client (frontend → backend)

export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') ||
  'http://localhost:3000'

// -----------------------------------------------------------------------------
// Core JSON wrapper
// -----------------------------------------------------------------------------
async function j<T>(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  })

  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('application/json')) {
    const preview = await res.text()
    throw new Error(
      `Non-JSON from ${path} (status ${res.status}). CT:${ct}. Preview: ${preview.slice(0, 150)}`
    )
  }

  const data = (await res.json()) as any
  if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`)
  return data as T
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
// Pools (create + fetch)
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
}) {
  return j<{ ok: true; pool: Pool; supply: { minted: number } }>('POST', '/v1/pools', input, {
    'x-request-id': crypto.randomUUID(),
  })
}
export function getPool(id: string) {
  return j<PoolRead>('GET', `/v1/pools/${encodeURIComponent(id)}`)
}

// -----------------------------------------------------------------------------
// Pricing + Orders (off-chain simulation for now)
// -----------------------------------------------------------------------------
export function quoteBuy(body: { poolId: string; spendSats: number; maxSlippageBps: number }) {
  return j<{ ok: true; quoteId: string; price: number; expiresAt: number }>(
    'POST',
    '/v1/quotes/buy',
    body
  )
}
export function orderBuy(body: { quoteId: string; poolId: string; spendSats: number }) {
  return j<{ ok: true; orderId: string; txid: string; filledTokens: number }>(
    'POST',
    '/v1/orders/buy',
    body,
    { 'x-request-id': crypto.randomUUID() }
  )
}

// -----------------------------------------------------------------------------
// Real on-chain mint (testnet) — now carries poolId + symbol
// -----------------------------------------------------------------------------
export function mintToken(body: {
  wif: string
  spendSats: number
  poolLockingScriptHex: string
  poolId?: string
  symbol?: string
}) {
  return j<{ ok: true; txid: string }>('POST', '/v1/mint', body)
}

// -----------------------------------------------------------------------------
// Mint history (includes symbol for join-free reads)
// -----------------------------------------------------------------------------
export function getMintHistory() {
  return j<{
    ok: true
    mints: Array<{ txid: string; pool_id: string; symbol?: string; sats: number; created_at: number }>
  }>('GET', '/v1/mints')
}

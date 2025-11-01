const API_BASE = import.meta.env.VITE_API_URL || ''

async function j<T>(p: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_BASE}${p}`, init)
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data?.ok === false) {
    throw new Error(data?.error || `HTTP ${r.status}`)
  }
  return data as T
}

export type QuoteRes = { ok: true, network: string, feePerKb: number }

export async function health() {
  return j<{ ok: true, service: string, env: any }>('/health')
}

export async function adminState() {
  return j<{ ok: true, network: string, feePerKb: number, devBuyEnabled: boolean, poolLockingScriptHexLen: number, minConfs: number, poolAddr: string }>('/admin/state')
}

export async function adminPoolBalance() {
  return j<{ ok: true, poolAddress: string|null, satoshis: number }>('/admin/pool/balance')
}

export async function getUtxos(address: string) {
  return j<{ ok: true, address: string, utxos: Array<any> }>(`/api/utxos/${address}`)
}

export type DevBuyBody = { payFrom: string, spendSats: number }

export async function devBuy(body: DevBuyBody) {
  return j<{ ok: true, unsignedTxHex: string, summary: any, devBuyAllowed: boolean, network: string }>(
    '/api/dev/buy',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  )
}

export async function broadcast(raw: string) {
  return j<{ ok: true, txid: string }>('/api/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw })
  })
}

export async function txStatus(txid: string) {
  return j<{ ok: true, data: any }>(`/api/tx/${txid}`)
}

export { API_BASE }

// --- Day 11: Pools ---
export type Pool = {
  id: string
  symbol: string
  creator: string
  poolAddress: string
  lockingScriptHex: string
  createdAt: string
}

// frontend/src/lib/api.ts
export async function createPool(input: {
  symbol: string
  creator: string
  maxSupply?: number
  decimals?: number
  creatorReserve?: number
}) {
  return j('/api/pool/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
}
export async function listPools(): Promise<{ ok: true; pools: Pool[] }>{
  return j('/api/pool/list')
}

export async function getPool(id: string): Promise<{ ok: true; pool: Pool }>{
  return j(`/api/pool/${encodeURIComponent(id)}`)
}


export async function poolBuy(id: string, body: { spendSats: number }) {
  return j(`/api/pool/${encodeURIComponent(id)}/buy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

export async function poolState(id: string) {
  return j(`/api/pool/${encodeURIComponent(id)}/state`)
}

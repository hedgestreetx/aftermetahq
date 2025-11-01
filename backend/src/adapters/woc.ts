import fetch from 'node-fetch'
import { ENV } from '../lib/env.js'

const BASE = ENV.WOC_BASE // e.g., https://api.whatsonchain.com/v1/bsv/test

export async function wocAddressUtxos(address: string) {
  const r = await fetch(`${BASE}/address/${address}/unspent`)
  if (!r.ok) throw new Error(`woc utxos http ${r.status}`)
  return await r.json() as Array<{ tx_hash: string, tx_pos: number, value: number, height: number }>
}

export async function wocBroadcastTx(rawhex: string) {
  const r = await fetch(`${BASE}/tx/raw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txhex: rawhex })
  })
  if (!r.ok) {
    const txt = await r.text()
    throw new Error(`woc broadcast http ${r.status}: ${txt}`)
  }
  return await r.json() as string // txid
}

export async function wocTx(txid: string) {
  const r = await fetch(`${BASE}/tx/hash/${txid}`)
  if (!r.ok) throw new Error(`woc tx http ${r.status}`)
  return await r.json()
}

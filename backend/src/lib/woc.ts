async function broadcastRawTx(raw: string) {
  const r = await fetch('https://api.whatsonchain.com/v1/bsv/test/tx/raw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txhex: raw }),
  })
  const text = (await r.text()).trim()
  if (!r.ok) throw new Error(`woc_broadcast_http_${r.status} ${text}`)

  // WOC sometimes returns a quoted string. Strip quotes, then validate.
  const txid = text.replace(/^"+|"+$/g, '')
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
    throw new Error(`woc_broadcast_bad_txid "${text}"`)
  }
  return txid.toLowerCase()
}

// in /v1/mint after you build/sign tx:
const raw = tx.serialize(true)
const txid = await broadcastRawTx(raw)   // <-- throws if bogus
db.prepare(`INSERT INTO mint_tx (txid, pool_id, symbol, sats, created_at)
            VALUES (?, ?, ?, ?, ?)`)
  .run(txid, pid, sym, Math.trunc(spendSats), Date.now())
res.json({ ok: true, txid, poolId: pid, symbol: sym })

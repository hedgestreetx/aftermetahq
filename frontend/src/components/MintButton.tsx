import React, { useState } from 'react'
import { mintToken } from '@/lib/api'

export default function MintButton({ pool }: { pool: any }) {
  const [busy, setBusy] = useState(false)
  const [txid, setTxid] = useState('')
  const [error, setError] = useState('')
  const [spend, setSpend] = useState<number>(5000)
  const [wif, setWif] = useState<string>('')

  async function onMint() {
    if (!wif || spend <= 0) {
      setError('Missing WIF or spend amount')
      return
    }

    setBusy(true)
    setError('')
    setTxid('')

    try {
      const res = await mintToken({
        wif,
        spendSats: spend,
        poolLockingScriptHex: pool.lockingScriptHex,
        poolId: pool.id,
        symbol: pool.symbol, // ✅ now tracks token name for history
      })
      setTxid(res.txid)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        background: '#f0f4ff',
        padding: 10,
        borderRadius: 8,
        marginTop: 8,
      }}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        <input
          type="text"
          placeholder="Enter WIF key"
          value={wif}
          onChange={(e) => setWif(e.target.value)}
          style={{ flex: 1, minWidth: 180 }}
        />
        <input
          type="number"
          placeholder="Spend (sats)"
          value={spend}
          onChange={(e) => setSpend(Number(e.target.value || 0))}
          style={{ width: 100 }}
        />
        <button onClick={onMint} disabled={busy || !wif || spend <= 0}>
          {busy ? 'Minting…' : 'Mint'}
        </button>
      </div>

      {error && (
        <div style={{ color: 'red', fontSize: 12, marginTop: 4 }}>{error}</div>
      )}

      {txid && (
        <div style={{ fontSize: 12, color: 'green', marginTop: 4 }}>
          ✅ TX:&nbsp;
          <a
            href={`https://test.whatsonchain.com/tx/${txid}`}
            target="_blank"
            rel="noreferrer"
          >
            {txid.slice(0, 10)}…
          </a>
        </div>
      )}

      <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
        Pool: <strong>{pool.symbol}</strong> ({pool.id})
      </div>
    </div>
  )
}

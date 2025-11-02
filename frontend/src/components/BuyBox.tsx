import React, { useEffect, useMemo, useState } from 'react'
import { quoteBuy, orderBuy, mintToken } from '@/lib/api'

export default function BuyBox({ poolId }: { poolId: string }) {
  const [spend, setSpend] = useState<number>(1000)
  const [slip, setSlip] = useState<number>(100) // bps = 1%
  const [quote, setQuote] = useState<{ quoteId: string; price: number; expiresAt: number } | null>(null)
  const [error, setError] = useState<string>('')
  const [log, setLog] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [realMint, setRealMint] = useState(false)

  // time-to-live countdown for quote
  const ttl = useMemo(() => {
    if (!quote) return 0
    return Math.max(0, Math.floor((quote.expiresAt - Date.now()) / 1000))
  }, [quote])

  useEffect(() => {
    if (!quote) return
    const t = setInterval(() => {
      if (quote && quote.expiresAt <= Date.now()) setQuote(null)
    }, 500)
    return () => clearInterval(t)
  }, [quote])

  // ---------------------------------------------------------------------------
  async function getQuote() {
    setError('')
    setLog('')
    setQuote(null)
    try {
      const q = await quoteBuy({ poolId, spendSats: spend, maxSlippageBps: slip })
      setQuote({ quoteId: q.quoteId, price: q.price, expiresAt: q.expiresAt })
    } catch (e: any) {
      setError(String(e?.message || e))
    }
  }

  async function placeOrder() {
    if (!quote) return
    setBusy(true)
    setError('')
    setLog('')
    try {
      const res = await orderBuy({ quoteId: quote.quoteId, poolId, spendSats: spend })
      setLog(`✅ TX: ${res.txid}  • Filled: ${res.filledTokens}`)
      setQuote(null)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Real on-chain mint
  async function handleMint() {
    setBusy(true)
    setError('')
    setLog('')
    try {
      const wif = prompt('Enter your testnet WIF:')
      const script = prompt('Enter the pool locking script hex:')
      if (!wif || !script) throw new Error('Missing WIF or script.')
      const res = await mintToken({
        wif,
        spendSats: spend,
        poolLockingScriptHex: script,
      })
      setLog(`✅ Minted! TXID: ${res.txid}`)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  // ---------------------------------------------------------------------------
  return (
    <div style={{ background: '#f0f4ff', padding: 16, borderRadius: 8 }}>
      <h3 style={{ marginTop: 0 }}>Buy Tokens</h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <input
          type="number"
          placeholder="Spend (sats)"
          value={spend}
          onChange={(e) => setSpend(Number(e.target.value || 0))}
        />
        <input
          type="number"
          placeholder="Max Slippage (bps)"
          value={slip}
          onChange={(e) => setSlip(Number(e.target.value || 0))}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button onClick={getQuote}>Get Quote</button>
        <button onClick={placeOrder} disabled={!quote || busy}>
          {busy ? 'Buying…' : `Buy${quote ? ` (expires in ${ttl}s)` : ''}`}
        </button>
        <button
          style={{
            background: '#2b7a0b',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            padding: '4px 10px',
            cursor: 'pointer',
          }}
          onClick={handleMint}
          disabled={busy}
        >
          🚀 Real Mint
        </button>
      </div>

      {error && <div style={{ color: 'red' }}>{error}</div>}
      {quote && <pre style={{ fontSize: 12, marginTop: 6 }}>{JSON.stringify(quote, null, 2)}</pre>}
      {log && (
        <pre
          style={{
            fontSize: 12,
            marginTop: 6,
            background: '#e7f5ff',
            padding: 8,
            borderRadius: 4,
          }}
        >
          {log}
        </pre>
      )}
      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>Pool: {poolId}</div>
    </div>
  )
}

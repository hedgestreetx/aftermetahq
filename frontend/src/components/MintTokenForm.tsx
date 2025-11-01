import React from 'react'
import { createPool } from '@/lib/api'

export default function MintTokenForm() {
  const [symbol, setSymbol] = React.useState('')
  const [creator, setCreator] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [logs, setLogs] = React.useState<string[]>([])

  function log(s: string) {
    setLogs(prev => [`${new Date().toLocaleTimeString()}: ${s}`, ...prev])
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const s = symbol.trim().toUpperCase()
    const c = creator.trim()
    if (!s) return log('Mint err: symbol is required')
    if (!/^[A-Z0-9]{2,12}$/.test(s)) return log('Mint err: symbol must be 2–12 chars [A-Z0-9]')
    if (!c) return log('Mint err: creator is required (wallet or handle)')
    setBusy(true)
    try {
      const { pool } = await createPool({ symbol: s, creator: c })
      log(`Mint ok: ${pool.symbol} — poolId=${pool.id} addr=${pool.poolAddress}`)
      // clear form
      setSymbol('')
      setCreator('')
      // optional: copy to clipboard
      try { await navigator.clipboard.writeText(pool.id) } catch {}
    } catch (e: any) {
      log(`Mint err: ${String(e?.message || e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ border: '1px solid #ddd', padding: 16, borderRadius: 8 }}>
      <h3>Mint Token</h3>
      <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input
          style={{ width: 160, padding: 8 }}
          placeholder="SYMBOL (e.g. DOGE)"
          value={symbol}
          onChange={e => setSymbol(e.target.value)}
          spellCheck={false}
          maxLength={12}
        />
        <input
          style={{ flex: 1, padding: 8 }}
          placeholder="Creator identifier (wallet or username)"
          value={creator}
          onChange={e => setCreator(e.target.value)}
          spellCheck={false}
        />
        <button type="submit" disabled={busy}>{busy ? 'Minting…' : 'Mint'}</button>
      </form>

      <div style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 180, overflow: 'auto', background: '#fafafa', padding: 8 }}>
        {logs.length === 0 ? <div>Logs will appear here…</div> : logs.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  )
}

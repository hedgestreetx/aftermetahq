import React from 'react'
import { createPool } from '@/lib/api'

export default function MintTokenForm() {
  const [symbol, setSymbol] = React.useState('')
  const [creator, setCreator] = React.useState('')

  // new fields
  const [maxSupply, setMaxSupply] = React.useState<number>(1_000_000)
  const [decimals, setDecimals] = React.useState<number>(8)
  const [creatorReserve, setCreatorReserve] = React.useState<number>(0)

  const [busy, setBusy] = React.useState(false)
  const [logs, setLogs] = React.useState<string[]>([])

  function log(s: string) {
    setLogs(prev => [`${new Date().toLocaleTimeString()}: ${s}`, ...prev])
  }

  function clampInt(n: number, lo: number, hi: number) {
    if (!Number.isFinite(n)) return lo
    return Math.min(hi, Math.max(lo, Math.trunc(n)))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const s = symbol.trim().toUpperCase()
    const c = creator.trim()

    if (!s) return log('Mint err: symbol is required')
    if (!/^[A-Z0-9]{2,12}$/.test(s)) return log('Mint err: symbol must be 2–12 chars [A-Z0-9]')
    if (!c) return log('Mint err: creator is required (wallet or handle)')

    const cap = clampInt(Number(maxSupply), 1, 10_000_000_000)
    const dec = clampInt(Number(decimals), 0, 18)
    const reserve = clampInt(Number(creatorReserve), 0, cap)

    if (reserve > cap) return log('Mint err: creator reserve cannot exceed max supply')

    setBusy(true)
    try {
      const { pool } = await createPool({
        symbol: s,
        creator: c,
        maxSupply: cap,
        decimals: dec,
        creatorReserve: reserve
      })
      log(
        `Mint ok: ${pool.symbol} — poolId=${pool.id} addr=${pool.poolAddress} ` +
        `(cap=${pool.maxSupply}, dec=${pool.decimals}, reserve=${pool.creatorReserve})`
      )

      // reset sensible defaults
      setSymbol('')
      setCreator('')
      setMaxSupply(1_000_000)
      setDecimals(8)
      setCreatorReserve(0)

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

      <form onSubmit={onSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, marginBottom: 8 }}>
        <div style={{ display: 'flex', gap: 8 }}>
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
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#555' }}>Max Supply</span>
            <input
              type="number"
              min={1}
              max={10_000_000_000}
              step={1}
              value={maxSupply}
              onChange={e => setMaxSupply(Number(e.target.value))}
              style={{ padding: 8, width: 180 }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#555' }}>Decimals</span>
            <input
              type="number"
              min={0}
              max={18}
              step={1}
              value={decimals}
              onChange={e => setDecimals(Number(e.target.value))}
              style={{ padding: 8, width: 120 }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            <span style={{ fontSize: 12, color: '#555' }}>Creator Reserve</span>
            <input
              type="number"
              min={0}
              max={Math.max(0, Number(maxSupply) || 0)}
              step={1}
              value={creatorReserve}
              onChange={e => setCreatorReserve(Number(e.target.value))}
              style={{ padding: 8 }}
            />
          </label>

          <button type="submit" disabled={busy} style={{ alignSelf: 'flex-end', height: 40 }}>
            {busy ? 'Minting…' : 'Mint'}
          </button>
        </div>
      </form>

      <div
        style={{
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          fontSize: 12,
          maxHeight: 180,
          overflow: 'auto',
          background: '#fafafa',
          padding: 8
        }}
      >
        {logs.length === 0 ? <div>Logs will appear here…</div> : logs.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  )
}

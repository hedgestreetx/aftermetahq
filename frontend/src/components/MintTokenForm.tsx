import React from 'react'
import { createPool } from '@/lib/api'

export default function MintTokenForm() {
  const [symbol, setSymbol] = React.useState('')
  const [name, setName] = React.useState('') // optional metadata
  const [creator, setCreator] = React.useState('')

  // supply + precision
  const [maxSupply, setMaxSupply] = React.useState<number>(1_000_000)
  const [decimals, setDecimals] = React.useState<number>(8)
  const [creatorReserve, setCreatorReserve] = React.useState<number>(0)

  // curve params (dev defaults: safe + cheap for testing)
  const [basePrice, setBasePrice] = React.useState<number>(10)     // sats / token at start
  const [slope, setSlope] = React.useState<number>(0.01)           // sats increase per token

  // optional metadata (ignored server-side unless you wire it)
  const [imageUrl, setImageUrl] = React.useState('')
  const [website, setWebsite] = React.useState('')
  const [description, setDescription] = React.useState('')

  const [busy, setBusy] = React.useState(false)
  const [logs, setLogs] = React.useState<string[]>([])

  function log(s: string) {
    setLogs(prev => [`${new Date().toLocaleTimeString()}: ${s}`, ...prev])
  }

  function clampInt(n: number, lo: number, hi: number) {
    if (!Number.isFinite(n)) return lo
    return Math.min(hi, Math.max(lo, Math.trunc(n)))
  }

  const reservePct =
    maxSupply > 0 ? Math.min(100, Math.max(0, (Number(creatorReserve) / Number(maxSupply)) * 100)) : 0

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

    // curve sanity
    const base = Number.isFinite(basePrice) && basePrice >= 0 ? basePrice : 0
    const slp = Number.isFinite(slope) && slope >= 0 ? slope : 0

    setBusy(true)
    try {
      // Pass-through extras; backend can start persisting when ready.
      const { pool } = await createPool({
        symbol: s,
        creator: c,
        maxSupply: cap,
        decimals: dec,
        creatorReserve: reserve,
        // optional metadata/params:
        name: name.trim() || undefined,
        imageUrl: imageUrl.trim() || undefined,
        website: website.trim() || undefined,
        description: description.trim() || undefined,
        basePrice,
        slope
      } as any)

      log(
        `Mint ok: ${pool.symbol} — poolId=${pool.id} addr=${pool.poolAddress} ` +
          `(cap=${pool.maxSupply}, dec=${pool.decimals}, reserve=${pool.creatorReserve})`
      )

      // reset sensible defaults
      setSymbol('')
      setName('')
      setCreator('')
      setMaxSupply(1_000_000)
      setDecimals(8)
      setCreatorReserve(0)
      setBasePrice(10)
      setSlope(0.01)
      setImageUrl('')
      setWebsite('')
      setDescription('')

      try {
        await navigator.clipboard.writeText(pool.id)
      } catch {}
    } catch (e: any) {
      log(`Mint err: ${String(e?.message || e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ border: '1px solid #ddd', padding: 16, borderRadius: 8 }}>
      <h3>Mint Token</h3>

      <form onSubmit={onSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginBottom: 10 }}>
        {/* Row 1: identity */}
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#555' }}>Symbol</span>
            <input
              style={{ width: 160, padding: 8 }}
              placeholder="SYMBOL (e.g. DOGE)"
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
              spellCheck={false}
              maxLength={12}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            <span style={{ fontSize: 12, color: '#555' }}>Name (optional)</span>
            <input
              style={{ padding: 8 }}
              placeholder="Friendly name (shown to users)"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            <span style={{ fontSize: 12, color: '#555' }}>Creator</span>
            <input
              style={{ padding: 8 }}
              placeholder="Creator identifier (wallet or username)"
              value={creator}
              onChange={e => setCreator(e.target.value)}
              spellCheck={false}
            />
          </label>
        </div>

        {/* Row 2: supply/precision/reserve */}
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
            <span style={{ fontSize: 12, color: '#555' }}>
              Creator Reserve <span style={{ color: '#888' }}>({reservePct.toFixed(2)}%)</span>
            </span>
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
        </div>

        {/* Row 3: curve params */}
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#555' }}>Base Price (sats/token)</span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={basePrice}
              onChange={e => setBasePrice(Number(e.target.value))}
              style={{ padding: 8, width: 200 }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#555' }}>Slope (sats increase per token)</span>
            <input
              type="number"
              min={0}
              step={0.0001}
              value={slope}
              onChange={e => setSlope(Number(e.target.value))}
              style={{ padding: 8, width: 240 }}
            />
          </label>

          <button type="submit" disabled={busy} style={{ alignSelf: 'flex-end', height: 40, padding: '0 16px' }}>
            {busy ? 'Minting…' : 'Mint'}
          </button>
        </div>

        {/* Row 4: optional metadata */}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ flex: 2, padding: 8 }}
            placeholder="Image URL (optional)"
            value={imageUrl}
            onChange={e => setImageUrl(e.target.value)}
          />
          <input
            style={{ flex: 2, padding: 8 }}
            placeholder="Website (optional)"
            value={website}
            onChange={e => setWebsite(e.target.value)}
          />
        </div>

        <textarea
          style={{ padding: 8, minHeight: 80, resize: 'vertical' as const }}
          placeholder="Description (optional)"
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </form>

      {/* Preview */}
      <div style={{ border: '1px dashed #ddd', padding: 12, borderRadius: 8, marginBottom: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Preview</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
          <div>
            <div><b>Symbol</b>: {symbol || '—'}</div>
            <div><b>Name</b>: {name || '—'}</div>
            <div><b>Creator</b>: {creator || '—'}</div>
          </div>
          <div>
            <div><b>Supply</b>: {maxSupply.toLocaleString()} (reserve {creatorReserve.toLocaleString()} • {reservePct.toFixed(2)}%)</div>
            <div><b>Decimals</b>: {decimals}</div>
            <div><b>Curve</b>: base {basePrice} sats, slope {slope} sats/token</div>
          </div>
        </div>
        {(imageUrl || website || description) && (
          <div style={{ marginTop: 8, fontSize: 12 }}>
            {imageUrl && <div><b>Image</b>: {imageUrl}</div>}
            {website && <div><b>Website</b>: {website}</div>}
            {description && <div style={{ whiteSpace: 'pre-wrap' }}><b>About</b>: {description}</div>}
          </div>
        )}
      </div>

      <div
        style={{
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          fontSize: 12,
          maxHeight: 220,
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

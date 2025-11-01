import React from 'react'
import { listPools, type Pool, poolBuy, poolState } from '@/lib/api'

export default function PoolList() {
  const [pools, setPools] = React.useState<Pool[]>([])
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [spend, setSpend] = React.useState<Record<string, number>>({})
  const [balances, setBalances] = React.useState<Record<string, { sats: number; utxos: number }>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [logs, setLogs] = React.useState<string[]>([])

  function log(s: string) { setLogs(prev => [`${new Date().toLocaleTimeString()}: ${s}`, ...prev]) }

  async function load() {
    setError(null)
    try {
      const r = await listPools()
      setPools(r.pools)
      // fetch balances for each
      const next: Record<string, { sats: number; utxos: number }> = {}
      await Promise.all(r.pools.map(async p => {
        try {
          const s = await poolState(p.id)
          next[p.id] = { sats: s.balanceSats, utxos: s.utxoCount }
        } catch { /* ignore */ }
      }))
      setBalances(next)
    } catch (e: any) {
      setError(String(e?.message || e))
    }
  }

  React.useEffect(() => { load() }, [])

  async function onBuy(p: Pool) {
    const amt = spend[p.id] ?? 1000
    if (!amt || amt <= 0) { log(`Buy err: invalid sats for ${p.symbol}`); return }
    setBusyId(p.id)
    try {
      const r = await poolBuy(p.id, { spendSats: amt })
      log(`Buy ok [${p.symbol}] txid=${r.txid} fee=${r.feePaid} sats`)
      // refresh balance
      const s = await poolState(p.id)
      setBalances(prev => ({ ...prev, [p.id]: { sats: s.balanceSats, utxos: s.utxoCount } }))
    } catch (e: any) {
      log(`Buy err [${p.symbol}]: ${String(e?.message || e)}`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={{ border: '1px solid #ddd', padding: 16, borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Pools</h3>
        <button onClick={load}>Refresh</button>
      </div>

      {error && <div style={{ color: '#b00020', marginBottom: 8 }}>Error: {error}</div>}

      {pools.length === 0 ? (
        <div style={{ color: '#666' }}>No pools yet. Mint one.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 12 }}>
          {pools.map(p => {
            const bal = balances[p.id]
            const val = spend[p.id] ?? 1000
            return (
              <div key={p.id} style={{ border: '1px solid #eee', borderRadius: 8, padding: 12, background: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontWeight: 700 }}>{p.symbol}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    bal: {bal ? `${bal.sats} sats (${bal.utxos} utxos)` : '…'}
                  </div>
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#444', marginBottom: 8 }}>
                  addr: {p.poolAddress}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    style={{ width: 140, padding: 8 }}
                    type="number"
                    min={1}
                    value={val}
                    onChange={e => setSpend(prev => ({ ...prev, [p.id]: parseInt(e.target.value || '0', 10) }))}
                  />
                  <button onClick={() => onBuy(p)} disabled={busyId === p.id}>
                    {busyId === p.id ? 'Buying…' : 'Buy sats → pool'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 200, overflow: 'auto', background: '#fafafa', padding: 8, marginTop: 12 }}>
        {logs.length === 0 ? <div>Logs will appear here…</div> : logs.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  )
}

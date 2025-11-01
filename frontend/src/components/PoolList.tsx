import React from 'react'
import { listPools, type Pool } from '@/lib/api'

export default function PoolList() {
  const [pools, setPools] = React.useState<Pool[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const r = await listPools()
      setPools(r.pools)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => { load() }, [])

  return (
    <div style={{ border: '1px solid #ddd', padding: 16, borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Pools</h3>
        <button onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      {error && <div style={{ color: '#b00020', marginBottom: 8 }}>Error: {error}</div>}

      {pools.length === 0 ? (
        <div style={{ color: '#666' }}>No pools yet. Mint one.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {pools.map(p => (
            <div key={p.id} style={{ border: '1px solid #eee', borderRadius: 8, padding: 12, background: '#fff' }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.symbol}</div>
              <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#444' }}>id: {p.id}</div>
              <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#444' }}>addr: {p.poolAddress}</div>
              <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>creator: {p.creator}</div>
              <div style={{ fontSize: 12, color: '#666' }}>created: {new Date(p.createdAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

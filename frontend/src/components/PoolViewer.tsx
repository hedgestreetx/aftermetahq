import React, { useState } from 'react'
import { getPool } from '@/lib/api'

export default function PoolViewer({ onLoaded }: { onLoaded: (poolId: string) => void }) {
  const [poolId, setPoolId] = useState('')
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string>('')

  async function load() {
    setError(''); setData(null)
    try {
      const res = await getPool(poolId.trim())
      setData(res)
      onLoaded(res.pool.id)
    } catch (e: any) {
      setError(String(e?.message || e))
    }
  }

  return (
    <div style={{ background: '#f5f5f5', padding: 16, borderRadius: 8 }}>
      <h3 style={{ marginTop: 0 }}>Pool Viewer</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input placeholder="Pool ID" value={poolId} onChange={e => setPoolId(e.target.value)} style={{ flex: 1 }} />
        <button onClick={load}>Load</button>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      {data && <pre style={{ fontSize: 12 }}>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  )
}

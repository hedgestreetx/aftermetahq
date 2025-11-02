import React, { useEffect, useState } from 'react'
import { getPool } from '@/lib/api'
import MintButton from '@/components/MintButton'

export default function PoolList() {
  const [poolIds, setPoolIds] = useState<string[]>([])
  const [pools, setPools] = useState<any[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  // STEP 1: fetch all pool IDs
  useEffect(() => {
    async function fetchPools() {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/v1/pools`)
        const data = await res.json()
        if (data?.ok && Array.isArray(data.pools)) {
          setPoolIds(data.pools.map((p: any) => p.id))
        } else {
          throw new Error('Unexpected pool list format')
        }
      } catch (e: any) {
        setError(String(e?.message || e))
      } finally {
        setLoading(false)
      }
    }
    fetchPools()
  }, [])

  // STEP 2: fetch detailed data for each pool
  useEffect(() => {
    if (!poolIds.length) return
    async function loadDetails() {
      try {
        const results = await Promise.all(poolIds.map((id) => getPool(id)))
        setPools(results.map((r) => r.pool))
      } catch (e: any) {
        setError(String(e?.message || e))
      }
    }
    loadDetails()
  }, [poolIds])

  // STEP 3: render states
  if (loading) return <div>Loading pools…</div>
  if (error) return <div style={{ color: 'red' }}>Error: {error}</div>
  if (!pools.length) return <div>No pools found.</div>

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ marginBottom: 12 }}>Active Pools</h3>
      {pools.map((p) => (
        <div
          key={p.id}
          style={{
            border: '1px solid #ccc',
            borderRadius: 8,
            padding: 12,
            marginBottom: 12,
            background: '#fafafa',
          }}
        >
          <div>
            <strong>{p.symbol}</strong> by {p.creator}
          </div>

          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
            {p.maxSupply.toLocaleString()} total supply · {p.decimals} decimals
          </div>

          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
            Pool Address: <code>{p.poolAddress}</code>
          </div>

          <MintButton pool={p} />
        </div>
      ))}
    </div>
  )
}

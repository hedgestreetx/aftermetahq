import React, { useState } from 'react'
import { createPool } from '@/lib/api'

export default function MintTokenForm({ onCreated }: { onCreated: (poolId: string) => void }) {
  const [symbol, setSymbol] = useState('')
  const [creator, setCreator] = useState('')
  const [poolAddress, setPoolAddress] = useState('')
  const [lockingScriptHex, setLockingScriptHex] = useState('')
  const [maxSupply, setMaxSupply] = useState<number>(1_000_000)
  const [decimals, setDecimals] = useState<number>(8)
  const [creatorReserve, setCreatorReserve] = useState<number>(0)

  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState('')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setLog('')
    try {
      if (!symbol || !creator || !poolAddress || !lockingScriptHex) throw new Error('Fill all required fields')
      const { pool } = await createPool({ symbol, creator, poolAddress, lockingScriptHex, maxSupply, decimals, creatorReserve })
      setLog(`✅ Pool created: ${pool.id}`)
      onCreated(pool.id)
    } catch (e: any) {
      setLog(`❌ ${String(e?.message || e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ background: '#f9f9f9', padding: 16, borderRadius: 8 }}>
      <h3 style={{ marginTop: 0 }}>Mint Token (Create Pool)</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input placeholder="Symbol*" value={symbol} onChange={e => setSymbol(e.target.value)} />
        <input placeholder="Creator*" value={creator} onChange={e => setCreator(e.target.value)} />
        <input placeholder="Pool Address*" value={poolAddress} onChange={e => setPoolAddress(e.target.value)} />
        <input placeholder="Locking Script Hex*" value={lockingScriptHex} onChange={e => setLockingScriptHex(e.target.value)} />
        <input type="number" placeholder="Max Supply" value={maxSupply} onChange={e => setMaxSupply(Number(e.target.value || 0))} />
        <input type="number" placeholder="Decimals" value={decimals} onChange={e => setDecimals(Number(e.target.value || 0))} />
        <input type="number" placeholder="Creator Reserve" value={creatorReserve} onChange={e => setCreatorReserve(Number(e.target.value || 0))} />
      </div>
      <div style={{ marginTop: 10 }}>
        <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create Pool'}</button>
      </div>
      {log && <pre style={{ fontSize: 12, marginTop: 8 }}>{log}</pre>}
    </form>
  )
}

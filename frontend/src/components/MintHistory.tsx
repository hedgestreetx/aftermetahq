import React, { useEffect, useMemo, useState } from 'react'
import { getMintHistory, txStatus, getPool, type Pool } from '@/lib/api'

type MintRow = {
  txid: string
  poolId: string
  symbol: string | null
  sats: number
  createdAtMs: number
  confirmedAtMs?: number | null
}
type Status = { confirmed: boolean; checking: boolean }

function toMs(v: any): number {
  const n = Number(v || 0)
  if (!Number.isFinite(n)) return 0
  return n < 2_000_000_000 ? n * 1000 : n
}
function norm(r: any): MintRow | null {
  if (!r) return null
  const txid = String(r.txid || r.txId || '')
  if (!txid) return null
  return {
    txid,
    poolId: String(r.pool_id ?? r.poolId ?? r.poolID ?? ''),
    symbol: r.symbol ? String(r.symbol).toUpperCase() : null,
    sats: Number(r.sats ?? r.satoshis ?? r.spendSats ?? r.amountSats ?? 0) || 0,
    createdAtMs: toMs(r.created_at ?? r.createdAt ?? r.time ?? Date.now()),
    confirmedAtMs:
      r.confirmed_at != null || r.confirmedAt != null
        ? toMs(r.confirmed_at ?? r.confirmedAt)
        : undefined,
  }
}

export default function MintHistory() {
  const [rows, setRows] = useState<MintRow[]>([])
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const [network, setNetwork] = useState<'testnet' | 'mainnet'>('testnet')
  useEffect(() => {
    const onAdmin = (e: Event) => {
      const ce = e as CustomEvent<{ network?: 'testnet' | 'mainnet' }>
      if (ce?.detail?.network) setNetwork(ce.detail.network)
    }
    window.addEventListener('aftermeta:admin', onAdmin as EventListener)
    return () => window.removeEventListener('aftermeta:admin', onAdmin as EventListener)
  }, [])
  const wocBase = network === 'mainnet'
    ? 'https://whatsonchain.com/tx/'
    : 'https://test.whatsonchain.com/tx/'

  const rowsById = useMemo(() => {
    const m = new Map<string, MintRow>()
    for (const r of rows) m.set(r.txid, r)
    return m
  }, [rows])

  async function hydrateSymbols(poolIds: string[]) {
    const unique = Array.from(new Set(poolIds.filter(Boolean)))
    await Promise.all(unique.map(async pid => {
      try {
        const res = await getPool(pid)
        const pool: Pool = (res as any).pool || (res as any)
        if (!pool?.id) return
        setRows(prev => prev.map(r =>
          r.poolId === pool.id && !r.symbol ? { ...r, symbol: (pool.symbol || '').toUpperCase() } : r
        ))
      } catch { /* ignore */ }
    }))
  }

  async function fetchLatest() {
    try {
      setError('')
      const res: any = await getMintHistory({ limit: 50 })

      // tolerate multiple shapes
      const list =
        (Array.isArray(res.mints) && res.mints) ||
        (Array.isArray(res.rows) && res.rows) ||
        (Array.isArray(res.items) && res.items) ||
        []

      const incoming = list.map(norm).filter(Boolean) as MintRow[]
      if (!incoming.length) { setLoading(false); return }

      setRows(prev => {
        const map = new Map<string, MintRow>()
        for (const r of prev) map.set(r.txid, r)
        for (const r of incoming) {
          const ex = map.get(r.txid)
          if (!ex) map.set(r.txid, r)
          else {
            map.set(r.txid, {
              ...ex,
              ...r,
              confirmedAtMs: ex.confirmedAtMs || r.confirmedAtMs,
              createdAtMs: Math.min(ex.createdAtMs, r.createdAtMs),
            })
          }
        }
        return Array.from(map.values()).sort((a, b) => b.createdAtMs - a.createdAtMs)
      })

      setStatus(prev => {
        const next = { ...prev }
        for (const r of incoming) {
          if (!next[r.txid]) next[r.txid] = { confirmed: !!r.confirmedAtMs, checking: !r.confirmedAtMs }
        }
        return next
      })

      const missingPools = incoming.filter(r => !r.symbol && r.poolId).map(r => r.poolId)
      if (missingPools.length) hydrateSymbols(missingPools)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  // initial + periodic refresh
  useEffect(() => { fetchLatest() }, [])
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchLatest()
    }, 8000)
    return () => clearInterval(id)
  }, [])

  // event-driven: new mint or tx broadcast
  useEffect(() => {
    const onMint = (e: Event) => {
      const ce = e as CustomEvent<{ txid?: string; poolId?: string; symbol?: string; sats?: number }>
      const txid = ce?.detail?.txid
      if (!txid) return
      const now = Date.now()
      setRows(prev => {
        if (prev.find(r => r.txid === txid)) return prev
        const sym = ce.detail?.symbol ? String(ce.detail.symbol).toUpperCase() : null
        const row: MintRow = {
          txid,
          poolId: ce.detail?.poolId || '',
          symbol: sym,
          sats: Number(ce.detail?.sats || 0),
          createdAtMs: now,
          confirmedAtMs: undefined,
        }
        return [row, ...prev]
      })
      setStatus(prev => ({ ...prev, [txid]: { confirmed: false, checking: true } }))
      // also kick a fetch to pull server copy
      fetchLatest()
    }
    window.addEventListener('aftermeta:mint', onMint as EventListener)
    window.addEventListener('aftermeta:tx', onMint as EventListener)
    return () => {
      window.removeEventListener('aftermeta:mint', onMint as EventListener)
      window.removeEventListener('aftermeta:tx', onMint as EventListener)
    }
  }, [])

  // poll status for pending only
  useEffect(() => {
    const tick = async () => {
      const pending = rows.filter(r => !(status[r.txid]?.confirmed))
      for (const m of pending) {
        try {
          setStatus(s => ({ ...s, [m.txid]: { ...(s[m.txid] || { confirmed: false, checking: true }), checking: true } }))
          const s = await txStatus(m.txid)
          setStatus(prev => ({ ...prev, [m.txid]: { confirmed: !!s.confirmed, checking: false } }))
          if (s.confirmed) {
            setRows(prev => prev.map(x => x.txid === m.txid ? { ...x, confirmedAtMs: Date.now() } : x))
          }
        } catch {
          setStatus(prev => ({ ...prev, [m.txid]: { confirmed: false, checking: false } }))
        }
      }
    }
    const id = setInterval(tick, 12000)
    const kick = setTimeout(tick, 1500)
    return () => { clearInterval(id); clearTimeout(kick) }
  }, [rows, status])

  if (loading && rows.length === 0) return <div>Loading mint history…</div>
  if (error && rows.length === 0) return <div style={{ color: 'red' }}>Error: {error}</div>
  if (!rows.length) return <div style={{ opacity: 0.6 }}>No mints recorded yet.</div>

  const badge = (m: MintRow) => {
    const s = status[m.txid]
    if (s?.confirmed) return <span style={{ padding: '2px 6px', borderRadius: 6, background: '#DCFCE7', color: '#166534' }}>Confirmed</span>
    if (s?.checking)  return <span style={{ padding: '2px 6px', borderRadius: 6, background: '#FEF9C3', color: '#854D0E' }}>Pending…</span>
    return <span style={{ padding: '2px 6px', borderRadius: 6, background: '#FFE4E6', color: '#9F1239' }}>Unknown</span>
  }

  return (
    <div style={{ background: '#f9f9ff', padding: 16, borderRadius: 8 }}>
      <h3 style={{ marginTop: 0 }}>Recent Mint Transactions</h3>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
            <th style={{ padding: 6 }}>TXID</th>
            <th style={{ padding: 6 }}>Pool</th>
            <th style={{ padding: 6 }}>Symbol</th>
            <th style={{ padding: 6, textAlign: 'right' }}>Sats</th>
            <th style={{ padding: 6 }}>Time</th>
            <th style={{ padding: 6 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.txid} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 6 }}>
                <a href={`${wocBase}${m.txid}`} target="_blank" rel="noreferrer">
                  {m.txid.slice(0, 10)}…
                </a>
              </td>
              <td style={{ padding: 6 }}>{m.poolId || '—'}</td>
              <td style={{ padding: 6 }}>{m.symbol || '—'}</td>
              <td style={{ padding: 6, textAlign: 'right' }}>{m.sats.toLocaleString()}</td>
              <td style={{ padding: 6 }}>{new Date(m.createdAtMs).toLocaleString()}</td>
              <td style={{ padding: 6 }}>{badge(m)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 8 }}>Error: {error}</div>}
    </div>
  )
}

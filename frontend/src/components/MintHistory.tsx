import React, { useEffect, useState } from 'react'
import { getMintHistory, txStatus } from '@/lib/api'

type MintRow = {
  txid: string
  pool_id: string
  symbol: string
  sats: number
  created_at: number
  confirmed_at?: number
}

type Status = { confirmed: boolean; checking: boolean }

export default function MintHistory() {
  const [mints, setMints] = useState<MintRow[]>([])
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  // initial load
  useEffect(() => {
    getMintHistory()
      .then((res) => {
        const ms = res.mints as MintRow[]
        setMints(ms)
        // seed status map
        const st: Record<string, Status> = {}
        for (const m of ms) {
          st[m.txid] = { confirmed: Boolean(m.confirmed_at), checking: !m.confirmed_at }
        }
        setStatus(st)
      })
      .catch(e => setError(String(e?.message || e)))
      .finally(() => setLoading(false))
  }, [])

  // polling (every 20s) for any unconfirmed
  useEffect(() => {
    const tick = async () => {
      const pending = mints.filter(m => !(status[m.txid]?.confirmed))
      for (const m of pending) {
        try {
          setStatus(s => ({ ...s, [m.txid]: { ...(s[m.txid] || {confirmed:false, checking:true}), checking: true } }))
          const s = await txStatus(m.txid)
          setStatus(prev => ({ ...prev, [m.txid]: { confirmed: s.confirmed, checking: false } }))
          // optimistic write into list if just confirmed
          if (s.confirmed) {
            setMints(prev => prev.map(x => x.txid === m.txid ? { ...x, confirmed_at: Date.now() } : x))
          }
        } catch {
          setStatus(prev => ({ ...prev, [m.txid]: { confirmed: false, checking: false } }))
        }
      }
    }
    const id = setInterval(tick, 20000)
    // also trigger once soon after mount
    const kick = setTimeout(tick, 1500)
    return () => { clearInterval(id); clearTimeout(kick) }
  }, [mints, status])

  if (loading) return <div>Loading mint history…</div>
  if (error) return <div style={{ color: 'red' }}>Error: {error}</div>
  if (!mints.length) return <div style={{ opacity: 0.6 }}>No mints recorded yet.</div>

  const badge = (m: MintRow) => {
    const s = status[m.txid]
    if (s?.confirmed) return <span style={{ padding: '2px 6px', borderRadius: 6, background: '#DCFCE7', color: '#166534' }}>Confirmed</span>
    if (s?.checking) return <span style={{ padding: '2px 6px', borderRadius: 6, background: '#FEF9C3', color: '#854D0E' }}>Pending…</span>
    return <span style={{ padding: '2px 6px', borderRadius: 6, background: '#FFE4E6', color: '#9F1239' }}>Unknown</span>
  }

  return (
    <div style={{ background: '#f9f9ff', padding: 16, borderRadius: 8 }}>
      <h3 style={{ marginTop: 0 }}>Recent Mint Transactions</h3>
      <table style={{ width: '100%', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
            <th>TXID</th>
            <th>Pool</th>
            <th>Symbol</th>
            <th>Sats</th>
            <th>Time</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {mints.map((m) => (
            <tr key={m.txid} style={{ borderBottom: '1px solid #eee' }}>
              <td>
                <a href={`https://test.whatsonchain.com/tx/${m.txid}`} target="_blank" rel="noreferrer">
                  {m.txid.slice(0, 10)}…
                </a>
              </td>
              <td>{m.pool_id}</td>
              <td>{m.symbol || '—'}</td>
              <td>{m.sats}</td>
              <td>{new Date(m.created_at).toLocaleString()}</td>
              <td>{badge(m)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

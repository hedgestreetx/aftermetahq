import React, { useEffect, useState } from 'react'
import { getMintHistory } from '@/lib/api'

export default function MintHistory() {
  const [mints, setMints] = useState<
    Array<{ txid: string; pool_id: string; sats: number; created_at: number }>
  >([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getMintHistory()
      .then((res) => setMints(res.mints))
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div>Loading mint history…</div>
  if (error) return <div style={{ color: 'red' }}>Error: {error}</div>

  if (!mints.length)
    return <div style={{ opacity: 0.6 }}>No mints recorded yet.</div>

  return (
    <div style={{ background: '#f9f9ff', padding: 16, borderRadius: 8 }}>
      <h3 style={{ marginTop: 0 }}>Recent Mint Transactions</h3>
      <table style={{ width: '100%', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
            <th>TXID</th>
            <th>Pool</th>
            <th>Sats</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {mints.map((m) => (
            <tr key={m.txid} style={{ borderBottom: '1px solid #eee' }}>
              <td>
                <a
                  href={`https://test.whatsonchain.com/tx/${m.txid}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {m.txid.slice(0, 10)}…
                </a>
              </td>
              <td>{m.pool_id}</td>
              <td>{m.symbol || m.pool_id}</td>
              <td>{m.sats}</td>
              <td>{new Date(m.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

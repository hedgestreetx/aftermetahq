import { useEffect, useState } from 'react'
import { listMints, type MintRow } from '@/lib/api'
import { useInterval } from '@/hooks/useInterval'

export default function MintHistory({ poolId }: { poolId?: string }) {
  const [rows, setRows] = useState<MintRow[]>([])
  const [error, setError] = useState('')

  async function refresh() {
    try {
      const res = await listMints({ poolId, limit: 50 })
      setRows(res.mints)
      setError('')
    } catch (e: any) {
      setError(String(e?.message || e))
    }
  }

  useEffect(() => { refresh() }, [poolId])
  useInterval(refresh, 5000)

  if (error) return <div className="p-2 text-red-600">{error}</div>

  return (
    <div className="p-3 rounded-xl border bg-white shadow-sm">
      <div className="font-semibold mb-2">Recent Mints</div>
      <div className="space-y-2 text-sm">
        {rows.map(m => (
          <div key={m.id} className="flex items-center justify-between">
            <div className="truncate mr-3">
              <div className="font-mono text-xs">{m.txid || '(pending)'}</div>
              <div className="text-gray-600">
                {m.symbol} • {m.tokens} • {new Date(m.createdAt).toLocaleString()}
              </div>
            </div>
            <div className={`text-xs ${m.confirmed ? 'text-green-600' : 'text-amber-600'}`}>
              {m.confirmed ? 'CONFIRMED' : 'PENDING'}
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="text-gray-500">No mints yet.</div>}
      </div>
    </div>
  )
}

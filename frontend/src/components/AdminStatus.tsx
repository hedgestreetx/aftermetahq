import React from 'react'
import { adminState } from '@/lib/api'

function useAdminState(intervalMs = 5000) {
  const [data, setData] = React.useState<any>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function fetchState() {
    try {
      const d = await adminState()
      setData(d)
      setError(null)
    } catch (e: any) {
      setError(String(e?.message || e))
    }
  }

  React.useEffect(() => {
    fetchState()
    const id = setInterval(fetchState, intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return { data, error }
}

export default function AdminStatus() {
  const { data, error } = useAdminState(5000)
  if (error) return <div className="text-red-500">Admin error: {error}</div>
  if (!data) return <div>Loading admin…</div>

  return (
    <div style={{ border: '1px solid #ddd', padding: 16, borderRadius: 8, marginBottom: 16 }}>
      <h3>Admin Status</h3>
      <ul>
        <li>Network: <b>{data.network}</b></li>
        <li>Fee per KB: <b>{data.feePerKb}</b></li>
        <li>Dev Buy Enabled: <b>{String(data.devBuyEnabled)}</b></li>
        <li>Pool Script Hex Len: <b>{data.poolLockingScriptHexLen}</b></li>
        <li>Min Confs: <b>{data.minConfs}</b></li>
        <li>Pool Address: <b>{data.poolAddr || '(not set)'}</b></li>
      </ul>
    </div>
  )
}

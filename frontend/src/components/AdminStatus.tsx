import React, { useEffect, useState } from 'react'
import { adminState } from '@/lib/api'

export default function AdminStatus() {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    adminState().then(setData).catch(e => setError(String(e?.message || e)))
  }, [])

  if (error) return <div style={{ color: 'red' }}>Admin error: {error}</div>
  if (!data) return <div>Loading admin state…</div>

  return (
    <div style={{ marginBottom: 16, background: '#fafafa', padding: 12, borderRadius: 8 }}>
      <strong>Network:</strong> {data.network} &nbsp;|&nbsp; <strong>FeePerKb:</strong> {data.feePerKb}
    </div>
  )
}

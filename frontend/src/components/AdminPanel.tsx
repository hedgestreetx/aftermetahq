import React, { useEffect, useState } from 'react'
import { adminState } from '@/lib/api'
import MintHistory from '@/components/MintHistory'

export default function AdminPanel() {
  const [state, setState] = useState<any>(null)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    adminState()
      .then(setState)
      .catch((e) => setError(String(e?.message || e)))
  }, [])

  if (error)
    return <div style={{ color: 'red' }}>AdminPanel error: {error}</div>
  if (!state)
    return <div>Loading admin panel…</div>

  return (
    <div style={{ background: '#f5f5f5', padding: 16, borderRadius: 8 }}>
      <h3 style={{ marginTop: 0 }}>Admin Panel</h3>

      <pre
        style={{
          fontSize: 12,
          margin: 0,
          background: '#fff',
          padding: 8,
          borderRadius: 4,
          overflowX: 'auto',
        }}
      >
        {JSON.stringify(state, null, 2)}
      </pre>

      <div style={{ marginTop: 24 }}>
        <MintHistory />
      </div>
    </div>
  )
}

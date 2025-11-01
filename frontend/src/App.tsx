import React from 'react'
import AdminPanel from '@/components/AdminPanel'
import AdminStatus from '@/components/AdminStatus'
import { health } from '@/lib/api'
import MintTokenForm from '@/components/MintTokenForm'
import PoolList from '@/components/PoolList'

export default function App() {
  const [service, setService] = React.useState<string>('')
  const [error, setError] = React.useState<string>('')

  React.useEffect(() => {
    health().then(h => setService(h.service)).catch(e => setError(String(e?.message || e)))
  }, [])

  return (
    <div style={{ maxWidth: 800, margin: '40px auto', fontFamily: 'Inter, system-ui, Arial' }}>
      <h1>Aftermeta — Day 10 Baseline</h1>
      {error ? <div style={{ color: 'red' }}>{error}</div> : <div>Backend: <b>{service || '...'}</b></div>}
      <AdminStatus />
      <AdminPanel />
      <MintTokenForm />
      <PoolList />
    </div>
  )
}

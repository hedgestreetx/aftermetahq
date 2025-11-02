import React, { useState } from 'react'
import AdminStatus from '@/components/AdminStatus'
import AdminPanel from '@/components/AdminPanel'
import MintTokenForm from '@/components/MintTokenForm'
import PoolViewer from '@/components/PoolViewer'
import BuyBox from '@/components/BuyBox'
import MintHistory from '@/components/MintHistory'

export default function App() {
  const [active, setActive] = useState<'admin'|'mint'|'pools'|'buy'>('admin')
  const [currentPoolId, setCurrentPoolId] = useState<string>('')

  return (
    <div style={{ maxWidth: 960, margin: '32px auto', fontFamily: 'Inter, system-ui', padding: 16 }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 12 }}>Aftermeta Dashboard</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setActive('admin')}>Admin</button>
        <button onClick={() => setActive('mint')}>Mint Token</button>
        <button onClick={() => setActive('pools')}>Pools</button>
        <button onClick={() => setActive('buy')} disabled={!currentPoolId}>Buy</button>
      </div>

      {active === 'admin' && (<><AdminStatus /><AdminPanel /></>)}

      {active === 'mint' && (
        <MintTokenForm
          onCreated={(poolId) => { setCurrentPoolId(poolId); setActive('buy') }}
        />
      )}

      {active === 'pools' && (
        <PoolViewer
          onLoaded={(poolId) => setCurrentPoolId(poolId)}
        />
      )}

      {active === 'buy' && currentPoolId && (
        <BuyBox poolId={currentPoolId} />
      )}
    </div>

    
  )
}

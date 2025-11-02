import React, { useState } from 'react'
import AdminStatus from '@/components/AdminStatus'
import AdminPanel from '@/components/AdminPanel'
import MintTokenForm from '@/components/MintTokenForm'
import PoolViewer from '@/components/PoolViewer'
import BuyBox from '@/components/BuyBox'
import MintHistory from '@/components/MintHistory'
import { useTxStatus } from './hooks/useTxStatus'

export default function App() {
  const [active, setActive] = useState<'admin'|'mint'|'pools'|'buy'>('admin')
  const [currentPoolId, setCurrentPoolId] = useState<string>('')
  const [currentTxid, setCurrentTxid] = useState<string>('') // track last tx we broadcast

  // poll once per minute if we have a txid
  const { data: tx, error: txErr } = useTxStatus(currentTxid || null, 60_000)

  const TabButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
  > = ({ active, children, ...props }) => (
    <button
      {...props}
      style={{
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid #ddd',
        background: active ? '#111' : '#fff',
        color: active ? '#fff' : '#111',
        cursor: props.disabled ? 'not-allowed' : 'pointer'
      }}
    >
      {children}
    </button>
  )

  return (
    <div style={{ maxWidth: 960, margin: '32px auto', fontFamily: 'Inter, system-ui', padding: 16 }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 12 }}>Aftermeta Dashboard</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <TabButton active={active==='admin'} onClick={() => setActive('admin')}>Admin</TabButton>
        <TabButton active={active==='mint'} onClick={() => setActive('mint')}>Mint Token</TabButton>
        <TabButton active={active==='pools'} onClick={() => setActive('pools')}>Pools</TabButton>
        <TabButton
          active={active==='buy'}
          onClick={() => setActive('buy')}
          disabled={!currentPoolId}
          title={currentPoolId ? '' : 'Select or create a pool first'}
        >
          Buy
        </TabButton>
      </div>

      {active === 'admin' && (
        <>
          <AdminStatus />
          <div style={{ height: 8 }} />
          <AdminPanel />
        </>
      )}

      {active === 'mint' && (
        <MintTokenForm
          // when a pool is created, jump straight to buy
          onCreated={(poolId: string, initialTxid?: string) => {
            setCurrentPoolId(poolId)
            if (initialTxid) setCurrentTxid(initialTxid)
            setActive('buy')
          }}
          // if your form broadcasts the mint tx, call this
          onBroadcastTx={(txid: string) => setCurrentTxid(txid)}
        />
      )}

      {active === 'pools' && (
        <PoolViewer
          onLoaded={(poolId: string) => setCurrentPoolId(poolId)}
          onSelect={(poolId: string) => {
            setCurrentPoolId(poolId)
            setActive('buy')
          }}
        />
      )}

      {active === 'buy' && currentPoolId && (
        <BuyBox
          poolId={currentPoolId}
          // capture buy tx so we can monitor confirmation
          onTxSent={(txid: string) => setCurrentTxid(txid)}
        />
      )}

      {/* Optional: show recent mints page/section somewhere */}
      {/* <MintHistory /> */}

      {/* ---- TX monitor strip ---- */}
      {currentTxid && (
        <div style={{
          marginTop: 16,
          padding: '10px 12px',
          border: '1px solid #e5e5e5',
          borderRadius: 10,
          background: '#fafafa',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Transaction</div>
            <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 520 }}>
              {currentTxid}
            </div>
            {txErr && <div style={{ color: '#b91c1c', fontSize: 13 }}>Status error: {txErr}</div>}
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 14 }}>
              Confirmed:{' '}
              <strong style={{ color: tx?.confirmed ? '#16a34a' : '#92400e' }}>
                {String(!!tx?.confirmed)}
              </strong>
            </div>
            <div style={{ fontSize: 13, color: '#555' }}>
              Confs: {tx?.confs ?? 0}
              {!tx?.confirmed && tx?.nextCheckAt
                ? ` • next check ${new Date(tx.nextCheckAt).toLocaleTimeString()}`
                : ''}
            </div>
            <div style={{ marginTop: 6, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setCurrentTxid('')}
                style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}
                title="Stop monitoring this tx"
              >
                Clear
              </button>
              {!tx?.confirmed && (
                <a
                  href={`https://test.whatsonchain.com/tx/${currentTxid}`}
                  target="_blank" rel="noreferrer"
                  style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', textDecoration: 'none' }}
                >
                  Open in WOC
                </a>
              )}
              {tx?.confirmed && (
                <a
                  href={`https://whatsonchain.com/tx/${currentTxid}`}
                  target="_blank" rel="noreferrer"
                  style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', textDecoration: 'none' }}
                >
                  View on WOC
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

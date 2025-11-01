import React from 'react'
import { adminPoolBalance, devBuy, getUtxos } from '@/lib/api'

export default function AdminPanel() {
  const [payFrom, setPayFrom] = React.useState('')
  const [spendSats, setSpendSats] = React.useState(1000)
  const [logs, setLogs] = React.useState<string[]>([])

  function log(s: string) {
    setLogs(prev => [`${new Date().toLocaleTimeString()}: ${s}`, ...prev])
  }

  async function onLoadPool() {
    try {
      const b = await adminPoolBalance()
      log(`Pool: ${b.poolAddress} balance ~ ${b.satoshis} sats`)
    } catch (e: any) {
      log(`Pool err: ${String(e?.message || e)}`)
    }
  }

  async function onUtxos() {
    try {
      const u = await getUtxos(payFrom)
      log(`UTXOs: ${u.utxos.length}`)
    } catch (e: any) {
      log(`UTXOs err: ${String(e?.message || e)}`)
    }
  }

  async function onDevBuy() {
    try {
      const r = await devBuy({ payFrom, spendSats })
      const txid = r.txid || '(no txid)'
      const fee = r.feePaid ?? 'n/a'
      log(`DevBuy ok. txid=${txid} fee=${fee} sats`)
    } catch (e: any) {
      log(`DevBuy err: ${String(e?.message || e)}`)
    }
  }

  return (
    <div style={{ border: '1px solid #ddd', padding: 16, borderRadius: 8 }}>
      <h3>Admin Panel</h3>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          style={{ flex: 1, padding: 8 }}
          placeholder="Your testnet address (base58)"
          value={payFrom}
          onChange={e => setPayFrom(e.target.value)}
        />
        <input
          style={{ width: 160, padding: 8 }}
          type="number"
          min={0}
          value={spendSats}
          onChange={e => setSpendSats(parseInt(e.target.value || '0', 10))}
        />
        <button onClick={onUtxos}>UTXOs</button>
        <button onClick={onDevBuy}>Dev Buy</button>
        <button onClick={onLoadPool}>Pool Bal</button>
      </div>

      <div
        style={{
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          fontSize: 12,
          maxHeight: 240,
          overflow: 'auto',
          background: '#fafafa',
          padding: 8
        }}
      >
        {logs.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  )
}

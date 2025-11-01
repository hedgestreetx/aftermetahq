import type { Router, Request, Response } from 'express'
import { ENV, poolLockingScriptHexLen } from '../lib/env.js'
import { wocAddressUtxos } from '../adapters/woc.js'

export default function registerAdmin(app: Router) {
  app.get('/admin/state', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      network: ENV.NETWORK,
      feePerKb: ENV.FEE_PER_KB,
      devBuyEnabled: ENV.ALLOW_DEV_BUY === true,
      poolLockingScriptHexLen: poolLockingScriptHexLen(),
      minConfs: ENV.MIN_CONFIRMATIONS,
      poolAddr: ENV.POOL_P2SH_ADDRESS || ''
    })
  })

  app.get('/admin/pool/balance', async (_req: Request, res: Response) => {
    try {
      const addr = (ENV.POOL_P2SH_ADDRESS || '').trim()
      if (!addr) return res.json({ ok: true, poolAddress: null, satoshis: 0 })

      const utxos = await wocAddressUtxos(addr)
      const minConf = ENV.MIN_CONFIRMATIONS || 0

      // WOC sets height=0 for unconfirmed. Treat height>0 as confirmed.
      const eligible = utxos.filter(u => (u.height ?? 0) > 0 || minConf === 0)
      const sats = eligible.reduce((sum, u) => sum + (u.value || 0), 0)

      res.json({ ok: true, poolAddress: addr, satoshis: sats })
    } catch (err: any) {
      res.status(400).json({ ok: false, error: String(err?.message || err) })
    }
  })
}

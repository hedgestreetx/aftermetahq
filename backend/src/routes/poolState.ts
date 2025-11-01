import type { Router, Request, Response } from 'express'
import { ENV } from '../lib/env.js'
import { getPool } from '../lib/pools.js'
import { wocAddressUtxos } from '../adapters/woc.js'

export default function registerPoolState(app: Router) {
  app.get('/api/pool/:id/state', async (req: Request, res: Response) => {
    try {
      const pool = getPool(req.params.id)
      if (!pool) return res.status(404).json({ ok: false, error: 'not found' })

      const utxos = pool.poolAddress ? await wocAddressUtxos(pool.poolAddress) : []
      const minConf = ENV.MIN_CONFIRMATIONS || 0
      const eligible = utxos.filter(u => (u.height ?? 0) > 0 || minConf === 0)
      const satoshis = eligible.reduce((s, u) => s + (u.value || 0), 0)

      res.json({
        ok: true,
        pool: {
          id: pool.id,
          symbol: pool.symbol,
          creator: pool.creator,
          poolAddress: pool.poolAddress,
          createdAt: pool.createdAt
        },
        balanceSats: satoshis,
        utxoCount: eligible.length
      })
    } catch (err: any) {
      res.status(400).json({ ok: false, error: String(err?.message || err) })
    }
  })
}

import type { Router, Request, Response } from 'express'
import { assertBase58 } from '../lib/validate.js'
import { ENV } from '../lib/env.js'
import { wocAddressUtxos } from '../adapters/woc.js'

export default function registerUtxos(app: Router) {
  app.get('/api/utxos/:address', async (req: Request, res: Response) => {
    try {
      const addr = req.params.address
      assertBase58(addr, ENV.NETWORK)
      const utxos = await wocAddressUtxos(addr)
      const minConf = ENV.MIN_CONFIRMATIONS || 0
      const filtered = utxos.filter(u => (u.height ?? 0) > 0 || minConf === 0)
      res.json({ ok: true, address: addr, utxos: filtered })
    } catch (err: any) {
      res.status(400).json({ ok: false, error: String(err?.message || err) })
    }
  })
}

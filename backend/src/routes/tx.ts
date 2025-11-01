import type { Router, Request, Response } from 'express'
import { wocTx } from '../adapters/woc.js'

export default function registerTx(app: Router) {
  app.get('/api/tx/:txid', async (req: Request, res: Response) => {
    try {
      const txid = String(req.params.txid || '')
      if (!/^[0-9a-fA-F]{64}$/.test(txid)) throw new Error('invalid txid')
      const data = await wocTx(txid)
      res.json({ ok: true, data })
    } catch (err: any) {
      res.status(400).json({ ok: false, error: String(err?.message || err) })
    }
  })
}

import type { Router, Request, Response } from 'express'
import { wocBroadcastTx } from '../adapters/woc.js'
import { metrics } from '../lib/state.js'

export default function registerBroadcast(app: Router) {
  app.post('/api/broadcast', async (req: Request, res: Response) => {
    try {
      const raw = String(req.body?.raw || '')
      if (!raw || !/^[0-9a-fA-F]+$/.test(raw)) throw new Error('raw hex required')
      const txid = await wocBroadcastTx(raw)
      metrics.lastBroadcast = { txid, at: Date.now() }
      res.json({ ok: true, txid })
    } catch (err: any) {
      res.status(400).json({ ok: false, error: String(err?.message || err) })
    }
  })
}

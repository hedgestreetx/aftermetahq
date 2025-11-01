import type { Router, Request, Response } from 'express'
import { registerPool } from '../lib/pools.js'
import { randomUUID } from 'crypto'
import { bsv } from 'scrypt-ts'

export default function registerPoolCreate(app: Router) {
  app.post('/api/pool/create', async (req: Request, res: Response) => {
    try {
      const { symbol, creator } = req.body
      if (!symbol || !creator) throw new Error('symbol & creator required')

      const key = new bsv.PrivateKey()
      const addr = key.toAddress(bsv.Networks.testnet).toString()

      const pool = {
        id: randomUUID(),
        symbol,
        creator,
        poolAddress: addr,
        lockingScriptHex: bsv.Script.buildPublicKeyHashOut(addr).toHex(),
        createdAt: new Date().toISOString()
      }

      registerPool(pool)
      res.json({ ok: true, pool })
    } catch (err: any) {
      res.status(400).json({ ok: false, error: String(err?.message || err) })
    }
  })
}

import type { Router, Request, Response } from 'express'
import { registerPool } from '../lib/pools.js'
import { randomUUID } from 'crypto'
import { bsv } from 'scrypt-ts'

export default function registerPoolCreate(app: Router) {
  app.post('/api/pool/create', async (req: Request, res: Response) => {
    try {
      const { symbol, creator, maxSupply, decimals, creatorReserve } = req.body || {}

      if (!symbol || !creator) throw new Error('symbol & creator required')
      if (!/^[A-Z0-9]{2,12}$/i.test(symbol)) throw new Error('invalid symbol (2–12 alphanumeric)')

      // sanitize numeric inputs
      const MAX_CAP = 10_000_000_000
      const cap = Number.isFinite(+maxSupply) ? Math.max(1, Math.min(+maxSupply, MAX_CAP)) : 1_000_000
      const dec = Number.isFinite(+decimals) ? Math.min(Math.max(+decimals, 0), 18) : 8
      const reserve = Number.isFinite(+creatorReserve) ? Math.max(0, Math.min(+creatorReserve, cap)) : 0
      if (reserve > cap) throw new Error('creatorReserve > maxSupply')

      const key = new bsv.PrivateKey()
      const addr = key.toAddress(bsv.Networks.testnet).toString()

      const pool = {
        id: randomUUID(),
        symbol: String(symbol).toUpperCase(),
        creator: String(creator),
        poolAddress: addr,
        lockingScriptHex: bsv.Script.buildPublicKeyHashOut(addr).toHex(),
        createdAt: new Date().toISOString(),
        maxSupply: cap,
        decimals: dec,
        mintedSupply: 0,
        creatorReserve: reserve
      }

      registerPool(pool)
      res.json({ ok: true, pool })
    } catch (err: any) {
      res.status(400).json({ ok: false, error: String(err?.message || err) })
    }
  })
}

import type { Router, Request, Response } from 'express'
import { registerPool } from '../lib/pools.js'
import { randomUUID } from 'crypto'
import { bsv } from 'scrypt-ts'

export default function registerPoolCreate(app: Router) {
  app.post('/api/pool/create', async (req: Request, res: Response) => {
    try {
      const { symbol, creator, maxSupply, decimals } = req.body
      if (!symbol || !creator) throw new Error('symbol & creator required')

      const key = new bsv.PrivateKey()
      const addr = key.toAddress(bsv.Networks.testnet).toString()

      const pool = {
        id: randomUUID(),
        symbol: symbol.trim().toUpperCase(),
        creator: creator.trim(),
        poolAddress: addr,
        lockingScriptHex: bsv.Script.buildPublicKeyHashOut(addr).toHex(),
        createdAt: new Date().toISOString(),
        maxSupply: Number(maxSupply) > 0 ? Number(maxSupply) : 1_000_000,
        decimals: Number.isInteger(decimals) ? decimals : 8,
        mintedSupply: 0,
        creatorReserve: 0
      }

      registerPool(pool)
      res.json({ ok: true, pool })
    } catch (err: any) {
      res.status(400).json({ ok: false, error: String(err?.message || err) })
    }
  })
}

import type { Router, Request, Response } from 'express'
import { listPools, getPool } from '../lib/pools.js'

export default function registerPoolList(app: Router) {
  app.get('/api/pool/list', (_req: Request, res: Response) => {
    res.json({ ok: true, pools: listPools() })
  })

  app.get('/api/pool/:id', (req: Request, res: Response) => {
    const pool = getPool(req.params.id)
    if (!pool) return res.status(404).json({ ok: false, error: 'not found' })
    res.json({ ok: true, pool })
  })
}

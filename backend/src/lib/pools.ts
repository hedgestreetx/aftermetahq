import { db } from './db.js'

export interface Pool {
  id: string
  symbol: string
  creator: string
  poolAddress: string
  lockingScriptHex: string
  createdAt: string
  maxSupply: number
  decimals: number
  mintedSupply: number
  creatorReserve: number
}


export function registerPool(pool: Pool) {
  const stmt = db.prepare(
    `INSERT INTO pools (id, symbol, creator, poolAddress, lockingScriptHex, createdAt)
     VALUES (@id, @symbol, @creator, @poolAddress, @lockingScriptHex, @createdAt)`
  )
  stmt.run(pool)
}

export function getPool(id: string): Pool | null {
  const stmt = db.prepare(`SELECT * FROM pools WHERE id = ?`)
  return stmt.get(id) || null
}

export function listPools(): Pool[] {
  const stmt = db.prepare(`SELECT * FROM pools ORDER BY createdAt DESC`)
  return stmt.all()
}

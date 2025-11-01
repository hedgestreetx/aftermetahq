import path from 'node:path'
import dotenv from 'dotenv'
import fs from 'node:fs'

// Force load .env from backend root
const envPath = path.resolve(process.cwd(), '.env')
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath })
} else {
  // fallback to project layout when running from dist/
  const alt = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../.env')
  if (fs.existsSync(alt)) dotenv.config({ path: alt })
}

type Net = 'testnet' | 'mainnet'

function normalizeNet(raw?: string): Net {
  const v = (raw || '').toLowerCase()
  if (v === 'mainnet' || v === 'livenet') return 'mainnet'
  return 'testnet'
}

export const ENV = {
  NETWORK: normalizeNet(process.env.NETWORK),
  PORT: Number(process.env.PORT || 3000),
  ALLOW_DEV_BUY: String(process.env.ALLOW_DEV_BUY || '').toLowerCase() === 'true',
  FEE_PER_KB: Number(process.env.FEE_PER_KB || 150),
  MIN_CONFIRMATIONS: Number(process.env.MIN_CONFIRMATIONS || 0),
  POOL_P2SH_ADDRESS: String(process.env.POOL_P2SH_ADDRESS || '').trim(),
  POOL_LOCKING_SCRIPT_HEX: String(process.env.POOL_LOCKING_SCRIPT_HEX || '').replace(/\s+/g, ''),
  WOC_BASE: String(process.env.WOC_BASE || 'https://api.whatsonchain.com/v1/bsv/test')
}

export function poolLockingScriptHexLen(): number {
  return ENV.POOL_LOCKING_SCRIPT_HEX ? ENV.POOL_LOCKING_SCRIPT_HEX.length : 0
}

export function requireEnv<T extends keyof typeof ENV>(k: T): (typeof ENV)[T] {
  const v = ENV[k]
  if (v === undefined || v === null || (typeof v === 'string' && v === '')) {
    throw new Error(`${String(k)} not set`)
  }
  return v as any
}

// backend/src/lib/validate.ts
import { z } from 'zod'
import { bsv } from 'scrypt-ts'

export function reqString(v: any, name: string): string {
  return z.string({ required_error: `${name} required` }).min(1, `${name} required`).parse(v)
}

export function reqPositiveInt(v: any, name: string): number {
  return z.number({ coerce: true }).int().positive(`${name} must be > 0`).parse(v)
}

export function reqNonNegativeInt(v: any, name: string): number {
  return z.number({ coerce: true }).int().nonnegative(`${name} must be >= 0`).parse(v)
}

export function assert(cond: any, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

export function assertBase58(addr: string, network: 'mainnet'|'testnet') {
  const n = network === 'mainnet' ? bsv.Networks.mainnet : bsv.Networks.testnet
  const ok = bsv.Address.isValid(addr, n)
  if (!ok) throw new Error(`${addr} contains non-base58 characters or wrong network`)
}

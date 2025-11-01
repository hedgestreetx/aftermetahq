import { ENV } from './env.js'

export function estimateFeeSats(txBytes: number): number {
  const perKb = ENV.FEE_PER_KB || 150
  const kb = Math.ceil(txBytes / 1000)
  return kb * perKb
}

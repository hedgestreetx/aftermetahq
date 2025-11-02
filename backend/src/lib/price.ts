// backend/src/lib/price.ts
export function getLinearPrice(
  mintedSupply: number,
  basePrice = 100,       // starting price per token (sats)
  slope = 0.1            // sats increase per token minted
): number {
  return basePrice + slope * mintedSupply
}

/** 
 * Calculate how many tokens can be bought for spendSats 
 * under a linear bonding curve.
 */
export function tokensFromSpend(
  spendSats: number,
  mintedSupply: number,
  basePrice = 100,
  slope = 0.1,
  maxSupply = 1_000_000
): { tokens: number; costUsed: number } {
  let tokens = 0
  let cost = 0
  while (tokens < maxSupply - mintedSupply) {
    const price = getLinearPrice(mintedSupply + tokens, basePrice, slope)
    if (cost + price > spendSats) break
    cost += price
    tokens++
  }
  return { tokens, costUsed: cost }
}

import { ENV } from "./env";
export function flags() {
  return {
    devBuyEnabled: ENV.ALLOW_DEV_BUY,
    requireMinConfs: ENV.REQUIRE_MIN_CONFS,
    maxSlippageBps: ENV.MAX_SLIPPAGE_BPS
  };
}

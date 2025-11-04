import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), "backend/.env") });

type Net = "testnet" | "mainnet";
const normalizeNet = (v?: string): Net =>
  (v || "").toLowerCase().startsWith("main") ? "mainnet" : "testnet";

export const ENV = {
  NETWORK: normalizeNet(process.env.NETWORK),
  PORT: Number(process.env.PORT || 3000),
  FEE_PER_KB: Number(process.env.FEE_PER_KB || 150),
  MIN_CONFIRMATIONS: Number(process.env.MIN_CONFIRMATIONS || 0),
  VERIFY_INTERVAL_MS: Number(process.env.VERIFY_INTERVAL_MS || 0),

  ALLOW_DEV_BUY: String(process.env.ALLOW_DEV_BUY || "").toLowerCase() === "true",
  REQUIRE_MIN_CONFS: Number(process.env.REQUIRE_MIN_CONFS || 0),
  MAX_SLIPPAGE_BPS: Number(process.env.MAX_SLIPPAGE_BPS || 500),

  WOC_BASE: String(process.env.WOC_BASE || "").replace(/\/+$/, ""),

  POOL_P2SH_ADDRESS: String(process.env.POOL_P2SH_ADDRESS || "").trim(),
  POOL_LOCKING_SCRIPT_HEX: String(process.env.POOL_LOCKING_SCRIPT_HEX || "").trim()
} as const;

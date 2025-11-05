import { getEnv } from "./env";

export type ApiSegment = "main" | "test" | "stn";

function normalizeNetwork(value?: string): "mainnet" | "testnet" | "stn" {
  const env = getEnv();
  const raw = String(value ?? env.NETWORK ?? "").trim().toLowerCase();
  if (raw === "livenet" || raw.startsWith("main")) return "mainnet";
  if (raw === "stn" || raw === "scale" || raw === "scalenet") return "stn";
  if (raw === "test" || raw === "testnet") return "testnet";
  return env.NETWORK;
}

export function wocApiNetworkSegment(net?: string): ApiSegment {
  const normalized = normalizeNetwork(net);
  if (normalized === "mainnet") return "main";
  if (normalized === "stn") return "stn";
  return "test";
}

export function wocApiBase(net?: string): string {
  const { WOC_BASE } = getEnv();
  const override = WOC_BASE;
  if (override) {
    return override.replace(/\/+$/, "");
  }
  const segment = wocApiNetworkSegment(net);
  return `https://api.whatsonchain.com/v1/bsv/${segment}`;
}

export function wocWebTxUrl(txid: string, net?: string): string {
  const normalized = normalizeNetwork(net);
  const base =
    normalized === "mainnet"
      ? "https://whatsonchain.com/tx"
      : normalized === "stn"
      ? "https://stn.whatsonchain.com/tx"
      : "https://test.whatsonchain.com/tx";
  return `${base}/${txid}`;
}

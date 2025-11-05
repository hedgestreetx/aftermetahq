import { ENV } from "./env";

export type WocNetwork = "mainnet" | "testnet" | "stn";

export function normalizeWocNetwork(value?: string): WocNetwork {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return ENV.NETWORK;
  if (raw.startsWith("main")) return "mainnet";
  if (raw === "livenet") return "mainnet";
  if (raw === "stn" || raw === "scale" || raw === "scalenet") return "stn";
  if (raw === "test" || raw === "testnet") return "testnet";
  return ENV.NETWORK;
}

export function wocApiNetworkSegment(network = ENV.NETWORK): "main" | "test" | "stn" {
  const net = normalizeWocNetwork(network);
  if (net === "mainnet") return "main";
  if (net === "stn") return "stn";
  return "test";
}

export function wocWebTxUrl(txid: string, network = ENV.NETWORK): string {
  const net = normalizeWocNetwork(network);
  const base =
    net === "mainnet"
      ? "https://whatsonchain.com/tx"
      : net === "stn"
      ? "https://stn.whatsonchain.com/tx"
      : "https://test.whatsonchain.com/tx";
  return `${base}/${txid}`;
}

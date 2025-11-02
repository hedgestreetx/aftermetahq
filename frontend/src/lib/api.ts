// Single source of truth for API calls + strict JSON guard
const API = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const ct = r.headers.get("content-type") || "";
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} ${r.statusText}: ${text.slice(0, 300)}`);
  }
  if (!ct.includes("application/json")) {
    const text = await r.text().catch(() => "");
    throw new Error(`Non-JSON response (${ct}). Preview: ${text.slice(0, 200)}`);
  }
  return r.json();
}

export type AdminState = {
  ok: true;
  network: "testnet" | "mainnet" | string;
  feePerKb: number;
  minConfs: number;
  poolAddr: string;
  poolLockingScriptHexLen: number;
  flags: Record<string, any>;
};

export type Pool = {
  id: string;
  symbol: string;
  creator: string;
  poolAddress: string;
  lockingScriptHex: string;
  maxSupply: number;
  decimals: number;
  creatorReserve: number;
  createdAt: number;
  supply?: { mintedSupply: number };
};

export type MintRow = {
  id: string;
  poolId: string;
  symbol: string;
  account: string;
  spendSats: number;
  tokens: number;
  txid: string;
  confirmed: 0 | 1;
  createdAt: string | number;
};

export const health = () => req<{ service: string; network: string; port: number }>("/health");
export const adminState = () => req<AdminState>("/v1/admin/state");
export const listPools = () => req<{ ok: true; pools: Pool[] }>("/v1/pools");
export const createPool = (body: Partial<Pool>) =>
  req<{ ok: true; pool: Pool; supply: { mintedSupply: number } }>("/v1/pools", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const listMints = (q?: { poolId?: string; symbol?: string; limit?: number }) => {
  const p = new URLSearchParams();
  if (q?.poolId) p.set("poolId", q.poolId);
  if (q?.symbol) p.set("symbol", q.symbol);
  if (q?.limit) p.set("limit", String(q.limit));
  const qs = p.toString() ? `?${p.toString()}` : "";
  return req<{ ok: true; mints: MintRow[]; nextCursor: null }>(`/v1/mints${qs}`);
};

export const mint = (body: {
  wif: string;
  spendSats: number;
  poolId?: string;
  symbol?: string;
  poolLockingScriptHex?: string;
}) =>
  req<{ ok: true; txid: string; poolId: string; symbol: string; id: string; tokens: number; visible?: boolean; attempts?: number }>(
    "/v1/mint",
    { method: "POST", body: JSON.stringify(body), headers: { "X-Request-Id": crypto.randomUUID() } }
  );

export const txStatus = (txid: string) =>
  req<{ ok: true; txid: string; confirmed: boolean; blockHeight: number | null; blockTime: null }>(
    `/v1/tx/${txid}/status`
  );

export const withdrawalsCan = (poolId: string) =>
  req<{ ok: true; can: boolean; reason: string | null }>(`/v1/withdrawals/can/${poolId}`);

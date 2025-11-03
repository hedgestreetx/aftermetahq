export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly ref?: string;
  readonly payload?: unknown;

  constructor(opts: { message: string; code: string; status: number; ref?: string; payload?: unknown }) {
    super(opts.message);
    this.name = "ApiError";
    this.code = opts.code;
    this.status = opts.status;
    this.ref = opts.ref;
    this.payload = opts.payload;
  }
}

function mergeHeaders(init?: RequestInit): Headers {
  const headers = new Headers({
    Accept: "application/json",
  });
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.headers) {
    new Headers(init.headers as HeadersInit).forEach((value, key) => {
      headers.set(key, value);
    });
  }
  return headers;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: mergeHeaders(init),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text().catch(() => "");

  if (!contentType.includes("application/json")) {
    throw new ApiError({
      message: `Non-JSON response from API (${contentType || "unknown"})`,
      code: "non_json",
      status: response.status,
      payload: { preview: raw.slice(0, 200) },
    });
  }

  let json: any = null;
  if (raw.length > 0) {
    try {
      json = JSON.parse(raw);
    } catch (err) {
      throw new ApiError({
        message: "Failed to parse JSON response from API",
        code: "invalid_json",
        status: response.status,
        payload: { preview: raw.slice(0, 200) },
      });
    }
  }

  const payload = json ?? {};
  const isErrorPayload = typeof payload === "object" && payload !== null && "ok" in payload && payload.ok === false;

  if (!response.ok || isErrorPayload) {
    const code = typeof payload?.error === "string" ? payload.error : `http_${response.status}`;
    const message = typeof payload?.message === "string" ? payload.message : `Request failed (${code})`;
    throw new ApiError({
      message,
      code,
      status: response.status,
      ref: typeof payload?.ref === "string" ? payload.ref : undefined,
      payload,
    });
  }

  return payload as T;
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

export type MintQuoteRequest = {
  wif: string;
  spendSats: number;
  poolId?: string;
  symbol?: string;
};

export type MintQuoteResponse = {
  ok: true;
  symbol: string;
  spendSats: number;
  feeEstimate: number;
  netSpend: number;
  tokensEstimate: number;
  inputCount: number;
  changeSats: number;
  fromAddress: string;
  utxoSummary: Array<{ txid: string; vout: number; value: number }>;
};

export const health = () => req<{ service: string; network: string; port: number }>("/health");
export const adminState = () => req<AdminState>("/v1/admin/state");
export const listPools = () => req<{ ok: true; pools: Pool[] }>("/v1/pools");

export const getPool = (poolId: string) =>
  req<{
    ok: true;
    pool: Pool;
    supply: { mintedSupply: number; left: number; percentMinted: number };
  }>(`/v1/pools/${encodeURIComponent(poolId)}`);

export const createPool = (body: Partial<Pool>) =>
  req<{ ok: true; pool: Pool; supply: { mintedSupply: number } }>("/v1/pools", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const listMints = (q?: { poolId?: string; symbol?: string; limit?: number }) => {
  const params = new URLSearchParams();
  if (q?.poolId) params.set("poolId", q.poolId);
  if (q?.symbol) params.set("symbol", q.symbol);
  if (q?.limit) params.set("limit", String(q.limit));
  const qs = params.toString() ? `?${params.toString()}` : "";
  return req<{ ok: true; mints: MintRow[]; nextCursor: null }>(`/v1/mints${qs}`);
};

export const quoteMint = (body: MintQuoteRequest) =>
  req<MintQuoteResponse>("/v1/mint/quote", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const mint = (body: {
  wif: string;
  spendSats: number;
  poolId?: string;
  symbol?: string;
  poolLockingScriptHex?: string;
}) =>
  req<{
    ok: true;
    txid: string;
    poolId: string;
    symbol: string;
    id: string;
    tokens: number;
    visible?: boolean;
    attempts?: number;
  }>("/v1/mint", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "X-Request-Id": crypto.randomUUID() },
  });

export type MintTokenRequest = Parameters<typeof mint>[0];
export type MintTokenResponse = Awaited<ReturnType<typeof mint>>;

export const mintToken = (body: MintTokenRequest) => mint(body);

export const txStatus = (txid: string) =>
  req<{ ok: true; txid: string; confirmed: boolean; blockHeight: number | null; blockTime: number | null }>(
    `/v1/tx/${encodeURIComponent(txid)}/status`
  );

export const withdrawalsCan = (poolId: string) =>
  req<{ ok: true; can: boolean; reason: string | null }>(`/v1/withdrawals/can/${encodeURIComponent(poolId)}`);

export type BuyQuoteRequest = {
  poolId: string;
  spendSats: number;
  maxSlippageBps?: number;
};

export type BuyQuoteResponse = {
  quoteId: string;
  price: number;
  expiresAt: number;
};

export async function quoteBuy(body: BuyQuoteRequest): Promise<BuyQuoteResponse> {
  const res = await req<{ ok: true; quote: BuyQuoteResponse }>("/v1/buy/quote", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.quote;
}

export type OrderBuyRequest = {
  quoteId: string;
  poolId: string;
  spendSats: number;
};

export type OrderBuyResponse = {
  txid: string;
  filledTokens: number;
};

export async function orderBuy(body: OrderBuyRequest): Promise<OrderBuyResponse> {
  const res = await req<{ ok: true; order: OrderBuyResponse }>("/v1/buy/order", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "X-Request-Id": crypto.randomUUID() },
  });
  return res.order;
}

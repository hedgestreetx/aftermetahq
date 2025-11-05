import fetch, { type RequestInit } from "node-fetch";

import { getEnv } from "./env";
import { wocApiBase } from "./wocUrls";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type GlobalFetchState = {
  __aftermetaFetchImpl?: FetchLike;
};

const globalFetchState = globalThis as typeof globalThis & GlobalFetchState;

function defaultFetch(input: string, init?: RequestInit) {
  return fetch(input, init);
}

function getActiveFetch(): FetchLike {
  if (typeof globalFetchState.__aftermetaFetchImpl === "function") {
    return globalFetchState.__aftermetaFetchImpl;
  }
  globalFetchState.__aftermetaFetchImpl = defaultFetch;
  return globalFetchState.__aftermetaFetchImpl;
}

export function __setFetch(fn: FetchLike | null) {
  globalFetchState.__aftermetaFetchImpl = fn ?? defaultFetch;
}

function buildHeaders(init?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(init ?? {}) };
  const { WOC_API_KEY } = getEnv();
  if (WOC_API_KEY) {
    headers["WOC-API-KEY"] = WOC_API_KEY;
  }
  return headers;
}

async function parseJson(res: Response) {
  try {
    return await res.json();
  } catch {
    const text = await res.text().catch(() => "");
    throw new Error(text || `unexpected_${res.status}`);
  }
}

export type WocTxStatus = {
  ok: boolean;
  confirmed: boolean;
  confirmations: number;
  blockHeight: number | null;
  status: number;
  error?: string;
};

export async function queryWocTxStatus(txid: string): Promise<WocTxStatus> {
  if (!txid) {
    throw new Error("txid_required");
  }

  const url = `${wocApiBase()}/tx/${txid}/status`;
  const res = await getActiveFetch()(url, { headers: buildHeaders() });

  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText || "error");
    return {
      ok: false,
      confirmed: false,
      confirmations: 0,
      blockHeight: null,
      status: res.status,
      error: message,
    };
  }

  const data = await parseJson(res);
  const confirmed = Boolean((data as any)?.confirmed);
  const confirmations = Number((data as any)?.confirmations ?? 0) || 0;
  const blockHeightValue = (data as any)?.block_height;
  const blockHeight =
    blockHeightValue === null || blockHeightValue === undefined
      ? null
      : Number(blockHeightValue) || null;

  return {
    ok: true,
    confirmed,
    confirmations,
    blockHeight,
    status: res.status,
  };
}

export type BroadcastResult = {
  txid: string;
  alreadyKnown: boolean;
};

export async function broadcastRawTransaction(raw: string): Promise<BroadcastResult> {
  if (!raw || typeof raw !== "string") {
    throw new Error("raw_transaction_required");
  }

  const url = `${wocApiBase()}/tx/raw`;
  const res = await getActiveFetch()(url, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ txhex: raw }),
  });

  if (res.ok) {
    const payload = await parseJson(res);
    const txid = typeof payload === "string" ? payload : String((payload as any)?.txid || "").trim();
    if (!txid) {
      throw new Error("woc_missing_txid");
    }
    return { txid, alreadyKnown: false };
  }

  const message = await res.text().catch(() => res.statusText || "error");
  const normalized = message.toLowerCase();
  if (normalized.includes("already") && (normalized.includes("chain") || normalized.includes("known"))) {
    const txidMatch = message.match(/[0-9a-fA-F]{64}/);
    const txid = txidMatch ? txidMatch[0].toLowerCase() : "";
    return { txid, alreadyKnown: true };
  }

  throw new Error(`woc_broadcast_${res.status}_${message}`);
}

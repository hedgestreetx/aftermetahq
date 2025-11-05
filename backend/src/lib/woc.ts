import WebSocket from "ws";
import fetch from "node-fetch";

import { ENV } from "./env";
import { db } from "./db";

const NET_WOC = wocApiNetworkSegment();
export const WOC_BASE =
  ENV.WOC_BASE || `https://api.whatsonchain.com/v1/bsv/${NET_WOC}`;

type WocOverrides = {
  fetchAddressUtxos?: (address: string) => Promise<any> | any;
  broadcastRawTransaction?: (raw: string) => Promise<any> | any;
};

let overrides: WocOverrides | null = null;

function buildHeaders(extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra };
  if (ENV.WOC_API_KEY) {
    headers["WOC-API-KEY"] = ENV.WOC_API_KEY;
  }
  return headers;
}

let ws: WebSocket | null = null;

const markMintConfirmedStmt = db.prepare(`UPDATE mints SET confirmed = 1 WHERE txid = ?`);

function connect() {
  ws = new WebSocket(WOC_URL, { headers: buildHeaders() });

  ws.on('open', () => {
    console.log('[WOC] WebSocket connected');
    try {
      ws?.send(
        JSON.stringify({
          network: NET_WOC,
          event: 'subscribe',
          channel: 'mempool_tx',
        })
      );
    } catch (err) {
      console.error('[WOC] failed to subscribe to mempool channel', err);
    }
  });

  ws.on('message', (data: WebSocket.Data) => {
    const message = JSON.parse(data.toString());
    if (message.type === 'tx' && message.payload) {
      const { txid, status } = message.payload;
      if (status === 'confirmed') {
        try {
          const result = markMintConfirmedStmt.run(txid);
          if (result.changes > 0) {
            console.log(`[WOC] Confirmed transaction: ${txid}`);
          }
        } catch (err: any) {
          console.error(`[WOC] failed to mark mint confirmed txid=${txid}: ${String(err?.message || err)}`);
        }
      }
    }
  });

  ws.on('close', () => {
    console.log('[WOC] WebSocket disconnected');
    ws = null;
    // Reconnect after a delay
    setTimeout(connect, 5000);
  });

let overrides: WocOverrides | null = null;

export async function queryWocTxStatus(txid: string) {
  const res = await fetch(`${WOC_BASE}/tx/${txid}/status`, { headers: buildHeaders() });
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      confirmed: false,
      confirmations: 0,
      blockHeight: null,
      error: res.statusText,
    };
  }
  const data = await res.json();
  return {
    ok: true,
    status: 200,
    confirmed: data.confirmed,
    confirmations: data.confirmations,
    blockHeight: data.block_height,
    error: undefined,
  };
}

export function startWocSocket() {
  if (!ENV.WOC_API_KEY) {
    console.warn("[WOC] WOC_API_KEY not set, WebSocket will not be connected.");
    return;
  }
  connect();
}

export async function fetchAddressUtxos(address: string) {
  if (!address) {
    throw new Error("address_required");
  }

  if (overrides?.fetchAddressUtxos) {
    return overrides.fetchAddressUtxos(address);
  }

  const res = await fetch(`${WOC_BASE}/address/${address}/unspent`, {
    headers: buildHeaders(),
  });

  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText);
    throw new Error(`woc_unspent_${res.status}_${message}`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("woc_unspent_invalid");
  }
  return data;
}

export async function broadcastRawTransaction(raw: string) {
  if (!raw) {
    throw new Error("raw_required");
  }

  if (overrides?.broadcastRawTransaction) {
    return overrides.broadcastRawTransaction(raw);
  }

  const res = await fetch(`${WOC_BASE}/tx/raw`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ txhex: raw }),
  });

  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText);
    throw new Error(`woc_broadcast_${res.status}_${message}`);
  }

  const data = await res.json();
  if (!data || typeof data.txid !== "string") {
    throw new Error("woc_broadcast_invalid");
  }
  return data;
}

export function __setWocOverridesForTests(newOverrides: WocOverrides | null) {
  overrides = newOverrides;
}
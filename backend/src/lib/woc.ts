import WebSocket from "ws";
import fetch from "node-fetch";

import { ENV } from "./env";
import { db } from "./db";

export type WocUtxo = {
  txid: string;
  vout: number;
  value: number;
  scriptPubKey: string;
  confirmations: number;
};

type WocOverrides = {
  fetchAddressUtxos?: (address: string) => Promise<WocUtxo[]>;
  broadcastRawTransaction?: (rawHex: string) => Promise<{ txid: string }>;
};

let overrides: WocOverrides | null = null;

export function __setWocOverridesForTests(next: WocOverrides | null) {
  overrides = next;
}

const NET_WOC =
  ENV.NETWORK === 'mainnet' || ENV.NETWORK === 'livenet' ? 'main' : 'test';
export const WOC_BASE =
  ENV.WOC_BASE || `https://api.whatsonchain.com/v1/bsv/${NET_WOC}`;
const WOC_URL = `wss://socket.whatsonchain.com/mempool`; // same endpoint for all nets

function authHeaders() {
  const headers: Record<string, string> = {};
  if (ENV.WOC_API_KEY) {
    headers["WOC-API-KEY"] = ENV.WOC_API_KEY;
  }
  return headers;
}

export async function fetchAddressUtxos(address: string): Promise<WocUtxo[]> {
  if (overrides?.fetchAddressUtxos) {
    return overrides.fetchAddressUtxos(address);
  }

  const res = await fetch(`${WOC_BASE}/address/${address}/unspent`, {
    headers: authHeaders(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`woc_utxos_http_${res.status} ${body}`.trim());
  }

  const json = await res.json();
  if (!Array.isArray(json)) {
    throw new Error("woc_utxos_invalid_payload");
  }

  return json.map((row: any) => ({
    txid: String(row?.tx_hash || row?.txid || ""),
    vout: Number(row?.tx_pos ?? row?.vout ?? 0),
    value: Number(row?.value ?? 0),
    scriptPubKey: String(row?.script ?? row?.scriptPubKey ?? ""),
    confirmations: Number(row?.confirmations ?? 0),
  }));
}

export async function broadcastRawTransaction(rawHex: string): Promise<{ txid: string }> {
  if (overrides?.broadcastRawTransaction) {
    return overrides.broadcastRawTransaction(rawHex);
  }

  const res = await fetch(`${WOC_BASE}/tx/raw`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ txhex: rawHex }),
  });

  const text = (await res.text().catch(() => "")).trim();
  if (!res.ok) {
    throw new Error(text || `woc_broadcast_http_${res.status}`);
  }

  const normalized = text.replace(/^"+|"+$/g, "");
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`woc_broadcast_bad_txid ${normalized}`.trim());
  }

  return { txid: normalized.toLowerCase() };
}

let ws: WebSocket | null = null;

const markMintConfirmedStmt = db.prepare(`UPDATE mints SET confirmed = 1 WHERE txid = ?`);

function connect() {
  ws = new WebSocket(WOC_URL, { headers: authHeaders() });

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

  ws.on('error', (error: Error) => {
    console.error('[WOC] WebSocket error:', error);
  });
}

export async function queryWocTxStatus(txid: string) {
  const res = await fetch(`${WOC_BASE}/tx/${txid}/status`, { headers: authHeaders() });
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
    console.warn('[WOC] WOC_API_KEY not set, WebSocket will not be connected.');
    return;
  }
  connect();
}
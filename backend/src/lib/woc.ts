import WebSocket from 'ws';
import fetch from 'node-fetch';

import { ENV } from './env';
import { db } from './db';

const NET_WOC =
  ENV.NETWORK === 'mainnet' || ENV.NETWORK === 'livenet' ? 'main' : 'test';
export const WOC_BASE =
  ENV.WOC_BASE || `https://api.whatsonchain.com/v1/bsv/${NET_WOC}`;
const WOC_URL = `wss://socket.whatsonchain.com/mempool`; // same endpoint for all nets

let ws: WebSocket | null = null;

const markMintConfirmedStmt = db.prepare(`UPDATE mints SET confirmed = 1 WHERE txid = ?`);

function connect() {
  const headers: Record<string, string> = {};
  if (ENV.WOC_API_KEY) {
    headers['WOC-API-KEY'] = ENV.WOC_API_KEY;
  }

  ws = new WebSocket(WOC_URL, { headers });

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
  const headers: Record<string, string> = {};
  if (ENV.WOC_API_KEY) {
    headers['WOC-API-KEY'] = ENV.WOC_API_KEY;
  }

  const res = await fetch(`${WOC_BASE}/tx/${txid}/status`, { headers });
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
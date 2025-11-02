// src/lib/txMonitor.ts
import fetch from 'node-fetch';

type TxState = {
  txid: string;
  confirmed: boolean;
  confs: number;                 // confirmations (0 if mempool)
  firstSeenAt: number;           // ms
  lastCheckedAt: number;         // ms
  nextCheckAt: number;           // ms
  attempts: number;              // used for backoff
  error?: string;
};

const store = new Map<string, TxState>();

// ---- Backoff schedule (in seconds): 5, 15, 30, 60, 120, 300, 600 (cap)
const STEPS = [5, 15, 30, 60, 120, 300, 600];

function nextDelaySec(attempts: number) {
  return STEPS[Math.min(attempts, STEPS.length - 1)];
}

export function upsertTx(txid: string) {
  const now = Date.now();
  if (!store.has(txid)) {
    store.set(txid, {
      txid,
      confirmed: false,
      confs: 0,
      firstSeenAt: now,
      lastCheckedAt: 0,
      nextCheckAt: now,  // check immediately once
      attempts: 0,
    });
  }
  return store.get(txid)!;
}

export function getTx(txid: string) {
  return store.get(txid);
}

export function getSafeStatus(txid: string) {
  const s = store.get(txid);
  if (!s) return null;
  // return only what the client needs
  return {
    txid: s.txid,
    confirmed: s.confirmed,
    confs: s.confs,
    firstSeenAt: s.firstSeenAt,
    lastCheckedAt: s.lastCheckedAt,
    nextCheckAt: s.nextCheckAt,
    attempts: s.attempts,
    error: s.error ?? null,
  };
}

// --- Replace this with your preferred indexer if not using WOC.
// Keep payload tiny; do NOT pull full tx each time.
async function queryConfirmation(txid: string): Promise<{ confirmed: boolean; confs: number }> {
  // WhatsOnChain testnet minimal status path (tiny response)
  // Example fallback-safe pattern:
  const url = `https://api.whatsonchain.com/v1/bsv/test/tx/${txid}/status`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`WOC status ${res.status}`);
  // Expect shape like: { "confirmed": true/false, "confirmations": n }
  const json = (await res.json()) as any;
  const confirmed = Boolean(json.confirmed ?? json.isConfirmed ?? false);
  const confs = Number(json.confirmations ?? json.confs ?? (confirmed ? 1 : 0));
  return { confirmed, confs: isFinite(confs) ? confs : (confirmed ? 1 : 0) };
}

// Worker: runs every 5s, but only hits network when a tx is due.
// One network call can satisfy thousands of clients.
setInterval(async () => {
  const now = Date.now();
  for (const s of store.values()) {
    if (s.confirmed) continue;
    if (s.nextCheckAt > now) continue;

    try {
      const { confirmed, confs } = await queryConfirmation(s.txid);
      s.lastCheckedAt = now;
      s.error = undefined;

      if (confirmed) {
        s.confirmed = true;
        s.confs = confs > 0 ? confs : 1;
        s.nextCheckAt = Infinity;       // stop forever
        continue;
      }

      // not confirmed yet -> schedule with backoff
      s.confs = 0;
      s.attempts += 1;
      const delay = nextDelaySec(s.attempts) * 1000;
      s.nextCheckAt = now + delay;

      // Hard stop after ~30 min of backoff if you like:
      // if (now - s.firstSeenAt > 30 * 60 * 1000) s.nextCheckAt = now + 10 * 60 * 1000;
    } catch (e: any) {
      s.lastCheckedAt = now;
      s.error = String(e?.message || e);
      s.attempts += 1;
      const delay = nextDelaySec(s.attempts) * 1000;
      s.nextCheckAt = now + delay;
    }
  }
}, 5000);

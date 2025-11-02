// Hardened WhatsOnChain adapter for TESTNET.
// - Broadcasts raw tx
// - Waits (non-fatally) for visibility with exponential backoff
// - Never throws on 404 visibility during the grace window

export type BroadcastResult = {
  ok: true;
  txid: string;
  visible: boolean;         // whether WOC indexed it during our wait
  firstSeenAt: number;      // epoch ms when we broadcasted
  attempts: number;         // visibility attempts
};

export type BroadcastError = {
  ok: false;
  error: string;
  detail?: string;
};

const WOC_BASE = "https://api.whatsonchain.com/v1/bsv/test";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function wocBroadcast(rawTxHex: string): Promise<{ ok: true; txid: string } | BroadcastError> {
  try {
    const res = await fetch(`${WOC_BASE}/tx/raw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txhex: rawTxHex }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: "broadcast_failed", detail: text || `HTTP ${res.status}` };
    }

    // WOC returns the txid as plain text (quoted or not, depending on endpoint behavior)
    const txt = await res.text();
    const txid = (txt || "").trim().replace(/^"+|"+$/g, "");
    if (!/^[0-9a-f]{64}$/i.test(txid)) {
      return { ok: false, error: "broadcast_weird_txid", detail: txt };
    }
    return { ok: true, txid };
  } catch (e: any) {
    return { ok: false, error: "broadcast_exception", detail: String(e?.message || e) };
  }
}

export async function wocIsVisible(txid: string): Promise<"yes" | "no" | "err"> {
  try {
    // Cheapest existence check is fetching the tx hash (metadata) or raw.
    const res = await fetch(`${WOC_BASE}/tx/hash/${txid}`, { method: "GET" });
    if (res.status === 200) return "yes";
    if (res.status === 404) return "no";
    return "err";
  } catch {
    return "err";
  }
}

/**
 * Broadcast and then wait (non-fatally) for WOC to index the tx.
 * - totalWaitMs: hard cap on waiting time
 * - firstDelayMs: initial delay before first check
 * - maxAttempts: cap on visibility checks
 */
export async function broadcastAndWaitVisible(
  rawTxHex: string,
  opts?: { totalWaitMs?: number; firstDelayMs?: number; maxAttempts?: number }
): Promise<BroadcastResult | BroadcastError> {
  const totalWaitMs = opts?.totalWaitMs ?? 15000;   // 15s cap
  const firstDelayMs = opts?.firstDelayMs ?? 500;   // half-second before first peek
  const maxAttempts = opts?.maxAttempts ?? 6;       // ~0.5s, 1s, 2s, 4s, 4s, 4s (≈16s)

  const b = await wocBroadcast(rawTxHex);
  if (!b.ok) return b;

  const start = Date.now();
  let delay = firstDelayMs;
  let attempts = 0;

  while (Date.now() - start < totalWaitMs && attempts < maxAttempts) {
    await sleep(delay);
    attempts++;
    const v = await wocIsVisible(b.txid);
    if (v === "yes") {
      return { ok: true, txid: b.txid, visible: true, firstSeenAt: start, attempts };
    }
    // exponential backoff, but don't explode past 4s steps
    delay = Math.min(delay * 2, 4000);
  }

  // NOT FATAL: we still return ok with visible:false
  return { ok: true, txid: b.txid, visible: false, firstSeenAt: start, attempts };
}

import { db } from "./db";
import { queryWocTxStatus } from "./woc";

const POLL_INTERVAL_MS = 60_000;

const selectPendingStmt = db.prepare(
  `SELECT txid FROM mints WHERE confirmed = 0 AND txid IS NOT NULL`
);
const markConfirmedStmt = db.prepare(`UPDATE mints SET confirmed = 1 WHERE txid = ?`);

let timer: NodeJS.Timeout | null = null;
let isRunning = false;
const lastCheck = new Map<string, number>();

async function pollOnce(now: number) {
  const pending = selectPendingStmt.all() as Array<{ txid: string }>;
  const seen = new Set<string>();

  for (const row of pending) {
    const txid = String(row.txid || "").trim();
    if (!txid) continue;
    seen.add(txid);

    const last = lastCheck.get(txid) ?? 0;
    if (now - last < POLL_INTERVAL_MS) {
      continue;
    }

    lastCheck.set(txid, now);

    try {
      const status = await queryWocTxStatus(txid);
      if (!status.ok) {
        continue;
      }
      if (!status.confirmed) {
        continue;
      }
      const result = markConfirmedStmt.run(txid);
      if (result.changes > 0) {
        console.log(`[CONFIRM] ${txid}`);
      }
    } catch (err: any) {
      console.warn(`[CONFIRM] poll failed for ${txid}: ${String(err?.message || err)}`);
    }
  }

  for (const key of Array.from(lastCheck.keys())) {
    if (!seen.has(key)) {
      lastCheck.delete(key);
    }
  }
}

async function runLoop() {
  if (isRunning) {
    return;
  }
  isRunning = true;
  try {
    await pollOnce(Date.now());
  } finally {
    isRunning = false;
  }
}

export function pollPendingMints() {
  if (timer) {
    return timer;
  }
  runLoop().catch((err) => {
    console.error(`[CONFIRM] initial poll failed: ${String(err?.message || err)}`);
  });
  timer = setInterval(() => {
    runLoop().catch((err) => {
      console.error(`[CONFIRM] poll tick failed: ${String(err?.message || err)}`);
    });
  }, POLL_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

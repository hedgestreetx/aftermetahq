import type { Statement } from "better-sqlite3";

import { getDb } from "./db";
import { queryWocTxStatus } from "./woc";

const POLL_INTERVAL_MS = 60_000;

type PollerState = {
  selectPendingStmt: Statement | null;
  markConfirmedStmt: Statement | null;
  timer: NodeJS.Timeout | null;
  running: boolean;
};

type GlobalPollerState = {
  __aftermetaMintPoller?: PollerState;
};

const globalPollerState = globalThis as typeof globalThis & GlobalPollerState;

function getState(): PollerState {
  if (!globalPollerState.__aftermetaMintPoller) {
    globalPollerState.__aftermetaMintPoller = {
      selectPendingStmt: null,
      markConfirmedStmt: null,
      timer: null,
      running: false,
    };
  }
  return globalPollerState.__aftermetaMintPoller;
}

function getSelectPendingStmt(): Statement {
  const state = getState();
  if (
    !state.selectPendingStmt ||
    !(state.selectPendingStmt as Statement & { database?: { open?: boolean } }).database?.open
  ) {
    state.selectPendingStmt = getDb().prepare(
      `SELECT txid FROM mints WHERE confirmed = 0 AND txid IS NOT NULL`
    );
  }
  return state.selectPendingStmt;
}

function getMarkConfirmedStmt(): Statement {
  const state = getState();
  if (
    !state.markConfirmedStmt ||
    !(state.markConfirmedStmt as Statement & { database?: { open?: boolean } }).database?.open
  ) {
    state.markConfirmedStmt = getDb().prepare(`UPDATE mints SET confirmed = 1 WHERE txid = ?`);
  }
  return state.markConfirmedStmt;
}

async function pollOnce() {
  const rows = getSelectPendingStmt().all() as Array<{ txid: string }>;
  for (const row of rows) {
    const txid = String(row.txid ?? "").trim();
    if (!txid) continue;

    try {
      const status = await queryWocTxStatus(txid);
      if (!status.ok || !status.confirmed) {
        continue;
      }
      const result = getMarkConfirmedStmt().run(txid);
      if (result.changes > 0) {
        console.log(`[CONFIRM] ${txid}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[CONFIRM] poll failed for ${txid}: ${message}`);
    }
  }
}

async function runLoop() {
  const state = getState();
  if (state.running) {
    return;
  }
  state.running = true;
  try {
    await pollOnce();
  } finally {
    state.running = false;
  }
}

export function startMintConfirmationPoller(): NodeJS.Timeout {
  const state = getState();
  if (state.timer) {
    return state.timer;
  }

  runLoop().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[CONFIRM] initial poll failed: ${message}`);
  });

  state.timer = setInterval(() => {
    runLoop().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[CONFIRM] poll tick failed: ${message}`);
    });
  }, POLL_INTERVAL_MS);
  state.timer.unref?.();
  return state.timer;
}

export function stopMintConfirmationPoller() {
  const state = getState();
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  state.running = false;
}

export async function triggerMintConfirmationPollerOnce() {
  await runLoop();
}

export function resetMintConfirmationPollerForTests() {
  stopMintConfirmationPoller();
  const state = getState();
  state.selectPendingStmt = null;
  state.markConfirmedStmt = null;
}

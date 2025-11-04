import { db } from "./db";
import { queryWocTxStatus } from "./woc";

type Statement = ReturnType<typeof db.prepare> | null;

let markMintConfirmedStmt: Statement = null;
let pendingMintsStmt: Statement = null;

function ensureStatements() {
  if (markMintConfirmedStmt && pendingMintsStmt) {
    return;
  }

  try {
    if (!markMintConfirmedStmt) {
      markMintConfirmedStmt = db.prepare(
        `UPDATE mints SET confirmed = 1 WHERE txid = ? COLLATE NOCASE`,
      );
    }

    if (!pendingMintsStmt) {
      pendingMintsStmt = db.prepare(
        `SELECT txid FROM mints
          WHERE confirmed = 0
            AND length(txid) = 64
            AND txid GLOB '[0-9a-fA-F]*'
          ORDER BY created_at DESC
          LIMIT ?`,
      );
    }
  } catch (err) {
    markMintConfirmedStmt = null;
    pendingMintsStmt = null;
    throw new Error(`mint_verifier_prepare_failed: ${String((err as any)?.message || err)}`);
  }
}

export const normalizeTxid = (value: string) => String(value ?? "").trim().toLowerCase();

export const isTxid = (value: string) => /^[0-9a-f]{64}$/.test(normalizeTxid(value));

export function markMintConfirmed(txid: string): number {
  ensureStatements();
  return markMintConfirmedStmt!.run(txid).changes;
}

export type MintStatus = {
  txid: string;
  ok: boolean;
  status: number;
  confirmed: boolean;
  confirmations: number;
  blockHeight: number | null;
  error?: string;
};

export async function loadMintStatus(txid: string): Promise<MintStatus> {
  const normalized = normalizeTxid(txid);
  if (!isTxid(normalized)) {
    return {
      txid: normalized,
      ok: false,
      status: 400,
      confirmed: false,
      confirmations: 0,
      blockHeight: null,
      error: "invalid_txid",
    };
  }

  const result = await queryWocTxStatus(normalized);
  return {
    txid: normalized,
    ok: result.ok,
    status: result.status,
    confirmed: result.confirmed,
    confirmations: result.confirmations,
    blockHeight: result.blockHeight,
    error: result.error,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function verifyPendingMints(limit = 100): Promise<{ checked: number; flipped: number }> {
  ensureStatements();

  const rows = pendingMintsStmt!.all(limit) as Array<{ txid: string }>;
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const normalized = normalizeTxid(row.txid);
    if (!isTxid(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }

  let checked = 0;
  let flipped = 0;
  for (const [idx, txid] of unique.entries()) {
    const status = await loadMintStatus(txid);
    if (status.ok) {
      checked += 1;
      if (status.confirmed) {
        flipped += markMintConfirmed(txid);
      }
    } else if (status.status > 0 || status.error) {
      checked += 1;
    }

    if (idx < unique.length - 1) {
      await sleep(150);
    }
  }

  console.log(`[VERIFY] checked=${checked} flipped=${flipped}`);
  return { checked, flipped };
}

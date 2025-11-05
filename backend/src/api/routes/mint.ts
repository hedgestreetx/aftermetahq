import type { Request, Response } from "express";
import { Router } from "express";
import type { Statement } from "better-sqlite3";

import { getDb } from "../../lib/db";
import { getEnv } from "../../lib/env";
import { wocWebTxUrl } from "../../lib/wocUrls";
import { broadcastRawTransaction, queryWocTxStatus } from "../../lib/woc";

const router = Router();

let upsertMintStmt: Statement | null = null;

function getUpsertMintStmt(): Statement {
  if (!upsertMintStmt) {
    upsertMintStmt = getDb().prepare(
      `INSERT INTO mints (txid, explorer_url, confirmed)
       VALUES (?, ?, ?)
       ON CONFLICT(txid)
       DO UPDATE SET explorer_url=excluded.explorer_url, confirmed=MAX(confirmed, excluded.confirmed)`
    );
  }
  return upsertMintStmt;
}

function isHex(value: string): boolean {
  return /^[0-9a-fA-F]+$/.test(value);
}

router.post("/mint", async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const txHex = typeof body.txHex === "string" ? body.txHex.trim() : "";
  const env = getEnv();
  const network = typeof body.network === "string" ? body.network : undefined;

  if (!txHex) {
    return res.status(400).json({ ok: false, error: "txHex_required" });
  }
  if (!isHex(txHex)) {
    return res.status(400).json({ ok: false, error: "txHex_invalid" });
  }

  try {
    const broadcastResult = await broadcastRawTransaction(txHex);
    let txid = broadcastResult.txid;

    if (!txid) {
      txid = typeof body.txid === "string" ? body.txid.trim().toLowerCase() : "";
    }

    if (!txid) {
      return res.status(502).json({ ok: false, error: "txid_unavailable" });
    }

    let confirmed = false;
    if (broadcastResult.alreadyKnown) {
      const status = await queryWocTxStatus(txid);
      confirmed = status.ok && status.confirmed;
    }

    const explorerUrl = wocWebTxUrl(txid, network ?? env.NETWORK);

    getUpsertMintStmt().run(txid, explorerUrl, confirmed ? 1 : 0);

    return res.status(200).json({ ok: true, txid, explorerUrl, confirmed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ ok: false, error: message });
  }
});

router.get("/mint/:txid/status", async (req: Request, res: Response) => {
  const txid = String(req.params.txid ?? "").trim();
  if (!txid) {
    return res.status(400).json({ ok: false, error: "txid_required" });
  }

  try {
    const status = await queryWocTxStatus(txid);
    return res.status(200).json({ ok: true, txid, status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ ok: false, error: message });
  }
});

export default router;

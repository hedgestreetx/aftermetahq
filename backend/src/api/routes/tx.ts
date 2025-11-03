import { Router } from "express";

import { db } from "../../lib/db";
import { ENV } from "../../lib/env";

const r = Router();

const NET_WOC = ENV.NETWORK === "mainnet" ? "main" : "test";
const isTxid = (s: string) => typeof s === "string" && /^[0-9a-fA-F]{64}$/.test(s);

r.get("/:txid/status", async (req, res) => {
  try {
    const txid = String(req.params.txid || "").trim();
    if (!isTxid(txid)) {
      return res.status(400).json({ ok: false, error: "invalid_txid" });
    }

    const resp = await fetch(`https://api.whatsonchain.com/v1/bsv/${NET_WOC}/tx/${txid}/status`);
    if (!resp.ok) {
      return res.status(502).json({ ok: false, error: `woc_status_${resp.status}` });
    }
    const j = await resp.json().catch(() => ({} as any));
    const confirmed = Boolean(j?.confirmed);

    if (confirmed) {
      db.prepare(`UPDATE mints SET confirmed=1 WHERE txid=?`).run(txid);
    }

    res.json({
      ok: true,
      txid,
      confirmed,
      blockHeight: Number(j?.blockheight ?? j?.blockHeight ?? null) || null,
      blockTime: null,
    });
  } catch (e: any) {
    res.status(502).json({ ok: false, error: String(e?.message || e) });
  }
});

export default r;

import { Router } from "express";

import { isTxid, loadMintStatus, markMintConfirmed, normalizeTxid } from "../../lib/mintVerifier";

const r = Router();

r.get("/:txid/status", async (req, res) => {
  try {
    const txid = normalizeTxid(String(req.params.txid || ""));
    if (!isTxid(txid)) {
      return res.status(400).json({ ok: false, error: "invalid_txid" });
    }

    const status = await loadMintStatus(txid);
    if (!status.ok) {
      const err = status.status > 0 ? `woc_status_${status.status}` : status.error || "woc_status_fetch_failed";
      return res.status(502).json({ ok: false, error: err });
    }

    if (status.confirmed) {
      markMintConfirmed(txid);
    }

    console.log(
      `[TX] status tx=${txid} confirmed=${status.confirmed ? 1 : 0} bh=${
        status.blockHeight !== null ? status.blockHeight : "null"
      }`,
    );

    res.json({
      ok: true,
      txid,
      confirmed: status.confirmed,
      blockHeight: status.blockHeight,
      blockTime: null,
    });
  } catch (e: any) {
    res.status(502).json({ ok: false, error: String(e?.message || e) });
  }
});

export default r;

import { Router } from "express";
import { ENV } from "../../lib/env";
import { db } from "../../lib/db";
import { flags } from "../../lib/flags";
import { recentQuotes } from "../../lib/quoteStore";

const r = Router();

const BASE58_RX = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;
const NET_WOC = ENV.NETWORK === "mainnet" ? "main" : "test";

async function fetchUtxos(address: string) {
  const url = `https://api.whatsonchain.com/v1/bsv/${NET_WOC}/address/${address}/unspent`;
  const r2 = await fetch(url);
  if (!r2.ok) throw new Error(`woc_utxos_http_${r2.status} ${await r2.text()}`);
  return r2.json() as Promise<Array<{ tx_hash: string; tx_pos: number; value: number }>>;
}

r.get("/health", (_req, res) =>
  res.json({ service: "aftermeta-backend", network: ENV.NETWORK, port: ENV.PORT })
);

r.get("/v1/admin/state", (_req, res) => {
  res.json({
    ok: true,
    network: ENV.NETWORK,
    feePerKb: ENV.FEE_PER_KB,
    minConfs: ENV.MIN_CONFIRMATIONS,
    flags: flags(),
    poolAddr: ENV.POOL_P2SH_ADDRESS || "",
    poolLockingScriptHexLen: (ENV.POOL_LOCKING_SCRIPT_HEX || "").length,
  });
});

r.get("/debug/db/fk", (_req, res) =>
  res.json({ fk: db.pragma("foreign_keys", { simple: true }) })
);

r.get("/debug/db/summary", (_req, res) => {
  try {
    const pools = db.prepare("SELECT COUNT(*) AS c FROM pools").get() as any;
    const mints = db.prepare("SELECT COUNT(*) AS c FROM mints").get() as any;
    const lastPool = db.prepare(
      "SELECT id, symbol, pool_address AS addr, substr(locking_script_hex,1,16)||'…' AS lsh, created_at FROM pools ORDER BY created_at DESC LIMIT 1"
    ).get() as any;
    const lastMint = db.prepare(
      "SELECT id, pool_id AS poolId, symbol, txid, confirmed, created_at FROM mints ORDER BY created_at DESC LIMIT 1"
    ).get() as any;
    const dbPath = (db as any).name || "aftermeta.db";

    res.json({
      ok: true,
      dbPath,
      counts: { pools: Number(pools?.c || 0), mints: Number(mints?.c || 0) },
      lastPool: lastPool || null,
      lastMint: lastMint || null,
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

r.get("/debug/quote/:symbol", (req, res) => {
  try {
    const symbol = String(req.params.symbol || "").trim();
    const quotes = recentQuotes(symbol, 3);
    res.json({
      ok: true,
      recentQuotes: quotes.map((q) => ({
        symbol: q.symbol,
        spendSats: q.spendSats,
        feeEstimate: q.feeEstimate,
        netSpend: q.netSpend,
        tokensEstimate: q.tokensEstimate,
        inputCount: q.inputCount,
        changeSats: q.changeSats,
        fromAddress: q.fromAddress,
        createdAt: q.createdAt,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

r.get("/debug/ping", (_req, res) =>
  res.type("text/plain").send("aftermeta-backend :: pong")
);

r.get("/v1/utxos/:address", async (req, res) => {
  const addr = String(req.params.address || "").trim();
  if (!BASE58_RX.test(addr)) {
    return res.status(400).json({ ok: false, error: "invalid_base58" });
  }
  try {
    const utxos = await fetchUtxos(addr);
    res.json({ ok: true, utxos });
  } catch (e: any) {
    res.status(502).json({ ok: false, error: String(e?.message || e) });
  }
});

r.get("/v1/withdrawals/can/:poolId", (req, res) => {
  const poolId = String(req.params.poolId || "").trim();
  if (!poolId) return res.status(400).json({ ok: false, error: "bad_pool" });
  try {
    const pending = db
      .prepare(
        `SELECT COUNT(1) AS c
           FROM mints
          WHERE pool_id=? AND confirmed=0 AND length(txid)=64 AND txid GLOB '[0-9A-Fa-f]*'`
      )
      .get(poolId) as any;

    const m = Number(pending?.c || 0);
    const can = m === 0;
    res.json({ ok: true, can, reason: can ? null : `unconfirmed mints=${m}` });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default r;

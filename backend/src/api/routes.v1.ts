import { Router } from "express";
import { db } from "../lib/db";
import { flags } from "../lib/flags";
import { ENV } from "../lib/env";
import { appendLedger, refreshSupply, viewSupply } from "../lib/ledger";
import { idempotency, persistResult } from "./idempotency";
import { rid } from "../lib/ids";

const r = Router();

r.get("/health", (_req, res) => res.json({ ok: true }));
r.get("/v1/admin/state", (_req, res) => {
  res.json({
    ok: true,
    network: ENV.NETWORK,
    feePerKb: ENV.FEE_PER_KB,
    minConfs: ENV.MIN_CONFIRMATIONS,
    flags: flags(),
    poolAddr: ENV.POOL_P2SH_ADDRESS,
    poolLockingScriptHexLen: ENV.POOL_LOCKING_SCRIPT_HEX.length
  });
});

r.post("/v1/pools", idempotency(), (req, res) => {
  const p = req.body;
  if (!p?.symbol || !p?.creator || !p?.poolAddress || !p?.lockingScriptHex)
    return res.status(400).json({ ok: false, error: "Missing fields" });

  const id = p.id || rid();
  db.prepare(
    `INSERT OR REPLACE INTO pools(id, symbol, creator, pool_address, locking_script_hex, max_supply, decimals, creator_reserve)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, p.symbol, p.creator, p.poolAddress, p.lockingScriptHex, p.maxSupply, p.decimals, p.creatorReserve);

  db.prepare(`INSERT OR IGNORE INTO pool_supply(pool_id, minted_supply) VALUES(?, 0)`).run(id);

  const out = { ok: true, pool: { id, ...p }, supply: { minted: 0 } };
  persistResult(req, out, "CREATE_POOL", p);
  res.json(out);
});

r.get("/v1/pools/:id", (req, res) => {
  const p = db.prepare(`SELECT * FROM pools WHERE id=?`).get(req.params.id) as any;
  if (!p) return res.status(404).json({ ok: false, error: "pool_not_found" });
  const mintedSupply = viewSupply(p.id);
  const left = Math.max(0, p.max_supply - mintedSupply);
  const percentMinted = p.max_supply ? (mintedSupply / p.max_supply) * 100 : 0;
  res.json({
    ok: true,
    pool: {
      id: p.id, symbol: p.symbol, creator: p.creator,
      poolAddress: p.pool_address, lockingScriptHex: p.locking_script_hex,
      maxSupply: p.max_supply, decimals: p.decimals, creatorReserve: p.creator_reserve
    },
    supply: { mintedSupply, left, percentMinted }
  });
});

r.post("/v1/quotes/buy", (req, res) => {
  const { poolId, spendSats, maxSlippageBps } = req.body ?? {};
  if (!poolId || !Number.isFinite(spendSats)) return res.status(400).json({ ok: false, error: "bad_request" });
  if ((maxSlippageBps ?? 0) > flags().maxSlippageBps) return res.status(400).json({ ok: false, error: "slippage_too_high" });

  const pool = db.prepare(`SELECT * FROM pools WHERE id=?`).get(poolId) as any;
  if (!pool) return res.status(404).json({ ok: false, error: "pool_not_found" });

  const price = Math.max(1, Math.floor(spendSats / 1000));
  const quoteId = rid();
  const expiresAt = Date.now() + 30000;

  res.json({ ok: true, quoteId, price, expiresAt });
});

r.post("/v1/orders/buy", idempotency(), (req, res) => {
  const { quoteId, poolId, spendSats } = req.body ?? {};
  if (!quoteId || !poolId || !Number.isFinite(spendSats)) return res.status(400).json({ ok: false, error: "bad_request" });

  const pool = db.prepare(`SELECT * FROM pools WHERE id=?`).get(poolId) as any;
  if (!pool) return res.status(404).json({ ok: false, error: "pool_not_found" });

  if (!flags().devBuyEnabled) return res.status(403).json({ ok: false, error: "dev_buy_disabled" });

  const tokens = Math.floor(spendSats / 1000);
  if (tokens <= 0) return res.status(400).json({ ok: false, error: "too_small" });

  appendLedger(poolId, "buyer:stub", pool.symbol, tokens, "BUY_FILL", null);
  refreshSupply(poolId, pool.symbol);

  const txid = `stub-${quoteId}`;
  const result = { ok: true, orderId: quoteId, txid, filledTokens: tokens };
  persistResult(req, result, "BUY", req.body);
  res.json(result);
});

r.get("/v1/utxos/:address", async (req, res) => {
  const addr = req.params.address;
  if (!/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/.test(addr)) {
    return res.status(400).json({ ok: false, error: "invalid_base58" });
  }
  const { fetchUtxos } = await import("../lib/woc");
  try {
    const utxos = await fetchUtxos(addr);
    res.json({ ok: true, utxos });
  } catch (e: any) {
    res.status(502).json({ ok: false, error: String(e?.message || e) });
  }
});

export default r;

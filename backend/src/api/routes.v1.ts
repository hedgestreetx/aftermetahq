import { Router } from "express";
import { db } from "../lib/db";
import { flags } from "../lib/flags";
import { ENV } from "../lib/env";
import { appendLedger, refreshSupply, viewSupply } from "../lib/ledger";
import { idempotency, persistResult } from "./idempotency";
import { rid } from "../lib/ids";

const r = Router();

const clamp = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;

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

/* ------------------------- POOLS ------------------------- */

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

// ADD this near the other /v1/pools routes
r.get("/v1/pools", (_req, res) => {
  const rows = db.prepare(
    `SELECT id, symbol, creator, pool_address, locking_script_hex,
            max_supply, decimals, creator_reserve, created_at
       FROM pools
       ORDER BY created_at DESC`
  ).all() as any[];

  res.json({
    ok: true,
    pools: rows.map(p => ({
      id: p.id,
      symbol: p.symbol,
      creator: p.creator,
      poolAddress: p.pool_address,
      lockingScriptHex: p.locking_script_hex,
      maxSupply: p.max_supply,
      decimals: p.decimals,
      creatorReserve: p.creator_reserve,
      createdAt: p.created_at,
    })),
  });
});

/* ------------------------- QUOTES / ORDERS (DEV STUBS) ------------------------- */

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

/* ------------------------- UTXOS ------------------------- */

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

/* ------------------------- MINTS (STRICT) ------------------------- */

// Resolve a real poolId+symbol from inputs or die trying.
function resolvePoolIdAndSymbol(opts: {
  poolId?: string;
  symbol?: string;
  poolLockingScriptHex?: string;
}) {
  const reqPoolId = (opts.poolId || "").trim();
  const reqSymbol = (opts.symbol || "").trim().toUpperCase();

  if (reqPoolId && reqSymbol) {
    const r = db.prepare(`SELECT id, symbol FROM pools WHERE id=?`).get(reqPoolId) as any;
    if (!r) throw new Error("pool_not_found");
    if ((r.symbol || "").toUpperCase() !== reqSymbol) throw new Error("pool_symbol_mismatch");
    return { poolId: r.id, symbol: r.symbol.toUpperCase() };
  }

  if (reqPoolId) {
    const r = db.prepare(`SELECT id, symbol FROM pools WHERE id=?`).get(reqPoolId) as any;
    if (!r) throw new Error("pool_not_found");
    return { poolId: r.id, symbol: (r.symbol || "").toUpperCase() };
  }

  if (reqSymbol) {
    const r = db.prepare(`SELECT id, symbol FROM pools WHERE UPPER(symbol)=?`).get(reqSymbol) as any;
    if (!r) throw new Error("pool_not_found_by_symbol");
    return { poolId: r.id, symbol: r.symbol.toUpperCase() };
  }

  const lsh = (opts.poolLockingScriptHex || "").trim().toLowerCase();
  if (lsh) {
    const r = db.prepare(`SELECT id, symbol FROM pools WHERE LOWER(locking_script_hex)=?`).get(lsh) as any;
    if (!r) throw new Error("pool_not_found_by_script");
    return { poolId: r.id, symbol: r.symbol.toUpperCase() };
  }

  throw new Error("pool_not_resolved");
}

// POST /v1/mint — strict write, no garbage defaults.
r.post("/v1/mint", idempotency(), (req, res) => {
  try {
    const { spendSats, poolId, symbol, poolLockingScriptHex } = req.body ?? {};
    if (!Number.isFinite(spendSats) || spendSats <= 0) {
      return res.status(400).json({ ok: false, error: "bad_request" });
    }

    const resolved = resolvePoolIdAndSymbol({
      poolId,
      symbol,
      poolLockingScriptHex: poolLockingScriptHex || ENV.POOL_LOCKING_SCRIPT_HEX
    });

    // TODO: Build/broadcast real TX. For now, stub a deterministic txid.
    const txid = `mint-${rid()}`;

    db.prepare(`
      INSERT INTO mint_tx (txid, pool_id, symbol, sats, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(txid, resolved.poolId, resolved.symbol, Math.trunc(spendSats), Date.now());

    persistResult(req, { ok: true, txid, ...resolved }, "MINT", req.body);
    res.json({ ok: true, txid, poolId: resolved.poolId, symbol: resolved.symbol });
  } catch (e: any) {
    const msg = String(e?.message || e);
    const status =
      msg.includes("pool_") || msg.includes("resolved") ? 400 : 500;
    res.status(status).json({ ok: false, error: msg });
  }
});

// GET /v1/mints — joined read with backfill + filters + cursor
r.get("/v1/mints", (req, res) => {
  try {
    const limit = clamp(Number(req.query.limit ?? 50), 1, 500);
    const qPoolId = typeof req.query.poolId === "string" ? req.query.poolId.trim() : "";
    const qSymbol = typeof req.query.symbol === "string" ? req.query.symbol.trim().toUpperCase() : "";
    const cursorCreatedAt = req.query.cursorCreatedAt ? Number(req.query.cursorCreatedAt) : 0;
    const cursorTxid = typeof req.query.cursorTxid === "string" ? req.query.cursorTxid.trim() : "";

    const where: string[] = [];
    const params: any[] = [];

    if (qPoolId) { where.push("m.pool_id = ?"); params.push(qPoolId); }
    if (qSymbol) { where.push("UPPER(COALESCE(NULLIF(m.symbol,''), p.symbol)) = ?"); params.push(qSymbol); }
    if (cursorCreatedAt && cursorTxid) {
      where.push("(m.created_at < ? OR (m.created_at = ? AND m.txid < ?))");
      params.push(cursorCreatedAt, cursorCreatedAt, cursorTxid);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = db.prepare(
      `
      SELECT
        m.txid,
        m.pool_id,
        COALESCE(NULLIF(m.symbol,''), p.symbol) AS symbol,
        m.sats,
        m.created_at
      FROM mint_tx m
      LEFT JOIN pools p ON p.id = m.pool_id
      ${whereSql}
      ORDER BY m.created_at DESC, m.txid DESC
      LIMIT ?
      `
    ).all(...params, limit) as any[];

    let nextCursor: { createdAt: number; txid: string } | null = null;
    if (rows.length === limit) {
      const last = rows[rows.length - 1];
      nextCursor = { createdAt: Number(last.created_at), txid: String(last.txid) };
    }

    res.json({ ok: true, mints: rows, nextCursor });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default r;

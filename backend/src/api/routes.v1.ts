import { Router } from "express";
import { db, dbInfo } from "../lib/db";
import { flags } from "../lib/flags";
import { ENV } from "../lib/env";
import { appendLedger, refreshSupply, viewSupply } from "../lib/ledger";
import { idempotency, persistResult } from "./idempotency";
import { rid } from "../lib/ids";
import { bsv } from "scrypt-ts";

const r = Router();

// ----------------------------- constants/util -----------------------------
const clamp = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;

const DUST = 546;
const FEE_PER_KB = ENV.FEE_PER_KB || 150;
const BASE58_RX = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;

function toBool(v: any) { return !!v; }

// ----------------------------- health/admin -----------------------------
r.get("/health", (_req, res) => res.json({ ok: true }));

r.get("/v1/admin/state", (_req, res) => {
  res.json({
    ok: true,
    network: ENV.NETWORK,
    feePerKb: ENV.FEE_PER_KB,
    minConfs: ENV.MIN_CONFIRMATIONS,
    flags: flags(),
    poolAddr: ENV.POOL_P2SH_ADDRESS,
    poolLockingScriptHexLen: (ENV.POOL_LOCKING_SCRIPT_HEX || "").length,
  });
});

// ----------------------------- pools -----------------------------
r.post("/v1/pools", idempotency(), (req, res) => {
  const p = req.body;
  if (!p?.symbol || !p?.creator || !p?.poolAddress || !p?.lockingScriptHex) {
    return res.status(400).json({ ok: false, error: "missing_fields" });
  }

  const id = p.id || rid();
  const createdAt = Date.now();

  db.prepare(
    `INSERT OR REPLACE INTO pools
     (id, symbol, creator, pool_address, locking_script_hex, max_supply, decimals, creator_reserve, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    String(p.symbol).trim().toUpperCase(),
    String(p.creator).trim(),
    String(p.poolAddress).trim(),
    String(p.lockingScriptHex).trim(),
    Number(p.maxSupply ?? 0),
    Number(p.decimals ?? 0),
    Number(p.creatorReserve ?? 0),
    createdAt
  );

  db.prepare(
    `INSERT OR IGNORE INTO pool_supply(pool_id, minted_supply) VALUES(?, 0)`
  ).run(id);

  const out = {
    ok: true,
    pool: {
      id,
      symbol: String(p.symbol).trim().toUpperCase(),
      creator: p.creator,
      poolAddress: p.poolAddress,
      lockingScriptHex: p.lockingScriptHex,
      maxSupply: Number(p.maxSupply ?? 0),
      decimals: Number(p.decimals ?? 0),
      creatorReserve: Number(p.creatorReserve ?? 0),
      createdAt,
    },
    supply: { minted: 0 },
  };
  persistResult(req, out, "CREATE_POOL", p);
  res.json(out);
});

r.get("/v1/pools/:id", (req, res) => {
  const p = db.prepare(`SELECT * FROM pools WHERE id=?`).get(req.params.id) as any;
  if (!p) return res.status(404).json({ ok: false, error: "pool_not_found" });

  const mintedSupply = viewSupply(p.id);
  const left = Math.max(0, (p.max_supply || 0) - mintedSupply);
  const percentMinted = p.max_supply ? (mintedSupply / p.max_supply) * 100 : 0;

  res.json({
    ok: true,
    pool: {
      id: p.id,
      symbol: p.symbol,
      creator: p.creator,
      poolAddress: p.pool_address,
      lockingScriptHex: p.locking_script_hex,
      maxSupply: p.max_supply,
      decimals: p.decimals,
      creatorReserve: p.creator_reserve,
      createdAt: p.created_at,
    },
    supply: { mintedSupply, left, percentMinted },
  });
});

r.get("/v1/pools", (_req, res) => {
  const rows = db.prepare(
    `SELECT id, symbol, creator, pool_address, locking_script_hex,
            max_supply, decimals, creator_reserve, created_at
       FROM pools
   ORDER BY created_at DESC`
  ).all() as any[];

  res.json({
    ok: true,
    pools: rows.map((p) => ({
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

// ----------------------------- quotes/orders (dev) -----------------------------
r.post("/v1/quotes/buy", (req, res) => {
  const { poolId, spendSats, maxSlippageBps } = req.body ?? {};
  if (!poolId || !Number.isFinite(spendSats))
    return res.status(400).json({ ok: false, error: "bad_request" });
  if ((maxSlippageBps ?? 0) > flags().maxSlippageBps)
    return res.status(400).json({ ok: false, error: "slippage_too_high" });

  const pool = db.prepare(`SELECT * FROM pools WHERE id=?`).get(poolId) as any;
  if (!pool) return res.status(404).json({ ok: false, error: "pool_not_found" });

  const price = Math.max(1, Math.floor(spendSats / 1000));
  const quoteId = rid();
  const expiresAt = Date.now() + 30_000;
  res.json({ ok: true, quoteId, price, expiresAt });
});

r.post("/v1/orders/buy", idempotency(), (req, res) => {
  const { quoteId, poolId, spendSats } = req.body ?? {};
  if (!quoteId || !poolId || !Number.isFinite(spendSats))
    return res.status(400).json({ ok: false, error: "bad_request" });

  const pool = db.prepare(`SELECT * FROM pools WHERE id=?`).get(poolId) as any;
  if (!pool) return res.status(404).json({ ok: false, error: "pool_not_found" });
  if (!flags().devBuyEnabled)
    return res.status(403).json({ ok: false, error: "dev_buy_disabled" });

  const tokens = Math.floor(spendSats / 1000);
  if (tokens <= 0)
    return res.status(400).json({ ok: false, error: "too_small" });

  appendLedger(poolId, "buyer:stub", pool.symbol, tokens, "BUY_FILL", null);
  refreshSupply(poolId, pool.symbol);

  const txid = `stub-${quoteId}`;

  db.prepare(
    `INSERT OR IGNORE INTO buy_tx
     (txid, pool_id, symbol, spend_sats, filled_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(txid, poolId, pool.symbol, spendSats, tokens, Date.now());

  const result = { ok: true, orderId: quoteId, txid, filledTokens: tokens };
  persistResult(req, result, "BUY", req.body);
  res.json(result);
});

// ----------------------------- WOC adapters -----------------------------
async function fetchUtxos(address: string) {
  const net = ENV.NETWORK === "mainnet" ? "main" : "test";
  const url = `https://api.whatsonchain.com/v1/bsv/${net}/address/${address}/unspent`;
  const r2 = await fetch(url);
  if (!r2.ok) throw new Error(`woc_utxos_http_${r2.status} ${await r2.text()}`);
  return r2.json() as Promise<Array<{ tx_hash: string; tx_pos: number; value: number }>>;
}

async function broadcastRawTx(raw: string) {
  const net = ENV.NETWORK === "mainnet" ? "main" : "test";
  const url = `https://api.whatsonchain.com/v1/bsv/${net}/tx/raw`;
  const r2 = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txhex: raw }),
  });
  const text = (await r2.text()).trim();
  if (!r2.ok) throw new Error(`woc_broadcast_http_${r2.status} ${text}`);
  const txid = text.replace(/^"+|"+$/g, "");
  if (!/^[0-9a-fA-F]{64}$/.test(txid))
    throw new Error(`woc_broadcast_bad_txid "${text}"`);
  return txid.toLowerCase();
}

// ----------------------------- helpers: resolve pool -----------------------------
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
    if ((r.symbol || "").toUpperCase() !== reqSymbol)
      throw new Error("pool_symbol_mismatch");
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
    const r = db.prepare(
      `SELECT id, symbol FROM pools WHERE LOWER(locking_script_hex)=?`
    ).get(lsh) as any;
    if (!r) throw new Error("pool_not_found_by_script");
    return { poolId: r.id, symbol: r.symbol.toUpperCase() };
  }
  throw new Error("pool_not_resolved");
}

// ----------------------------- UTXOs passthrough -----------------------------
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

// ----------------------------- mint: REAL broadcast -----------------------------
r.post("/v1/mint", idempotency(), async (req, res) => {
  try {
    const { wif, spendSats, poolId, symbol, poolLockingScriptHex } = req.body ?? {};
    if (!wif || !Number.isFinite(spendSats) || spendSats <= 0)
      return res.status(400).json({ ok: false, error: "bad_request" });

    const { poolId: pid, symbol: sym } = resolvePoolIdAndSymbol({
      poolId, symbol, poolLockingScriptHex: poolLockingScriptHex || ENV.POOL_LOCKING_SCRIPT_HEX,
    });

    const net = ENV.NETWORK === "mainnet" ? "mainnet" : "testnet";
    const priv = bsv.PrivateKey.fromWIF(wif);
    const fromAddr = priv.toAddress(net).toString();
    const utxos = await fetchUtxos(fromAddr);
    if (!utxos.length) throw new Error("no_funds");

    const spend = Math.trunc(spendSats);
    if (spend < DUST) throw new Error("dust_output");

    const tx = new bsv.Transaction();
    let inputTotal = 0;
    for (const u of utxos) {
      tx.from({
        txId: u.tx_hash,
        outputIndex: u.tx_pos,
        script: bsv.Script.buildPublicKeyHashOut(fromAddr),
        satoshis: u.value,
      });
      inputTotal += u.value;
    }

    const scriptHex = (poolLockingScriptHex || ENV.POOL_LOCKING_SCRIPT_HEX || "").trim();
    if (scriptHex) {
      tx.addOutput(new bsv.Transaction.Output({
        script: bsv.Script.fromHex(scriptHex),
        satoshis: spend,
      }));
    } else if (ENV.POOL_P2SH_ADDRESS) {
      tx.to(ENV.POOL_P2SH_ADDRESS, spend);
    } else {
      throw new Error("no_pool_destination");
    }

    tx.change(fromAddr);
    tx.feePerKb(FEE_PER_KB);
    tx.sign(priv);

    for (const o of tx.outputs) {
      if (o.satoshis > 0 && o.satoshis < DUST) throw new Error("dust_change");
    }

    const raw = tx.serialize(true);
    if (raw.length / 2 > inputTotal) throw new Error("overspend");

    const txid = await broadcastRawTx(raw);

    // ---- record mint ----
    db.prepare(`
      INSERT INTO mint_tx (txid, pool_id, symbol, sats, created_at, next_check_at, check_count)
      VALUES (?, ?, ?, ?, ?, 0, 0)
    `).run(txid, pid, sym, spend, Date.now());

    persistResult(req, { ok: true, txid, poolId: pid, symbol: sym }, "MINT", req.body);
    res.json({ ok: true, txid, poolId: pid, symbol: sym });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// ----------------------------- mints list (JOIN + filters + cursor) -----------------------------
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

    const rows = db.prepare(`
      SELECT
        m.txid,
        m.pool_id,
        COALESCE(NULLIF(m.symbol,''), p.symbol) AS symbol,
        m.sats,
        m.created_at,
        m.confirmed_at,
        m.last_check_at,
        m.next_check_at,
        CASE WHEN m.confirmed_at IS NULL THEN 0 ELSE 1 END AS confirmed
      FROM mint_tx m
      LEFT JOIN pools p ON p.id = m.pool_id
      ${whereSql}
      ORDER BY m.created_at DESC, m.txid DESC
      LIMIT ?
    `).all(...params, limit) as any[];

    const mints = rows.map((r: any) => ({
      txid: r.txid,
      pool_id: r.pool_id,              // keep snake for legacy clients
      poolId: r.pool_id,               // camel for new clients
      symbol: r.symbol,
      sats: r.sats,
      created_at: r.created_at,
      createdAt: r.created_at,
      confirmed_at: r.confirmed_at,
      confirmedAt: r.confirmed_at,
      lastCheckAt: r.last_check_at,
      nextCheckAt: r.next_check_at,
      confirmed: toBool(r.confirmed),
    }));

    let nextCursor: { createdAt: number; txid: string } | null = null;
    if (rows.length === limit) {
      const last = rows[rows.length - 1];
      nextCursor = { createdAt: Number(last.created_at), txid: String(last.txid) };
    }

    res.json({ ok: true, mints, nextCursor });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ----------------------------- TX status + mint confirmation -----------------------------
r.get("/v1/tx/:txid/status", async (req, res) => {
  try {
    const txid = String(req.params.txid || "").trim();
    if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
      return res.status(400).json({ ok: false, error: "invalid_txid" });
    }
    const net = ENV.NETWORK === "mainnet" ? "main" : "test";

    const [statusRes, infoRes] = await Promise.allSettled([
      fetch(`https://api.whatsonchain.com/v1/bsv/${net}/tx/${txid}/status`),
      fetch(`https://api.whatsonchain.com/v1/bsv/${net}/tx/${txid}`),
    ]);

    let confirmed = false;
    let blockHeight: number | null = null;
    let blockTime: string | null = null;

    if (statusRes.status === "fulfilled" && statusRes.value.ok) {
      const s = await statusRes.value.json().catch(() => ({} as any));
      confirmed = Boolean(s?.confirmed);
      if (confirmed) blockHeight = Number(s?.blockheight ?? s?.blockHeight ?? null) || null;
    }
    if (confirmed && infoRes.status === "fulfilled" && infoRes.value.ok) {
      const j = await infoRes.value.json().catch(() => ({} as any));
      const t = j?.blocktime ?? j?.time ?? null; // seconds epoch
      blockTime = t ? new Date(Number(t) * 1000).toISOString() : null;
    }

    if (confirmed) {
      const row = db.prepare(`SELECT confirmed_at FROM mint_tx WHERE txid=?`).get(txid) as any;
      if (row && !row.confirmed_at) {
        const when = blockTime ? Date.parse(blockTime) : Date.now();
        db.prepare(`UPDATE mint_tx SET confirmed_at=? WHERE txid=?`).run(when, txid);
      }
    }

    // also return DB-side polling hints (for the UI)
    const poll = db.prepare(`SELECT next_check_at, last_check_at FROM mint_tx WHERE txid=?`).get(txid) as any;

    res.json({
      ok: true,
      txid,
      confirmed,
      blockHeight,
      blockTime,
      nextCheckAt: poll?.next_check_at ?? null,
      lastCheckAt: poll?.last_check_at ?? null,
    });
  } catch (e: any) {
    res.status(502).json({ ok: false, error: String(e?.message || e) });
  }
});

// Alias to match old frontend expecting /v1/tx/:txid
r.get("/v1/tx/:txid", async (req, res, next) => {
  // delegate to /status handler
  (r as any).handle({ ...req, url: `/v1/tx/${req.params.txid}/status` }, res, next);
});

// ----------------------------- background verify helpers -----------------------------
function nextDelayMs(checkCount: number) {
  const seq = [0, 15, 30, 60, 120, 240, 480, 960, 1800]; // seconds
  return (seq[Math.min(checkCount, seq.length - 1)] || 1800) * 1000;
}

async function verifyTable(table: "mint_tx" | "buy_tx", net: "main" | "test") {
  const now = Date.now();
  const rows = db.prepare(
    `SELECT txid, check_count
       FROM ${table}
      WHERE confirmed_at IS NULL
        AND length(txid)=64
        AND txid GLOB '[0-9A-Fa-f]*'
        AND (next_check_at IS NULL OR next_check_at <= ?)
      LIMIT 50`
  ).all(now) as Array<{ txid: string; check_count: number }>;

  let updated = 0;
  for (const { txid, check_count } of rows) {
    try {
      const resp = await fetch(`https://api.whatsonchain.com/v1/bsv/${net}/tx/${txid}/status`);
      const ok = resp.ok ? await resp.json() : null;
      const status = ok as any;
      const zeroConf = ENV.MIN_CONFIRMATIONS === 0;

      if (status?.confirmed || zeroConf) {
        db.prepare(
          `UPDATE ${table}
             SET confirmed_at=?,
                 last_check_at=?,
                 next_check_at=NULL
           WHERE txid=?`
        ).run(Date.now(), now, txid);
        updated++;
      } else {
        const delay = nextDelayMs((check_count || 0) + 1);
        db.prepare(
          `UPDATE ${table}
             SET last_check_at=?, check_count=?, next_check_at=?
           WHERE txid=?`
        ).run(now, (check_count || 0) + 1, now + delay, txid);
      }
    } catch {
      const zeroConf = ENV.MIN_CONFIRMATIONS === 0;
      if (zeroConf) {
        db.prepare(
          `UPDATE ${table}
             SET confirmed_at=?,
                 last_check_at=?,
                 next_check_at=NULL
           WHERE txid=?`
        ).run(Date.now(), now, txid);
        updated++;
      } else {
        const delay = nextDelayMs((check_count || 0) + 1);
        db.prepare(
          `UPDATE ${table}
             SET last_check_at=?, check_count=?, next_check_at=?
           WHERE txid=?`
        ).run(now, (check_count || 0) + 1, now + delay, txid);
      }
    }
  }
  return { scanned: rows.length, updated };
}

// expose verify kicks
r.post("/v1/mints/verify", async (_req, res) => {
  const net = ENV.NETWORK === "mainnet" ? "main" : "test";
  try {
    const out = await verifyTable("mint_tx", net);
    res.json({ ok: true, network: ENV.NETWORK, zeroConf: ENV.MIN_CONFIRMATIONS === 0, ...out });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e), network: ENV.NETWORK, zeroConf: ENV.MIN_CONFIRMATIONS === 0 });
  }
});

// ----------------------------- REAL BUY -----------------------------
r.post("/v1/buy", idempotency(), async (req, res) => {
  try {
    const { wif, spendSats, poolId, symbol, poolLockingScriptHex } = req.body ?? {};
    if (!wif || !Number.isFinite(spendSats) || spendSats <= 0)
      return res.status(400).json({ ok: false, error: "bad_request" });

    const { poolId: pid, symbol: sym } = resolvePoolIdAndSymbol({
      poolId, symbol, poolLockingScriptHex: poolLockingScriptHex || ENV.POOL_LOCKING_SCRIPT_HEX,
    });

    const net = ENV.NETWORK === "mainnet" ? "mainnet" : "testnet";
    const priv = bsv.PrivateKey.fromWIF(wif);
    const fromAddr = priv.toAddress(net).toString();

    const utxos = await fetchUtxos(fromAddr);
    if (!utxos.length) throw new Error("no_funds");

    const spend = Math.trunc(spendSats);
    if (spend < DUST) throw new Error("dust_output");

    const tx = new bsv.Transaction();
    for (const u of utxos) {
      tx.from({
        txId: u.tx_hash,
        outputIndex: u.tx_pos,
        script: bsv.Script.buildPublicKeyHashOut(fromAddr),
        satoshis: u.value,
      });
    }

    const scriptHex = (poolLockingScriptHex || ENV.POOL_LOCKING_SCRIPT_HEX || "").trim();
    if (scriptHex) {
      tx.addOutput(new bsv.Transaction.Output({
        script: bsv.Script.fromHex(scriptHex),
        satoshis: spend,
      }));
    } else if (ENV.POOL_P2SH_ADDRESS) {
      tx.to(ENV.POOL_P2SH_ADDRESS, spend);
    } else {
      throw new Error("no_pool_destination");
    }

    tx.change(fromAddr);
    tx.feePerKb(FEE_PER_KB);
    tx.sign(priv);

    for (const o of tx.outputs) {
      if (o.satoshis > 0 && o.satoshis < DUST) throw new Error("dust_change");
    }

    const raw = tx.serialize(true);
    const txid = await broadcastRawTx(raw);

    const filledTokens = Math.floor(spend / 1000);

    db.prepare(
      `INSERT OR IGNORE INTO buy_tx
       (txid, pool_id, symbol, spend_sats, filled_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(txid, pid, sym, spend, filledTokens, Date.now());

    appendLedger(pid, "buyer:real", sym, filledTokens, "BUY_FILL", txid);
    refreshSupply(pid, sym);

    persistResult(req, { ok: true, txid, poolId: pid, symbol: sym, filledTokens }, "BUY_REAL", req.body);
    res.json({ ok: true, txid, poolId: pid, symbol: sym, filledTokens });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// ----------------------------- buys list + verify -----------------------------
r.get("/v1/buys", (req, res) => {
  const limit = clamp(Number(req.query.limit ?? 50), 1, 200);
  const poolId = typeof req.query.poolId === "string" ? req.query.poolId.trim() : "";
  try {
    const rows = poolId
      ? db.prepare(
          `SELECT txid, pool_id, symbol, spend_sats, filled_tokens, created_at, confirmed_at
             FROM buy_tx
            WHERE pool_id=?
            ORDER BY created_at DESC
            LIMIT ?`
        ).all(poolId, limit)
      : db.prepare(
          `SELECT txid, pool_id, symbol, spend_sats, filled_tokens, created_at, confirmed_at
             FROM buy_tx
            ORDER BY created_at DESC
            LIMIT ?`
        ).all(limit);
    res.json({ ok: true, buys: rows });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

r.post("/v1/buys/verify", async (_req, res) => {
  const net = ENV.NETWORK === "mainnet" ? "main" : "test";
  try {
    const out = await verifyTable("buy_tx", net);
    res.json({ ok: true, network: ENV.NETWORK, zeroConf: ENV.MIN_CONFIRMATIONS === 0, ...out });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e), network: ENV.NETWORK, zeroConf: ENV.MIN_CONFIRMATIONS === 0 });
  }
});

// ----------------------------- withdrawal gating -----------------------------
r.get("/v1/withdrawals/can/:poolId", (req, res) => {
  const poolId = String(req.params.poolId || "").trim();
  if (!poolId) return res.status(400).json({ ok: false, error: "bad_pool" });

  try {
    const pendingMints = db.prepare(
      `SELECT COUNT(1) AS c
         FROM mint_tx
        WHERE pool_id = ?
          AND confirmed_at IS NULL
          AND length(txid) = 64
          AND txid GLOB '[0-9A-Fa-f]*'`
    ).get(poolId) as any;

    const pendingBuys = db.prepare(
      `SELECT COUNT(1) AS c
         FROM buy_tx
        WHERE pool_id = ?
          AND confirmed_at IS NULL
          AND length(txid) = 64
          AND txid GLOB '[0-9A-Fa-f]*'`
    ).get(poolId) as any;

    const m = (pendingMints?.c | 0);
    const b = (pendingBuys?.c | 0);
    const can = m === 0 && b === 0;

    res.json({ ok: true, can, reason: can ? null : `unconfirmed real txs: mints=${m} buys=${b}` });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ----------------------------- debug -----------------------------
r.get("/debug/dbinfo", (_req, res) => {
  try {
    const info = dbInfo();
    res.json({ ok: true, ...info });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

r.get("/debug/ping", (_req, res) =>
  res.type("text/plain").send("aftermeta-backend :: pong")
);

export default r;

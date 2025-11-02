// backend/src/api/routes.v1.ts
import { Router } from "express";
import { db } from "../lib/db";
import { flags } from "../lib/flags";
import { ENV } from "../lib/env";
import { appendLedger, refreshSupply } from "../lib/ledger";
import { idempotency, persistResult } from "./idempotency";
import { rid } from "../lib/ids";
import { bsv } from "scrypt-ts";
import { randomUUID } from "crypto";

const r = Router();

// ----------------------------- constants/util -----------------------------
const clamp = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;

const DUST = 546;
const FEE_PER_KB = ENV.FEE_PER_KB || 150;

const BASE58_RX = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;
const NET_WOC = ENV.NETWORK === "mainnet" ? "main" : "test";     // WOC URL segment
const NET_BSV = ENV.NETWORK === "mainnet" ? "mainnet" : "testnet"; // scrypt-ts network

const nowMs = () => Date.now();
const isTxid = (s: string) => typeof s === "string" && /^[0-9a-fA-F]{64}$/.test(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const WRAPPED_BODY_KEYS = ["body", "data", "payload"];

function normalizeBody(input: unknown): Record<string, unknown> {
  if (!input) return {};

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      return normalizeBody(parsed);
    } catch {
      return {};
    }
  }

  if (typeof Buffer !== "undefined" && Buffer.isBuffer(input)) {
    return normalizeBody(input.toString("utf8"));
  }

  if (typeof ArrayBuffer !== "undefined") {
    if (input instanceof ArrayBuffer) {
      return normalizeBody(Buffer.from(input).toString("utf8"));
    }
    if (ArrayBuffer.isView && ArrayBuffer.isView(input as any)) {
      const view = input as any;
      const buf = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
      return normalizeBody(buf.toString("utf8"));
    }
  }

  if (input instanceof URLSearchParams) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of input.entries()) {
      out[key] = value;
    }
    return out;
  }

  if (typeof input === "object") {
    if (Array.isArray(input)) {
      return input.reduce<Record<string, unknown>>((acc, item) => {
        const normalized = normalizeBody(item);
        for (const [k, v] of Object.entries(normalized)) {
          if (!(k in acc) || acc[k] === undefined || acc[k] === null || acc[k] === "") {
            acc[k] = v;
          }
        }
        return acc;
      }, {});
    }

    const obj = input as Record<string, unknown>;
    const out: Record<string, unknown> = { ...obj };

    for (const key of WRAPPED_BODY_KEYS) {
      const nested = obj[key];
      if (!nested) continue;

      const normalized = normalizeBody(nested);
      if (!Object.keys(normalized).length) continue;

      for (const [nk, nv] of Object.entries(normalized)) {
        if (!(nk in out) || out[nk] === undefined || out[nk] === null || out[nk] === "") {
          out[nk] = nv;
        }
      }
    }

    return out;
  }

  return {};
}

function getField(body: Record<string, unknown>, key: string): unknown {
  if (key in body) return body[key];
  const found = Object.keys(body).find((k) => k.toLowerCase() === key.toLowerCase());
  if (found) return body[found];
  return undefined;
}

function coerceStringValue(raw: unknown): string | null {
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return String(raw);
  }
  if (typeof raw === "bigint") return String(raw);
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(raw)) return raw.toString("utf8").trim();
  if (raw instanceof Uint8Array) return Buffer.from(raw).toString("utf8").trim();
  if (typeof ArrayBuffer !== "undefined" && raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString("utf8").trim();
  }
  if (raw && typeof raw === "object") {
    const valueProp = (raw as { value?: unknown }).value;
    if (valueProp !== undefined && valueProp !== raw) {
      const coerced = coerceStringValue(valueProp);
      if (coerced !== null) return coerced;
    }
  }
  return null;
}

// ----------------------------- health/admin -----------------------------
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

// ----------------------------- DEBUG: DB summary -----------------------------
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

// ----------------------------- pools -----------------------------
r.post("/v1/pools", idempotency(), (req, res) => {
  const p = req.body ?? {};
  const hasAddr = typeof p?.poolAddress === "string" && p.poolAddress.trim().length > 0;
  const hasScript = typeof p?.lockingScriptHex === "string" && p.lockingScriptHex.trim().length > 0;
  if (!p?.symbol || !p?.creator || (!hasAddr && !hasScript)) {
    return res.status(400).json({ ok: false, error: "missing_fields" });
  }

  const id = p.id || rid();
  const createdAt = nowMs();
  const symbol = String(p.symbol || "").trim().toUpperCase();
  const creator = String(p.creator || "").trim();
  const poolAddress = hasAddr ? String(p.poolAddress).trim() : "";
  const lockingScriptHex = hasScript ? String(p.lockingScriptHex).trim() : "";

  db.prepare(
    `INSERT OR REPLACE INTO pools
     (id, symbol, creator, pool_address, locking_script_hex, max_supply, decimals, creator_reserve, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    symbol,
    creator,
    poolAddress,
    lockingScriptHex,
    Number(p.maxSupply ?? 0),
    Number(p.decimals ?? 0),
    Number(p.creatorReserve ?? 0),
    createdAt
  );

  db.prepare(`INSERT OR IGNORE INTO pool_supply(pool_id, minted_supply) VALUES(?, 0)`).run(id);

  const out = {
    ok: true,
    pool: {
      id,
      symbol,
      creator,
      poolAddress,
      lockingScriptHex,
      maxSupply: Number(p.maxSupply ?? 0),
      decimals: Number(p.decimals ?? 0),
      creatorReserve: Number(p.creatorReserve ?? 0),
      createdAt,
    },
    supply: { mintedSupply: 0 },
  };
  persistResult(req, out, "CREATE_POOL", p);
  res.json(out);
});

r.get("/v1/pools/:id", (req, res) => {
  const p = db.prepare(`SELECT * FROM pools WHERE id=?`).get(req.params.id) as any;
  if (!p) return res.status(404).json({ ok: false, error: "pool_not_found" });

  const mintedRow = db
    .prepare(`SELECT minted_supply AS minted FROM pool_supply WHERE pool_id=?`)
    .get(p.id) as any;
  const minted = Number(mintedRow?.minted || 0);
  const left = Math.max(0, (p.max_supply || 0) - minted);
  const percentMinted = p.max_supply ? (minted / p.max_supply) * 100 : 0;

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
    supply: { mintedSupply: minted, left, percentMinted },
  });
});

r.get("/v1/pools", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, symbol, creator, pool_address, locking_script_hex,
              max_supply, decimals, creator_reserve, created_at
         FROM pools
     ORDER BY created_at DESC`
    )
    .all() as any[];

  const supplyStmt = db.prepare(
    `SELECT minted_supply AS minted FROM pool_supply WHERE pool_id=?`
  );
  res.json({
    ok: true,
    pools: rows.map((p) => {
      const s = supplyStmt.get(p.id) as any;
      return {
        id: p.id,
        symbol: p.symbol,
        creator: p.creator,
        poolAddress: p.pool_address,
        lockingScriptHex: p.locking_script_hex,
        maxSupply: p.max_supply,
        decimals: p.decimals,
        creatorReserve: p.creator_reserve,
        createdAt: p.created_at,
        supply: { mintedSupply: Number(s?.minted || 0) },
      };
    }),
  });
});

// ----------------------------- WhatsOnChain helpers -----------------------------
async function fetchUtxos(address: string) {
  const url = `https://api.whatsonchain.com/v1/bsv/${NET_WOC}/address/${address}/unspent`;
  const r2 = await fetch(url);
  if (!r2.ok) throw new Error(`woc_utxos_http_${r2.status} ${await r2.text()}`);
  return r2.json() as Promise<Array<{ tx_hash: string; tx_pos: number; value: number }>>;
}

async function broadcastRawTx(raw: string) {
  const url = `https://api.whatsonchain.com/v1/bsv/${NET_WOC}/tx/raw`;
  const r2 = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txhex: raw }),
  });
  const text = (await r2.text()).trim();
  if (!r2.ok) throw new Error(`woc_broadcast_http_${r2.status} ${text}`);
  const txid = text.replace(/^"+|"+$/g, "");
  if (!isTxid(txid)) throw new Error(`woc_broadcast_bad_txid "${text}"`);
  return txid.toLowerCase();
}

async function wocVisibleOnce(txid: string): Promise<"yes" | "no" | "err"> {
  try {
    const r = await fetch(`https://api.whatsonchain.com/v1/bsv/${NET_WOC}/tx/hash/${txid}`);
    if (r.status === 200) return "yes";
    if (r.status === 404) return "no";
    return "err";
  } catch {
    return "err";
  }
}

async function waitVisibleNonFatal(
  txid: string,
  { totalWaitMs = 15000, firstDelayMs = 500, maxAttempts = 6 } = {}
): Promise<{ visible: boolean; attempts: number }> {
  const start = Date.now();
  let delay = firstDelayMs;
  let attempts = 0;
  while (Date.now() - start < totalWaitMs && attempts < maxAttempts) {
    await sleep(delay);
    attempts++;
    const v = await wocVisibleOnce(txid);
    if (v === "yes") return { visible: true, attempts };
    delay = Math.min(delay * 2, 4000);
  }
  return { visible: false, attempts };
}

// ----------------------------- helpers: resolve pool -----------------------------
function resolvePoolIdAndSymbol(opts: {
  poolId?: string;
  symbol?: string;
  poolLockingScriptHex?: string;
}) {
  const reqPoolId = (opts.poolId || "").trim();
  const reqSymbol = (opts.symbol || "").trim().toUpperCase();

  if (reqPoolId) {
    const r = db.prepare(`SELECT id, symbol FROM pools WHERE id=?`).get(reqPoolId) as any;
    if (!r) throw new Error("pool_not_found");
    return { poolId: r.id, symbol: String(r.symbol || "").toUpperCase() };
  }
  if (reqSymbol) {
    const r = db
      .prepare(`SELECT id, symbol FROM pools WHERE UPPER(symbol)=?`)
      .get(reqSymbol) as any;
    if (!r) throw new Error("pool_not_found_by_symbol");
    return { poolId: r.id, symbol: String(r.symbol || "").toUpperCase() };
  }
  const lsh = (opts.poolLockingScriptHex || ENV.POOL_LOCKING_SCRIPT_HEX || "")
    .trim()
    .toLowerCase();
  if (lsh) {
    const r = db
      .prepare(`SELECT id, symbol FROM pools WHERE LOWER(locking_script_hex)=?`)
      .get(lsh) as any;
    if (!r) throw new Error("pool_not_found_by_script");
    return { poolId: r.id, symbol: String(r.symbol || "").toUpperCase() };
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

function coerceSpendSats(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed.length) return null;
    const normalized = trimmed.replace(/[,_\s]/g, "");
    if (!/^[-+]?((\d+\.?\d*)|(\d*\.\d+))(e[-+]?\d+)?$/i.test(normalized)) {
      const fallback = Number(normalized);
      return Number.isFinite(fallback) ? fallback : null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// ----------------------------- MINT (REAL + hardened WOC) -----------------------------
r.post("/v1/mint", idempotency(), async (req, res) => {
  console.log("req.body =", req.body);

  try {
    const {
      wif,
      spendSats,
      poolId,
      symbol,
      poolLockingScriptHex,
    } = (req.body ?? {}) as Record<string, unknown>;

    const body = normalizeBody(req.body);
    const normalizedWif =
      coerceStringValue(wif) || coerceStringValue(getField(body, "wif")) || "";
    const trimmedWif = normalizedWif.trim();
    if (!trimmedWif) {
      return res.status(400).json({ ok: false, error: "missing_wif" });
    }

    const spendValueRaw = coerceSpendSats(
      spendSats !== undefined ? spendSats : getField(body, "spendSats")
    );
    const spendValue =
      typeof spendValueRaw === "number" && Number.isFinite(spendValueRaw) ? spendValueRaw : null;
    const poolIdString =
      coerceStringValue(poolId) || coerceStringValue(getField(body, "poolId"));
    const symbolString =
      coerceStringValue(symbol) || coerceStringValue(getField(body, "symbol"));
    const poolLockingScriptHexString =
      coerceStringValue(poolLockingScriptHex) ||
      coerceStringValue(getField(body, "poolLockingScriptHex"));
    const poolId = poolIdString && poolIdString.trim().length ? poolIdString.trim() : undefined;
    const symbol = symbolString && symbolString.trim().length ? symbolString.trim() : undefined;
    const poolLockingScriptHex =
      poolLockingScriptHexString && poolLockingScriptHexString.trim().length
        ? poolLockingScriptHexString.trim()
        : undefined;

    if (spendValue === null || spendValue <= 0) {
      return res.status(400).json({ ok: false, error: "invalid_spend" });
    }

    // Resolve pool (by id/symbol/script). Hard stop if not found.
    const { poolId: pid, symbol: sym } = resolvePoolIdAndSymbol({
      poolId,
      symbol,
      poolLockingScriptHex,
    });
    const poolRow = db.prepare(
      `SELECT id, locking_script_hex AS lsh, pool_address AS paddr FROM pools WHERE id=?`
    ).get(pid) as any;
    if (!poolRow) return res.status(404).json({ ok: false, error: "pool_fk_missing" });

    const symUpper = (sym || "").toUpperCase();

    // Wallet + UTXOs
    const priv = bsv.PrivateKey.fromWIF(trimmedWif);
    const fromAddr = priv.toAddress(NET_BSV).toString();
    const utxos = await fetchUtxos(fromAddr);
    if (!utxos.length) throw new Error("no_funds");

    const spend = Math.trunc(spendValue);
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

    // Prefer pool's script, else its address, else ENV fallback
    const lshFromReq = String(poolLockingScriptHex || "").trim();
    const lsh =
      lshFromReq ||
      String(poolRow.lsh || "").trim() ||
      String(ENV.POOL_LOCKING_SCRIPT_HEX || "").trim();
    const paddr =
      String(poolRow.paddr || "").trim() ||
      String(ENV.POOL_P2SH_ADDRESS || "").trim();

    if (!lsh && !paddr) {
      return res.status(400).json({ ok: false, error: "no_pool_destination" });
    }

    if (lsh) {
      tx.addOutput(
        new bsv.Transaction.Output({
          script: bsv.Script.fromHex(lsh),
          satoshis: spend,
        })
      );
    } else {
      tx.to(paddr, spend);
    }

    tx.change(fromAddr);
    tx.feePerKb(FEE_PER_KB);
    tx.sign(priv);

    for (const o of tx.outputs) {
      if (o.satoshis > 0 && o.satoshis < DUST) throw new Error("dust_change");
    }

    const raw = tx.serialize(true);
    if (raw.length / 2 > inputTotal) throw new Error("overspend");

    // Broadcast
    const txid = await broadcastRawTx(raw);

    // Non-fatal visibility wait (fix your 404 tantrum)
    const { visible, attempts } = await waitVisibleNonFatal(txid);

    // Persist (idempotent on txid)
    const tokens = Math.max(0, Math.floor(spend / 1000)); // pricing stub
    const has = db.prepare(`SELECT id FROM mints WHERE txid=?`).get(txid) as any;
    if (has) {
      const outDup = { ok: true, txid, poolId: pid, symbol: symUpper, id: has.id, tokens, visible, attempts };
      persistResult(req, outDup, "MINT_REAL_DUP", req.body);
      return res.json(outDup);
    }

    const id = randomUUID();
    try {
      db.prepare(
        `INSERT INTO mints (id, pool_id, symbol, account, spend_sats, tokens, txid, confirmed)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
      ).run(id, pid, symUpper, fromAddr, spend, tokens, txid);
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes("FOREIGN KEY")) {
        return res.status(400).json({ ok: false, error: "pool_fk_missing" });
      }
      if (msg.includes("UNIQUE") && msg.includes("mints") && msg.includes("txid")) {
        const row = db.prepare(`SELECT id FROM mints WHERE txid=?`).get(txid) as any;
        const outDup2 = { ok: true, txid, poolId: pid, symbol: symUpper, id: row?.id || id, tokens, visible, attempts };
        persistResult(req, outDup2, "MINT_REAL_DUP2", req.body);
        return res.json(outDup2);
      }
      throw err;
    }

    appendLedger(pid, fromAddr, symUpper, tokens, "MINT_FILL", txid);
    refreshSupply(pid, symUpper);

    const out = { ok: true, txid, poolId: pid, symbol: symUpper, id, tokens, visible, attempts };
    persistResult(req, out, "MINT_REAL", req.body);
    res.json(out);
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// ----------------------------- mints list -----------------------------
r.get("/v1/mints", (req, res) => {
  try {
    const limit = clamp(Number(req.query.limit ?? 50), 1, 500);
    const qPoolId = typeof req.query.poolId === "string" ? req.query.poolId.trim() : "";
    const qSymbol =
      typeof req.query.symbol === "string" ? req.query.symbol.trim().toUpperCase() : "";

    const where: string[] = [];
    const params: any[] = [];
    if (qPoolId) {
      where.push("m.pool_id = ?");
      params.push(qPoolId);
    }
    if (qSymbol) {
      where.push("m.symbol = ? COLLATE NOCASE");
      params.push(qSymbol);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = db
      .prepare(
        `SELECT
            m.id,
            m.pool_id  AS poolId,
            m.symbol   AS symbol,
            m.account  AS account,
            m.spend_sats AS spendSats,
            m.tokens   AS tokens,
            m.txid     AS txid,
            CASE WHEN m.confirmed = 1 THEN 1 ELSE 0 END AS confirmed,
            m.created_at AS createdAt
         FROM mints m
         ${whereSql}
         ORDER BY m.created_at DESC
         LIMIT ?`
      )
      .all(...params, limit) as any[];

    res.json({ ok: true, mints: rows, nextCursor: null });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ----------------------------- TX status + verify -----------------------------
r.get("/v1/tx/:txid/status", async (req, res) => {
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

r.post("/v1/mints/verify", async (_req, res) => {
  try {
    const candidates = db
      .prepare(
        `SELECT txid FROM mints
          WHERE confirmed=0 AND length(txid)=64 AND txid GLOB '[0-9A-Fa-f]*'
          ORDER BY created_at DESC
          LIMIT 50`
      )
      .all() as Array<{ txid: string }>;

    let flipped = 0;
    for (const { txid } of candidates) {
      try {
        const r2 = await fetch(`https://api.whatsonchain.com/v1/bsv/${NET_WOC}/tx/${txid}/status`);
        if (r2.ok) {
          const s = await r2.json().catch(() => ({} as any));
          if (s?.confirmed) {
            db.prepare(`UPDATE mints SET confirmed=1 WHERE txid=?`).run(txid);
            flipped++;
          }
        }
      } catch {
        // ignore network errors
      }
    }

    res.json({ ok: true, network: ENV.NETWORK, flipped });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ----------------------------- withdrawals gating -----------------------------
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

// ----------------------------- debug -----------------------------
r.get("/debug/ping", (_req, res) => res.type("text/plain").send("aftermeta-backend :: pong"));

export default r;

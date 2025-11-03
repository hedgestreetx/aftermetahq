import { Router } from "express";
import { createHash, randomUUID } from "crypto";
import { bsv } from "scrypt-ts";

import { db } from "../../lib/db";
import { ENV } from "../../lib/env";
import { appendLedger, refreshSupply } from "../../lib/ledger";
import { idempotency, persistResult } from "../idempotency";

const r = Router();

const clamp = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;

const DUST = 546;
const FEE_PER_KB = ENV.FEE_PER_KB || 150;

const BASE58_RX = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;
const NET_WOC = ENV.NETWORK === "mainnet" ? "main" : "test"; // WOC URL segment

const nowMs = () => Date.now();
const isTxid = (s: string) => typeof s === "string" && /^[0-9a-fA-F]{64}$/.test(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type QuoteSnapshot = {
  poolId: string;
  spendSats: number;
  price: number;
  expiresAt: number;
};

const QUOTE_TTL_MS = 30_000;
const quoteBook = new Map<string, QuoteSnapshot>();

function pruneQuotes(now = nowMs()) {
  for (const [id, quote] of quoteBook.entries()) {
    if (quote.expiresAt <= now) {
      quoteBook.delete(id);
    }
  }
}

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

const buyQuoteHandler = (req: any, res: any) => {
  try {
    const body = normalizeBody(req.body);
    const poolId = String(getField(body, "poolId") || "").trim();
    const spendSats = Number(getField(body, "spendSats"));
    const maxSlippageBps = Number(getField(body, "maxSlippageBps") ?? 0);

    if (!poolId) return res.status(400).json({ ok: false, error: "missing_pool" });
    if (!Number.isFinite(spendSats) || spendSats <= 0)
      return res.status(400).json({ ok: false, error: "invalid_spend" });

    const spend = Math.round(spendSats);
    const slip = clamp(Number.isFinite(maxSlippageBps) ? maxSlippageBps : 0, 0, 10_000);

    pruneQuotes();

    const basePrice = Math.max(1, Math.round(spend / 100 + 1));
    const price = Number((basePrice * (1 + slip / 100_000)).toFixed(2));
    const expiresAt = nowMs() + QUOTE_TTL_MS;
    const quoteId = randomUUID();

    quoteBook.set(quoteId, { poolId, spendSats: spend, price, expiresAt });

    res.json({ ok: true, quote: { quoteId, price, expiresAt } });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
};

const buyOrderIdempotency = idempotency();
const buyOrderHandler = (req: any, res: any) => {
  try {
    const body = normalizeBody(req.body);
    const quoteId = String(getField(body, "quoteId") || "").trim();
    const poolId = String(getField(body, "poolId") || "").trim();
    const spendSats = Number(getField(body, "spendSats"));

    if (!quoteId) return res.status(400).json({ ok: false, error: "missing_quote" });
    if (!poolId) return res.status(400).json({ ok: false, error: "missing_pool" });
    if (!Number.isFinite(spendSats) || spendSats <= 0)
      return res.status(400).json({ ok: false, error: "invalid_spend" });

    pruneQuotes();

    const quote = quoteBook.get(quoteId);
    if (!quote) return res.status(404).json({ ok: false, error: "quote_not_found" });

    if (quote.expiresAt <= nowMs()) {
      quoteBook.delete(quoteId);
      return res.status(410).json({ ok: false, error: "quote_expired" });
    }

    if (quote.poolId !== poolId)
      return res.status(400).json({ ok: false, error: "pool_mismatch" });

    if (Math.abs(quote.spendSats - spendSats) > Math.max(1, Math.round(quote.spendSats * 0.05)))
      return res.status(400).json({ ok: false, error: "spend_mismatch" });

    const fillRatio = Math.max(0.5, Math.min(1.1, spendSats / quote.spendSats));
    const filledTokens = Math.max(1, Math.round((spendSats / Math.max(1, quote.price)) * fillRatio));
    const txid = createHash("sha256")
      .update(`${quoteId}:${poolId}:${nowMs()}:${Math.random()}`)
      .digest("hex");

    quoteBook.delete(quoteId);

    res.json({ ok: true, order: { txid, filledTokens } });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
};

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

class MintError extends Error {
  status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.status = status;
  }
}

function estimateFeeSats(inputs: number, outputs: number) {
  const bytes = 10 + 148 * inputs + 34 * outputs;
  return Math.ceil(bytes / 1000) * FEE_PER_KB;
}

type MintUtxo = { tx_hash: string; tx_pos: number; value: number };

function selectInputsGreedy(utxos: MintUtxo[], spend: number) {
  const normalized = utxos
    .map((u) => ({ ...u, value: Number(u.value) || 0 }))
    .filter((u) => u.value > 0);
  const sorted = normalized.sort((a, b) => b.value - a.value);
  const selected: MintUtxo[] = [];
  let total = 0;

  for (const utxo of sorted) {
    selected.push(utxo);
    total += utxo.value;

    const needed = spend + estimateFeeSats(selected.length, 2) + DUST;
    if (total >= needed) {
      break;
    }
  }

  return { selected, total };
}

type PoolRow = {
  id: string;
  symbol: string;
  locking_script_hex?: string | null;
  pool_address?: string | null;
};

function resolvePoolRow(opts: { poolId?: string; symbol?: string }): PoolRow {
  const reqPoolId = String(opts.poolId || "").trim();
  const reqSymbol = String(opts.symbol || "").trim().toUpperCase();

  let row: PoolRow | undefined;
  if (reqPoolId) {
    row = db
      .prepare(`SELECT id, symbol, locking_script_hex, pool_address FROM pools WHERE id=?`)
      .get(reqPoolId) as any;
  } else if (reqSymbol) {
    row = db
      .prepare(`SELECT id, symbol, locking_script_hex, pool_address FROM pools WHERE UPPER(symbol)=?`)
      .get(reqSymbol) as any;
  }

  if (!row) {
    throw new MintError("pool_fk_missing");
  }

  return {
    id: row.id,
    symbol: String(row.symbol || "").toUpperCase(),
    locking_script_hex: row.locking_script_hex,
    pool_address: row.pool_address,
  };
}

function parseMintPrivateKey(wif: string) {
  const trimmed = String(wif || "").trim();
  if (!trimmed) {
    throw new MintError("missing_wif");
  }
  if (!BASE58_RX.test(trimmed) || trimmed.length < 50 || trimmed.length > 60) {
    throw new MintError("invalid_wif_format");
  }

  let priv: bsv.PrivateKey;
  try {
    priv = bsv.PrivateKey.fromWIF(trimmed);
  } catch {
    throw new MintError("invalid_wif_format");
  }

  const networkName = String((priv.network as any)?.name || "").toLowerCase();
  const envNetwork = String(ENV.NETWORK || "testnet").toLowerCase();
  const expect = envNetwork === "mainnet" || envNetwork === "livenet" ? "livenet" : "testnet";

  if (expect === "livenet") {
    if (networkName !== "livenet" && networkName !== "mainnet") {
      throw new MintError("network_mismatch");
    }
  } else if (networkName !== "testnet") {
    throw new MintError("network_mismatch");
  }

  return priv;
}

function buildMintTransaction(params: {
  priv: bsv.PrivateKey;
  fromAddress: string;
  spend: number;
  selectedInputs: MintUtxo[];
  totalInput: number;
  destScriptHex?: string;
  destAddress?: string;
}) {
  const { priv, fromAddress, spend, selectedInputs, totalInput } = params;
  const destScriptHex = String(params.destScriptHex || "").trim();
  const destAddress = String(params.destAddress || "").trim();
  const inputsCount = selectedInputs.length;

  if (!inputsCount) {
    throw new MintError("insufficient_funds");
  }

  const hasScript = destScriptHex.length > 0;
  if (!hasScript && !destAddress) {
    throw new MintError("no_pool_destination");
  }

  let poolScript: bsv.Script | null = null;
  if (hasScript) {
    try {
      poolScript = bsv.Script.fromHex(destScriptHex);
    } catch {
      throw new MintError("no_pool_destination");
    }
  }

  const minFeeNoChange = estimateFeeSats(inputsCount, 1);
  if (totalInput < spend + minFeeNoChange) {
    throw new MintError("insufficient_funds");
  }

  const minFeeWithChange = estimateFeeSats(inputsCount, 2);
  let includeChange = totalInput - spend - minFeeWithChange >= DUST;
  let desiredChange = includeChange ? totalInput - spend - minFeeWithChange : 0;

  if (includeChange && desiredChange < DUST) {
    includeChange = false;
    desiredChange = 0;
  }

  const changeScript = bsv.Script.buildPublicKeyHashOut(fromAddress);

  const attempt = (wantChange: boolean, changeValue: number) => {
    const tx = new bsv.Transaction();
    for (const utxo of selectedInputs) {
      tx.from({
        txId: utxo.tx_hash,
        outputIndex: utxo.tx_pos,
        script: changeScript,
        satoshis: utxo.value,
      });
    }

    if (poolScript) {
      tx.addOutput(
        new bsv.Transaction.Output({
          script: poolScript,
          satoshis: spend,
        })
      );
    } else {
      tx.to(destAddress, spend);
    }

    if (wantChange && changeValue >= DUST) {
      tx.addOutput(
        new bsv.Transaction.Output({
          script: changeScript,
          satoshis: changeValue,
        })
      );
    }

    tx.sign(priv);

    const raw = tx.serialize(true);
    const bytes = raw.length / 2;
    const fee = Math.ceil(bytes / 1000) * FEE_PER_KB;
    const finalChange = totalInput - spend - fee;
    return { tx, raw, fee, finalChange, wantChange: wantChange && changeValue >= DUST };
  };

  let result = attempt(includeChange, Math.max(0, Math.trunc(desiredChange)));
  if (result.finalChange < 0) {
    throw new MintError("overspend");
  }

  if (result.wantChange) {
    if (result.finalChange < DUST) {
      if (totalInput < spend + minFeeNoChange) {
        throw new MintError("insufficient_funds_no_change");
      }
      result = attempt(false, 0);
      if (result.finalChange < 0) {
        throw new MintError("overspend");
      }
    } else if (result.finalChange !== Math.trunc(desiredChange)) {
      result = attempt(true, result.finalChange);
      if (result.finalChange < DUST) {
        if (totalInput < spend + minFeeNoChange) {
          throw new MintError("insufficient_funds_no_change");
        }
        result = attempt(false, 0);
        if (result.finalChange < 0) {
          throw new MintError("overspend");
        }
      }
    }
  }

  for (const out of result.tx.outputs) {
    if (out.satoshis > 0 && out.satoshis < DUST) {
      throw new MintError("dust_change");
    }
  }

  return result;
}

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

const mintIdempotency = idempotency();
const mintHandler = async (req: any, res: any) => {
  const body = normalizeBody(req.body);
  const wifRaw = getField(body, "wif");
  const spendValueRaw = coerceSpendSats(getField(body, "spendSats"));
  const poolIdRaw = getField(body, "poolId");
  const symbolRaw = getField(body, "symbol");
  const poolLockingScriptHexRaw = getField(body, "poolLockingScriptHex");

  const poolId = typeof poolIdRaw === "string" ? poolIdRaw.trim() : undefined;
  const symbol = typeof symbolRaw === "string" ? symbolRaw.trim() : undefined;
  const poolLockingScriptHex =
    typeof poolLockingScriptHexRaw === "string" ? poolLockingScriptHexRaw.trim() : "";
  const spendValue =
    typeof spendValueRaw === "number" && Number.isFinite(spendValueRaw) ? spendValueRaw : null;

  let selectedInputs: MintUtxo[] = [];
  let destScriptForLog = "";
  let destAddressForLog = "";
  let fromAddr = "";
  let poolIdForLog = "";
  let symbolForLog = "";

  try {
    const priv = parseMintPrivateKey(typeof wifRaw === "string" ? wifRaw : String(wifRaw ?? ""));
    const fromAddress = priv.toAddress(priv.network).toString();
    fromAddr = fromAddress;

    if (spendValue === null || spendValue <= 0) {
      throw new MintError("invalid_spend");
    }

    const spend = Math.trunc(spendValue);
    if (spend < DUST) {
      throw new MintError("dust_output");
    }

    const poolRow = resolvePoolRow({ poolId, symbol });
    poolIdForLog = poolRow.id;
    symbolForLog = poolRow.symbol;

    const destScript = poolLockingScriptHex || String(poolRow.locking_script_hex || "").trim();
    const poolAddress = String(poolRow.pool_address || "").trim();
    const envPoolAddress = String(ENV.POOL_P2SH_ADDRESS || "").trim();

    const destinationScript = destScript;
    const destinationAddress = destinationScript ? "" : poolAddress || envPoolAddress;

    destScriptForLog = destinationScript;
    destAddressForLog = destinationAddress;

    if (!destinationScript && !destinationAddress) {
      throw new MintError("no_pool_destination");
    }

    const utxos = await fetchUtxos(fromAddress);
    if (!utxos.length) {
      throw new MintError("no_funds");
    }

    const selection = selectInputsGreedy(utxos, spend);
    selectedInputs = selection.selected;
    const totalInput = selection.total;

    if (!selectedInputs.length) {
      throw new MintError("insufficient_funds");
    }

    if (totalInput < spend + estimateFeeSats(selectedInputs.length, 1)) {
      throw new MintError("insufficient_funds");
    }

    const txResult = buildMintTransaction({
      priv,
      fromAddress,
      spend,
      selectedInputs,
      totalInput,
      destScriptHex: destinationScript,
      destAddress: destinationAddress,
    });

    const txid = await broadcastRawTx(txResult.raw);
    const { visible, attempts } = await waitVisibleNonFatal(txid);

    const guard = db.prepare(`SELECT 1 FROM pools WHERE id=?`).get(poolRow.id) as any;
    if (!guard) {
      throw new MintError("pool_fk_missing");
    }

    const tokens = Math.max(0, Math.floor(spend / 1000));
    const existing = db.prepare(`SELECT id FROM mints WHERE txid=?`).get(txid) as any;
    const base = {
      ok: true,
      txid,
      poolId: poolRow.id,
      symbol: poolRow.symbol,
      tokens,
      visible,
      attempts,
    };

    if (existing?.id) {
      const dupOut = { ...base, id: existing.id };
      persistResult(req, dupOut, "MINT_REAL_DUP", body);
      return res.json(dupOut);
    }

    const id = randomUUID();
    try {
      db.prepare(
        `INSERT INTO mints (id, pool_id, symbol, account, spend_sats, tokens, txid, confirmed)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
      ).run(id, poolRow.id, poolRow.symbol, fromAddress, spend, tokens, txid);
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes("FOREIGN KEY")) {
        throw new MintError("pool_fk_missing");
      }
      if (msg.includes("UNIQUE") && msg.includes("mints") && msg.includes("txid")) {
        const row = db.prepare(`SELECT id FROM mints WHERE txid=?`).get(txid) as any;
        const dupOut2 = { ...base, id: row?.id || id };
        persistResult(req, dupOut2, "MINT_REAL_DUP2", body);
        return res.json(dupOut2);
      }
      throw err;
    }

    appendLedger(poolRow.id, fromAddress, poolRow.symbol, tokens, "MINT_FILL");
    refreshSupply(poolRow.id, poolRow.symbol);

    console.log(
      `[MINT] success poolId=${poolRow.id} symbol=${poolRow.symbol} from=${fromAddress} spendSats=${spend} txid=${txid}`
    );

    const out = { ...base, id };
    persistResult(req, out, "MINT_REAL", body);
    return res.json(out);
  } catch (err: any) {
    const msg = err instanceof MintError ? err.message : String(err?.message || err);
    const status = err instanceof MintError ? err.status : msg.startsWith("woc_") ? 502 : 400;

    console.error(
      `[MINT] fail poolId=${poolIdForLog || ""} symbol=${symbolForLog || ""} destScript=${
        destScriptForLog ? destScriptForLog.slice(0, 64) : ""
      } destAddr=${destAddressForLog || ""} inputs=${selectedInputs.length} from=${fromAddr} err=${msg}`
    );

    res.status(status).json({ ok: false, error: msg });
  }
};

r.get("/", (req, res) => {
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

r.post("/verify", async (_req, res) => {
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

export const buyQuoteRoute = buyQuoteHandler;
export const buyOrderRoute = [buyOrderIdempotency, buyOrderHandler] as const;
export const mintRoute = [mintIdempotency, mintHandler] as const;

export default r;

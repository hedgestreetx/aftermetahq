import { Router } from "express";
import { randomUUID, createHash } from "crypto";
import { bsv } from "scrypt-ts";
import { z } from "zod";

import { ENV } from "../../lib/env";
import { db } from "../../lib/db";
import { logger } from "../../lib/logger";
import { DEFAULT_FEE_RATE, DUST_SATS, TESTNET_HEADROOM } from "../../lib/coin";
import { buildOutputs, selectUtxos, type Utxo } from "../../lib/utxo";
import { broadcastRawTransaction, fetchAddressUtxos } from "../../lib/woc";

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

type RateEntry = { count: number; resetAt: number };
const rateState = new Map<string, RateEntry>();

const buySchema = z
  .object({
    fromAddress: z.string().min(26).max(128),
    toAddress: z.string().min(26).max(128),
    amountSats: z.coerce.number().int().positive(),
    slippagePct: z.coerce.number().min(0).max(100).optional().default(0),
    idempotencyKey: z.string().optional(),
  })
  .strict();

type BuyPayload = z.infer<typeof buySchema>;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function consumeRateLimit(key: string, now = Date.now()) {
  const existing = rateState.get(key);
  if (!existing || existing.resetAt <= now) {
    rateState.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (existing.count < RATE_LIMIT_MAX) {
    existing.count += 1;
    return { allowed: true, retryAfterMs: existing.resetAt - now };
  }

  return { allowed: false, retryAfterMs: existing.resetAt - now };
}

function networkName() {
  return ENV.NETWORK === "mainnet" || ENV.NETWORK === "livenet" ? "mainnet" : "testnet";
}

let cachedPriv: bsv.PrivateKey | null = null;
let cachedAddress: string | null = null;

function ensureDevBuyKey() {
  if (cachedPriv) {
    return { priv: cachedPriv, address: cachedAddress! };
  }

  const wif = ENV.DEV_BUY_WIF;
  if (!wif) {
    throw new Error("dev_buy_wif_missing");
  }

  try {
    const priv = bsv.PrivateKey.fromWIF(wif);
    const address = priv.toAddress(networkName()).toString();
    cachedPriv = priv;
    cachedAddress = address;
    return { priv, address };
  } catch (err: any) {
    throw new Error(`dev_buy_wif_invalid_${String(err?.message || err)}`);
  }
}

const selectCommandStmt = db.prepare(
  `SELECT payload, result FROM commands WHERE id = ?`
);
const insertCommandStmt = db.prepare(
  `INSERT OR IGNORE INTO commands(id, type, payload, result) VALUES (?, 'buy', ?, NULL)`
);
const updateCommandStmt = db.prepare(
  `UPDATE commands SET type='buy', payload = ?, result = ? WHERE id = ?`
);

const selectBuyStmt = db.prepare(
  `SELECT id, request_hash AS requestHash, status, txid, fee_sats AS feeSats,
          change_sats AS changeSats, input_count AS inputCount, output_count AS outputCount,
          attempt_count AS attemptCount, error
     FROM buys
    WHERE idempotency_key = ?`
);
const insertBuyStmt = db.prepare(
  `INSERT OR IGNORE INTO buys (
      id, idempotency_key, request_hash, from_address, to_address, amount_sats,
      slippage_pct, status, attempt_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0)`
);
const updateBuyStmt = db.prepare(
  `UPDATE buys
      SET status = ?,
          txid = ?,
          fee_sats = ?,
          change_sats = ?,
          input_count = ?,
          output_count = ?,
          attempt_count = ?,
          error = ?,
          updated_at = datetime('now')
    WHERE idempotency_key = ?`
);

function parseStoredResult(raw: any) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") return null;
    const status = Number(parsed.status ?? 200);
    const body = parsed.body ?? null;
    return { status: Number.isFinite(status) ? status : 200, body };
  } catch {
    return null;
  }
}

function storeCommandResult(key: string, payload: unknown, result: { status: number; body: unknown }) {
  updateCommandStmt.run(JSON.stringify(payload ?? {}), JSON.stringify(result ?? {}), key);
}

function isRetryableBroadcastError(message: string) {
  const norm = message.toLowerCase();
  return (
    norm.includes("mempool") ||
    norm.includes("conflict") ||
    norm.includes("already in the mempool") ||
    norm.includes("already known") ||
    norm.includes("already spent")
  );
}

function buildConflictResponse(message: string) {
  return {
    status: 409,
    body: { ok: false, error: "idempotency_conflict", message },
  } as const;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const router = Router();

router.post("/v1/buy", async (req, res) => {
  if (ENV.NETWORK === "mainnet" || ENV.NETWORK === "livenet" || !ENV.ALLOW_DEV_BUY) {
    return res.status(403).json({ ok: false, error: "buy_disabled", message: "Buy route disabled" });
  }

  const idempotencyHeader = (req.header("Idempotency-Key") || "").trim();
  if (!idempotencyHeader) {
    return res
      .status(400)
      .json({ ok: false, error: "missing_idempotency_key", message: "Idempotency-Key header required" });
  }

  let payload: BuyPayload;
  try {
    payload = buySchema.parse(req.body ?? {});
  } catch (err: any) {
    return res.status(400).json({ ok: false, error: "invalid_body", message: String(err?.message || err) });
  }

  if (payload.idempotencyKey && payload.idempotencyKey !== idempotencyHeader) {
    return res.status(400).json({ ok: false, error: "idempotency_mismatch" });
  }

  const { priv, address: expectedAddress } = (() => {
    try {
      return ensureDevBuyKey();
    } catch (err: any) {
      return { priv: null, address: null, error: String(err?.message || err) } as const;
    }
  })();

  if (!priv || !expectedAddress) {
    return res.status(503).json({ ok: false, error: "dev_buy_key_missing" });
  }

  const normalizedFrom = payload.fromAddress.trim();
  if (normalizedFrom.toLowerCase() !== expectedAddress.toLowerCase()) {
    return res.status(400).json({ ok: false, error: "from_address_mismatch" });
  }

  const normalizedTo = payload.toAddress.trim();
  if (normalizedTo === normalizedFrom) {
    return res.status(400).json({ ok: false, error: "invalid_destination", message: "Destination must differ from source" });
  }

  const rateKey = `${req.ip || "unknown"}|${normalizedFrom.toLowerCase()}`;
  const rate = consumeRateLimit(rateKey);
  if (!rate.allowed) {
    return res.status(429).json({
      ok: false,
      error: "rate_limited",
      message: "Too many buy requests",
      retryAfter: Math.max(1, Math.ceil(rate.retryAfterMs / 1000)),
    });
  }

  const canonical = stableStringify({
    fromAddress: normalizedFrom.toLowerCase(),
    toAddress: normalizedTo.toLowerCase(),
    amountSats: payload.amountSats,
    slippagePct: payload.slippagePct ?? 0,
  });

  const requestHash = createHash("sha256").update(canonical).digest("hex");

  insertCommandStmt.run(idempotencyHeader, JSON.stringify({ requestHash }));
  const existingCommand = selectCommandStmt.get(idempotencyHeader) as { payload?: string; result?: string } | undefined;
  if (existingCommand?.payload) {
    try {
      const saved = JSON.parse(existingCommand.payload);
      if (saved?.requestHash && saved.requestHash !== requestHash) {
        const conflict = buildConflictResponse("Idempotency key reuse with different payload");
        storeCommandResult(idempotencyHeader, { requestHash }, conflict);
        return res.status(conflict.status).json(conflict.body);
      }
    } catch {
      // ignore malformed rows and overwrite below
    }
  }

  const storedResult = parseStoredResult(existingCommand?.result);
  if (storedResult) {
    return res.status(storedResult.status).json(storedResult.body);
  }

  const buyId = randomUUID();
  insertBuyStmt.run(
    buyId,
    idempotencyHeader,
    requestHash,
    normalizedFrom,
    normalizedTo,
    payload.amountSats,
    payload.slippagePct ?? 0,
  );

  const existingBuy = selectBuyStmt.get(idempotencyHeader) as
    | {
        id: string;
        requestHash: string;
        status: string;
        txid: string | null;
        feeSats: number | null;
        changeSats: number | null;
        inputCount: number | null;
        outputCount: number | null;
        attemptCount: number | null;
        error: string | null;
      }
    | undefined;

  if (existingBuy && existingBuy.requestHash !== requestHash) {
    const conflict = buildConflictResponse("Stored buy payload mismatch");
    storeCommandResult(idempotencyHeader, { requestHash }, conflict);
    return res.status(conflict.status).json(conflict.body);
  }

  if (existingBuy && existingBuy.status === "confirmed" && existingBuy.txid) {
    const response = {
      ok: true,
      txid: existingBuy.txid,
      feeSats: Number(existingBuy.feeSats ?? 0),
      changeSats: Number(existingBuy.changeSats ?? 0),
      inputCount: Number(existingBuy.inputCount ?? 0),
      outputCount: Number(existingBuy.outputCount ?? 0),
      attemptCount: Number(existingBuy.attemptCount ?? 1),
      idempotencyKey: idempotencyHeader,
    };
    const stored = { status: 200, body: response };
    storeCommandResult(idempotencyHeader, { requestHash }, stored);
    return res.status(200).json(response);
  }

  if ((payload.slippagePct ?? 0) > 5) {
    return res.status(400).json({ ok: false, error: "slippage_exceeded", message: "Slippage guard pending real pricing" });
  }

  const feeRate = ENV.FEE_RATE_SATS_PER_BYTE && ENV.FEE_RATE_SATS_PER_BYTE > 0
    ? ENV.FEE_RATE_SATS_PER_BYTE
    : DEFAULT_FEE_RATE;

  const headroom = ENV.NETWORK === "testnet" ? TESTNET_HEADROOM : 1;
  const requestId = (req as any).requestId as string | undefined;

  let lastError: string | null = null;
  let attemptCount = 0;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    attemptCount = attempt;

    if (attempt > 1) {
      const delay = 150 * 2 ** (attempt - 2);
      await sleep(delay);
    }

    let utxos;
    try {
      utxos = await fetchAddressUtxos(normalizedFrom);
    } catch (err: any) {
      lastError = String(err?.message || err);
      logger.warn("buy.utxos_failed", { requestId, attempt, error: lastError });
      break;
    }

    const spendableUtxos: Utxo[] = utxos.map((u: any) => ({
      txid: String(u?.txid ?? u?.tx_hash ?? ""),
      vout: Number(u?.vout ?? u?.tx_pos ?? 0),
      valueSats: Number(u?.valueSats ?? u?.value ?? 0),
      scriptPubKey: String(u?.scriptPubKey ?? u?.script ?? ""),
      confirmations: Number(u?.confirmations ?? 0),
    }));

    if (!spendableUtxos.length) {
      lastError = "no_utxos";
      logger.warn("buy.selection_failed", { requestId, attempt, error: lastError });
      break;
    }

    let selection;
    try {
      selection = selectUtxos(spendableUtxos, payload.amountSats, feeRate, {
        outputsWithoutChange: 1,
        targetHeadroomFactor: headroom,
        dustThreshold: DUST_SATS,
      });
    } catch (err: any) {
      lastError = String(err?.message || err);
      logger.warn("buy.selection_failed", { requestId, attempt, error: lastError });
      break;
    }

    const changeSats = Math.max(0, selection.changeSats);
    const outputs = buildOutputs(
      [
        {
          address: normalizedTo,
          valueSats: payload.amountSats,
        },
      ],
      {
        changeAddress: normalizedFrom,
        changeSats,
        dustThreshold: DUST_SATS,
      },
    );

    const tx = new bsv.Transaction();
    for (const input of selection.inputs) {
      tx.from({
        txId: input.txid,
        outputIndex: input.vout,
        script: bsv.Script.fromHex(input.scriptPubKey),
        satoshis: input.valueSats,
      });
    }

    for (const output of outputs.outputs) {
      tx.to(output.address, output.valueSats);
    }

    tx.sign(priv);

    const raw = tx.serialize(true);
    try {
      const broadcast = await broadcastRawTransaction(raw);
      const txid = broadcast.txid;
      const finalChange = outputs.totals.changeSats;
      const feeSats = selection.totalInputSats - finalChange - payload.amountSats;
      const response = {
        ok: true,
        txid,
        feeSats: Math.max(0, feeSats),
        changeSats: Math.max(0, finalChange),
        inputCount: selection.inputs.length,
        outputCount: outputs.totals.outputCount,
        attemptCount,
        idempotencyKey: idempotencyHeader,
      };

      updateBuyStmt.run(
        "confirmed",
        txid,
        response.feeSats,
        response.changeSats,
        response.inputCount,
        response.outputCount,
        attemptCount,
        null,
        idempotencyHeader,
      );

      const stored = { status: 200, body: response };
      storeCommandResult(idempotencyHeader, { requestHash }, stored);

      logger.info("buy.attempt", {
        requestId,
        attempt,
        txid,
        feeSats: response.feeSats,
        changeSats: response.changeSats,
        inputCount: response.inputCount,
        outputCount: response.outputCount,
      });

      return res.status(200).json(response);
    } catch (err: any) {
      lastError = String(err?.message || err);
      logger.warn("buy.attempt", {
        requestId,
        attempt,
        txid: null,
        feeSats: selection.totalInputSats - payload.amountSats - changeSats,
        changeSats,
        inputCount: selection.inputs.length,
        outputCount: outputs.totals.outputCount,
        error: lastError,
      });

      if (!isRetryableBroadcastError(lastError) || attempt === 3) {
        break;
      }
    }
  }

  updateBuyStmt.run(
    "failed",
    null,
    null,
    null,
    null,
    null,
    attemptCount,
    lastError,
    idempotencyHeader,
  );

  const failure = {
    status: 502,
    body: {
      ok: false,
      error: "buy_broadcast_failed",
      message: lastError || "Broadcast failed",
      attemptCount,
    },
  } as const;

  storeCommandResult(idempotencyHeader, { requestHash }, failure);

  return res.status(failure.status).json(failure.body);
});

export default router;

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { bsv } from "scrypt-ts";

import router from "../src/api/routes.v1";
import mintsRouter from "../src/api/routes/mints";
import txRouter from "../src/api/routes/tx";
import { db, migrate } from "../src/lib/db";
import { calcTokens } from "../src/lib/txutil";
import { loadMintStatus, normalizeTxid } from "../src/lib/mintVerifier";

type HttpMethod = "get" | "post";

type RouteHandler = (req: any, res: any, next?: any) => unknown;

type RouteSource = { stack: Array<any> };

function resolveRoute(path: string, method: HttpMethod, source: RouteSource = router as any): RouteHandler {
  const layer = (source as any).stack.find(
    (l: any) => l?.route?.path === path && Boolean(l.route?.methods?.[method])
  );
  if (!layer) {
    throw new Error(`route ${method.toUpperCase()} ${path} not registered`);
  }
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle as RouteHandler;
}

type InvokeOptions = {
  router?: RouteSource;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  requestId?: string;
};

async function invokeRoute(path: string, method: HttpMethod, body: unknown, options: InvokeOptions = {}) {
  const handler = resolveRoute(path, method, options.router);
  let statusCode = 200;
  return await new Promise<{ statusCode: number; body: any }>((resolve, reject) => {
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: unknown) {
        resolve({ statusCode, body: payload });
        return this;
      },
      setHeader() {
        return this;
      },
    } as any;

    const req = {
      body,
      headers: { ...(options.headers || {}) },
      params: { ...(options.params || {}) },
      query: { ...(options.query || {}) },
      res,
      method: method.toUpperCase(),
    } as any;
    req.requestId = options.requestId || `selftest-${crypto.randomUUID()}`;

    Promise.resolve(handler(req, res, (err: unknown) => (err ? reject(err) : null))).catch(
      reject,
    );
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function checkMintQuote() {
  migrate();
  db.exec(
    `DELETE FROM ledger; DELETE FROM mints; DELETE FROM pool_supply; DELETE FROM pools; DELETE FROM commands;`,
  );

  const poolId = "selftest-pool";
  const poolSymbol = "SELF";
  const poolKey = bsv.PrivateKey.fromRandom("testnet");
  const poolAddress = poolKey.toAddress("testnet").toString();
  const poolLockingScriptHex = bsv.Script.buildPublicKeyHashOut(poolAddress).toHex();

  db.prepare(
    `INSERT INTO pools (id, symbol, creator, pool_address, locking_script_hex, max_supply, decimals, creator_reserve)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(poolId, poolSymbol, "creator", poolAddress, poolLockingScriptHex, 1_000_000, 0, 0);

  const minterKey = bsv.PrivateKey.fromRandom("testnet");
  const wif = minterKey.toWIF();
  const utxoValue = 25_000;
  const utxoTxid = "b".repeat(64);
  let broadcastCalls = 0;

  const originalFetch = global.fetch;
  global.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    if (url.includes("/unspent")) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ tx_hash: utxoTxid, tx_pos: 0, value: utxoValue }],
        text: async () => "[]",
      } as any;
    }
    if (url.includes("/tx/raw")) {
      broadcastCalls += 1;
      return {
        ok: true,
        status: 200,
        text: async () => `"${"c".repeat(64)}"`,
      } as any;
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    const body = JSON.stringify({
      wif,
      spendSats: 1_000,
      poolId,
      poolLockingScriptHex,
    });

    const result = await invokeRoute("/v1/mint/quote", "post", body);
    assert.equal(result.statusCode, 200, `quote status ${result.statusCode}`);
    assert.equal(result.body?.ok, true, `quote response not ok: ${JSON.stringify(result.body)}`);
    assert.equal(result.body?.symbol, poolSymbol);
    assert.equal(result.body?.spendSats, 1_000);
    assert.equal(result.body?.tokensEstimate, calcTokens(1_000));
    assert.ok(Number(result.body?.feeEstimate) > 0, "feeEstimate missing");
    assert.equal(broadcastCalls, 0, "quote should not broadcast transactions");

    console.log(
      `✅ /v1/mint/quote returned feeEstimate=${result.body.feeEstimate} tokens=${result.body.tokensEstimate}`,
    );
  } finally {
    global.fetch = originalFetch;
    db.exec(
      `DELETE FROM ledger; DELETE FROM mints; DELETE FROM pool_supply; DELETE FROM pools; DELETE FROM commands;`,
    );
  }
}

async function pollForConfirmation(txid: string, timeoutMs = 90_000) {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < timeoutMs) {
    const status = await loadMintStatus(txid);
    if (status.ok && status.confirmed) {
      return status;
    }
    const delay = Math.min(500 * 2 ** attempt, 4000);
    attempt += 1;
    await sleep(delay);
  }
  throw new Error(`selftest_confirm_timeout_${txid}`);
}

async function checkMintConfirmationFlip() {
  const wif = process.env.SELFTEST_WIF;
  if (!wif) {
    console.log("⚠️ SELFTEST_WIF not set; skipping mint confirmation flip test.");
    return;
  }

  migrate();
  db.exec(
    `DELETE FROM ledger; DELETE FROM mints; DELETE FROM pool_supply; DELETE FROM pools; DELETE FROM commands;`,
  );

  const poolId = "selftest-mint-pool";
  const poolSymbol = "SMIN";
  const poolKey = bsv.PrivateKey.fromRandom("testnet");
  const poolAddress = poolKey.toAddress("testnet").toString();
  const poolLockingScriptHex = bsv.Script.buildPublicKeyHashOut(poolAddress).toHex();

  db.prepare(
    `INSERT INTO pools (id, symbol, creator, pool_address, locking_script_hex, max_supply, decimals, creator_reserve)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(poolId, poolSymbol, "creator", poolAddress, poolLockingScriptHex, 1_000_000, 0, 0);

  const utxoValue = 30_000;
  const utxoTxid = "ABCDEF0123456789".repeat(4);
  const mintedTxidUpper = "FACEFEED1234ABCD".repeat(4).slice(0, 64).toUpperCase();
  const mintedTxid = normalizeTxid(mintedTxidUpper);
  let statusChecks = 0;

  const originalFetch = global.fetch;
  global.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    if (url.includes("/unspent")) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ tx_hash: utxoTxid, tx_pos: 0, value: utxoValue }],
        text: async () => "[]",
      } as any;
    }
    if (url.endsWith("/tx/raw")) {
      return {
        ok: true,
        status: 200,
        text: async () => `"${mintedTxidUpper}"`,
      } as any;
    }
    if (url.includes(`/tx/hash/${mintedTxid}`)) {
      return { ok: true, status: 200, text: async () => "" } as any;
    }
    if (url.includes(`/tx/${mintedTxid}/status`)) {
      statusChecks += 1;
      const confirmed = statusChecks >= 2;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          confirmed,
          confirmations: confirmed ? 3 : 0,
          blockheight: confirmed ? 1337 : undefined,
        }),
      } as any;
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    const body = JSON.stringify({
      wif,
      spendSats: 1_500,
      poolId,
      poolLockingScriptHex,
    });

    const mintResult = await invokeRoute("/v1/mint", "post", body);
    assert.equal(mintResult.statusCode, 200, `mint status ${mintResult.statusCode}`);
    assert.equal(mintResult.body?.ok, true, `mint response not ok: ${JSON.stringify(mintResult.body)}`);
    const txid = normalizeTxid(String(mintResult.body?.txid || ""));
    assert.equal(txid, mintedTxid, "mint txid normalization mismatch");

    console.log(`✅ /v1/mint produced txid=${txid}`);

    const wocStatus = await pollForConfirmation(txid);
    console.log(
      `✅ WOC confirmed txid=${txid} confirmations=${wocStatus.confirmations} blockHeight=${wocStatus.blockHeight ?? "null"}`,
    );

    const statusResult = await invokeRoute("/:txid/status", "get", undefined, {
      router: txRouter as any,
      params: { txid },
    });
    assert.equal(statusResult.statusCode, 200, `status endpoint returned ${statusResult.statusCode}`);
    assert.equal(statusResult.body?.confirmed, true, "status endpoint did not confirm tx");

    console.log(`✅ /v1/tx/${txid}/status reported confirmed`);

    const verifyResult = await invokeRoute("/verify", "post", {}, { router: mintsRouter as any });
    assert.equal(verifyResult.statusCode, 200, `verify status ${verifyResult.statusCode}`);
    const flipped = Number(verifyResult.body?.flipped ?? 0);
    const checked = Number(verifyResult.body?.checked ?? 0);
    assert.ok(checked >= 1, "verify endpoint did not check any txids");
    assert.ok(flipped >= 0, "verify endpoint returned invalid flipped count");

    console.log(`✅ /v1/mints/verify checked=${checked} flipped=${flipped}`);

    const listResult = await invokeRoute("/", "get", undefined, {
      router: mintsRouter as any,
      query: { symbol: poolSymbol },
    });
    assert.equal(listResult.statusCode, 200, `list status ${listResult.statusCode}`);
    const mintedRow = (listResult.body?.mints || []).find((row: any) => normalizeTxid(row?.txid) === txid);
    assert.ok(mintedRow, "minted row not returned");
    assert.equal(Number(mintedRow.confirmed), 1, "minted row not marked confirmed");
    assert.ok(flipped >= 1 || Number(mintedRow.confirmed) === 1, "verify endpoint failed to confirm mint");

    console.log(`✅ /v1/mints lists txid=${txid} confirmed=1`);
  } finally {
    global.fetch = originalFetch;
    db.exec(
      `DELETE FROM ledger; DELETE FROM mints; DELETE FROM pool_supply; DELETE FROM pools; DELETE FROM commands;`,
    );
  }
}

await checkMintQuote();
await checkMintConfirmationFlip();

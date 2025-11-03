import assert from "node:assert/strict";
import { bsv } from "scrypt-ts";

import router from "../src/api/routes.v1";
import { db, migrate } from "../src/lib/db";
import { calcTokens } from "../src/lib/txutil";

type HttpMethod = "get" | "post";

type RouteHandler = (req: any, res: any, next?: any) => unknown;

function resolveRoute(path: string, method: HttpMethod): RouteHandler {
  const layer = (router as any).stack.find(
    (l: any) => l?.route?.path === path && Boolean(l.route?.methods?.[method])
  );
  if (!layer) {
    throw new Error(`route ${method.toUpperCase()} ${path} not registered`);
  }
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle as RouteHandler;
}

async function invokeRoute(path: string, method: HttpMethod, body: unknown) {
  const handler = resolveRoute(path, method);
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
      headers: {},
      res,
    } as any;

    Promise.resolve(handler(req, res, (err: unknown) => (err ? reject(err) : null))).catch(
      reject,
    );
  });
}

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

await checkMintQuote();

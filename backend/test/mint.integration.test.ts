import assert from "node:assert/strict";
import { bsv } from "scrypt-ts";
import router from "../src/api/routes.v1";
import { db, migrate } from "../src/lib/db";

async function invokeMint(body: unknown, requestId: string) {
  const layer = (router as any).stack.find(
    (l: any) => l?.route?.path === "/v1/mint" && l.route?.methods?.post
  );
  if (!layer) {
    throw new Error("mint route not registered");
  }
  const handler = layer.route.stack[layer.route.stack.length - 1].handle as Function;

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
      headers: { "x-request-id": requestId },
      res,
    } as any;

    Promise.resolve(handler(req, res, (err: unknown) => (err ? reject(err) : null))).catch(
      reject
    );
  });
}

async function main() {
  migrate();
  db.exec(
    `DELETE FROM ledger; DELETE FROM mints; DELETE FROM pool_supply; DELETE FROM pools; DELETE FROM commands;`
  );

  const poolId = "pool-test";
  const poolSymbol = "TST";
  const poolKey = bsv.PrivateKey.fromRandom("testnet");
  const poolAddress = poolKey.toAddress("testnet").toString();
  const poolLockingScriptHex = bsv.Script.buildPublicKeyHashOut(poolAddress).toHex();

  db.prepare(
    `INSERT INTO pools (id, symbol, creator, pool_address, locking_script_hex, max_supply, decimals, creator_reserve)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(poolId, poolSymbol, "creator", poolAddress, poolLockingScriptHex, 1_000_000, 0, 0);

  const minterKey = bsv.PrivateKey.fromRandom("testnet");
  const wif = minterKey.toWIF();
  const utxoValue = 100_000;
  const txid = "f".repeat(64);
  let broadcastCalls = 0;
  let visibilityChecks = 0;

  const originalFetch = global.fetch;
  global.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    if (url.includes("/unspent")) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          { tx_hash: "a".repeat(64), tx_pos: 0, value: utxoValue },
        ],
        text: async () => "[]",
      } as any;
    }
    if (url.includes("/tx/raw")) {
      broadcastCalls += 1;
      return {
        ok: true,
        status: 200,
        text: async () => `"${txid}"`,
      } as any;
    }
    if (url.includes("/tx/hash/")) {
      visibilityChecks += 1;
      return {
        status: 200,
      } as any;
    }
    throw new Error(`unexpected fetch call: ${url} ${JSON.stringify(init)}`);
  }) as typeof fetch;

  try {
    const body = JSON.stringify({
      wif,
      spendSats: 1_000,
      poolId,
      poolLockingScriptHex,
    });
    const result = await invokeMint(body, "mint-test-req");
    assert.equal(result.statusCode, 200, `expected 200 OK, got ${result.statusCode}`);
    assert.equal(result.body?.ok, true, `response not ok: ${JSON.stringify(result.body)}`);
    assert.equal(result.body?.poolId, poolId);
    assert.equal(result.body?.symbol, poolSymbol);
    assert.equal(typeof result.body?.txid, "string");
    assert.equal(result.body?.txid, txid);
    assert.equal(result.body?.visible, true);
    assert.equal(result.body?.attempts >= 1, true);

    assert.equal(broadcastCalls, 1, "expected single broadcast call");
    assert.equal(visibilityChecks >= 1, true, "expected visibility check");

    const mintRow = db
      .prepare(`SELECT pool_id AS poolId, spend_sats AS spend, tokens FROM mints WHERE txid=?`)
      .get(txid) as any;
    assert.ok(mintRow, "mint row not persisted");
    assert.equal(mintRow.poolId, poolId);
    assert.equal(mintRow.spend, 1000);
    assert.equal(mintRow.tokens, Math.floor(1000 / 1000));

    const ledgerRow = db
      .prepare(`SELECT pool_id AS poolId, delta FROM ledger WHERE pool_id=? ORDER BY id DESC LIMIT 1`)
      .get(poolId) as any;
    assert.ok(ledgerRow, "ledger entry missing");
    assert.equal(ledgerRow.delta, Math.floor(1000 / 1000));

    const supplyRow = db
      .prepare(`SELECT minted_supply AS minted FROM pool_supply WHERE pool_id=?`)
      .get(poolId) as any;
    assert.ok(supplyRow, "supply entry missing");
    assert.equal(supplyRow.minted, Math.floor(1000 / 1000));

    console.log("Mint integration test passed");
  } finally {
    global.fetch = originalFetch;
    db.exec(`DELETE FROM ledger; DELETE FROM mints; DELETE FROM pool_supply; DELETE FROM pools; DELETE FROM commands;`);
  }
}

await main();

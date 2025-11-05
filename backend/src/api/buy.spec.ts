import fs from "fs";
import path from "path";
import { tmpdir } from "os";

import express from "express";
import { bsv } from "scrypt-ts";
import { beforeAll, beforeEach, afterAll, describe, expect, test, vi } from "../testUtils/vitest-shim";

import { requestJson } from "../testUtils/http";

const priv = bsv.PrivateKey.fromRandom("testnet");
const fromAddress = priv.toAddress("testnet").toString();
const testWif = priv.toWIF();
const changeScript = bsv.Script.buildPublicKeyHashOut(fromAddress).toHex();
const dbPath = path.join(tmpdir(), `aftermeta-buy-${Date.now()}.db`);

const toAddressPrimary = bsv.PrivateKey.fromRandom("testnet").toAddress("testnet").toString();
const toAddressAlt = bsv.PrivateKey.fromRandom("testnet").toAddress("testnet").toString();
const toAddressConflict = bsv.PrivateKey.fromRandom("testnet").toAddress("testnet").toString();

process.env.NETWORK = "testnet";
process.env.ALLOW_DEV_BUY = "true";
process.env.DEV_BUY_WIF = testWif;
process.env.AFTERMETA_DB_PATH = dbPath;

describe("POST /v1/buy", () => {

  let app: express.Express;
  const fetchAddressUtxos = vi.fn();
  const broadcastRawTransaction = vi.fn();
  let setOverrides: ((handlers: any) => void) | null = null;
  let db: typeof import("../lib/db").db;

  beforeAll(async () => {
    const dbModule = await import("../lib/db");
    db = dbModule.db;
    dbModule.migrate();

    const woc = await import("../lib/woc");
    setOverrides = woc.__setWocOverridesForTests;
    setOverrides({
      fetchAddressUtxos: (address: string) => fetchAddressUtxos(address),
      broadcastRawTransaction: (raw: string) => broadcastRawTransaction(raw),
    });

    const buyRouter = (await import("./routes/buy")).default;

    app = express();
    app.use(express.json());
    app.use(buyRouter);
  });

  beforeEach(() => {
    fetchAddressUtxos.mockReset();
    broadcastRawTransaction.mockReset();
    db.exec("DELETE FROM buys");
    db.exec("DELETE FROM commands");
  });

  afterAll(() => {
    if (setOverrides) {
      setOverrides(null);
    }
    try {
      db.close();
    } catch {
      // ignore
    }

    for (const suffix of ["", "-wal", "-shm"]) {
      const p = `${dbPath}${suffix}`;
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {
          // ignore cleanup failures
        }
      }
    }
  });

  test("returns 400 for invalid payload", async () => {
    const res = await requestJson(app, {
      method: "POST",
      path: "/v1/buy",
      headers: {
        "Idempotency-Key": "bad-1",
      },
      body: {},
    });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test("returns 200 on successful broadcast", async () => {
    const utxos = [
      {
        txid: "f".repeat(64),
        vout: 0,
        value: 2000,
        script: changeScript,
        confirmations: 5,
      },
    ];

    fetchAddressUtxos.mockResolvedValue(utxos);
    broadcastRawTransaction.mockResolvedValue({ txid: "ab".repeat(32) });

    const res = await requestJson(app, {
      method: "POST",
      path: "/v1/buy",
      headers: {
        "Idempotency-Key": "buy-1",
      },
      body: {
        fromAddress,
        toAddress: toAddressPrimary,
        amountSats: 1000,
        slippagePct: 0,
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.txid).toBe("ab".repeat(32));
    expect(broadcastRawTransaction).toHaveBeenCalledTimes(1);
  });

  test("returns 409 when idempotency key reused with different payload", async () => {
    const utxos = [
      {
        txid: "e".repeat(64),
        vout: 0,
        value: 2000,
        script: changeScript,
        confirmations: 8,
      },
    ];

    fetchAddressUtxos.mockResolvedValue(utxos);
    broadcastRawTransaction.mockResolvedValue({ txid: "cd".repeat(32) });

    await requestJson(app, {
      method: "POST",
      path: "/v1/buy",
      headers: {
        "Idempotency-Key": "buy-dup",
      },
      body: {
        fromAddress,
        toAddress: toAddressAlt,
        amountSats: 1000,
        slippagePct: 0,
      },
    });

    const res = await requestJson(app, {
      method: "POST",
      path: "/v1/buy",
      headers: {
        "Idempotency-Key": "buy-dup",
      },
      body: {
        fromAddress,
        toAddress: toAddressConflict,
        amountSats: 1000,
        slippagePct: 0,
      },
    });

    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
    expect(broadcastRawTransaction).toHaveBeenCalledTimes(1);
  });
});

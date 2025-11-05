import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "../../testUtils/vitest-shim";
import request from "../../testUtils/supertest";

async function importFresh<T>(modulePath: string): Promise<T> {
  const version = `?v=${Date.now()}-${Math.random()}-${vi.moduleVersion}`;
  return (await import(modulePath + version)) as T;
}

function tempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aftermeta-int-"));
  return path.join(dir, "db.sqlite");
}

describe("API integration", () => {
  afterEach(() => {
    delete process.env.DB_PATH;
    delete process.env.NETWORK;
    delete process.env.WOC_BASE;
    vi.resetModules();
  });

  it("POST /api/mint stores tx and returns explorer URL", async () => {
    process.env.DB_PATH = tempDbPath();
    process.env.NETWORK = "testnet";
    vi.resetModules();

    const { migrate } = await importFresh<typeof import("../../lib/migrate")>(
      "../../lib/migrate"
    );
    const { getDb, resetDbForTests } = await importFresh<typeof import("../../lib/db")>(
      "../../lib/db"
    );
    const { createApp } = await importFresh<typeof import("../server")>("../server");
    const { __setFetch } = await importFresh<typeof import("../../lib/woc")>("../../lib/woc");

    resetDbForTests();

    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (url: string, init?: any) => {
        expect(url.includes("/tx/raw")).toBe(true);
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify({ txid: "abcd" }), { status: 200 });
      });

    __setFetch(fetchMock as any);

    migrate();
    const app = createApp();

    const res = await request(app).post("/api/mint").send({ txHex: "00" }).expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.txid).toBe("abcd");
    expect(res.body.explorerUrl).toBe("https://test.whatsonchain.com/tx/abcd");

    const db = getDb();

    const row = db.prepare("SELECT txid, confirmed FROM mints WHERE txid = ?").get("abcd") as
      | { txid: string; confirmed: number }
      | undefined;
    expect(row?.confirmed).toBe(0);

    resetDbForTests();
  });

  it("poller marks mints confirmed", async () => {
    process.env.DB_PATH = tempDbPath();
    process.env.NETWORK = "mainnet";
    vi.resetModules();

    const { migrate } = await importFresh<typeof import("../../lib/migrate")>(
      "../../lib/migrate"
    );
    const { getDb, resetDbForTests } = await importFresh<typeof import("../../lib/db")>(
      "../../lib/db"
    );
    const poller = await importFresh<typeof import("../../lib/mintConfirmationPoller")>(
      "../../lib/mintConfirmationPoller"
    );
    const { __setFetch } = await importFresh<typeof import("../../lib/woc")>("../../lib/woc");

    resetDbForTests();

    const fetchMock = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({ confirmed: true, confirmations: 1, block_height: 500 }),
        { status: 200 }
      );
    });
    __setFetch(fetchMock as any);

    migrate();

    const db = getDb();

    db.prepare("INSERT INTO mints (txid, explorer_url, confirmed) VALUES (?, ?, 0)").run(
      "zzzz",
      "https://whatsonchain.com/tx/zzzz"
    );

    await poller.triggerMintConfirmationPollerOnce();

    const row = db.prepare("SELECT confirmed FROM mints WHERE txid = ?").get("zzzz") as
      | { confirmed: number }
      | undefined;
    expect(row?.confirmed).toBe(1);

    poller.resetMintConfirmationPollerForTests();
    resetDbForTests();
  });

  it("GET /api/mint/:txid/status proxies WOC", async () => {
    process.env.DB_PATH = tempDbPath();
    process.env.NETWORK = "stn";
    vi.resetModules();

    const { migrate } = await importFresh<typeof import("../../lib/migrate")>(
      "../../lib/migrate"
    );
    const { createApp } = await importFresh<typeof import("../server")>("../server");
    const { __setFetch } = await importFresh<typeof import("../../lib/woc")>("../../lib/woc");
    const { getDb, resetDbForTests } = await importFresh<typeof import("../../lib/db")>(
      "../../lib/db"
    );

    resetDbForTests();

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      expect(url.includes("/v1/bsv/stn/tx/demo/status")).toBe(true);
      return new Response(
        JSON.stringify({ confirmed: false, confirmations: 0, block_height: null }),
        { status: 200 }
      );
    });

    __setFetch(fetchMock as any);

    migrate();
    const app = createApp();

    const res = await request(app).get("/api/mint/demo/status").expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status.confirmed).toBe(false);

    resetDbForTests();
  });

  it("GET /health returns db error when closed", async () => {
    process.env.DB_PATH = tempDbPath();
    process.env.NETWORK = "testnet";
    vi.resetModules();

    const { migrate } = await importFresh<typeof import("../../lib/migrate")>(
      "../../lib/migrate"
    );
    const { getDb, resetDbForTests } = await importFresh<typeof import("../../lib/db")>(
      "../../lib/db"
    );
    const { createApp, resetServerStateForTests } = await importFresh<
      typeof import("../server")
    >("../server");

    resetDbForTests();

    migrate();
    const app = createApp();

    const healthy = await request(app).get("/health").expect(200);
    expect(healthy.body.ok).toBe(true);

    const db = getDb();
    db.close();

    const unhealthy = await request(app).get("/health").expect(500);
    expect(unhealthy.body.db).toBe(false);

    resetDbForTests();
    resetServerStateForTests();
  });
});

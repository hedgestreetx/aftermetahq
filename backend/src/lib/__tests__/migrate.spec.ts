import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "../../testUtils/vitest-shim";

async function importFresh<T>(modulePath: string): Promise<T> {
  const version = `?v=${Date.now()}-${Math.random()}-${vi.moduleVersion}`;
  return (await import(modulePath + version)) as T;
}

function createTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aftermeta-test-"));
  return path.join(dir, "db.sqlite");
}

describe("migrate", () => {
  afterEach(() => {
    delete process.env.DB_PATH;
    vi.resetModules();
  });

  it("creates required tables", async () => {
    process.env.DB_PATH = createTempDbPath();
    vi.resetModules();

    const { migrate } = await importFresh<typeof import("../migrate")>("../migrate");
    const { getDb, resetDbForTests } = await importFresh<typeof import("../db")>(
      "../db"
    );

    migrate();

    const db = getDb();

    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = rows.map((row) => row.name);

    expect(names.includes("mints")).toBe(true);
    expect(names.includes("buys")).toBe(true);

    resetDbForTests();
  });
});

import { getDb } from "./db";

const schemaSql = `
CREATE TABLE IF NOT EXISTS mints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txid TEXT NOT NULL UNIQUE,
  explorer_url TEXT,
  confirmed INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS buys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  payload TEXT,
  created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mints_confirmed ON mints(confirmed, created_at DESC);
`;

export function migrate(): void {
  const db = getDb();

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(schemaSql);

  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('mints', 'buys')"
    )
    .all() as Array<{ name: string }>;

  const names = new Set(rows.map((row) => row.name));
  const missing: string[] = [];
  for (const table of ["mints", "buys"]) {
    if (!names.has(table)) {
      missing.push(table);
    }
  }

  if (missing.length > 0) {
    throw new Error(`migration_failed_missing_tables:${missing.join(",")}`);
  }
}

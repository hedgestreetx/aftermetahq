// backend/src/lib/db.ts
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

// -----------------------------------------------------------------------------
// Path resolution (stable even when compiled to dist/)
// -----------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// backend root = two levels up from this file (backend/src/lib -> backend)
const BACKEND_ROOT = path.resolve(__dirname, "..", "..");

// DB lives at backend/aftermeta.db (sibling to package.json)
const DB_PATH = path.resolve(BACKEND_ROOT, "aftermeta.db");

// Default migration lives at backend/migrations/001_init.sql
const MIGRATIONS_DIR = path.resolve(BACKEND_ROOT, "migrations");
const MIGRATION_PATH = path.resolve(MIGRATIONS_DIR, "001_init.sql");

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------
function fileHash(buf: Buffer) {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

function readFileIfExists(p: string): Buffer | null {
  try {
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Open DB (create parent dir if needed), enforce pragmas *before* any writes
// -----------------------------------------------------------------------------
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

// Pragmas — keep these in this exact order.
db.pragma("journal_mode = WAL");       // durability without constant fsync
db.pragma("synchronous = NORMAL");     // good tradeoff for WAL
db.pragma("foreign_keys = ON");        // DO NOT turn this off
db.pragma("busy_timeout = 5000");      // basic backoff under write contention

// Loud boot logs so you stop guessing which file/flags are in play
console.log(
  `[DB] OPEN: ${DB_PATH} | foreign_keys=${db.pragma("foreign_keys", { simple: true })}`
);
console.log(`[DB] migrations dir: ${MIGRATIONS_DIR}`);
console.log(`[DB] PRAGMA journal_mode = ${(db.pragma("journal_mode", { simple: true }) as any)}`);
console.log(`[DB] PRAGMA foreign_keys = ${db.pragma("foreign_keys", { simple: true })}`);

// -----------------------------------------------------------------------------
// Minimal migration runner
//
// Strategy:
// - If 001_init.sql exists, run it idempotently (should use CREATE TABLE IF NOT EXISTS,
//   CREATE INDEX IF NOT EXISTS, etc.). We wrap in a transaction.
// - We store a hash signature in a tiny local table so we don't spam logs.
// -----------------------------------------------------------------------------
export function migrate(): void {
  const initSql = readFileIfExists(MIGRATION_PATH);
  if (!initSql) {
    console.warn(`[DB] No migration file found at ${MIGRATION_PATH}. Skipping migrate().`);
    return;
  }

  // Ensure meta table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS __meta_migrations__ (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sha1 TEXT NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT (datetime('now')),
      UNIQUE(name, sha1)
    );
  `);

  const name = path.basename(MIGRATION_PATH);
  const sha1 = fileHash(initSql);

  const already = db
    .prepare(`SELECT 1 FROM __meta_migrations__ WHERE name = ? AND sha1 = ?`)
    .get(name, sha1) as any;

  if (already) {
    console.log(`[DB] migration ${name} (${sha1.slice(0, 8)}) already applied — idempotent re-run allowed.`);
  }

  const tx = db.transaction(() => {
    // Execute whole file in one go — 001_init.sql must be idempotent.
    db.exec(initSql.toString("utf8"));
    // Record (INSERT OR IGNORE to keep re-runs silent)
    db
      .prepare(
        `INSERT OR IGNORE INTO __meta_migrations__ (name, sha1) VALUES (?, ?)`
      )
      .run(name, sha1);
  });

  try {
    tx();
    console.log(`[DB] migration applied: ${name} (${sha1.slice(0, 8)})`);
  } catch (e: any) {
    console.error(`[DB] migration FAILED for ${name}: ${String(e?.message || e)}`);
    throw e;
  }

  // Sanity: assert FKs remain ON after migration (some bad files flip pragmas)
  const fk = db.pragma("foreign_keys", { simple: true }) as number;
  if (fk !== 1) {
    console.warn(`[DB] WARNING: foreign_keys flipped to ${fk}. Forcing back to ON.`);
    db.pragma("foreign_keys = ON");
    console.log(`[DB] PRAGMA foreign_keys = ${db.pragma("foreign_keys", { simple: true })}`);
  }

  ensureMintForeignKey();
  normalizeMintTxids();
  ensureSchemaIndexes();
}

function ensureMintForeignKey() {
  const fkInfo = db.prepare(`PRAGMA foreign_key_list(mints)`).all() as Array<any>;
  const target = fkInfo.find((row) => String(row?.table || "").toLowerCase() === "pools");
  const onDelete = String(target?.on_delete || target?.onDelete || "").toUpperCase();
  const onUpdate = String(target?.on_update || target?.onUpdate || "").toUpperCase();
  const needsRebuild = !target || onDelete !== "RESTRICT" || onUpdate !== "CASCADE";

  if (!needsRebuild) {
    return;
  }

  const fkState = db.pragma("foreign_keys", { simple: true }) as number;
  try {
    if (fkState !== 0) {
      db.pragma("foreign_keys = OFF");
    }

    const tx = db.transaction(() => {
      const tempName = "mints__rebuild__day11";
      db.exec(`ALTER TABLE mints RENAME TO ${tempName};`);
      db.exec(`
        CREATE TABLE mints (
          id TEXT PRIMARY KEY,
          pool_id TEXT NOT NULL REFERENCES pools(id) ON UPDATE CASCADE ON DELETE RESTRICT,
          symbol TEXT NOT NULL,
          account TEXT NOT NULL,
          spend_sats INTEGER NOT NULL,
          tokens INTEGER NOT NULL,
          txid TEXT NOT NULL UNIQUE,
          confirmed INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT (datetime('now'))
        );
      `);
      db.exec(`
        INSERT INTO mints (id, pool_id, symbol, account, spend_sats, tokens, txid, confirmed, created_at)
        SELECT id, pool_id, symbol, account, spend_sats, tokens, txid, confirmed, created_at FROM ${tempName};
      `);
      db.exec(`DROP TABLE ${tempName};`);
    });

    tx();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function ensureSchemaIndexes() {
  db.exec(`
    DROP INDEX IF EXISTS idx_mints_txid;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mints_txid_ci ON mints(txid COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_mints_pool_id ON mints(pool_id);
    CREATE INDEX IF NOT EXISTS idx_mints_confirmed ON mints(confirmed, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pools_symbol_uc ON pools(UPPER(symbol));
  `);
}

function normalizeMintTxids() {
  const rows = db
    .prepare(`SELECT id, txid, created_at FROM mints WHERE txid IS NOT NULL`)
    .all() as Array<{ id: string; txid: string; created_at: string }>; 
  if (!rows.length) {
    console.log(`[DB] lowercased txids: 0; dups fixed: 0`);
    return;
  }

  const tx = db.transaction(() => {
    const byNorm = new Map<string, Array<{ id: string; txid: string; created_at: string }>>();
    for (const row of rows) {
      const norm = String(row.txid || "").toLowerCase();
      if (!byNorm.has(norm)) byNorm.set(norm, []);
      byNorm.get(norm)!.push(row);
    }

    let dupsFixed = 0;
    const updateTxid = db.prepare(`UPDATE mints SET txid = ? WHERE id = ?`);

    for (const group of byNorm.values()) {
      if (group.length <= 1) continue;
      group.sort((a, b) => {
        const aTs = Date.parse(a.created_at ?? "");
        const bTs = Date.parse(b.created_at ?? "");
        if (Number.isFinite(bTs) && Number.isFinite(aTs) && bTs !== aTs) {
          return bTs - aTs;
        }
        return b.id.localeCompare(a.id);
      });
      const rest = group.slice(1);
      for (const row of rest) {
        const suffix = String(row.id || "").slice(0, 6) || crypto.randomBytes(3).toString("hex");
        const newTxid = `${row.txid}${suffix ? `dup${suffix}` : "dup"}`;
        updateTxid.run(newTxid, row.id);
        dupsFixed += 1;
        console.log(`[DB] duplicate txid normalized id=${row.id} old=${row.txid} new=${newTxid}`);
      }
    }

    const lowerResult = db.prepare(`UPDATE mints SET txid = LOWER(txid) WHERE txid GLOB '[A-F]'`).run();
    console.log(`[DB] lowercased txids: ${lowerResult.changes}; dups fixed: ${dupsFixed}`);
  });

  try {
    tx();
  } catch (err: any) {
    throw new Error(`mint_txid_normalize_failed: ${String(err?.message || err)}`);
  }
}

// -----------------------------------------------------------------------------
// Optional: quick integrity check helpers for debugging (call where useful)
// -----------------------------------------------------------------------------
export function fkCheck(): Array<{ table: string; rowid: number; parent: string; fkid: number }> {
  // When FKs are violated, SQLite returns rows; otherwise, it's empty.
  // Do NOT call this on hot paths.
  try {
    const rows = db.prepare(`PRAGMA foreign_key_check;`).all() as any[];
    return rows.map((r) => ({
      table: r.table,
      rowid: Number(r.rowid),
      parent: r.parent,
      fkid: Number(r.fkid),
    }));
  } catch {
    return [];
  }
}

export function schemaSummary(): {
  tables: Array<{ name: string }>;
  pragma: { foreign_keys: number; journal_mode: string };
} {
  const tables = db.prepare(
    `SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  ).all() as Array<{ name: string }>;
  const foreign_keys = db.pragma("foreign_keys", { simple: true }) as number;
  const journal_mode = db.pragma("journal_mode", { simple: true }) as any;
  return { tables, pragma: { foreign_keys, journal_mode } };
}


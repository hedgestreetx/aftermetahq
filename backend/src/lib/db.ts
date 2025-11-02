// backend/src/lib/db.ts
import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Project root: backend = two levels up from this file (backend/src/lib -> backend)
const BACKEND_ROOT = path.resolve(__dirname, '..', '..')

// DB lives at backend/aftermeta.db (sibling to package.json)
const DB_PATH = path.resolve(BACKEND_ROOT, 'aftermeta.db')
// Migrations folder: backend/migrations/*.sql (001_init.sql, 002_whatever.sql, …)
const MIGRATIONS_DIR = path.resolve(BACKEND_ROOT, 'migrations')

// Ensure parent dir exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

// Open DB
export const db = new Database(DB_PATH)

// 🔒 Pragmas — do this before any queries
db.pragma('journal_mode = WAL')       // better concurrency + crash safety
db.pragma('synchronous = NORMAL')     // good balance for dev
db.pragma('foreign_keys = ON')        // ENFORCE FK or your data will rot

// Simple logging so you stop inspecting the wrong file
console.log(`[DB] using file: ${DB_PATH}`)
console.log(`[DB] migrations dir: ${MIGRATIONS_DIR}`)

// Schema migrations runner ----------------------------------------------------
function listMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return []
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(f => f.toLowerCase().endsWith('.sql'))
    .sort() // rely on 001_, 002_… order
}

function ensureMigrationsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT UNIQUE NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `)
}

function appliedMigrationsSet(): Set<string> {
  ensureMigrationsTable()
  const rows = db.prepare(`SELECT filename FROM schema_migrations ORDER BY id`).all() as Array<{filename:string}>
  return new Set(rows.map(r => r.filename))
}

function applyMigrationFile(filename: string) {
  const full = path.join(MIGRATIONS_DIR, filename)
  const sql = fs.readFileSync(full, 'utf8')
  // Run whole file in a transaction — it either applies or it doesn’t
  const txn = db.transaction(() => {
    db.exec(sql)
    db.prepare(
      `INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)`
    ).run(filename, Date.now())
  })
  txn()
  console.log(`[DB] migrated: ${filename}`)
}

export function migrate() {
  const files = listMigrationFiles()
  if (files.length === 0) {
    console.warn('[DB] No migrations found. Bootstrapping minimal schema (dev-only).')
    bootstrapMinimalSchema()
    return
  }
  const applied = appliedMigrationsSet()
  for (const f of files) {
    if (!applied.has(f)) applyMigrationFile(f)
  }
}

// Minimal fallback schema (used only if you have no migrations yet) ----------
function bootstrapMinimalSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pools (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      creator TEXT NOT NULL,
      pool_address TEXT NOT NULL,
      locking_script_hex TEXT,
      max_supply INTEGER DEFAULT 0,
      decimals INTEGER DEFAULT 0,
      creator_reserve INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mint_tx (
      txid TEXT PRIMARY KEY,
      pool_id TEXT NOT NULL REFERENCES pools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
      symbol TEXT,
      sats INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      confirmed_at INTEGER,
      last_check_at INTEGER,
      next_check_at INTEGER,
      check_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS buy_tx (
      txid TEXT PRIMARY KEY,
      pool_id TEXT NOT NULL REFERENCES pools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
      symbol TEXT,
      spend_sats INTEGER NOT NULL,
      filled_tokens INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      confirmed_at INTEGER,
      last_check_at INTEGER,
      next_check_at INTEGER,
      check_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pool_supply (
      pool_id TEXT PRIMARY KEY REFERENCES pools(id) ON DELETE CASCADE,
      minted_supply INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_mint_tx_created_at ON mint_tx(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mint_tx_pool_id    ON mint_tx(pool_id);
    CREATE INDEX IF NOT EXISTS idx_buy_tx_created_at  ON buy_tx(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_buy_tx_pool_id     ON buy_tx(pool_id);
  `)
}

// Introspection for /debug/dbinfo -------------------------------------------
export function dbInfo() {
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as Array<{name:string}>

  const pragmaFK = db.pragma('foreign_keys', { simple: true }) as unknown as Array<{ foreign_keys: number }>
  const fkOn = Array.isArray(pragmaFK) ? (pragmaFK[0]?.foreign_keys === 1) : true

  const counts: Record<string, number> = {}
  for (const t of tables) {
    try {
      const c = db.prepare(`SELECT COUNT(1) AS c FROM ${t.name}`).get() as any
      counts[t.name] = Number(c?.c || 0)
    } catch {
      counts[t.name] = -1
    }
  }

  return {
    path: DB_PATH,
    tables: tables.map(t => t.name),
    counts,
    foreignKeys: fkOn,
  }
}

// Kick migrations at module import (safe for dev, idempotent)
try {
  migrate()
} catch (e) {
  console.error('[DB] migration error:', e)
  throw e
}

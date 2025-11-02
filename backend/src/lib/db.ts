// backend/src/lib/db.ts (ESM)
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";

// ESM-safe replacements for __dirname / __filename
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ---------- Stable DB path (stop using process.cwd) ----------
const BACKEND_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_DB = path.resolve(BACKEND_ROOT, "aftermeta.db");
const DB_FILE = (process.env.DB_FILE && process.env.DB_FILE.trim()) || DEFAULT_DB;


fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

export const db = new Database(DB_FILE);

// Fast, safe defaults
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

// ---------- Base schema (idempotent) ----------
db.exec(`
CREATE TABLE IF NOT EXISTS pools (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  creator TEXT,
  pool_address TEXT,
  locking_script_hex TEXT,
  max_supply INTEGER,
  decimals INTEGER,
  creator_reserve INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pools_symbol ON pools(symbol);

CREATE TABLE IF NOT EXISTS pool_supply (
  pool_id TEXT PRIMARY KEY,
  minted_supply INTEGER NOT NULL DEFAULT 0
);

/* Keep your existing columns for mint_tx, we'll add verify columns below */
CREATE TABLE IF NOT EXISTS mint_tx (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txid TEXT NOT NULL UNIQUE,
  pool_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  sats INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mint_tx_created_at ON mint_tx(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mint_tx_pool ON mint_tx(pool_id);

/* Keep your existing buy_tx columns; we'll add verify columns below */
CREATE TABLE IF NOT EXISTS buy_tx (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txid TEXT NOT NULL UNIQUE,
  pool_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  spend_sats INTEGER NOT NULL,
  filled_tokens INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_buy_tx_created_at ON buy_tx(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_buy_tx_pool ON buy_tx(pool_id);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pool_id TEXT NOT NULL,
  amount_sats INTEGER NOT NULL,
  to_address TEXT NOT NULL,
  status TEXT NOT NULL, -- PENDING | SENT | FAILED
  reason TEXT,
  created_at INTEGER NOT NULL,
  sent_txid TEXT,
  sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_pool ON withdrawals(pool_id);
`);

// ---------- Ensure verify columns exist (works on old SQLite) ----------
function ensureColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name:string}>;
  if (!cols.some(c => c.name === column)) {
    console.warn(`[DB] add ${table}.${column}`);
    db.exec(ddl);
  }
}

// mint_tx verify columns
ensureColumn("mint_tx", "last_check_at",  "ALTER TABLE mint_tx ADD COLUMN last_check_at INTEGER;");
ensureColumn("mint_tx", "next_check_at",  "ALTER TABLE mint_tx ADD COLUMN next_check_at INTEGER;");
ensureColumn("mint_tx", "check_count",    "ALTER TABLE mint_tx ADD COLUMN check_count INTEGER NOT NULL DEFAULT 0;");
// confirmed_at already exists in your base create; if not, this would add it:
// ensureColumn("mint_tx", "confirmed_at",  "ALTER TABLE mint_tx ADD COLUMN confirmed_at INTEGER;");

// buy_tx verify columns
ensureColumn("buy_tx",  "last_check_at",  "ALTER TABLE buy_tx ADD COLUMN last_check_at INTEGER;");
ensureColumn("buy_tx",  "next_check_at",  "ALTER TABLE buy_tx ADD COLUMN next_check_at INTEGER;");
ensureColumn("buy_tx",  "check_count",    "ALTER TABLE buy_tx ADD COLUMN check_count INTEGER NOT NULL DEFAULT 0;");
ensureColumn("buy_tx",  "confirmed_at",   "ALTER TABLE buy_tx ADD COLUMN confirmed_at INTEGER;");

// Helpful indexes for verifier queries
db.exec(`
CREATE INDEX IF NOT EXISTS idx_mint_tx_pending ON mint_tx(next_check_at, confirmed_at);
CREATE INDEX IF NOT EXISTS idx_buy_tx_pending  ON buy_tx(next_check_at, confirmed_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_buy_tx_txid ON buy_tx(txid);
`);

// ---- Introspection helper (used by /debug/dbinfo) ----
export function dbInfo() {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as Array<{ name: string }>;
  return { file: DB_FILE, tables: tables.map(t => t.name) };
}

// Loud and clear on boot
console.log(`[DB] file => ${DB_FILE}`);
console.log(`[DB] tables => ${dbInfo().tables.join(", ") || "(none)"}`);

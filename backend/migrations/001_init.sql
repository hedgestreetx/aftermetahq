PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  result TEXT,
  created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chain_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txid TEXT NOT NULL,
  block_hash TEXT,
  block_height INTEGER,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  observed_at DATETIME NOT NULL DEFAULT (datetime('now')),
  UNIQUE(txid, event_type)
);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pool_id TEXT NOT NULL,
  account TEXT NOT NULL,
  asset TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  chain_event_id INTEGER REFERENCES chain_events(id),
  created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pools (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  creator TEXT NOT NULL,
  pool_address TEXT NOT NULL,
  locking_script_hex TEXT NOT NULL,
  max_supply INTEGER NOT NULL,
  decimals INTEGER NOT NULL,
  creator_reserve INTEGER NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pool_supply (
  pool_id TEXT PRIMARY KEY REFERENCES pools(id) ON UPDATE CASCADE ON DELETE CASCADE,
  minted_supply INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mints (
  id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES pools(id) ON UPDATE CASCADE ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  account TEXT NOT NULL,
  spend_sats INTEGER NOT NULL,
  tokens INTEGER NOT NULL,
  txid TEXT NOT NULL UNIQUE,
  confirmed INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mints_pool ON mints(pool_id);
CREATE INDEX IF NOT EXISTS idx_mints_symbol ON mints(symbol COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_mints_confirmed ON mints(confirmed);

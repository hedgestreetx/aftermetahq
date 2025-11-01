import Database from 'better-sqlite3'

export const db = new Database('./aftermeta.db')

// initialize tables
db.exec(`
CREATE TABLE IF NOT EXISTS pools (
  id TEXT PRIMARY KEY,
  symbol TEXT,
  creator TEXT,
  poolAddress TEXT,
  lockingScriptHex TEXT,
  createdAt TEXT
);
`)

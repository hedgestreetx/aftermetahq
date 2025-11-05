import fs from "fs";
import path from "path";

import Database from "better-sqlite3";

import { getEnv, refreshEnv } from "./env";

type GlobalDbState = {
  __aftermetaDbConnection?: Database | null;
};

const globalDbState = globalThis as typeof globalThis & GlobalDbState;

function openConnection(): Database {
  const env = getEnv();
  const dbPath = env.DB_PATH;

  if (!dbPath.startsWith(":memory:") && !dbPath.startsWith("file:")) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("busy_timeout = 5000");

  const pragmas = {
    journal_mode: db.pragma("journal_mode", { simple: true }) as string,
    foreign_keys: db.pragma("foreign_keys", { simple: true }) as number,
  };

  console.log(
    `[DB] open path=${path.isAbsolute(dbPath) ? dbPath : path.resolve(dbPath)} journal_mode=${pragmas.journal_mode} foreign_keys=${pragmas.foreign_keys}`
  );

  return db;
}

export function getDb(): Database {
  const existing = globalDbState.__aftermetaDbConnection;
  if (existing) {
    if (!(existing as Database & { open?: boolean }).open) {
      throw new Error("database_closed");
    }
    return existing;
  }

  const db = openConnection();
  globalDbState.__aftermetaDbConnection = db;
  return db;
}

export function resetDbForTests() {
  const existing = globalDbState.__aftermetaDbConnection;
  if (existing) {
    try {
      existing.close();
    } catch {
      // ignore
    }
  }
  globalDbState.__aftermetaDbConnection = null;
  refreshEnv();
}

export type DatabaseConnection = Database;

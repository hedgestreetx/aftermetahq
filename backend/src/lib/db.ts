// backend/src/lib/db.ts
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// backend root = two levels up from this file (backend/src/lib -> backend)
const BACKEND_ROOT = path.resolve(__dirname, "..", "..");

// DB lives at backend/aftermeta.db (sibling to package.json)
const DB_PATH = path.resolve(BACKEND_ROOT, "aftermeta.db");
// Migration file at backend/migrations/001_init.sql
const MIGRATION_PATH = path.resolve(BACKEND_ROOT, "migrations", "001_init.sql");

// DEBUG: print resolved paths so we know what you're actually hitting
console.log(`[DB] using file: ${DB_PATH}`);
console.log(`[DB] using migration: ${MIGRATION_PATH}`);

// Ensure parent dir exists (paranoia)
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

export function migrate() {
  if (!fs.existsSync(MIGRATION_PATH)) {
    throw new Error(`Migration file missing: ${MIGRATION_PATH}`);
  }
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  db.exec(sql);
}
migrate();

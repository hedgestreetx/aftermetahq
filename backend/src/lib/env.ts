import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import dotenv from "dotenv";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "..", "..");

const ENV_PATHS = [
  path.resolve(projectRoot, "backend/.env"),
  path.resolve(projectRoot, ".env"),
];

for (const candidate of ENV_PATHS) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

type Network = "mainnet" | "testnet" | "stn";

type EnvConfig = {
  NODE_ENV: string;
  NETWORK: Network;
  PORT: number;
  DB_PATH: string;
  WOC_API_KEY?: string;
  WOC_BASE?: string;
  CORS_ORIGINS: string[];
};

function normalizeNetwork(value?: string | null): Network {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "testnet";
  if (raw === "livenet" || raw.startsWith("main")) return "mainnet";
  if (raw === "stn" || raw === "scale" || raw === "scalenet") return "stn";
  if (raw === "test" || raw === "testnet") return "testnet";
  return "testnet";
}

function resolveDbPath(value?: string | null): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return path.resolve(projectRoot, "aftermeta.db");
  }
  if (raw === ":memory:" || raw.startsWith("file:")) {
    return raw;
  }
  if (path.isAbsolute(raw)) {
    return raw;
  }
  return path.resolve(projectRoot, raw);
}

function parseCorsOrigins(value?: string | null): string[] {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:4173",
      "http://127.0.0.1:4173",
    ];
  }
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function getEnv(): EnvConfig {
  return {
    NODE_ENV: String(process.env.NODE_ENV ?? "development"),
    NETWORK: normalizeNetwork(process.env.NETWORK),
    PORT: Number.parseInt(String(process.env.PORT ?? "3000"), 10) || 3000,
    DB_PATH: resolveDbPath(process.env.DB_PATH ?? process.env.AFTERMETA_DB_PATH),
    WOC_API_KEY: String(process.env.WOC_API_KEY ?? "").trim() || undefined,
    WOC_BASE: String(process.env.WOC_BASE ?? "").trim() || undefined,
    CORS_ORIGINS: parseCorsOrigins(process.env.CORS_ORIGINS),
  };
}

export function refreshEnv(): EnvConfig {
  return getEnv();
}

export type NormalizedNetwork = ReturnType<typeof getEnv>["NETWORK"];

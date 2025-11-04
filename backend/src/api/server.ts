// backend/src/api/server.ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import crypto from "crypto";

import { ENV } from "../lib/env";
import apiRoutes from "./routes";
import mintRouter from "./mintTestnet";

// ✅ Ensure database is opened and migrations are applied exactly once on boot
import { db, migrate } from "../lib/db";
migrate();
const NET_WOC = ENV.NETWORK === "mainnet" || ENV.NETWORK === "livenet" ? "main" : "test";
console.log(`[NET] network=${ENV.NETWORK} NET_WOC=${NET_WOC}`);

// ----------------------------- App & Middleware -----------------------------
const app = express();

app.set("trust proxy", 1);

app.use(
  cors({
    origin: (origin, cb) => {
      const allow = (process.env.CORS_ORIGINS || "http://localhost:5173")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!origin) return cb(null, true); // curl/postman
      cb(null, allow.includes(origin));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Request-Id"],
    credentials: false,
    maxAge: 86400,
  })
);

app.use(express.json({ limit: "1mb" }));

// Basic request-id so your logs are traceable
app.use((req: Request, _res: Response, next: NextFunction) => {
  (req as any).requestId =
    (req.headers["x-request-id"] as string) ||
    (req.headers["x-requestid"] as string) ||
    crypto.randomUUID();
  next();
});

// ----------------------------- Health -----------------------------
function healthPayload() {
  return { service: "aftermeta-backend", network: ENV.NETWORK, port: ENV.PORT };
}
app.get("/health", (_req, res) => res.json(healthPayload()));
app.get("/api/health", (_req, res) => res.json(healthPayload()));



import { startWocSocket } from "../lib/woc";

// ----------------------------- Boot -----------------------------
const PORT = Number(ENV.PORT || 3000);
app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
  startWocSocket();
});

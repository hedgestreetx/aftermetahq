// backend/src/api/server.ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import crypto from "crypto";

import { ENV } from "../lib/env";
import apiRoutes from "./routes";
import mintRouter from "./mintTestnet";

// ✅ Ensure database is opened and migrations are applied exactly once on boot
import { migrate } from "../lib/db";
migrate();
console.log(`[ENV] network=${ENV.NETWORK}`);

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

// ----------------------------- TX Watcher (WOC) -----------------------------
const WOC_NET =
  ENV.NETWORK === "mainnet" || ENV.NETWORK === "livenet" ? "main" : "test";

type TxState = {
  txid: string;
  confirmed: boolean;
  confs: number;
  nextCheckAt: number;
  attempts: number;
  error?: string;
};

const txCache = new Map<string, TxState>();
const BACKOFF_STEPS_SEC = [5, 15, 30, 60, 120, 300, 600];

function nextDelayMs(attempts: number) {
  const idx = Math.min(attempts, BACKOFF_STEPS_SEC.length - 1);
  return BACKOFF_STEPS_SEC[idx] * 1000;
}

async function queryStatus(txid: string): Promise<{ confirmed: boolean; confs: number }> {
  const url = `https://api.whatsonchain.com/v1/bsv/${WOC_NET}/tx/${txid}/status`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`WOC status ${r.status}`);
  const j: any = await r.json();
  const confirmed = !!(j.confirmed ?? j.isConfirmed ?? false);
  const confs = Number(j.confirmations ?? j.confs ?? (confirmed ? 1 : 0));
  return { confirmed, confs: Number.isFinite(confs) ? confs : confirmed ? 1 : 0 };
}

setInterval(async () => {
  const now = Date.now();
  for (const s of txCache.values()) {
    if (s.confirmed || s.nextCheckAt > now) continue;
    try {
      const { confirmed, confs } = await queryStatus(s.txid);
      s.error = undefined;
      s.attempts++;
      s.confirmed = confirmed;
      s.confs = confs;
      s.nextCheckAt = confirmed ? Number.POSITIVE_INFINITY : now + nextDelayMs(s.attempts);
    } catch (e: any) {
      s.error = String(e?.message || e);
      s.attempts++;
      s.nextCheckAt = now + nextDelayMs(s.attempts);
    }
  }
}, 5000);

const txRouter = express.Router();
txRouter.post("/tx/watch", (req, res) => {
  const txid = String(req.body?.txid || "").trim();
  if (!/^[0-9a-f]{64}$/i.test(txid)) {
    return res.status(400).json({ ok: false, error: "invalid txid" });
  }
  if (!txCache.has(txid)) {
    txCache.set(txid, {
      txid,
      confirmed: false,
      confs: 0,
      nextCheckAt: Date.now(),
      attempts: 0,
    });
  }
  res.json({ ok: true });
});
txRouter.get("/tx/:txid/status", (req, res) => {
  const txid = String(req.params.txid || "").trim();
  const s = txCache.get(txid);
  if (!s) return res.status(404).json({ ok: false, error: "unknown txid" });
  res.json({
    ok: true,
    txid: s.txid,
    confirmed: s.confirmed,
    confs: s.confs,
    nextCheckAt: s.nextCheckAt,
    attempts: s.attempts,
    error: s.error ?? null,
  });
});

// Mount watcher at both /api and /
app.use("/api", txRouter);
app.use("/", txRouter);

// ----------------------------- Routers -----------------------------
// Mount at root and /api so /v1/* and /api/v1/* both work.
app.use(apiRoutes);
app.use("/api", apiRoutes);

app.use(mintRouter);
app.use("/api", mintRouter);

// ----------------------------- API 404s -----------------------------
app.use("/api", (_req, res) => res.status(404).json({ ok: false, error: "not_found" }));
app.use((_req, res) => res.status(404).type("text/plain").send("Not Found"));

// ----------------------------- Error Handler -----------------------------
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const code = Number(err?.status || err?.statusCode || 500);
  const msg = String(err?.message || "internal_error");
  res.status(code).json({ ok: false, error: msg });
});

// ----------------------------- Boot -----------------------------
const PORT = Number(ENV.PORT || 3000);
app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
});

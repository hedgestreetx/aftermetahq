// backend/src/api/server.ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import crypto from "crypto";

import { ENV } from "../lib/env";
import apiRoutes from "./routes";
import mintRouter from "./mintTestnet";

// ✅ Ensure database is opened and migrations are applied exactly once on boot
import { migrate } from "../lib/db";
import { NET_WOC } from "../lib/woc";
import { verifyPendingMints } from "../lib/mintVerifier";

migrate();
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

// ----------------------------- Verify Interval -----------------------------
if (ENV.VERIFY_INTERVAL_MS > 0) {
  const interval = Math.max(ENV.VERIFY_INTERVAL_MS, 1000);
  console.log(`[VERIFY] interval enabled ms=${interval}`);
  setInterval(async () => {
    try {
      await verifyPendingMints(100);
    } catch (err: any) {
      console.error(`[VERIFY] interval_error ${String(err?.message || err)}`);
    }
  }, interval);
}

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

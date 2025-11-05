// backend/src/api/server.ts
import express, { json as expressJson, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import crypto from "crypto";

import { ENV } from "../lib/env";
import apiRoutes from "./routes";
import mintRouter from "./mintTestnet";
import { startWocSocket } from "../lib/woc";
// CHANGE THIS PATH to where your migrate function is exported from
// for example "../lib/db" or "../db/migrate"
import { migrate } from "../lib/db";

// ensure database is opened and migrations are applied exactly once on boot
migrate();

const NET_WOC = ENV.NETWORK === "mainnet" || ENV.NETWORK === "livenet" ? "main" : "test";
console.log(`[NET] network=${ENV.NETWORK} NET_WOC=${NET_WOC}`);

// app and middleware
const app = express();

app.set("trust proxy", 1);

const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

const configuredOrigins = (process.env.CORS_ORIGINS || DEFAULT_CORS_ORIGINS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const normalizeOrigin = (value: string) => {
  try {
    const url = new URL(value);
    return url.origin.replace(/\/+$/, "");
  } catch {
    return value.replace(/\/+$/, "");
  }
};

const allowedOrigins = new Set(configuredOrigins.map(normalizeOrigin));
const allowAllOrigins = allowedOrigins.has("*");

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowAllOrigins) return cb(null, true);
      const normalized = normalizeOrigin(origin);
      cb(null, allowedOrigins.has(normalized));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Request-Id"],
    credentials: false,
    maxAge: 86400,
  })
);

app.use(expressJson({ limit: "1mb" }));

app.use((req: Request, _res: Response, next: NextFunction) => {
  (req as any).requestId =
    (req.headers["x-request-id"] as string) ||
    (req.headers["x-requestid"] as string) ||
    crypto.randomUUID();
  next();
});

// health
function healthPayload() {
  return { service: "aftermeta-backend", network: ENV.NETWORK, port: ENV.PORT };
}

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, ...healthPayload() });
});

app.get("/api/health", (_req, res) => {
  res.status(200).json({ ok: true, ...healthPayload() });
});

// routers
app.use(apiRoutes);
app.use("/api", apiRoutes);

app.use(mintRouter);
app.use("/api", mintRouter);

// api 404s
app.use("/api", (_req, res) => res.status(404).json({ ok: false, error: "not_found" }));
app.use((_req, res) => res.status(404).type("text/plain").send("Not Found"));

// error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const code = Number(err?.status || err?.statusCode || 500);
  const msg = String(err?.message || "internal_error");
  res.status(code).json({ ok: false, error: msg });
});

async function bootstrap() {
  startWocSocket();

  const port = Number.isFinite(ENV.PORT) && ENV.PORT > 0 ? ENV.PORT : 3000;

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const listener = app.listen(port, () => {
      console.log(`[API] listening on http://localhost:${port}`);
      resolve(listener);
    });
    listener.on("error", (err) => reject(err));
  });

  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.once(signal, () => {
      console.log(`[API] received ${signal}, shutting down`);
      server.close((err) => {
        if (err) {
          console.error(`[API] error closing HTTP server`, err);
          process.exit(1);
        } else {
          process.exit(0);
        }
      });
    });
  }
}

try {
  await bootstrap();
} catch (err: any) {
  console.error(`[API] bootstrap failed: ${String(err?.message || err)}`);
  process.exit(1);
}

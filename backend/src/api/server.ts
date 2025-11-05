// backend/src/api/server.ts
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import crypto from "crypto";

import { ENV } from "../lib/env";
import { startWocSocket } from "../lib/woc";

async function ensureMigrations() {
  const dbModule = await import("../lib/db");
  const migrate = dbModule?.migrate;

  if (typeof migrate !== "function") {
    throw new Error("Database migrate() helper was not exported correctly");
  }

  await Promise.resolve(migrate());
}

async function loadExpress() {
  try {
    return await import("express");
  } catch (error: any) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      console.error(
        "❌ The 'express' dependency is missing. Run `npm install` in the backend directory before starting the server."
      );
    }

    throw error;
  }
}

async function bootstrap() {
  await ensureMigrations();

  const expressModule: typeof import("express") = await loadExpress();
  const createExpressApp = expressModule.default;
  const expressJson: typeof import("express").json = (() => {
    const jsonFn = expressModule.json ?? createExpressApp.json;
    if (typeof jsonFn === "function") return jsonFn.bind(createExpressApp);

    throw new Error("Express JSON body parser could not be loaded");
  })();

  const NET_WOC = ENV.NETWORK === "mainnet" || ENV.NETWORK === "livenet" ? "main" : "test";
  console.log(`[NET] network=${ENV.NETWORK} NET_WOC=${NET_WOC}`);

  // ----------------------------- App & Middleware -----------------------------
  const app = createExpressApp();

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
        if (!origin || allowAllOrigins) return cb(null, true); // curl/postman or wildcard config
        const normalized = normalizeOrigin(origin);
        cb(null, allowedOrigins.has(normalized));
      },
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "X-Request-Id", "Idempotency-Key"],
      credentials: false,
      maxAge: 86400,
    })
  );

  app.use(expressJson({ limit: "1mb" }));

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

  const [{ default: apiRoutes }, { default: mintRouter }] = await Promise.all([
    import("./routes/index.js").then((m) => m as typeof import("./routes")),
    import("./mintTestnet.js").then((m) => m as typeof import("./mintTestnet")),
  ]);

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
    startWocSocket();
  });
}

await bootstrap();

import cors from "cors";
import crypto from "crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { pathToFileURL } from "url";

import { getEnv } from "../lib/env";
import { migrate } from "../lib/migrate";
import { startMintConfirmationPoller } from "../lib/mintConfirmationPoller";
import routes from "./routes";
import { getDb } from "../lib/db";

function normalizeOrigin(value: string): string {
  try {
    const url = new URL(value);
    return url.origin.replace(/\/+$/, "");
  } catch {
    return value.replace(/\/+$/, "");
  }
}

function buildCorsConfig() {
  const env = getEnv();
  const allowed = new Set(env.CORS_ORIGINS.map(normalizeOrigin));
  const allowAll = allowed.has("*");

  return {
    origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      if (!origin) {
        return callback(null, true);
      }
      if (allowAll) {
        return callback(null, true);
      }
      const normalized = normalizeOrigin(origin);
      callback(null, allowed.has(normalized));
    },
    credentials: false,
  } satisfies Parameters<typeof cors>[0];
}

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);

  app.use(cors(buildCorsConfig()));
  app.use(express.json({ limit: "1mb" }));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { id?: string }).id =
      (req.headers["x-request-id"] as string) ||
      (req.headers["x-requestid"] as string) ||
      crypto.randomUUID();
    next();
  });

  app.get("/health", (_req, res) => {
    try {
      const env = getEnv();
      const db = getDb();
      if (!(db as typeof db & { open?: boolean }).open) {
        throw new Error("database_closed");
      }
      db.prepare("SELECT 1 as ok").get();
      res.json({ ok: true, network: env.NETWORK, db: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const env = getEnv();
      res.status(500).json({ ok: false, network: env.NETWORK, db: false, error: message });
    }
  });

  app.use("/api", routes);

  app.use("/api", (_req, res) => {
    res.status(404).json({ ok: false, error: "not_found" });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = typeof (err as any)?.status === "number" ? (err as any).status : 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ ok: false, error: message });
  });

  return app;
}

export async function startServer() {
  migrate();
  startMintConfirmationPoller();

  const app = createApp();
  const env = getEnv();
  const port = Number.isFinite(env.PORT) && env.PORT > 0 ? env.PORT : 3000;

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`[API] listening on port ${port}`);
      resolve();
    });
    server.on("error", (err) => reject(err));
  });
}

export function resetServerStateForTests() {
  // no-op placeholder for compatibility with tests
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  startServer().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[API] failed to start: ${message}`);
    process.exit(1);
  });
}

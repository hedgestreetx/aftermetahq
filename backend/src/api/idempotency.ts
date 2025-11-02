import type { Request, Response, NextFunction } from "express";
import { db } from "../lib/db";

export function idempotency() {
  return (req: Request, res: Response, next: NextFunction) => {
    const headerId = (req.header("x-request-id") || "").trim();
    const generatedId = (req as any).requestId as string | undefined;
    const requestId = headerId || generatedId || "";

    if (!requestId) {
      return res.status(400).json({ ok: false, error: "Missing X-Request-Id" });
    }

    const row = db.prepare(`SELECT result FROM commands WHERE id=?`).get(requestId) as any;
    if (row?.result) {
      try { return res.json(JSON.parse(row.result)); } catch { return res.json(row.result); }
    }
    (res as any)._requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    next();
  };
}

export function persistResult(req: any, result: unknown, type: string, payload: unknown) {
  const requestId =
    (req?.headers?.["x-request-id"] as string | undefined) ||
    (req as any)?.requestId ||
    (req?.res as any)?._requestId;
  db.prepare(
    `INSERT OR REPLACE INTO commands(id, type, payload, result) VALUES (?, ?, ?, ?)`
  ).run(String(requestId), type, JSON.stringify(payload ?? {}), JSON.stringify(result ?? {}));
}

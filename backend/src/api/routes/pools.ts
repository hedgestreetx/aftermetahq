import { Router } from "express";
import { db } from "../../lib/db";
import { idempotency, persistResult } from "../idempotency";
import { rid } from "../../lib/ids";

const r = Router();

const nowMs = () => Date.now();

r.post("/", idempotency(), (req, res) => {
  const p = req.body ?? {};
  const hasAddr = typeof p?.poolAddress === "string" && p.poolAddress.trim().length > 0;
  const hasScript = typeof p?.lockingScriptHex === "string" && p.lockingScriptHex.trim().length > 0;
  if (!p?.symbol || !p?.creator || (!hasAddr && !hasScript)) {
    return res.status(400).json({ ok: false, error: "missing_fields" });
  }

  const id = p.id || rid();
  const createdAt = nowMs();
  const symbol = String(p.symbol || "").trim().toUpperCase();
  const creator = String(p.creator || "").trim();
  const poolAddress = hasAddr ? String(p.poolAddress).trim() : "";
  const lockingScriptHex = hasScript ? String(p.lockingScriptHex).trim() : "";

  db.prepare(
    `INSERT OR REPLACE INTO pools
     (id, symbol, creator, pool_address, locking_script_hex, max_supply, decimals, creator_reserve, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    symbol,
    creator,
    poolAddress,
    lockingScriptHex,
    Number(p.maxSupply ?? 0),
    Number(p.decimals ?? 0),
    Number(p.creatorReserve ?? 0),
    createdAt
  );

  db.prepare(`INSERT OR IGNORE INTO pool_supply(pool_id, minted_supply) VALUES(?, 0)`).run(id);

  const out = {
    ok: true,
    pool: {
      id,
      symbol,
      creator,
      poolAddress,
      lockingScriptHex,
      maxSupply: Number(p.maxSupply ?? 0),
      decimals: Number(p.decimals ?? 0),
      creatorReserve: Number(p.creatorReserve ?? 0),
      createdAt,
    },
    supply: { mintedSupply: 0 },
  };
  persistResult(req, out, "CREATE_POOL", p);
  res.json(out);
});

r.get("/:id", (req, res) => {
  const p = db.prepare(`SELECT * FROM pools WHERE id=?`).get(req.params.id) as any;
  if (!p) return res.status(404).json({ ok: false, error: "pool_not_found" });

  const mintedRow = db
    .prepare(`SELECT minted_supply AS minted FROM pool_supply WHERE pool_id=?`)
    .get(p.id) as any;
  const minted = Number(mintedRow?.minted || 0);
  const left = Math.max(0, (p.max_supply || 0) - minted);
  const percentMinted = p.max_supply ? (minted / p.max_supply) * 100 : 0;

  res.json({
    ok: true,
    pool: {
      id: p.id,
      symbol: p.symbol,
      creator: p.creator,
      poolAddress: p.pool_address,
      lockingScriptHex: p.locking_script_hex,
      maxSupply: p.max_supply,
      decimals: p.decimals,
      creatorReserve: p.creator_reserve,
      createdAt: p.created_at,
    },
    supply: { mintedSupply: minted, left, percentMinted },
  });
});

r.get("/", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, symbol, creator, pool_address, locking_script_hex,
              max_supply, decimals, creator_reserve, created_at
         FROM pools
     ORDER BY created_at DESC`
    )
    .all() as any[];

  const supplyStmt = db.prepare(
    `SELECT minted_supply AS minted FROM pool_supply WHERE pool_id=?`
  );
  res.json({
    ok: true,
    pools: rows.map((p) => {
      const s = supplyStmt.get(p.id) as any;
      return {
        id: p.id,
        symbol: p.symbol,
        creator: p.creator,
        poolAddress: p.pool_address,
        lockingScriptHex: p.locking_script_hex,
        maxSupply: p.max_supply,
        decimals: p.decimals,
        creatorReserve: p.creator_reserve,
        createdAt: p.created_at,
        supply: { mintedSupply: Number(s?.minted || 0) },
      };
    }),
  });
});

export default r;

import { db } from "./db";

export function appendLedger(
  poolId: string,
  account: string,
  asset: string,
  delta: number,
  reason: string,
  chainEventId?: number
) {
  const stmt = db.prepare(
    `INSERT INTO ledger(pool_id, account, asset, delta, reason, chain_event_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  stmt.run(poolId, account, asset, delta, reason, chainEventId ?? null);
}

export function refreshSupply(poolId: string, asset: string) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(delta),0) as minted
       FROM ledger WHERE pool_id=? AND asset=?`
  ).get(poolId, asset) as { minted: number };
  db.prepare(
    `INSERT INTO pool_supply(pool_id, minted_supply) VALUES(?, ?)
     ON CONFLICT(pool_id) DO UPDATE SET minted_supply=excluded.minted_supply`
  ).run(poolId, row.minted);
}

export function viewSupply(poolId: string) {
  const r = db.prepare(`SELECT minted_supply FROM pool_supply WHERE pool_id=?`).get(poolId) as any;
  return r?.minted_supply ?? 0;
}

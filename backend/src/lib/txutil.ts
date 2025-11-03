import { bsv } from "scrypt-ts";

export const DUST_SATS = 546;

export type MintUtxo = {
  tx_hash: string;
  tx_pos: number;
  value: number;
};

export function calcTokens(spendSats: number): number {
  if (!Number.isFinite(spendSats)) return 0;
  return Math.max(0, Math.floor(spendSats / 1000));
}

export function estimateFee(tx: bsv.Transaction, feePerKb: number): number {
  const feeRate = Number.isFinite(feePerKb) && feePerKb > 0 ? feePerKb : 0;
  if (!feeRate) {
    throw new Error("fee_estimation_failed");
  }

  let bytes: number | undefined;
  try {
    const estimator = (tx as any)._estimateSize;
    if (typeof estimator === "function") {
      const estimated = estimator.call(tx);
      if (Number.isFinite(estimated) && estimated > 0) {
        bytes = Number(estimated);
      }
    }
  } catch {
    // ignore and fallback to serialization below
  }

  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) {
    try {
      const raw = tx.serialize(true);
      bytes = raw.length / 2;
    } catch {
      bytes = undefined;
    }
  }

  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) {
    throw new Error("fee_estimation_failed");
  }

  return Math.ceil(bytes / 1000) * feeRate;
}

export function selectUtxos(
  utxos: MintUtxo[],
  targetSats: number,
  feePerKb: number,
  dustThreshold = DUST_SATS,
): {
  selected: MintUtxo[];
  total: number;
  fee: number;
  change: number;
} {
  const spend = Number.isFinite(targetSats) ? Number(targetSats) : 0;
  if (spend <= 0) {
    return { selected: [], total: 0, fee: 0, change: 0 };
  }

  const normalized = utxos
    .map((u) => ({ ...u, value: Number(u.value) || 0 }))
    .filter((u) => u.value > 0);

  const sorted = normalized.sort((a, b) => b.value - a.value);
  const selected: MintUtxo[] = [];
  let total = 0;
  let fee = 0;
  let change = -1;

  for (const utxo of sorted) {
    selected.push(utxo);
    total += utxo.value;

    const provisionalChange = total - spend;
    const outputsWithChange = provisionalChange > dustThreshold ? 2 : 1;
    const bytes = 10 + 148 * selected.length + 34 * outputsWithChange;
    fee = Math.ceil(bytes / 1000) * feePerKb;
    change = total - spend - fee;

    if (change >= 0) {
      if (change > 0 && change < dustThreshold) {
        const outputsNoChange = 1;
        const bytesNoChange = 10 + 148 * selected.length + 34 * outputsNoChange;
        const feeNoChange = Math.ceil(bytesNoChange / 1000) * feePerKb;
        const changeNoChange = total - spend - feeNoChange;
        if (changeNoChange >= 0) {
          return { selected, total, fee: feeNoChange, change: 0 };
        }
      } else {
        return { selected, total, fee, change: change > 0 ? change : 0 };
      }
    }
  }

  return { selected, total, fee, change };
}

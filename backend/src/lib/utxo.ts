import { DUST_SATS } from "./coin";

export type Utxo = {
  txid: string;
  vout: number;
  valueSats: number;
  scriptPubKey: string;
  confirmations: number;
};

export type SelectUtxosOptions = {
  outputsWithoutChange?: number;
  dustThreshold?: number;
  targetHeadroomFactor?: number;
};

export type SelectUtxosResult = {
  inputs: Utxo[];
  totalInputSats: number;
  feeSats: number;
  changeSats: number;
  changeIsDust: boolean;
  outputCount: number;
};

export function estimateFee(
  inputCount: number,
  outputCount: number,
  feeRateSatsPerByte: number,
): number {
  const inputs = Number.isFinite(inputCount) && inputCount > 0 ? Math.trunc(inputCount) : 0;
  const outputs = Number.isFinite(outputCount) && outputCount > 0 ? Math.trunc(outputCount) : 0;
  const rate = Number.isFinite(feeRateSatsPerByte) && feeRateSatsPerByte > 0 ? feeRateSatsPerByte : 0;

  if (inputs <= 0 || outputs <= 0 || rate <= 0) {
    return 0;
  }

  const bytes = 10 + inputs * 148 + outputs * 34 + 10; // safety buffer
  return Math.ceil(bytes * rate);
}

export function selectUtxos(
  utxos: Utxo[],
  targetAmountSats: number,
  feeRateSatsPerByte: number,
  options: SelectUtxosOptions = {},
): SelectUtxosResult {
  const spend = Number.isFinite(targetAmountSats) ? Math.trunc(targetAmountSats) : 0;
  if (spend <= 0) {
    return {
      inputs: [],
      totalInputSats: 0,
      feeSats: 0,
      changeSats: 0,
      changeIsDust: false,
      outputCount: options.outputsWithoutChange ?? 1,
    };
  }

  const dustThreshold = options.dustThreshold ?? DUST_SATS;
  const outputsWithoutChange = Math.max(1, Math.trunc(options.outputsWithoutChange ?? 1));
  const headroomFactor = Number.isFinite(options.targetHeadroomFactor)
    ? Math.max(1, Number(options.targetHeadroomFactor))
    : 1;

  const effectiveTarget = Math.ceil(spend * headroomFactor);

  const sorted = [...utxos]
    .map((u) => ({
      txid: u.txid,
      vout: u.vout,
      valueSats: Math.trunc(Number(u.valueSats) || 0),
      scriptPubKey: u.scriptPubKey,
      confirmations: Math.trunc(Number(u.confirmations) || 0),
    }))
    .filter((u) => u.valueSats > 0)
    .sort((a, b) => {
      if (a.valueSats !== b.valueSats) return a.valueSats - b.valueSats;
      return b.confirmations - a.confirmations;
    });

  const selected: Utxo[] = [];
  let total = 0;

  for (const utxo of sorted) {
    selected.push(utxo);
    total += utxo.valueSats;

    const inputs = selected.length;
    const outputsWithChange = outputsWithoutChange + 1;
    let fee = estimateFee(inputs, outputsWithChange, feeRateSatsPerByte);
    if (fee <= 0) {
      fee = 0;
    }

    let required = effectiveTarget + fee;
    if (total < required) {
      continue;
    }

    let change = total - spend - fee;
    let changeIsDust = false;
    let outputCount = outputsWithChange;

    if (change > 0 && change < dustThreshold) {
      changeIsDust = true;
      fee += change;
      change = 0;
      outputCount = outputsWithoutChange;

      const feeNoChange = estimateFee(inputs, outputsWithoutChange, feeRateSatsPerByte);
      if (feeNoChange > fee) {
        fee = feeNoChange;
      }

      required = effectiveTarget + fee;
      if (total < required) {
        continue;
      }
    }

    if (change <= 0) {
      change = 0;
      outputCount = outputsWithoutChange;
    }

    if (total < spend + fee) {
      continue;
    }

    return {
      inputs: selected,
      totalInputSats: total,
      feeSats: fee,
      changeSats: change,
      changeIsDust,
      outputCount,
    };
  }

  throw new Error("insufficient_funds");
}

export type DesiredOutput = { address: string; valueSats: number };

export type BuildOutputsResult = {
  outputs: DesiredOutput[];
  totals: {
    sendTotalSats: number;
    changeSats: number;
    outputCount: number;
  };
};

export function buildOutputs(
  desiredOutputs: DesiredOutput[],
  options: { changeAddress?: string; changeSats?: number; dustThreshold?: number } = {},
): BuildOutputsResult {
  const dustThreshold = options.dustThreshold ?? DUST_SATS;
  const changeAddress = (options.changeAddress || "").trim();
  const changeSats = Math.trunc(Number(options.changeSats) || 0);

  const outputs: DesiredOutput[] = desiredOutputs
    .filter((o) => Number.isFinite(o.valueSats) && o.valueSats > 0)
    .map((o) => ({ address: o.address, valueSats: Math.trunc(o.valueSats) }));

  let finalChange = 0;
  if (changeAddress && changeSats >= dustThreshold) {
    outputs.push({ address: changeAddress, valueSats: changeSats });
    finalChange = changeSats;
  }

  const sendTotalSats = outputs.reduce((sum, o) => sum + (o.address === changeAddress ? 0 : o.valueSats), 0);
  const outputCount = outputs.length;

  return {
    outputs,
    totals: {
      sendTotalSats,
      changeSats: finalChange,
      outputCount,
    },
  };
}

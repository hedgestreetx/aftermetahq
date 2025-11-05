import { describe, expect, test } from "vitest";

import { buildOutputs, estimateFee, selectUtxos, type Utxo } from "./utxo";
import { DUST_SATS } from "./coin";

const baseUtxo = (overrides: Partial<Utxo>): Utxo => ({
  txid: "a".repeat(64),
  vout: 0,
  valueSats: 0,
  scriptPubKey: "76a914" + "00".repeat(20) + "88ac",
  confirmations: 1,
  ...overrides,
});

describe("estimateFee", () => {
  test("computes conservative fee", () => {
    const fee = estimateFee(2, 2, 1.5);
    expect(fee).toBe(Math.ceil((10 + 2 * 148 + 2 * 34 + 10) * 1.5));
  });
});

describe("selectUtxos", () => {
  test("exact match no change", () => {
    const utxos = [baseUtxo({ valueSats: 1236 })];
    const result = selectUtxos(utxos, 1000, 1);
    expect(result.totalInputSats).toBe(1236);
    expect(result.feeSats).toBe(236);
    expect(result.changeSats).toBe(0);
    expect(result.changeIsDust).toBe(false);
  });

  test("dust change is folded into fee", () => {
    const utxos = [baseUtxo({ valueSats: 1300 })];
    const result = selectUtxos(utxos, 1000, 1);
    expect(result.changeSats).toBe(0);
    expect(result.changeIsDust).toBe(true);
    expect(result.feeSats).toBeGreaterThan(236);
  });

  test("multiple inputs aggregated", () => {
    const utxos = [
      baseUtxo({ txid: "b".repeat(64), valueSats: 300, confirmations: 5 }),
      baseUtxo({ txid: "c".repeat(64), valueSats: 400, confirmations: 10 }),
      baseUtxo({ txid: "d".repeat(64), valueSats: 900, confirmations: 3 }),
    ];
    const result = selectUtxos(utxos, 900, 1);
    expect(result.inputs.length).toBeGreaterThan(1);
    expect(result.totalInputSats).toBeGreaterThanOrEqual(900);
  });

  test("prefers higher confirmations for equal values", () => {
    const utxos = [
      baseUtxo({ txid: "e".repeat(64), valueSats: 700, confirmations: 2 }),
      baseUtxo({ txid: "f".repeat(64), valueSats: 700, confirmations: 20 }),
      baseUtxo({ txid: "g".repeat(64), valueSats: 700, confirmations: 5 }),
    ];
    const result = selectUtxos(utxos, 700, 1);
    expect(result.inputs[0].confirmations).toBe(20);
  });

  test("change output emitted when above dust", () => {
    const utxos = [baseUtxo({ valueSats: 2000 })];
    const result = selectUtxos(utxos, 1000, 1);
    expect(result.changeSats).toBeGreaterThanOrEqual(DUST_SATS);
    const outputs = buildOutputs(
      [{ address: "mtHc5VsjAcLBCEV4VpWw2X2VN7dExUvktS", valueSats: 1000 }],
      { changeAddress: "mtHc5VsjAcLBCEV4VpWw2X2VN7dExUvktS", changeSats: result.changeSats },
    );
    expect(outputs.totals.changeSats).toBe(result.changeSats);
    expect(outputs.outputs.length).toBe(2);
  });
});

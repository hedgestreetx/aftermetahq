import fetch from "node-fetch";
import { ENV } from "./env";

export async function fetchUtxos(address: string) {
  const url = `${ENV.WOC_BASE}/address/${address}/unspent`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`WOC UTXO error ${res.status}`);
  return res.json() as Promise<Array<{ tx_hash: string; tx_pos: number; value: number }>>;
}

export async function fetchTx(txid: string) {
  const url = `${ENV.WOC_BASE}/tx/${txid}/hex`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`WOC tx error ${res.status}`);
  return res.text();
}

import { ENV } from "./env";

const NET_WOC = ENV.NETWORK === "mainnet" ? "main" : "test";
const WOC_BASE = (ENV.WOC_BASE || `https://api.whatsonchain.com/v1/bsv/${NET_WOC}`).replace(/\/+$/, "");

export { NET_WOC, WOC_BASE };

export const wocStatusUrl = (txid: string) => `${WOC_BASE}/tx/${txid}/status`;

type ParsedStatus = {
  confirmed: boolean;
  confirmations: number;
  blockHeight: number | null;
};

export function parseWocStatus(body: any): ParsedStatus {
  const confirmedFlag = Boolean(body?.confirmed ?? body?.isConfirmed ?? body?.valid ?? false);
  const confirmationsRaw = Number(body?.confirmations ?? body?.confs ?? body?.Confirmations ?? body?.numConfirmations ?? NaN);
  const confirmations = Number.isFinite(confirmationsRaw)
    ? confirmationsRaw
    : confirmedFlag
    ? 1
    : 0;
  const blockHeightRaw = Number(
    body?.blockheight ?? body?.blockHeight ?? body?.block_height ?? body?.height ?? NaN,
  );
  const blockHeight = Number.isFinite(blockHeightRaw) ? blockHeightRaw : null;
  const confirmed = confirmedFlag || confirmations > 0;
  return { confirmed, confirmations: confirmations > 0 ? confirmations : confirmed ? 1 : 0, blockHeight };
}

export async function queryWocTxStatus(txid: string): Promise<
  ParsedStatus & { ok: boolean; status: number; error?: string }
> {
  const url = wocStatusUrl(txid);
  try {
    const resp = await fetch(url);
    let body: any = null;
    try {
      body = await resp.json();
    } catch {
      body = null;
    }
    const parsed = parseWocStatus(body);
    if (!resp.ok) {
      return { ...parsed, ok: false, status: resp.status, error: `woc_status_${resp.status}` };
    }
    return { ...parsed, ok: true, status: resp.status };
  } catch (err: any) {
    return {
      confirmed: false,
      confirmations: 0,
      blockHeight: null,
      ok: false,
      status: 0,
      error: "woc_status_fetch_failed",
    };
  }
}

export type MintQuoteRecord = {
  symbol: string;
  spendSats: number;
  feeEstimate: number;
  changeSats: number;
  tokensEstimate: number;
  inputCount: number;
  fromAddress: string;
  createdAt: number;
};

const MAX_QUOTES = 10;
const records: MintQuoteRecord[] = [];

export function rememberMintQuote(record: MintQuoteRecord) {
  records.push(record);
  while (records.length > MAX_QUOTES) {
    records.shift();
  }
}

export function getRecentMintQuotes(limit = 3, symbol?: string) {
  const target = String(symbol || "").trim().toUpperCase();
  const filtered = target
    ? records.filter((r) => r.symbol.toUpperCase() === target)
    : records;
  const slice = filtered.slice(-limit);
  return slice.reverse();
}

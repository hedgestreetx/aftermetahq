type QuoteRecord = {
  symbol: string;
  spendSats: number;
  feeEstimate: number;
  netSpend: number;
  tokensEstimate: number;
  inputCount: number;
  changeSats: number;
  fromAddress: string;
  createdAt: number;
};

const MAX_QUOTES = 10;
const quotes: QuoteRecord[] = [];

export function recordQuote(record: Omit<QuoteRecord, "createdAt">) {
  const entry: QuoteRecord = { ...record, createdAt: Date.now() };
  quotes.push(entry);
  if (quotes.length > MAX_QUOTES) {
    quotes.splice(0, quotes.length - MAX_QUOTES);
  }
}

export function recentQuotes(symbol: string, limit = 3): QuoteRecord[] {
  const normalized = symbol.trim().toUpperCase();
  const filtered = normalized
    ? quotes.filter((q) => q.symbol.toUpperCase() === normalized)
    : quotes.slice();
  return filtered.slice(-limit).reverse();
}

export type { QuoteRecord };

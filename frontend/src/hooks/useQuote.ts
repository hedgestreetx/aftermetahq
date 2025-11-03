import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, type MintQuoteRequest, type MintQuoteResponse, quoteMint } from "@/lib/api";

type Params = {
  wif: string;
  spendSats: number | null;
  symbol?: string;
  poolId?: string;
  debounceMs?: number;
};

type Sanitized = {
  body: MintQuoteRequest;
  key: string;
};

const DEFAULT_DEBOUNCE = 400;

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  const message = typeof err === "string" ? err : String((err as any)?.message ?? err ?? "Unknown error");
  return new ApiError({ message, code: "unknown", status: 0 });
}

export function useQuote(params: Params) {
  const debounceMs = params.debounceMs ?? DEFAULT_DEBOUNCE;
  const [quote, setQuote] = useState<MintQuoteResponse | null>(null);
  const [quoteKey, setQuoteKey] = useState<string | null>(null);
  const [quoteRequest, setQuoteRequest] = useState<MintQuoteRequest | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);
  const activeKey = useRef<string | null>(null);

  const sanitized = useMemo<Sanitized | null>(() => {
    const wif = params.wif.trim();
    const spend = Number.isFinite(params.spendSats) ? Math.trunc(Number(params.spendSats)) : NaN;
    const poolId = params.poolId?.trim() || undefined;
    const symbol = params.symbol?.trim() || undefined;

    if (!wif) return null;
    if (!Number.isFinite(spend) || spend <= 0) return null;
    if (!poolId && !symbol) return null;

    const body: MintQuoteRequest = {
      wif,
      spendSats: spend,
      ...(poolId ? { poolId } : {}),
      ...(symbol ? { symbol } : {}),
    };

    const key = JSON.stringify({ wif, spendSats: body.spendSats, poolId: poolId ?? null, symbol: symbol ?? null });
    return { body, key };
  }, [params.wif, params.spendSats, params.poolId, params.symbol]);

  useEffect(() => {
    if (!sanitized) {
      activeKey.current = null;
      setLoading(false);
      setError(null);
      setErrorKey(null);
      setQuote(null);
      setQuoteKey(null);
      setQuoteRequest(null);
      return;
    }

    let cancelled = false;
    activeKey.current = sanitized.key;

    const timeoutId = setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      quoteMint(sanitized.body)
        .then((res) => {
          if (cancelled || activeKey.current !== sanitized.key) return;
          setQuote(res);
          setQuoteKey(sanitized.key);
          setQuoteRequest(sanitized.body);
          setError(null);
          setErrorKey(null);
          setLoading(false);
        })
        .catch((err) => {
          if (cancelled || activeKey.current !== sanitized.key) return;
          const apiErr = toApiError(err);
          setError(apiErr);
          setErrorKey(sanitized.key);
          setLoading(false);
        });
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [sanitized, refreshCount, debounceMs]);

  const refresh = () => {
    if (!sanitized) return;
    setRefreshCount((count) => count + 1);
  };

  return {
    quote,
    quoteKey,
    loading,
    error,
    errorKey,
    currentKey: sanitized?.key ?? null,
    currentRequest: sanitized?.body ?? null,
    lastRequest: quoteRequest,
    refresh,
    ready: Boolean(sanitized),
  };
}

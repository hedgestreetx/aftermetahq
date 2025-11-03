import { useEffect, useRef, useState } from "react";
import { ApiError, txStatus } from "@/lib/api";

type StatusResponse = Awaited<ReturnType<typeof txStatus>>;

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  const message = typeof err === "string" ? err : String((err as any)?.message ?? err ?? "Unknown error");
  return new ApiError({ message, code: "unknown", status: 0 });
}

export function useTxStatus(txid: string | null, intervalMs = 15_000) {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!txid) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      setData(null);
      setError(null);
      setLoading(false);
      return () => {};
    }

    let cancelled = false;
    const activeTxid = txid;

    async function fetchStatus(initial = false) {
      if (cancelled) return;
      if (initial) setLoading(true);
      try {
        const res = await txStatus(activeTxid);
        if (cancelled) return;
        setData(res);
        setError(null);
        setLoading(false);
        if (res.confirmed && timerRef.current) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
      } catch (err) {
        if (cancelled) return;
        const apiErr = toApiError(err);
        setError(apiErr);
        setLoading(false);
      }
    }

    fetchStatus(true);
    timerRef.current = window.setInterval(() => fetchStatus(false), intervalMs);

    return () => {
      cancelled = true;
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [txid, intervalMs]);

  return { data, loading, error };
}

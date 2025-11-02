import { useEffect, useRef, useState } from 'react';

export function useTxStatus(txid: string | null, periodMs = 60_000) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!txid) return;

    async function ensureWatch() {
      try {
        await fetch(`${import.meta.env.VITE_API_URL}/api/tx/watch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txid }),
        });
      } catch {
        /* ignore */
      }
    }

    async function tick() {
      try {
        const r = await fetch(`${import.meta.env.VITE_API_URL}/api/tx/${txid}/status`);
        if (!r.ok) throw new Error(`status ${r.status}`);
        const j = await r.json();
        setData(j);
        setError(null);

        if (j?.confirmed) {
          if (timer.current) window.clearInterval(timer.current);
          timer.current = null;
          return;
        }
      } catch (e: any) {
        setError(String(e?.message || e));
      }
    }

    ensureWatch().then(tick);
    timer.current = window.setInterval(tick, periodMs);

    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [txid, periodMs]);

  return { data, error };
}

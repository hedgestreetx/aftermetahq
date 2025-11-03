import { useEffect, useState } from "react";
import { adminState as fetchAdminState, type AdminState as AdminStateType } from "@/lib/api";

export type AdminState = AdminStateType;

type State = {
  data: AdminState | null;
  error: string | null;
};

export function useAdminState(intervalMs = 5_000) {
  const [state, setState] = useState<State>({ data: null, error: null });

  useEffect(() => {
    let alive = true;

    async function tick() {
      try {
        const res = await fetchAdminState();
        if (!alive) return;
        setState({ data: res, error: null });
      } catch (err: any) {
        if (!alive) return;
        setState((prev) => ({ data: prev.data, error: String(err?.message ?? err) }));
      }
    }

    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);

  return state;
}

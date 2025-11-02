import { useEffect, useState } from "react";
import { adminState, type AdminState } from "@/lib/api";

export default function AdminStatus() {
  const [data, setData] = useState<AdminState | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const s = await adminState();
        if (!stop) setData(s);
      } catch (e: any) {
        if (!stop) setErr(String(e?.message || e));
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  if (err) return <div className="card"><div className="small" style={{color:"#ff8b8b"}}>Admin error: {err}</div></div>;
  if (!data) return <div className="card"><div className="small">Loading admin…</div></div>;

  return (
    <div className="card">
      <div className="h" style={{justifyContent:"space-between"}}>
        <div className="h">
          <span className="badge">Network</span>
          <strong>{data.network}</strong>
        </div>
        <div className="h small">
          <span>feePerKb:</span><strong>{data.feePerKb}</strong>
          <span style={{marginLeft:12}}>minConfs:</span><strong>{data.minConfs}</strong>
          <span style={{marginLeft:12}}>poolAddr:</span><code>{data.poolAddr || "—"}</code>
          <span style={{marginLeft:12}}>scriptLen:</span><strong>{data.poolLockingScriptHexLen}</strong>
        </div>
      </div>
    </div>
  );
}

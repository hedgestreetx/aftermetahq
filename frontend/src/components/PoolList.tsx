import { useEffect, useState } from "react";
import { listPools, type Pool } from "@/lib/api";

export default function PoolList(props: { onSelect?: (p: Pool) => void }) {
  const [rows, setRows] = useState<Pool[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await listPools();
      setRows(r.pools);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="card">
      <div className="h" style={{justifyContent:"space-between"}}>
        <h3 className="h" style={{margin:0, gap:8}}>Pools <span className="badge">{rows.length}</span></h3>
        <button onClick={load}>Refresh</button>
      </div>
      {err && <div className="small" style={{color:"#ff8b8b"}}>{err}</div>}
      {loading ? <div className="small">Loading…</div> : (
        <table className="table" style={{marginTop:8}}>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Pool ID</th>
              <th>Minted</th>
              <th>Creator</th>
              <th>Dest</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.id}>
                <td><strong>{p.symbol}</strong></td>
                <td><code>{p.id}</code></td>
                <td>{p.supply?.mintedSupply ?? 0} / {p.maxSupply}</td>
                <td className="small">{p.creator}</td>
                <td className="small">
                  {p.poolAddress ? <code>{p.poolAddress}</code> : <span>script:{p.lockingScriptHex.slice(0,12)}…</span>}
                </td>
                <td style={{textAlign:"right"}}>
                  <button onClick={() => props.onSelect?.(p)}>Select</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="small">No pools yet.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

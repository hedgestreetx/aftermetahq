import { useEffect, useState } from "react";
import AdminStatus from "@/components/AdminStatus";
import PoolList from "@/components/PoolList";
import MintTokenForm from "@/components/MintTokenForm";
import AdminPanel from "@/components/AdminPanel";
import { health, listMints, type MintRow, type Pool } from "@/lib/api";

export default function App() {
  const [svc, setSvc] = useState<string>("");   // backend service name
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Pool | null>(null);
  const [mints, setMints] = useState<MintRow[]>([]);

  async function loadHealth() {
    try {
      const h = await health();
      setSvc(h.service);
      setErr(null);
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }

  async function loadMints() {
    try {
      const r = await listMints({ limit: 50 });
      setMints(r.mints);
    } catch (e) {
      console.error("loadMints error:", e);
    }
  }

  useEffect(() => {
    loadHealth();
    loadMints();
    const id = setInterval(loadMints, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="container">
      {/* Header */}
      <div className="h" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <h2 className="h" style={{ gap: 10, margin: 0 }}>
          Aftermeta <span className="badge">{svc || "?"}</span>
        </h2>
        <button onClick={loadHealth}>Ping</button>
      </div>

      {/* Backend down notice */}
      {err && (
        <div className="card" style={{ borderColor: "#3b0f12" }}>
          <div className="h" style={{ gap: 8 }}>
            <span className="badge">API</span>
            <strong style={{ color: "#ff8b8b" }}>DOWN</strong>
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            {err}
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            Fix your backend or VITE_API_URL, then refresh.
          </div>
        </div>
      )}

      {/* Admin state banner */}
      <AdminStatus />

      {/* Pool creation + list */}
      <div className="row" style={{ marginTop: 16 }}>
        <div className="col">
          <AdminPanel onCreated={() => setSelected(null)} />
        </div>
        <div className="col">
          <PoolList onSelect={(p) => setSelected(p)} />
        </div>
      </div>

      {/* Mint + mints table */}
      <div className="row" style={{ marginTop: 16 }}>
        <div className="col">
          <MintTokenForm selectedPool={selected} />
        </div>
        <div className="col">
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Recent Mints</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Pool</th>
                  <th>Tokens</th>
                  <th>Spend</th>
                  <th>Confirmed</th>
                  <th>TXID</th>
                </tr>
              </thead>
              <tbody>
                {mints.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.symbol}</strong>
                    </td>
                    <td className="small">
                      <code>{m.poolId}</code>
                    </td>
                    <td>{m.tokens}</td>
                    <td>{m.spendSats}</td>
                    <td>{m.confirmed ? "yes" : "no"}</td>
                    <td
                      className="small"
                      style={{
                        maxWidth: 340,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <code>{m.txid}</code>
                    </td>
                  </tr>
                ))}

                {mints.length === 0 && (
                  <tr>
                    <td colSpan={6} className="small">
                      No mints yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="h" style={{ justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={loadMints}>Refresh</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

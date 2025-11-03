import { useEffect, useMemo, useState } from "react";
import MintPanel from "@/components/MintPanel";
import PoolList from "@/components/PoolList";
import AdminPanel from "@/components/AdminPanel";
import { API_BASE, health, listMints, type MintRow, type Pool } from "@/lib/api";
import { useAdminState } from "@/hooks/useAdminState";

export default function App() {
  const [serviceName, setServiceName] = useState<string>("");
  const [healthError, setHealthError] = useState<string | null>(null);
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const [mints, setMints] = useState<MintRow[]>([]);
  const [loadingMints, setLoadingMints] = useState(false);
  const { data: admin, error: adminError } = useAdminState();

  useEffect(() => {
    async function loadHealth() {
      try {
        const res = await health();
        setServiceName(res.service);
        setHealthError(null);
      } catch (err: any) {
        setHealthError(String(err?.message ?? err));
      }
    }
    loadHealth();
  }, []);

  const apiDown = Boolean(adminError && !admin);

  const network = admin?.network ?? "testnet";

  const loadMints = async () => {
    try {
      setLoadingMints(true);
      const res = await listMints(selectedPool ? { poolId: selectedPool.id, limit: 25 } : { limit: 25 });
      setMints(res.mints);
    } catch (err) {
      console.error("Failed to load mints", err);
    } finally {
      setLoadingMints(false);
    }
  };

  useEffect(() => {
    loadMints();
    const id = setInterval(loadMints, 10_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPool?.id]);

  const adminBanner = useMemo(() => {
    if (apiDown) {
      return (
        <div className="card" role="alert">
          <div className="h" style={{ justifyContent: "space-between" }}>
            <strong>API DOWN</strong>
            <span className="small">{adminError}</span>
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            Check that {API_BASE} is reachable and the backend is running.
          </div>
        </div>
      );
    }

    if (!admin) {
      return (
        <div className="card">
          <div className="small">Loading admin state…</div>
        </div>
      );
    }

    return (
      <div className="card">
        <div className="h" style={{ justifyContent: "space-between" }}>
          <div className="h" style={{ gap: 12 }}>
            <span className="badge">API</span>
            <strong>{API_BASE}</strong>
          </div>
          <div className="h" style={{ gap: 16 }}>
            <span className="small">Network:</span>
            <strong>{admin.network}</strong>
            <span className="small">Fee/KB:</span>
            <strong>{admin.feePerKb}</strong>
            <span className="small">minConfs:</span>
            <strong>{admin.minConfs}</strong>
          </div>
        </div>
      </div>
    );
  }, [admin, apiDown, adminError]);

  return (
    <div className="container">
      <header className="h" style={{ justifyContent: "space-between", marginBottom: 24 }}>
        <div className="h" style={{ gap: 10 }}>
          <h1 style={{ margin: 0 }}>Aftermeta</h1>
          {serviceName && <span className="badge">{serviceName}</span>}
        </div>
        <button onClick={() => window.location.reload()}>Reload</button>
      </header>

      {healthError && (
        <div className="card" role="alert">
          <div className="small">Health check failed: {healthError}</div>
        </div>
      )}

      {adminBanner}

      <section style={{ marginTop: 24 }}>
        <MintPanel
          network={network}
          disabled={apiDown}
          initialPool={selectedPool}
          onMintComplete={() => {
            loadMints();
          }}
        />
      </section>

      <section style={{ marginTop: 32 }} className="row">
        <div className="col">
          <AdminPanel onCreated={() => setSelectedPool(null)} />
        </div>
        <div className="col">
          <PoolList
            onSelect={(pool) => {
              setSelectedPool(pool);
            }}
          />
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <div className="card">
          <div className="h" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>Recent mints</h3>
            <button onClick={loadMints} disabled={loadingMints}>
              {loadingMints ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          <table className="table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Pool</th>
                <th>Tokens</th>
                <th>Spend</th>
                <th>Status</th>
                <th>TXID</th>
              </tr>
            </thead>
            <tbody>
              {mints.map((mint) => (
                <tr key={mint.id}>
                  <td>{mint.symbol}</td>
                  <td className="small">
                    <code>{mint.poolId}</code>
                  </td>
                  <td>{mint.tokens}</td>
                  <td>{mint.spendSats}</td>
                  <td>
                    <span className={`badge ${mint.confirmed ? "badge-success" : "badge-warn"}`}>
                      {mint.confirmed ? "Confirmed" : "Pending"}
                    </span>
                  </td>
                  <td className="small">
                    <code>{mint.txid}</code>
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
        </div>
      </section>
    </div>
  );
}

import { useEffect, useState } from "react";
import { mint, txStatus, withdrawalsCan, type Pool } from "@/lib/api";

type Props = { selectedPool: Pool | null };

export default function MintTokenForm({ selectedPool }: Props) {
  const [wif, setWif] = useState("");
  const [spend, setSpend] = useState<number>(1000);
  const [poolId, setPoolId] = useState<string>("");
  const [symbol, setSymbol] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<{ txid: string; visible?: boolean } | null>(null);
  const [canWd, setCanWd] = useState<{ can: boolean; reason: string | null } | null>(null);

  useEffect(() => {
    if (selectedPool) {
      setPoolId(selectedPool.id);
      setSymbol(selectedPool.symbol);
      refreshWithdrawals(selectedPool.id);
    }
  }, [selectedPool?.id]);

  async function refreshWithdrawals(pid: string) {
    try {
      const r = await withdrawalsCan(pid);
      setCanWd(r);
    } catch {}
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!wif.trim()) return setErr("WIF required");
    if (!poolId.trim() && !symbol.trim()) return setErr("Select a pool or fill symbol");
    if (!Number.isFinite(spend) || spend < 546) return setErr("spendSats must be >= 546");

    setSubmitting(true);
    try {
      const res = await mint({ wif: wif.trim(), spendSats: Math.trunc(spend), poolId, symbol });
      setLast({ txid: res.txid, visible: res.visible });
      setErr(null);
      refreshWithdrawals(res.poolId);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setSubmitting(false);
    }
  }

  async function checkTx() {
    if (!last?.txid) return;
    try {
      const s = await txStatus(last.txid);
      alert(`TX ${s.txid}\nconfirmed=${s.confirmed}\nblockHeight=${s.blockHeight ?? "null"}`);
    } catch (e: any) {
      alert(String(e?.message || e));
    }
  }

  return (
    <div className="card">
      <h3 style={{marginTop:0}}>Mint</h3>
      <form className="row" onSubmit={onSubmit}>
        <div className="col">
          <label className="small">Testnet WIF</label>
          <input value={wif} onChange={e=>setWif(e.target.value)} placeholder="cR... (testnet WIF)" />
        </div>
        <div className="col">
          <label className="small">Spend (sats)</label>
          <input type="number" min={546} value={spend} onChange={e=>setSpend(Number(e.target.value)||0)} />
        </div>
        <div className="col">
          <label className="small">Pool ID</label>
          <input value={poolId} onChange={e=>setPoolId(e.target.value)} placeholder="auto set by pool selection" />
        </div>
        <div className="col">
          <label className="small">Symbol</label>
          <input value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())} placeholder="PUMP" />
        </div>
        <div className="col" style={{alignSelf:"end"}}>
          <button className="primary" disabled={submitting}>{submitting ? "Minting…" : "Mint"}</button>
        </div>
      </form>
      {err && <div className="small" style={{color:"#ff8b8b", marginTop:8}}>{err}</div>}
      <div className="h" style={{gap:12, marginTop:8}}>
        {last?.txid && (
          <>
            <span className="badge">txid:</span>
            <code style={{wordBreak:"break-all"}}>{last.txid}</code>
            <button onClick={checkTx}>Check status</button>
            {typeof last.visible === "boolean" && (
              <span className="small">visible: {String(last.visible)}</span>
            )}
          </>
        )}
      </div>
      <hr className="hr" />
      <div className="h" style={{gap:8}}>
        <span className="badge">Withdrawals</span>
        <span className="small">
          {canWd ? (canWd.can ? "Allowed" : `Blocked: ${canWd.reason}`) : "—"}
        </span>
        {poolId && <button onClick={()=>refreshWithdrawals(poolId)}>Recheck</button>}
      </div>
    </div>
  );
}

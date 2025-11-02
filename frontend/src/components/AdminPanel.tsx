import { useState } from "react";
import { createPool } from "@/lib/api";

export default function AdminPanel({ onCreated }: { onCreated: () => void }) {
  const [symbol, setSymbol] = useState("PUMP");
  const [creator, setCreator] = useState("pumpfun");
  const [poolAddress, setPoolAddress] = useState(""); // optional if you use script
  const [lockingScriptHex, setLockingScriptHex] = useState("");
  const [maxSupply, setMaxSupply] = useState(1_000_000);
  const [decimals, setDecimals] = useState(8);
  const [creatorReserve, setCreatorReserve] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setOk(null);
    if (!symbol.trim()) return setErr("symbol required");
    if (!creator.trim()) return setErr("creator required");
    if (!poolAddress.trim() && !lockingScriptHex.trim())
      return setErr("Provide either poolAddress or lockingScriptHex");
    setBusy(true);
    try {
      await createPool({
        symbol: symbol.trim().toUpperCase(),
        creator: creator.trim(),
        poolAddress: poolAddress.trim(),
        lockingScriptHex: lockingScriptHex.trim(),
        maxSupply, decimals, creatorReserve
      });
      setOk("Pool created");
      onCreated();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3 style={{marginTop:0}}>Create Pool</h3>
      <form className="row" onSubmit={onSubmit}>
        <div className="col"><label className="small">Symbol</label><input value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())} /></div>
        <div className="col"><label className="small">Creator</label><input value={creator} onChange={e=>setCreator(e.target.value)} /></div>
        <div className="col"><label className="small">Pool Address (P2SH)</label><input value={poolAddress} onChange={e=>setPoolAddress(e.target.value)} /></div>
        <div className="col"><label className="small">Locking Script Hex</label><input value={lockingScriptHex} onChange={e=>setLockingScriptHex(e.target.value)} /></div>
        <div className="col"><label className="small">Max Supply</label><input type="number" min={0} value={maxSupply} onChange={e=>setMaxSupply(Number(e.target.value)||0)} /></div>
        <div className="col"><label className="small">Decimals</label><input type="number" min={0} max={18} value={decimals} onChange={e=>setDecimals(Number(e.target.value)||0)} /></div>
        <div className="col"><label className="small">Creator Reserve</label><input type="number" min={0} value={creatorReserve} onChange={e=>setCreatorReserve(Number(e.target.value)||0)} /></div>
        <div className="col" style={{alignSelf:"end"}}><button className="primary" disabled={busy}>{busy ? "Creating…" : "Create"}</button></div>
      </form>
      {err && <div className="small" style={{color:"#ff8b8b", marginTop:8}}>{err}</div>}
      {ok && <div className="small" style={{color:"#9effa3", marginTop:8}}>{ok}</div>}
      <div className="small" style={{marginTop:8}}>Tip: provide **either** P2SH address or full locking script.</div>
    </div>
  );
}

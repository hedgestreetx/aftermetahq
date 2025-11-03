import { useEffect, useMemo, useState } from "react";
import { ApiError, type Pool, listPools, mint, type MintTokenResponse } from "@/lib/api";
import { useQuote } from "@/hooks/useQuote";
import TxDialog from "@/components/TxDialog";

const ERROR_MAP: Record<string, string> = {
  missing_wif: "Enter your wallet WIF.",
  invalid_wif_format: "That WIF doesn’t look valid.",
  invalid_spend: "Enter a positive spend amount.",
  dust_output: "Spend is too small (dust). Try more than 546 sats.",
  no_funds: "Not enough balance.",
  insufficient_funds: "Not enough balance.",
  insufficient_funds_no_change: "Not enough balance after fees (change would be dust).",
  pool_fk_missing: "Pool not found.",
  pool_not_found: "Pool not found.",
  no_pool_destination: "Pool destination not configured.",
  internal_error: "Something went wrong. Try again.",
};

type Props = {
  network: string;
  disabled?: boolean;
  initialPool?: Pool | null;
  onMintComplete?: (mint: MintTokenResponse) => void;
};

type QuoteAlert = {
  type: "error" | "info";
  message: string;
};

function mapError(err: ApiError | null): QuoteAlert | null {
  if (!err) return null;
  const fallback = err.message || `Request failed (${err.code})`;
  const message = ERROR_MAP[err.code] ?? fallback;
  const ref = err.ref ? ` Ref: ${err.ref}` : "";
  return { type: "error", message: `${message}${ref}` };
}

export default function MintPanel({ network, disabled = false, initialPool, onMintComplete }: Props) {
  const [pools, setPools] = useState<Pool[]>([]);
  const [poolId, setPoolId] = useState<string>(initialPool?.id ?? "");
  const [symbol, setSymbol] = useState<string>(initialPool?.symbol ?? "");
  const [spend, setSpend] = useState<number | "">(1000);
  const [wif, setWif] = useState<string>("");
  const [showWif, setShowWif] = useState(false);
  const [minting, setMinting] = useState(false);
  const [toast, setToast] = useState<QuoteAlert | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; txid: string } | null>(null);

  const spendNumber = typeof spend === "number" ? spend : Number(spend) || 0;

  const quotingInputs = {
    wif: disabled ? "" : wif,
    spendSats: disabled ? 0 : spendNumber,
    poolId: disabled ? "" : poolId,
    symbol: disabled ? "" : symbol,
  };

  const { quote, quoteKey, loading: quoteLoading, error: quoteError, errorKey, currentKey, lastRequest, ready } = useQuote(
    quotingInputs
  );

  useEffect(() => {
    let cancelled = false;
    async function loadPools() {
      try {
        const res = await listPools();
        if (!cancelled) setPools(res.pools);
      } catch (err) {
        if (!cancelled) {
          setToast({ type: "error", message: `Failed to load pools: ${String((err as Error).message || err)}` });
        }
      }
    }
    loadPools();
    const id = setInterval(loadPools, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (initialPool) {
      setPoolId(initialPool.id);
      setSymbol(initialPool.symbol);
    }
  }, [initialPool?.id, initialPool?.symbol]);

  useEffect(() => {
    if (!quoteError || errorKey !== currentKey) return;
    const alert = mapError(quoteError);
    if (alert) setToast(alert);
  }, [quoteError, errorKey, currentKey]);

  const isDirty = useMemo(() => {
    if (!currentKey) return true;
    return quoteKey !== currentKey;
  }, [quoteKey, currentKey]);

  const quoteReady = quote && !isDirty;
  const quoteAlert = mapError(quoteError && errorKey === currentKey ? quoteError : null);

  const utxoPreview = quote?.utxoSummary?.[0];

  const onMint = async () => {
    if (!quoteReady || !lastRequest) return;
    try {
      setMinting(true);
      const res = await mint(lastRequest);
      setDialog({ open: true, txid: res.txid });
      onMintComplete?.(res);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : new ApiError({ message: String((err as any)?.message ?? err), code: "unknown", status: 0 });
      setToast(mapError(apiErr));
    } finally {
      setMinting(false);
    }
  };

  const resetToast = () => setToast(null);

  const copyFromAddress = async () => {
    if (!quote?.fromAddress) return;
    try {
      await navigator.clipboard.writeText(quote.fromAddress);
      setToast({ type: "info", message: "From address copied to clipboard." });
    } catch (err) {
      const message = String((err as any)?.message ?? err ?? "Unable to copy address.");
      setToast({ type: "error", message });
    }
  };

  return (
    <div className={`mint-panel ${disabled ? "disabled" : ""}`} aria-live="polite">
      <div className="panel-header">
        <div>
          <h2>Mint tokens</h2>
          <p className="muted">Get a live quote before broadcasting.</p>
        </div>
        <div>
          <button type="button" className="secondary" onClick={() => window.location.reload()}>
            Refresh page
          </button>
        </div>
      </div>

      {toast && (
        <div className={`alert ${toast.type}`} role={toast.type === "error" ? "alert" : "status"}>
          <div className="h" style={{ justifyContent: "space-between" }}>
            <span>{toast.message}</span>
            <button type="button" className="dismiss" onClick={resetToast}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="mint-layout">
        <form
          className="mint-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!disabled) onMint();
          }}
        >
          <div className="field">
            <label htmlFor="mint-pool">Pool</label>
            <select
              id="mint-pool"
              value={poolId}
              onChange={(e) => {
                const nextId = e.target.value;
                setPoolId(nextId);
                const pool = pools.find((p) => p.id === nextId);
                if (pool) {
                  setSymbol(pool.symbol);
                }
              }}
              disabled={disabled}
            >
              <option value="">Select a pool…</option>
              {pools.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.symbol} — {p.id.slice(0, 10)}…
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="mint-symbol">Symbol</label>
            <input
              id="mint-symbol"
              value={symbol}
              onChange={(e) => {
                setSymbol(e.target.value.toUpperCase());
                if (!e.target.value) setPoolId("");
              }}
              placeholder="PUMP"
              disabled={disabled}
            />
          </div>

          <div className="field">
            <label htmlFor="mint-spend">Spend (sats)</label>
            <input
              id="mint-spend"
              inputMode="numeric"
              type="number"
              min={1}
              value={typeof spend === "number" ? spend : spend || ""}
              onChange={(e) => {
                const next = e.target.value;
                setSpend(next === "" ? "" : Math.max(0, Math.trunc(Number(next))));
              }}
              disabled={disabled}
            />
          </div>

          <div className="field">
            <label htmlFor="mint-wif">Wallet WIF</label>
            <div className="password-field">
              <input
                id="mint-wif"
                type={showWif ? "text" : "password"}
                value={wif}
                onChange={(e) => setWif(e.target.value)}
                placeholder="cR..."
                autoComplete="off"
                disabled={disabled}
              />
              <button
                type="button"
                className="secondary"
                onClick={() => setShowWif((s) => !s)}
                aria-pressed={showWif}
              >
                {showWif ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div className="actions">
            <button
              type="submit"
              className="primary"
              disabled={
                disabled ||
                minting ||
                !quoteReady ||
                quoteLoading ||
                (quoteError && errorKey === currentKey) ||
                !ready
              }
            >
              {minting ? "Minting…" : "Mint Now"}
            </button>
          </div>
        </form>

        <aside className="quote-card" aria-live="polite">
          <div className="quote-header">
            <h3>Quote</h3>
            {quoteLoading && <span className="small">Fetching quote…</span>}
          </div>

          {!ready && <p className="muted">Enter your WIF, spend, and pool to preview the mint.</p>}

          {quoteAlert && <div className={`alert ${quoteAlert.type}`}>{quoteAlert.message}</div>}

          {quoteReady && (
            <dl className="quote-grid">
              <div>
                <dt>Symbol</dt>
                <dd>{quote.symbol}</dd>
              </div>
              <div>
                <dt>Spend</dt>
                <dd>{quote.spendSats.toLocaleString()} sats</dd>
              </div>
              <div>
                <dt>Est. fee</dt>
                <dd>{quote.feeEstimate.toLocaleString()} sats</dd>
              </div>
              <div>
                <dt>Net spend</dt>
                <dd>{quote.netSpend.toLocaleString()} sats</dd>
              </div>
              <div>
                <dt>Tokens</dt>
                <dd>{quote.tokensEstimate.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Change</dt>
                <dd>{quote.changeSats.toLocaleString()} sats</dd>
              </div>
              <div>
                <dt>Inputs</dt>
                <dd>{quote.inputCount}</dd>
              </div>
              <div>
                <dt>From address</dt>
                <dd>
                  <div className="copy-row">
                    <code>{quote.fromAddress}</code>
                    <button type="button" className="secondary" onClick={copyFromAddress}>
                      Copy
                    </button>
                  </div>
                </dd>
              </div>
              {utxoPreview && (
                <div className="utxo">
                  <dt>First UTXO</dt>
                  <dd>
                    <code>
                      {utxoPreview.txid}:{utxoPreview.vout} — {utxoPreview.value.toLocaleString()} sats
                    </code>
                  </dd>
                </div>
              )}
            </dl>
          )}
        </aside>
      </div>

      {dialog && (
        <TxDialog
          open={dialog.open}
          txid={dialog.txid}
          network={network}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

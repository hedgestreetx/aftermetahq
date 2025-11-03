import { useEffect } from "react";
import { useTxStatus } from "@/hooks/useTxStatus";

type Props = {
  open: boolean;
  txid: string;
  network: string;
  onClose: () => void;
};

function statusLabel(confirmed: boolean) {
  return confirmed ? "Confirmed" : "Pending";
}

function statusClass(confirmed: boolean) {
  return confirmed ? "badge badge-success" : "badge badge-warn";
}

function formatTime(timestamp: number | null) {
  if (!timestamp) return null;
  try {
    return new Date(timestamp * 1000).toLocaleString();
  } catch {
    return null;
  }
}

export default function TxDialog({ open, txid, network, onClose }: Props) {
  const { data, loading, error } = useTxStatus(open ? txid : null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (!open) return;
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const confirmed = Boolean(data?.confirmed);
  const status = statusLabel(confirmed);
  const badgeClass = statusClass(confirmed);
  const blockTime = formatTime(data?.blockTime ?? null);
  const baseUrl = network === "mainnet" ? "https://whatsonchain.com/tx" : "https://testnet.whatsonchain.com/tx";
  const explorerUrl = `${baseUrl}/${encodeURIComponent(txid)}`;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <h3>Mint submitted</h3>
          <button onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Transaction ID</label>
            <code className="code-block">{txid}</code>
            <div className="actions">
              <a href={explorerUrl} target="_blank" rel="noreferrer" className="link">
                View on WhatsOnChain
              </a>
            </div>
          </div>

          <div className="status-row">
            <span className={badgeClass}>{status}</span>
            {loading && <span className="small">Checking status…</span>}
            {blockTime && <span className="small">{blockTime}</span>}
          </div>

          {error && (
            <div className="alert warn" role="alert">
              Could not refresh status: {error.message}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="primary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

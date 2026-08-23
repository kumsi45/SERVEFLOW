import { useEffect, useMemo, useRef, useState } from "react";
import {
  partitionKitchenStockReceipts,
  type KitchenStockReceipt,
} from "../services/inventoryRequestService";

export function formatKitchenReceiptQuantity(quantity: number, unit: string) {
  if (!Number.isFinite(quantity)) return "Not available";
  return `${quantity.toLocaleString(undefined, { maximumFractionDigits: 3 })}${unit.trim() ? ` ${unit.trim()}` : ""}`;
}

function formatKitchenReceiptTime(value: string | null) {
  if (!value) return "Time not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time not available";
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay ? `Today, ${time}` : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function historyStatus(receipt: KitchenStockReceipt) {
  if (receipt.status === "delivered") return "Received";
  if (receipt.status === "rejected") return "Rejected";
  return "Unable to Fulfill";
}

type Props = {
  open: boolean;
  receipts: KitchenStockReceipt[];
  loading: boolean;
  error: string | null;
  confirmingId: string | null;
  onClose: () => void;
  onConfirm: (receipt: KitchenStockReceipt) => Promise<boolean>;
};

export function KitchenStockRequestsPanel({
  open,
  receipts,
  loading,
  error,
  confirmingId,
  onClose,
  onConfirm,
}: Props) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selected, setSelected] = useState<KitchenStockReceipt | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const { pending, history } = useMemo(() => partitionKitchenStockReceipts(receipts), [receipts]);

  useEffect(() => {
    if (!open) {
      setHistoryOpen(false);
      setSelected(null);
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (selected) setSelected(null);
      else onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open, selected]);

  if (!open) return null;

  return (
    <>
      <button className="kd-stock-panel-backdrop" type="button" aria-label="Close stock requests" onClick={onClose} />
      <section id="kitchen-stock-requests-panel" ref={panelRef} className="kd-stock-panel" aria-label="Stock Requests">
        <header className="kd-stock-panel-header">
          <div>
            <h2>Stock Requests</h2>
            <p>{pending.length === 1 ? "1 waiting for confirmation" : `${pending.length} waiting for confirmation`}</p>
          </div>
          <button type="button" aria-label="Close stock requests" onClick={onClose}>×</button>
        </header>

        <div className="kd-stock-panel-scroll">
          {loading ? <p className="kd-stock-state" role="status">Loading stock requests…</p> : null}
          {error ? <p className="kd-stock-state error" role="alert">{error}</p> : null}
          {!loading && !error && !historyOpen && pending.length === 0 ? (
            <div className="kd-stock-empty">
              <strong>No stock is waiting for confirmation.</strong>
              <span>Recently completed requests can be viewed in History.</span>
            </div>
          ) : null}

          {!historyOpen ? pending.map((receipt) => (
            <article className="kd-stock-card" key={receipt.id}>
              <div className="kd-stock-card-primary">
                <strong>{receipt.itemName}</strong>
                <b>{formatKitchenReceiptQuantity(receipt.issuedQuantity, receipt.unit)}</b>
              </div>
              <p>From {receipt.storageLocationName || "Inventory storage"}</p>
              <time dateTime={receipt.issuedAt ?? undefined}>Issued {formatKitchenReceiptTime(receipt.issuedAt)}</time>
              <button
                type="button"
                disabled={confirmingId !== null}
                onClick={() => setSelected(receipt)}
              >
                {confirmingId === receipt.id ? "Confirming…" : "Confirm Received"}
              </button>
            </article>
          )) : null}

          {historyOpen ? (
            <div className="kd-stock-history">
              {history.length === 0 ? <p className="kd-stock-state">No recent request history.</p> : history.map((receipt) => (
                <article className="kd-stock-history-row" key={receipt.id}>
                  <div><strong>{receipt.itemName}</strong><b>{formatKitchenReceiptQuantity(receipt.issuedQuantity, receipt.unit)}</b></div>
                  <p>{receipt.stationName || "Kitchen station"}</p>
                  {receipt.status === "delivered" ? (
                    <small className="kd-stock-history-received">Received by {receipt.confirmedByName || "Kitchen staff"} · {formatKitchenReceiptTime(receipt.confirmedAt)}</small>
                  ) : (
                    <small>{historyStatus(receipt)} · Requested {formatKitchenReceiptTime(receipt.requestedAt)}</small>
                  )}
                </article>
              ))}
            </div>
          ) : null}
        </div>

        <footer className="kd-stock-panel-footer">
          <button type="button" onClick={() => setHistoryOpen((value) => !value)}>
            {historyOpen ? "Back to waiting" : "View request history"}
          </button>
        </footer>
      </section>

      {selected ? (
        <div className="kd-receipt-dialog-layer" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && confirmingId === null) setSelected(null);
        }}>
          <section className="kd-receipt-dialog" role="dialog" aria-modal="true" aria-labelledby="kd-receipt-dialog-title">
            <header>
              <div>
                <h2 id="kd-receipt-dialog-title">Confirm receipt</h2>
                <strong>{selected.itemName} · {formatKitchenReceiptQuantity(selected.issuedQuantity, selected.unit)}</strong>
              </div>
            </header>
            <p>Confirm that {formatKitchenReceiptQuantity(selected.issuedQuantity, selected.unit)} of {selected.itemName} was received from {selected.storageLocationName || "Inventory storage"}.</p>
            <footer>
              <button type="button" disabled={confirmingId !== null} onClick={() => setSelected(null)}>Cancel</button>
              <button type="button" disabled={confirmingId !== null} onClick={async () => {
                if (await onConfirm(selected)) setSelected(null);
              }}>{confirmingId === selected.id ? "Confirming…" : "Confirm Received"}</button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}

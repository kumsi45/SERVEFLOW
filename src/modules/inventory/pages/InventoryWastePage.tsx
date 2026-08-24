import { useMemo, useRef, useState } from "react";
import { useOperationalNotice } from "../../../core/presentation/useOperationalNotice";
import { wasteInventoryStock } from "../services/wasteService";
import { inferMaterialStorageChoices, resolveInferredStorage } from "../services/inventoryStorageInference";
import type {
  InventoryAdminData,
  InventoryCurrentStockRow,
  InventoryItem,
  InventoryLedgerEntry,
  InventoryWasteDraft,
} from "../types";
import "../styles/inventoryAdjustments.css";

type Props = {
  restaurantId: string;
  staffRole: string;
  items: InventoryItem[];
  currentStock: InventoryCurrentStockRow[];
  ledger: InventoryLedgerEntry[];
  context: InventoryAdminData & { currentStock: InventoryCurrentStockRow[] };
  onChanged: () => void | Promise<void>;
};

const WASTE_REASONS = [
  "Spoilage", "Expired", "Damaged", "Preparation Waste", "Spillage", "Contamination", "Other Waste",
] as const;

const emptyWaste = (): InventoryWasteDraft => ({
  inventoryItemId: "",
  storageLocationId: "",
  quantity: "",
  reason: "",
  isSpoilage: false,
  notes: "",
  movementDate: "",
});

const quantityLabel = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
const dateTimeLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export function InventoryWastePage({
  restaurantId,
  staffRole,
  items,
  currentStock,
  ledger,
  context,
  onChanged,
}: Props) {
  const [draft, setDraft] = useState<InventoryWasteDraft>(emptyWaste);
  const [working, setWorking] = useState(false);
  const submissionInFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useOperationalNotice(message, setMessage);

  const activeItems = useMemo(() => items.filter((item) => item.status === "active"), [items]);
  const sourceChoices = useMemo(() => inferMaterialStorageChoices(context, restaurantId, draft.inventoryItemId, "positive-source"), [context, draft.inventoryItemId, restaurantId]);
  const selectedStock = currentStock.find((row) => (
    row.inventoryItemId === draft.inventoryItemId && row.storageLocationId === draft.storageLocationId
  ));
  const available = selectedStock?.currentQuantity ?? 0;
  const quantity = Number(draft.quantity) || 0;
  const after = available - quantity;
  const unit = selectedStock?.unitName ?? currentStock.find((row) => row.inventoryItemId === draft.inventoryItemId)?.unitName ?? "units";
  const canRecord = ["owner", "manager", "inventory_officer"].includes(staffRole);
  const history = ledger.filter((entry) => entry.movementType === "waste" || entry.movementType === "spoilage");

  function selectMaterial(inventoryItemId: string) {
    const choices = inferMaterialStorageChoices(context, restaurantId, inventoryItemId, "positive-source");
    setDraft({ ...draft, inventoryItemId, storageLocationId: resolveInferredStorage("", choices), quantity: "" });
    setError(null);
  }

  async function submit() {
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      await wasteInventoryStock(restaurantId, draft, context);
      await Promise.resolve(onChanged());
      setDraft(emptyWaste());
      setMessage("Waste recorded. Inventory and movement history were updated once.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Waste could not be recorded.");
    } finally {
      submissionInFlight.current = false;
      setWorking(false);
    }
  }

  return (
    <div className="iad-page iaw-page">
      <header className="iad-heading"><div><h2>Waste</h2></div></header>
      {!canRecord && <div className="ia-alert">Waste history is read only for your role.</div>}
      {error && <div className="ia-alert error" role="alert">{error}</div>}
      {message && <div className="ia-operation-toast" role="status" aria-live="polite"><span>{message}</span><button type="button" aria-label="Dismiss success message" onClick={() => setMessage(null)}>×</button></div>}

      {canRecord && <form className="iad-editor iaw-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label>Material *<select required value={draft.inventoryItemId} onChange={(event) => selectMaterial(event.target.value)}><option value="">Select material</option>{activeItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {draft.inventoryItemId && sourceChoices.length === 1 ? <div className="ia-so-auto-storage"><span>Storage</span><strong>{sourceChoices[0].name}</strong><small>{quantityLabel(sourceChoices[0].quantity)} {sourceChoices[0].unitName} available</small></div>
          : draft.inventoryItemId && sourceChoices.length > 0 ? <label>Storage *<select required value={draft.storageLocationId} onChange={(event) => setDraft({ ...draft, storageLocationId: event.target.value, quantity: "" })}><option value="">Select storage</option>{sourceChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name} — {quantityLabel(choice.quantity)} {choice.unitName}</option>)}</select></label>
            : draft.inventoryItemId ? <div className="ia-so-error ia-so-inline-state">No available stock exists for this material.</div> : null}
        <label>Quantity *<input required min="0.001" step="0.001" type="number" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} /></label>
        <label>Reason *<select required value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value, isSpoilage: event.target.value === "Spoilage" })}><option value="">Select reason</option>{WASTE_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}</select></label>
        <label className="wide">Note <span>(optional)</span><input maxLength={1000} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Short waste note" /></label>
        <div className={`iad-stock-preview iaw-stock-preview${after < 0 ? " invalid" : ""}`} aria-live="polite"><span>Available → After waste</span><strong>{quantityLabel(available)} {unit} → {quantityLabel(after)} {unit}</strong></div>
        <footer><button type="submit" disabled={working}>{working ? "Recording..." : "Record Waste"}</button></footer>
      </form>}

      <section className="iad-history" aria-label="Waste history">
        {history.slice(0, 50).map((entry) => <article className="iad-card" key={entry.id}>
          <header><div><span>{entry.movementType === "spoilage" ? "SPOILAGE" : "WASTE"}</span><h3>{entry.reason ?? (entry.movementType === "spoilage" ? "Spoilage" : "Waste")}</h3></div><span className="iad-status confirmed">Recorded</span></header>
          <dl><div><dt>Material</dt><dd>{entry.itemName}</dd></div><div><dt>Storage</dt><dd>{entry.storageLocationName}</dd></div><div><dt>Quantity</dt><dd>{quantityLabel(entry.quantity)} {entry.unitName}</dd></div><div><dt>Date</dt><dd>{dateTimeLabel(entry.movementDate)}</dd></div></dl>
          {entry.notes && <p>{entry.notes}</p>}
          <footer><span>Recorded by {entry.staffName ?? "Inventory staff"}</span><strong>Physical stock loss</strong></footer>
        </article>)}
        {!history.length && <div className="ia-empty">No waste recorded yet.</div>}
      </section>
    </div>
  );
}

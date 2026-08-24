import { useCallback, useEffect, useMemo, useState } from "react";
import { useOperationalNotice } from "../../../core/presentation/useOperationalNotice";
import {
  CORRECTION_REASON_LABELS,
  confirmInventoryAdjustment,
  correctionHistoryPresentation,
  loadInventoryAdjustments,
  validCorrectionReasons,
  validateInventoryAdjustment,
} from "../services/inventoryAdjustmentService";
import {
  activeTenantStorageChoices,
  inferMaterialStorageChoices,
} from "../services/inventoryStorageInference";
import type {
  InventoryAdjustment,
  InventoryAdjustmentDirection,
  InventoryAdjustmentForm,
  InventoryAdjustmentFormLine,
  InventoryCorrectionReason,
  InventoryCurrentStockRow,
  InventoryItem,
  InventoryStorageLocation,
} from "../types";
import "../styles/inventoryAdjustments.css";

type Props = {
  restaurantId: string;
  staffRole: string;
  items: InventoryItem[];
  currentStock: InventoryCurrentStockRow[];
  storageLocations: InventoryStorageLocation[];
  onChanged: () => void | Promise<void>;
};

const emptyLine = (): InventoryAdjustmentFormLine => ({ inventoryItemId: "", storageLocationId: "", quantity: "" });
const emptyForm = (): InventoryAdjustmentForm => ({
  direction: "increase",
  correctionReason: "",
  notes: "",
  lines: [emptyLine()],
});

const statusLabel = (value: string) => value === "confirmed" ? "Confirmed" : value;

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function quantityLabel(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
}

export function InventoryAdjustmentsPage({ restaurantId, staffRole, items, currentStock, storageLocations, onChanged }: Props) {
  const [history, setHistory] = useState<InventoryAdjustment[]>([]);
  const [form, setForm] = useState<InventoryAdjustmentForm | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "confirmed">("all");
  const [itemFilter, setItemFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useOperationalNotice(message, setMessage);
  const activeItems = useMemo(() => items.filter((item) => item.status === "active"), [items]);
  const canCreate = ["owner", "manager", "inventory_officer"].includes(staffRole);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setHistory(await loadInventoryAdjustments(restaurantId));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Inventory adjustment history is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => { void load(); }, [load]);

  const stockByItemStorage = useMemo(() => {
    const result = new Map<string, number>();
    for (const stock of currentStock) {
      const key = `${stock.inventoryItemId}:${stock.storageLocationId}`;
      result.set(key, (result.get(key) ?? 0) + stock.currentQuantity);
    }
    return result;
  }, [currentStock]);

  const filtered = useMemo(() => history.filter((adjustment) => {
    if (adjustment.adjustmentType !== "opening_stock" && adjustment.adjustmentType !== "manual_correction") return false;
    if (statusFilter !== "all" && adjustment.status !== statusFilter) return false;
    if (itemFilter && !adjustment.items.some((item) => item.inventoryItemId === itemFilter)) return false;
    const created = new Date(adjustment.createdAt);
    if (dateFrom && created < new Date(`${dateFrom}T00:00:00`)) return false;
    if (dateTo && created.getTime() >= new Date(`${dateTo}T00:00:00`).getTime() + 24 * 60 * 60 * 1000) return false;
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [
      adjustment.id,
      adjustment.reason,
      adjustment.notes,
      adjustment.createdByName,
      adjustment.approvedByName,
      ...adjustment.items.flatMap((item) => [item.inventoryItemName, item.movementAuditType]),
    ].some((value) => (value ?? "").toLowerCase().includes(query));
  }), [dateFrom, dateTo, history, itemFilter, search, statusFilter]);

  function updateLine(index: number, patch: Partial<InventoryAdjustmentFormLine>) {
    setForm((current) => current ? {
      ...current,
      lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line),
    } : current);
  }

  function storageResolutionFor(inventoryItemId: string, direction: InventoryAdjustmentDirection) {
    const existing = inferMaterialStorageChoices(
      { currentStock, storageLocations }, restaurantId, inventoryItemId,
      direction === "increase" ? "relationship" : "positive-source",
    );
    const unitName = currentStock.find((row) => row.inventoryItemId === inventoryItemId)?.unitName ?? "units";
    return {
      choices: direction === "increase" && existing.length === 0
        ? activeTenantStorageChoices({ currentStock, storageLocations }, restaurantId, unitName)
        : existing,
      autoStorageId: existing.length === 1 ? existing[0].id : "",
    };
  }

  function selectMaterial(index: number, inventoryItemId: string) {
    if (!form) return;
    const resolution = storageResolutionFor(inventoryItemId, form.direction);
    updateLine(index, { inventoryItemId, storageLocationId: resolution.autoStorageId, quantity: "" });
  }

  function changeDirection(direction: InventoryAdjustmentDirection) {
    setReviewing(false);
    setForm((current) => current ? {
      ...current,
      direction,
      correctionReason: "",
      lines: current.lines.map((line) => ({
        ...line,
        storageLocationId: storageResolutionFor(line.inventoryItemId, direction).autoStorageId,
      })),
    } : current);
  }

  function review() {
    if (!form) return;
    const errors = validateInventoryAdjustment(form, activeItems, currentStock, storageLocations);
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }
    setError(null);
    setMessage(null);
    setReviewing(true);
  }

  async function confirm() {
    if (!form) return;
    try {
      setWorking(true);
      setError(null);
      const result = await confirmInventoryAdjustment(restaurantId, form, activeItems, currentStock, storageLocations);
      await Promise.all([load(), Promise.resolve(onChanged())]);
      setForm(null);
      setReviewing(false);
      setMessage(result.already_processed
        ? "This adjustment was already confirmed; inventory was not changed again."
        : "Adjustment confirmed. Inventory and movement history were updated atomically.");
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "Inventory adjustment could not be confirmed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="iad-page">
      <header className="iad-heading">
        <div><h2>Inventory Adjustments</h2></div>
        {canCreate && <button type="button" onClick={() => { setForm(emptyForm()); setReviewing(false); setError(null); setMessage(null); }}>Create Adjustment</button>}
      </header>

      {!canCreate && <div className="ia-alert">Adjustment history is read only for your role.</div>}
      {error && <div className="ia-alert error" role="alert">{error}</div>}
      {message && <div className="ia-operation-toast" role="status" aria-live="polite"><span>{message}</span><button type="button" aria-label="Dismiss success message" onClick={() => setMessage(null)}>×</button></div>}

      {form && !reviewing && (
        <form className="iad-editor" onSubmit={(event) => { event.preventDefault(); review(); }}>
          <div className="iad-editor-heading"><h3>New Adjustment</h3><span>Step 1 of 2</span></div>
          <div className="iad-direction" role="group" aria-label="Adjustment direction">
            <button className={form.direction === "increase" ? "active increase" : ""} type="button" onClick={() => changeDirection("increase")}>Increase</button>
            <button className={form.direction === "decrease" ? "active decrease" : ""} type="button" onClick={() => changeDirection("decrease")}>Decrease</button>
          </div>
          <div className="iad-header-fields">
            <label>Reason<select required value={form.correctionReason} onChange={(event) => setForm({ ...form, correctionReason: event.target.value as InventoryCorrectionReason })}><option value="">Select reason</option>{validCorrectionReasons(form.direction).map((reason) => <option key={reason} value={reason}>{CORRECTION_REASON_LABELS[reason]}</option>)}</select></label>
            <label className="wide">Note <span>(optional)</span><input maxLength={900} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Short correction note" /></label>
          </div>
          <div className="iad-lines">
            {form.lines.map((line, index) => {
              const item = activeItems.find((candidate) => candidate.id === line.inventoryItemId);
              const storageResolution = storageResolutionFor(line.inventoryItemId, form.direction);
              const storageChoices = storageResolution.choices;
              const selectedStorage = storageChoices.find((choice) => choice.id === line.storageLocationId);
              const current = stockByItemStorage.get(`${line.inventoryItemId}:${line.storageLocationId}`) ?? 0;
              const quantity = Number(line.quantity) || 0;
              const after = form.direction === "increase" ? current + quantity : current - quantity;
              return (
                <div className="iad-line" key={`${index}:${line.inventoryItemId}`}>
                  <label>Material<select required value={line.inventoryItemId} onChange={(event) => selectMaterial(index, event.target.value)}><option value="">Select material</option>{activeItems.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
                  {line.inventoryItemId && storageResolution.autoStorageId ? <div className="ia-so-auto-storage"><span>Storage</span><strong>{storageChoices[0].name}</strong><small>Current {quantityLabel(storageChoices[0].quantity)} {storageChoices[0].unitName}</small></div>
                    : line.inventoryItemId && storageChoices.length > 0 ? <label>Storage<select required value={line.storageLocationId} onChange={(event) => updateLine(index, { storageLocationId: event.target.value, quantity: "" })}><option value="">Select storage</option>{storageChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name} — {quantityLabel(choice.quantity)} {choice.unitName}</option>)}</select></label>
                      : line.inventoryItemId ? <div className="ia-so-error ia-so-inline-state">No available source stock exists for this material.</div> : null}
                  <label>Quantity<input required min="0.001" step="0.001" type="number" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} /></label>
                  <div className="iad-stock-preview"><span>Current → After</span><strong>{quantityLabel(current)} → {quantityLabel(after)}</strong>{item && <small>{selectedStorage?.unitName ?? currentStock.find((stock) => stock.inventoryItemId === item.id)?.unitName ?? "units"}</small>}</div>
                </div>
              );
            })}
          </div>
          <footer><button type="button" onClick={() => setForm(null)}>Cancel</button><button type="submit">Review Adjustment</button></footer>
        </form>
      )}

      {form && reviewing && (
        <section className="iad-editor iad-review" aria-label="Review inventory adjustment">
          <div className="iad-editor-heading"><h3>Review Adjustment</h3><span>Step 2 of 2</span></div>
          <dl><div><dt>Direction</dt><dd>{form.direction === "increase" ? "Increase" : "Decrease"}</dd></div><div><dt>Reason</dt><dd>{CORRECTION_REASON_LABELS[form.correctionReason as InventoryCorrectionReason]}</dd></div><div><dt>Status</dt><dd>Ready to confirm</dd></div></dl>
          <div className="iad-review-lines">{form.lines.map((line) => {
            const item = activeItems.find((candidate) => candidate.id === line.inventoryItemId);
            const before = stockByItemStorage.get(`${line.inventoryItemId}:${line.storageLocationId}`) ?? 0;
            const quantity = Number(line.quantity);
            const after = form.direction === "increase" ? before + quantity : before - quantity;
            const stock = currentStock.find((candidate) => candidate.inventoryItemId === line.inventoryItemId && candidate.storageLocationId === line.storageLocationId);
            const storage = storageLocations.find((candidate) => candidate.id === line.storageLocationId);
            const unit = stock?.unitName ?? "units";
            return <div key={line.inventoryItemId}><strong>{item?.name}<small>{storage?.name}</small></strong><span>{form.direction === "increase" ? "+" : "−"}{quantityLabel(quantity)} {unit}</span><span>{quantityLabel(before)} → {quantityLabel(after)} {unit}</span></div>;
          })}</div>
          {form.notes.trim() && <p>{form.notes}</p>}
          <div className="iad-warning">Confirmation immediately updates inventory and creates immutable movement records. This action cannot be edited or deleted.</div>
          <footer><button type="button" disabled={working} onClick={() => setReviewing(false)}>Back</button><button type="button" disabled={working} onClick={() => void confirm()}>{working ? "Confirming..." : "Confirm Adjustment"}</button></footer>
        </section>
      )}

      <details className="ia-collapsible-filters"><summary>Filters <span aria-hidden="true">▼</span></summary><section className="iad-filters" aria-label="Adjustment history filters">
        <label>Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search item, reason, user, or movement" /></label>
        <label>Date From<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label>Date To<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
        <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "confirmed")}><option value="all">All statuses</option><option value="confirmed">Confirmed</option></select></label>
        <label>Material<select value={itemFilter} onChange={(event) => setItemFilter(event.target.value)}><option value="">All materials</option>{items.filter((item) => item.status !== "deleted").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </section></details>

      {loading ? <div className="ia-empty">Loading adjustment history...</div> : (
        <section className="iad-history" aria-label="Adjustment history">
          {filtered.map((adjustment) => {
            const presentation = correctionHistoryPresentation(adjustment);
            return (
            <article className="iad-card" key={adjustment.id}>
              <header><div><span>ADJ {adjustment.id.slice(0, 8).toUpperCase()}</span><h3>{presentation.reason}</h3></div><span className={`iad-status ${adjustment.status}`}>{statusLabel(adjustment.status)}</span></header>
              <dl><div><dt>Direction</dt><dd className={adjustment.direction}>{adjustment.direction === "increase" ? "Increase" : "Decrease"}</dd></div><div><dt>Date</dt><dd>{dateTimeLabel(adjustment.createdAt)}</dd></div><div><dt>Created By</dt><dd>{adjustment.createdByName}</dd></div><div><dt>Approved By</dt><dd>{adjustment.approvedByName ?? "Not approved"}</dd></div></dl>
              <div className="iad-history-lines">{adjustment.items.map((item) => <div key={item.id}><strong>{item.inventoryItemName}{item.storageLocationName && <small>{item.storageLocationName}</small>}</strong><span>{item.movementAuditType.replace(/_/g, " ")}</span><span>{quantityLabel(item.quantityBefore)} → {quantityLabel(item.quantityAfter)} {item.unitName}</span></div>)}</div>
              {presentation.note && <p>{presentation.note}</p>}
              <footer><span>{adjustment.itemCount} item{adjustment.itemCount === 1 ? "" : "s"}</span><strong>Total quantity: {quantityLabel(adjustment.totalQuantity)}</strong></footer>
            </article>
          );})}
          {!filtered.length && <div className="ia-empty">No inventory adjustments match the current filters.</div>}
        </section>
      )}
    </div>
  );
}

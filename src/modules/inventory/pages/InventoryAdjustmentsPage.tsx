import { useCallback, useEffect, useMemo, useState } from "react";
import { useOperationalNotice } from "../../../core/presentation/useOperationalNotice";
import {
  ADJUSTMENT_TYPE_LABELS,
  confirmInventoryAdjustment,
  loadInventoryAdjustments,
  validAdjustmentTypes,
  validateInventoryAdjustment,
} from "../services/inventoryAdjustmentService";
import type {
  InventoryAdjustment,
  InventoryAdjustmentDirection,
  InventoryAdjustmentForm,
  InventoryAdjustmentFormLine,
  InventoryAdjustmentType,
  InventoryCurrentStockRow,
  InventoryItem,
} from "../types";
import "../styles/inventoryAdjustments.css";

type Props = {
  restaurantId: string;
  staffRole: string;
  items: InventoryItem[];
  currentStock: InventoryCurrentStockRow[];
  onChanged: () => void | Promise<void>;
};

const emptyLine = (): InventoryAdjustmentFormLine => ({ inventoryItemId: "", quantity: "" });
const emptyForm = (): InventoryAdjustmentForm => ({
  direction: "increase",
  adjustmentType: "",
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

export function InventoryAdjustmentsPage({ restaurantId, staffRole, items, currentStock, onChanged }: Props) {
  const [history, setHistory] = useState<InventoryAdjustment[]>([]);
  const [form, setForm] = useState<InventoryAdjustmentForm | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "confirmed">("all");
  const [itemFilter, setItemFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | InventoryAdjustmentType>("all");
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

  const stockByItem = useMemo(() => {
    const result = new Map<string, number>();
    for (const stock of currentStock) {
      result.set(stock.inventoryItemId, (result.get(stock.inventoryItemId) ?? 0) + stock.currentQuantity);
    }
    return result;
  }, [currentStock]);

  const filtered = useMemo(() => history.filter((adjustment) => {
    if (statusFilter !== "all" && adjustment.status !== statusFilter) return false;
    if (typeFilter !== "all" && adjustment.adjustmentType !== typeFilter) return false;
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
  }), [dateFrom, dateTo, history, itemFilter, search, statusFilter, typeFilter]);

  function updateLine(index: number, patch: Partial<InventoryAdjustmentFormLine>) {
    setForm((current) => current ? {
      ...current,
      lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line),
    } : current);
  }

  function changeDirection(direction: InventoryAdjustmentDirection) {
    setReviewing(false);
    setForm((current) => current ? { ...current, direction, adjustmentType: "" } : current);
  }

  function review() {
    if (!form) return;
    const errors = validateInventoryAdjustment(form, activeItems, currentStock);
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
      const result = await confirmInventoryAdjustment(restaurantId, form, activeItems, currentStock);
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
        <div><span>Operational Stock Control</span><h2>Inventory Adjustments</h2><p>Review and confirm manual increases, decreases, waste, spoilage, and supplier returns.</p></div>
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
            <label>Reason<select required value={form.adjustmentType} onChange={(event) => setForm({ ...form, adjustmentType: event.target.value as InventoryAdjustmentType })}><option value="">Select reason</option>{validAdjustmentTypes(form.direction).map((type) => <option key={type} value={type}>{ADJUSTMENT_TYPE_LABELS[type]}</option>)}</select></label>
            <label className="wide">Notes<textarea maxLength={1000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Optional operational details" /></label>
          </div>
          <div className="iad-lines-heading"><h3>Ingredients</h3><button type="button" onClick={() => setForm({ ...form, lines: [...form.lines, emptyLine()] })}>Add Ingredient</button></div>
          <div className="iad-lines">
            {form.lines.map((line, index) => {
              const item = activeItems.find((candidate) => candidate.id === line.inventoryItemId);
              const current = stockByItem.get(line.inventoryItemId) ?? 0;
              const quantity = Number(line.quantity) || 0;
              const after = form.direction === "increase" ? current + quantity : current - quantity;
              return (
                <div className="iad-line" key={`${index}:${line.inventoryItemId}`}>
                  <label>Ingredient<select required value={line.inventoryItemId} onChange={(event) => updateLine(index, { inventoryItemId: event.target.value })}><option value="">Select ingredient</option>{activeItems.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
                  <label>Quantity<input required min="0.001" step="0.001" type="number" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} /></label>
                  <div className="iad-stock-preview"><span>Current → After</span><strong>{quantityLabel(current)} → {quantityLabel(after)}</strong>{item && <small>{currentStock.find((stock) => stock.inventoryItemId === item.id)?.unitName ?? "units"}</small>}</div>
                  <button className="danger" disabled={form.lines.length === 1} type="button" onClick={() => setForm({ ...form, lines: form.lines.filter((_, lineIndex) => lineIndex !== index) })}>Remove</button>
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
          <dl><div><dt>Direction</dt><dd>{form.direction === "increase" ? "Increase" : "Decrease"}</dd></div><div><dt>Reason</dt><dd>{ADJUSTMENT_TYPE_LABELS[form.adjustmentType as InventoryAdjustmentType]}</dd></div><div><dt>Status</dt><dd>Ready to confirm</dd></div></dl>
          <div className="iad-review-lines">{form.lines.map((line) => {
            const item = activeItems.find((candidate) => candidate.id === line.inventoryItemId);
            const before = stockByItem.get(line.inventoryItemId) ?? 0;
            const quantity = Number(line.quantity);
            const after = form.direction === "increase" ? before + quantity : before - quantity;
            return <div key={line.inventoryItemId}><strong>{item?.name}</strong><span>{form.direction === "increase" ? "+" : "−"}{quantityLabel(quantity)}</span><span>{quantityLabel(before)} → {quantityLabel(after)}</span></div>;
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
        <label>Ingredient<select value={itemFilter} onChange={(event) => setItemFilter(event.target.value)}><option value="">All ingredients</option>{items.filter((item) => item.status !== "deleted").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Adjustment Type<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "all" | InventoryAdjustmentType)}><option value="all">All types</option>{Object.entries(ADJUSTMENT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </section></details>

      {loading ? <div className="ia-empty">Loading adjustment history...</div> : (
        <section className="iad-history" aria-label="Adjustment history">
          {filtered.map((adjustment) => (
            <article className="iad-card" key={adjustment.id}>
              <header><div><span>ADJ {adjustment.id.slice(0, 8).toUpperCase()}</span><h3>{adjustment.reason}</h3></div><span className={`iad-status ${adjustment.status}`}>{statusLabel(adjustment.status)}</span></header>
              <dl><div><dt>Direction</dt><dd className={adjustment.direction}>{adjustment.direction === "increase" ? "Increase" : "Decrease"}</dd></div><div><dt>Date</dt><dd>{dateTimeLabel(adjustment.createdAt)}</dd></div><div><dt>Created By</dt><dd>{adjustment.createdByName}</dd></div><div><dt>Approved By</dt><dd>{adjustment.approvedByName ?? "Not approved"}</dd></div></dl>
              <div className="iad-history-lines">{adjustment.items.map((item) => <div key={item.id}><strong>{item.inventoryItemName}</strong><span>{item.movementAuditType.replace(/_/g, " ")}</span><span>{quantityLabel(item.quantityBefore)} → {quantityLabel(item.quantityAfter)} {item.unitName}</span></div>)}</div>
              {adjustment.notes && <p>{adjustment.notes}</p>}
              <footer><span>{adjustment.itemCount} item{adjustment.itemCount === 1 ? "" : "s"}</span><strong>Total quantity: {quantityLabel(adjustment.totalQuantity)}</strong></footer>
            </article>
          ))}
          {!filtered.length && <div className="ia-empty">No inventory adjustments match the current filters.</div>}
        </section>
      )}
    </div>
  );
}

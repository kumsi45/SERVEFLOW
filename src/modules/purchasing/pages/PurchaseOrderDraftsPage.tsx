import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOperationalNotice } from "../../../core/presentation/useOperationalNotice";
import type { InventoryItem, InventorySupplier, InventoryUnit } from "../../inventory/types";
import {
  deletePurchaseOrderDraft,
  loadPurchaseOrderDrafts,
  purchaseOrderLineTotal,
  purchaseOrderTotal,
  receivePurchaseOrder,
  savePurchaseOrderDraft,
} from "../services/purchaseOrderDraftService";
import type {
  PurchaseOrderDraft,
  PurchaseOrderDraftForm,
  PurchaseOrderDraftFormLine,
  PurchaseOrderReceiptForm,
  PurchaseOrderStatus,
} from "../types";
import "../styles/purchaseOrderDrafts.css";

type Props = {
  restaurantId: string;
  suppliers: InventorySupplier[];
  items: InventoryItem[];
  units: InventoryUnit[];
};

const emptyLine = (): PurchaseOrderDraftFormLine => ({
  inventoryItemId: "",
  purchaseUnitId: "",
  quantity: "1",
  unitPrice: "0",
});

const emptyForm = (): PurchaseOrderDraftForm => ({
  supplierId: "",
  expectedDeliveryDate: "",
  notes: "",
  lines: [emptyLine()],
});

const editForm = (draft: PurchaseOrderDraft): PurchaseOrderDraftForm => ({
  id: draft.id,
  supplierId: draft.supplierId,
  expectedDeliveryDate: draft.expectedDeliveryDate,
  notes: draft.notes ?? "",
  lines: draft.lines.map((line) => ({
    inventoryItemId: line.inventoryItemId,
    purchaseUnitId: line.purchaseUnitId,
    quantity: String(line.quantity),
    unitPrice: String(line.unitPrice),
  })),
});

const receiptForm = (order: PurchaseOrderDraft): PurchaseOrderReceiptForm => ({
  purchaseOrderId: order.id,
  notes: "",
  lines: order.lines.filter((line) => line.remainingQuantity > 0).map((line) => ({
    purchaseOrderItemId: line.id,
    inventoryItemName: line.inventoryItemName,
    purchaseUnitName: line.purchaseUnitName,
    remainingQuantity: line.remainingQuantity,
    receivedQuantity: "",
  })),
});

const statusLabel = (status: PurchaseOrderStatus) => ({
  draft: "Draft",
  partially_received: "Partially Received",
  completed: "Completed",
})[status];

function money(value: number) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function dateLabel(value: string) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`)) : "Not set";
}

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function PurchaseOrderDraftsPage({ restaurantId, suppliers, items, units }: Props) {
  const [drafts, setDrafts] = useState<PurchaseOrderDraft[]>([]);
  const [form, setForm] = useState<PurchaseOrderDraftForm | null>(null);
  const [receipt, setReceipt] = useState<PurchaseOrderReceiptForm | null>(null);
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | PurchaseOrderStatus>("all");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useOperationalNotice(message, setMessage);
  const receiptEditorRef = useRef<HTMLElement | null>(null);
  const activeSuppliers = suppliers.filter((supplier) => supplier.status === "active");
  const filterSuppliers = suppliers.filter((supplier) => supplier.status !== "deleted");
  const activeItems = items.filter((item) => item.status === "active");
  const activeUnits = units.filter((unit) => unit.status === "active" && unit.active);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setDrafts(await loadPurchaseOrderDrafts(restaurantId));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Purchase orders are unavailable.");
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!receipt) return;
    const frame = window.requestAnimationFrame(() => {
      const editor = receiptEditorRef.current;
      if (!editor) return;
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      editor.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
      editor.querySelector<HTMLInputElement>('input[type="number"]')?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [receipt?.purchaseOrderId]);

  const filteredDrafts = useMemo(() => drafts.filter((draft) => {
    if (supplierFilter && draft.supplierId !== supplierFilter) return false;
    if (statusFilter !== "all" && draft.status !== statusFilter) return false;
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [
      draft.id,
      `purchase order ${draft.id.slice(0, 8)}`,
      statusLabel(draft.status),
      draft.supplierName,
      draft.notes,
      ...draft.lines.map((line) => line.inventoryItemName),
    ].some((value) => (value ?? "").toLowerCase().includes(query));
  }), [drafts, search, statusFilter, supplierFilter]);

  function updateLine(index: number, patch: Partial<PurchaseOrderDraftFormLine>) {
    setForm((current) => current ? {
      ...current,
      lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line),
    } : current);
  }

  async function save() {
    if (!form) return;
    try {
      setWorking(true);
      setError(null);
      setMessage(null);
      await savePurchaseOrderDraft(restaurantId, form, activeSuppliers, activeItems, activeUnits);
      await load();
      setForm(null);
      setMessage(form.id ? "Purchase order draft updated." : "Purchase order draft created.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Purchase order draft could not be saved.");
    } finally {
      setWorking(false);
    }
  }

  async function remove(draft: PurchaseOrderDraft) {
    if (!window.confirm(`Delete draft ${draft.id.slice(0, 8).toUpperCase()}? This cannot be undone.`)) return;
    try {
      setWorking(true);
      setError(null);
      const deleted = await deletePurchaseOrderDraft(restaurantId, draft.id);
      if (!deleted) throw new Error("Purchase order draft no longer exists.");
      setDrafts((current) => current.filter((row) => row.id !== draft.id));
      if (form?.id === draft.id) setForm(null);
      setMessage("Purchase order draft deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Purchase order draft could not be deleted.");
    } finally {
      setWorking(false);
    }
  }

  function openReceipt(order: PurchaseOrderDraft) {
    setForm(null);
    setReceipt(receiptForm(order));
    setError(null);
    setMessage(null);
  }

  function updateReceiptLine(index: number, receivedQuantity: string) {
    setReceipt((current) => current ? {
      ...current,
      lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, receivedQuantity } : line),
    } : current);
  }

  async function receive() {
    if (!receipt) return;
    try {
      setWorking(true);
      setError(null);
      setMessage(null);
      const result = await receivePurchaseOrder(restaurantId, receipt);
      await load();
      setReceipt(null);
      setMessage(result.already_processed
        ? "This receipt was already processed; stock was not increased again."
        : `Purchase order ${statusLabel(result.status).toLowerCase()}. Inventory and movement history were updated.`);
    } catch (receiveError) {
      setError(receiveError instanceof Error ? receiveError.message : "Purchase order could not be received.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="po-page">
      <header className="po-heading">
        <div><span>Purchasing</span><h2>Purchase Orders</h2><p>Create drafts, receive partial deliveries, and track remaining quantities.</p></div>
        <button type="button" onClick={() => { setReceipt(null); setForm(emptyForm()); }}>Create Draft</button>
      </header>
      {error && <div className="ia-alert error" role="alert">{error}</div>}
      {message && <div className="ia-operation-toast" role="status" aria-live="polite"><span>{message}</span><button type="button" aria-label="Dismiss success message" onClick={() => setMessage(null)}>×</button></div>}

      {form && (
        <section className="po-editor" aria-label={form.id ? "Edit purchase order draft" : "Create purchase order draft"}>
          <div className="po-editor-heading"><h3>{form.id ? `Edit Draft ${form.id.slice(0, 8).toUpperCase()}` : "New Purchase Order Draft"}</h3><span>Draft</span></div>
          <div className="po-header-fields">
            <label>Supplier <span>(Optional)</span><select value={form.supplierId} onChange={(event) => setForm({ ...form, supplierId: event.target.value })}><option value="">No supplier</option>{activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
            <label>Expected Delivery Date<input required type="date" value={form.expectedDeliveryDate} onChange={(event) => setForm({ ...form, expectedDeliveryDate: event.target.value })} /></label>
            <label className="wide">Notes<textarea maxLength={2000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Optional supplier or delivery notes" /></label>
          </div>
          <div className="po-lines-heading"><h3>Ingredients</h3><button type="button" onClick={() => setForm({ ...form, lines: [...form.lines, emptyLine()] })}>Add Ingredient</button></div>
          <div className="po-lines">
            {form.lines.map((line, index) => (
              <div className="po-line" key={`${index}:${line.inventoryItemId}`}>
                <label>Ingredient<select required value={line.inventoryItemId} onChange={(event) => {
                  const item = activeItems.find((candidate) => candidate.id === event.target.value);
                  updateLine(index, { inventoryItemId: event.target.value, purchaseUnitId: item?.unitId ?? line.purchaseUnitId });
                }}><option value="">Select ingredient</option>{activeItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label>Quantity<input required min="0.001" step="0.001" type="number" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} /></label>
                <label>Purchase Unit<select required value={line.purchaseUnitId} onChange={(event) => updateLine(index, { purchaseUnitId: event.target.value })}><option value="">Select unit</option>{activeUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
                <label>Unit Price<input required min="0" step="0.01" type="number" value={line.unitPrice} onChange={(event) => updateLine(index, { unitPrice: event.target.value })} /></label>
                <div className="po-line-total"><span>Line Total</span><strong>{money(purchaseOrderLineTotal(line.quantity, line.unitPrice))}</strong></div>
                <button className="danger" type="button" disabled={form.lines.length === 1} onClick={() => setForm({ ...form, lines: form.lines.filter((_, lineIndex) => lineIndex !== index) })}>Remove</button>
              </div>
            ))}
          </div>
          <footer className="po-editor-footer"><div><span>Draft Total</span><strong>{money(purchaseOrderTotal(form))}</strong></div><button type="button" onClick={() => setForm(null)}>Cancel</button><button type="button" disabled={working} onClick={() => void save()}>{working ? "Saving..." : "Save Draft"}</button></footer>
        </section>
      )}

      {receipt && (
        <section ref={receiptEditorRef} className="po-editor po-receipt-editor" aria-label="Receive purchase order">
          <div className="po-editor-heading"><h3>Receive PO {receipt.purchaseOrderId.slice(0, 8).toUpperCase()}</h3><span>Stock In</span></div>
          <p className="po-receipt-help">Enter only the quantities physically received. Prices and unit conversions are preserved in the immutable receipt.</p>
          <div className="po-receipt-lines">
            {receipt.lines.map((line, index) => (
              <div className="po-receipt-line" key={line.purchaseOrderItemId}>
                <div><strong>{line.inventoryItemName}</strong><span>Remaining: {line.remainingQuantity} {line.purchaseUnitName}</span></div>
                <label>Receive Now<input min="0" max={line.remainingQuantity} step="0.001" type="number" value={line.receivedQuantity} onChange={(event) => updateReceiptLine(index, event.target.value)} /></label>
                <span>{line.purchaseUnitName}</span>
              </div>
            ))}
          </div>
          <label className="po-receipt-notes">Receipt Notes<textarea maxLength={1000} value={receipt.notes} onChange={(event) => setReceipt({ ...receipt, notes: event.target.value })} placeholder="Optional delivery notes" /></label>
          <footer className="po-editor-footer">
            <button type="button" onClick={() => setReceipt({ ...receipt, lines: receipt.lines.map((line) => ({ ...line, receivedQuantity: String(line.remainingQuantity) })) })}>Receive Remaining</button>
            <button type="button" onClick={() => setReceipt(null)}>Cancel</button>
            <button type="button" disabled={working} onClick={() => void receive()}>{working ? "Receiving..." : "Confirm Receipt"}</button>
          </footer>
        </section>
      )}

      <section className="po-filters" aria-label="Purchase order filters">
        <label>Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order, supplier, item, or notes" /></label>
        <label>Supplier<select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}><option value="">All suppliers</option>{filterSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
        <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | PurchaseOrderStatus)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="partially_received">Partially Received</option><option value="completed">Completed</option></select></label>
      </section>

      {loading ? <div className="ia-empty">Loading purchase orders...</div> : (
        <section className="po-draft-list" aria-label="Purchase orders">
          {filteredDrafts.map((draft) => (
            <article className="po-draft-card" key={draft.id}>
              <header><div><span>PO {draft.id.slice(0, 8).toUpperCase()}</span><h3>{draft.supplierName || "No supplier"}</h3></div><span className={`po-status ${draft.status}`}>{statusLabel(draft.status)}</span></header>
              <dl><div><dt>Expected Delivery</dt><dd>{dateLabel(draft.expectedDeliveryDate)}</dd></div><div><dt>Items</dt><dd>{draft.lineCount}</dd></div><div><dt>Updated</dt><dd>{dateTimeLabel(draft.updatedAt)}</dd></div><div><dt>Updated By</dt><dd>{draft.updatedByName}</dd></div></dl>
              <div className="po-draft-lines">{draft.lines.map((line) => <div key={line.id}><span>{line.inventoryItemName}</span><span>Ordered {line.quantity} · Received {line.receivedQuantity} · Remaining {line.remainingQuantity} {line.purchaseUnitName}</span><strong>{money(line.lineTotal)}</strong></div>)}</div>
              {draft.notes && <p>{draft.notes}</p>}
              <footer><div><span>Total / Remaining</span><strong>{money(draft.total)} / {money(draft.remainingTotal)}</strong></div>{draft.status !== "completed" && <button type="button" onClick={() => openReceipt(draft)}>Receive</button>}{draft.status === "draft" && <button type="button" onClick={() => { setReceipt(null); setForm(editForm(draft)); }}>Edit Draft</button>}{draft.status === "draft" && <button className="danger" type="button" disabled={working} onClick={() => void remove(draft)}>Delete Draft</button>}</footer>
            </article>
          ))}
          {filteredDrafts.length === 0 && <div className="ia-empty">No purchase orders match the current filters.</div>}
        </section>
      )}
    </div>
  );
}

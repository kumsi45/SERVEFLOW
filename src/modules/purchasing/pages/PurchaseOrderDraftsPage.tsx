import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOperationalNotice } from "../../../core/presentation/useOperationalNotice";
import type { InventoryItem, InventoryStorageLocation, InventorySupplier, InventoryUnit } from "../../inventory/types";
import { loadPurchaseOrderDrafts, purchaseOrderLineTotal, purchaseOrderTotal, receivePurchaseOrder, savePurchaseOrderDraft, validatePurchaseOrderDraft, validatePurchaseOrderReceipt } from "../services/purchaseOrderDraftService";
import type { PurchaseOrderDraft, PurchaseOrderDraftForm, PurchaseOrderDraftFormLine, PurchaseOrderReceiptForm, PurchaseOrderStatus } from "../types";
import "../styles/purchaseOrderDrafts.css";

type Props = { restaurantId: string; suppliers: InventorySupplier[]; items: InventoryItem[]; units: InventoryUnit[]; storageLocations: InventoryStorageLocation[] };
type WorkTab = "open" | "partially_received" | "completed" | "all";
const emptyLine = (): PurchaseOrderDraftFormLine => ({ inventoryItemId: "", purchaseUnitId: "", quantity: "1", unitPrice: "0" });
const emptyForm = (): PurchaseOrderDraftForm => ({ supplierId: "", expectedDeliveryDate: "", notes: "", lines: [emptyLine()] });
const editForm = (order: PurchaseOrderDraft): PurchaseOrderDraftForm => ({ id: order.id, supplierId: order.supplierId, expectedDeliveryDate: order.expectedDeliveryDate, notes: order.notes ?? "", lines: order.lines.map((line) => ({ inventoryItemId: line.inventoryItemId, purchaseUnitId: line.purchaseUnitId, quantity: String(line.quantity), unitPrice: String(line.unitPrice) })) });
const statusLabel = (status: PurchaseOrderStatus) => status === "draft" ? "Open" : status === "partially_received" ? "Partially Received" : "Completed";
const orderCode = (id: string) => `PO ${id.slice(0, 8).toUpperCase()}`;
const money = (value: number) => new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const quantity = (value: number, unit: string) => `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value)} ${unit}`.trim();
const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`));
const dateTimeLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export function sortPurchaseOrders(orders: PurchaseOrderDraft[]) {
  return [...orders].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime() || right.id.localeCompare(left.id));
}

function receiptForm(order: PurchaseOrderDraft, items: InventoryItem[], storageLocations: InventoryStorageLocation[]): PurchaseOrderReceiptForm {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const storageById = new Map(storageLocations.map((storage) => [storage.id, storage.name]));
  return { purchaseOrderId: order.id, notes: "", lines: order.lines.filter((line) => line.remainingQuantity > 0).map((line) => {
    const item = itemById.get(line.inventoryItemId);
    return { purchaseOrderItemId: line.id, inventoryItemName: line.inventoryItemName, purchaseUnitName: line.purchaseUnitName, orderedQuantity: line.quantity, alreadyReceivedQuantity: line.receivedQuantity, remainingQuantity: line.remainingQuantity, storageLocationName: item ? storageById.get(item.storageLocationId) ?? "Configured storage" : "Configured storage", receivedQuantity: String(line.remainingQuantity) };
  }) };
}

export function PurchaseOrderDraftsPage({ restaurantId, suppliers, items, units, storageLocations }: Props) {
  const [orders, setOrders] = useState<PurchaseOrderDraft[]>([]);
  const [form, setForm] = useState<PurchaseOrderDraftForm | null>(null);
  const [receipt, setReceipt] = useState<PurchaseOrderReceiptForm | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<WorkTab>("open");
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const receiptEditorRef = useRef<HTMLElement | null>(null);
  useOperationalNotice(message, setMessage);
  const activeSuppliers = suppliers.filter((supplier) => supplier.status === "active");
  const filterSuppliers = suppliers.filter((supplier) => supplier.status !== "deleted");
  const activeItems = items.filter((item) => item.status === "active");
  const activeUnits = units.filter((unit) => unit.status === "active" && unit.active);
  const selected = selectedId ? orders.find((order) => order.id === selectedId) ?? null : null;

  const load = useCallback(async () => {
    try { setLoading(true); setOrders(await loadPurchaseOrderDrafts(restaurantId)); setError(null); }
    catch { setError("Unable to load purchase orders. Try again."); }
    finally { setLoading(false); }
  }, [restaurantId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!receipt) return;
    const frame = window.requestAnimationFrame(() => receiptEditorRef.current?.querySelector<HTMLInputElement>('input[type="number"]')?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [receipt]);

  const counts = useMemo(() => ({ open: orders.filter((order) => order.status === "draft").length, partially_received: orders.filter((order) => order.status === "partially_received").length, completed: orders.filter((order) => order.status === "completed").length }), [orders]);
  const visibleOrders = useMemo(() => sortPurchaseOrders(orders).filter((order) => {
    if (tab !== "all" && order.status !== (tab === "open" ? "draft" : tab)) return false;
    if (supplierFilter && order.supplierId !== supplierFilter) return false;
    const query = search.trim().toLowerCase();
    return !query || [order.id, orderCode(order.id), order.supplierName, ...order.lines.map((line) => line.inventoryItemName)].some((value) => value.toLowerCase().includes(query));
  }), [orders, search, supplierFilter, tab]);

  function updateLine(index: number, patch: Partial<PurchaseOrderDraftFormLine>) { setForm((current) => current ? { ...current, lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line) } : current); }
  async function save() {
    if (!form) return;
    const errors = validatePurchaseOrderDraft(form, activeSuppliers, activeItems, activeUnits);
    if (errors.length) { setError(errors.join(" ")); return; }
    try { setWorking(true); setError(null); await savePurchaseOrderDraft(restaurantId, form, activeSuppliers, activeItems, activeUnits); await load(); setForm(null); setTab("open"); setMessage(form.id ? "Purchase order updated." : "Purchase order created."); }
    catch { setError("Unable to save the purchase order. Check the information and try again."); }
    finally { setWorking(false); }
  }
  function openReceipt(order: PurchaseOrderDraft) { setSelectedId(null); setForm(null); setError(null); setReceipt(receiptForm(order, items, storageLocations)); }
  function updateReceiptLine(index: number, receivedQuantity: string) { setReceipt((current) => current ? { ...current, lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, receivedQuantity } : line) } : current); }
  async function receive() {
    if (!receipt) return;
    const errors = validatePurchaseOrderReceipt(receipt);
    if (errors.length) { setError(errors.join(" ")); return; }
    try { setWorking(true); setError(null); const result = await receivePurchaseOrder(restaurantId, receipt); await load(); setReceipt(null); setTab(result.status === "completed" ? "completed" : "partially_received"); setMessage(result.already_processed ? "This delivery was already recorded. Stock was not increased again." : "Delivery received and stock updated."); }
    catch { setError("Unable to receive this delivery. Check the quantities and try again."); }
    finally { setWorking(false); }
  }

  return <div className="po-page">
    <header className="po-heading"><div><h2>Purchase Orders</h2><p>Track orders and receive deliveries.</p></div><button type="button" onClick={() => { setReceipt(null); setSelectedId(null); setForm(emptyForm()); }}>Create Purchase Order</button></header>
    {error && <div className="po-alert" role="alert">{error}</div>}
    {message && <div className="ia-operation-toast" role="status" aria-live="polite"><span>{message}</span><button type="button" aria-label="Dismiss success message" onClick={() => setMessage(null)}>&times;</button></div>}
    <div className="po-tabs" role="tablist" aria-label="Purchase order status">{(["open", "partially_received", "completed", "all"] as WorkTab[]).map((value) => { const label = value === "open" ? "Open" : value === "partially_received" ? "Partially Received" : value === "completed" ? "Completed" : "All"; const count = value === "all" ? orders.length : counts[value]; return <button type="button" role="tab" aria-selected={tab === value} key={value} onClick={() => setTab(value)}>{label}{count > 0 && <span>{count}</span>}</button>; })}</div>
    <details className="po-filters"><summary>Search and filters{(search || supplierFilter) && <span>Active</span>}</summary><div><label>Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search purchase orders or suppliers" /></label><label>Supplier<select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}><option value="">All suppliers</option>{filterSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label></div></details>
    {loading ? <div className="po-state">Loading purchase orders...</div> : visibleOrders.length ? <section className={`po-order-grid ${tab === "completed" ? "history" : ""}`} aria-label="Purchase orders">{visibleOrders.map((order) => {
      const completeLines = order.lines.filter((line) => line.remainingQuantity === 0).length;
      return <article className={`po-order-card ${order.status}`} key={order.id}>
        <header><div><strong>{order.supplierName || "Supplier not selected"}</strong><span>{orderCode(order.id)}</span></div><b>{statusLabel(order.status)}</b></header>
        {order.status === "completed" ? <div className="po-complete-summary"><span>Completed · {dateTimeLabel(order.updatedAt)}</span><strong>{order.lineCount} {order.lineCount === 1 ? "material" : "materials"} received</strong><span>Total {money(order.total)}</span></div> : <div className="po-active-summary"><div><span>Materials</span><strong>{order.lineCount}</strong></div><div><span>{order.status === "partially_received" ? "Received value" : "Order total"}</span><strong>{money(order.status === "partially_received" ? order.receivedTotal : order.total)}</strong></div>{order.status === "partially_received" && <div><span>Remaining value</span><strong>{money(order.remainingTotal)}</strong></div>}</div>}
        {order.status === "partially_received" && <p className="po-progress">{completeLines} of {order.lineCount} materials fully received</p>}
        {order.status !== "completed" && order.expectedDeliveryDate && <p className="po-expected">Expected {dateLabel(order.expectedDeliveryDate)}</p>}
        <footer>{order.status !== "completed" && <button type="button" onClick={() => openReceipt(order)}>{order.status === "partially_received" ? "Receive Remaining" : "Receive Delivery"}</button>}<button className="secondary" type="button" onClick={() => setSelectedId(order.id)}>View Order</button>{order.status === "draft" && <button className="text" type="button" onClick={() => { setReceipt(null); setSelectedId(null); setForm(editForm(order)); }}>Edit</button>}</footer>
      </article>;
    })}</section> : <section className="po-state"><strong>{orders.length === 0 ? "No purchase orders yet." : "No purchase orders match these filters."}</strong>{orders.length === 0 && <button type="button" onClick={() => setForm(emptyForm())}>Create Purchase Order</button>}</section>}

    {form && <div className="po-backdrop" role="presentation" onClick={() => !working && setForm(null)}><section className="po-editor" role="dialog" aria-modal="true" aria-labelledby="po-editor-title" onClick={(event) => event.stopPropagation()}>
      <header className="po-editor-heading"><div><span>PURCHASE ORDER</span><h2 id="po-editor-title">{form.id ? "Edit Purchase Order" : "Create Purchase Order"}</h2></div><button type="button" aria-label="Close purchase order" onClick={() => setForm(null)}>&times;</button></header>
      <div className="po-header-fields"><label>Supplier <span>(optional)</span><select value={form.supplierId} onChange={(event) => setForm({ ...form, supplierId: event.target.value })}><option value="">No supplier</option>{activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label><label>Expected delivery<input required type="date" value={form.expectedDeliveryDate} onChange={(event) => setForm({ ...form, expectedDeliveryDate: event.target.value })} /></label></div>
      <div className="po-lines-heading"><h3>Materials</h3><button type="button" onClick={() => setForm({ ...form, lines: [...form.lines, emptyLine()] })}>Add Material</button></div>
      <div className="po-lines">{form.lines.map((line, index) => <div className="po-line" key={`${index}:${line.inventoryItemId}`}>
        <label>Material<select required value={line.inventoryItemId} onChange={(event) => { const item = activeItems.find((candidate) => candidate.id === event.target.value); updateLine(index, { inventoryItemId: event.target.value, purchaseUnitId: item?.unitId ?? line.purchaseUnitId }); }}><option value="">Select material</option>{activeItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Quantity<input required min="0.001" step="0.001" type="number" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} /></label>
        <label>Unit<select required value={line.purchaseUnitId} onChange={(event) => updateLine(index, { purchaseUnitId: event.target.value })}><option value="">Select unit</option>{activeUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
        <label>Unit price<input required min="0" step="0.01" type="number" value={line.unitPrice} onChange={(event) => updateLine(index, { unitPrice: event.target.value })} /></label>
        <div className="po-line-total"><span>Line total</span><strong>{money(purchaseOrderLineTotal(line.quantity, line.unitPrice))}</strong></div><button className="danger" type="button" disabled={form.lines.length === 1} onClick={() => setForm({ ...form, lines: form.lines.filter((_, lineIndex) => lineIndex !== index) })}>Remove</button>
      </div>)}</div>
      <footer className="po-editor-footer"><div><span>Order total</span><strong>{money(purchaseOrderTotal(form))}</strong></div><button className="secondary" type="button" onClick={() => setForm(null)}>Cancel</button><button type="button" disabled={working} onClick={() => void save()}>{working ? "Saving..." : "Save Purchase Order"}</button></footer>
    </section></div>}

    {receipt && <div className="po-backdrop" role="presentation" onClick={() => !working && setReceipt(null)}><section ref={receiptEditorRef} className="po-editor po-receipt-editor" role="dialog" aria-modal="true" aria-labelledby="po-receipt-title" onClick={(event) => event.stopPropagation()}>
      <header className="po-editor-heading"><div><span>RECEIVE DELIVERY</span><h2 id="po-receipt-title">{orderCode(receipt.purchaseOrderId)}</h2></div><button type="button" aria-label="Close receiving" onClick={() => setReceipt(null)}>&times;</button></header>
      <div className="po-receipt-lines">{receipt.lines.map((line, index) => <article className="po-receipt-line" key={line.purchaseOrderItemId}><header><strong>{line.inventoryItemName}</strong><span>{line.storageLocationName}</span></header><dl><div><dt>Ordered</dt><dd>{quantity(line.orderedQuantity, line.purchaseUnitName)}</dd></div><div><dt>Already received</dt><dd>{quantity(line.alreadyReceivedQuantity, line.purchaseUnitName)}</dd></div><div><dt>Remaining</dt><dd>{quantity(line.remainingQuantity, line.purchaseUnitName)}</dd></div></dl><label>Receiving now<div><input min="0" max={line.remainingQuantity} step="0.001" type="number" value={line.receivedQuantity} onChange={(event) => updateReceiptLine(index, event.target.value)} /><span>{line.purchaseUnitName}</span></div></label></article>)}</div>
      <p className="po-receipt-integrity">Stock is received into each material&apos;s configured storage and recorded against this purchase order.</p>
      <footer className="po-editor-footer"><button className="secondary" type="button" onClick={() => setReceipt(null)}>Cancel</button><button type="button" disabled={working} onClick={() => void receive()}>{working ? "Receiving..." : "Confirm Receipt"}</button></footer>
    </section></div>}

    {selected && <div className="po-backdrop" role="presentation" onClick={() => setSelectedId(null)}><section className="po-editor po-detail" role="dialog" aria-modal="true" aria-labelledby="po-detail-title" onClick={(event) => event.stopPropagation()}>
      <header className="po-editor-heading"><div><span>{orderCode(selected.id)}</span><h2 id="po-detail-title">{selected.supplierName || "Purchase Order"}</h2></div><button type="button" aria-label="Close order details" onClick={() => setSelectedId(null)}>&times;</button></header>
      <div className="po-detail-status"><b className={selected.status}>{statusLabel(selected.status)}</b><span>Created {dateTimeLabel(selected.createdAt)}</span>{selected.expectedDeliveryDate && <span>Expected {dateLabel(selected.expectedDeliveryDate)}</span>}</div>
      <section className="po-detail-lines"><h3>Materials</h3>{selected.lines.map((line) => <article key={line.id}><strong>{line.inventoryItemName}</strong><dl><div><dt>Ordered</dt><dd>{quantity(line.quantity, line.purchaseUnitName)}</dd></div><div><dt>Received</dt><dd>{quantity(line.receivedQuantity, line.purchaseUnitName)}</dd></div><div><dt>Remaining</dt><dd>{quantity(line.remainingQuantity, line.purchaseUnitName)}</dd></div><div><dt>Unit price</dt><dd>{money(line.unitPrice)}</dd></div><div><dt>Line total</dt><dd>{money(line.lineTotal)}</dd></div></dl></article>)}</section>
      <div className="po-detail-total"><span>Order total</span><strong>{money(selected.total)}</strong></div>
      {(selected.notes || selected.createdByName || selected.updatedByName) && <details><summary>Activity</summary>{selected.createdByName && <p>Created by {selected.createdByName}</p>}{selected.updatedByName && <p>Updated by {selected.updatedByName} · {dateTimeLabel(selected.updatedAt)}</p>}{selected.notes && <p>{selected.notes}</p>}</details>}
      <footer className="po-editor-footer">{selected.status !== "completed" && <button type="button" onClick={() => openReceipt(selected)}>{selected.status === "partially_received" ? "Receive Remaining" : "Receive Delivery"}</button>}<button className="secondary" type="button" onClick={() => setSelectedId(null)}>Close</button></footer>
    </section></div>}
  </div>;
}

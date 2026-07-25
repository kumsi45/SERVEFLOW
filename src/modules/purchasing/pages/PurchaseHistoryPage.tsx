import { useCallback, useEffect, useMemo, useState } from "react";
import {
  exportPurchaseHistoryCsv,
  filterAndSortPurchaseHistory,
  loadPurchaseHistory,
} from "../services/purchaseHistoryService";
import type {
  PurchaseHistoryFilters,
  PurchaseHistoryRecord,
  PurchaseHistoryStatus,
} from "../purchaseHistoryTypes";
import "../styles/purchaseHistory.css";

type Props = { restaurantId: string };

const DEFAULT_FILTERS: PurchaseHistoryFilters = {
  search: "",
  supplierId: "",
  status: "all",
  dateFrom: "",
  dateTo: "",
  createdByStaffId: "",
  sort: "newest",
};

const STATUS_LABELS: Record<PurchaseHistoryStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  partially_received: "Partially Received",
  completed: "Completed",
  cancelled: "Cancelled",
};

function statusLabel(status: PurchaseHistoryStatus) {
  return STATUS_LABELS[status] ?? status;
}

function money(value: number) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function dateLabel(value: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)) : "Not received";
}

function dateTimeLabel(value: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not received";
}

function quantity(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
}

export function PurchaseHistoryPage({ restaurantId }: Props) {
  const [records, setRecords] = useState<PurchaseHistoryRecord[]>([]);
  const [filters, setFilters] = useState<PurchaseHistoryFilters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setRecords(await loadPurchaseHistory(restaurantId));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Purchase history is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => { void load(); }, [load]);

  const purchases = useMemo(() => filterAndSortPurchaseHistory(records, filters), [filters, records]);
  const selected = selectedId ? records.find((purchase) => purchase.id === selectedId) ?? null : null;
  const suppliers = useMemo(() => [...new Map(records.map((purchase) => [purchase.supplierId, purchase.supplierName])).entries()]
    .sort((left, right) => left[1].localeCompare(right[1])), [records]);
  const creators = useMemo(() => [...new Map(records.map((purchase) => [purchase.createdByStaffId, purchase.createdByName])).entries()]
    .sort((left, right) => left[1].localeCompare(right[1])), [records]);

  function setFilter<K extends keyof PurchaseHistoryFilters>(key: K, value: PurchaseHistoryFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  if (selected) {
    return (
      <div className="ph-page">
        <header className="ph-heading">
          <div><span>Purchase Detail</span><h2>{selected.purchaseNumber}</h2><p>Read-only purchase and receiving history.</p></div>
          <button type="button" onClick={() => setSelectedId(null)}>Back to Purchase History</button>
        </header>
        <section className="ph-detail">
          <header><div><h3>{selected.supplierName}</h3><span>{selected.purchaseNumber}</span></div><span className={`ph-status ${selected.status}`}>{statusLabel(selected.status)}</span></header>
          <dl>
            <div><dt>Supplier</dt><dd>{selected.supplierName}</dd></div>
            <div><dt>Delivery Date</dt><dd>{dateLabel(selected.expectedDeliveryDate)}</dd></div>
            <div><dt>Status</dt><dd>{statusLabel(selected.status)}</dd></div>
            <div><dt>Created By</dt><dd>{selected.createdByName}</dd></div>
            <div><dt>Created Date</dt><dd>{dateTimeLabel(selected.createdAt)}</dd></div>
            <div><dt>Received Date</dt><dd>{dateTimeLabel(selected.receivedAt)}</dd></div>
            <div><dt>Received By</dt><dd>{selected.receivedByNames ?? "Not received"}</dd></div>
            <div><dt>Number of Items</dt><dd>{selected.itemCount}</dd></div>
          </dl>
          <section className="ph-lines" aria-label="Purchase lines">
            <div className="ph-line header"><span>Inventory Item</span><span>Ordered</span><span>Received</span><span>Remaining</span><span>Purchase Unit</span><span>Unit Price</span><span>Line Total</span></div>
            {selected.lines.map((line) => <div className="ph-line" key={line.id}><strong>{line.inventoryItemName}</strong><span data-label="Ordered">{quantity(line.orderedQuantity)}</span><span data-label="Received">{quantity(line.receivedQuantity)}</span><span data-label="Remaining">{quantity(line.remainingQuantity)}</span><span data-label="Purchase Unit">{line.purchaseUnitName}</span><span data-label="Unit Price">{money(line.unitPrice)}</span><strong data-label="Line Total">{money(line.lineTotal)}</strong></div>)}
          </section>
          {selected.notes && <section className="ph-notes"><h3>Notes</h3><p>{selected.notes}</p></section>}
          <footer><div><span>Received Value</span><strong>{money(selected.receivedCost)}</strong></div><div><span>Remaining Value</span><strong>{money(selected.remainingCost)}</strong></div><div><span>Overall Total</span><strong>{money(selected.totalCost)}</strong></div></footer>
        </section>
      </div>
    );
  }

  return (
    <div className="ph-page">
      <header className="ph-heading">
        <div><span>Read-only Purchasing</span><h2>Purchase History</h2><p>Review purchase activity, receipt progress, supplier history, and costs.</p></div>
        <button type="button" disabled={!purchases.length} onClick={() => exportPurchaseHistoryCsv(purchases)}>Export CSV</button>
      </header>
      {error && <div className="ia-alert error">{error}</div>}

      <section className="ph-filters" aria-label="Purchase history filters">
        <label className="search">Search<input value={filters.search} onChange={(event) => setFilter("search", event.target.value)} placeholder="Purchase number, supplier, or inventory item" /></label>
        <label>Supplier<select value={filters.supplierId} onChange={(event) => setFilter("supplierId", event.target.value)}><option value="">All suppliers</option>{suppliers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>Status<select value={filters.status} onChange={(event) => setFilter("status", event.target.value as PurchaseHistoryFilters["status"])}><option value="all">All statuses</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Date From<input type="date" value={filters.dateFrom} onChange={(event) => setFilter("dateFrom", event.target.value)} /></label>
        <label>Date To<input type="date" value={filters.dateTo} onChange={(event) => setFilter("dateTo", event.target.value)} /></label>
        <label>Created By<select value={filters.createdByStaffId} onChange={(event) => setFilter("createdByStaffId", event.target.value)}><option value="">All creators</option>{creators.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>Sort By<select value={filters.sort} onChange={(event) => setFilter("sort", event.target.value as PurchaseHistoryFilters["sort"])}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="highest_cost">Highest Cost</option><option value="lowest_cost">Lowest Cost</option></select></label>
      </section>

      {loading ? <div className="ia-empty">Loading purchase history...</div> : (
        <section className="ph-history" aria-label="Purchase history">
          <div className="ph-table header"><span>Purchase Number</span><span>Supplier</span><span>Created By</span><span>Created Date</span><span>Received Date</span><span>Status</span><span>Total Cost</span><span>Items</span><span /></div>
          {purchases.map((purchase) => (
            <article className="ph-table" key={purchase.id}>
              <strong data-label="Purchase Number">{purchase.purchaseNumber}</strong>
              <span data-label="Supplier">{purchase.supplierName}</span>
              <span data-label="Created By">{purchase.createdByName}</span>
              <span data-label="Created Date">{dateTimeLabel(purchase.createdAt)}</span>
              <span data-label="Received Date">{dateTimeLabel(purchase.receivedAt)}</span>
              <span data-label="Status"><span className={`ph-status ${purchase.status}`}>{statusLabel(purchase.status)}</span></span>
              <strong data-label="Total Cost">{money(purchase.totalCost)}</strong>
              <span data-label="Items">{purchase.itemCount}</span>
              <button type="button" onClick={() => setSelectedId(purchase.id)}>View Details</button>
            </article>
          ))}
          {!purchases.length && <div className="ia-empty">No purchases match the current search and filters.</div>}
        </section>
      )}
    </div>
  );
}

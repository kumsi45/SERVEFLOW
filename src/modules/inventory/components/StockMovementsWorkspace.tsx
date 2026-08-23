import { useEffect, useMemo, useState } from "react";
import type { InventoryLedgerEntry, InventoryMovementType } from "../types";

type MovementGroup = "stock_in" | "stock_out" | "transfer" | "adjustment" | "waste";
type DatePreset = "all" | "today" | "7d" | "month" | "custom";

type MovementFilters = {
  type: "all" | MovementGroup;
  storageId: string;
  materialId: string;
  staffId: string;
  datePreset: DatePreset;
  dateFrom: string;
  dateTo: string;
};

export type MovementDisplayRow = {
  id: string;
  movementDate: string;
  primary: InventoryLedgerEntry;
  entries: InventoryLedgerEntry[];
  transferFrom?: InventoryLedgerEntry;
  transferTo?: InventoryLedgerEntry;
};

const EMPTY_FILTERS: MovementFilters = {
  type: "all",
  storageId: "",
  materialId: "",
  staffId: "",
  datePreset: "all",
  dateFrom: "",
  dateTo: "",
};
const PAGE_SIZE = 25;

const timestamp = (value: string) => {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

export function newestInventoryMovements(entries: InventoryLedgerEntry[]) {
  return [...entries].sort((left, right) => timestamp(right.movementDate) - timestamp(left.movementDate)
    || right.id.localeCompare(left.id));
}

export function groupInventoryTransfers(entries: InventoryLedgerEntry[]): MovementDisplayRow[] {
  const sorted = newestInventoryMovements(entries);
  const groups = new Map<string, InventoryLedgerEntry[]>();
  for (const entry of sorted) {
    if (entry.transferGroupId && (entry.movementType === "transfer_in" || entry.movementType === "transfer_out")) {
      const key = entry.transferGroupId;
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
  }
  const consumed = new Set<string>();
  const rows: MovementDisplayRow[] = [];
  for (const entry of sorted) {
    if (consumed.has(entry.id)) continue;
    const pair = entry.transferGroupId ? groups.get(entry.transferGroupId) ?? [] : [];
    const transferFrom = pair.find((candidate) => candidate.movementType === "transfer_out");
    const transferTo = pair.find((candidate) => candidate.movementType === "transfer_in");
    const safelyPaired = transferFrom && transferTo
      && transferFrom.inventoryItemId === transferTo.inventoryItemId
      && transferFrom.quantity === transferTo.quantity;
    if (safelyPaired) {
      consumed.add(transferFrom.id);
      consumed.add(transferTo.id);
      rows.push({
        id: `transfer:${entry.transferGroupId}`,
        movementDate: timestamp(transferFrom.movementDate) >= timestamp(transferTo.movementDate) ? transferFrom.movementDate : transferTo.movementDate,
        primary: transferFrom,
        entries: [transferFrom, transferTo],
        transferFrom,
        transferTo,
      });
    } else {
      consumed.add(entry.id);
      rows.push({ id: entry.id, movementDate: entry.movementDate, primary: entry, entries: [entry] });
    }
  }
  return rows.sort((left, right) => timestamp(right.movementDate) - timestamp(left.movementDate)
    || right.id.localeCompare(left.id));
}

function movementGroup(type: InventoryMovementType): MovementGroup {
  if (type === "stock_in" || type === "opening_balance") return "stock_in";
  if (type === "stock_out" || type === "closing_balance") return "stock_out";
  if (type === "transfer_in" || type === "transfer_out") return "transfer";
  if (type === "waste" || type === "spoilage") return "waste";
  return "adjustment";
}

export function inventoryMovementLabel(type: InventoryMovementType, paired = false) {
  if (paired) return "Transfer";
  const labels: Record<InventoryMovementType, string> = {
    opening_balance: "Opening Balance",
    stock_in: "Stock In",
    stock_out: "Stock Out",
    transfer_in: "Transfer In",
    transfer_out: "Transfer Out",
    adjustment_increase: "Adjustment Increase",
    adjustment_decrease: "Adjustment Decrease",
    waste: "Waste",
    spoilage: "Spoilage",
    manual_correction: "Manual Correction",
    closing_balance: "Closing Balance",
  };
  return labels[type];
}

export function inventoryMovementSource(entry: InventoryLedgerEntry) {
  if (/^KITCHEN-REQUEST-/i.test(entry.referenceNumber ?? "") || /kitchen material request/i.test(`${entry.reason ?? ""} ${entry.notes ?? ""}`)) {
    return "Kitchen Request";
  }
  if (/^PO-[A-Z0-9-]+$/i.test(entry.referenceNumber ?? "") || /purchase order/i.test(entry.reason ?? "")) {
    return `Purchase Order${entry.referenceNumber ? ` #${entry.referenceNumber}` : ""}`;
  }
  if (entry.movementType === "transfer_in" || entry.movementType === "transfer_out") return "Transfer";
  if (entry.movementType === "waste" || entry.movementType === "spoilage") return inventoryMovementLabel(entry.movementType);
  if (entry.movementType === "adjustment_increase" || entry.movementType === "adjustment_decrease" || entry.movementType === "manual_correction") return "Adjustment";
  if (entry.movementType === "stock_in" || entry.movementType === "opening_balance") return "Manual Stock In";
  return "Manual Stock Out";
}

const quantityLabel = (value: number, unit: string) => `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value)} ${unit}`;
const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
}).format(new Date(value));

function inDateRange(value: string, filters: MovementFilters) {
  if (filters.datePreset === "all") return true;
  const date = new Date(value);
  const now = new Date();
  const start = new Date(now);
  if (filters.datePreset === "today") start.setHours(0, 0, 0, 0);
  if (filters.datePreset === "7d") start.setDate(start.getDate() - 7);
  if (filters.datePreset === "month") start.setDate(1), start.setHours(0, 0, 0, 0);
  if (filters.datePreset !== "custom") return date >= start && date <= now;
  if (filters.dateFrom && date < new Date(`${filters.dateFrom}T00:00:00`)) return false;
  if (filters.dateTo && date > new Date(`${filters.dateTo}T23:59:59.999`)) return false;
  return true;
}

function signedQuantity(row: MovementDisplayRow) {
  if (row.transferFrom && row.transferTo) return quantityLabel(row.primary.quantity, row.primary.unitName);
  return `${row.primary.quantityEffect === "in" ? "+" : "−"}${quantityLabel(row.primary.quantity, row.primary.unitName)}`;
}

function MovementSummary({ row }: { row: MovementDisplayRow }) {
  const paired = Boolean(row.transferFrom && row.transferTo);
  return <>
    <div className="ia-sm-main"><strong>{row.primary.itemName}</strong><span>{inventoryMovementLabel(row.primary.movementType, paired)} · {paired ? "Storage transfer" : row.primary.storageLocationName}</span></div>
    <strong className={`ia-sm-quantity ${paired ? "transfer" : row.primary.quantityEffect}`}>{signedQuantity(row)}</strong>
    {paired && <div className="ia-sm-route"><span>{row.transferFrom?.storageLocationName}</span><b aria-hidden="true">→</b><span>{row.transferTo?.storageLocationName}</span></div>}
    <div className="ia-sm-source">{inventoryMovementSource(row.primary)}</div>
    <div className="ia-sm-meta"><time dateTime={row.movementDate}>{dateLabel(row.movementDate)}</time><span>{row.primary.staffName ?? "Inventory staff"}</span></div>
  </>;
}

export function StockMovementsWorkspace({ entries, loading, error, onReload }: {
  entries: InventoryLedgerEntry[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<MovementFilters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<MovementFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [details, setDetails] = useState<MovementDisplayRow | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const materials = useMemo(() => [...new Map(entries.map((entry) => [entry.inventoryItemId, entry.itemName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [entries]);
  const storages = useMemo(() => [...new Map(entries.map((entry) => [entry.storageLocationId, entry.storageLocationName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [entries]);
  const staff = useMemo(() => [...new Map(entries.map((entry) => [entry.createdByStaffId, entry.staffName ?? "Inventory staff"])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [entries]);
  const activeFilterCount = Number(filters.type !== "all") + Number(Boolean(filters.storageId)) + Number(Boolean(filters.materialId)) + Number(Boolean(filters.staffId)) + Number(filters.datePreset !== "all");

  const rows = useMemo(() => groupInventoryTransfers(entries).filter((row) => {
    if (filters.type !== "all" && movementGroup(row.primary.movementType) !== filters.type) return false;
    if (filters.storageId && !row.entries.some((entry) => entry.storageLocationId === filters.storageId)) return false;
    if (filters.materialId && row.primary.inventoryItemId !== filters.materialId) return false;
    if (filters.staffId && !row.entries.some((entry) => entry.createdByStaffId === filters.staffId)) return false;
    if (!inDateRange(row.movementDate, filters)) return false;
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return row.entries.flatMap((entry) => [entry.itemName, entry.storageLocationName, entry.staffName, entry.supplierName, entry.reason, entry.notes, entry.referenceNumber, inventoryMovementLabel(entry.movementType), inventoryMovementSource(entry)])
      .some((value) => (value ?? "").toLowerCase().includes(query));
  }), [entries, filters, search]);
  const visibleRows = rows.slice(0, visibleCount);

  useEffect(() => setVisibleCount(PAGE_SIZE), [filters, search]);

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setDraftFilters(EMPTY_FILTERS);
    setFiltersOpen(false);
  }

  const emptyText = search.trim() ? "No movements found." : activeFilterCount ? "No movements match these filters." : "No stock movements yet.";

  return <div className="ia-sm-page">
    <header className="ia-sm-heading"><div><span>OPERATIONAL HISTORY</span><h2>Stock Movements</h2><p>What changed in stock, where, and when</p></div><button type="button" onClick={onReload}>Refresh</button></header>
    <section className="ia-sm-tools" aria-label="Stock movement search and filters"><label><span>Search movements</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search materials, storage, staff..." /></label><button type="button" aria-haspopup="dialog" onClick={() => { setDraftFilters(filters); setFiltersOpen(true); }}>Filters{activeFilterCount > 0 && <strong aria-label={`${activeFilterCount} active filters`}>{activeFilterCount}</strong>}</button></section>

    {loading ? <div className="ia-sm-state" role="status">Loading stock movements...</div>
      : error ? <div className="ia-sm-error" role="alert"><strong>We couldn&apos;t load stock movements.</strong><span>Check your connection and try again.</span><button type="button" onClick={onReload}>Try again</button></div>
        : rows.length === 0 ? <div className="ia-sm-state"><strong>{emptyText}</strong>{(activeFilterCount > 0 || search) && <button type="button" onClick={() => { setSearch(""); clearFilters(); }}>Clear search and filters</button>}</div>
          : <>
            <div className="ia-sm-mobile-list" aria-label="Stock movement history">{visibleRows.map((row) => <button type="button" key={row.id} onClick={() => setDetails(row)}><MovementSummary row={row} /></button>)}</div>
            <div className="ia-sm-desktop-table"><table><thead><tr><th>Date / Time</th><th>Movement</th><th>Material</th><th>Storage</th><th>Quantity</th><th>Source / Reason</th><th>Staff</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visibleRows.map((row) => {
              const paired = Boolean(row.transferFrom && row.transferTo);
              return <tr key={row.id}><td><time dateTime={row.movementDate}>{dateLabel(row.movementDate)}</time></td><td>{inventoryMovementLabel(row.primary.movementType, paired)}</td><td><strong>{row.primary.itemName}</strong>{row.primary.supplierName && <small>{row.primary.supplierName}</small>}</td><td>{paired ? <span className="ia-sm-table-route">{row.transferFrom?.storageLocationName} → {row.transferTo?.storageLocationName}</span> : row.primary.storageLocationName}</td><td><strong className={`ia-sm-quantity ${paired ? "transfer" : row.primary.quantityEffect}`}>{signedQuantity(row)}</strong></td><td><span>{inventoryMovementSource(row.primary)}</span>{row.primary.reason && !/kitchen material request|purchase order/i.test(row.primary.reason) && <small>{row.primary.reason}</small>}</td><td>{row.primary.staffName ?? "Inventory staff"}</td><td><button type="button" onClick={() => setDetails(row)} aria-label={`View ${row.primary.itemName} movement details`}>Details</button></td></tr>;
            })}</tbody></table></div>
            {visibleCount < rows.length && <div className="ia-sm-load-more"><span>Showing {visibleRows.length} of {rows.length}</span><button type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>Load More</button></div>}
          </>}

    {filtersOpen && <div className="ia-sm-backdrop" role="presentation" onClick={() => setFiltersOpen(false)}><section className="ia-sm-sheet" role="dialog" aria-modal="true" aria-labelledby="ia-sm-filter-title" onClick={(event) => event.stopPropagation()}><header><h3 id="ia-sm-filter-title">Filter Stock Movements</h3><button type="button" aria-label="Close filters" onClick={() => setFiltersOpen(false)}>×</button></header><div className="ia-sm-filter-fields">
      <label>Movement Type<select value={draftFilters.type} onChange={(event) => setDraftFilters({ ...draftFilters, type: event.target.value as MovementFilters["type"] })}><option value="all">All movements</option><option value="stock_in">Stock In</option><option value="stock_out">Stock Out</option><option value="transfer">Transfer</option><option value="adjustment">Adjustment</option><option value="waste">Waste</option></select></label>
      <label>Storage<select value={draftFilters.storageId} onChange={(event) => setDraftFilters({ ...draftFilters, storageId: event.target.value })}><option value="">All storage</option>{storages.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>Material<select value={draftFilters.materialId} onChange={(event) => setDraftFilters({ ...draftFilters, materialId: event.target.value })}><option value="">All materials</option>{materials.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>Staff<select value={draftFilters.staffId} onChange={(event) => setDraftFilters({ ...draftFilters, staffId: event.target.value })}><option value="">All staff</option>{staff.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <fieldset><legend>Date range</legend><div className="ia-sm-date-options">{[["all", "Any time"], ["today", "Today"], ["7d", "Last 7 Days"], ["month", "This Month"], ["custom", "Custom"]].map(([value, label]) => <label key={value}><input type="radio" name="movement-date" checked={draftFilters.datePreset === value} onChange={() => setDraftFilters({ ...draftFilters, datePreset: value as DatePreset })} />{label}</label>)}</div></fieldset>
      {draftFilters.datePreset === "custom" && <div className="ia-sm-custom-dates"><label>From<input type="date" value={draftFilters.dateFrom} onChange={(event) => setDraftFilters({ ...draftFilters, dateFrom: event.target.value })} /></label><label>To<input type="date" value={draftFilters.dateTo} onChange={(event) => setDraftFilters({ ...draftFilters, dateTo: event.target.value })} /></label></div>}
    </div><footer><button type="button" className="secondary" onClick={clearFilters}>Clear</button><button type="button" onClick={() => { setFilters(draftFilters); setFiltersOpen(false); }}>Apply Filters</button></footer></section></div>}

    {details && <div className="ia-sm-backdrop" role="presentation" onClick={() => setDetails(null)}><section className="ia-sm-sheet ia-sm-detail" role="dialog" aria-modal="true" aria-labelledby="ia-sm-detail-title" onClick={(event) => event.stopPropagation()}><header><div><span>MOVEMENT DETAILS</span><h3 id="ia-sm-detail-title">{details.primary.itemName}</h3></div><button type="button" aria-label="Close movement details" onClick={() => setDetails(null)}>×</button></header><dl>
      <div><dt>Movement</dt><dd>{inventoryMovementLabel(details.primary.movementType, Boolean(details.transferFrom))}</dd></div><div><dt>Quantity</dt><dd>{signedQuantity(details)}</dd></div>
      {details.transferFrom && details.transferTo ? <><div><dt>From</dt><dd>{details.transferFrom.storageLocationName}</dd></div><div><dt>To</dt><dd>{details.transferTo.storageLocationName}</dd></div></> : <div><dt>Storage</dt><dd>{details.primary.storageLocationName}</dd></div>}
      <div><dt>Date and time</dt><dd>{dateLabel(details.movementDate)}</dd></div><div><dt>Performed by</dt><dd>{details.primary.staffName ?? "Inventory staff"}</dd></div><div><dt>Source</dt><dd>{inventoryMovementSource(details.primary)}</dd></div>
      {details.primary.supplierName && <div><dt>Supplier</dt><dd>{details.primary.supplierName}</dd></div>}{details.primary.invoiceNumber && <div><dt>Invoice number</dt><dd>{details.primary.invoiceNumber}</dd></div>}{details.primary.reason && !/kitchen material request|purchase order/i.test(details.primary.reason) && <div><dt>Reason</dt><dd>{details.primary.reason}</dd></div>}{details.primary.notes && !/kitchen material request [0-9a-f-]+/i.test(details.primary.notes) && <div><dt>Notes</dt><dd>{details.primary.notes}</dd></div>}
    </dl></section></div>}
  </div>;
}

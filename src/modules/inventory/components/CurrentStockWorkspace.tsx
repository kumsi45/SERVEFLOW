import { useMemo, useState } from "react";
import type { InventoryCurrentStockRow, InventoryStockStatus } from "../types";

type StockAction = "stock_in" | "stock_out" | "transfer";

type Props = {
  rows: InventoryCurrentStockRow[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onStartAction: (action: StockAction, row: InventoryCurrentStockRow | null) => void;
  onViewDetails: (inventoryItemId: string) => void;
};

type StockFilters = {
  status: "all" | InventoryStockStatus;
  categoryId: string;
  storageLocationId: string;
};

const EMPTY_FILTERS: StockFilters = { status: "all", categoryId: "", storageLocationId: "" };

const quantityLabel = (value: number, unit: string) => `${new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 3,
}).format(value)} ${unit}`;

export function currentStockStatusLabel(status: InventoryStockStatus) {
  const labels: Record<InventoryStockStatus, string> = {
    out_of_stock: "Out of Stock",
    low_stock: "Low Stock",
    in_stock: "In Stock",
    over_stock: "Over Stock",
  };
  return labels[status];
}

export function CurrentStockWorkspace({ rows, loading, error, onReload, onStartAction, onViewDetails }: Props) {
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [actionRow, setActionRow] = useState<InventoryCurrentStockRow | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [filters, setFilters] = useState<StockFilters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<StockFilters>(EMPTY_FILTERS);

  const categories = useMemo(() => [...new Map(rows
    .filter((row) => row.categoryId)
    .map((row) => [row.categoryId!, { id: row.categoryId!, name: row.categoryName ?? "Uncategorized" }])).values()]
    .sort((left, right) => left.name.localeCompare(right.name)), [rows]);
  const locations = useMemo(() => [...new Map(rows.map((row) => [row.storageLocationId, {
    id: row.storageLocationId,
    name: row.storageLocationName,
  }])).values()].sort((left, right) => left.name.localeCompare(right.name)), [rows]);
  const activeFilterCount = Number(filters.status !== "all") + Number(Boolean(filters.categoryId)) + Number(Boolean(filters.storageLocationId));
  const visibleRows = useMemo(() => rows.filter((row) => {
    const query = search.trim().toLowerCase();
    if (filters.status !== "all" && row.stockStatus !== filters.status) return false;
    if (filters.categoryId && row.categoryId !== filters.categoryId) return false;
    if (filters.storageLocationId && row.storageLocationId !== filters.storageLocationId) return false;
    if (!query) return true;
    return [row.itemName, row.storageLocationName, row.categoryName].some((value) => (value ?? "").toLowerCase().includes(query));
  }), [filters, rows, search]);

  function openActions(row: InventoryCurrentStockRow | null) {
    setActionRow(row);
    setActionsOpen(true);
  }

  function startAction(action: StockAction) {
    onStartAction(action, actionRow);
    setActionsOpen(false);
  }

  function clearFilters() {
    setDraftFilters(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setFiltersOpen(false);
  }

  return (
    <div className="ia-cs-page">
      <header className="ia-cs-heading">
        <div><h2>Current Stock</h2></div>
        <button type="button" onClick={() => openActions(null)}>+ Stock Action</button>
      </header>

      <section className="ia-cs-tools" aria-label="Current stock search and filters">
        <label className="ia-cs-search"><span>Search stock</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Material, storage, or category" /></label>
        <button className="ia-cs-filter-button" type="button" aria-haspopup="dialog" onClick={() => { setDraftFilters(filters); setFiltersOpen(true); }}>
          Filters{activeFilterCount > 0 && <strong aria-label={`${activeFilterCount} active filters`}>{activeFilterCount}</strong>}
        </button>
      </section>

      {loading ? <div className="ia-cs-state" role="status">Loading current stock...</div>
        : error ? <div className="ia-cs-error" role="alert"><strong>Stock information couldn&apos;t be loaded.</strong><span>Check your connection and try again.</span><button type="button" onClick={onReload}>Try again</button></div>
          : visibleRows.length === 0 ? <div className="ia-cs-state"><strong>{rows.length ? "No stock matches your search or filters." : "No current stock yet."}</strong><span>{rows.length ? "Clear filters or try a different search." : "Receive stock to create the first live balance."}</span>{activeFilterCount > 0 && <button type="button" onClick={clearFilters}>Clear filters</button>}</div>
            : <>
              <div className="ia-cs-mobile-list" aria-label="Current stock materials">
                {visibleRows.map((row) => <button type="button" key={`${row.inventoryItemId}:${row.storageLocationId}`} onClick={() => openActions(row)} aria-label={`${row.itemName}, ${quantityLabel(row.currentQuantity, row.unitName)}, ${row.storageLocationName}, ${currentStockStatusLabel(row.stockStatus)}`}>
                  <span className="ia-cs-card-main"><strong>{row.itemName}</strong><small>{row.storageLocationName}</small></span>
                  <strong className="ia-cs-quantity">{quantityLabel(row.currentQuantity, row.unitName)}</strong>
                  <span className={`ia-cs-status ${row.stockStatus}`}>{currentStockStatusLabel(row.stockStatus)}</span>
                </button>)}
              </div>
              <div className="ia-cs-desktop-table">
                <table>
                  <thead><tr><th>Material</th><th>Current</th><th>Minimum</th><th>Maximum</th><th>Storage</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>{visibleRows.map((row) => <tr key={`${row.inventoryItemId}:${row.storageLocationId}`}>
                    <td><strong>{row.itemName}</strong><small>{row.categoryName ?? "Uncategorized"}</small></td>
                    <td><strong>{quantityLabel(row.currentQuantity, row.unitName)}</strong></td>
                    <td>{quantityLabel(row.minimumStock, row.unitName)}</td>
                    <td aria-label={row.maximumStock == null ? "No maximum configured" : undefined}>{row.maximumStock == null ? "" : quantityLabel(row.maximumStock, row.unitName)}</td>
                    <td>{row.storageLocationName}</td>
                    <td><span className={`ia-cs-status ${row.stockStatus}`}>{currentStockStatusLabel(row.stockStatus)}</span></td>
                    <td><button type="button" onClick={() => openActions(row)} aria-label={`Open stock actions for ${row.itemName}`}>Actions</button></td>
                  </tr>)}</tbody>
                </table>
              </div>
            </>}

      {filtersOpen && <div className="ia-cs-sheet-backdrop" role="presentation" onClick={() => setFiltersOpen(false)}><section className="ia-cs-sheet" role="dialog" aria-modal="true" aria-labelledby="ia-cs-filter-title" onClick={(event) => event.stopPropagation()}>
        <header><h3 id="ia-cs-filter-title">Filter Current Stock</h3><button type="button" aria-label="Close filters" onClick={() => setFiltersOpen(false)}>×</button></header>
        <label>Status<select value={draftFilters.status} onChange={(event) => setDraftFilters({ ...draftFilters, status: event.target.value as StockFilters["status"] })}><option value="all">All statuses</option><option value="out_of_stock">Out of Stock</option><option value="low_stock">Low Stock</option><option value="in_stock">In Stock</option><option value="over_stock">Over Stock</option></select></label>
        <label>Storage<select value={draftFilters.storageLocationId} onChange={(event) => setDraftFilters({ ...draftFilters, storageLocationId: event.target.value })}><option value="">All storage</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <label>Category<select value={draftFilters.categoryId} onChange={(event) => setDraftFilters({ ...draftFilters, categoryId: event.target.value })}><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <footer><button className="secondary" type="button" onClick={clearFilters}>Clear</button><button type="button" onClick={() => { setFilters(draftFilters); setFiltersOpen(false); }}>Apply Filters</button></footer>
      </section></div>}

      {actionsOpen && <div className="ia-cs-sheet-backdrop" role="presentation" onClick={() => setActionsOpen(false)}><section className="ia-cs-sheet ia-cs-action-sheet" role="dialog" aria-modal="true" aria-labelledby="ia-cs-action-title" onClick={(event) => event.stopPropagation()}>
        <header><div><h3 id="ia-cs-action-title">{actionRow ? actionRow.itemName : "Update Stock"}</h3>{actionRow && <span>{quantityLabel(actionRow.currentQuantity, actionRow.unitName)} · {actionRow.storageLocationName}</span>}</div><button type="button" aria-label="Close stock actions" onClick={() => setActionsOpen(false)}>×</button></header>
        <div className="ia-cs-action-list"><button type="button" onClick={() => startAction("stock_in")}><strong>Receive</strong></button><button type="button" onClick={() => startAction("stock_out")}><strong>Issue</strong></button><button type="button" onClick={() => startAction("transfer")}><strong>Transfer</strong></button>{actionRow && <button type="button" onClick={() => { onViewDetails(actionRow.inventoryItemId); setActionsOpen(false); }}><strong>Details</strong></button>}</div>
      </section></div>}
    </div>
  );
}

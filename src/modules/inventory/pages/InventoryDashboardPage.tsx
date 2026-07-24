import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { signOutStaff } from "../../staff-auth/services/staffAuthService";
import { adjustInventoryStock } from "../services/adjustmentService";
import { loadCurrentStock } from "../services/inventoryBalanceService";
import {
  archiveRecord,
  bulkArchiveItems,
  bulkRestoreItems,
  bulkSoftDeleteItems,
  duplicateItem,
  getFilteredItems,
  loadInventoryAdminData,
  restoreRecord,
  saveCategory,
  saveItem,
  saveStorageLocation,
  saveSupplier,
  saveUnit,
  softDeleteRecord,
} from "../services/inventoryAdminService";
import { loadLedger } from "../services/ledgerService";
import { recordOpeningBalance } from "../services/openingBalanceService";
import { recordStockMovement } from "../services/stockMovementService";
import { transferInventoryStock } from "../services/transferService";
import { wasteInventoryStock } from "../services/wasteService";
import type {
  InventoryAdjustmentDraft,
  InventoryAdminData,
  InventoryCategory,
  InventoryCategoryDraft,
  InventoryCurrentStockRow,
  InventoryFilters,
  InventoryItem,
  InventoryItemDraft,
  InventoryLedgerEntry,
  InventoryMovementType,
  InventoryOpeningBalanceDraft,
  InventorySection,
  InventorySimpleDraft,
  InventorySupplier,
  InventorySupplierDraft,
  InventoryTransferDraft,
  InventoryWasteDraft,
  StockMovementDraft,
} from "../types";
import "../styles/inventoryDashboard.css";

type Props = {
  restaurantId: string;
  restaurantName: string;
  staffName: string;
  staffRole: "owner" | "manager";
  initialSection?: string;
};

const EMPTY_DATA: InventoryAdminData = {
  items: [],
  categories: [],
  suppliers: [],
  storageLocations: [],
  units: [],
  staffNames: {},
};

const INVENTORY_NAV: Array<{ key: InventorySection; label: string }> = [
  { key: "dashboard", label: "Dashboard" },
  { key: "current-stock", label: "Current Stock" },
  { key: "movements", label: "Movements" },
  { key: "stock-in", label: "Stock In" },
  { key: "stock-out", label: "Stock Out" },
  { key: "adjustments", label: "Adjustments" },
  { key: "waste", label: "Waste" },
  { key: "transfers", label: "Transfers" },
  { key: "ledger", label: "Ledger" },
  { key: "items", label: "Items" },
  { key: "categories", label: "Categories" },
  { key: "suppliers", label: "Suppliers" },
  { key: "storage-locations", label: "Storage Locations" },
  { key: "units", label: "Units" },
];

const DEFAULT_FILTERS: InventoryFilters = {
  search: "",
  categoryId: "",
  supplierId: "",
  storageLocationId: "",
  status: "all",
  archived: "active",
  recentlyAdded: false,
  sort: "recent",
};

const ITEM_PAGE_SIZE = 10;

function isInventorySection(value: string | undefined): value is InventorySection {
  return INVENTORY_NAV.some((item) => item.key === value);
}

function todayCutoff() {
  return Date.now() - 7 * 24 * 60 * 60 * 1000;
}

function dateLabel(value: string) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function dateInputValue() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function quantityLabel(value: number, unitName: string) {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value)} ${unitName}`;
}

function movementLabel(value: InventoryMovementType) {
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
  return labels[value];
}

function itemDraft(item?: InventoryItem): InventoryItemDraft {
  return {
    id: item?.id,
    name: item?.name ?? "",
    categoryId: item?.categoryId ?? "",
    unitId: item?.unitId ?? "",
    storageLocationId: item?.storageLocationId ?? "",
    preferredSupplierId: item?.preferredSupplierId ?? "",
    sku: item?.sku ?? "",
    barcode: item?.barcode ?? "",
    minimumStock: item ? String(item.minimumStock) : "0",
    maximumStock: item?.maximumStock == null ? "" : String(item.maximumStock),
    description: item?.description ?? "",
  };
}

function stockMovementDraft(movementType: InventoryMovementType): StockMovementDraft {
  return {
    inventoryItemId: "",
    storageLocationId: "",
    movementType,
    quantity: "",
    quantityEffect: movementType === "stock_out" ? "out" : "in",
    supplierId: "",
    referenceNumber: "",
    invoiceNumber: "",
    reason: "",
    notes: "",
    movementDate: dateInputValue(),
  };
}

function adjustmentDraft(): InventoryAdjustmentDraft {
  return {
    inventoryItemId: "",
    storageLocationId: "",
    direction: "increase",
    quantity: "",
    reason: "",
    notes: "",
    movementDate: dateInputValue(),
  };
}

function wasteDraft(): InventoryWasteDraft {
  return {
    inventoryItemId: "",
    storageLocationId: "",
    quantity: "",
    reason: "",
    isSpoilage: false,
    notes: "",
    movementDate: dateInputValue(),
  };
}

function transferDraft(): InventoryTransferDraft {
  return {
    inventoryItemId: "",
    fromStorageLocationId: "",
    toStorageLocationId: "",
    quantity: "",
    referenceNumber: "",
    reason: "",
    notes: "",
    movementDate: dateInputValue(),
  };
}

function openingBalanceDraft(): InventoryOpeningBalanceDraft {
  return {
    inventoryItemId: "",
    storageLocationId: "",
    quantity: "",
    referenceNumber: "",
    notes: "",
    movementDate: dateInputValue(),
  };
}

function categoryDraft(category?: InventoryCategory): InventoryCategoryDraft {
  return {
    id: category?.id,
    name: category?.name ?? "",
    description: category?.description ?? "",
    sortOrder: category ? String(category.sortOrder) : "1000",
  };
}

function supplierDraft(supplier?: InventorySupplier): InventorySupplierDraft {
  return {
    id: supplier?.id,
    name: supplier?.name ?? "",
    phone: supplier?.phone ?? "",
    address: supplier?.address ?? "",
    contactPerson: supplier?.contactPerson ?? "",
    notes: supplier?.notes ?? "",
  };
}

function simpleDraft(record?: { id: string; name: string; description: string | null }): InventorySimpleDraft {
  return {
    id: record?.id,
    name: record?.name ?? "",
    description: record?.description ?? "",
  };
}

function statusBadge(status: string) {
  return <span className={`ia-status ${status}`}>{status}</span>;
}

export function InventoryDashboardPage({
  restaurantId,
  restaurantName,
  staffName,
  staffRole,
  initialSection,
}: Props) {
  const [section, setSection] = useState<InventorySection>(() =>
    isInventorySection(initialSection) ? initialSection : "dashboard",
  );
  const [data, setData] = useState<InventoryAdminData>(EMPTY_DATA);
  const [currentStock, setCurrentStock] = useState<InventoryCurrentStockRow[]>([]);
  const [ledger, setLedger] = useState<InventoryLedgerEntry[]>([]);
  const [filters, setFilters] = useState<InventoryFilters>(DEFAULT_FILTERS);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [itemForm, setItemForm] = useState<InventoryItemDraft | null>(null);
  const [categoryForm, setCategoryForm] = useState<InventoryCategoryDraft | null>(null);
  const [supplierForm, setSupplierForm] = useState<InventorySupplierDraft | null>(null);
  const [storageForm, setStorageForm] = useState<InventorySimpleDraft | null>(null);
  const [unitForm, setUnitForm] = useState<InventorySimpleDraft | null>(null);
  const [movementForm, setMovementForm] = useState<StockMovementDraft>(stockMovementDraft("stock_in"));
  const [adjustmentForm, setAdjustmentForm] = useState<InventoryAdjustmentDraft>(adjustmentDraft());
  const [wasteForm, setWasteForm] = useState<InventoryWasteDraft>(wasteDraft());
  const [transferForm, setTransferForm] = useState<InventoryTransferDraft>(transferDraft());
  const [openingForm, setOpeningForm] = useState<InventoryOpeningBalanceDraft>(openingBalanceDraft());

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      const [next, nextStock, nextLedger] = await Promise.all([
        loadInventoryAdminData(restaurantId),
        loadCurrentStock(restaurantId),
        loadLedger(restaurantId, { limit: 200 }),
      ]);
      setData(next);
      setCurrentStock(nextStock);
      setLedger(nextLedger);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inventory is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (isInventorySection(initialSection)) setSection(initialSection);
  }, [initialSection]);

  const activeCategories = data.categories.filter((row) => row.status === "active");
  const activeSuppliers = data.suppliers.filter((row) => row.status === "active");
  const activeLocations = data.storageLocations.filter((row) => row.status === "active");
  const activeUnits = data.units.filter((row) => row.status === "active");
  const stockContext = useMemo(() => ({ ...data, currentStock }), [data, currentStock]);

  const categoryNames = useMemo(() => new Map(data.categories.map((row) => [row.id, row.name])), [data.categories]);
  const supplierNames = useMemo(() => new Map(data.suppliers.map((row) => [row.id, row.name])), [data.suppliers]);
  const storageNames = useMemo(() => new Map(data.storageLocations.map((row) => [row.id, row.name])), [data.storageLocations]);
  const unitNames = useMemo(() => new Map(data.units.map((row) => [row.id, row.name])), [data.units]);
  const lowStockRows = currentStock.filter((row) => row.stockStatus === "low_stock" || row.stockStatus === "out_of_stock");
  const recentLedger = ledger.slice(0, 8);

  const filteredItems = useMemo(() => getFilteredItems(data, filters), [data, filters]);
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / ITEM_PAGE_SIZE));
  const pagedItems = filteredItems.slice((page - 1) * ITEM_PAGE_SIZE, page * ITEM_PAGE_SIZE);
  const recentlyAdded = data.items.filter((item) => new Date(item.createdAt).getTime() >= todayCutoff());
  const archivedItems = data.items.filter((item) => item.status === "archived");

  useEffect(() => {
    setPage(1);
    setSelectedIds([]);
  }, [filters, section]);

  useEffect(() => {
    if (section === "stock-in" && movementForm.movementType !== "stock_in") {
      setMovementForm(stockMovementDraft("stock_in"));
    }
    if (section === "stock-out" && movementForm.movementType !== "stock_out") {
      setMovementForm(stockMovementDraft("stock_out"));
    }
  }, [movementForm.movementType, section]);

  async function run(action: () => Promise<void>, success: string) {
    try {
      setWorking(true);
      setMessage(null);
      setError(null);
      await action();
      await reload();
      setMessage(success);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inventory action failed.");
      return false;
    } finally {
      setWorking(false);
    }
  }

  function navigate(next: InventorySection) {
    setSection(next);
    window.history.pushState({}, "", `/inventory/${next}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  function setFilter<Key extends keyof InventoryFilters>(key: Key, value: InventoryFilters[Key]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  async function logout() {
    await signOutStaff();
    window.location.replace("/staff-login");
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function selectPageItems(checked: boolean) {
    const pageIds = pagedItems.map((item) => item.id);
    setSelectedIds((current) =>
      checked ? [...new Set([...current, ...pageIds])] : current.filter((id) => !pageIds.includes(id)),
    );
  }

  const dashboard = (
    <div className="ia-stack">
      <section className="ia-metrics" aria-label="Inventory summary">
        <button type="button" onClick={() => navigate("items")}>
          <span>Total Inventory Items</span>
          <strong>{data.items.filter((item) => item.status !== "deleted").length}</strong>
        </button>
        <button type="button" onClick={() => navigate("current-stock")}>
          <span>Tracked Stock Lines</span>
          <strong>{currentStock.length}</strong>
        </button>
        <button type="button" onClick={() => navigate("current-stock")}>
          <span>Low or Out</span>
          <strong>{lowStockRows.length}</strong>
        </button>
        <button type="button" onClick={() => navigate("ledger")}>
          <span>Ledger Entries</span>
          <strong>{ledger.length}</strong>
        </button>
        <button type="button" onClick={() => navigate("categories")}>
          <span>Categories</span>
          <strong>{data.categories.filter((row) => row.status !== "deleted").length}</strong>
        </button>
        <button type="button" onClick={() => navigate("suppliers")}>
          <span>Suppliers</span>
          <strong>{data.suppliers.filter((row) => row.status !== "deleted").length}</strong>
        </button>
        <button type="button" onClick={() => navigate("storage-locations")}>
          <span>Storage Locations</span>
          <strong>{data.storageLocations.filter((row) => row.status !== "deleted").length}</strong>
        </button>
        <button type="button" onClick={() => navigate("units")}>
          <span>Units</span>
          <strong>{data.units.filter((row) => row.status !== "deleted").length}</strong>
        </button>
        <button type="button" onClick={() => setFilter("archived", "archived")}>
          <span>Archived Items</span>
          <strong>{archivedItems.length}</strong>
        </button>
      </section>

      <section className="ia-toolbar dashboard">
        <label className="ia-search">
          <span>Search</span>
          <input
            value={filters.search}
            onChange={(event) => setFilter("search", event.target.value)}
            placeholder="Search item, SKU, barcode, category, supplier, storage"
          />
        </label>
        <div className="ia-actions">
          <button type="button" onClick={() => navigate("stock-in")}>Stock In</button>
          <button type="button" onClick={() => navigate("stock-out")}>Stock Out</button>
          <button type="button" onClick={() => navigate("transfers")}>Transfer</button>
          <button type="button" onClick={() => { navigate("items"); setItemForm(itemDraft()); }}>Create Item</button>
          <button type="button" onClick={() => { navigate("categories"); setCategoryForm(categoryDraft()); }}>Create Category</button>
          <button type="button" onClick={() => { navigate("suppliers"); setSupplierForm(supplierDraft()); }}>Create Supplier</button>
        </div>
      </section>

      <section className="ia-split">
        <div>
          <div className="ia-section-title">
            <h2>Recently Added Items</h2>
            <span>Last 7 days</span>
          </div>
          <div className="ia-list">
            {recentlyAdded.slice(0, 6).map((item) => (
              <button className="ia-list-row" type="button" key={item.id} onClick={() => { navigate("items"); setItemForm(itemDraft(item)); }}>
                <strong>{item.name}</strong>
                <span>{categoryNames.get(item.categoryId) ?? "No category"} / {unitNames.get(item.unitId) ?? "No unit"}</span>
                {statusBadge(item.status)}
              </button>
            ))}
            {recentlyAdded.length === 0 && <div className="ia-empty">No recently added items.</div>}
          </div>
        </div>
        <div>
          <div className="ia-section-title">
            <h2>Quick Actions</h2>
            <span>Master data setup</span>
          </div>
          <div className="ia-quick-grid">
            <button type="button" onClick={() => { navigate("storage-locations"); setStorageForm(simpleDraft()); }}>Add Storage Location</button>
            <button type="button" onClick={() => { navigate("units"); setUnitForm(simpleDraft()); }}>Add Unit</button>
            <button type="button" onClick={() => navigate("adjustments")}>Record Adjustment</button>
            <button type="button" onClick={() => navigate("waste")}>Record Waste</button>
            <button type="button" onClick={() => { setFilter("recentlyAdded", true); navigate("items"); }}>View Recent Items</button>
            <button type="button" onClick={() => navigate("ledger")}>View Ledger</button>
          </div>
        </div>
      </section>

      <section className="ia-split">
        <div>
          <div className="ia-section-title">
            <h2>Current Stock</h2>
            <span>Movement-derived balances</span>
          </div>
          <div className="ia-list">
            {lowStockRows.slice(0, 6).map((row) => (
              <button className="ia-list-row" type="button" key={`${row.inventoryItemId}:${row.storageLocationId}`} onClick={() => navigate("current-stock")}>
                <strong>{row.itemName}</strong>
                <span>{row.storageLocationName} / {quantityLabel(row.currentQuantity, row.unitName)}</span>
                <span className={`ia-status ${row.stockStatus}`}>{row.stockStatus.replace(/_/g, " ")}</span>
              </button>
            ))}
            {lowStockRows.length === 0 && <div className="ia-empty">No low stock lines.</div>}
          </div>
        </div>
        <div>
          <div className="ia-section-title">
            <h2>Recent Activity</h2>
            <span>Latest ledger entries</span>
          </div>
          <div className="ia-list">
            {recentLedger.slice(0, 6).map((entry) => (
              <button className="ia-list-row" type="button" key={entry.id} onClick={() => navigate("ledger")}>
                <strong>{entry.itemName}</strong>
                <span>{movementLabel(entry.movementType)} / {entry.storageLocationName}</span>
                <span>{entry.quantityEffect === "in" ? "+" : "-"}{quantityLabel(entry.quantity, entry.unitName)}</span>
              </button>
            ))}
            {recentLedger.length === 0 && <div className="ia-empty">No stock movements recorded yet.</div>}
          </div>
        </div>
      </section>
    </div>
  );

  const stockRows = currentStock.filter((row) => {
    const search = filters.search.trim().toLowerCase();
    if (filters.categoryId && row.categoryId !== filters.categoryId) return false;
    if (filters.storageLocationId && row.storageLocationId !== filters.storageLocationId) return false;
    if (!search) return true;
    return [row.itemName, row.categoryName, row.storageLocationName, row.unitName].some((value) =>
      (value ?? "").toLowerCase().includes(search),
    );
  });

  const currentStockView = (
    <div className="ia-stack">
      <section className="ia-toolbar">
        <label className="ia-search">
          <span>Search</span>
          <input value={filters.search} onChange={(event) => setFilter("search", event.target.value)} placeholder="Search item, category, storage, unit" />
        </label>
        <div className="ia-actions">
          <button type="button" onClick={() => navigate("stock-in")}>Stock In</button>
          <button type="button" onClick={() => navigate("stock-out")}>Stock Out</button>
          <button type="button" onClick={() => navigate("transfers")}>Transfer</button>
        </div>
      </section>
      <section className="ia-filters" aria-label="Current stock filters">
        <select value={filters.categoryId} onChange={(event) => setFilter("categoryId", event.target.value)}>
          <option value="">All categories</option>
          {activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <select value={filters.storageLocationId} onChange={(event) => setFilter("storageLocationId", event.target.value)}>
          <option value="">All storage</option>
          {activeLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
      </section>
      <section className="ia-table-wrap">
        <table className="ia-table stock">
          <thead>
            <tr>
              <th>Item</th>
              <th>Category</th>
              <th>Storage</th>
              <th>Current Quantity</th>
              <th>Minimum</th>
              <th>Maximum</th>
              <th>Status</th>
              <th>Last Movement</th>
            </tr>
          </thead>
          <tbody>
            {stockRows.map((row) => (
              <tr key={`${row.inventoryItemId}:${row.storageLocationId}`}>
                <td><strong>{row.itemName}</strong><small>{row.unitName}</small></td>
                <td>{row.categoryName ?? "Uncategorized"}</td>
                <td>{row.storageLocationName}</td>
                <td><strong>{quantityLabel(row.currentQuantity, row.unitName)}</strong></td>
                <td>{quantityLabel(row.minimumStock, row.unitName)}</td>
                <td>{row.maximumStock == null ? "None" : quantityLabel(row.maximumStock, row.unitName)}</td>
                <td><span className={`ia-status ${row.stockStatus}`}>{row.stockStatus.replace(/_/g, " ")}</span></td>
                <td>{row.lastMovementAt ? dateLabel(row.lastMovementAt) : "No movement"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {stockRows.length === 0 && <div className="ia-empty">No current stock rows match the current filters.</div>}
      </section>
    </div>
  );

  const ledgerRows = ledger.filter((entry) => {
    const search = filters.search.trim().toLowerCase();
    if (filters.storageLocationId && entry.storageLocationId !== filters.storageLocationId) return false;
    if (!search) return true;
    return [
      entry.itemName,
      entry.storageLocationName,
      entry.supplierName,
      entry.referenceNumber,
      entry.invoiceNumber,
      entry.reason,
      movementLabel(entry.movementType),
    ].some((value) => (value ?? "").toLowerCase().includes(search));
  });

  const ledgerView = (
    <div className="ia-stack">
      <section className="ia-toolbar">
        <label className="ia-search">
          <span>Search</span>
          <input value={filters.search} onChange={(event) => setFilter("search", event.target.value)} placeholder="Search item, reference, reason, storage" />
        </label>
        <div className="ia-actions">
          <button type="button" onClick={() => void reload()}>Refresh</button>
        </div>
      </section>
      <section className="ia-filters" aria-label="Ledger filters">
        <select value={filters.storageLocationId} onChange={(event) => setFilter("storageLocationId", event.target.value)}>
          <option value="">All storage</option>
          {activeLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
      </section>
      <section className="ia-table-wrap">
        <table className="ia-table ledger">
          <thead>
            <tr>
              <th>Date</th>
              <th>Movement</th>
              <th>Item</th>
              <th>Storage</th>
              <th>Qty</th>
              <th>Reference</th>
              <th>Reason</th>
              <th>Staff</th>
            </tr>
          </thead>
          <tbody>
            {ledgerRows.map((entry) => (
              <tr key={entry.id}>
                <td>{dateLabel(entry.movementDate)}</td>
                <td>{movementLabel(entry.movementType)}</td>
                <td><strong>{entry.itemName}</strong><small>{entry.supplierName ?? "No supplier"}</small></td>
                <td>{entry.storageLocationName}</td>
                <td><strong className={entry.quantityEffect === "in" ? "ia-positive" : "ia-negative"}>{entry.quantityEffect === "in" ? "+" : "-"}{quantityLabel(entry.quantity, entry.unitName)}</strong></td>
                <td>{entry.referenceNumber ?? entry.invoiceNumber ?? "None"}</td>
                <td>{entry.reason ?? entry.notes ?? "None"}</td>
                <td>{entry.staffName ?? "Staff"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ledgerRows.length === 0 && <div className="ia-empty">No ledger entries match the current filters.</div>}
      </section>
    </div>
  );

  const movements = (
    <div className="ia-stack">
      <section className="ia-operation-grid">
        <button type="button" onClick={() => navigate("stock-in")}><strong>Stock In</strong><span>Add received stock to a storage location.</span></button>
        <button type="button" onClick={() => navigate("stock-out")}><strong>Stock Out</strong><span>Record controlled outgoing stock.</span></button>
        <button type="button" onClick={() => navigate("adjustments")}><strong>Adjustments</strong><span>Increase or decrease stock with a reason.</span></button>
        <button type="button" onClick={() => navigate("waste")}><strong>Waste</strong><span>Record waste or spoilage from available stock.</span></button>
        <button type="button" onClick={() => navigate("transfers")}><strong>Transfers</strong><span>Move stock between two storage locations.</span></button>
        <button type="button" onClick={() => navigate("ledger")}><strong>Ledger</strong><span>Review immutable movement history.</span></button>
      </section>
      <section className="ia-panel">
        <div className="ia-section-title"><h2>Opening Balance</h2><span>Use before the first movement for a stock line</span></div>
        <OpeningBalanceForm
          draft={openingForm}
          setDraft={setOpeningForm}
          items={data.items.filter((item) => item.status === "active")}
          locations={activeLocations}
          working={working}
          onSave={() => void run(async () => {
            await recordOpeningBalance(restaurantId, openingForm, stockContext);
            setOpeningForm(openingBalanceDraft());
          }, "Opening balance recorded.")}
        />
      </section>
      <section className="ia-panel">
        <div className="ia-section-title"><h2>Recent Activity</h2><span>{recentLedger.length} latest entries</span></div>
        <div className="ia-list">
          {recentLedger.map((entry) => (
            <button className="ia-list-row" type="button" key={entry.id} onClick={() => navigate("ledger")}>
              <strong>{entry.itemName}</strong>
              <span>{movementLabel(entry.movementType)} / {entry.storageLocationName}</span>
              <span>{entry.quantityEffect === "in" ? "+" : "-"}{quantityLabel(entry.quantity, entry.unitName)}</span>
            </button>
          ))}
          {recentLedger.length === 0 && <div className="ia-empty">No stock movements recorded yet.</div>}
        </div>
      </section>
    </div>
  );

  const stockMovement = (
    <section className="ia-panel">
      <div className="ia-section-title">
        <h2>{movementForm.movementType === "stock_in" ? "Stock In" : "Stock Out"}</h2>
        <span>{movementForm.movementType === "stock_in" ? "Incoming stock movement" : "Outgoing stock movement"}</span>
      </div>
      <StockMovementForm
        draft={movementForm}
        setDraft={setMovementForm}
        items={data.items.filter((item) => item.status === "active")}
        suppliers={activeSuppliers}
        locations={activeLocations}
        working={working}
        onSave={() => void run(async () => {
          const nextType = movementForm.movementType;
          await recordStockMovement(restaurantId, movementForm, stockContext);
          setMovementForm(stockMovementDraft(nextType));
        }, movementForm.movementType === "stock_in" ? "Stock in recorded." : "Stock out recorded.")}
      />
    </section>
  );

  const adjustments = (
    <section className="ia-panel">
      <div className="ia-section-title"><h2>Adjustments</h2><span>Reasoned stock corrections</span></div>
      <AdjustmentForm
        draft={adjustmentForm}
        setDraft={setAdjustmentForm}
        items={data.items.filter((item) => item.status === "active")}
        locations={activeLocations}
        working={working}
        onSave={() => void run(async () => {
          await adjustInventoryStock(restaurantId, adjustmentForm, stockContext);
          setAdjustmentForm(adjustmentDraft());
        }, "Adjustment recorded.")}
      />
    </section>
  );

  const waste = (
    <section className="ia-panel">
      <div className="ia-section-title"><h2>Waste</h2><span>Waste and spoilage entries</span></div>
      <WasteForm
        draft={wasteForm}
        setDraft={setWasteForm}
        items={data.items.filter((item) => item.status === "active")}
        locations={activeLocations}
        working={working}
        onSave={() => void run(async () => {
          await wasteInventoryStock(restaurantId, wasteForm, stockContext);
          setWasteForm(wasteDraft());
        }, "Waste recorded.")}
      />
    </section>
  );

  const transfers = (
    <section className="ia-panel">
      <div className="ia-section-title"><h2>Transfers</h2><span>Balanced transfer out and transfer in</span></div>
      <TransferForm
        draft={transferForm}
        setDraft={setTransferForm}
        items={data.items.filter((item) => item.status === "active")}
        locations={activeLocations}
        working={working}
        onSave={() => void run(async () => {
          await transferInventoryStock(restaurantId, transferForm, stockContext);
          setTransferForm(transferDraft());
        }, "Transfer recorded.")}
      />
    </section>
  );

  const items = (
    <div className="ia-stack">
      <section className="ia-toolbar">
        <label className="ia-search">
          <span>Search</span>
          <input
            value={filters.search}
            onChange={(event) => setFilter("search", event.target.value)}
            placeholder="Item name, SKU, barcode, category, supplier, storage"
          />
        </label>
        <div className="ia-actions">
          <button type="button" onClick={() => setItemForm(itemDraft())}>Create Item</button>
          <button type="button" disabled={selectedIds.length === 0 || working} onClick={() => void run(() => bulkArchiveItems(restaurantId, selectedIds), "Selected items archived.")}>Archive Selected</button>
          <button type="button" disabled={selectedIds.length === 0 || working} onClick={() => void run(() => bulkRestoreItems(restaurantId, selectedIds), "Selected items restored.")}>Restore Selected</button>
          <button type="button" disabled={selectedIds.length === 0 || working} onClick={() => void run(() => bulkSoftDeleteItems(restaurantId, selectedIds), "Selected items soft deleted.")}>Soft Delete</button>
          <button type="button" onClick={() => setMessage("Export is a future placeholder only.")}>Export</button>
        </div>
      </section>

      <section className="ia-filters" aria-label="Inventory item filters">
        <select value={filters.categoryId} onChange={(event) => setFilter("categoryId", event.target.value)}>
          <option value="">All categories</option>
          {activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <select value={filters.supplierId} onChange={(event) => setFilter("supplierId", event.target.value)}>
          <option value="">All suppliers</option>
          {activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select>
        <select value={filters.storageLocationId} onChange={(event) => setFilter("storageLocationId", event.target.value)}>
          <option value="">All storage</option>
          {activeLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
        <select value={filters.archived} onChange={(event) => setFilter("archived", event.target.value as InventoryFilters["archived"])}>
          <option value="active">Active only</option>
          <option value="archived">Archived only</option>
          <option value="all">All statuses</option>
        </select>
        <select value={filters.status} onChange={(event) => setFilter("status", event.target.value as InventoryFilters["status"])}>
          <option value="all">Any status</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="deleted">Soft deleted</option>
        </select>
        <select value={filters.sort} onChange={(event) => setFilter("sort", event.target.value as InventoryFilters["sort"])}>
          <option value="recent">Recently Added</option>
          <option value="alphabetical">Alphabetical</option>
          <option value="category">Category</option>
          <option value="supplier">Supplier</option>
          <option value="storage">Storage</option>
          <option value="status">Status</option>
        </select>
        <label className="ia-checkbox">
          <input checked={filters.recentlyAdded} type="checkbox" onChange={(event) => setFilter("recentlyAdded", event.target.checked)} />
          Recently Added
        </label>
      </section>

      <section className="ia-table-wrap">
        <table className="ia-table">
          <thead>
            <tr>
              <th><input aria-label="Select page" type="checkbox" checked={pagedItems.length > 0 && pagedItems.every((item) => selectedIds.includes(item.id))} onChange={(event) => selectPageItems(event.target.checked)} /></th>
              <th>Item Name</th>
              <th>Category</th>
              <th>Unit</th>
              <th>Storage</th>
              <th>Supplier</th>
              <th>SKU</th>
              <th>Barcode</th>
              <th>Minimum</th>
              <th>Maximum</th>
              <th>Status</th>
              <th>Created By</th>
              <th>Updated By</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pagedItems.map((item) => (
              <tr key={item.id}>
                <td><input aria-label={`Select ${item.name}`} type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelected(item.id)} /></td>
                <td><strong>{item.name}</strong><small>{item.description ?? "No description"}</small></td>
                <td>{categoryNames.get(item.categoryId) ?? "Missing"}</td>
                <td>{unitNames.get(item.unitId) ?? "Missing"}</td>
                <td>{storageNames.get(item.storageLocationId) ?? "Missing"}</td>
                <td>{item.preferredSupplierId ? supplierNames.get(item.preferredSupplierId) ?? "Missing" : "None"}</td>
                <td>{item.sku ?? "None"}</td>
                <td>{item.barcode ?? "None"}</td>
                <td>{item.minimumStock}</td>
                <td>{item.maximumStock ?? "None"}</td>
                <td>{statusBadge(item.status)}</td>
                <td>{item.createdByStaffId ? data.staffNames[item.createdByStaffId] ?? "Staff" : "System"}</td>
                <td>{item.updatedByStaffId ? data.staffNames[item.updatedByStaffId] ?? "Staff" : "System"}</td>
                <td>
                  <div className="ia-row-actions">
                    <button type="button" onClick={() => setItemForm(itemDraft(item))}>Edit</button>
                    <button type="button" onClick={() => void run(() => duplicateItem(restaurantId, item, data), "Item duplicated.")}>Duplicate</button>
                    {item.status === "archived" ? (
                      <button type="button" onClick={() => void run(() => restoreRecord(restaurantId, "inventory_items", item.id), "Item restored.")}>Restore</button>
                    ) : (
                      <button type="button" onClick={() => void run(() => archiveRecord(restaurantId, "inventory_items", item.id), "Item archived.")}>Archive</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pagedItems.length === 0 && <div className="ia-empty">No inventory items match the current filters.</div>}
      </section>
      <div className="ia-pagination">
        <span>{filteredItems.length} result{filteredItems.length === 1 ? "" : "s"}</span>
        <button type="button" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
        <strong>Page {page} of {totalPages}</strong>
        <button type="button" disabled={page === totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</button>
      </div>
    </div>
  );

  function masterList(
    title: string,
    rows: Array<{ id: string; name: string; description?: string | null; status: string; createdAt: string; updatedAt: string }>,
    onCreate: () => void,
    onEdit: (id: string) => void,
    table: "inventory_categories" | "inventory_suppliers" | "inventory_storage_locations" | "inventory_units",
  ) {
    return (
      <div className="ia-stack">
        <section className="ia-toolbar">
          <div className="ia-section-title"><h2>{title}</h2><span>{rows.filter((row) => row.status !== "deleted").length} records</span></div>
          <div className="ia-actions"><button type="button" onClick={onCreate}>Create</button></div>
        </section>
        <section className="ia-record-grid">
          {rows.filter((row) => row.status !== "deleted").map((row) => (
            <article className="ia-record" key={row.id}>
              <header>
                <div>
                  <strong>{row.name}</strong>
                  <span>{row.description || "No description"}</span>
                </div>
                {statusBadge(row.status)}
              </header>
              <dl>
                <div><dt>Created</dt><dd>{dateLabel(row.createdAt)}</dd></div>
                <div><dt>Updated</dt><dd>{dateLabel(row.updatedAt)}</dd></div>
              </dl>
              <footer>
                <button type="button" onClick={() => onEdit(row.id)}>Edit</button>
                {row.status === "archived" ? (
                  <button type="button" onClick={() => void run(() => restoreRecord(restaurantId, table, row.id), "Record restored.")}>Restore</button>
                ) : (
                  <button type="button" onClick={() => void run(() => archiveRecord(restaurantId, table, row.id), "Record archived.")}>Archive</button>
                )}
                <button type="button" onClick={() => void run(() => softDeleteRecord(restaurantId, table, row.id), "Record soft deleted.")}>Soft Delete</button>
              </footer>
            </article>
          ))}
          {rows.filter((row) => row.status !== "deleted").length === 0 && <div className="ia-empty">No records yet.</div>}
        </section>
      </div>
    );
  }

  const content = section === "dashboard" ? dashboard
    : section === "current-stock" ? currentStockView
    : section === "movements" ? movements
    : section === "stock-in" ? stockMovement
    : section === "stock-out" ? stockMovement
    : section === "adjustments" ? adjustments
    : section === "waste" ? waste
    : section === "transfers" ? transfers
    : section === "ledger" ? ledgerView
    : section === "items" ? items
    : section === "categories" ? masterList("Categories", data.categories, () => setCategoryForm(categoryDraft()), (id) => setCategoryForm(categoryDraft(data.categories.find((row) => row.id === id))), "inventory_categories")
    : section === "suppliers" ? (
      <div className="ia-stack">
        <section className="ia-toolbar">
          <div className="ia-section-title"><h2>Suppliers</h2><span>{data.suppliers.filter((row) => row.status !== "deleted").length} records</span></div>
          <label className="ia-search compact"><span>Search</span><input value={filters.search} onChange={(event) => setFilter("search", event.target.value)} placeholder="Supplier name, phone, contact" /></label>
          <div className="ia-actions"><button type="button" onClick={() => setSupplierForm(supplierDraft())}>Create</button></div>
        </section>
        <section className="ia-record-grid">
          {data.suppliers
            .filter((row) => row.status !== "deleted")
            .filter((row) => !filters.search.trim() || [row.name, row.phone, row.contactPerson, row.address].some((value) => (value ?? "").toLowerCase().includes(filters.search.trim().toLowerCase())))
            .map((supplier) => (
            <article className="ia-record" key={supplier.id}>
              <header><div><strong>{supplier.name}</strong><span>{supplier.contactPerson || "No contact person"}</span></div>{statusBadge(supplier.status)}</header>
              <dl>
                <div><dt>Phone</dt><dd>{supplier.phone || "Not set"}</dd></div>
                <div><dt>Address</dt><dd>{supplier.address || "Not set"}</dd></div>
                <div><dt>Notes</dt><dd>{supplier.notes || "None"}</dd></div>
              </dl>
              <footer>
                <button type="button" onClick={() => setSupplierForm(supplierDraft(supplier))}>Edit</button>
                {supplier.status === "archived" ? (
                  <button type="button" onClick={() => void run(() => restoreRecord(restaurantId, "inventory_suppliers", supplier.id), "Supplier restored.")}>Restore</button>
                ) : (
                  <button type="button" onClick={() => void run(() => archiveRecord(restaurantId, "inventory_suppliers", supplier.id), "Supplier archived.")}>Archive</button>
                )}
                <button type="button" onClick={() => void run(() => softDeleteRecord(restaurantId, "inventory_suppliers", supplier.id), "Supplier soft deleted.")}>Soft Delete</button>
              </footer>
            </article>
          ))}
        </section>
      </div>
    )
    : section === "storage-locations" ? masterList("Storage Locations", data.storageLocations, () => setStorageForm(simpleDraft()), (id) => setStorageForm(simpleDraft(data.storageLocations.find((row) => row.id === id))), "inventory_storage_locations")
    : masterList("Units", data.units, () => setUnitForm(simpleDraft()), (id) => setUnitForm(simpleDraft(data.units.find((row) => row.id === id))), "inventory_units");

  return (
    <main className="ia-shell">
      <aside className="ia-sidebar" aria-label="Inventory navigation">
        <div className="ia-brand">
          <strong>ServeFlow</strong>
          <span>Inventory Administration</span>
        </div>
        <nav>
          {INVENTORY_NAV.map((item) => (
            <button className={section === item.key ? "active" : ""} type="button" key={item.key} onClick={() => navigate(item.key)}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="ia-user">
          <strong>{staffName}</strong>
          <span>{staffRole === "owner" ? "Owner" : "Manager"}</span>
          <button type="button" onClick={() => void logout()}>Logout</button>
        </div>
      </aside>

      <section className="ia-workspace">
        <header className="ia-header">
          <div>
            <span>Inventory</span>
            <h1>{restaurantName}</h1>
          </div>
          <div>
            <strong>{INVENTORY_NAV.find((item) => item.key === section)?.label}</strong>
            <small>Inventory control workspace</small>
          </div>
        </header>
        {(message || error) && <div className={`ia-alert ${error ? "error" : ""}`}>{error ?? message}</div>}
        {loading ? <div className="ia-empty">Loading inventory administration...</div> : content}
      </section>

      {itemForm && (
        <InventoryItemForm
          draft={itemForm}
          setDraft={setItemForm}
          data={data}
          categories={activeCategories}
          suppliers={activeSuppliers}
          locations={activeLocations}
          units={activeUnits}
          working={working}
          onSave={() => void run(() => saveItem(restaurantId, itemForm, data), itemForm.id ? "Item updated." : "Item created.").then((saved) => { if (saved) setItemForm(null); })}
        />
      )}
      {categoryForm && (
        <CategoryForm
          draft={categoryForm}
          setDraft={setCategoryForm}
          working={working}
          onSave={() => void run(() => saveCategory(restaurantId, categoryForm, data), categoryForm.id ? "Category updated." : "Category created.").then((saved) => { if (saved) setCategoryForm(null); })}
        />
      )}
      {supplierForm && (
        <SupplierForm
          draft={supplierForm}
          setDraft={setSupplierForm}
          working={working}
          onSave={() => void run(() => saveSupplier(restaurantId, supplierForm, data), supplierForm.id ? "Supplier updated." : "Supplier created.").then((saved) => { if (saved) setSupplierForm(null); })}
        />
      )}
      {storageForm && (
        <SimpleForm
          title="Storage Location"
          draft={storageForm}
          setDraft={setStorageForm}
          working={working}
          examples="Main Store, Freezer, Cold Room, Bar Store, Bakery Store"
          onSave={() => void run(() => saveStorageLocation(restaurantId, storageForm, data), storageForm.id ? "Storage location updated." : "Storage location created.").then((saved) => { if (saved) setStorageForm(null); })}
        />
      )}
      {unitForm && (
        <SimpleForm
          title="Unit"
          draft={unitForm}
          setDraft={setUnitForm}
          working={working}
          examples="kg, g, L, ml, pcs, box, bag, cup, bottle"
          onSave={() => void run(() => saveUnit(restaurantId, unitForm, data), unitForm.id ? "Unit updated." : "Unit created.").then((saved) => { if (saved) setUnitForm(null); })}
        />
      )}
    </main>
  );
}

function StockMovementForm({
  draft,
  setDraft,
  items,
  suppliers,
  locations,
  working,
  onSave,
}: {
  draft: StockMovementDraft;
  setDraft: (draft: StockMovementDraft) => void;
  items: InventoryItem[];
  suppliers: InventorySupplier[];
  locations: Array<{ id: string; name: string }>;
  working: boolean;
  onSave: () => void;
}) {
  const incoming = draft.movementType === "stock_in";
  return (
    <form className="ia-form operation" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <label>Item<select required value={draft.inventoryItemId} onChange={(event) => setDraft({ ...draft, inventoryItemId: event.target.value })}><option value="">Select item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Storage<select required value={draft.storageLocationId} onChange={(event) => setDraft({ ...draft, storageLocationId: event.target.value })}><option value="">Select storage</option>{locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label>Quantity<input required min="0.001" step="0.001" type="number" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} /></label>
      <label>Movement Date<input type="datetime-local" value={draft.movementDate} onChange={(event) => setDraft({ ...draft, movementDate: event.target.value })} /></label>
      {incoming && <label>Supplier<select value={draft.supplierId} onChange={(event) => setDraft({ ...draft, supplierId: event.target.value })}><option value="">None</option>{suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
      <label>Reference<input value={draft.referenceNumber} onChange={(event) => setDraft({ ...draft, referenceNumber: event.target.value })} /></label>
      {incoming && <label>Invoice<input value={draft.invoiceNumber} onChange={(event) => setDraft({ ...draft, invoiceNumber: event.target.value })} /></label>}
      <label className="wide">Reason<textarea value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} /></label>
      <label className="wide">Notes<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
      <footer><button disabled={working} type="submit">{working ? "Saving..." : incoming ? "Record Stock In" : "Record Stock Out"}</button></footer>
    </form>
  );
}

function AdjustmentForm({
  draft,
  setDraft,
  items,
  locations,
  working,
  onSave,
}: {
  draft: InventoryAdjustmentDraft;
  setDraft: (draft: InventoryAdjustmentDraft) => void;
  items: InventoryItem[];
  locations: Array<{ id: string; name: string }>;
  working: boolean;
  onSave: () => void;
}) {
  return (
    <form className="ia-form operation" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <label>Item<select required value={draft.inventoryItemId} onChange={(event) => setDraft({ ...draft, inventoryItemId: event.target.value })}><option value="">Select item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Storage<select required value={draft.storageLocationId} onChange={(event) => setDraft({ ...draft, storageLocationId: event.target.value })}><option value="">Select storage</option>{locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label>Direction<select value={draft.direction} onChange={(event) => setDraft({ ...draft, direction: event.target.value as InventoryAdjustmentDraft["direction"] })}><option value="increase">Increase</option><option value="decrease">Decrease</option></select></label>
      <label>Quantity<input required min="0.001" step="0.001" type="number" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} /></label>
      <label>Movement Date<input type="datetime-local" value={draft.movementDate} onChange={(event) => setDraft({ ...draft, movementDate: event.target.value })} /></label>
      <label className="wide">Reason<textarea required value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} /></label>
      <label className="wide">Notes<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
      <footer><button disabled={working} type="submit">{working ? "Saving..." : "Record Adjustment"}</button></footer>
    </form>
  );
}

function WasteForm({
  draft,
  setDraft,
  items,
  locations,
  working,
  onSave,
}: {
  draft: InventoryWasteDraft;
  setDraft: (draft: InventoryWasteDraft) => void;
  items: InventoryItem[];
  locations: Array<{ id: string; name: string }>;
  working: boolean;
  onSave: () => void;
}) {
  return (
    <form className="ia-form operation" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <label>Item<select required value={draft.inventoryItemId} onChange={(event) => setDraft({ ...draft, inventoryItemId: event.target.value })}><option value="">Select item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Storage<select required value={draft.storageLocationId} onChange={(event) => setDraft({ ...draft, storageLocationId: event.target.value })}><option value="">Select storage</option>{locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label>Quantity<input required min="0.001" step="0.001" type="number" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} /></label>
      <label>Movement Date<input type="datetime-local" value={draft.movementDate} onChange={(event) => setDraft({ ...draft, movementDate: event.target.value })} /></label>
      <label className="ia-checkbox inline"><input checked={draft.isSpoilage} type="checkbox" onChange={(event) => setDraft({ ...draft, isSpoilage: event.target.checked })} /> Spoilage</label>
      <label className="wide">Reason<textarea required value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} /></label>
      <label className="wide">Notes<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
      <footer><button disabled={working} type="submit">{working ? "Saving..." : "Record Waste"}</button></footer>
    </form>
  );
}

function TransferForm({
  draft,
  setDraft,
  items,
  locations,
  working,
  onSave,
}: {
  draft: InventoryTransferDraft;
  setDraft: (draft: InventoryTransferDraft) => void;
  items: InventoryItem[];
  locations: Array<{ id: string; name: string }>;
  working: boolean;
  onSave: () => void;
}) {
  return (
    <form className="ia-form operation" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <label>Item<select required value={draft.inventoryItemId} onChange={(event) => setDraft({ ...draft, inventoryItemId: event.target.value })}><option value="">Select item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>From<select required value={draft.fromStorageLocationId} onChange={(event) => setDraft({ ...draft, fromStorageLocationId: event.target.value })}><option value="">Select source</option>{locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label>To<select required value={draft.toStorageLocationId} onChange={(event) => setDraft({ ...draft, toStorageLocationId: event.target.value })}><option value="">Select destination</option>{locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label>Quantity<input required min="0.001" step="0.001" type="number" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} /></label>
      <label>Reference<input value={draft.referenceNumber} onChange={(event) => setDraft({ ...draft, referenceNumber: event.target.value })} /></label>
      <label>Movement Date<input type="datetime-local" value={draft.movementDate} onChange={(event) => setDraft({ ...draft, movementDate: event.target.value })} /></label>
      <label className="wide">Reason<textarea value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} /></label>
      <label className="wide">Notes<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
      <footer><button disabled={working} type="submit">{working ? "Saving..." : "Record Transfer"}</button></footer>
    </form>
  );
}

function OpeningBalanceForm({
  draft,
  setDraft,
  items,
  locations,
  working,
  onSave,
}: {
  draft: InventoryOpeningBalanceDraft;
  setDraft: (draft: InventoryOpeningBalanceDraft) => void;
  items: InventoryItem[];
  locations: Array<{ id: string; name: string }>;
  working: boolean;
  onSave: () => void;
}) {
  return (
    <form className="ia-form operation" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <label>Item<select required value={draft.inventoryItemId} onChange={(event) => setDraft({ ...draft, inventoryItemId: event.target.value })}><option value="">Select item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Storage<select required value={draft.storageLocationId} onChange={(event) => setDraft({ ...draft, storageLocationId: event.target.value })}><option value="">Select storage</option>{locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label>Quantity<input required min="0.001" step="0.001" type="number" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} /></label>
      <label>Reference<input value={draft.referenceNumber} onChange={(event) => setDraft({ ...draft, referenceNumber: event.target.value })} /></label>
      <label>Movement Date<input type="datetime-local" value={draft.movementDate} onChange={(event) => setDraft({ ...draft, movementDate: event.target.value })} /></label>
      <label className="wide">Notes<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
      <footer><button disabled={working} type="submit">{working ? "Saving..." : "Record Opening Balance"}</button></footer>
    </form>
  );
}

function FormShell({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="ia-modal-backdrop">
      <section className="ia-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        {children}
      </section>
    </div>
  );
}

function InventoryItemForm({
  draft,
  setDraft,
  data,
  categories,
  suppliers,
  locations,
  units,
  working,
  onSave,
}: {
  draft: InventoryItemDraft;
  setDraft: (draft: InventoryItemDraft | null) => void;
  data: InventoryAdminData;
  categories: InventoryCategory[];
  suppliers: InventorySupplier[];
  locations: Array<{ id: string; name: string }>;
  units: Array<{ id: string; name: string }>;
  working: boolean;
  onSave: () => void;
}) {
  const canCreate = data.categories.length > 0 && data.units.length > 0 && data.storageLocations.length > 0;
  return (
    <FormShell title={draft.id ? "Edit Inventory Item" : "Create Inventory Item"} onClose={() => setDraft(null)}>
      {!canCreate && <div className="ia-alert error">Create at least one category, unit, and storage location before saving items.</div>}
      <form className="ia-form" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
        <label>Item Name<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Category<select required value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}><option value="">Select category</option>{categories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label>Unit<select required value={draft.unitId} onChange={(event) => setDraft({ ...draft, unitId: event.target.value })}><option value="">Select unit</option>{units.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label>Storage Location<select required value={draft.storageLocationId} onChange={(event) => setDraft({ ...draft, storageLocationId: event.target.value })}><option value="">Select storage</option>{locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label>Preferred Supplier<select value={draft.preferredSupplierId} onChange={(event) => setDraft({ ...draft, preferredSupplierId: event.target.value })}><option value="">None</option>{suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label>SKU<input value={draft.sku} onChange={(event) => setDraft({ ...draft, sku: event.target.value })} /></label>
        <label>Barcode<input value={draft.barcode} onChange={(event) => setDraft({ ...draft, barcode: event.target.value })} /></label>
        <label>Minimum Stock<input min="0" step="0.001" type="number" value={draft.minimumStock} onChange={(event) => setDraft({ ...draft, minimumStock: event.target.value })} /></label>
        <label>Maximum Stock<input min="0" step="0.001" type="number" value={draft.maximumStock} onChange={(event) => setDraft({ ...draft, maximumStock: event.target.value })} /></label>
        <label className="wide">Description<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        <footer><button disabled={working || !canCreate} type="submit">{working ? "Saving..." : "Save Item"}</button></footer>
      </form>
    </FormShell>
  );
}

function CategoryForm({ draft, setDraft, working, onSave }: { draft: InventoryCategoryDraft; setDraft: (draft: InventoryCategoryDraft | null) => void; working: boolean; onSave: () => void }) {
  return (
    <FormShell title={draft.id ? "Edit Category" : "Create Category"} onClose={() => setDraft(null)}>
      <form className="ia-form" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
        <label>Name<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Sort Order<input type="number" step="1" value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })} /></label>
        <label className="wide">Description<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        <footer><button disabled={working} type="submit">{working ? "Saving..." : "Save Category"}</button></footer>
      </form>
    </FormShell>
  );
}

function SupplierForm({ draft, setDraft, working, onSave }: { draft: InventorySupplierDraft; setDraft: (draft: InventorySupplierDraft | null) => void; working: boolean; onSave: () => void }) {
  return (
    <FormShell title={draft.id ? "Edit Supplier" : "Create Supplier"} onClose={() => setDraft(null)}>
      <form className="ia-form" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
        <label>Name<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Phone<input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label>
        <label>Contact Person<input value={draft.contactPerson} onChange={(event) => setDraft({ ...draft, contactPerson: event.target.value })} /></label>
        <label className="wide">Address<textarea value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} /></label>
        <label className="wide">Notes<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
        <footer><button disabled={working} type="submit">{working ? "Saving..." : "Save Supplier"}</button></footer>
      </form>
    </FormShell>
  );
}

function SimpleForm({ title, draft, setDraft, working, examples, onSave }: { title: string; draft: InventorySimpleDraft; setDraft: (draft: InventorySimpleDraft | null) => void; working: boolean; examples: string; onSave: () => void }) {
  return (
    <FormShell title={draft.id ? `Edit ${title}` : `Create ${title}`} onClose={() => setDraft(null)}>
      <form className="ia-form" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
        <label>Name<input required value={draft.name} placeholder={examples} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label className="wide">Description<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        <footer><button disabled={working} type="submit">{working ? "Saving..." : `Save ${title}`}</button></footer>
      </form>
    </FormShell>
  );
}

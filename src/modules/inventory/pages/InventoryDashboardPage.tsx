import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "../../../core/database";
import { signOutStaff } from "../../staff-auth/services/staffAuthService";
import { PurchaseOrderDraftsPage } from "../../purchasing/pages/PurchaseOrderDraftsPage";
import { PurchaseHistoryPage } from "../../purchasing/pages/PurchaseHistoryPage";
import { loadPurchaseHistory } from "../../purchasing/services/purchaseHistoryService";
import type { PurchaseHistoryRecord } from "../../purchasing/purchaseHistoryTypes";
import { fetchRecipes } from "../../recipes/services/recipeService";
import { InventoryIntegrityCheckPanel } from "../components/InventoryIntegrityCheckPanel";
import { useInventoryRealtime, type InventoryRealtimeBatch } from "../hooks/useInventoryRealtime";
import {
  calculateInventoryDashboardKpis,
  inventoryStatusLabel,
  stockAttentionRows,
} from "../inventoryDashboardPresentation";
import { loadCurrentStock } from "../services/inventoryBalanceService";
import { loadInventoryAdjustments } from "../services/inventoryAdjustmentService";
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
import { loadInventoryMovementHistory } from "../services/movementHistoryService";
import {
  applyInventoryAdminRealtimeChanges,
  loadRealtimeCurrentStock,
  loadRealtimeFoodMovements,
  loadRealtimeLedger,
  mergeRealtimeFoodMovements,
  mergeRealtimeLedger,
  replaceAffectedStock,
} from "../services/inventoryRealtimeService";
import { recordOpeningBalance } from "../services/openingBalanceService";
import { buildLowStockAssistantRows } from "../services/lowStockAssistantService";
import { recordStockMovement } from "../services/stockMovementService";
import { transferInventoryStock } from "../services/transferService";
import { InventoryAdjustmentsPage } from "./InventoryAdjustmentsPage";
import { LowStockAssistantPage } from "./LowStockAssistantPage";
import { MovementHistoryPage } from "./MovementHistoryPage";
import type {
  InventoryAdminData,
  InventoryAdjustment,
  InventoryCategory,
  InventoryCategoryDraft,
  InventoryCurrentStockRow,
  InventoryFilters,
  InventoryFoodConsumptionMovement,
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
  StockMovementDraft,
} from "../types";
import "../styles/inventoryDashboard.css";

type Props = {
  restaurantId: string;
  restaurantName: string;
  staffName: string;
  staffRole: "owner" | "manager" | "inventory_officer";
  initialSection?: string;
};

type IngredientMenuUsage = { usedIn: string[]; linkedTo: string[] };

const EMPTY_DATA: InventoryAdminData = {
  items: [],
  categories: [],
  suppliers: [],
  storageLocations: [],
  units: [],
  staffNames: {},
  staffRoles: {},
};

const INVENTORY_NAV: Array<{ key: InventorySection; label: string }> = [
  { key: "dashboard", label: "Dashboard" },
  { key: "current-stock", label: "Current Stock" },
  { key: "movements", label: "Movements" },
  { key: "stock-in", label: "Receive Stock" },
  { key: "stock-out", label: "Issue Stock" },
  { key: "adjustments", label: "Adjustments" },
  { key: "waste", label: "Waste" },
  { key: "transfers", label: "Transfers" },
  { key: "ledger", label: "Ledger" },
  { key: "movement-history", label: "Movement History" },
  { key: "purchase-orders", label: "Purchase Orders" },
  { key: "purchase-history", label: "Purchase History" },
  { key: "low-stock-assistant", label: "Low Stock" },
  { key: "inventory-value", label: "Inventory Value" },
  { key: "consumption", label: "Consumption" },
  { key: "waste-report", label: "Waste Report" },
  { key: "inventory-settings", label: "Inventory Settings" },
  { key: "items", label: "Ingredients" },
  { key: "categories", label: "Ingredient Categories" },
  { key: "suppliers", label: "Suppliers" },
  { key: "storage-locations", label: "Storage Locations" },
  { key: "units", label: "Units" },
];

type InventoryNavGroup = "master" | "operations" | "purchasing" | "reports" | "stock" | "records";
type InventoryUtilityView = "reports" | "settings";

const OPERATIONS_NAV: Array<{ key: InventorySection; label: string }> = [
  { key: "current-stock", label: "Current Stock" },
  { key: "stock-in", label: "Receive Stock" },
  { key: "stock-out", label: "Issue Stock" },
  { key: "transfers", label: "Transfers" },
  { key: "adjustments", label: "Adjustments" },
  { key: "waste", label: "Waste" },
  { key: "ledger", label: "Ledger" },
];

const MASTER_DATA_NAV: Array<{ key: InventorySection; label: string }> = [
  { key: "items", label: "Ingredients" },
  { key: "categories", label: "Ingredient Categories" },
  { key: "units", label: "Units" },
  { key: "storage-locations", label: "Storage" },
  { key: "suppliers", label: "Suppliers" },
];

const PURCHASING_NAV: Array<{ key: InventorySection; label: string }> = [
  { key: "purchase-orders", label: "Purchase Orders" },
  { key: "purchase-history", label: "Purchase History" },
];

const REPORTS_NAV: Array<{ key: InventorySection; label: string }> = [
  { key: "inventory-value", label: "Inventory Value" },
  { key: "low-stock-assistant", label: "Low Stock" },
  { key: "consumption", label: "Consumption" },
  { key: "waste-report", label: "Waste Report" },
];

const NAV_GROUPS: Array<{ key: InventoryNavGroup; label: string; items: Array<{ key: InventorySection; label: string }> }> = [
  { key: "master", label: "Inventory Setup", items: MASTER_DATA_NAV },
  { key: "operations", label: "Operations", items: OPERATIONS_NAV },
  { key: "purchasing", label: "Purchasing", items: PURCHASING_NAV },
  { key: "reports", label: "Reports", items: REPORTS_NAV },
];

const STOCK_MANAGEMENT_NAV = OPERATIONS_NAV;
const INVENTORY_RECORDS_NAV = MASTER_DATA_NAV;

const MOBILE_MENU_NAV: Array<{ key: string; label: string; section?: InventorySection; utility?: InventoryUtilityView; action?: "export" | "help"; group?: InventoryNavGroup }> = [
  { key: "reports", label: "Inventory Reports", section: "inventory-value", group: "reports" },
  { key: "suppliers", label: "Suppliers", section: "suppliers", group: "master" },
  { key: "setup", label: "Inventory Setup", section: "items", group: "master" },
  { key: "settings", label: "Settings", utility: "settings" },
  { key: "export", label: "Export", action: "export" },
  { key: "help", label: "Help", action: "help" },
];

const MOBILE_PRIMARY_NAV: Array<{ key: string; label: string; icon: string; section?: InventorySection; group?: InventoryNavGroup }> = [
  { key: "home", label: "Home", icon: "⌂", section: "dashboard" },
  { key: "stock", label: "Stock", icon: "▦", section: "current-stock", group: "operations" },
  { key: "add", label: "Add", icon: "+", section: "stock-in", group: "operations" },
  { key: "purchasing", label: "Purchasing", icon: "PO", section: "purchase-orders", group: "purchasing" },
];

const DEFAULT_FILTERS: InventoryFilters = {
  search: "",
  categoryId: "",
  supplierId: "",
  storageLocationId: "",
  status: "all",
  archived: "active",
  recentlyAdded: false,
  sort: "newest",
};

const ITEM_PAGE_SIZE = 10;

function isInventorySection(value: string | undefined): value is InventorySection {
  return INVENTORY_NAV.some((item) => item.key === value);
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

function moneyLabel(value: number) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
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
    purchasePrice: item ? String(item.purchasePrice) : "0",
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
  return <span className={`ia-status ${status}`} role="status">{inventoryStatusLabel(status)}</span>;
}

type DashboardActivityItem = {
  id: string;
  title: string;
  detail: string;
  date: string;
  status?: string;
};

function DashboardEmptyState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon: string;
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="ia-dashboard-empty">
      <span className="ia-empty-illustration" aria-hidden="true">{icon}</span>
      <div><strong>{title}</strong><p>{message}</p></div>
      <button type="button" onClick={onAction}>{actionLabel}</button>
    </div>
  );
}

function DashboardActivityPanel({
  title,
  subtitle,
  items,
  empty,
  onOpen,
}: {
  title: string;
  subtitle: string;
  items: DashboardActivityItem[];
  empty: { icon: string; title: string; message: string; actionLabel: string };
  onOpen: () => void;
}) {
  return (
    <article className="ia-activity-card">
      <header><div><h3>{title}</h3><span>{subtitle}</span></div><button type="button" onClick={onOpen} aria-label={`View all ${title.toLowerCase()}`}>View all</button></header>
      {items.length ? <div className="ia-activity-list">{items.map((item) => (
        <button type="button" key={item.id} onClick={onOpen} aria-label={`Open ${title.toLowerCase()}: ${item.title}`}>
          <span><strong>{item.title}</strong><small>{item.detail}</small></span>
          <span className="ia-activity-meta">{item.status && statusBadge(item.status)}<time dateTime={item.date}>{dateLabel(item.date)}</time></span>
        </button>
      ))}</div> : <DashboardEmptyState {...empty} onAction={onOpen} />}
    </article>
  );
}

function AdvancedInfo({ rows }: { rows: Array<{ label: string; value: ReactNode }> }) {
  return (
    <section className="ia-advanced-info">
      <h3>Advanced Information</h3>
      <dl>
        {rows.map((row) => (
          <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
        ))}
      </dl>
    </section>
  );
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const [inlineMasterTarget, setInlineMasterTarget] = useState<"category" | "unit" | "storage" | "supplier" | null>(null);
  const [detailIngredientId, setDetailIngredientId] = useState<string | null>(null);
  const [expandedNavGroup, setExpandedNavGroup] = useState<InventoryNavGroup | null>(null);
  const [utilityView, setUtilityView] = useState<InventoryUtilityView | null>(null);
  const [data, setData] = useState<InventoryAdminData>(EMPTY_DATA);
  const [currentStock, setCurrentStock] = useState<InventoryCurrentStockRow[]>([]);
  const [ledger, setLedger] = useState<InventoryLedgerEntry[]>([]);
  const [movementHistory, setMovementHistory] = useState<InventoryFoodConsumptionMovement[]>([]);
  const [purchaseHistory, setPurchaseHistory] = useState<PurchaseHistoryRecord[]>([]);
  const [dashboardAdjustments, setDashboardAdjustments] = useState<InventoryAdjustment[]>([]);
  const [recipeCount, setRecipeCount] = useState(0);
  const [ingredientMenuUsage, setIngredientMenuUsage] = useState<Record<string, IngredientMenuUsage>>({});
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [insightsError, setInsightsError] = useState<string | null>(null);
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
  const [transferForm, setTransferForm] = useState<InventoryTransferDraft>(transferDraft());
  const [openingForm, setOpeningForm] = useState<InventoryOpeningBalanceDraft>(openingBalanceDraft());
  const dataRef = useRef(data);
  dataRef.current = data;

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      const [next, nextStock, nextLedger, nextMovementHistory] = await Promise.all([
        loadInventoryAdminData(restaurantId),
        loadCurrentStock(restaurantId),
        loadLedger(restaurantId, { limit: 200 }),
        loadInventoryMovementHistory(restaurantId),
      ]);
      setData(next);
      setCurrentStock(nextStock);
      setLedger(nextLedger);
      setMovementHistory(nextMovementHistory);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inventory is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  const loadDashboardInsights = useCallback(async () => {
    setInsightsLoading(true);
    const results = await Promise.allSettled([
      loadPurchaseHistory(restaurantId),
      loadInventoryAdjustments(restaurantId),
      fetchRecipes(restaurantId, {
        search: "",
        categoryId: "",
        status: "all",
        preparation: "all",
        sort: "newest",
        page: 1,
        pageSize: 1,
      }),
    ]);
    const [purchasesResult, adjustmentsResult, recipesResult] = results;
    if (purchasesResult.status === "fulfilled") setPurchaseHistory(purchasesResult.value);
    if (adjustmentsResult.status === "fulfilled") setDashboardAdjustments(adjustmentsResult.value);
    if (recipesResult.status === "fulfilled") setRecipeCount(recipesResult.value.total);
    const unavailable = [
      purchasesResult.status === "rejected" ? "purchases" : null,
      adjustmentsResult.status === "rejected" ? "adjustments" : null,
      recipesResult.status === "rejected" ? "recipes" : null,
    ].filter(Boolean);
    setInsightsError(unavailable.length ? `Some dashboard activity is temporarily unavailable: ${unavailable.join(", ")}.` : null);
    setInsightsLoading(false);
  }, [restaurantId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void loadDashboardInsights();
  }, [loadDashboardInsights]);

  useEffect(() => {
    let active = true;
    async function loadIngredientMenuUsage() {
      const [menuResult, ingredientResult] = await Promise.all([
        supabase.from("menu_items").select("name,recipe_id,direct_inventory_item_id").eq("restaurant_id", restaurantId).is("archived_at", null),
        supabase.from("recipe_ingredients").select("inventory_item_id,recipe_id").eq("restaurant_id", restaurantId),
      ]);
      if (menuResult.error) throw new Error(menuResult.error.message);
      if (ingredientResult.error) throw new Error(ingredientResult.error.message);
      const menuByRecipe = new Map<string, string[]>();
      const usage: Record<string, IngredientMenuUsage> = {};
      for (const row of menuResult.data ?? []) {
        if (row.recipe_id) menuByRecipe.set(String(row.recipe_id), [...(menuByRecipe.get(String(row.recipe_id)) ?? []), String(row.name)]);
        if (row.direct_inventory_item_id) {
          const itemId = String(row.direct_inventory_item_id);
          usage[itemId] = usage[itemId] ?? { usedIn: [], linkedTo: [] };
          usage[itemId].linkedTo.push(String(row.name));
        }
      }
      for (const row of ingredientResult.data ?? []) {
        const itemId = String(row.inventory_item_id);
        usage[itemId] = usage[itemId] ?? { usedIn: [], linkedTo: [] };
        usage[itemId].usedIn.push(...(menuByRecipe.get(String(row.recipe_id)) ?? []));
      }
      for (const value of Object.values(usage)) {
        value.usedIn = [...new Set(value.usedIn)].sort();
        value.linkedTo = [...new Set(value.linkedTo)].sort();
      }
      if (active) setIngredientMenuUsage(usage);
    }
    void loadIngredientMenuUsage().catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Menu usage could not be loaded.");
    });
    return () => { active = false; };
  }, [restaurantId]);

  const reconcileRealtime = useCallback(async () => {
    const [next, nextStock, nextLedger, nextMovementHistory] = await Promise.all([
      loadInventoryAdminData(restaurantId),
      loadCurrentStock(restaurantId),
      loadLedger(restaurantId, { limit: 200 }),
      loadInventoryMovementHistory(restaurantId),
    ]);
    setData(next);
    setCurrentStock(nextStock);
    setLedger(nextLedger);
    setMovementHistory(nextMovementHistory);
    setError(null);
  }, [restaurantId]);

  const synchronizeRealtimeBatch = useCallback(async (batch: InventoryRealtimeBatch) => {
    const snapshot = dataRef.current;
    const stockItemIds = new Set(batch.movementItemIds);
    for (const change of batch.adminChanges.inventory_items ?? []) {
      const id = typeof change.record.id === "string" ? change.record.id : "";
      if (id) stockItemIds.add(id);
    }
    const affectedByReference: Array<[keyof Pick<InventoryItem, "categoryId" | "unitId" | "storageLocationId">, string[]]> = [
      ["categoryId", (batch.adminChanges.inventory_categories ?? []).map((change) => String(change.record.id ?? ""))],
      ["unitId", (batch.adminChanges.inventory_units ?? []).map((change) => String(change.record.id ?? ""))],
      ["storageLocationId", (batch.adminChanges.inventory_storage_locations ?? []).map((change) => String(change.record.id ?? ""))],
    ];
    for (const [field, referenceIds] of affectedByReference) {
      const changed = new Set(referenceIds.filter(Boolean));
      if (!changed.size) continue;
      for (const item of snapshot.items) if (changed.has(item[field])) stockItemIds.add(item.id);
    }

    setData((current) => applyInventoryAdminRealtimeChanges(current, batch.adminChanges));

    const affectedIds = [...stockItemIds];
    const [stockRows, ledgerRows, foodMovements] = await Promise.all([
      loadRealtimeCurrentStock(restaurantId, affectedIds),
      loadRealtimeLedger(restaurantId, batch.movementItemIds),
      loadRealtimeFoodMovements(restaurantId, batch.movementItemIds),
    ]);
    if (affectedIds.length) {
      setCurrentStock((current) => replaceAffectedStock(current, affectedIds, stockRows));
    }
    if (ledgerRows.length) setLedger((current) => mergeRealtimeLedger(current, ledgerRows));
    if (foodMovements.length) {
      setMovementHistory((current) => mergeRealtimeFoodMovements(current, foodMovements));
    }
    setError(null);
  }, [restaurantId]);

  useInventoryRealtime({
    restaurantId,
    staffRole,
    onBatch: synchronizeRealtimeBatch,
    onReconcile: reconcileRealtime,
    onError: (realtimeError) => setError(realtimeError instanceof Error
      ? realtimeError.message
      : "Inventory realtime synchronization failed."),
  });

  useEffect(() => {
    if (isInventorySection(initialSection)) {
      setSection(initialSection);
      setUtilityView(null);
      const group = NAV_GROUPS.find((candidate) => candidate.items.some((item) => item.key === initialSection));
      if (group) setExpandedNavGroup(group.key);
    }
  }, [initialSection]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileMenuOpen]);

  const activeCategories = useMemo(() => data.categories.filter((row) => row.status === "active"), [data.categories]);
  const activeSuppliers = useMemo(() => data.suppliers.filter((row) => row.status === "active"), [data.suppliers]);
  const activeLocations = useMemo(() => data.storageLocations.filter((row) => row.status === "active"), [data.storageLocations]);
  const activeUnits = useMemo(() => data.units.filter((row) => row.status === "active"), [data.units]);
  const stockContext = useMemo(() => ({ ...data, currentStock }), [data, currentStock]);

  const supplierNames = useMemo(() => new Map(data.suppliers.map((row) => [row.id, row.name])), [data.suppliers]);
  const categoryNames = useMemo(() => new Map(data.categories.map((row) => [row.id, row.name])), [data.categories]);
  const storageNames = useMemo(() => new Map(data.storageLocations.map((row) => [row.id, row.name])), [data.storageLocations]);
  const unitNames = useMemo(() => new Map(data.units.map((row) => [row.id, row.name])), [data.units]);
  const activeItemRows = useMemo(() => data.items.filter((item) => item.status !== "deleted"), [data.items]);
  const countItemsBy = useCallback((field: "categoryId" | "unitId" | "storageLocationId" | "preferredSupplierId") => {
    const counts = new Map<string, number>();
    for (const item of activeItemRows) {
      const id = item[field];
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [activeItemRows]);
  const categoryItemCounts = useMemo(() => countItemsBy("categoryId"), [countItemsBy]);
  const unitItemCounts = useMemo(() => countItemsBy("unitId"), [countItemsBy]);
  const storageItemCounts = useMemo(() => countItemsBy("storageLocationId"), [countItemsBy]);
  const supplierItemCounts = useMemo(() => countItemsBy("preferredSupplierId"), [countItemsBy]);
  const stockByItemId = useMemo(() => {
    const totals = new Map<string, { quantity: number; unitName: string }>();
    for (const row of currentStock) {
      const current = totals.get(row.inventoryItemId);
      totals.set(row.inventoryItemId, {
        quantity: (current?.quantity ?? 0) + row.currentQuantity,
        unitName: current?.unitName ?? row.unitName,
      });
    }
    return totals;
  }, [currentStock]);
  const dashboardStockLevels = useMemo(() => buildLowStockAssistantRows({
    restaurantId,
    currentStock,
    items: data.items,
    categories: data.categories,
    suppliers: data.suppliers,
    adjustments: dashboardAdjustments,
  }), [currentStock, dashboardAdjustments, data.categories, data.items, data.suppliers, restaurantId]);
  const attentionRows = useMemo(() => stockAttentionRows(dashboardStockLevels), [dashboardStockLevels]);
  const dashboardKpis = useMemo(() => calculateInventoryDashboardKpis({
    items: data.items,
    currentStock,
    stockLevels: dashboardStockLevels,
    suppliers: data.suppliers,
    purchases: purchaseHistory,
  }), [currentStock, dashboardStockLevels, data.items, data.suppliers, purchaseHistory]);
  const lowStockRows = useMemo(() => currentStock.filter((row) => (
    row.stockStatus === "low_stock" || row.stockStatus === "out_of_stock"
  )), [currentStock]);
  const recentLedger = useMemo(() => ledger.slice(0, 8), [ledger]);
  const todayOperations = useMemo(() => {
    const today = new Date().toDateString();
    const todays = ledger.filter((entry) => new Date(entry.movementDate).toDateString() === today);
    const count = (...types: InventoryMovementType[]) => todays.filter((entry) => types.includes(entry.movementType)).length;
    return {
      received: count("stock_in"), issued: count("stock_out"), waste: count("waste", "spoilage"),
      adjustments: count("adjustment_increase", "adjustment_decrease", "manual_correction"),
      transfers: count("transfer_out"),
    };
  }, [ledger]);

  const filteredItems = useMemo(() => {
    const rows = getFilteredItems(data, filters);
    if (filters.sort !== "stock_high" && filters.sort !== "stock_low") return rows;
    return [...rows].sort((left, right) => {
      const leftStock = stockByItemId.get(left.id)?.quantity ?? 0;
      const rightStock = stockByItemId.get(right.id)?.quantity ?? 0;
      return filters.sort === "stock_high" ? rightStock - leftStock : leftStock - rightStock;
    });
  }, [data, filters, stockByItemId]);
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / ITEM_PAGE_SIZE));
  const pagedItems = useMemo(() => filteredItems.slice((page - 1) * ITEM_PAGE_SIZE, page * ITEM_PAGE_SIZE), [filteredItems, page]);
  const archivedItems = useMemo(() => data.items.filter((item) => item.status === "archived"), [data.items]);
  const recentPurchases = useMemo<DashboardActivityItem[]>(() => [...purchaseHistory]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 3)
    .map((purchase) => ({
      id: purchase.id,
      title: purchase.purchaseNumber,
      detail: `${purchase.supplierName} · ${countLabel(purchase.itemCount, "item")}`,
      date: purchase.createdAt,
      status: purchase.status,
    })), [purchaseHistory]);
  const recentReceipts = useMemo<DashboardActivityItem[]>(() => purchaseHistory
    .filter((purchase) => purchase.receivedAt)
    .sort((left, right) => new Date(right.receivedAt ?? 0).getTime() - new Date(left.receivedAt ?? 0).getTime())
    .slice(0, 3)
    .map((purchase) => ({
      id: `receipt:${purchase.id}`,
      title: purchase.purchaseNumber,
      detail: `${purchase.supplierName} · ${purchase.receivedByNames ?? "Inventory staff"}`,
      date: purchase.receivedAt ?? purchase.createdAt,
      status: purchase.status,
    })), [purchaseHistory]);
  const recentAdjustments = useMemo<DashboardActivityItem[]>(() => [...dashboardAdjustments]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 3)
    .map((adjustment) => ({
      id: adjustment.id,
      title: adjustment.reason,
      detail: `${countLabel(adjustment.itemCount, "item")} · ${adjustment.createdByName}`,
      date: adjustment.createdAt,
      status: "completed",
    })), [dashboardAdjustments]);
  const recentConsumption = useMemo<DashboardActivityItem[]>(() => [...movementHistory]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 3)
    .map((movement) => ({
      id: movement.id,
      title: movement.inventoryItemName,
      detail: `${movement.orderNumber} · ${movement.menuItemName}`,
      date: movement.createdAt,
      status: "completed",
    })), [movementHistory]);
  const recentWaste = useMemo<DashboardActivityItem[]>(() => dashboardAdjustments
    .filter((adjustment) => adjustment.adjustmentType === "waste" || adjustment.adjustmentType === "spoilage")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 3)
    .map((adjustment) => ({
      id: `waste:${adjustment.id}`,
      title: inventoryStatusLabel(adjustment.adjustmentType),
      detail: `${countLabel(adjustment.itemCount, "item")} · ${adjustment.totalQuantity} total quantity`,
      date: adjustment.createdAt,
      status: "completed",
    })), [dashboardAdjustments]);
  const recentMovements = useMemo<DashboardActivityItem[]>(() => ledger.slice(0, 3).map((entry) => ({
    id: entry.id,
    title: entry.itemName,
    detail: `${movementLabel(entry.movementType)} · ${entry.quantityEffect === "in" ? "+" : "−"}${quantityLabel(entry.quantity, entry.unitName)}`,
    date: entry.movementDate,
    status: entry.quantityEffect === "in" ? "healthy" : "completed",
  })), [ledger]);

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
    setUtilityView(null);
    setMobileMenuOpen(false);
    const group = NAV_GROUPS.find((candidate) => candidate.items.some((item) => item.key === next));
    if (group) setExpandedNavGroup(group.key);
    window.history.pushState({}, "", `/inventory/${next}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    if (next === "dashboard") void loadDashboardInsights();
  }

  function openRecipes() {
    window.location.assign("/inventory/recipes");
  }

  function navigateUtility(next: InventoryUtilityView) {
    setUtilityView(next);
    setMobileMenuOpen(false);
  }

  function runMobileMenuAction(action: "export" | "help") {
    setMobileMenuOpen(false);
    setMessage(action === "export" ? "Open a report to export the currently displayed inventory data." : "Inventory help is available from your ServeFlow administrator.");
  }

  function toggleNavGroup(group: InventoryNavGroup) {
    setExpandedNavGroup((current) => current === group ? null : group);
  }

  function mobilePrimaryActive(key: string) {
    if (key === "reports") return utilityView === "reports";
    if (utilityView) return false;
    if (key === "add") return section === "stock-in" || section === "stock-out";
    return MOBILE_PRIMARY_NAV.find((item) => item.key === key)?.section === section;
  }

  function navGroupActive(group: InventoryNavGroup) {
    if (utilityView) return false;
    return NAV_GROUPS.find((candidate) => candidate.key === group)?.items.some((item) => item.key === section) ?? false;
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
    <div className="ia-stack ia-dashboard-polish">
      <section className="ia-dashboard-hero ia-phase-w-hidden" aria-hidden="true">
        <div><span>Inventory Operations</span><h2>Stock health at a glance</h2><p>Live balances, purchasing work, and recent operational activity for {restaurantName}.</p></div>
        <button type="button" onClick={() => void loadDashboardInsights()} disabled={insightsLoading} aria-label="Refresh inventory dashboard insights">{insightsLoading ? "Refreshing…" : "Refresh dashboard"}</button>
      </section>

      {insightsError && <div className="ia-dashboard-notice" role="status">{insightsError}</div>}

      {dashboardKpis.totalInventoryItems === 0 && (
        <DashboardEmptyState icon="IN" title="No Ingredients" message="Create the first ingredient to start tracking stock and purchasing." actionLabel="Create Ingredient" onAction={() => { navigate("items"); setItemForm(itemDraft()); }} />
      )}

      <section className="ia-dashboard-metrics" aria-label="Inventory dashboard KPIs">
        <button className="items" type="button" onClick={() => navigate("items")}><span>Total Ingredients</span><strong>{dashboardKpis.totalInventoryItems}</strong></button>
        <button className="value" type="button" onClick={() => navigate("current-stock")}><span>Inventory Value</span><strong>{moneyLabel(dashboardKpis.totalInventoryValue)}</strong></button>
        <button className="low" type="button" data-stock-lines={lowStockRows.length} onClick={() => navigate("low-stock-assistant")}><span>Low Stock</span><strong>{dashboardKpis.lowStockItems}</strong></button>
        <button className="out" type="button" onClick={() => navigate("low-stock-assistant")}><span>Out of Stock</span><strong>{dashboardKpis.outOfStockItems}</strong></button>
        <button className="purchases" type="button" onClick={() => navigate("purchase-orders")}><span>Pending Purchase Orders</span><strong>{dashboardKpis.pendingPurchaseOrders}</strong></button>
      </section>

      <section className="ia-dashboard-section ia-today-operations"><h2>Today's Operations</h2><div>
        <button type="button" onClick={() => navigate("purchase-orders")}><strong>{dashboardKpis.pendingPurchaseOrders}</strong>Pending Purchase Orders</button><button type="button" onClick={() => navigate("low-stock-assistant")}><strong>{dashboardKpis.lowStockItems}</strong>Low Stock</button><button type="button" onClick={() => navigate("waste")}><strong>{todayOperations.waste}</strong>Today's Waste</button><button type="button" onClick={() => navigate("adjustments")}><strong>{todayOperations.adjustments}</strong>Today's Adjustments</button><button type="button" onClick={() => navigate("transfers")}><strong>{todayOperations.transfers}</strong>Today's Transfers</button>
      </div></section>

      <section className="ia-dashboard-section ia-dashboard-primary-actions" aria-labelledby="inventory-quick-actions-title">
        <div className="ia-dashboard-section-title"><h2 id="inventory-quick-actions-title">Quick Actions</h2></div>
        <div className="ia-dashboard-actions">
          <button type="button" onClick={() => navigate("stock-in")}><strong>Receive Stock</strong></button>
          <button type="button" onClick={() => navigate("stock-out")}><strong>Issue Stock</strong></button>
          <button type="button" onClick={() => navigate("adjustments")}><strong>Adjustment</strong></button>
          <button type="button" onClick={() => navigate("waste")}><strong>Waste</strong></button>
          <button type="button" onClick={() => navigate("purchase-orders")}><strong>Purchase Order</strong></button>
          <button type="button" onClick={() => navigate("items")}><strong>Search Ingredient</strong></button>
          <button type="button" onClick={() => navigate("movement-history")}><span aria-hidden="true">MV</span><strong>Movement History</strong><small>Audit consumption movements</small></button>
          <button type="button" onClick={() => navigate("purchase-history")}><span aria-hidden="true">PH</span><strong>Purchase History</strong><small>Review purchasing activity</small></button>
          <button type="button" onClick={() => navigate("low-stock-assistant")}><span aria-hidden="true">LS</span><strong>Low Stock Assistant</strong><small>See suggested quantities</small></button>
          <button type="button" onClick={openRecipes}><span aria-hidden="true">RE</span><strong>Recipes</strong><small>Open recipe management</small></button>
          <button type="button" onClick={() => navigate("suppliers")}><span aria-hidden="true">SU</span><strong>Suppliers</strong><small>Manage supplier records</small></button>
        </div>
      </section>

      <section className="ia-dashboard-section ia-needs-attention"><h2>Needs Attention</h2><div>
        <article><strong>{dashboardKpis.lowStockItems}</strong><span>Low Stock</span><button type="button" onClick={() => navigate("low-stock-assistant")}>Review</button></article>
        <article><strong>{dashboardKpis.outOfStockItems}</strong><span>Out of Stock</span><button type="button" onClick={() => navigate("low-stock-assistant")}>Review</button></article>
        <article><strong>—</strong><span>Expiring Soon</span><button type="button" onClick={() => navigate("current-stock")}>Review</button></article>
        <article><strong>{dashboardKpis.pendingPurchaseOrders}</strong><span>Pending Receipts</span><button type="button" onClick={() => navigate("purchase-orders")}>Open</button></article>
      </div></section>

      {(activeSuppliers.length === 0 || (!insightsLoading && !insightsError?.includes("recipes") && recipeCount === 0)) && (
        <section className="ia-setup-grid" aria-label="Inventory setup guidance">
          {activeSuppliers.length === 0 && <DashboardEmptyState icon="SU" title="No Suppliers" message="Add an active supplier before preparing purchase orders." actionLabel="Add Supplier" onAction={() => { navigate("suppliers"); setSupplierForm(supplierDraft()); }} />}
          {!insightsLoading && !insightsError?.includes("recipes") && recipeCount === 0 && <DashboardEmptyState icon="RE" title="No Recipes" message="Create recipes to connect menu consumption with inventory ingredients." actionLabel="Open Recipes" onAction={openRecipes} />}
        </section>
      )}

      <section className="ia-dashboard-section ia-stock-attention" aria-labelledby="stock-attention-title">
        <div className="ia-dashboard-section-title"><h2 id="stock-attention-title">Low Stock</h2></div>
        {attentionRows.length ? <div className="ia-attention-list">{attentionRows.slice(0, 6).map((row) => (
          <button type="button" key={row.inventoryItemId} onClick={() => navigate("low-stock-assistant")} aria-label={`Review ${row.itemName} in low stock assistant`}>
            <span><strong>{row.itemName}</strong><small>{row.categoryName} · {row.supplierName ?? "No preferred supplier"}</small></span>
            <span><small>Current</small><strong>{quantityLabel(row.currentQuantity, row.unitName)}</strong></span>
            <span><small>Suggested Purchase</small><strong>{row.maximumStock === null ? "Set maximum" : quantityLabel(row.suggestedPurchase, row.unitName)}</strong></span>
            {statusBadge(row.classification)}
          </button>
        ))}</div> : <DashboardEmptyState icon="OK" title="No Low Stock" message="Every active item is currently above its minimum stock level." actionLabel="Review Current Stock" onAction={() => navigate("current-stock")} />}
      </section>

      <section className="ia-dashboard-section" aria-labelledby="recent-operational-activity-title">
        <div className="ia-dashboard-section-title"><h2 id="recent-operational-activity-title">Recent Activities</h2></div>
        <div className="ia-w2-timeline">{ledger.slice(0, 10).map((entry) => <button type="button" key={entry.id} onClick={() => navigate("ledger")}><time dateTime={entry.movementDate}>{new Date(entry.movementDate).toDateString() === new Date().toDateString() ? "Today" : dateLabel(entry.movementDate)}</time><strong>{entry.itemName}</strong><span>{movementLabel(entry.movementType)}</span></button>)}{!ledger.length && <p>No recent activity.</p>}</div>
        <div className="ia-activity-grid">
          <DashboardActivityPanel title="Recent Purchases" subtitle="Latest purchase orders" items={recentPurchases} empty={{ icon: "PO", title: "No Purchases", message: "No purchase orders have been created yet.", actionLabel: "Create Purchase Order" }} onOpen={() => navigate("purchase-orders")} />
          <DashboardActivityPanel title="Recent Receipts" subtitle="Latest received deliveries" items={recentReceipts} empty={{ icon: "RC", title: "No Receipts", message: "Received deliveries will appear here.", actionLabel: "Receive Purchase" }} onOpen={() => navigate("purchase-orders")} />
          <DashboardActivityPanel title="Recent Inventory Adjustments" subtitle="Confirmed manual changes" items={recentAdjustments} empty={{ icon: "AD", title: "No Adjustments", message: "Confirmed adjustments will appear here.", actionLabel: "Inventory Adjustment" }} onOpen={() => navigate("adjustments")} />
          <DashboardActivityPanel title="Recent Consumption" subtitle="Order-linked consumption" items={recentConsumption} empty={{ icon: "CO", title: "No Consumption", message: "Order consumption movements will appear here.", actionLabel: "Movement History" }} onOpen={() => navigate("movement-history")} />
          <DashboardActivityPanel title="Recent Waste" subtitle="Waste and spoilage" items={recentWaste} empty={{ icon: "WA", title: "No Waste", message: "Waste and spoilage adjustments will appear here.", actionLabel: "View Adjustments" }} onOpen={() => navigate("adjustments")} />
          <DashboardActivityPanel title="Recent Movements" subtitle="Latest stock ledger entries" items={recentMovements} empty={{ icon: "MV", title: "No Movements", message: "Inventory movements will appear after the first stock operation.", actionLabel: "Movement History" }} onOpen={() => navigate("movement-history")} />
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
      <details className="ia-collapsible-filters"><summary>Filters <span aria-hidden="true">▼</span></summary><section className="ia-filters" aria-label="Current stock filters">
        <select value={filters.categoryId} onChange={(event) => setFilter("categoryId", event.target.value)}>
          <option value="">All categories</option>
          {activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <select value={filters.storageLocationId} onChange={(event) => setFilter("storageLocationId", event.target.value)}>
          <option value="">All storage</option>
          {activeLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
      </section></details>
      <section className="ia-table-wrap">
        <table className="ia-table stock">
          <thead>
            <tr>
              <th>Ingredient</th>
              <th>Current</th>
              <th>Minimum</th>
              <th>Maximum</th>
              <th>Storage</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {stockRows.map((row) => (
              <tr key={`${row.inventoryItemId}:${row.storageLocationId}`}>
                <td data-label="Ingredient"><strong>{row.itemName}</strong></td>
                <td data-label="Current"><strong>{quantityLabel(row.currentQuantity, row.unitName)}</strong></td>
                <td data-label="Minimum">{quantityLabel(row.minimumStock, row.unitName)}</td>
                <td data-label="Maximum">{row.maximumStock == null ? "None" : quantityLabel(row.maximumStock, row.unitName)}</td>
                <td data-label="Storage">{row.storageLocationName}</td>
                <td data-label="Status"><span className={`ia-status ${row.stockStatus}`}>{row.stockStatus.replace(/_/g, " ")}</span></td>
                <td data-label="Actions"><button type="button" onClick={() => navigate("adjustments")}>Adjust</button></td>
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
      <details className="ia-collapsible-filters"><summary>Filters <span aria-hidden="true">▼</span></summary><section className="ia-filters" aria-label="Ledger filters">
        <select value={filters.storageLocationId} onChange={(event) => setFilter("storageLocationId", event.target.value)}>
          <option value="">All storage</option>
          {activeLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
      </section></details>
      <section className="ia-table-wrap">
        <table className="ia-table ledger">
          <thead>
            <tr>
              <th>Date</th>
              <th>Movement</th>
              <th>Ingredient</th>
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
                <td data-label="Date">{dateLabel(entry.movementDate)}</td>
                <td data-label="Movement">{movementLabel(entry.movementType)}</td>
                <td data-label="Item"><strong>{entry.itemName}</strong><small>{entry.supplierName ?? "No supplier"}</small></td>
                <td data-label="Storage">{entry.storageLocationName}</td>
                <td data-label="Quantity"><strong className={entry.quantityEffect === "in" ? "ia-positive" : "ia-negative"}>{entry.quantityEffect === "in" ? "+" : "-"}{quantityLabel(entry.quantity, entry.unitName)}</strong></td>
                <td data-label="Reference">{entry.referenceNumber ?? entry.invoiceNumber ?? "None"}</td>
                <td data-label="Reason">{entry.reason ?? entry.notes ?? "None"}</td>
                <td data-label="Staff">{entry.staffName ?? "Staff"}</td>
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
    <InventoryAdjustmentsPage
      restaurantId={restaurantId}
      staffRole={staffRole}
      items={data.items}
      currentStock={currentStock}
      onChanged={reload}
    />
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
            placeholder="Search ingredients"
          />
        </label>
        <div className="ia-actions">
          <button type="button" onClick={() => setItemForm(itemDraft())}>Create Ingredient</button>
          <button type="button" disabled={selectedIds.length === 0 || working} onClick={() => void run(() => bulkArchiveItems(restaurantId, selectedIds), "Selected ingredients archived.")}>Archive Selected</button>
          <button type="button" disabled={selectedIds.length === 0 || working} onClick={() => void run(() => bulkRestoreItems(restaurantId, selectedIds), "Selected ingredients restored.")}>Restore Selected</button>
          <button type="button" disabled={selectedIds.length === 0 || working} onClick={() => void run(() => bulkSoftDeleteItems(restaurantId, selectedIds), "Selected ingredients soft deleted.")}>Soft Delete</button>
        </div>
      </section>

      <details className="ia-collapsible-filters"><summary>Filters <span aria-hidden="true">▼</span></summary><section className="ia-filters" aria-label="Ingredient filters">
        <select value={filters.categoryId} onChange={(event) => setFilter("categoryId", event.target.value)}>
          <option value="">All categories</option>
          {activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <select value={filters.storageLocationId} onChange={(event) => setFilter("storageLocationId", event.target.value)}>
          <option value="">All storage</option>
          {activeLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
        <select value={filters.status} onChange={(event) => setFilter("status", event.target.value as InventoryFilters["status"])}>
          <option value="all">Any status</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="deleted">Soft deleted</option>
        </select>
        <select value={filters.sort} onChange={(event) => setFilter("sort", event.target.value as InventoryFilters["sort"])}>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="alphabetical">A–Z</option>
          <option value="stock_high">Stock High → Low</option>
          <option value="stock_low">Stock Low → High</option>
          <option value="updated">Recently Updated</option>
        </select>
      </section></details>

      <section className="ia-table-wrap">
        <table className="ia-table">
          <thead>
            <tr>
              <th><input aria-label="Select page" type="checkbox" checked={pagedItems.length > 0 && pagedItems.every((item) => selectedIds.includes(item.id))} onChange={(event) => selectPageItems(event.target.checked)} /></th>
              <th>Ingredient</th>
              <th>Current Stock</th>
              <th>Unit</th>
              <th>Storage</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pagedItems.map((item) => (
              <tr key={item.id}>
                <td data-label="Select"><input aria-label={`Select ${item.name}`} type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelected(item.id)} /></td>
                <td data-label="Ingredient"><strong>{item.name}</strong></td>
                <td data-label="Current Stock">{stockByItemId.has(item.id) ? quantityLabel(stockByItemId.get(item.id)?.quantity ?? 0, stockByItemId.get(item.id)?.unitName ?? unitNames.get(item.unitId) ?? "unit") : "No stock"}</td>
                <td data-label="Unit">{unitNames.get(item.unitId) ?? "—"}</td>
                <td data-label="Storage">{storageNames.get(item.storageLocationId) ?? "Missing"}</td>
                <td data-label="Status">{statusBadge(item.status)}</td>
                <td data-label="Actions">
                  <div className="ia-row-actions">
                    <button type="button" onClick={() => setDetailIngredientId(item.id)}>Details</button>
                    <button type="button" onClick={() => setItemForm(itemDraft(item))}>Edit</button>
                    <button type="button" onClick={() => navigate("stock-in")}>Stock In</button>
                    <button type="button" onClick={() => navigate("stock-out")}>Stock Out</button>
                    <button type="button" onClick={() => void run(() => duplicateItem(restaurantId, item, data), "Ingredient duplicated.")}>Duplicate</button>
                    {item.status === "archived" ? (
                      <button type="button" onClick={() => void run(() => restoreRecord(restaurantId, "inventory_items", item.id), "Ingredient restored.")}>Restore</button>
                    ) : (
                      <button type="button" onClick={() => void run(() => archiveRecord(restaurantId, "inventory_items", item.id), "Ingredient archived.")}>Archive</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pagedItems.length === 0 && <div className="ia-empty ia-filter-empty"><p>No ingredients match your filters.</p><div><button type="button" onClick={() => setFilters(DEFAULT_FILTERS)}>Clear Filters</button><button type="button" onClick={() => setItemForm(itemDraft())}>Create Ingredient</button></div></div>}
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
    metric: (row: { id: string }) => { label: string; value: string },
  ) {
    return (
      <div className="ia-stack">
        <section className="ia-toolbar">
          <div className="ia-section-title"><h2>{title}</h2><span>{rows.filter((row) => row.status !== "deleted").length} records</span></div>
          <div className="ia-actions"><button type="button" onClick={onCreate}>Create</button></div>
        </section>
        <section className="ia-record-grid">
          {rows.filter((row) => row.status !== "deleted").map((row) => (
            (() => {
              const businessMetric = metric(row);
              return (
                <article className="ia-record" key={row.id}>
                  <header>
                    <div>
                      <strong>{row.name}</strong>
                      <span>{row.description || "No description"}</span>
                    </div>
                    {statusBadge(row.status)}
                  </header>
                  <dl>
                    <div><dt>{businessMetric.label}</dt><dd>{businessMetric.value}</dd></div>
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
              );
            })()
          ))}
          {rows.filter((row) => row.status !== "deleted").length === 0 && <div className="ia-empty">No records yet.</div>}
        </section>
      </div>
    );
  }

  const reportView = (title: string, rows: InventoryLedgerEntry[]) => <section className="ia-report-view"><h2>{title}</h2><div className="ia-table-wrap"><table className="ia-table"><thead><tr><th>Ingredient</th><th>Movement</th><th>Quantity</th><th>Storage</th><th>Date</th></tr></thead><tbody>{rows.slice(0, 100).map((entry) => <tr key={entry.id}><td data-label="Ingredient">{entry.itemName}</td><td data-label="Movement">{movementLabel(entry.movementType)}</td><td data-label="Quantity">{quantityLabel(entry.quantity, entry.unitName)}</td><td data-label="Storage">{entry.storageLocationName}</td><td data-label="Date">{dateLabel(entry.movementDate)}</td></tr>)}</tbody></table>{!rows.length && <div className="ia-empty">No records available.</div>}</div></section>;

  const inventoryValueView = <section className="ia-report-view"><h2>Inventory Value</h2><strong className="ia-report-total">{moneyLabel(dashboardKpis.totalInventoryValue)}</strong><div className="ia-table-wrap"><table className="ia-table"><thead><tr><th>Ingredient</th><th>Current</th><th>Purchase Price</th><th>Value</th></tr></thead><tbody>{currentStock.map((row) => { const ingredient = data.items.find((candidate) => candidate.id === row.inventoryItemId); return <tr key={`${row.inventoryItemId}:${row.storageLocationId}`}><td data-label="Ingredient">{row.itemName}</td><td data-label="Current">{quantityLabel(row.currentQuantity, row.unitName)}</td><td data-label="Purchase Price">{moneyLabel(ingredient?.purchasePrice ?? 0)}</td><td data-label="Value">{moneyLabel(row.currentQuantity * (ingredient?.purchasePrice ?? 0))}</td></tr>; })}</tbody></table></div></section>;

  const content = section === "dashboard" ? dashboard
    : section === "current-stock" ? currentStockView
    : section === "movements" ? movements
    : section === "stock-in" ? stockMovement
    : section === "stock-out" ? stockMovement
    : section === "adjustments" || section === "waste" ? adjustments
    : section === "transfers" ? transfers
    : section === "ledger" ? ledgerView
    : section === "movement-history" ? <MovementHistoryPage movements={movementHistory} onRefresh={() => void reload()} />
    : section === "purchase-orders" ? <PurchaseOrderDraftsPage restaurantId={restaurantId} suppliers={data.suppliers} items={data.items} units={data.units} />
    : section === "purchase-history" ? <PurchaseHistoryPage restaurantId={restaurantId} />
    : section === "inventory-value" ? inventoryValueView
    : section === "consumption" ? reportView("Consumption", ledger.filter((entry) => entry.movementType === "stock_out"))
    : section === "waste-report" ? reportView("Waste Report", ledger.filter((entry) => entry.movementType === "waste" || entry.movementType === "spoilage"))
    : section === "low-stock-assistant" ? <LowStockAssistantPage restaurantId={restaurantId} staffRole={staffRole} currentStock={currentStock} items={data.items} categories={data.categories} suppliers={data.suppliers} storageLocations={data.storageLocations} units={data.units} onOpenPurchaseOrders={() => navigate("purchase-orders")} />
    : section === "items" ? items
    : section === "categories" ? masterList(
      "Categories",
      data.categories,
      () => setCategoryForm(categoryDraft()),
      (id) => setCategoryForm(categoryDraft(data.categories.find((row) => row.id === id))),
      "inventory_categories",
      (row) => ({ label: "Ingredients", value: countLabel(categoryItemCounts.get(row.id) ?? 0, "ingredient") }),
    )
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
                <div><dt>Supplied Ingredients</dt><dd>{countLabel(supplierItemCounts.get(supplier.id) ?? 0, "ingredient")}</dd></div>
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
    : section === "storage-locations" ? masterList(
      "Storage Locations",
      data.storageLocations,
      () => setStorageForm(simpleDraft()),
      (id) => setStorageForm(simpleDraft(data.storageLocations.find((row) => row.id === id))),
      "inventory_storage_locations",
      (row) => ({ label: "Stored Ingredients", value: countLabel(storageItemCounts.get(row.id) ?? 0, "ingredient") }),
    )
    : masterList(
      "Units",
      data.units,
      () => setUnitForm(simpleDraft()),
      (id) => setUnitForm(simpleDraft(data.units.find((row) => row.id === id))),
      "inventory_units",
      (row) => ({ label: "Ingredients", value: countLabel(unitItemCounts.get(row.id) ?? 0, "ingredient") }),
    );

  const utilityContent = utilityView === "reports" ? (
    <section className="ia-navigation-placeholder" aria-labelledby="inventory-reports-title">
      <span>Reports</span>
      <h2 id="inventory-reports-title">Inventory reports are coming in a future phase.</h2>
      <p>Use Movement History for the current audit trail. No reporting functionality was added in this navigation phase.</p>
      <button type="button" onClick={() => navigate("ledger")}>Open Movement History</button>
    </section>
  ) : utilityView === "settings" && staffRole === "owner" ? (
    <InventoryIntegrityCheckPanel restaurantId={restaurantId} />
  ) : utilityView === "settings" ? (
    <section className="ia-navigation-placeholder" aria-labelledby="inventory-settings-title">
      <span>Settings</span>
      <h2 id="inventory-settings-title">Inventory integrity tools are owner-only.</h2>
      <p>Managers and inventory officers can continue using the read-only stock and movement views.</p>
      <button type="button" onClick={() => navigate("items")}>Open Inventory Records</button>
    </section>
  ) : null;
  const displayedContent = utilityContent ?? content;

  return (
    <main className="ia-shell">
      <header className="ia-mobile-header">
        <div className="ia-mobile-header-title">
          <strong>Inventory</strong>
          <span>{restaurantName}</span>
        </div>
        <div className="ia-mobile-header-actions">
          <button className="ia-theme-placeholder" type="button" aria-label="Theme switcher placeholder" title="Theme options coming later" disabled>
            <span aria-hidden="true">◐</span>
          </button>
          <button
            className="ia-menu-button"
            type="button"
            aria-label="Open inventory navigation"
            aria-controls="inventory-mobile-menu"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            <span aria-hidden="true">☰</span>
          </button>
        </div>
      </header>

      {mobileMenuOpen && (
        <>
          <button className="ia-mobile-menu-scrim" type="button" aria-label="Close inventory navigation" onClick={() => setMobileMenuOpen(false)} />
          <aside className="ia-mobile-menu" id="inventory-mobile-menu" aria-label="Inventory mobile navigation">
            <div className="ia-mobile-menu-heading">
              <strong>Inventory</strong>
              <span>{restaurantName}</span>
            </div>
            <nav>
              {MOBILE_MENU_NAV.map((item) => {
                const active = item.utility
                  ? utilityView === item.utility
                  : item.group
                    ? navGroupActive(item.group)
                    : !utilityView && section === item.section;
                return (
                  <button
                    className={active ? "active" : ""}
                    type="button"
                    key={item.key}
                    aria-current={active ? "page" : undefined}
                    onClick={() => item.action ? runMobileMenuAction(item.action) : item.utility ? navigateUtility(item.utility) : item.section && navigate(item.section)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>
            <div className="ia-mobile-menu-user">
              <strong>{staffName}</strong>
              <span>{staffRole === "owner" ? "Owner" : staffRole === "manager" ? "Manager" : "Inventory Officer"}</span>
              <button type="button" onClick={() => void logout()}>Logout</button>
            </div>
          </aside>
        </>
      )}

      <aside className="ia-sidebar" aria-label="Inventory navigation">
        <div className="ia-brand">
          <strong>ServeFlow</strong>
          <span>Inventory Administration</span>
        </div>
        <nav className="ia-sidebar-nav">
          <button className={!utilityView && section === "dashboard" ? "active" : ""} type="button" aria-current={!utilityView && section === "dashboard" ? "page" : undefined} onClick={() => navigate("dashboard")}>
            Dashboard
          </button>

          {NAV_GROUPS.map((group) => <div className="ia-sidebar-group ia-w2-group" key={group.key}>
            <button className={`ia-sidebar-group-toggle ${navGroupActive(group.key) ? "group-active" : ""}`.trim()} type="button" aria-expanded={expandedNavGroup === group.key} aria-controls={`inventory-${group.key}-navigation`} onClick={() => toggleNavGroup(group.key)}>
              <span>{group.label}</span><span className="ia-sidebar-chevron" aria-hidden="true">›</span>
            </button>
            {expandedNavGroup === group.key && <div className="ia-sidebar-subnav" id={`inventory-${group.key}-navigation`}>
              {group.items.map((item) => <button className={!utilityView && section === item.key ? "active" : ""} type="button" key={item.key} aria-current={!utilityView && section === item.key ? "page" : undefined} onClick={() => navigate(item.key)}>{item.label}</button>)}
            </div>}
          </div>)}

          <div className="ia-sidebar-group">
            <button
              className={`ia-sidebar-group-toggle ${navGroupActive("stock") ? "group-active" : ""}`.trim()}
              type="button"
              aria-expanded={expandedNavGroup === "stock"}
              aria-controls="inventory-stock-navigation"
              onClick={() => toggleNavGroup("stock")}
            >
              <span>Stock</span>
              <span className="ia-sidebar-chevron" aria-hidden="true">›</span>
            </button>
            {expandedNavGroup === "stock" && (
              <div className="ia-sidebar-subnav" id="inventory-stock-navigation">
                {STOCK_MANAGEMENT_NAV.map((item) => (
                  <button className={!utilityView && section === item.key ? "active" : ""} type="button" key={item.key} aria-current={!utilityView && section === item.key ? "page" : undefined} onClick={() => navigate(item.key)}>
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="ia-sidebar-group">
            <button
              className={`ia-sidebar-group-toggle ${navGroupActive("records") ? "group-active" : ""}`.trim()}
              type="button"
              aria-expanded={expandedNavGroup === "records"}
              aria-controls="inventory-records-navigation"
              onClick={() => toggleNavGroup("records")}
            >
              <span>Ingredients</span>
              <span className="ia-sidebar-chevron" aria-hidden="true">›</span>
            </button>
            {expandedNavGroup === "records" && (
              <div className="ia-sidebar-subnav" id="inventory-records-navigation">
                {INVENTORY_RECORDS_NAV.map((item) => (
                  <button className={!utilityView && section === item.key ? "active" : ""} type="button" key={item.key} aria-current={!utilityView && section === item.key ? "page" : undefined} onClick={() => navigate(item.key)}>
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button className={!utilityView && section === "suppliers" ? "active" : ""} type="button" aria-current={!utilityView && section === "suppliers" ? "page" : undefined} onClick={() => navigate("suppliers")}>
            Suppliers
          </button>
          <button className={utilityView === "reports" ? "active" : ""} type="button" aria-current={utilityView === "reports" ? "page" : undefined} onClick={() => navigateUtility("reports")}>
            Reports
          </button>
          <button className={utilityView === "settings" ? "active" : ""} type="button" aria-current={utilityView === "settings" ? "page" : undefined} onClick={() => navigateUtility("settings")}>
            Inventory Settings
          </button>
        </nav>
        <div className="ia-user">
          <strong>{staffName}</strong>
          <span>{staffRole === "owner" ? "Owner" : staffRole === "manager" ? "Manager" : "Inventory Officer"}</span>
          <button type="button" onClick={() => void logout()}>Logout</button>
        </div>
      </aside>

      <section className="ia-workspace">
        <header className="ia-header"><div><h1>Inventory</h1><span>{restaurantName}</span></div></header>
        {(message || error) && <div className={`ia-alert ${error ? "error" : ""}`}>{error ?? message}</div>}
        {loading ? <div className="ia-empty">Loading inventory administration...</div> : displayedContent}
      </section>

      <nav className="ia-mobile-bottom-nav" aria-label="Primary inventory actions">
        {MOBILE_PRIMARY_NAV.map((item) => {
          const active = mobilePrimaryActive(item.key);
          return (
            <button className={`${active ? "active " : ""}${item.key === "add" ? "add" : ""}`.trim()} type="button" key={item.key} aria-current={active ? "page" : undefined} onClick={() => item.key === "add" ? setQuickMenuOpen(true) : item.section && navigate(item.section)}>
              <span aria-hidden="true">{item.icon}</span>
              <strong>{item.label}</strong>
            </button>
          );
        })}
      </nav>

      {quickMenuOpen && <div className="ia-action-sheet-backdrop" role="presentation" onClick={() => setQuickMenuOpen(false)}>
        <section className="ia-action-sheet" role="dialog" aria-modal="true" aria-label="Quick stock actions" onClick={(event) => event.stopPropagation()}>
          <header><h2>Quick Actions</h2><button type="button" onClick={() => setQuickMenuOpen(false)}>Close</button></header>
          {([
            ["Receive Stock", "stock-in"], ["Issue Stock", "stock-out"], ["Adjust Stock", "adjustments"],
            ["Record Waste", "waste"], ["Transfer", "transfers"], ["Create Ingredient", "items"],
          ] as Array<[string, InventorySection]>).map(([label, target]) => <button type="button" key={target} onClick={() => { setQuickMenuOpen(false); navigate(target); if (target === "items") setItemForm(itemDraft()); }}>{label}</button>)}
        </section>
      </div>}

      {detailIngredientId && (() => {
        const ingredient = data.items.find((row) => row.id === detailIngredientId);
        if (!ingredient) return null;
        const stock = stockByItemId.get(ingredient.id);
        const movements = ledger.filter((entry) => entry.inventoryItemId === ingredient.id).slice(0, 5);
        return <div className="ia-sheet-backdrop" role="presentation" onClick={() => setDetailIngredientId(null)}><section className="ia-ingredient-sheet" role="dialog" aria-modal="true" aria-label="Ingredient Details" onClick={(event) => event.stopPropagation()}>
          <header><div><span>Ingredient Details</span><h2>{ingredient.name}</h2></div><button type="button" onClick={() => setDetailIngredientId(null)}>Close</button></header>
          <dl><div><dt>Current Stock</dt><dd>{quantityLabel(stock?.quantity ?? 0, stock?.unitName ?? unitNames.get(ingredient.unitId) ?? "unit")}</dd></div><div><dt>Unit</dt><dd>{unitNames.get(ingredient.unitId) ?? "—"}</dd></div><div><dt>Supplier</dt><dd>{ingredient.preferredSupplierId ? supplierNames.get(ingredient.preferredSupplierId) ?? "—" : "—"}</dd></div><div><dt>Storage</dt><dd>{storageNames.get(ingredient.storageLocationId) ?? "—"}</dd></div><div><dt>Purchase Price</dt><dd>{moneyLabel(ingredient.purchasePrice)}</dd></div><div><dt>Average Cost</dt><dd>—</dd></div><div><dt>Minimum Stock</dt><dd>{ingredient.minimumStock}</dd></div><div><dt>Maximum Stock</dt><dd>{ingredient.maximumStock ?? "—"}</dd></div></dl>
          <section className="ia-menu-usage"><h3>Menu Usage</h3>{ingredientMenuUsage[ingredient.id]?.usedIn.length ? <div><strong>Used In</strong>{ingredientMenuUsage[ingredient.id].usedIn.map((name) => <span key={`recipe-${name}`}>{name}</span>)}</div> : null}{ingredientMenuUsage[ingredient.id]?.linkedTo.length ? <div><strong>Linked To</strong>{ingredientMenuUsage[ingredient.id].linkedTo.map((name) => <span key={`direct-${name}`}>{name}</span>)}</div> : null}{!ingredientMenuUsage[ingredient.id]?.usedIn.length && !ingredientMenuUsage[ingredient.id]?.linkedTo.length && <p>Not used by a tracked menu item.</p>}</section>
          <section><h3>Recent Movements</h3>{movements.map((entry) => <p key={entry.id}><strong>{movementLabel(entry.movementType)}</strong><span>{dateLabel(entry.movementDate)}</span></p>)}{!movements.length && <p>No recent movements.</p>}</section>
          <section><h3>Recent Waste</h3>{movements.filter((entry) => entry.movementType === "waste" || entry.movementType === "spoilage").map((entry) => <p key={entry.id}><strong>{movementLabel(entry.movementType)}</strong><span>{dateLabel(entry.movementDate)}</span></p>)}{!movements.some((entry) => entry.movementType === "waste" || entry.movementType === "spoilage") && <p>No recent waste.</p>}</section>
          <section><h3>Recent Adjustments</h3>{movements.filter((entry) => entry.movementType === "adjustment_increase" || entry.movementType === "adjustment_decrease" || entry.movementType === "manual_correction").map((entry) => <p key={entry.id}><strong>{movementLabel(entry.movementType)}</strong><span>{dateLabel(entry.movementDate)}</span></p>)}{!movements.some((entry) => entry.movementType === "adjustment_increase" || entry.movementType === "adjustment_decrease" || entry.movementType === "manual_correction") && <p>No recent adjustments.</p>}</section>
          <div className="ia-sheet-actions"><button type="button" onClick={() => { setDetailIngredientId(null); navigate("stock-in"); }}>Receive</button><button type="button" onClick={() => { setDetailIngredientId(null); navigate("stock-out"); }}>Issue</button><button type="button" onClick={() => { setDetailIngredientId(null); navigate("adjustments"); }}>Adjust</button><button type="button" onClick={() => { setDetailIngredientId(null); navigate("transfers"); }}>Transfer</button></div>
        </section></div>;
      })()}

      {itemForm && (
        <InventoryItemForm
          draft={itemForm}
          setDraft={setItemForm}
          data={data}
          metadata={itemForm.id ? data.items.find((row) => row.id === itemForm.id) ?? null : null}
          categories={activeCategories}
          suppliers={activeSuppliers}
          locations={activeLocations}
          units={activeUnits}
          onCreateCategory={() => { setInlineMasterTarget("category"); setCategoryForm(categoryDraft()); }}
          onCreateUnit={() => { setInlineMasterTarget("unit"); setUnitForm(simpleDraft()); }}
          onCreateStorage={() => { setInlineMasterTarget("storage"); setStorageForm(simpleDraft()); }}
          onCreateSupplier={() => { setInlineMasterTarget("supplier"); setSupplierForm(supplierDraft()); }}
          working={working}
          onSave={() => void run(() => saveItem(restaurantId, itemForm, data), itemForm.id ? "Ingredient updated." : "Ingredient created.").then((saved) => { if (saved) setItemForm(null); })}
        />
      )}
      {categoryForm && (
        <CategoryForm
          draft={categoryForm}
          setDraft={setCategoryForm}
          metadata={categoryForm.id ? data.categories.find((row) => row.id === categoryForm.id) ?? null : null}
          working={working}
          onSave={() => void run(() => saveCategory(restaurantId, categoryForm, data), categoryForm.id ? "Category updated." : "Category created.").then(async (saved) => { if (saved) { if (inlineMasterTarget === "category") { const next = await loadInventoryAdminData(restaurantId); setData(next); const created = next.categories.find((row) => row.name.trim().toLowerCase() === categoryForm.name.trim().toLowerCase()); if (created) setItemForm((current) => current ? { ...current, categoryId: created.id } : current); setInlineMasterTarget(null); } setCategoryForm(null); } })}
        />
      )}
      {supplierForm && (
        <SupplierForm
          draft={supplierForm}
          setDraft={setSupplierForm}
          metadata={supplierForm.id ? data.suppliers.find((row) => row.id === supplierForm.id) ?? null : null}
          working={working}
          onSave={() => void run(() => saveSupplier(restaurantId, supplierForm, data), supplierForm.id ? "Supplier updated." : "Supplier created.").then(async (saved) => { if (saved) { if (inlineMasterTarget === "supplier") { const next = await loadInventoryAdminData(restaurantId); setData(next); const created = next.suppliers.find((row) => row.name.trim().toLowerCase() === supplierForm.name.trim().toLowerCase()); if (created) setItemForm((current) => current ? { ...current, preferredSupplierId: created.id } : current); setInlineMasterTarget(null); } setSupplierForm(null); } })}
        />
      )}
      {storageForm && (
        <SimpleForm
          title="Storage Location"
          draft={storageForm}
          setDraft={setStorageForm}
          metadata={storageForm.id ? data.storageLocations.find((row) => row.id === storageForm.id) ?? null : null}
          working={working}
          examples="Main Store, Freezer, Cold Room, Bar Store, Bakery Store"
          onSave={() => void run(() => saveStorageLocation(restaurantId, storageForm, data), storageForm.id ? "Storage location updated." : "Storage location created.").then(async (saved) => { if (saved) { if (inlineMasterTarget === "storage") { const next = await loadInventoryAdminData(restaurantId); setData(next); const created = next.storageLocations.find((row) => row.name.trim().toLowerCase() === storageForm.name.trim().toLowerCase()); if (created) setItemForm((current) => current ? { ...current, storageLocationId: created.id } : current); setInlineMasterTarget(null); } setStorageForm(null); } })}
        />
      )}
      {unitForm && (
        <SimpleForm
          title="Unit"
          draft={unitForm}
          setDraft={setUnitForm}
          metadata={unitForm.id ? data.units.find((row) => row.id === unitForm.id) ?? null : null}
          working={working}
          examples="kg, g, L, ml, pcs, box, bag, cup, bottle"
          onSave={() => void run(() => saveUnit(restaurantId, unitForm, data), unitForm.id ? "Unit updated." : "Unit created.").then(async (saved) => { if (saved) { if (inlineMasterTarget === "unit") { const next = await loadInventoryAdminData(restaurantId); setData(next); const created = next.units.find((row) => row.name.trim().toLowerCase() === unitForm.name.trim().toLowerCase()); if (created) setItemForm((current) => current ? { ...current, unitId: created.id } : current); setInlineMasterTarget(null); } setUnitForm(null); } })}
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
      <label>Ingredient<select required value={draft.inventoryItemId} onChange={(event) => setDraft({ ...draft, inventoryItemId: event.target.value })}><option value="">Select ingredient</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
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
      <label>Ingredient<select required value={draft.inventoryItemId} onChange={(event) => setDraft({ ...draft, inventoryItemId: event.target.value })}><option value="">Select ingredient</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
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
      <label>Ingredient<select required value={draft.inventoryItemId} onChange={(event) => setDraft({ ...draft, inventoryItemId: event.target.value })}><option value="">Select ingredient</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
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
  metadata,
  categories,
  suppliers,
  locations,
  units,
  working,
  onSave,
  onCreateCategory,
  onCreateUnit,
  onCreateStorage,
  onCreateSupplier,
}: {
  draft: InventoryItemDraft;
  setDraft: (draft: InventoryItemDraft | null) => void;
  data: InventoryAdminData;
  metadata: InventoryItem | null;
  categories: InventoryCategory[];
  suppliers: InventorySupplier[];
  locations: Array<{ id: string; name: string }>;
  units: Array<{ id: string; name: string }>;
  working: boolean;
  onSave: () => void;
  onCreateCategory: () => void;
  onCreateUnit: () => void;
  onCreateStorage: () => void;
  onCreateSupplier: () => void;
}) {
  const canCreate = data.categories.length > 0 && data.units.length > 0 && data.storageLocations.length > 0;
  return (
    <FormShell title={draft.id ? "Edit Ingredient" : "Create Ingredient"} onClose={() => setDraft(null)}>
      {!canCreate && <div className="ia-alert error">Create at least one category, unit, and storage location before saving ingredients.</div>}
      <form className="ia-form" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
        <label>Ingredient Name *<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Category<div className="ia-inline-select"><select required value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}><option value="">Select category</option>{categories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><button type="button" onClick={onCreateCategory}>+ Create Category</button></div></label>
        <label>Unit<div className="ia-inline-select"><select required value={draft.unitId} onChange={(event) => setDraft({ ...draft, unitId: event.target.value })}><option value="">Select unit</option>{units.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><button type="button" onClick={onCreateUnit}>+ Create Unit</button></div></label>
        <label>Storage<div className="ia-inline-select"><select required value={draft.storageLocationId} onChange={(event) => setDraft({ ...draft, storageLocationId: event.target.value })}><option value="">Select storage</option>{locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><button type="button" onClick={onCreateStorage}>+ Create Storage</button></div></label>
        <label>Minimum Stock<input min="0" step="0.001" type="number" value={draft.minimumStock} onChange={(event) => setDraft({ ...draft, minimumStock: event.target.value })} /></label>
        <label>Maximum Stock<input min="0" step="0.001" type="number" value={draft.maximumStock} onChange={(event) => setDraft({ ...draft, maximumStock: event.target.value })} /></label>
        <label>Purchase Price<input required min="0" step="0.000001" type="number" value={draft.purchasePrice} onChange={(event) => setDraft({ ...draft, purchasePrice: event.target.value })} /></label>
        <label>Preferred Supplier<div className="ia-inline-select"><select value={draft.preferredSupplierId} onChange={(event) => setDraft({ ...draft, preferredSupplierId: event.target.value })}><option value="">None</option>{suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><button type="button" onClick={onCreateSupplier}>+ Create Supplier</button></div></label>
        <label className="wide">Description<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        <details className="ia-advanced-options wide"><summary>Advanced Options</summary><label>Barcode (optional)<input value={draft.barcode} onChange={(event) => setDraft({ ...draft, barcode: event.target.value })} /></label></details>
        {metadata && (
          <AdvancedInfo rows={[
            { label: "Created by", value: <span><strong>{metadata.createdByStaffId ? data.staffNames[metadata.createdByStaffId] ?? "Staff member" : "System"}</strong><small>{metadata.createdByStaffId ? data.staffRoles[metadata.createdByStaffId] ?? "Staff" : "System"} · {dateLabel(metadata.createdAt)}</small></span> },
            { label: "Updated by", value: <span><strong>{metadata.updatedByStaffId ? data.staffNames[metadata.updatedByStaffId] ?? "Staff member" : "System"}</strong><small>{metadata.updatedByStaffId ? data.staffRoles[metadata.updatedByStaffId] ?? "Staff" : "System"} · {dateLabel(metadata.updatedAt)}</small></span> },
          ]} />
        )}
        <footer><button disabled={working || !canCreate} type="submit">{working ? "Saving..." : "Save Ingredient"}</button></footer>
      </form>
    </FormShell>
  );
}

function CategoryForm({ draft, setDraft, metadata, working, onSave }: { draft: InventoryCategoryDraft; setDraft: (draft: InventoryCategoryDraft | null) => void; metadata: { createdAt: string; updatedAt: string } | null; working: boolean; onSave: () => void }) {
  return (
    <FormShell title={draft.id ? "Edit Category" : "Create Category"} onClose={() => setDraft(null)}>
      <form className="ia-form" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
        <label>Name<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Sort Order<input type="number" step="1" value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })} /></label>
        <label className="wide">Description<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        {metadata && <AdvancedInfo rows={[{ label: "Created", value: dateLabel(metadata.createdAt) }, { label: "Updated", value: dateLabel(metadata.updatedAt) }]} />}
        <footer><button disabled={working} type="submit">{working ? "Saving..." : "Save Category"}</button></footer>
      </form>
    </FormShell>
  );
}

function SupplierForm({ draft, setDraft, metadata, working, onSave }: { draft: InventorySupplierDraft; setDraft: (draft: InventorySupplierDraft | null) => void; metadata: { createdAt: string; updatedAt: string } | null; working: boolean; onSave: () => void }) {
  return (
    <FormShell title={draft.id ? "Edit Supplier" : "Create Supplier"} onClose={() => setDraft(null)}>
      <form className="ia-form" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
        <label>Name<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Phone<input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label>
        <label>Contact Person<input value={draft.contactPerson} onChange={(event) => setDraft({ ...draft, contactPerson: event.target.value })} /></label>
        <label className="wide">Address<textarea value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} /></label>
        <label className="wide">Notes<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
        {metadata && <AdvancedInfo rows={[{ label: "Created", value: dateLabel(metadata.createdAt) }, { label: "Updated", value: dateLabel(metadata.updatedAt) }]} />}
        <footer><button disabled={working} type="submit">{working ? "Saving..." : "Save Supplier"}</button></footer>
      </form>
    </FormShell>
  );
}

function SimpleForm({ title, draft, setDraft, metadata, working, examples, onSave }: { title: string; draft: InventorySimpleDraft; setDraft: (draft: InventorySimpleDraft | null) => void; metadata: { createdAt: string; updatedAt: string } | null; working: boolean; examples: string; onSave: () => void }) {
  return (
    <FormShell title={draft.id ? `Edit ${title}` : `Create ${title}`} onClose={() => setDraft(null)}>
      <form className="ia-form" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
        <label>Name<input required value={draft.name} placeholder={examples} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label className="wide">Description<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        {metadata && <AdvancedInfo rows={[{ label: "Created", value: dateLabel(metadata.createdAt) }, { label: "Updated", value: dateLabel(metadata.updatedAt) }]} />}
        <footer><button disabled={working} type="submit">{working ? "Saving..." : `Save ${title}`}</button></footer>
      </form>
    </FormShell>
  );
}

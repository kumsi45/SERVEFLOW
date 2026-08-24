import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "../../../core/database";
import { ServeFlowBrand } from "../../../core/presentation/ServeFlowBrand";
import { useOperationalNotice } from "../../../core/presentation/useOperationalNotice";
import { signOutStaff } from "../../staff-auth/services/staffAuthService";
import { PurchaseOrderDraftsPage } from "../../purchasing/pages/PurchaseOrderDraftsPage";
import { PurchaseHistoryPage } from "../../purchasing/pages/PurchaseHistoryPage";
import { loadPurchaseHistory } from "../../purchasing/services/purchaseHistoryService";
import type { PurchaseHistoryRecord } from "../../purchasing/purchaseHistoryTypes";
import { fetchRecipes } from "../../recipes/services/recipeService";
import { CurrentStockWorkspace } from "../components/CurrentStockWorkspace";
import { InventoryIntegrityCheckPanel } from "../components/InventoryIntegrityCheckPanel";
import { InventoryOverviewDashboard } from "../components/InventoryOverviewDashboard";
import { InventoryOperationalDashboard } from "../components/InventoryOperationalDashboard";
import { InventoryMaterialsWorkspace, InventorySetupLoadError, InventoryStorageWorkspace } from "../components/InventorySetupWorkspaces";
import { InventorySuppliersWorkspace } from "../components/InventorySuppliersWorkspace";
import { StockMovementWorkspace, TransferWorkspace } from "../components/StockOperationWorkspaces";
import { StockMovementsWorkspace } from "../components/StockMovementsWorkspace";
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
  issueInventoryKitchenRequest,
  loadInventoryKitchenRequests,
  markInventoryKitchenRequestUnable,
  type InventoryKitchenQueueRequest,
} from "../services/inventoryKitchenRequestService";
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
import "../styles/inventorySetup.css";
import "../styles/inventorySuppliers.css";
import "../styles/inventoryKitchenRequests.css";
import "../styles/inventoryStockOperations.css";
import "../styles/inventoryStockMovements.css";

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
  { key: "inventory-reports", label: "Inventory Reports" },
  { key: "low-stock-assistant", label: "Low Stock" },
  { key: "inventory-value", label: "Inventory Value" },
  { key: "consumption", label: "Consumption" },
  { key: "waste-report", label: "Waste Report" },
  { key: "inventory-settings", label: "Inventory Settings" },
  { key: "export", label: "Export" },
  { key: "help", label: "Help" },
  { key: "items", label: "Materials" },
  { key: "categories", label: "Material Categories" },
  { key: "suppliers", label: "Suppliers" },
  { key: "storage-locations", label: "Storage Locations" },
  { key: "units", label: "Units" },
];

type InventoryNavGroup = "stock" | "purchasing" | "setup";

const STOCK_NAV: Array<{ key: InventorySection; label: string }> = [
  { key: "current-stock", label: "Current Stock" },
  { key: "ledger", label: "Stock Movements" },
];

const SETUP_NAV: Array<{ key: InventorySection; label: string }> = [
  { key: "items", label: "Materials" },
  { key: "storage-locations", label: "Storage" },
];

const PURCHASING_NAV: Array<{ key: InventorySection; label: string }> = [
  { key: "purchase-orders", label: "Purchase Orders" },
  { key: "suppliers", label: "Suppliers" },
];

const NAV_GROUPS: Array<{ key: InventoryNavGroup; label: string; items: Array<{ key: InventorySection; label: string }> }> = [
  { key: "stock", label: "Stock", items: STOCK_NAV },
  { key: "purchasing", label: "Purchasing", items: PURCHASING_NAV },
  { key: "setup", label: "Setup", items: SETUP_NAV },
];

const STOCK_CONTEXT_SECTIONS = new Set<InventorySection>([
  "current-stock", "movements", "stock-in", "stock-out", "transfers", "adjustments", "waste", "ledger",
]);
const PURCHASING_CONTEXT_SECTIONS = new Set<InventorySection>(["purchase-orders", "purchase-history", "suppliers"]);
const SETUP_CONTEXT_SECTIONS = new Set<InventorySection>(["items", "categories", "units", "storage-locations"]);
const REPORT_CONTEXT_SECTIONS = new Set<InventorySection>([
  "inventory-reports", "inventory-value", "low-stock-assistant", "consumption", "waste-report", "movement-history", "export",
]);
const SETTINGS_CONTEXT_SECTIONS = new Set<InventorySection>(["inventory-settings", "help"]);

function isInventorySection(value: string | undefined): value is InventorySection {
  return INVENTORY_NAV.some((item) => item.key === value);
}

function parentNavGroup(section: InventorySection): InventoryNavGroup | null {
  if (STOCK_CONTEXT_SECTIONS.has(section)) return "stock";
  if (PURCHASING_CONTEXT_SECTIONS.has(section)) return "purchasing";
  if (SETUP_CONTEXT_SECTIONS.has(section)) return "setup";
  return null;
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

function inventoryUserMessage(cause: unknown, fallback: string) {
  const message = cause instanceof Error ? cause.message : "";
  if (/failed to fetch|networkerror|network request failed/i.test(message)) {
    return "Stock information couldn't be loaded. Check your connection and try again.";
  }
  if (/negative stock|not enough stock|insufficient stock/i.test(message)) {
    return "Not enough stock is available in the selected storage location.";
  }
  if (/access denied|permission denied|not authorized/i.test(message)) {
    return "You do not have permission to complete this inventory action.";
  }
  if (/required|must be|invalid|different|already|opening balance/i.test(message)) {
    return message.replace(/ingredient/g, "material");
  }
  return fallback;
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
  const [kitchenRequestsActive, setKitchenRequestsActive] = useState(() => window.location.hash === "#kitchen-requests");
  const [inlineMasterTarget, setInlineMasterTarget] = useState<"category" | "unit" | "storage" | "supplier" | null>(null);
  const [detailIngredientId, setDetailIngredientId] = useState<string | null>(null);
  const [expandedNavGroup, setExpandedNavGroup] = useState<InventoryNavGroup | null>(null);
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
  const [stockSummaryLoading, setStockSummaryLoading] = useState(true);
  const [stockSummaryError, setStockSummaryError] = useState<string | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [kitchenRequests, setKitchenRequests] = useState<InventoryKitchenQueueRequest[]>([]);
  const [kitchenRequestsLoading, setKitchenRequestsLoading] = useState(true);
  const [kitchenRequestsError, setKitchenRequestsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminDataFailed, setAdminDataFailed] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useOperationalNotice(message, setMessage);
  const [itemForm, setItemForm] = useState<InventoryItemDraft | null>(null);
  const [categoryForm, setCategoryForm] = useState<InventoryCategoryDraft | null>(null);
  const [supplierForm, setSupplierForm] = useState<InventorySupplierDraft | null>(null);
  const [storageForm, setStorageForm] = useState<InventorySimpleDraft | null>(null);
  const [unitForm, setUnitForm] = useState<InventorySimpleDraft | null>(null);
  const [movementForm, setMovementForm] = useState<StockMovementDraft>(stockMovementDraft("stock_in"));
  const [transferForm, setTransferForm] = useState<InventoryTransferDraft>(transferDraft());
  const [openingForm, setOpeningForm] = useState<InventoryOpeningBalanceDraft>(openingBalanceDraft());
  const canManageMasterLifecycle = staffRole === "owner" || staffRole === "manager";
  const dataRef = useRef(data);
  dataRef.current = data;

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      setStockSummaryLoading(true);
      setActivityLoading(true);
      const [adminResult, stockResult, ledgerResult, movementResult] = await Promise.allSettled([
        loadInventoryAdminData(restaurantId),
        loadCurrentStock(restaurantId),
        loadLedger(restaurantId, { limit: 200 }),
        loadInventoryMovementHistory(restaurantId),
      ]);
      if (adminResult.status === "fulfilled") setData(adminResult.value);
      setAdminDataFailed(adminResult.status === "rejected");
      if (stockResult.status === "fulfilled") setCurrentStock(stockResult.value);
      if (ledgerResult.status === "fulfilled") setLedger(ledgerResult.value);
      if (movementResult.status === "fulfilled") setMovementHistory(movementResult.value);

      const failures = [adminResult, stockResult, ledgerResult, movementResult]
        .filter((result): result is PromiseRejectedResult => result.status === "rejected");
      setError(failures.length
        ? inventoryUserMessage(failures[0].reason, "Inventory information couldn't be loaded. Try again.")
        : null);
      setStockSummaryError(adminResult.status === "rejected" || stockResult.status === "rejected"
        ? "Unable to load stock summary."
        : null);
      setActivityError(ledgerResult.status === "rejected" ? "Unable to load recent activity." : null);
    } finally {
      setLoading(false);
      setStockSummaryLoading(false);
      setActivityLoading(false);
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
    setInsightsError(purchasesResult.status === "rejected" ? "Unable to load purchase summary." : null);
    setInsightsLoading(false);
  }, [restaurantId]);

  const loadKitchenRequests = useCallback(async () => {
    setKitchenRequestsLoading(true);
    try {
      setKitchenRequests(await loadInventoryKitchenRequests(restaurantId, staffRole));
      setKitchenRequestsError(null);
    } catch (cause) {
      setKitchenRequestsError(cause instanceof Error ? cause.message : "Kitchen requests are unavailable.");
    } finally {
      setKitchenRequestsLoading(false);
    }
  }, [restaurantId, staffRole]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void loadDashboardInsights();
  }, [loadDashboardInsights]);

  useEffect(() => {
    void loadKitchenRequests();
  }, [loadKitchenRequests]);

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
    setStockSummaryError(null);
    setActivityError(null);
    await loadKitchenRequests();
  }, [loadKitchenRequests, restaurantId]);

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
    onKitchenRequestsChanged: loadKitchenRequests,
    onError: (realtimeError) => setError(realtimeError instanceof Error
      ? realtimeError.message
      : "Inventory realtime synchronization failed."),
  });

  useEffect(() => {
    if (isInventorySection(initialSection)) {
      setSection(initialSection);
      setKitchenRequestsActive(initialSection === "dashboard" && window.location.hash === "#kitchen-requests");
      const group = parentNavGroup(initialSection);
      if (group) setExpandedNavGroup(group);
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

  useEffect(() => {
    const syncKitchenRequestContext = () => setKitchenRequestsActive(
      window.location.pathname === "/inventory/dashboard" && window.location.hash === "#kitchen-requests",
    );
    window.addEventListener("popstate", syncKitchenRequestContext);
    return () => window.removeEventListener("popstate", syncKitchenRequestContext);
  }, []);

  const activeCategories = useMemo(() => data.categories.filter((row) => row.status === "active"), [data.categories]);
  const activeSuppliers = useMemo(() => data.suppliers.filter((row) => row.status === "active"), [data.suppliers]);
  const activeLocations = useMemo(() => data.storageLocations.filter((row) => row.status === "active"), [data.storageLocations]);
  const activeUnits = useMemo(() => data.units.filter((row) => row.status === "active"), [data.units]);
  const stockContext = useMemo(() => ({ ...data, currentStock }), [data, currentStock]);

  const supplierNames = useMemo(() => new Map(data.suppliers.map((row) => [row.id, row.name])), [data.suppliers]);
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
  const recentLedger = useMemo(() => ledger.slice(0, 10), [ledger]);
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
    if (section === "stock-in" && movementForm.movementType !== "stock_in") {
      setMovementForm(stockMovementDraft("stock_in"));
    }
    if (section === "stock-out" && movementForm.movementType !== "stock_out") {
      setMovementForm(stockMovementDraft("stock_out"));
    }
  }, [movementForm.movementType, section]);

  async function run(action: () => Promise<void>, success: string, failure = "Unable to complete this inventory action. Please try again.") {
    try {
      setWorking(true);
      setMessage(null);
      setError(null);
      await action();
      await reload();
      setMessage(success);
      return true;
    } catch (err) {
      console.error("Inventory operation failed", err);
      setError(inventoryUserMessage(err, failure));
      return false;
    } finally {
      setWorking(false);
    }
  }

  async function processKitchenRequest(
    action: () => Promise<unknown>,
    success: string,
  ) {
    try {
      setWorking(true);
      setMessage(null);
      setError(null);
      await action();
      await Promise.all([reload(), loadKitchenRequests()]);
      setMessage(success);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Kitchen request action failed.");
      return false;
    } finally {
      setWorking(false);
    }
  }

  function navigate(next: InventorySection) {
    setSection(next);
    setKitchenRequestsActive(false);
    setMobileMenuOpen(false);
    const group = parentNavGroup(next);
    if (group) setExpandedNavGroup(group);
    window.history.pushState({}, "", `/inventory/${next}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    if (next === "dashboard") void loadDashboardInsights();
  }

  function startStockOperation(action: "stock_in" | "stock_out" | "transfer", row: InventoryCurrentStockRow | null) {
    if (action === "transfer") {
      setTransferForm({
        ...transferDraft(),
        inventoryItemId: row?.inventoryItemId ?? "",
        fromStorageLocationId: row?.storageLocationId ?? "",
      });
      navigate("transfers");
      return;
    }
    setMovementForm({
      ...stockMovementDraft(action),
      inventoryItemId: row?.inventoryItemId ?? "",
      storageLocationId: row?.storageLocationId ?? "",
    });
    navigate(action === "stock_in" ? "stock-in" : "stock-out");
  }

  function openKitchenRequests() {
    setSection("dashboard");
    setKitchenRequestsActive(true);
    setMobileMenuOpen(false);
    window.history.pushState({}, "", "/inventory/dashboard#kitchen-requests");
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.requestAnimationFrame(() => document.getElementById("i1-requests-title")?.scrollIntoView({ block: "start" }));
  }

  function openRecipes() {
    window.location.assign("/inventory/recipes");
  }

  function toggleNavGroup(group: InventoryNavGroup) {
    setExpandedNavGroup((current) => current === group ? null : group);
  }

  function navGroupActive(group: InventoryNavGroup) {
    return parentNavGroup(section) === group;
  }

  async function logout() {
    await signOutStaff();
    window.location.replace("/staff-login");
  }

  const dashboard = kitchenRequestsActive ? (
    <InventoryOperationalDashboard
      requests={kitchenRequests}
      requestsLoading={kitchenRequestsLoading}
      requestsError={kitchenRequestsError}
      canProcessRequests={staffRole === "owner" || staffRole === "inventory_officer"}
      requestStorageLocations={Object.fromEntries(data.items.map((item) => [
        item.id,
        data.storageLocations.find((location) => location.id === item.storageLocationId)?.name ?? "Configured item storage",
      ]))}
      working={working}
      onIssue={(request) => processKitchenRequest(
        () => issueInventoryKitchenRequest(restaurantId, request.id),
        `${request.itemName} issued to Kitchen. Stock was deducted once.`,
      )}
      onUnable={(request, reason) => processKitchenRequest(
        () => markInventoryKitchenRequestUnable(restaurantId, request.id, reason),
        `${request.itemName} marked unable to fulfill. No stock was deducted.`,
      )}
    />
  ) : (
    <InventoryOverviewDashboard
      requests={kitchenRequests}
      requestsLoading={kitchenRequestsLoading}
      requestsError={kitchenRequestsError}
      stockLoading={stockSummaryLoading}
      stockError={stockSummaryError}
      activityLoading={activityLoading}
      activityError={activityError}
      purchasesLoading={insightsLoading}
      purchasesError={insightsError}
      outOfStockCount={dashboardKpis.outOfStockItems}
      lowStockCount={dashboardKpis.lowStockItems}
      pendingPurchaseCount={dashboardKpis.pendingPurchaseOrders}
      totalActiveMaterials={data.items.filter((item) => item.status === "active").length}
      recentLedger={recentLedger}
      onNavigate={navigate}
      onOpenRequests={openKitchenRequests}
    />
  );

  const currentStockView = (
    <CurrentStockWorkspace
      rows={currentStock}
      loading={stockSummaryLoading}
      error={stockSummaryError}
      onReload={() => void reload()}
      onStartAction={startStockOperation}
      onViewDetails={setDetailIngredientId}
    />
  );

  const ledgerView = (
    <StockMovementsWorkspace
      entries={ledger}
      loading={activityLoading}
      error={activityError}
      onReload={() => void reload()}
    />
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
      <StockMovementWorkspace
        restaurantId={restaurantId}
        draft={movementForm}
        setDraft={setMovementForm}
        context={stockContext}
        items={data.items.filter((item) => item.status === "active")}
        suppliers={activeSuppliers}
        locations={activeLocations}
        working={working}
        onSave={() => run(async () => {
          const nextType = movementForm.movementType;
          await recordStockMovement(restaurantId, movementForm, stockContext);
          setMovementForm(stockMovementDraft(nextType));
        }, movementForm.movementType === "stock_in" ? "Stock received successfully." : "Stock issued successfully.", "Unable to record this stock movement. Please try again.")}
      />
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
      <TransferWorkspace
        restaurantId={restaurantId}
        draft={transferForm}
        setDraft={setTransferForm}
        context={stockContext}
        items={data.items.filter((item) => item.status === "active")}
        locations={activeLocations}
        working={working}
        onSave={() => run(async () => {
          await transferInventoryStock(restaurantId, transferForm, stockContext);
          setTransferForm(transferDraft());
        }, "Transfer completed.", "Unable to complete this transfer. Please try again.")}
      />
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
                      {row.description && <span>{row.description}</span>}
                    </div>
                    {statusBadge(row.status)}
                  </header>
                  <dl>
                    <div><dt>{businessMetric.label}</dt><dd>{businessMetric.value}</dd></div>
                  </dl>
                  <footer>
                    {(row.status === "active" || canManageMasterLifecycle) && <button type="button" onClick={() => onEdit(row.id)}>Edit</button>}
                    {canManageMasterLifecycle && (row.status === "archived" ? (
                      <button type="button" onClick={() => void run(() => restoreRecord(restaurantId, table, row.id), "Record restored.")}>Restore</button>
                    ) : (
                      <button type="button" onClick={() => void run(() => archiveRecord(restaurantId, table, row.id), "Record archived.")}>Archive</button>
                    ))}
                    {canManageMasterLifecycle && <button type="button" onClick={() => void run(() => softDeleteRecord(restaurantId, table, row.id), "Record soft deleted.")}>Soft Delete</button>}
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

  const reportView = (title: string, rows: InventoryLedgerEntry[]) => <section className="ia-report-view"><h2>{title}</h2><div className="ia-table-wrap"><table className="ia-table"><thead><tr><th>Material</th><th>Movement</th><th>Quantity</th><th>Storage</th><th>Date</th></tr></thead><tbody>{rows.slice(0, 100).map((entry) => <tr key={entry.id}><td data-label="Material">{entry.itemName}</td><td data-label="Movement">{movementLabel(entry.movementType)}</td><td data-label="Quantity">{quantityLabel(entry.quantity, entry.unitName)}</td><td data-label="Storage">{entry.storageLocationName}</td><td data-label="Date">{dateLabel(entry.movementDate)}</td></tr>)}</tbody></table>{!rows.length && <div className="ia-empty">No records available.</div>}</div></section>;

  const inventoryValueView = <section className="ia-report-view"><h2>Inventory Value</h2><strong className="ia-report-total">{moneyLabel(dashboardKpis.totalInventoryValue)}</strong><div className="ia-table-wrap"><table className="ia-table"><thead><tr><th>Material</th><th>Current</th><th>Purchase Price</th><th>Value</th></tr></thead><tbody>{currentStock.map((row) => { const ingredient = data.items.find((candidate) => candidate.id === row.inventoryItemId); return <tr key={`${row.inventoryItemId}:${row.storageLocationId}`}><td data-label="Material">{row.itemName}</td><td data-label="Current">{quantityLabel(row.currentQuantity, row.unitName)}</td><td data-label="Purchase Price">{moneyLabel(ingredient?.purchasePrice ?? 0)}</td><td data-label="Value">{moneyLabel(row.currentQuantity * (ingredient?.purchasePrice ?? 0))}</td></tr>; })}</tbody></table></div></section>;

  const content = section === "dashboard" ? dashboard
    : section === "current-stock" ? currentStockView
    : section === "movements" ? movements
    : section === "stock-in" ? stockMovement
    : section === "stock-out" ? stockMovement
    : section === "adjustments" || section === "waste" ? adjustments
    : section === "transfers" ? transfers
    : section === "ledger" ? ledgerView
    : section === "movement-history" ? <MovementHistoryPage movements={movementHistory} onRefresh={() => void reload()} />
    : section === "purchase-orders" ? <PurchaseOrderDraftsPage restaurantId={restaurantId} suppliers={data.suppliers} items={data.items} units={data.units} storageLocations={data.storageLocations} />
    : section === "purchase-history" ? <PurchaseHistoryPage restaurantId={restaurantId} />
    : section === "inventory-reports" ? (
      <section className="ia-navigation-placeholder" aria-labelledby="inventory-reports-page-title">
        <span>Reports</span><h2 id="inventory-reports-page-title">Inventory Reports</h2><p>Open an inventory report below.</p>
        <div className="ia-actions"><button type="button" onClick={() => navigate("inventory-value")}>Inventory Value</button><button type="button" onClick={() => navigate("consumption")}>Consumption</button><button type="button" onClick={() => navigate("waste-report")}>Waste</button><button type="button" onClick={() => navigate("purchase-history")}>Purchases</button><button type="button" onClick={() => navigate("movement-history")}>Movement History</button></div>
      </section>
    )
    : section === "inventory-value" ? inventoryValueView
    : section === "consumption" ? reportView("Consumption", ledger.filter((entry) => entry.movementType === "stock_out"))
    : section === "waste-report" ? reportView("Waste Report", ledger.filter((entry) => entry.movementType === "waste" || entry.movementType === "spoilage"))
    : section === "inventory-settings" && staffRole === "owner" ? <InventoryIntegrityCheckPanel restaurantId={restaurantId} />
    : section === "inventory-settings" ? <section className="ia-navigation-placeholder"><span>Settings</span><h2>Inventory Settings</h2><p>Inventory integrity tools are owner-only.</p><button type="button" onClick={() => navigate("items")}>Open Inventory Records</button></section>
    : section === "export" ? <section className="ia-navigation-placeholder"><span>Export</span><h2>Export Inventory Data</h2><p>Open the report you want to review and export.</p><button type="button" onClick={() => navigate("inventory-reports")}>Open Inventory Reports</button></section>
    : section === "help" ? <section className="ia-navigation-placeholder"><span>Help</span><h2>Inventory Help</h2><p>Choose an inventory workspace to continue.</p><div className="ia-actions"><button type="button" onClick={() => navigate("current-stock")}>Current Stock</button><button type="button" onClick={() => navigate("stock-in")}>Receive Stock</button><button type="button" onClick={() => navigate("items")}>Materials</button></div></section>
    : section === "low-stock-assistant" ? <LowStockAssistantPage restaurantId={restaurantId} staffRole={staffRole} currentStock={currentStock} items={data.items} categories={data.categories} suppliers={data.suppliers} storageLocations={data.storageLocations} units={data.units} onOpenPurchaseOrders={() => navigate("purchase-orders")} />
    : section === "items" ? adminDataFailed ? <InventorySetupLoadError resource="materials" /> : <InventoryMaterialsWorkspace items={data.items} categories={data.categories} units={data.units} canManageLifecycle={canManageMasterLifecycle} onAdd={() => setItemForm(itemDraft())} onEdit={(item) => setItemForm(itemDraft(item))} onArchive={(id) => void run(() => archiveRecord(restaurantId, "inventory_items", id), "Material archived.")} onRestore={(id) => void run(() => restoreRecord(restaurantId, "inventory_items", id), "Material restored.")} />
    : section === "categories" ? masterList(
      "Categories",
      data.categories,
      () => setCategoryForm(categoryDraft()),
      (id) => setCategoryForm(categoryDraft(data.categories.find((row) => row.id === id))),
      "inventory_categories",
      (row) => ({ label: "Materials", value: countLabel(categoryItemCounts.get(row.id) ?? 0, "material") }),
    )
    : section === "suppliers" ? <InventorySuppliersWorkspace suppliers={data.suppliers} items={data.items} onCreate={() => setSupplierForm(supplierDraft())} onEdit={(supplier) => setSupplierForm(supplierDraft(supplier))} />
    : section === "storage-locations" ? adminDataFailed ? <InventorySetupLoadError resource="storage locations" /> : <InventoryStorageWorkspace locations={data.storageLocations} items={data.items} canManageLifecycle={canManageMasterLifecycle} onAdd={() => setStorageForm(simpleDraft())} onEdit={(location) => setStorageForm(simpleDraft(location))} onArchive={(id) => void run(() => archiveRecord(restaurantId, "inventory_storage_locations", id), "Storage archived.")} onRestore={(id) => void run(() => restoreRecord(restaurantId, "inventory_storage_locations", id), "Storage restored.")} />
    : masterList(
      "Units",
      data.units,
      () => setUnitForm(simpleDraft()),
      (id) => setUnitForm(simpleDraft(data.units.find((row) => row.id === id))),
      "inventory_units",
      (row) => ({ label: "Materials", value: countLabel(unitItemCounts.get(row.id) ?? 0, "material") }),
    );

  const displayedContent = content;
  const compactSetupWorkspace = section === "items" || section === "storage-locations";
  const actionableKitchenRequestCount = kitchenRequestsLoading || kitchenRequestsError
    ? 0
    : kitchenRequests.filter((request) => request.status === "accepted").length;

  const navigationItems = (mobile = false) => (
    <nav className={mobile ? "ia-mobile-menu-nav" : "ia-sidebar-nav"} aria-label={mobile ? "Inventory destinations" : undefined}>
      <button className={!kitchenRequestsActive && section === "dashboard" ? "active" : ""} type="button" aria-current={!kitchenRequestsActive && section === "dashboard" ? "page" : undefined} onClick={() => navigate("dashboard")}>Dashboard</button>
      {NAV_GROUPS.map((group) => <div className="ia-nav-sequence" key={group.key}>
        <div className="ia-sidebar-group ia-w2-group">
          <button className={`ia-sidebar-group-toggle ${navGroupActive(group.key) ? "group-active" : ""}`.trim()} type="button" aria-expanded={expandedNavGroup === group.key} aria-controls={`inventory-${mobile ? "mobile-" : ""}${group.key}-navigation`} onClick={() => toggleNavGroup(group.key)}>
            <span>{group.label}</span><span className="ia-sidebar-chevron" aria-hidden="true">›</span>
          </button>
          {expandedNavGroup === group.key && <div className="ia-sidebar-subnav" id={`inventory-${mobile ? "mobile-" : ""}${group.key}-navigation`}>
            {group.items.map((item) => <button className={section === item.key ? "active" : ""} type="button" key={item.key} aria-current={section === item.key ? "page" : undefined} onClick={() => navigate(item.key)}>{item.label}</button>)}
          </div>}
        </div>
        {group.key === "stock" && <button className={kitchenRequestsActive ? "active ia-kitchen-request-link" : "ia-kitchen-request-link"} type="button" aria-current={kitchenRequestsActive ? "page" : undefined} onClick={openKitchenRequests}>
          <span>Kitchen Requests</span>{actionableKitchenRequestCount > 0 && <strong aria-label={`${actionableKitchenRequestCount} actionable requests`}>{actionableKitchenRequestCount}</strong>}
        </button>}
      </div>)}
      {staffRole !== "inventory_officer" && <>
        <button className={REPORT_CONTEXT_SECTIONS.has(section) ? "active" : ""} type="button" aria-current={REPORT_CONTEXT_SECTIONS.has(section) ? "page" : undefined} onClick={() => navigate("inventory-reports")}>Reports</button>
        <button className={SETTINGS_CONTEXT_SECTIONS.has(section) ? "active" : ""} type="button" aria-current={SETTINGS_CONTEXT_SECTIONS.has(section) ? "page" : undefined} onClick={() => navigate("inventory-settings")}>Settings</button>
      </>}
    </nav>
  );

  return (
    <main className="ia-shell">
      <header className="ia-mobile-header">
        <div className="ia-mobile-header-actions">
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
              <div><strong>Inventory</strong><span>{restaurantName}</span></div>
              <button type="button" aria-label="Close inventory navigation" onClick={() => setMobileMenuOpen(false)}>×</button>
            </div>
            {navigationItems(true)}
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
          <ServeFlowBrand variant="compact" />
        </div>
        {navigationItems()}
        <div className="ia-user">
          <strong>{staffName}</strong>
          <span>{staffRole === "owner" ? "Owner" : staffRole === "manager" ? "Manager" : "Inventory Officer"}</span>
          <button type="button" onClick={() => void logout()}>Logout</button>
        </div>
      </aside>

      <section className="ia-workspace">
        {error && !(compactSetupWorkspace && adminDataFailed) && section !== "dashboard" && section !== "current-stock" && section !== "ledger" && <div className="ia-alert error" role="alert">{error}</div>}
        {message && <div className="ia-operation-toast" role="status" aria-live="polite"><span>{message}</span><button type="button" aria-label="Dismiss success message" onClick={() => setMessage(null)}>×</button></div>}
        {loading && section !== "dashboard" && section !== "current-stock" && section !== "ledger" ? compactSetupWorkspace ? <div className="ia-setup-loading" role="status">Loading {section === "items" ? "materials" : "storage locations"}...</div> : <div className="ia-empty">Loading inventory administration...</div> : displayedContent}
      </section>

      {detailIngredientId && (() => {
        const ingredient = data.items.find((row) => row.id === detailIngredientId);
        if (!ingredient) return null;
        const stock = stockByItemId.get(ingredient.id);
        const movements = ledger.filter((entry) => entry.inventoryItemId === ingredient.id).slice(0, 5);
        return <div className="ia-sheet-backdrop" role="presentation" onClick={() => setDetailIngredientId(null)}><section className="ia-ingredient-sheet" role="dialog" aria-modal="true" aria-label="Material Details" onClick={(event) => event.stopPropagation()}>
          <header><div><span>Material Details</span><h2>{ingredient.name}</h2></div><button type="button" onClick={() => setDetailIngredientId(null)}>Close</button></header>
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
          onSave={() => void run(() => saveItem(restaurantId, itemForm, data), itemForm.id ? "Material updated." : "Material created.").then((saved) => { if (saved) setItemForm(null); })}
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
          title="Storage"
          draft={storageForm}
          setDraft={setStorageForm}
          metadata={storageForm.id ? data.storageLocations.find((row) => row.id === storageForm.id) ?? null : null}
          working={working}
          examples="Main Store, Freezer, Cold Room, Bar Store, Bakery Store"
          onSave={() => void run(() => saveStorageLocation(restaurantId, storageForm, data), storageForm.id ? "Storage updated." : "Storage created.").then(async (saved) => { if (saved) { if (inlineMasterTarget === "storage") { const next = await loadInventoryAdminData(restaurantId); setData(next); const created = next.storageLocations.find((row) => row.name.trim().toLowerCase() === storageForm.name.trim().toLowerCase()); if (created) setItemForm((current) => current ? { ...current, storageLocationId: created.id } : current); setInlineMasterTarget(null); } setStorageForm(null); } })}
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
      <label>Material<select required value={draft.inventoryItemId} onChange={(event) => setDraft({ ...draft, inventoryItemId: event.target.value })}><option value="">Select material</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
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
  const canCreate = categories.length > 0 && units.length > 0 && locations.length > 0;
  return (
    <FormShell title={draft.id ? "Edit Material" : "Add Material"} onClose={() => setDraft(null)}>
      {!canCreate && <div className="ia-alert error">Create at least one category, unit, and storage location before saving materials.</div>}
      <form className="ia-form ia-material-form" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
        <label>Material name *<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Category<div className="ia-inline-select"><select required value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}><option value="">Select category</option>{categories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><button type="button" onClick={onCreateCategory}>+ Create Category</button></div></label>
        <label>Unit<div className="ia-inline-select"><select required value={draft.unitId} onChange={(event) => setDraft({ ...draft, unitId: event.target.value })}><option value="">Select unit</option>{units.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><button type="button" onClick={onCreateUnit}>+ Create Unit</button></div></label>
        <label>Default storage<div className="ia-inline-select"><select required value={draft.storageLocationId} onChange={(event) => setDraft({ ...draft, storageLocationId: event.target.value })}><option value="">Select storage</option>{locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><button type="button" onClick={onCreateStorage}>+ Create Storage</button></div><span className="ia-form-help">Used as this material's configured storage location.</span></label>
        <label>Minimum stock<input min="0" step="0.001" type="number" value={draft.minimumStock} onChange={(event) => setDraft({ ...draft, minimumStock: event.target.value })} /><span className="ia-form-help">Low-stock alert threshold.</span></label>
        <label>Maximum stock<input min="0" step="0.001" type="number" value={draft.maximumStock} onChange={(event) => setDraft({ ...draft, maximumStock: event.target.value })} /><span className="ia-form-help">Optional upper stock target.</span></label>
        <details className="ia-advanced-options ia-material-additional wide"><summary>Additional configuration</summary><div className="ia-material-additional-grid">
          <label>Purchase price<input required min="0" step="0.000001" type="number" value={draft.purchasePrice} onChange={(event) => setDraft({ ...draft, purchasePrice: event.target.value })} /></label>
          <label>Preferred supplier<div className="ia-inline-select"><select value={draft.preferredSupplierId} onChange={(event) => setDraft({ ...draft, preferredSupplierId: event.target.value })}><option value="">Select supplier (optional)</option>{suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><button type="button" onClick={onCreateSupplier}>+ Create Supplier</button></div></label>
          <label className="wide">Description<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          <label className="wide">Barcode (optional)<input value={draft.barcode} onChange={(event) => setDraft({ ...draft, barcode: event.target.value })} /></label>
        </div></details>
        {metadata && (
          <AdvancedInfo rows={[
            { label: "Created by", value: <span><strong>{metadata.createdByStaffId ? data.staffNames[metadata.createdByStaffId] ?? "Staff member" : "System"}</strong><small>{metadata.createdByStaffId ? data.staffRoles[metadata.createdByStaffId] ?? "Staff" : "System"} · {dateLabel(metadata.createdAt)}</small></span> },
            { label: "Updated by", value: <span><strong>{metadata.updatedByStaffId ? data.staffNames[metadata.updatedByStaffId] ?? "Staff member" : "System"}</strong><small>{metadata.updatedByStaffId ? data.staffRoles[metadata.updatedByStaffId] ?? "Staff" : "System"} · {dateLabel(metadata.updatedAt)}</small></span> },
          ]} />
        )}
        <footer><button disabled={working || !canCreate} type="submit">{working ? "Saving..." : "Save Material"}</button></footer>
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
    <FormShell title={draft.id ? "Edit Supplier" : "Add Supplier"} onClose={() => setDraft(null)}>
      <form className="ia-form ia-supplier-form" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
        <label>Supplier name<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Phone<input inputMode="tel" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label>
        <label>Contact person <span>(optional)</span><input value={draft.contactPerson} onChange={(event) => setDraft({ ...draft, contactPerson: event.target.value })} /></label>
        <label>Address <span>(optional)</span><input value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} /></label>
        {metadata && <AdvancedInfo rows={[{ label: "Created", value: dateLabel(metadata.createdAt) }, { label: "Updated", value: dateLabel(metadata.updatedAt) }]} />}
        <footer><button disabled={working} type="submit">{working ? "Saving..." : "Save Supplier"}</button></footer>
      </form>
    </FormShell>
  );
}

function SimpleForm({ title, draft, setDraft, metadata, working, examples, onSave }: { title: string; draft: InventorySimpleDraft; setDraft: (draft: InventorySimpleDraft | null) => void; metadata: { createdAt: string; updatedAt: string } | null; working: boolean; examples: string; onSave: () => void }) {
  return (
    <FormShell title={draft.id ? `Edit ${title}` : `${title === "Storage" ? "Add" : "Create"} ${title}`} onClose={() => setDraft(null)}>
      <form className={`ia-form ${title === "Storage" ? "ia-storage-form" : ""}`} onSubmit={(event) => { event.preventDefault(); onSave(); }}>
        <label>{title === "Storage" ? "Storage name" : "Name"}<input required value={draft.name} placeholder={examples} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label className="wide">Description<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        {metadata && <AdvancedInfo rows={[{ label: "Created", value: dateLabel(metadata.createdAt) }, { label: "Updated", value: dateLabel(metadata.updatedAt) }]} />}
        <footer><button disabled={working} type="submit">{working ? "Saving..." : `Save ${title}`}</button></footer>
      </form>
    </FormShell>
  );
}

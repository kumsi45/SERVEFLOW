import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  calculateInventoryDashboardKpis,
  inventoryStatusLabel,
  stockAttentionRows,
} from "../../src/modules/inventory/inventoryDashboardPresentation";
import type { LowStockAssistantRow } from "../../src/modules/inventory/lowStockAssistantTypes";
import type { InventoryCurrentStockRow, InventoryItem, InventorySupplier } from "../../src/modules/inventory/types";
import type { PurchaseHistoryRecord, PurchaseHistoryStatus } from "../../src/modules/purchasing/purchaseHistoryTypes";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const dashboard = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
const operationalDashboard = read("src/modules/inventory/components/InventoryOperationalDashboard.tsx");
const presentation = read("src/modules/inventory/inventoryDashboardPresentation.ts");
const styles = read("src/modules/inventory/styles/inventoryDashboard.css");

const item = (id: string, purchasePrice: number, status: InventoryItem["status"] = "active"): InventoryItem => ({
  id,
  restaurantId: "restaurant-1",
  name: `Item ${id}`,
  categoryId: "category-1",
  unitId: "unit-1",
  storageLocationId: "storage-1",
  preferredSupplierId: "supplier-1",
  sku: null,
  barcode: null,
  minimumStock: 10,
  maximumStock: 100,
  purchasePrice,
  description: null,
  status,
  createdByStaffId: "staff-1",
  updatedByStaffId: "staff-1",
  createdAt: "2026-07-20T00:00:00Z",
  updatedAt: "2026-07-20T00:00:00Z",
});

const stock = (inventoryItemId: string, currentQuantity: number): InventoryCurrentStockRow => ({
  inventoryItemId,
  itemName: `Item ${inventoryItemId}`,
  categoryId: "category-1",
  categoryName: "Dry Goods",
  storageLocationId: "storage-1",
  storageLocationName: "Main Store",
  unitId: "unit-1",
  unitName: "kg",
  minimumStock: 10,
  maximumStock: 100,
  currentQuantity,
  stockStatus: currentQuantity === 0 ? "out_of_stock" : currentQuantity <= 10 ? "low_stock" : "in_stock",
  lastMovementAt: null,
});

const level = (inventoryItemId: string, classification: LowStockAssistantRow["classification"], currentQuantity: number): LowStockAssistantRow => ({
  inventoryItemId,
  itemName: `Item ${inventoryItemId}`,
  categoryId: "category-1",
  categoryName: "Dry Goods",
  storageLocationIds: ["storage-1"],
  storageLocationNames: ["Main Store"],
  supplierId: "supplier-1",
  supplierName: "Central Foods",
  unitId: "unit-1",
  unitName: "kg",
  currentQuantity,
  minimumStock: 10,
  maximumStock: 100,
  classification,
  suggestedPurchase: Math.max(0, 100 - currentQuantity),
  latestAdjustmentType: null,
});

const supplier = (id: string, status: InventorySupplier["status"]): InventorySupplier => ({
  id,
  restaurantId: "restaurant-1",
  name: `Supplier ${id}`,
  phone: null,
  address: null,
  contactPerson: null,
  notes: null,
  status,
  createdAt: "",
  updatedAt: "",
});

const purchase = (id: string, status: PurchaseHistoryStatus): PurchaseHistoryRecord => ({
  id,
  restaurantId: "restaurant-1",
  purchaseNumber: `PO-${id}`,
  supplierId: "supplier-1",
  supplierName: "Central Foods",
  status,
  expectedDeliveryDate: "2026-08-01",
  notes: null,
  createdByStaffId: "staff-1",
  createdByName: "Manager",
  createdAt: "2026-07-25T00:00:00Z",
  firstReceivedAt: null,
  receivedAt: null,
  receivedByNames: null,
  itemCount: 1,
  totalCost: 50,
  receivedCost: 0,
  remainingCost: 50,
  lines: [],
});

describe("Phase 8.5.6 inventory dashboard KPIs", () => {
  it("calculates every KPI from existing read models", () => {
    const result = calculateInventoryDashboardKpis({
      items: [item("critical", 10), item("out", 20), item("archived", 5, "archived")],
      currentStock: [stock("critical", 5), stock("out", 0)],
      stockLevels: [level("critical", "critical", 5), level("out", "out_of_stock", 0)],
      suppliers: [supplier("active", "active"), supplier("archived", "archived")],
      purchases: [
        purchase("draft", "draft"),
        purchase("approved", "approved"),
        purchase("partial", "partially_received"),
        purchase("complete", "completed"),
      ],
    });
    expect(result).toEqual({
      totalInventoryValue: 50,
      totalInventoryItems: 3,
      lowStockItems: 1,
      outOfStockItems: 1,
      activeSuppliers: 1,
      pendingPurchaseOrders: 3,
    });
  });

  it("prioritizes out-of-stock, critical, then low-stock items", () => {
    const sorted = stockAttentionRows([
      level("low", "low", 10),
      level("out", "out_of_stock", 0),
      level("healthy", "healthy", 50),
      level("critical", "critical", 5),
    ]);
    expect(sorted.map((row) => row.inventoryItemId)).toEqual(["out", "critical", "low"]);
  });

  it("provides professional labels for requested statuses", () => {
    expect(["healthy", "low", "critical", "out_of_stock", "archived", "draft", "completed"]
      .map(inventoryStatusLabel)).toEqual([
        "Healthy", "Low Stock", "Critical", "Out of Stock", "Archived", "Draft", "Completed",
      ]);
  });
});

describe("Inventory operational dashboard presentation", () => {
  it("now renders the dedicated Kitchen request workflow without dashboard duplication", () => {
    for (const label of ["Kitchen Requests", "Awaiting Inventory", "Awaiting Kitchen", "History"])
      expect(operationalDashboard).toContain(label);
    for (const removed of ["Needs Attention", "Quick Operations", "Stock Snapshot", "Recent Activity"])
      expect(operationalDashboard).not.toContain(removed);
  });

  it("keeps issuing and exception handling on the canonical request actions", () => {
    expect(operationalDashboard).toContain("Confirm Issue");
    expect(operationalDashboard).toContain("Confirm Cannot Fulfill");
    expect(operationalDashboard).toContain("onIssue(action.request)");
    expect(operationalDashboard).toContain("onUnable(action.request, unableExplanation)");
    expect(operationalDashboard).not.toContain("onNavigate");
  });

  it("renders concise operational zero states", () => {
    for (const emptyState of [
      "No requests are awaiting Inventory.", "No requests are awaiting Kitchen.",
      "No Kitchen request history yet.",
    ]) expect(operationalDashboard).toContain(emptyState);
  });

  it("uses memoized calculations and independent read-only insight loading", () => {
    expect(dashboard).toContain("const dashboardKpis = useMemo(");
    expect(dashboard).toContain("const dashboardStockLevels = useMemo(");
    expect(dashboard).toContain("Promise.allSettled([");
    expect(dashboard).toContain("loadPurchaseHistory(restaurantId)");
    expect(dashboard).toContain("loadInventoryAdjustments(restaurantId)");
    expect(dashboard).toContain("fetchRecipes(restaurantId");
    expect(presentation).not.toMatch(/supabase|insert\(|update\(|delete\(|rpc\(/i);
  });

  it("keeps prior dashboard styles for unaffected routes and exposes the request workflow semantics", () => {
    expect(styles).toContain(".ia-i1-quick-grid");
    expect(styles).toContain(":focus-visible");
    expect(styles).toContain("prefers-reduced-motion");
    expect(operationalDashboard).toContain("aria-label=\"Kitchen request workflow\"");
    expect(operationalDashboard).toContain("<time dateTime={request.requestedAt}");
  });

  it("adds no database objects or Phase 8.5.6 migration", () => {
    const migrations = readdirSync(resolve(process.cwd(), "supabase/migrations"));
    expect(migrations.some((name) => name.includes("8_5_6"))).toBe(false);
  });
});

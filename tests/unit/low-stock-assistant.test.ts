import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { InventoryAdjustment, InventoryCurrentStockRow, InventoryItem } from "../../src/modules/inventory/types";
import type { LowStockAssistantFilters } from "../../src/modules/inventory/lowStockAssistantTypes";
import {
  buildLowStockAssistantRows,
  canCreateLowStockPurchaseDraft,
  classifyLowStock,
  filterLowStockAssistantRows,
  suggestedPurchaseDraft,
  suggestedPurchaseQuantity,
} from "../../src/modules/inventory/services/lowStockAssistantService";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/inventory/pages/LowStockAssistantPage.tsx");
const service = read("src/modules/inventory/services/lowStockAssistantService.ts");
const dashboard = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
const router = read("src/app/router/AppRouter.tsx");

const item = (id: string, restaurantId = "restaurant-1", patch: Partial<InventoryItem> = {}): InventoryItem => ({
  id,
  restaurantId,
  name: `Item ${id}`,
  categoryId: "category-1",
  unitId: "unit-1",
  storageLocationId: "storage-1",
  preferredSupplierId: "supplier-1",
  sku: null,
  barcode: null,
  minimumStock: 10,
  maximumStock: 100,
  purchasePrice: 12.5,
  description: null,
  status: "active",
  createdByStaffId: "staff-1",
  updatedByStaffId: "staff-1",
  createdAt: "2026-07-20T00:00:00Z",
  updatedAt: "2026-07-20T00:00:00Z",
  ...patch,
});

const stock = (inventoryItemId: string, currentQuantity: number, storageLocationId = "storage-1"): InventoryCurrentStockRow => ({
  inventoryItemId,
  itemName: `Item ${inventoryItemId}`,
  categoryId: "category-1",
  categoryName: "Dry Goods",
  storageLocationId,
  storageLocationName: storageLocationId === "storage-1" ? "Main Store" : "Cold Store",
  unitId: "unit-1",
  unitName: "kg",
  minimumStock: 10,
  maximumStock: 100,
  currentQuantity,
  stockStatus: currentQuantity <= 0 ? "out_of_stock" : currentQuantity <= 10 ? "low_stock" : "in_stock",
  lastMovementAt: "2026-07-25T00:00:00Z",
});

const adjustment: InventoryAdjustment = {
  id: "adjustment-1",
  restaurantId: "restaurant-1",
  direction: "decrease",
  adjustmentType: "waste",
  reason: "Waste",
  notes: null,
  status: "confirmed",
  createdBy: "staff-1",
  createdByName: "Manager",
  approvedBy: "staff-1",
  approvedByName: "Manager",
  approvedAt: "2026-07-25T00:00:00Z",
  createdAt: "2026-07-25T00:00:00Z",
  itemCount: 1,
  totalQuantity: 1,
  items: [{
    id: "adjustment-item-1",
    inventoryItemId: "critical",
    inventoryItemName: "Item critical",
    unitId: "unit-1",
    unitName: "kg",
    quantity: 1,
    quantityBefore: 6,
    quantityAfter: 5,
    movementAuditType: "WASTE",
    movementId: "movement-1",
  }],
};

const rows = buildLowStockAssistantRows({
  restaurantId: "restaurant-1",
  currentStock: [
    stock("out", 0),
    stock("critical", 2, "storage-1"),
    stock("critical", 3, "storage-2"),
    stock("low", 10),
    stock("healthy", 20),
    stock("other-tenant", 1),
  ],
  items: [item("out"), item("critical"), item("low"), item("healthy"), item("other-tenant", "restaurant-2")],
  categories: [{ id: "category-1", restaurantId: "restaurant-1", name: "Dry Goods", description: null, status: "active", sortOrder: 0, createdAt: "", updatedAt: "" }],
  suppliers: [{ id: "supplier-1", restaurantId: "restaurant-1", name: "Central Foods", phone: null, address: null, contactPerson: null, notes: null, status: "active", createdAt: "", updatedAt: "" }],
  adjustments: [adjustment],
});

const filters: LowStockAssistantFilters = {
  search: "",
  storageLocationId: "",
  categoryId: "",
  supplierId: "",
  adjustmentType: "all",
  classifications: ["out_of_stock", "critical", "low", "healthy"],
};

describe("Phase 8.5.5 stock classification and suggestions", () => {
  it("classifies out of stock, critical, low, and healthy with explicit precedence", () => {
    expect(classifyLowStock(0, 10)).toBe("out_of_stock");
    expect(classifyLowStock(5, 10)).toBe("critical");
    expect(classifyLowStock(10, 10)).toBe("low");
    expect(classifyLowStock(11, 10)).toBe("healthy");
    expect(rows.map((row) => row.classification)).toEqual(["critical", "healthy", "low", "out_of_stock"]);
  });

  it("suggests maximum stock minus current stock without negative or implicit maximum values", () => {
    expect(suggestedPurchaseQuantity(30, 100)).toBe(70);
    expect(suggestedPurchaseQuantity(120, 100)).toBe(0);
    expect(suggestedPurchaseQuantity(30, null)).toBe(0);
    expect(rows.find((row) => row.inventoryItemId === "critical")).toMatchObject({
      currentQuantity: 5,
      suggestedPurchase: 95,
      storageLocationIds: ["storage-1", "storage-2"],
      latestAdjustmentType: "waste",
    });
  });

  it("aggregates locations while preserving tenant isolation", () => {
    expect(rows).toHaveLength(4);
    expect(rows.some((row) => row.inventoryItemId === "other-tenant")).toBe(false);
  });
});

describe("Phase 8.5.5 filters and permissions", () => {
  it("searches inventory item, supplier, and category", () => {
    expect(filterLowStockAssistantRows(rows, { ...filters, search: "critical" }).map((row) => row.inventoryItemId)).toEqual(["critical"]);
    expect(filterLowStockAssistantRows(rows, { ...filters, search: "central foods" })).toHaveLength(4);
    expect(filterLowStockAssistantRows(rows, { ...filters, search: "dry goods" })).toHaveLength(4);
  });

  it("filters storage, category, supplier, adjustment type, and stock level", () => {
    expect(filterLowStockAssistantRows(rows, { ...filters, storageLocationId: "storage-2" }).map((row) => row.inventoryItemId)).toEqual(["critical"]);
    expect(filterLowStockAssistantRows(rows, { ...filters, categoryId: "category-1" })).toHaveLength(4);
    expect(filterLowStockAssistantRows(rows, { ...filters, supplierId: "supplier-1" })).toHaveLength(4);
    expect(filterLowStockAssistantRows(rows, { ...filters, adjustmentType: "waste" }).map((row) => row.inventoryItemId)).toEqual(["critical"]);
    expect(filterLowStockAssistantRows(rows, { ...filters, classifications: ["healthy"] }).map((row) => row.inventoryItemId)).toEqual(["healthy"]);
  });

  it("gives draft creation to inventory roles and keeps every other role read only", () => {
    expect(canCreateLowStockPurchaseDraft("owner")).toBe(true);
    expect(canCreateLowStockPurchaseDraft("manager")).toBe(true);
    expect(canCreateLowStockPurchaseDraft("inventory_officer")).toBe(true);
    for (const role of ["waiter", "cashier", "kitchen", "customer"]) {
      expect(canCreateLowStockPurchaseDraft(role)).toBe(false);
    }
    expect(page).toContain("canCreate ?");
    expect(page).toContain("Read only");
  });
});

describe("Phase 8.5.5 purchase draft shortcut", () => {
  it("builds only selected non-healthy suggestions and never selects a supplier automatically", () => {
    const form = suggestedPurchaseDraft({
      rows,
      selectedItemIds: ["out", "critical", "healthy"],
      supplierId: "",
      expectedDeliveryDate: "",
      items: [item("out"), item("critical"), item("healthy")],
    });
    expect(form.supplierId).toBe("");
    expect(form.expectedDeliveryDate).toBe("");
    expect(form.lines).toEqual([
      { inventoryItemId: "critical", purchaseUnitId: "unit-1", quantity: "95", unitPrice: "12.5" },
      { inventoryItemId: "out", purchaseUnitId: "unit-1", quantity: "100", unitPrice: "12.5" },
    ]);
  });

  it("reuses the existing purchase draft engine and contains no stock or movement write path", () => {
    expect(service).toContain('import { savePurchaseOrderDraft } from "../../purchasing/services/purchaseOrderDraftService"');
    expect(service).toContain("return savePurchaseOrderDraft(");
    expect(`${page}${service}`).not.toMatch(/recordInventoryMovement|recordStockMovement|receivePurchaseOrder|confirmInventoryAdjustment|current_quantity\s*[+\-]=/);
    expect(page).toContain("Nothing is created until you select Save Draft.");
    expect(page).toContain("does not receive stock or create a movement");
  });

  it("is routed as a dedicated responsive inventory page", () => {
    expect(router).toContain('"low-stock-assistant"');
    expect(dashboard).toContain('<LowStockAssistantPage restaurantId={restaurantId}');
    expect(dashboard).toContain('{ key: "low-stock-assistant", label: "Low Stock Assistant" }');
    expect(page).toContain("Out of Stock");
    expect(page).toContain("Critical Stock");
    expect(page).toContain("Low Stock");
    expect(page).toContain("Healthy Stock");
  });
});

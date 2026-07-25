import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyInventoryAdminRealtimeChanges,
  mergeRealtimeFoodMovements,
  replaceAffectedStock,
} from "../../src/modules/inventory/services/inventoryRealtimeService";
import type {
  InventoryAdminData,
  InventoryCurrentStockRow,
  InventoryFoodConsumptionMovement,
} from "../../src/modules/inventory/types";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/179_phase8_4_4_inventory_realtime_engine.sql");
const hook = read("src/modules/inventory/hooks/useInventoryRealtime.ts");
const service = read("src/modules/inventory/services/inventoryRealtimeService.ts");
const dashboard = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
const eventService = read("src/core/realtime/restaurantEventService.ts");
const inventoryPolicy = read("supabase/migrations/158_phase8_1_inventory_administration.sql");
const movementPolicy = read("supabase/migrations/159_phase8_2_stock_operations_engine.sql");
const recipePage = read("src/modules/recipes/pages/RecipeManagementPage.tsx");

describe("Phase 8.4.4 inventory realtime database and transport", () => {
  it("publishes only legitimate inventory source tables", () => {
    for (const table of [
      "inventory_items", "inventory_movements", "inventory_categories",
      "inventory_suppliers", "inventory_storage_locations", "inventory_units",
    ]) {
      expect(migration).toContain(`'${table}'`);
      expect(eventService).toContain(`"${table}"`);
    }
    expect(migration).toContain("alter publication supabase_realtime add table");
    expect(recipePage).toContain('tables: ["inventory_items", "recipe_ingredients"]');
  });

  it("adds a tenant-authorized, read-only targeted stock projection", () => {
    expect(migration).toContain("public.get_inventory_current_stock_items");
    expect(migration).toContain("public.get_inventory_current_stock(target_restaurant_id)");
    expect(migration).toContain("stock.inventory_item_id = any");
    expect(migration).toContain("revoke all on function");
    expect(migration).not.toMatch(/insert\s+into|update\s+public\.|delete\s+from|create\s+trigger/i);
  });

  it("retains database role and restaurant isolation for every realtime row", () => {
    expect(inventoryPolicy).toContain("public.inventory_admin_has_access(restaurant_id)");
    expect(movementPolicy).toContain("inventory_movements_inventory_admin_select");
    expect(movementPolicy).toContain("public.inventory_admin_has_access(restaurant_id)");
    expect(eventService).toContain("restaurant_id=eq.${this.restaurantId}");
    expect(eventService).toContain("rowTenant !== restaurantId");
  });
});

describe("Phase 8.4.4 inventory subscription lifecycle", () => {
  it("subscribes only from the authorized inventory surface through the shared channel", () => {
    expect(hook).toContain("canAccessInventory(staffRole) ? restaurantId : \"\"");
    expect(hook).toContain("useRestaurantEvents");
    expect(hook).toContain("tables: INVENTORY_REALTIME_TABLES");
    expect(eventService).toContain("DEFAULT_RESTAURANT_REALTIME_TABLES");
    expect(eventService).toContain(".filter(table => !INVENTORY_TABLES.has(table))");
    expect(hook).not.toContain(".channel(");
    expect(hook).not.toContain("setInterval");
    expect(dashboard).toContain("useInventoryRealtime({");
  });

  it("batches transaction bursts and disposes every local listener and timer", () => {
    expect(hook).toContain("new Set<string>()");
    expect(hook).toContain("new Map<InventoryRealtimeAdminTable");
    expect(hook).toContain("window.clearTimeout(flushTimer.current)");
    expect(hook).toContain("window.clearTimeout(reconcileTimer.current)");
    expect(hook).toContain('document.removeEventListener("visibilitychange"');
    expect(eventService).toContain("if (this.disposed || this.channel) return");
    expect(eventService).toContain("removeChannel");
  });

  it("recovers on reconnect and browser resume without polling", () => {
    expect(hook).toContain('state !== "connected"');
    expect(hook).toContain("connectedOnce.current");
    expect(hook).toContain("scheduleReconcile()");
    expect(hook).toContain('document.visibilityState === "visible"');
    expect(eventService).toContain('window.addEventListener("online"');
    expect(hook + service).not.toContain("setInterval");
  });

  it("contains synchronization only and no inventory business writes", () => {
    expect(hook + service).not.toMatch(/\.from\(|deduct_inventory|record_inventory_movement|payment_engine|kitchen_routing|purchase_order/i);
    expect(service).toContain('supabase.rpc("get_inventory_current_stock_items"');
    expect(service).toContain("loadInventoryMovementHistory");
    expect(service).toContain("loadLedger");
  });
});

describe("Phase 8.4.4 targeted UI reducers", () => {
  const stock = (id: string, location: string, quantity: number, status: InventoryCurrentStockRow["stockStatus"]): InventoryCurrentStockRow => ({
    inventoryItemId: id, itemName: id, categoryId: "category", categoryName: "Dry",
    storageLocationId: location, storageLocationName: location, unitId: "unit", unitName: "kg",
    minimumStock: 2, maximumStock: 20, currentQuantity: quantity, stockStatus: status,
    lastMovementAt: "2026-07-25T10:00:00Z",
  });

  it("replaces only affected stock lines so low/out-of-stock widgets derive live state", () => {
    const current = [stock("flour", "main", 8, "in_stock"), stock("oil", "main", 4, "in_stock")];
    const next = replaceAffectedStock(current, ["flour"], [stock("flour", "main", 0, "out_of_stock")]);
    expect(next.find((row) => row.inventoryItemId === "flour")?.stockStatus).toBe("out_of_stock");
    expect(next.find((row) => row.inventoryItemId === "oil")?.currentQuantity).toBe(4);
    expect(dashboard).toContain('row.stockStatus === "low_stock" || row.stockStatus === "out_of_stock"');
  });

  it("appends movement history idempotently and keeps newest records first", () => {
    const movement = (id: string, createdAt: string, quantityAfter: number): InventoryFoodConsumptionMovement => ({
      id, restaurantId: "restaurant", inventoryItemId: "flour", inventoryItemName: "Flour",
      menuItemId: "menu", menuItemName: "Bread", recipeId: "recipe", recipeName: "Bread",
      orderId: "order", orderNumber: "ORD-1", orderItemId: "line", diningSessionId: "session",
      diningSessionNumber: "DIN-1", kitchenBatchId: "initial", waiterId: null, waiterName: null,
      cashierId: null, cashierName: null, kitchenStationId: null, kitchenStationName: null,
      performedByStaffId: "staff", performedByName: "Staff", movementType: "FOOD_CONSUMPTION",
      quantity: 1, unit: "kg", quantityBefore: quantityAfter + 1, quantityAfter, createdAt,
      workflowSnapshot: {}, notes: null,
    });
    const first = movement("first", "2026-07-25T10:00:00Z", 9);
    const second = movement("second", "2026-07-25T11:00:00Z", 8);
    const rows = mergeRealtimeFoodMovements([first], [first, second]);
    expect(rows.map((row) => row.id)).toEqual(["second", "first"]);
  });

  it("patches only changed inventory administration records from event payloads", () => {
    const current: InventoryAdminData = {
      items: [], suppliers: [], storageLocations: [], units: [], staffNames: {},
      categories: [{ id: "dry", restaurantId: "restaurant", name: "Dry", description: null, sortOrder: 1, status: "active", createdAt: "", updatedAt: "" }],
    };
    const next = applyInventoryAdminRealtimeChanges(current, {
      inventory_categories: [{ operation: "UPDATE", record: {
        id: "dry", restaurant_id: "restaurant", name: "Dry Goods", sort_order: 1,
        status: "active", created_at: "", updated_at: "2026-07-25T11:00:00Z",
      } }],
    });
    expect(next.categories).toHaveLength(1);
    expect(next.categories[0].name).toBe("Dry Goods");
  });

  it("uses targeted loaders during events and full reconciliation only after interruption", () => {
    expect(dashboard).toContain("loadRealtimeCurrentStock(restaurantId, affectedIds)");
    expect(dashboard).toContain("loadRealtimeLedger(restaurantId, batch.movementItemIds)");
    expect(dashboard).toContain("loadRealtimeFoodMovements(restaurantId, batch.movementItemIds)");
    expect(dashboard).toContain("onReconcile: reconcileRealtime");
    expect(dashboard).not.toContain("useTenantRealtime");
  });
});

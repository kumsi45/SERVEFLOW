import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  activeTenantStorageChoices,
  inferMaterialStorageChoices,
  resolveInferredStorage,
} from "../../src/modules/inventory/services/inventoryStorageInference";
import type { InventoryCurrentStockRow, InventoryStorageLocation } from "../../src/modules/inventory/types";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const operations = read("src/modules/inventory/components/StockOperationWorkspaces.tsx");
const waste = read("src/modules/inventory/pages/InventoryWastePage.tsx");
const adjustments = read("src/modules/inventory/pages/InventoryAdjustmentsPage.tsx");
const adjustmentService = read("src/modules/inventory/services/inventoryAdjustmentService.ts");
const migration = read("supabase/migrations/252_inventory_storage_aware_adjustments.sql");

const storage = (id: string, restaurantId = "r1"): InventoryStorageLocation => ({
  id, restaurantId, name: id === "main" ? "Main Store" : id === "kitchen" ? "Kitchen Store" : "Other Store",
  description: null, status: "active", createdAt: "", updatedAt: "",
});
const balance = (storageLocationId: string, currentQuantity: number): InventoryCurrentStockRow => ({
  inventoryItemId: "coffee", itemName: "Coffee", categoryId: "dry", categoryName: "Dry",
  storageLocationId, storageLocationName: storageLocationId, unitId: "kg", unitName: "kg",
  minimumStock: 0, maximumStock: null, currentQuantity, stockStatus: currentQuantity ? "in_stock" : "out_of_stock",
  lastMovementAt: null,
});

describe("Inventory smart storage inference", () => {
  it("uses tenant-scoped material/storage relationships for incoming operations", () => {
    const context = { storageLocations: [storage("main"), storage("kitchen"), storage("foreign", "r2")], currentStock: [balance("main", 0), balance("kitchen", 8), balance("foreign", 90)] };
    expect(inferMaterialStorageChoices(context, "r1", "coffee", "relationship")).toMatchObject([
      { id: "kitchen", quantity: 8 }, { id: "main", quantity: 0 },
    ]);
    expect(activeTenantStorageChoices(context, "r1").map((choice) => choice.id)).toEqual(["kitchen", "main"]);
  });

  it("uses only positive same-tenant balances for Issue, Transfer source, Waste, and decrease Adjustment", () => {
    const context = { storageLocations: [storage("main"), storage("kitchen"), storage("foreign", "r2")], currentStock: [balance("main", 0), balance("kitchen", 8), balance("foreign", 90)] };
    expect(inferMaterialStorageChoices(context, "r1", "coffee", "positive-source")).toEqual([
      { id: "kitchen", name: "Kitchen Store", quantity: 8, unitName: "kg" },
    ]);
  });

  it("auto-selects exactly one choice, preserves a valid multi-storage choice, and never guesses among many", () => {
    const main = { id: "main", name: "Main Store", quantity: 60, unitName: "kg" };
    const kitchen = { id: "kitchen", name: "Kitchen Store", quantity: 8, unitName: "kg" };
    expect(resolveInferredStorage("", [main])).toBe("main");
    expect(resolveInferredStorage("kitchen", [main, kitchen])).toBe("kitchen");
    expect(resolveInferredStorage("", [main, kitchen])).toBe("");
    expect(resolveInferredStorage("", [])).toBe("");
  });

  it("applies the operation matrix without arbitrary source-storage dropdowns", () => {
    for (const marker of ["relationship", "positive-source", "ia-so-auto-storage", "No available stock exists for this material"]) expect(operations).toContain(marker);
    expect(operations).toContain("destinationLocations");
    expect(operations).toContain("location.id !== draft.fromStorageLocationId");
    expect(waste).toContain('"positive-source"');
    expect(waste).toContain("No available stock exists for this material");
    expect(adjustments).toContain('direction === "increase" ? "relationship" : "positive-source"');
    expect(adjustments).toContain("No available source stock exists for this material");
  });

  it("submits explicit adjustment storage through an idempotent tenant-safe RPC", () => {
    expect(adjustmentService).toContain('supabase.rpc("confirm_inventory_storage_adjustment"');
    expect(adjustmentService).toContain("storage_location_id: line.storageLocationId");
    expect(migration).toContain("public.inventory_admin_has_access(target_restaurant_id)");
    expect(migration).toContain("storage.id = line.storage_location_id");
    expect(migration).toContain("storage.restaurant_id = item.restaurant_id");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("adjustment.idempotency_key = target_idempotency_key");
    expect(migration.match(/insert into public\.inventory_movements/g)).toHaveLength(1);
    expect(migration).toContain("Inventory adjustment would create negative storage stock.");
    expect(migration).toContain("'storage_location_name', storage.name");
    expect(migration).toContain("public.get_inventory_adjustments(target_restaurant_id uuid)");
    expect(adjustments).toContain("item.storageLocationName");
    expect(migration).toContain("grant execute on function public.confirm_inventory_storage_adjustment");
    expect(migration).toContain("revoke all on function public.confirm_inventory_storage_adjustment");
  });
});

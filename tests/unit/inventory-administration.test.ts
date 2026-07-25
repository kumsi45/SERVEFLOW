import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateCategoryDraft, validateItemDraft, validateSimpleDraft } from "../../src/modules/inventory/services/inventoryValidation";
import type { InventoryAdminData } from "../../src/modules/inventory/types";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const baseData: InventoryAdminData = {
  categories: [
    { id: "cat-a", restaurantId: "r1", name: "Produce", description: null, sortOrder: 10, status: "active", createdAt: "", updatedAt: "" },
    { id: "cat-b", restaurantId: "r2", name: "Produce", description: null, sortOrder: 10, status: "active", createdAt: "", updatedAt: "" },
  ],
  suppliers: [
    { id: "sup-a", restaurantId: "r1", name: "Metro Foods", phone: null, address: null, contactPerson: null, notes: null, status: "active", createdAt: "", updatedAt: "" },
  ],
  storageLocations: [
    { id: "store-a", restaurantId: "r1", name: "Main Store", description: null, status: "active", createdAt: "", updatedAt: "" },
  ],
  units: [
    { id: "unit-a", restaurantId: "r1", name: "kg", description: null, status: "active", createdAt: "", updatedAt: "" },
  ],
  items: [
    {
      id: "item-a",
      restaurantId: "r1",
      name: "Tomato",
      categoryId: "cat-a",
      unitId: "unit-a",
      storageLocationId: "store-a",
      preferredSupplierId: "sup-a",
      sku: "SKU-1",
      barcode: "BAR-1",
      minimumStock: 1,
      maximumStock: 10,
      description: null,
      status: "active",
      createdByStaffId: null,
      updatedByStaffId: null,
      createdAt: "",
      updatedAt: "",
    },
  ],
  staffNames: {},
};

describe("Phase 8.1 inventory administration contracts", () => {
  it("creates isolated master-data tables with owner and manager RLS", () => {
    const sql = read("supabase/migrations/158_phase8_1_inventory_administration.sql");
    for (const table of ["inventory_categories", "inventory_suppliers", "inventory_storage_locations", "inventory_units"]) {
      expect(sql).toContain(`create table if not exists public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`grant select, insert, update on public.${table} to authenticated`);
    }
    expect(sql).toContain("public.has_staff_role(target_restaurant_id, array['owner','manager']::public.restaurant_staff_role[])");
    expect(sql).toContain("create policy inventory_items_inventory_admin_select");
    expect(sql).toContain("for update to authenticated using (public.inventory_admin_has_access(restaurant_id))");
    expect(sql).not.toMatch(/grant\s+delete/i);
  });

  it("validates tenant-safe references and prevents deleting units already in use", () => {
    const sql = read("supabase/migrations/158_phase8_1_inventory_administration.sql");
    expect(sql).toContain("Inventory category is required.");
    expect(sql).toContain("Inventory unit is invalid.");
    expect(sql).toContain("Preferred supplier is invalid.");
    expect(sql).toContain("i.restaurant_id = new.restaurant_id");
    expect(sql).toContain("Inventory unit is already in use.");
  });

  it("keeps the inventory admin UI isolated from kitchen, realtime, and request workflows", () => {
    const page = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
    expect(page).not.toContain("useTenantRealtime");
    expect(page).not.toContain("useRestaurantEvents");
    expect(page).not.toContain("inventoryRequestService");
    expect(page).not.toContain("../../kitchen");

    const route = read("src/modules/staff-auth/pages/ProtectedInventoryRoute.tsx");
    expect(route).toContain('.in("role", ["owner", "manager", "inventory_officer"])');
    expect(route).not.toContain('.eq("role", "inventory")');
  });

  it("routes the complete inventory navigation surface", () => {
    const router = read("src/app/router/AppRouter.tsx");
    const roleRoute = read("src/app/router/RoleNamespaceRoute.tsx");
    const inventoryAccess = read("src/core/permissions/inventoryAccess.ts");
    expect(router).toContain('inventory: ["dashboard", "items", "current-stock", "movements", "stock-in", "stock-out", "adjustments", "waste", "transfers", "ledger", "movement-history", "categories", "suppliers", "storage-locations", "units"]');
    expect(roleRoute).toContain('namespace === "inventory"');
    expect(roleRoute).toContain("canAccessInventory(restaurant.role)");
    expect(inventoryAccess).toContain('role === "owner" || role === "manager" || role === "inventory_officer"');
    expect(roleRoute).toContain('<ProtectedInventoryRoute restaurantId={state.restaurantId} section={section} />');
  });
});

describe("inventory administration validation", () => {
  it("prevents duplicate category names inside the same restaurant only", () => {
    expect(validateCategoryDraft({ name: "produce", description: "", sortOrder: "1" }, baseData, "r1").errors).toContain("Category names must be unique inside the restaurant.");
    expect(validateCategoryDraft({ name: "produce", description: "", sortOrder: "1" }, baseData, "r2").errors).toContain("Category names must be unique inside the restaurant.");
    expect(validateCategoryDraft({ name: "Dry Goods", description: "", sortOrder: "1" }, baseData, "r1").valid).toBe(true);
  });

  it("requires valid item references and stock ranges", () => {
    const invalid = validateItemDraft({
      name: "Tomato",
      categoryId: "cat-missing",
      unitId: "",
      storageLocationId: "store-a",
      preferredSupplierId: "supplier-missing",
      sku: "SKU-1",
      barcode: "BAR-1",
      minimumStock: "8",
      maximumStock: "2",
      description: "",
    }, baseData, "r1");
    expect(invalid.errors).toEqual(expect.arrayContaining([
      "Item names must be unique inside the restaurant.",
      "Unit is required.",
      "Selected category is invalid.",
      "Selected supplier is invalid.",
      "Maximum stock cannot be less than minimum stock.",
      "SKU must be unique inside the restaurant.",
      "Barcode must be unique inside the restaurant.",
    ]));
  });

  it("supports storage and unit duplicate validation through the shared simple validator", () => {
    expect(validateSimpleDraft({ name: "Main Store", description: "" }, baseData.storageLocations, "r1", "Storage location").errors).toContain("Storage location names must be unique inside the restaurant.");
    expect(validateSimpleDraft({ name: "pcs", description: "" }, baseData.units, "r1", "Unit").valid).toBe(true);
  });
});

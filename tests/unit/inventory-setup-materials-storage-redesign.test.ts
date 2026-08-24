import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hasDuplicateName } from "../../src/modules/inventory/services/inventoryValidation";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const workspace = read("src/modules/inventory/components/InventorySetupWorkspaces.tsx");
const page = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
const repository = read("src/modules/inventory/services/inventoryRepository.ts");
const security = read("supabase/migrations/251_inventory_destructive_authority_hardening.sql");

describe("Inventory Setup Materials and Storage redesign", () => {
  it("keeps Materials focused on tenant master data instead of stock operations", () => {
    for (const label of ["Materials", "Add Material", "Search materials", "Category", "Unit", "Status", "Edit"]) {
      expect(workspace).toContain(label);
    }
    for (const removed of ["Current Stock", "Stock In", "Stock Out", "Duplicate", "Create Ingredient", "Search ingredients"]) {
      expect(workspace).not.toContain(removed);
    }
    expect(workspace).not.toMatch(/Ingredient|Ingredients/);
    expect(page).toContain('section === "items" ? adminDataFailed ? <InventorySetupLoadError resource="materials" />');
  });

  it("uses a compact Storage workspace without empty-value noise", () => {
    for (const label of ["Storage", "Add Storage", "materials", "Edit"]) expect(workspace).toContain(label);
    for (const removed of ["Storage Locations", "records", "Stored Ingredients", "No description", "0 ingredients"]) {
      expect(workspace).not.toContain(removed);
    }
    expect(workspace).toContain("count > 0 &&");
    expect(workspace).toContain("location.description &&");
    expect(workspace).toContain('location.status !== "active"');
  });

  it("keeps create/edit configuration clear without changing the storage contract", () => {
    for (const label of ["Add Material", "Edit Material", "Material name", "Default storage", "Minimum stock", "Maximum stock", "Save Material"]) {
      expect(page).toContain(label);
    }
    expect(page).toContain("Low-stock alert threshold.");
    expect(page).toContain("Optional upper stock target.");
    expect(page).toContain("Additional configuration");
    expect(page).toContain('title="Storage"');
    expect(page).toContain('title === "Storage" ? "Storage name"');
    expect(repository).toContain("storage_location_id: draft.storageLocationId");
  });

  it("prevents obvious exact-name duplicates only within the active tenant", () => {
    const rows = [
      { id: "a", restaurantId: "tenant-a", name: "Coffee", status: "active" },
      { id: "b", restaurantId: "tenant-b", name: "Coffee", status: "active" },
    ];
    expect(hasDuplicateName(rows, "tenant-a", "  coffee  ")).toBe(true);
    expect(hasDuplicateName(rows, "tenant-a", "Coffee", "a")).toBe(false);
    expect(hasDuplicateName(rows, "tenant-c", "Coffee")).toBe(false);
    expect(hasDuplicateName(rows, "tenant-a", "Tea")).toBe(false);
  });

  it("preserves server-enforced tenant scoping and lifecycle authority", () => {
    expect(repository.match(/\.eq\("restaurant_id", restaurantId\)/g)?.length).toBeGreaterThanOrEqual(8);
    expect(repository).toContain("restaurant_id: restaurantId");
    expect(security).toContain("s.restaurant_id = target_restaurant_id");
    expect(security).toContain("s.user_id = auth.uid()");
    expect(security).toContain("s.role::text in ('owner', 'manager')");
    expect(security).toContain("Inventory master lifecycle access denied.");
    expect(security).toContain("revoke delete, truncate on table");
    expect(page).toContain('const canManageMasterLifecycle = staffRole === "owner" || staffRole === "manager"');
  });

  it("uses clean section-specific failures and preserves the current navigation boundary", () => {
    expect(workspace).toContain("Unable to load {resource}.");
    expect(workspace).toContain("Try again.");
    expect(page).toContain("const compactSetupWorkspace");
    expect(page).toContain("!compactSetupWorkspace && <header className=\"ia-header\"");
    expect(page).toContain('{ key: "items", label: "Materials" }');
    expect(page).toContain('{ key: "storage-locations", label: "Storage" }');
  });
});

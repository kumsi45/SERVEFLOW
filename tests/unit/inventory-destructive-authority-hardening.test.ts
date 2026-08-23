import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/251_inventory_destructive_authority_hardening.sql", "utf8");
const historicalRoleMigration = readFileSync("supabase/migrations/160_inventory_officer_role.sql", "utf8");
const page = readFileSync("src/modules/inventory/pages/InventoryDashboardPage.tsx", "utf8");

describe("Inventory V1 Security Phase 1A", () => {
  it("preserves the existing operational helper for Inventory Officer workflows", () => {
    expect(historicalRoleMigration).toContain("s.role::text in ('owner', 'manager', 'inventory_officer')");
    expect(migration).not.toContain("create or replace function public.inventory_admin_has_access");
    expect(migration).not.toContain("create or replace function public.inventory_admin_actor");
  });

  it("creates an active same-tenant Owner and Manager lifecycle boundary", () => {
    expect(migration).toContain("inventory_master_lifecycle_has_access");
    expect(migration).toContain("s.restaurant_id = target_restaurant_id");
    expect(migration).toContain("s.user_id = auth.uid()");
    expect(migration).toContain("s.active = true");
    expect(migration).toContain("s.role::text in ('owner', 'manager')");
    expect(migration).not.toContain("s.role::text in ('owner', 'manager', 'inventory_officer')");
  });

  it("guards lifecycle updates on every Inventory master table", () => {
    for (const table of ["inventory_items", "inventory_categories", "inventory_units", "inventory_storage_locations", "inventory_suppliers"]) {
      expect(migration).toContain(`'${table}'`);
    }
    expect(migration).toContain("new.status is distinct from old.status");
    expect(migration).toContain("old.status in ('archived', 'deleted')");
    expect(migration).toContain("Inventory master lifecycle access denied.");
    expect(migration).toContain("new.restaurant_id is distinct from old.restaurant_id");
  });

  it("removes unused hard-delete and truncate grants without revoking operational access", () => {
    expect(migration).toContain("revoke delete, truncate on table");
    expect(migration).toContain("from authenticated, anon, public");
    expect(migration).not.toContain("revoke select");
    expect(migration).not.toContain("revoke insert");
    expect(migration).not.toContain("revoke update");
  });

  it("hides lifecycle controls from Inventory Officers while retaining Owner and Manager controls", () => {
    expect(page).toContain('const canManageMasterLifecycle = staffRole === "owner" || staffRole === "manager"');
    expect(page).toContain("{canManageMasterLifecycle && <>");
    expect(page).toContain("{canManageMasterLifecycle && (item.status");
    expect(page).toContain("{canManageMasterLifecycle && <button");
  });
});

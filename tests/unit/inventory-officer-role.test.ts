import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canAccessInventory } from "../../src/core/permissions/inventoryAccess";
import { getStaffDestinationPath, getStaffDestinations } from "../../src/modules/staff-auth/services/staffAuthService";
import type { StaffSession } from "../../src/modules/staff-auth/types";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function functionDefinition(source: string, name: string) {
  const start = source.indexOf(`create or replace function public.${name}()`);
  const end = source.indexOf("end $$;", start);
  if (start < 0 || end < 0) throw new Error(`Function ${name} was not found.`);
  return source.slice(start, end + "end $$;".length);
}

describe("Inventory Officer role", () => {
  it("logs in through the existing staff destination flow and sees only Inventory", () => {
    const session: StaffSession = {
      userId: "inventory-officer-user",
      restaurants: [{ id: "restaurant-a", name: "Restaurant A", role: "inventory_officer" }],
    };

    const destinations = getStaffDestinations(session);
    expect(destinations).toHaveLength(1);
    expect(destinations[0].dashboard).toBe("inventory");
    expect(getStaffDestinationPath(destinations[0])).toBe("/inventory/dashboard");
    expect(canAccessInventory("inventory_officer")).toBe(true);
    for (const blocked of ["owner", "manager", "cashier", "kitchen", "waiter", "customer"]) {
      expect(destinations.some((destination) => destination.dashboard === blocked)).toBe(false);
    }
  });

  it("allows Owner and Manager creation while excluding Inventory Officer from staff authority", () => {
    const ownerService = read("src/modules/owner/services/staffManagementService.ts");
    const ownerPage = read("src/modules/owner/pages/OwnerDashboardPage.tsx");
    const managerService = read("src/modules/manager/services/managerStaffOperationsService.ts");
    const managerPage = read("src/modules/manager/pages/ManagerStaffOperationsPage.tsx");
    const ownerStyles = read("src/modules/owner/styles/ownerDashboard.css");
    const managerStyles = read("src/modules/manager/styles/managerStaffOperations.css");
    const staffFunction = read("supabase/functions/manage-staff/index.ts");

    expect(ownerService).toContain('"inventory_officer"');
    expect(ownerPage).toContain('<option value="inventory_officer">Inventory Officer</option>');
    expect(managerService).toContain('"inventory_officer"');
    expect(managerPage).toContain('role: "inventory_officer"');
    expect(managerPage).toContain('>Inventory Officer</button>');
    expect(ownerStyles).toContain(".od-role-badge.inventory_officer");
    expect(managerStyles).toContain(".mso-role-badge.inventory_officer");
    expect(staffFunction).toContain("canCreateStaffRole");
    expect(staffFunction).toContain('.in("role", ["owner", "manager"])');
    expect(staffFunction).not.toContain('.in("role", ["owner", "manager", "inventory_officer"])');
  });

  it("adds the enum, login session support, tenant isolation, and inventory RLS in one new migration", () => {
    const sql = read("supabase/migrations/160_inventory_officer_role.sql");

    expect(sql).toContain("alter type public.user_role add value if not exists 'inventory_officer'");
    expect(sql).toContain("alter type public.restaurant_staff_role add value if not exists 'inventory_officer'");
    expect(sql).toContain("when 'inventory_officer' then 'IO'");
    expect(sql).toContain("role::text in ('owner', 'manager', 'cashier', 'kitchen', 'inventory', 'inventory_officer')");
    expect(sql).toContain("s.restaurant_id = target_restaurant_id");
    expect(sql).toContain("s.user_id = auth.uid()");
    expect(sql).toContain("s.active = true");
    expect(sql).toContain("s.role::text in ('owner', 'manager', 'inventory_officer')");
    expect(sql).toContain("public.inventory_admin_has_access(new.restaurant_id)");
    expect(sql).toContain("and s.restaurant_id = new.restaurant_id");
    expect(sql).toContain("role::text in ('waiter', 'cashier', 'kitchen', 'reception', 'inventory_officer')");
  });

  it("keeps route guards role-specific and redirects Inventory Officer back to Inventory", () => {
    const roleRoute = read("src/app/router/RoleNamespaceRoute.tsx");
    const inventoryGuard = read("src/modules/staff-auth/pages/ProtectedInventoryRoute.tsx");
    const authService = read("src/modules/staff-auth/services/staffAuthService.ts");

    expect(roleRoute).toContain('if (role === "inventory_officer") return "/inventory/dashboard"');
    expect(roleRoute).toContain("canAccessInventory(restaurant.role)");
    expect(roleRoute).toContain("restaurant.role === namespace");
    expect(inventoryGuard).toContain('.in("role", ["owner", "manager", "inventory_officer"])');
    expect(authService).toContain('restaurant.role === "inventory_officer"');
  });

  it("does not alter existing inventory or stock migrations", () => {
    const administration = read("supabase/migrations/158_phase8_1_inventory_administration.sql");
    const stockEngine = read("supabase/migrations/159_phase8_2_stock_operations_engine.sql");
    const roleExtension = read("supabase/migrations/160_inventory_officer_role.sql");

    expect(administration).not.toContain("inventory_officer");
    expect(stockEngine).not.toContain("inventory_officer");

    const originalValidation = functionDefinition(stockEngine, "inventory_movement_validate_row")
      .replace("and s.role in ('owner','manager')", "and INVENTORY_ACTOR_ROLE")
      .replace(/\s+/g, " ");
    const extendedValidation = functionDefinition(roleExtension, "inventory_movement_validate_row")
      .replace("and s.role::text in ('owner', 'manager', 'inventory_officer')", "and INVENTORY_ACTOR_ROLE")
      .replace(/\s+/g, " ");
    expect(extendedValidation).toBe(originalValidation);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canAccessInventory } from "../../src/core/permissions/inventoryAccess";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("inventory dashboard navigation and access", () => {
  it.each([
    ["owner", true],
    ["manager", true],
    ["inventory_officer", true],
    ["kitchen", false],
    ["cashier", false],
    ["waiter", false],
    ["customer", false],
    ["inventory", false],
  ] as const)("grants inventory access for %s: %s", (role, expected) => {
    expect(canAccessInventory(role)).toBe(expected);
  });

  it("shows Inventory in owner and manager navigation only", () => {
    const owner = read("src/modules/owner/pages/OwnerDashboardPage.tsx");
    const manager = read("src/modules/manager/components/ManagerLayout.tsx");
    const blockedRoleNavigation = [
      read("src/modules/kitchen/pages/KitchenDashboardPage.tsx"),
      read("src/modules/cashier/components/CashierDashboardUi.tsx"),
      read("src/modules/waiter-dashboard/pages/WaiterDashboardPage.tsx"),
    ].join("\n");

    expect(owner).toContain('{ id: "inventory", icon: "▦", label: "Inventory" }');
    expect(manager).toContain('{ key: "inventory", label: "Inventory"');
    expect(owner).toContain('"/inventory/dashboard"');
    expect(manager).toContain('href: "/manager/inventory"');
    expect(blockedRoleNavigation).not.toContain('href: "/inventory/');
    expect(blockedRoleNavigation).not.toContain('label: "Inventory"');
  });

  it("protects every inventory route with the owner-manager guard", () => {
    const router = read("src/app/router/AppRouter.tsx");
    const roleRoute = read("src/app/router/RoleNamespaceRoute.tsx");
    const guard = read("src/modules/staff-auth/pages/ProtectedInventoryRoute.tsx");
    const authorizedRender = roleRoute.slice(roleRoute.indexOf('if (state.status === "authorized")'));

    expect(router).toContain('/(owner|manager|waiter|cashier|kitchen|inventory|admin)');
    expect(authorizedRender.indexOf('namespace === "inventory"')).toBeLessThan(authorizedRender.indexOf('state.role === "owner"'));
    expect(authorizedRender).toContain("<ProtectedInventoryRoute");
    expect(guard).toContain('.in("role", ["owner", "manager", "inventory_officer"])');
    expect(guard).toContain("canAccessInventory(data?.role)");
    expect(guard).toContain("Inventory administration is available to owners, managers, and inventory officers only.");
  });

  it("keeps the selected restaurant when owner or manager opens Inventory", () => {
    const owner = read("src/modules/owner/pages/OwnerDashboardPage.tsx");
    const manager = read("src/modules/manager/components/ManagerLayout.tsx");

    expect(owner).toContain('sessionStorage.setItem("serveflow.active-restaurant:inventory", restaurantId)');
    expect(manager).toContain('sessionStorage.setItem("serveflow.active-restaurant:inventory", restaurantId)');
  });
});

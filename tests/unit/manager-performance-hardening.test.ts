import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearManagerDataCache,
  loadManagerCachedData,
  retainManagerTenantCache,
} from "../../src/modules/manager/services/managerDataCache";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

beforeEach(() => clearManagerDataCache());

describe("Manager performance hardening", () => {
  it("deduplicates fresh and in-flight tenant-scoped data without crossing tenants", async () => {
    const loaderA = vi.fn(async () => ({ value: "A" }));
    const options = { restaurantId: "restaurant-a", resource: "menu", maxAgeMs: 60_000, loader: loaderA };
    const [first, second] = await Promise.all([
      loadManagerCachedData(options),
      loadManagerCachedData(options),
    ]);
    expect(first).toEqual({ value: "A" });
    expect(second).toEqual({ value: "A" });
    expect(loaderA).toHaveBeenCalledTimes(1);
    await loadManagerCachedData(options);
    expect(loaderA).toHaveBeenCalledTimes(1);

    const loaderB = vi.fn(async () => ({ value: "B" }));
    await loadManagerCachedData({ ...options, restaurantId: "restaurant-b", loader: loaderB });
    expect(loaderB).toHaveBeenCalledTimes(1);
    retainManagerTenantCache("restaurant-b");
    await loadManagerCachedData(options);
    expect(loaderA).toHaveBeenCalledTimes(2);
  });

  it("allows realtime and explicit actions to force a fresh read", async () => {
    const loader = vi.fn(async () => loader.mock.calls.length);
    const options = { restaurantId: "restaurant-a", resource: "staff", maxAgeMs: 60_000, loader };
    expect(await loadManagerCachedData(options)).toBe(1);
    expect(await loadManagerCachedData({ ...options, force: true })).toBe(2);
  });

  it("bounds Manager route data reads so loading states terminate", () => {
    const cache = read("src/modules/manager/services/managerDataCache.ts");
    expect(cache).toContain("MANAGER_DATA_TIMEOUT_MS = 15_000");
    expect(cache).toContain("withManagerDataTimeout(loader())");
    for (const pageName of ["ManagerDashboardPage", "ManagerKitchenSupervisionPage", "ManagerCustomerExperiencePage", "ManagerInventoryWorkspacePage"]) {
      expect(read(`src/modules/manager/pages/${pageName}.tsx`)).toContain("withManagerDataTimeout(");
    }
  });

  it("does not let an in-flight old-tenant request repopulate cache after logout", async () => {
    let resolveFirst!: (value: { value: string }) => void;
    const loader = vi.fn(() => new Promise<{ value: string }>((resolve) => { resolveFirst = resolve; }));
    const options = { restaurantId: "restaurant-a", resource: "menu", maxAgeMs: 60_000, loader };
    const pending = loadManagerCachedData(options);
    clearManagerDataCache();
    resolveFirst({ value: "A" });
    await pending;

    const freshLoader = vi.fn(async () => ({ value: "fresh-A" }));
    await loadManagerCachedData({ ...options, loader: freshLoader });
    expect(freshLoader).toHaveBeenCalledTimes(1);
  });

  it("removes the Recipes N+1 ingredient query and duplicate realtime bootstrap", () => {
    const service = read("src/modules/manager/services/managerRecipeWorkspaceService.ts");
    const page = read("src/modules/manager/pages/ManagerRecipeWorkspacePage.tsx");
    expect(service).toContain("fetchRecipeIngredientsForRecipes");
    expect(service).not.toContain("Promise.all(recipes.map");
    expect(page.match(/useTenantRealtime\(/g)).toHaveLength(1);
    expect(page).toContain("skipInitialConnectRefresh: true");
  });

  it("does not reload unrelated Live Operations data for assignment-only realtime events", () => {
    const page = read("src/modules/manager/pages/ManagerOperationsCenterPage.tsx");
    const callback = page.slice(page.indexOf("const refreshAssignmentsFromRealtime"), page.indexOf("useEffect(() => { void refresh();"));
    expect(callback).toContain("await refreshAssignments()");
    expect(callback).not.toContain("refresh()");
  });

  it("renders primary Live Operations independently of bounded secondary reads", () => {
    const page = read("src/modules/manager/pages/ManagerOperationsCenterPage.tsx");
    expect(page).toContain("OPERATIONS_LOAD_TIMEOUT_MS = 15_000");
    expect(page).toContain("const dashboardLoad = withOperationsTimeout(fetchManagerDashboardSnapshot(restaurantId))");
    expect(page).toContain("const secondaryLoad = Promise.allSettled");
    expect(page).toContain("Some supporting data is temporarily unavailable");
  });

  it("reuses the authorized Manager bootstrap and preloads route chunks from navigation intent", () => {
    const namespace = read("src/app/router/RoleNamespaceRoute.tsx");
    const guard = read("src/modules/staff-auth/pages/ProtectedManagerRoute.tsx");
    const layout = read("src/modules/manager/components/ManagerLayout.tsx");
    expect(namespace).toContain("accessContext={{ restaurantName: state.restaurant.name");
    expect(guard).toContain("accessContext ? { status: \"authorized\"");
    expect(layout).toContain("preloadManagerSection(item.key)");
    expect(layout).toContain("clearManagerDataCache()");
  });

  it("revalidates Manager authority on tab resume without restoring per-route bootstrap", () => {
    const guard = read("src/modules/staff-auth/pages/ProtectedManagerRoute.tsx");
    expect(guard).toContain("MANAGER_ACCESS_RECHECK_MS = 60_000");
    expect(guard).toContain('window.addEventListener("focus", revalidate)');
    expect(guard).toContain('document.addEventListener("visibilitychange", revalidate)');
    expect(guard).toContain('.eq("restaurant_id", restaurantId)');
    expect(guard).toContain('.eq("role", "manager")');
    expect(guard).toContain('.eq("active", true)');
    expect(guard).toContain("if (next.status === \"unauthorized\") clearManagerDataCache()");
    expect(guard).toContain("key={restaurantId}");
  });

  it("does not reintroduce title nodes into performance-hardened Manager pages", () => {
    for (const [path, title] of [
      ["ManagerStaffOperationsPage.tsx", "Staff"],
      ["ManagerRecipeWorkspacePage.tsx", "Recipes"],
      ["ManagerOperationalReportsPage.tsx", "Reports"],
      ["ManagerInventoryWorkspacePage.tsx", "Inventory"],
    ]) {
      const page = read(`src/modules/manager/pages/${path}`);
      expect(page).not.toContain(`<h1 className="sr-only">${title}</h1>`);
      expect(page).not.toMatch(new RegExp(`<h1[^>]*>${title}</h1>`));
    }
  });
});

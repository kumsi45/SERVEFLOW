import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OWNER_RETAINED_POLICY,
  activateOwnerRetainedScope,
  assertOwnerRetainedRequestAccess,
  clearOwnerRetainedResources,
  ownerRetainedResourceKey,
  readOwnerRetainedResource,
  revalidateOwnerRetainedResource,
  type OwnerRetainedResource,
} from "../../src/modules/owner/services/ownerRetainedResources";
import { getOccupiedOwnerTableIds } from "../../src/modules/owner/services/ownerTablesReadModel";

const scope = { userId: "owner-a", restaurantId: "restaurant-a" };
const otherTenant = { ...scope, restaurantId: "restaurant-b" };
const otherUser = { ...scope, userId: "owner-b" };
const page = readFileSync("src/modules/owner/pages/OwnerDashboardPage.tsx", "utf8");
const route = readFileSync("src/modules/staff-auth/pages/ProtectedOwnerRoute.tsx", "utf8");
const service = readFileSync("src/modules/owner/services/ownerRetainedResources.ts", "utf8");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function read<T>(resource: OwnerRetainedResource, dimensions = "", target = scope) {
  return readOwnerRetainedResource<T>({
    scope: target,
    resource,
    dimensions,
    freshForMs: 10_000,
    retainForMs: 120_000,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-12T08:00:00Z"));
  activateOwnerRetainedScope(scope);
});
afterEach(() => { clearOwnerRetainedResources(); vi.useRealTimers(); });

describe.each(["table-stats", "finance-period", "menu-uploads"] as const)("P1B %s retention", (resource) => {
  it("has no fabricated result on first visit", async () => {
    const request = deferred<number[]>();
    const loader = vi.fn(() => request.promise);
    expect(read(resource)).toBeNull();
    const pending = revalidateOwnerRetainedResource({ scope, resource, loader });
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(read(resource)).toBeNull();
    request.resolve([4]);
    await pending;
    expect(read<number[]>(resource)?.value).toEqual([4]);
  });

  it("shows the prior value immediately while a revisit revalidates", async () => {
    await revalidateOwnerRetainedResource({ scope, resource, loader: async () => [4] });
    const request = deferred<number[]>();
    const pending = revalidateOwnerRetainedResource({ scope, resource, loader: () => request.promise });
    expect(read<number[]>(resource)?.value).toEqual([4]);
    request.resolve([6]);
    await pending;
    expect(read<number[]>(resource)?.value).toEqual([6]);
  });

  it("preserves valid data and its confirmation time after refresh failure", async () => {
    await revalidateOwnerRetainedResource({ scope, resource, loader: async () => [4] });
    const confirmed = read<number[]>(resource)!;
    vi.advanceTimersByTime(15_000);
    await expect(revalidateOwnerRetainedResource({ scope, resource, loader: async () => { throw new Error("offline"); } })).rejects.toThrow("offline");
    expect(read<number[]>(resource)?.value).toEqual([4]);
    expect(read(resource)?.updatedAt).toBe(confirmed.updatedAt);
    expect(read(resource)?.isStale).toBe(true);
  });

  it("deduplicates rapid overlapping revisit requests", async () => {
    const request = deferred<number[]>();
    const loader = vi.fn(() => request.promise);
    const first = revalidateOwnerRetainedResource({ scope, resource, loader });
    const revisit = revalidateOwnerRetainedResource({ scope, resource, loader });
    expect(revisit).toBe(first);
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
    request.resolve([4]);
    await Promise.all([first, revisit]);
    await revalidateOwnerRetainedResource({ scope, resource, loader: async () => [5] });
    expect(read<number[]>(resource)?.value).toEqual([5]);
  });

  it("does not expose tenant A data while tenant B is resolving", async () => {
    await revalidateOwnerRetainedResource({ scope, resource, loader: async () => [4] });
    activateOwnerRetainedScope(otherTenant);
    expect(read(resource, "", otherTenant)).toBeNull();
    expect(read(resource)).toBeNull();
  });
});

describe("P1B scope, dimensions and freshness", () => {
  it("keys by authenticated user, restaurant, resource and exact dimensions", () => {
    const base = ownerRetainedResourceKey(scope, "finance-period", "today:range-a");
    expect(base).not.toBe(ownerRetainedResourceKey(otherUser, "finance-period", "today:range-a"));
    expect(base).not.toBe(ownerRetainedResourceKey(otherTenant, "finance-period", "today:range-a"));
    expect(base).not.toBe(ownerRetainedResourceKey(scope, "table-stats", "today:range-a"));
    expect(base).not.toBe(ownerRetainedResourceKey(scope, "finance-period", "week:range-a"));
  });

  it("never reuses Finance values for a different period or custom range", async () => {
    await revalidateOwnerRetainedResource({ scope, resource: "finance-period", dimensions: "today:start:end", loader: async () => [100] });
    expect(read("finance-period", "week:start:end")).toBeNull();
    expect(read("finance-period", "custom:other:end")).toBeNull();
    expect(read<number[]>("finance-period", "today:start:end")?.value).toEqual([100]);
  });

  it("does not deduplicate different Finance ranges", async () => {
    const request = deferred<number[]>();
    const loader = vi.fn(() => request.promise);
    const first = revalidateOwnerRetainedResource({ scope, resource: "finance-period", dimensions: "today", loader });
    const second = revalidateOwnerRetainedResource({ scope, resource: "finance-period", dimensions: "week", loader });
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(2);
    request.resolve([4]);
    await Promise.all([first, second]);
  });

  it("does not deduplicate requests across tenants", async () => {
    const requestA = deferred<number[]>();
    const requestB = deferred<number[]>();
    const loaderA = vi.fn(() => requestA.promise);
    const loaderB = vi.fn(() => requestB.promise);
    const first = revalidateOwnerRetainedResource({ scope, resource: "table-stats", loader: loaderA });
    activateOwnerRetainedScope(otherTenant);
    const second = revalidateOwnerRetainedResource({ scope: otherTenant, resource: "table-stats", loader: loaderB });
    await Promise.resolve();
    expect(loaderA).toHaveBeenCalledTimes(1);
    expect(loaderB).toHaveBeenCalledTimes(1);
    requestA.resolve([1]); requestB.resolve([2]);
    const results = await Promise.allSettled([first, second]);
    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("fulfilled");
    expect(read<number[]>("table-stats", "", otherTenant)?.value).toEqual([2]);
  });

  it("auth-user change clears retained values", async () => {
    await revalidateOwnerRetainedResource({ scope, resource: "menu-uploads", loader: async () => [4] });
    activateOwnerRetainedScope(otherUser);
    expect(read("menu-uploads", "", otherUser)).toBeNull();
    expect(read("menu-uploads")).toBeNull();
  });

  it("logout prevents old completion from repopulating even the same later scope", async () => {
    const request = deferred<number[]>();
    const pending = revalidateOwnerRetainedResource({ scope, resource: "finance-period", loader: () => request.promise });
    clearOwnerRetainedResources();
    activateOwnerRetainedScope(scope);
    request.resolve([999]);
    await expect(pending).rejects.toThrow("scope changed");
    expect(read("finance-period")).toBeNull();
  });

  it("auth-user change rejects old in-flight completion authority", async () => {
    const request = deferred<number[]>();
    const pending = revalidateOwnerRetainedResource({ scope, resource: "menu-uploads", loader: () => request.promise });
    activateOwnerRetainedScope(otherUser);
    request.resolve([999]);
    await expect(pending).rejects.toThrow("scope changed");
    expect(read("menu-uploads", "", otherUser)).toBeNull();
    activateOwnerRetainedScope(scope);
    expect(read("menu-uploads")).toBeNull();
  });

  it("refreshes mutation results after a pre-mutation request finishes", async () => {
    const request = deferred<number[]>();
    const first = revalidateOwnerRetainedResource({ scope, resource: "menu-uploads", loader: () => request.promise });
    const mutationLoader = vi.fn(async () => [2]);
    const refresh = revalidateOwnerRetainedResource({ scope, resource: "menu-uploads", loader: mutationLoader, afterPending: true });
    await Promise.resolve();
    expect(mutationLoader).not.toHaveBeenCalled();
    request.resolve([1]);
    await first;
    await refresh;
    expect(mutationLoader).toHaveBeenCalledTimes(1);
    expect(read<number[]>("menu-uploads")?.value).toEqual([2]);
  });

  it("does not restart abandoned queued refreshes after the same scope returns", async () => {
    const request = deferred<number[]>();
    const pending = revalidateOwnerRetainedResource({ scope, resource: "menu-uploads", loader: () => request.promise });
    const queuedLoader = vi.fn(async () => [999]);
    const queued = revalidateOwnerRetainedResource({ scope, resource: "menu-uploads", loader: queuedLoader, afterPending: true });
    clearOwnerRetainedResources();
    activateOwnerRetainedScope(scope);
    request.resolve([1]);
    await expect(pending).rejects.toThrow("scope changed");
    await expect(queued).rejects.toThrow("scope changed");
    expect(queuedLoader).not.toHaveBeenCalled();
    expect(read("menu-uploads")).toBeNull();
  });

  it("rejects abandoned tenant requests without reactivating their scope", async () => {
    activateOwnerRetainedScope(otherTenant);
    const loader = vi.fn(async () => [4]);
    await expect(revalidateOwnerRetainedResource({ scope, resource: "table-stats", loader })).rejects.toThrow("scope changed");
    expect(loader).not.toHaveBeenCalled();
  });

  it.each([401, 403])("clears retained data on explicit access loss %s", async (status) => {
    await revalidateOwnerRetainedResource({ scope, resource: "table-stats", loader: async () => [4] });
    expect(() => assertOwnerRetainedRequestAccess(status)).toThrow("Owner access is unavailable");
    expect(read("table-stats")).toBeNull();
    activateOwnerRetainedScope(scope);
    expect(read("table-stats")).toBeNull();
  });

  it("does not treat an ordinary server refresh failure as access loss", async () => {
    await revalidateOwnerRetainedResource({ scope, resource: "table-stats", loader: async () => [4] });
    expect(() => assertOwnerRetainedRequestAccess(500)).not.toThrow();
    expect(read<number[]>("table-stats")?.value).toEqual([4]);
  });

  it("expires retained values instead of keeping indefinite stale reuse", async () => {
    await revalidateOwnerRetainedResource({ scope, resource: "finance-period", loader: async () => [4] });
    vi.advanceTimersByTime(120_001);
    expect(read("finance-period")).toBeNull();
  });

  it("distinguishes confirmed empty/zero from unloaded and failed", async () => {
    expect(read("table-stats")).toBeNull();
    await revalidateOwnerRetainedResource({ scope, resource: "table-stats", loader: async () => ({ table: { orders_today: 0 } }) });
    expect(read<{ table: { orders_today: number } }>("table-stats")?.value.table.orders_today).toBe(0);
    await revalidateOwnerRetainedResource({ scope, resource: "finance-period", loader: async () => [] });
    expect(read<number[]>("finance-period")?.value).toEqual([]);
  });

  it("keeps canonical occupancy responsive independently of retained stats", async () => {
    await revalidateOwnerRetainedResource({ scope, resource: "table-stats", loader: async () => ({ orders_today: 4 }) });
    const session = { restaurant_id: scope.restaurantId, table_id: "table-a", status: "served", dining_session_status: "open", table_released_at: null };
    expect(getOccupiedOwnerTableIds([session], scope.restaurantId).has("table-a")).toBe(true);
    expect(getOccupiedOwnerTableIds([{ ...session, table_released_at: "now" }], scope.restaurantId).has("table-a")).toBe(false);
    expect(read("table-stats")).not.toBeNull();
  });
});

describe("P1B workspace integration contracts", () => {
  it("uses retained resources in all three workspaces without caching parent menu/occupancy", () => {
    expect(page).toContain('resource: "table-stats"');
    expect(page).toContain('resource: "finance-period"');
    expect(page).toContain('resource: "menu-uploads"');
    expect(page).toContain("getOccupiedOwnerTableIds(orders, restaurantId)");
    expect(page).toContain("items={menuItems}");
    expect(service).not.toContain('"menu-items"');
    expect(service).not.toContain('"occupancy"');
  });

  it("hides unconfirmed Tables numbers and Finance charts rather than false zeros", () => {
    expect(page).toContain("qrStats === null");
    expect(page).toContain('ordersToday ?? "—"');
    expect(page).toContain("financeDataAvailable ? <>");
    expect(page).toContain('"Financial data is unavailable."');
  });

  it("keeps prior uploads and exposes loading/refresh failure truthfully", () => {
    expect(page).toContain("retainedMenuUploads?.value ?? []");
    expect(page).toContain("!menuUploadsAvailable");
    expect(page).toContain("Menu files could not be refreshed.");
  });

  it("binds displayed access to current user/restaurant and clears on logout/access loss", () => {
    expect(route).toContain("accessState.userId !== authSession.userId");
    expect(route).toContain("accessState.requestedRestaurantId !== restaurantId");
    expect(route).toContain("clearOwnerRetainedResources()");
    expect(page).toContain("async function handleSignOut() {\n    clearOwnerRetainedResources()");
  });

  it("does not eagerly generate every Tables preview QR on mount", () => {
    const start = page.indexOf("function QrTablesPage");
    const tables = page.slice(start, page.indexOf("function SettingsPage", start));
    expect(tables).not.toContain("async function generateQrCodes()");
    expect(tables).toContain("if (!previewTable || !previewUrl)");
  });

  it("preserves only the small Finance selection in the existing parent", () => {
    expect(page).toContain("selection={financeSelection}");
    expect(page).toContain("onSelectionChanged={setFinanceSelection}");
    expect(page).toContain("const { period, customStart, customEnd } = selection");
  });

  it("revalidates authoritative dependency changes after an older pending read", () => {
    expect(page).toContain("afterPending: paymentsChanged");
    expect(page).toContain("afterPending: tablesChanged || sessionsChanged");
  });

  it("uses bounded policies and no persistent storage or external cache library", () => {
    expect(OWNER_RETAINED_POLICY.financePeriod.retainForMs).toBeLessThanOrEqual(120_000);
    expect(OWNER_RETAINED_POLICY.tableStats.retainForMs).toBeLessThanOrEqual(120_000);
    expect(service).not.toMatch(/localStorage|sessionStorage|indexedDB|TanStack|Redux|SWR/);
  });
});

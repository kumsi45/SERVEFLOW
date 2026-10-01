import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  activateOwnerRetainedScope,
  clearOwnerRetainedResources,
  readOwnerRetainedResource,
  revalidateOwnerRetainedResource,
} from "../../src/modules/owner/services/ownerRetainedResources";

const page = readFileSync("src/modules/owner/pages/OwnerReportsPage.tsx", "utf8");
const menu = readFileSync("src/modules/owner/pages/OwnerMenuSalesReport.tsx", "utf8");

describe("Owner Reports loading performance", () => {
  it("loads only the main read model on Overview entry", () => {
    expect(page).not.toContain('activeTab==="overview"){if(!inventory)');
    expect(page).not.toMatch(/activeTab==="overview"[\s\S]{0,160}loadDetail\("(?:inventory|cashier)"\)/);
    expect(page).toContain('resource:"reports-overview"');
  });

  it("keys retained menu results by auth, restaurant and exact period dimensions", async () => {
    clearOwnerRetainedResources();
    const scope = { userId: "owner-a", restaurantId: "restaurant-a" };
    activateOwnerRetainedScope(scope);
    let calls = 0;
    const load = (dimensions: string) => revalidateOwnerRetainedResource({ scope, resource: "reports-menu", dimensions, loader: async () => ({ dimensions, call: ++calls }) });
    await Promise.all([load('["month",null,null]'), load('["month",null,null]')]);
    expect(calls).toBe(1);
    await load('["today",null,null]');
    expect(calls).toBe(2);
    expect(readOwnerRetainedResource<{dimensions:string}>({ scope, resource: "reports-menu", dimensions: '["month",null,null]', freshForMs: 15_000, retainForMs: 120_000 })?.value.dimensions).toContain("month");
    activateOwnerRetainedScope({ userId: "owner-b", restaurantId: "restaurant-b" });
    expect(readOwnerRetainedResource({ scope, resource: "reports-menu", dimensions: '["month",null,null]', freshForMs: 15_000, retainForMs: 120_000 })).toBeNull();
  });

  it("forces explicit refresh while retaining prior report content", () => {
    expect(page).toContain('afterPending:kind==="refresh"');
    expect(page).toContain('force&&retained?setDetailRefreshing(tab):setDetailLoading(tab)');
    expect(page).toContain('The latest detail refresh failed. Showing previously loaded data.');
    expect(menu).toContain('afterPending: force');
  });

  it("deduplicates detail requests per exact owner scope without invalidating safe rapid-tab results", () => {
    expect(page).toContain('detailRequestScope=`${ownerUserId}:${restaurantId}:${mainDimensions}`');
    expect(page).toContain("busy.current.has(busyKey)");
    expect(page).toContain("const request=detailGeneration.current");
    expect(page).not.toContain("busy.current.clear()");
    expect(page).toContain("mainGeneration.current++;const cached=");
  });

  it("bounds menu DOM rows without changing the complete RPC contract", () => {
    expect(menu).toContain("slice(0, soldLimit)");
    expect(menu).toContain("limit + 50");
    expect(menu).not.toContain("get_owner_menu_sales_report");
  });
});

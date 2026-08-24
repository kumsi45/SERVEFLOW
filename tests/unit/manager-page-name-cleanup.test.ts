import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ManagerInventoryWorkspacePage } from "../../src/modules/manager/pages/ManagerInventoryWorkspacePage";
import { ManagerOperationalReportsPage } from "../../src/modules/manager/pages/ManagerOperationalReportsPage";
import { ManagerRecipeWorkspacePage } from "../../src/modules/manager/pages/ManagerRecipeWorkspacePage";
import { ManagerRestaurantIntelligencePage } from "../../src/modules/manager/pages/ManagerRestaurantIntelligencePage";
import { ManagerStaffOperationsPage } from "../../src/modules/manager/pages/ManagerStaffOperationsPage";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = (name: string) => read(`src/modules/manager/pages/${name}.tsx`);

describe("Manager page-name repetition cleanup", () => {
  const renderedPages: Array<{
    name: string;
    component: ComponentType<any>;
    props: Record<string, unknown>;
    firstUseful: string;
    obsoleteWrapper?: string;
  }> = [
    { name: "Staff", component: ManagerStaffOperationsPage, props: { restaurantId: "restaurant-1" }, firstUseful: '<div class="mso-workspace-bar"><nav class="mso-tabs"', obsoleteWrapper: "mso-page-header" },
    { name: "Reports", component: ManagerOperationalReportsPage, props: { restaurantId: "restaurant-1", restaurantName: "Grand Royal", managerName: "Manager" }, firstUseful: '<section class="mor-period"', obsoleteWrapper: "mor-header" },
    { name: "Business Intelligence", component: ManagerRestaurantIntelligencePage, props: { restaurantId: "restaurant-1" }, firstUseful: '<section class="mri-toolbar"' },
    { name: "Recipes", component: ManagerRecipeWorkspacePage, props: { restaurantId: "restaurant-1" }, firstUseful: '<div class="mrw-summary-row"><section class="mrw-summary"', obsoleteWrapper: "mrw-header" },
    { name: "Inventory", component: ManagerInventoryWorkspacePage, props: { restaurantId: "restaurant-1" }, firstUseful: '<div class="miw-actions"><button', obsoleteWrapper: "miw-header" },
  ];

  it.each(renderedPages)("removes the $name heading and obsolete wrapper from rendered DOM", ({ component, props, firstUseful, obsoleteWrapper }) => {
    const html = renderToStaticMarkup(createElement(component, props));
    expect(html).not.toMatch(/<h1(?:\s[^>]*)?>/);
    expect(html).toContain(firstUseful);
    if (obsoleteWrapper) expect(html).not.toContain(`class="${obsoleteWrapper}"`);
  });

  it("removes redundant top-level eyebrow and heading pairs", () => {
    expect(page("ManagerDashboardPage")).not.toMatch(/<span>Live operations<\/span>|<span>Prioritized queue<\/span>|<span>Live floor signals<\/span>/);
    expect(page("ManagerOperationsCenterPage")).not.toMatch(/<span>(Exceptions first|Live drawers|Operational history|Intervention queue|Command center|Current workload|Live context)<\/span>/);
    expect(page("ManagerKitchenSupervisionPage")).not.toMatch(/<span>(Intervention queue|Active production context|Supervision queue|Current station comparison)<\/span>/);
    expect(page("ManagerKitchenSupervisionPage")).not.toContain(
      '<header><div><span>Current workload</span><h2 id="mks-stations-title">',
    );
    expect(page("ManagerStaffOperationsPage")).not.toMatch(/<p>(Current workforce|People and access|Current status)<\/p>/);
    expect(page("ManagerRecipeWorkspacePage")).not.toMatch(/<span>(Exceptions|Recipe source of truth)<\/span>/);
    expect(page("ManagerMenuWorkspacePage")).not.toMatch(/<span>(Operational menu|Customer state|Menu items|Menu organization|Customer menu preview)<\/span>/);
    expect(page("ManagerInventoryWorkspacePage")).not.toMatch(/<span>(Exceptions|Operational requests|Current stock levels)<\/span>/);
  });

  it("keeps meaningful work headings and performance hardening", () => {
    const combined = [
      "ManagerDashboardPage", "ManagerOperationsCenterPage", "ManagerKitchenSupervisionPage",
      "ManagerStaffOperationsPage", "ManagerCustomerExperiencePage", "ManagerOperationalReportsPage",
      "ManagerRestaurantIntelligencePage", "ManagerRecipeWorkspacePage", "ManagerMenuWorkspacePage",
      "ManagerInventoryWorkspacePage",
    ].map(page).join("\n");
    for (const heading of ["Shift Pulse", "Needs Attention", "Live Service", "Stations", "Live Staff", "Recent Activity", "Stock Health"]) {
      expect(combined).toContain(heading);
    }
    expect(combined).toContain("skipInitialConnectRefresh: true");
    expect(read("src/modules/manager/services/managerRecipeWorkspaceService.ts")).toContain("fetchRecipeIngredientsForRecipes");
    expect(read("src/modules/manager/services/managerDataCache.ts")).toContain("cacheKey(restaurantId, resource)");
  });
});

import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const css = (name: string) => readFileSync(resolve(process.cwd(), `src/modules/manager/styles/${name}.css`), "utf8");
const globalCss = readFileSync(resolve(process.cwd(), "src/styles/global.css"), "utf8");
const brandCss = readFileSync(resolve(process.cwd(), "src/core/presentation/serveFlowBrand.css"), "utf8");
const layoutCss = css("managerLayout");
const copilotCss = css("managerCopilot");

const pages: Array<{
  name: string;
  section: string;
  modulePath: string;
  exportName: string;
  props: Record<string, unknown>;
  stylesheet: string;
  firstUseful: string;
  obsoleteWrapper?: string;
}> = [
  { name: "Dashboard", section: "dashboard", modulePath: "/src/modules/manager/pages/ManagerDashboardPage.tsx", exportName: "ManagerDashboardPage", props: {}, stylesheet: "managerDashboard", firstUseful: ".md-pulse" },
  { name: "Live Operations", section: "tables", modulePath: "/src/modules/manager/pages/ManagerOperationsCenterPage.tsx", exportName: "ManagerOperationsCenterPage", props: {}, stylesheet: "managerOperationsCenter", firstUseful: ".moc-message" },
  { name: "Kitchen", section: "kitchen", modulePath: "/src/modules/manager/pages/ManagerKitchenSupervisionPage.tsx", exportName: "ManagerKitchenSupervisionPage", props: {}, stylesheet: "managerKitchenSupervision", firstUseful: ".mks-message" },
  { name: "Staff", section: "staff", modulePath: "/src/modules/manager/pages/ManagerStaffOperationsPage.tsx", exportName: "ManagerStaffOperationsPage", props: {}, stylesheet: "managerStaffOperations", firstUseful: ".mso-workspace-bar", obsoleteWrapper: ".mso-page-header" },
  { name: "Guests", section: "customers", modulePath: "/src/modules/manager/pages/ManagerCustomerExperiencePage.tsx", exportName: "ManagerCustomerExperiencePage", props: {}, stylesheet: "managerCustomerExperience", firstUseful: ".mcx-tabs" },
  { name: "Reports", section: "reports", modulePath: "/src/modules/manager/pages/ManagerOperationalReportsPage.tsx", exportName: "ManagerOperationalReportsPage", props: {}, stylesheet: "managerOperationalReports", firstUseful: ".mor-period", obsoleteWrapper: ".mor-header" },
  { name: "Business Intelligence", section: "intelligence", modulePath: "/src/modules/manager/pages/ManagerRestaurantIntelligencePage.tsx", exportName: "ManagerRestaurantIntelligencePage", props: {}, stylesheet: "managerRestaurantIntelligence", firstUseful: ".mri-toolbar" },
  { name: "Recipes", section: "recipes", modulePath: "/src/modules/manager/pages/ManagerRecipeWorkspacePage.tsx", exportName: "ManagerRecipeWorkspacePage", props: {}, stylesheet: "managerRecipeWorkspace", firstUseful: ".mrw-summary-row", obsoleteWrapper: ".mrw-header" },
  { name: "Menu", section: "menu", modulePath: "/src/modules/manager/pages/ManagerMenuWorkspacePage.tsx", exportName: "ManagerMenuWorkspacePage", props: {}, stylesheet: "managerMenuWorkspace", firstUseful: ".mmw-nav" },
  { name: "Inventory", section: "inventory", modulePath: "/src/modules/manager/pages/ManagerInventoryWorkspacePage.tsx", exportName: "ManagerInventoryWorkspacePage", props: {}, stylesheet: "managerInventoryWorkspace", firstUseful: ".miw-actions", obsoleteWrapper: ".miw-header" },
];

const mobileWidths = [360, 375, 390, 412, 430];

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

function renderedPage(entry: (typeof pages)[number], ManagerLayout: ComponentType<any>, PageComponent: ComponentType<any>) {
  const shared = { restaurantId: "restaurant-1", restaurantName: "grand royal", managerName: "Test Manager" };
  const page = createElement(PageComponent, { ...shared, ...entry.props });
  return renderToStaticMarkup(createElement(ManagerLayout, { ...shared, section: entry.section, children: page }));
}

async function assertCompactPage(page: import("@playwright/test").Page, entry: (typeof pages)[number]) {
  const content = page.locator(".ml-content");
  const useful = content.locator(entry.firstUseful);
  await expect(content.locator("h1")).toHaveCount(0);
  await expect(useful).toBeVisible();
  if (entry.obsoleteWrapper) await expect(content.locator(entry.obsoleteWrapper)).toHaveCount(0);
  await expect(page.getByText("grand royal", { exact: true })).toHaveCount(1);

  const [contentBox, usefulBox] = await Promise.all([content.boundingBox(), useful.boundingBox()]);
  expect(contentBox).not.toBeNull();
  expect(usefulBox).not.toBeNull();
  expect(usefulBox!.y - contentBox!.y).toBeLessThanOrEqual(48);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("reported Manager routes remove title DOM and begin with useful controls", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  Object.defineProperty(globalThis, "sessionStorage", { value: memoryStorage(), configurable: true });
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
  try {
    const layoutModule = await vite.ssrLoadModule("/src/modules/manager/components/ManagerLayout.tsx");
    const ManagerLayout = layoutModule.ManagerLayout as ComponentType<any>;
    for (const entry of pages) {
      const pageModule = await vite.ssrLoadModule(entry.modulePath);
      const PageComponent = pageModule[entry.exportName] as ComponentType<any>;
      const html = renderedPage(entry, ManagerLayout, PageComponent);
      const styles = `${globalCss}\n${brandCss}\n${layoutCss}\n${copilotCss}\n${css(entry.stylesheet)}`;

      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.setContent(`<style>${styles}</style>${html}`);
      await assertCompactPage(page, entry);
      await page.screenshot({ path: testInfo.outputPath(`${entry.section}-1440.png`), fullPage: true });

      for (const width of mobileWidths) {
        await page.setViewportSize({ width, height: 900 });
        await assertCompactPage(page, entry);
        if (width === 390) await page.screenshot({ path: testInfo.outputPath(`${entry.section}-390.png`), fullPage: true });
      }
    }
  } finally {
    await vite.close();
    delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
  }
});

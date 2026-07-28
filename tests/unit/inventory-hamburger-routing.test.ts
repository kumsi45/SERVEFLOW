import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const router = readFileSync("src/app/router/AppRouter.tsx", "utf8");
const page = readFileSync("src/modules/inventory/pages/InventoryDashboardPage.tsx", "utf8");
const types = readFileSync("src/modules/inventory/types.ts", "utf8");

describe("inventory hamburger routing", () => {
  const menu = page.slice(page.indexOf("const MOBILE_MENU_NAV"), page.indexOf("const MOBILE_PRIMARY_NAV"));

  it("maps every hamburger entry to a real inventory section", () => {
    for (const section of ["inventory-reports", "suppliers", "items", "inventory-settings", "export", "help"]) {
      expect(menu).toContain(`section: "${section}"`);
      expect(types).toContain(`| "${section}"`);
      expect(router).toContain(`"${section}"`);
    }
    expect(page).toContain("onClick={() => navigate(item.section)}");
  });

  it("allows every inventory report URL through the application router", () => {
    for (const section of ["inventory-reports", "inventory-value", "consumption", "waste-report", "movement-history", "purchase-history"]) {
      expect(router).toContain(`"${section}"`);
    }
  });

  it("renders URL-backed reports, settings, export, and help pages", () => {
    expect(page).toContain('section === "inventory-reports"');
    expect(page).toContain('section === "inventory-settings"');
    expect(page).toContain('section === "export"');
    expect(page).toContain('section === "help"');
    expect(page).toContain("Inventory Reports</h2>");
  });
});

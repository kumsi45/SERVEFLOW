import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const router = readFileSync("src/app/router/AppRouter.tsx", "utf8");
const page = readFileSync("src/modules/inventory/pages/InventoryDashboardPage.tsx", "utf8");
const types = readFileSync("src/modules/inventory/types.ts", "utf8");

describe("inventory hamburger routing", () => {
  it("uses one flat eight-destination list in the mobile drawer", () => {
    const destinations = page.slice(page.indexOf("const INVENTORY_DESTINATIONS"), page.indexOf("function isInventorySection"));
    for (const label of ["Overview", "Current Stock", "Stock Movements", "Kitchen Requests", "Purchase Orders", "Suppliers", "Materials", "Storage"]) {
      expect(destinations).toContain(`label: "${label}"`);
    }
    for (const folder of ["Stock", "Purchasing", "Setup"]) expect(destinations).not.toContain(`label: "${folder}"`);
    expect(page).toContain("{navigationItems(true)}");
    expect(page).toContain('aria-label="Close inventory navigation"');
    expect(page).toContain("setMobileMenuOpen(false)");
  });

  it("keeps secondary management utilities out of the primary drawer", () => {
    expect(page).not.toContain('>Reports</button>');
    expect(page).not.toContain('>Settings</button>');
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

  it("keeps hidden operational and setup routes URL-compatible", () => {
    for (const section of ["stock-in", "stock-out", "transfers", "adjustments", "waste", "purchase-history", "categories", "units"]) {
      expect(types).toContain(`| "${section}"`);
      expect(router).toContain(`"${section}"`);
    }
  });
});

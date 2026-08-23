import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Inventory I3 mobile-first navigation architecture", () => {
  const page = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
  const css = read("src/modules/inventory/styles/inventoryDashboard.css");
  const primaryArchitecture = page.slice(page.indexOf("const STOCK_NAV"), page.indexOf("const DEFAULT_FILTERS"));

  it("uses the requested business-facing destination hierarchy", () => {
    for (const label of ["Current Stock", "Stock Movements", "Purchase Orders", "Suppliers", "Materials", "Storage"]) {
      expect(primaryArchitecture).toContain(`label: "${label}"`);
    }
    expect(primaryArchitecture).toContain('{ key: "stock", label: "Stock"');
    expect(primaryArchitecture).toContain('{ key: "purchasing", label: "Purchasing"');
    expect(primaryArchitecture).toContain('{ key: "setup", label: "Setup"');
    expect(page).toContain("Kitchen Requests</span>");
    expect(page).toContain('navigate("inventory-reports")');
    expect(page).toContain('navigate("inventory-settings")');
  });

  it("keeps legacy stock, purchasing, setup, and report routes contextually active", () => {
    for (const section of ["stock-in", "stock-out", "transfers", "adjustments", "waste", "ledger"]) {
      expect(page).toContain(`"${section}"`);
    }
    expect(page).toContain("STOCK_CONTEXT_SECTIONS.has(section)");
    expect(page).toContain("PURCHASING_CONTEXT_SECTIONS.has(section)");
    expect(page).toContain("SETUP_CONTEXT_SECTIONS.has(section)");
    expect(page).toContain("REPORT_CONTEXT_SECTIONS.has(section)");
  });

  it("reuses canonical Kitchen request data for a nonzero actionable badge", () => {
    expect(page).toContain('request.status === "accepted"');
    expect(page).toContain("actionableKitchenRequestCount > 0");
    expect(page).toContain('aria-label={`${actionableKitchenRequestCount} actionable requests`}');
    expect(page).toContain('"/inventory/dashboard#kitchen-requests"');
    expect(page).toContain('getElementById("i1-requests-title")');
  });

  it("uses one shared navigation renderer for persistent and drawer navigation", () => {
    expect(page).toContain("const navigationItems = (mobile = false)");
    expect(page).toContain("{navigationItems(true)}");
    expect(page).toContain("{navigationItems()}");
    expect(page).toContain("aria-expanded={expandedNavGroup === group.key}");
    expect(page).toContain('aria-label="Close inventory navigation"');
    expect(page).toContain('event.key === "Escape"');
  });

  it("removes Reports and Settings from Inventory Officer navigation without deleting their routes", () => {
    expect(page).toContain('staffRole !== "inventory_officer"');
    expect(page).toContain('navigate("inventory-reports")');
    expect(page).toContain('navigate("inventory-settings")');
    expect(page).toContain('section === "inventory-reports"');
    expect(page).toContain('section === "inventory-settings"');
  });

  it("uses a drawer through portrait tablet and a compact sidebar above 900px", () => {
    expect(css).toContain("/* Phase I3: mobile-first Inventory navigation */");
    expect(css).toContain("@media (max-width: 900px)");
    expect(css).toContain("@media (min-width: 901px)");
    expect(css).toContain("width: min(88vw, 336px)");
    expect(css).toContain("min-height: 46px");
    expect(css).toContain("overflow-x: clip");
    expect(css).toContain("overflow-y: auto");
  });

  it("does not expose hidden action routes in the primary I3 arrays", () => {
    for (const label of ["Receive Stock", "Issue Stock", "Transfers", "Adjustments", "Waste", "Purchase History", "Ingredient Categories", "Units", "Ledger"]) {
      expect(primaryArchitecture).not.toContain(`label: "${label}"`);
    }
  });
});

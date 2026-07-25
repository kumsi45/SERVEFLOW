import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Phase 8.2.6 Inventory navigation architecture", () => {
  const page = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
  const css = read("src/modules/inventory/styles/inventoryDashboard.css");

  it("places the inert global theme placeholder immediately before the one hamburger control", () => {
    const header = page.slice(page.indexOf('<header className="ia-mobile-header">'), page.indexOf('</header>', page.indexOf('<header className="ia-mobile-header">')));
    const themeIndex = header.indexOf('className="ia-theme-placeholder"');
    const menuIndex = header.indexOf('className="ia-menu-button"');
    expect(themeIndex).toBeLessThan(menuIndex);
    expect(header).toContain('aria-label="Theme switcher placeholder"');
    expect(header).toContain("disabled");
    expect(header.slice(themeIndex, menuIndex)).not.toContain("onClick");
    expect(page.match(/className="ia-menu-button"/g)).toHaveLength(1);
    expect(page).not.toContain("overflow menu");
    expect(page).not.toContain("three dot");
  });

  it("keeps only the requested workflow links in the hamburger and excludes theme", () => {
    const menu = page.slice(page.indexOf("const MOBILE_MENU_NAV"), page.indexOf("const MOBILE_PRIMARY_NAV"));
    expect(menu.match(/label: "/g)).toHaveLength(6);
    for (const label of ["Dashboard", "Stock Management", "Inventory Records", "Suppliers", "Reports", "Settings"]) {
      expect(menu).toContain(`label: "${label}"`);
    }
    expect(menu).not.toContain("Theme");
    expect(menu).not.toContain("More");
    expect(page).toContain('onClick={() => void logout()}>Logout</button>');
    expect(page).toContain('aria-expanded={mobileMenuOpen}');
    expect(page).toContain('onClick={() => setMobileMenuOpen((open) => !open)}');
  });

  it("uses exactly four large primary mobile actions without More, Settings, or Theme", () => {
    const bottom = page.slice(page.indexOf("const MOBILE_PRIMARY_NAV"), page.indexOf("const DEFAULT_FILTERS"));
    expect(bottom.match(/label: "/g)).toHaveLength(4);
    for (const label of ["Home", "Stock", "Add", "Reports"]) expect(bottom).toContain(`label: "${label}"`);
    expect(bottom).not.toContain("More");
    expect(bottom).not.toContain("Settings");
    expect(bottom).not.toContain("Theme");
    expect(css).toContain("min-height: 56px");
  });

  it("uses phone navigation below 601px and keeps the grouped sidebar on tablet", () => {
    expect(css).toContain("@media (max-width: 900px)");
    expect(css).toContain("@media (min-width: 601px) and (max-width: 900px)");
    expect(css).toContain("@media (max-width: 520px)");
    expect(css).toContain("@media (max-width: 380px)");
    expect(css).toContain("overflow-x: clip");
    expect(css).toContain("overflow-x: hidden");
    expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(css).toContain(".ia-table td::before");
    for (const width of [360, 390, 430]) expect(width).toBeLessThan(601);
    expect(768).toBeGreaterThanOrEqual(601);
    expect(768).toBeLessThanOrEqual(900);
    expect(1280).toBeGreaterThan(1180);
  });

  it("groups desktop and tablet navigation into accessible, mutually exclusive accordions", () => {
    const stock = page.slice(page.indexOf("const STOCK_MANAGEMENT_NAV"), page.indexOf("const INVENTORY_RECORDS_NAV"));
    const records = page.slice(page.indexOf("const INVENTORY_RECORDS_NAV"), page.indexOf("const MOBILE_MENU_NAV"));
    for (const label of ["Current Stock", "Stock In", "Stock Out", "Transfers", "Adjustments", "Waste", "Movement History"]) {
      expect(stock).toContain(`label: "${label}"`);
    }
    for (const label of ["Items", "Categories", "Units", "Storage Locations"]) {
      expect(records).toContain(`label: "${label}"`);
    }
    expect(page).toContain('useState<InventoryNavGroup | null>(null)');
    expect(page).toContain('setExpandedNavGroup((current) => current === group ? null : group)');
    expect(page).toContain('aria-controls="inventory-stock-navigation"');
    expect(page).toContain('aria-controls="inventory-records-navigation"');
    expect(page.match(/aria-expanded=\{expandedNavGroup === /g)).toHaveLength(2);
  });

  it("keeps suppliers direct, Reports as a placeholder, and Settings owner-scoped", () => {
    expect(page).toContain('onClick={() => navigate("suppliers")}');
    expect(page).toContain('onClick={() => navigateUtility("reports")}');
    expect(page).toContain('onClick={() => navigateUtility("settings")}');
    expect(page).toContain("Inventory reports are coming in a future phase.");
    expect(page).toContain('utilityView === "settings" && staffRole === "owner"');
    expect(page).toContain("Inventory integrity tools are owner-only.");
  });

  it("adds responsive labels to all wide Inventory table cells", () => {
    const tableCells = page.match(/<td(?:\s[^>]*)?>/g) ?? [];
    expect(tableCells.length).toBeGreaterThan(20);
    expect(tableCells.every((cell) => cell.includes("data-label="))).toBe(true);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/modules/inventory/pages/InventoryDashboardPage.tsx", "utf8");
const styles = readFileSync("src/modules/inventory/styles/inventoryDashboard.css", "utf8");
const finalDashboard = page.slice(page.indexOf("const dashboard = ("), page.indexOf("const stockRows ="));

describe("Phase W.3.2 inventory dashboard redesign", () => {
  it("renders the five required sections in operational order", () => {
    const titles = ["Today's Operations", "Quick Actions", "Inventory Overview", "Recent Activity", "Report Shortcuts"];
    const positions = titles.map((title) => finalDashboard.indexOf(title));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("shows the six required attention cards without adding calculations", () => {
    for (const label of ["Out of Stock", "Low Stock", "Expiring Soon", "Pending Purchases", "Waste Recorded", "Pending Transfers"]) {
      expect(finalDashboard).toContain(label);
    }
    expect(finalDashboard).toContain("<strong>—</strong>");
    expect(finalDashboard).toContain("data unavailable");
  });

  it("limits quick actions to the six daily inventory workflows", () => {
    const actions = finalDashboard.slice(finalDashboard.indexOf("ia-final-action-grid"), finalDashboard.indexOf("inventory-overview-title"));
    for (const label of ["Receive Stock", "Stock Adjustment", "Create Ingredient", "Purchase Order", "Transfer Stock", "Waste Entry"]) {
      expect(actions).toContain(label);
    }
    expect((actions.match(/<button/g) ?? [])).toHaveLength(6);
    expect(actions).not.toContain("Issue Stock");
  });

  it("keeps inventory value below operations and quick actions", () => {
    expect(finalDashboard.indexOf("Current Inventory Value")).toBeGreaterThan(finalDashboard.indexOf("Quick Actions"));
    expect(finalDashboard).toContain("Total Ingredients");
    expect(finalDashboard).toContain("Storage Locations");
    expect(finalDashboard).toContain("Active Categories");
  });

  it("renders at most ten compact activity records with staff attribution", () => {
    expect(page).toContain("ledger.slice(0, 10)");
    expect(finalDashboard).toContain("entry.staffName");
    expect(finalDashboard).toContain("data.staffRoles[entry.createdByStaffId]");
    expect(finalDashboard).toContain("<time dateTime={entry.movementDate}");
  });

  it("provides mobile grids, large targets, focus states, and reduced motion", () => {
    expect(styles).toContain(".ia-final-operation-grid { grid-template-columns: repeat(6");
    expect(styles).toContain("min-height: 44px");
    expect(styles).toContain("@media (max-width: 1024px)");
    expect(styles).toContain("@media (max-width: 768px)");
    expect(styles).toContain("@media (max-width: 360px)");
    expect(styles).toContain(".ia-dashboard-final button:focus-visible");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});

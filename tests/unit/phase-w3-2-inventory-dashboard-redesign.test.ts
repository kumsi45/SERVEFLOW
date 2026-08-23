import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
const dashboard = read("src/modules/inventory/components/InventoryOperationalDashboard.tsx");
const styles = read("src/modules/inventory/styles/inventoryDashboard.css");

describe("Inventory Phase I1 operational dashboard supersession", () => {
  it("renders the five operational sections in priority order", () => {
    const titles = ["Needs Attention", "Kitchen Requests", "Quick Operations", "Stock Snapshot", "Recent Activity"];
    const positions = titles.map((title) => dashboard.indexOf(title));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("shows only real actionable attention sources and a calm zero state", () => {
    for (const label of ["Kitchen Requests", "Awaiting Kitchen Confirmation", "Out of Stock", "Low Stock", "Pending Purchases"]) expect(dashboard).toContain(label);
    expect(dashboard).not.toContain("Expiring Soon");
    expect(dashboard).not.toContain("Pending Transfers");
    expect(dashboard).toContain("Everything is under control");
  });

  it("keeps quick operations to established shift workflows", () => {
    for (const label of ["Receive Stock", "Stock Out / Issue Stock", "Adjustment", "Transfer", "Waste", "Purchase Order"]) expect(dashboard).toContain(label);
    expect(dashboard).not.toContain("Create Ingredient");
    expect(dashboard).not.toContain("Report Shortcuts");
  });

  it("keeps stock and activity compact and canonical", () => {
    expect(dashboard).toContain("Current Inventory Value");
    expect(dashboard).toContain("Active Ingredients");
    expect(dashboard).toContain("recentLedger.slice(0, 10)");
    expect(dashboard).toContain("entry.staffName");
    expect(dashboard).toContain("staffRoles[entry.createdByStaffId]");
    expect(page).toContain("calculateInventoryDashboardKpis");
  });

  it("provides responsive wrapping, mobile sheets, focus states, and reduced motion", () => {
    expect(styles).toContain(".ia-i1-attention-grid");
    expect(styles).toContain("@media (max-width: 1024px)");
    expect(styles).toContain("@media (max-width: 768px)");
    expect(styles).toContain("@media (max-width: 430px)");
    expect(styles).toContain("max-height: 100dvh");
    expect(styles).toContain(".ia-i1-dashboard button:focus-visible");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
const dashboard = read("src/modules/inventory/components/InventoryOperationalDashboard.tsx");
const styles = read("src/modules/inventory/styles/inventoryDashboard.css");

describe("Inventory Kitchen Requests supersedes the Phase I1 dashboard shell", () => {
  it("renders the request workflow sections", () => {
    const titles = ["Kitchen Requests", "Awaiting Inventory", "Awaiting Kitchen", "History"];
    const positions = titles.map((title) => dashboard.indexOf(title));
    expect(positions.every((position) => position >= 0)).toBe(true);
  });

  it("shows canonical request availability and calm queue zero states", () => {
    for (const label of ["Requested quantity", "Available in", "OUT OF STOCK", "Insufficient stock"]) expect(dashboard).toContain(label);
    expect(dashboard).toContain("No requests are awaiting Inventory.");
    for (const removed of ["Needs Attention", "Quick Operations", "Stock Snapshot", "Recent Activity"]) expect(dashboard).not.toContain(removed);
  });

  it("keeps only established request actions", () => {
    for (const label of ["Issue", "Cannot Fulfill", "Confirm Issue", "Confirm Cannot Fulfill"]) expect(dashboard).toContain(label);
    expect(dashboard).not.toContain("onNavigate");
  });

  it("keeps request stock and history compact and canonical", () => {
    expect(dashboard).toContain("request.currentQuantity");
    expect(dashboard).toContain("requestStorageLocations");
    expect(dashboard).toContain("sortInventoryRequestHistory");
    expect(dashboard).toContain("HISTORY_PAGE_SIZE");
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

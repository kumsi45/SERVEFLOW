import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/cashier/pages/CashierDashboardPage.tsx");
const ui = read("src/modules/cashier/components/CashierDashboardUi.tsx");
const styles = read("src/modules/cashier/styles/cashierDashboard.css");

describe("Phase 12.4 ServeFlow cashier POS master redesign", () => {
  it("keeps the compact cashier header complete and searchable", () => {
    for (const label of ["ServeFlow", "Shift Duration", "Terminal", "Notifications", "Close Shift", "Sign Out", "Ctrl K"]) {
      expect(ui).toContain(label);
    }
    expect(ui).toContain("Search service location, customer, invoice, order or phone");
    expect(page).toContain("handleWorkspaceSearch");
    expect(page).toContain('event.key.toLowerCase() === "k"');
    expect(styles).toContain("--cd-header-height: 70px");
  });

  it("uses the required fixed three-column desktop and laptop composition", () => {
    expect(styles).toContain("grid-template-columns: 14% 56% 30%");
    expect(styles).toContain("grid-template-columns: 15% 55% 30%");
    expect(page).toContain('className="cd-pos-nav"');
    expect(page).toContain('className="cd-body"');
    expect(page).toContain('className="cd-right-panel"');
    expect(styles).toContain("grid-column: 3; grid-row: 2");
  });

  it("limits the left panel to primary cashier navigation and five activities", () => {
    expect(page).toContain("New Order");
    expect(page).toContain("Cancellation Requests");
    expect(page).toContain("Live Activity");
    expect(page).toContain(".slice(0, 5)");
    expect(page).not.toContain('aria-label="Quick tools"');
    expect(page).not.toContain('name="calculator"');
    expect(page).not.toContain('name="notes"');
    expect(page).not.toContain('name="help"');
  });

  it("renders the five compact summaries and five instant queues", () => {
    for (const label of [
      "Active Orders", "Awaiting Collection", "Cash Collected Today",
      "Digital Collected Today", "Total Collected Today", "Payment Due",
      "Paid", "Bill Requested", "Receipt Pending", "Completed",
    ]) expect(page).toContain(label);
    expect(styles).toContain("grid-template-columns: repeat(5, minmax(0, 1fr))");
  });

  it("uses one table header and dense browser-virtualized order rows", () => {
    for (const label of ["Service Location", "Ordered Items", "Payment", "Total", "Waiting", "Status"]) {
      expect(page).toContain(`<span>${label}</span>`);
    }
    expect(page).toContain("getOrderItemPreview(allItems)");
    expect(page).toContain("itemPreview.hiddenCount");
    expect(page).toContain('queueTab === "pending" ? "Verify" : "Review"');
    expect(styles).toContain("content-visibility: auto");
    expect(styles).toContain("contain-intrinsic-size: 62px");
    expect(styles).toContain("overflow-y: auto");
  });

  it("keeps service-location switching above an independent checkout", () => {
    expect(page).toContain("Service Locations");
    expect(page).toContain("tables.slice(0, 4)");
    expect(page).toContain("tables.slice(4)");
    expect(page).toContain('aria-pressed={selectedTable === key}');
    expect(page).toContain('aria-label="Current checkout workspace"');
    expect(styles).toContain("grid-template-rows: minmax(190px, 28%) minmax(0, 72%)");
  });

  it("keeps checkout identity, item modifiers, totals, and actions visible", () => {
    for (const label of [
      "Assigned Waiter", "Customer", "Order Items", "Subtotal", "VAT",
      "Service Charge", "Discount", "Grand Total", "Verify Payment",
      "Print Bill", "Print Receipt", "Reject Payment", "Close Invoice",
    ]) expect(page).toContain(label);
    expect(page).toContain("item.notes");
    expect(styles).toContain(".cd-drawer-items { min-height: 0; flex: 1 1 auto; overflow-y: auto");
    expect(styles).toContain(".cd-drawer-footer { position: relative");
  });

  it("supports keyboard focus, reduced motion, tablet three-panel layout, and small-mobile stacking", () => {
    expect(styles).toContain("button:focus-visible");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("@media (max-width: 820px) and (min-width: 641px)");
    expect(styles).toContain("@media (max-width: 640px)");
    expect(styles).toContain("grid-template-columns: 1fr");
  });
});

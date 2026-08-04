import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/cashier/pages/CashierDashboardPage.tsx");
const ui = read("src/modules/cashier/components/CashierDashboardUi.tsx");
const styles = read("src/modules/cashier/styles/cashierDashboard.css");

describe("Phase 12.4 ServeFlow cashier POS master redesign", () => {
  it("keeps the compact cashier header complete and searchable", () => {
    for (const label of ["ServeFlow", "Shift Duration", "Notifications", "Close Shift", "Sign Out", "Ctrl K"]) {
      expect(ui).toContain(label);
    }
    expect(ui).not.toContain("Terminal");
    expect(ui).not.toContain('className="cd-cashier-avatar"');
    expect(ui).toContain("Search table, customer, invoice or phone...");
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

  it("renders the five compact summaries and four cashier-priority queues", () => {
    for (const label of [
      "Active Orders", "Awaiting Collection", "Cash Collected",
      "Digital Collected", "Total Collected", "Payment Due",
      "Bill Requested", "Receipt Pending", "Completed",
    ]) expect(page).toContain(label);
    expect(styles).toContain("grid-template-columns: 1fr 1.08fr 1.2fr .9fr");
  });

  it("uses dense browser-virtualized order rows without a redundant table header", () => {
    expect(page).not.toContain('className="cd-operational-table-header"');
    expect(page).toContain("summarizeOperationalItems(allItems)");
    expect(page).toContain("itemSummary.hiddenDistinctCount");
    expect(page).toContain("currentQueue.action");
    expect(styles).toContain("content-visibility: auto");
    expect(styles).toContain("contain-intrinsic-size: 68px");
    expect(styles).toContain("overflow-y: auto");
  });

  it("keeps service-location switching as the only permanent right-column content", () => {
    expect(page).toContain("ServiceLocationQuickSwitch");
    expect(page).toContain("locations={serviceLocationCards}");
    expect(page).toContain("onSelect={(location) => openTable(location.tableNumber)}");
    expect(page).toContain('<aside className="cd-right-panel" aria-label="Service locations">');
    expect(page).toContain("!loading && drawerOrder ? (");
    expect(page).toContain("<CheckoutSlideOverDrawer");
    expect(page).not.toContain('aria-label="Current checkout workspace"');
  });

  it("keeps checkout identity, item modifiers, totals, and actions visible", () => {
    for (const label of [
      "Waiter", "Customer", "Cashier", "Order Items", "Subtotal", "VAT",
      "Service Charge", "Discount", "Total", "Verify Payment",
      "Print Bill", "Print Receipt", "Reject Payment", "View Receipt",
    ]) expect(page).toContain(label);
    expect(page).toContain("item.notes");
    expect(styles).toContain(".cd-checkout-slide-over");
    expect(styles).toContain("position: fixed");
    expect(styles).toContain("width: clamp(500px, 42vw, 680px)");
    expect(styles).toContain(".cd-checkout-slide-over .cd-drawer-footer");
  });

  it("supports keyboard focus, reduced motion, tablet three-panel layout, and small-mobile stacking", () => {
    expect(styles).toContain("button:focus-visible");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("@media (max-width: 820px) and (min-width: 641px)");
    expect(styles).toContain("@media (max-width: 640px)");
    expect(styles).toContain("grid-template-columns: 1fr");
  });
});

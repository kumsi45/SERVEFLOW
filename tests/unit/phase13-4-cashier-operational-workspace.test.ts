import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const styles = read("src/modules/cashier/styles/cashierDashboard.css");
const page = read("src/modules/cashier/pages/CashierDashboardPage.tsx");
const phaseStyles = styles.slice(styles.indexOf("Phase 13.4C"));
const finalStyles = styles.slice(styles.indexOf("Phase 13.4D"));
const tabsMarkup = page.slice(
  page.indexOf('className="cd-tabs"'),
  page.indexOf('className="cd-order-list"'),
);

describe("Phase 13.4C simplified cashier operational workspace", () => {
  it("keeps the correction isolated from the other cashier panels", () => {
    expect(phaseStyles).toContain("simplified four-queue cashier workspace");
    expect(phaseStyles).not.toContain(".cd-header");
    expect(phaseStyles).not.toContain(".cd-pos-nav");
    expect(phaseStyles).not.toContain(".cd-kpi");
    expect(phaseStyles).not.toContain(".cd-location-switch");
    expect(phaseStyles).not.toContain(".cd-drawer");
  });

  it("renders exactly four visible queues in cashier-priority order", () => {
    const paymentDue = tabsMarkup.indexOf('"Payment Due"');
    const billRequested = tabsMarkup.indexOf('"Bill Requested"');
    const receiptPending = tabsMarkup.indexOf('"Receipt Pending"');
    const completed = tabsMarkup.indexOf('"Completed"');
    expect(paymentDue).toBeGreaterThan(-1);
    expect(paymentDue).toBeLessThan(billRequested);
    expect(billRequested).toBeLessThan(receiptPending);
    expect(receiptPending).toBeLessThan(completed);
    expect(tabsMarkup).not.toContain('"paid"');
    expect(tabsMarkup).not.toContain('>Paid<');
  });

  it("renders every badge from the same filtered queue view as its rows", () => {
    for (const queue of ["pending", "preparing", "ready", "completed"]) {
      expect(tabsMarkup).toContain(`operationalQueueView.counts.${queue}`);
    }
    expect(page).toContain("const operationalQueue = operationalQueueView.rows[visibleQueueTab]");
    expect(tabsMarkup).not.toContain("workflow?.payment_submitted_queue.length");
    expect(tabsMarkup).toContain('aria-label={`${count} ${label.toLowerCase()} ${count === 1 ? "order" : "orders"}`}');
  });

  it("retains the paid system state while removing its visible navigation", () => {
    expect(page).toContain('type QueueTab = "pending" | "paid" | "preparing" | "ready" | "completed"');
    expect(page).toContain('queueTab === "paid"');
    expect(page).toContain('order.invoiceStatus === "paid"');
    expect(page).toContain('queueTab === "paid" ? "completed" : queueTab');
    expect(tabsMarkup).not.toContain('setQueueTab("paid")');
  });

  it("uses compact four-column tabs without horizontal scrolling", () => {
    expect(finalStyles).toContain("grid-template-columns: minmax(0, .95fr) minmax(0, 1.06fr) minmax(0, 1.14fr) minmax(0, .85fr)");
    expect(finalStyles).toContain("height: 46px");
    expect(finalStyles).toContain("gap: 8px");
    expect(finalStyles).toContain("overflow: hidden");
    expect(finalStyles).toContain("font-size: 14px");
    expect(finalStyles).toContain("container-name: cashier-operational-workspace");
    expect(finalStyles).toContain("@container cashier-operational-workspace (max-width: 900px)");
    for (const color of ["#d97706", "#2563eb", "#9333ea", "#64748b"]) {
      expect(phaseStyles).toContain(color);
    }
  });

  it("keeps search in the top header and every queue in deterministic newest-first order", () => {
    expect(page).toContain("onSearchChange={handleWorkspaceSearch}");
    expect(page).toContain("function compareDiningSessionsNewestFirst(");
    expect(page).toContain("new Date(right.latestAt).getTime() - new Date(left.latestAt).getTime()");
    expect(page).toContain("new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()");
    expect(page).toContain("return [...sessions.values()].sort(compareDiningSessionsNewestFirst)");
    expect(page).toContain(".sort(compareDiningSessionsNewestFirst);");
    expect(page).not.toContain("new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()");
    expect(page).not.toContain("Search order, invoice, customer or table");
    expect(page).not.toContain("cd-queue-search");
    expect(page).not.toContain("cd-queue-toolbar");
    expect(phaseStyles).not.toContain(".cd-queue-search");
    expect(phaseStyles).not.toContain(".cd-queue-toolbar");
    expect(page).not.toContain("Oldest first");
    expect(page).not.toContain("cd-queue-sort");
    expect(page).not.toContain("cd-queue-filters");
    expect(page).not.toContain("Additional filtering is not enabled");
    expect(page).not.toContain("currentQueueHelper");
    expect(page).not.toContain('className="cd-queue-heading"');
  });

  it("starts the queue rows immediately without a redundant column header or repeated statuses", () => {
    expect(page).not.toContain('className="cd-operational-table-header"');
    expect(phaseStyles).not.toContain(".cd-operational-table-header");
    for (const rowClass of ["cd-row-location", "cd-row-items", "cd-row-method", "cd-row-amount", "cd-row-event-time", "cd-row-action"]) {
      expect(page).toContain(rowClass);
    }
    expect(page).not.toContain("cd-row-status");
    expect(page).toContain("orderTableCode(order)");
    expect(page).toContain("return numericTable ? `T${Number(numericTable[1])}` : table;");
    expect(page).not.toContain("Service Location");
    expect(finalStyles).toContain("grid-template-columns: minmax(82px, .78fr) minmax(150px, 1.7fr)");
  });

  it("uses a quantity-aware compact item summary with accessible full details", () => {
    expect(page).toContain("summarizeOperationalItems(allItems)");
    expect(page).toContain('className="cd-row-items-preview"');
    expect(page).toContain('className="cd-row-items-more"');
    expect(page).toContain("itemSummary.hiddenDistinctCount");
    expect(page).toContain('aria-label={`${itemCountLabel}. ${fullItemLabel}`}');
    expect(finalStyles).toContain("text-overflow: ellipsis");
    expect(finalStyles).toContain("flex: 0 0 auto");
  });

  it("uses queue-aware time labels and compact non-card rows", () => {
    expect(page).toContain('requestedAt ? relativeEventTime("Requested", requestedAt) : "Time unavailable"');
    expect(page).toContain('paidAt ? relativeEventTime("Paid", paidAt) : "Time unavailable"');
    expect(page).toContain('relativeEventTime("Completed", order.paymentVerifiedAt ?? session.latestAt)');
    expect(page).toContain('"Over 20 min"');
    expect(finalStyles).toContain("height: 76px");
    expect(finalStyles).toContain("border-radius: 0");
    expect(finalStyles).toContain("border-bottom: 1px solid #e5e7eb");
  });

  it("keeps actions, focus behavior, and queue-specific empty states", () => {
    expect(page).toContain("handleQueueTabKeyDown(event, tab)");
    expect(page).toContain("event.stopPropagation(); openOrder()");
    expect(page).toContain("setDrawerOrder(order)");
    for (const message of [
      "No payments waiting.",
      "No bill requests right now.",
      "No receipts waiting to print.",
      "No completed transactions yet.",
    ]) {
      expect(page).toContain(message);
    }
    expect(phaseStyles).toContain("min-height: 42px");
    expect(phaseStyles).toContain("min-width: 88px");
  });
});

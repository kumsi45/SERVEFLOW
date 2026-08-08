import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const styles = read("src/modules/cashier/styles/cashierDashboard.css");
const page = read("src/modules/cashier/pages/CashierDashboardPage.tsx");
const nextPhaseStart = styles.indexOf("Phase 13.5");
const phaseStyles = styles.slice(styles.indexOf("Phase 13.4C"), nextPhaseStart);
const finalStyles = styles.slice(styles.indexOf("Phase 13.4D"), nextPhaseStart);
const tabsMarkup = page.slice(
  page.indexOf('className="cd-tabs"'),
  page.indexOf('className="cd-order-list"'),
);
const operationalRowsMarkup = page.slice(
  page.indexOf('id="cashier-operational-queue"'),
  page.indexOf('<aside className="cd-side-stack"'),
);
const renderedRowMarkup = operationalRowsMarkup.slice(
  operationalRowsMarkup.indexOf("<article"),
  operationalRowsMarkup.indexOf("</article>") + "</article>".length,
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
    expect(finalStyles).toContain("grid-template-columns: minmax(0, .95fr) minmax(0, 1.08fr) minmax(0, 1.2fr) minmax(0, .88fr)");
    expect(finalStyles).toContain("height: 44px");
    expect(finalStyles).toContain("gap: 6px");
    expect(finalStyles).toContain("overflow: hidden");
    expect(finalStyles).toContain("font: 600 12px/16px Inter, ui-sans-serif, system-ui, sans-serif");
    expect(finalStyles).toContain("container-name: cashier-operational-workspace");
    expect(finalStyles).toContain("@container cashier-operational-workspace (max-width: 900px)");
    for (const color of ["#d97706", "#2563eb", "#9333ea", "#64748b"]) {
      expect(phaseStyles).toContain(color);
    }
  });

  it("keeps every queue color visible before the cashier selects it", () => {
    for (const color of [
      "#b45309", "#fff7ed", "#fed7aa",
      "#1d4ed8", "#eff6ff", "#bfdbfe",
      "#7e22ce", "#faf5ff", "#e9d5ff",
      "#475569", "#f8fafc", "#e2e8f0",
    ]) {
      expect(finalStyles.toLowerCase()).toContain(color);
    }
    expect(finalStyles).toContain("background: var(--cd-queue-soft)");
    expect(finalStyles).toContain("color: var(--cd-queue-accent)");
    expect(finalStyles).toContain("background: var(--cd-queue-badge)");
    expect(finalStyles).toContain("border: 1px solid var(--cd-queue-border)");
  });

  it("gives the four queue controls generous segmented-control spacing", () => {
    expect(finalStyles).toContain("padding: 10px 12px");
    expect(finalStyles).toContain("padding: 4px");
    expect(finalStyles).toContain("border-radius: 12px");
    expect(finalStyles).toContain("padding: 0 6px");
    expect(finalStyles).not.toContain(".cd-tabs { grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(finalStyles).toContain("@container cashier-operational-workspace (max-width: 640px)");
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

  it("uses the requested seven-column cashier scan order in every queue", () => {
    expect(page).not.toContain('className="cd-operational-table-header"');
    expect(phaseStyles).not.toContain(".cd-operational-table-header");
    for (const rowClass of ["cd-row-location", "cd-row-source", "cd-row-items", "cd-row-method", "cd-row-amount", "cd-row-wait", "cd-row-action"]) {
      expect(page).toContain(rowClass);
    }
    expect(renderedRowMarkup).not.toContain("cd-row-status");
    expect(page).toContain("orderTableCode(order)");
    expect(page).toContain("return numericTable ? `T${Number(numericTable[1])}` : table;");
    expect(operationalRowsMarkup).not.toContain("Service Location");
    expect(finalStyles).toContain("grid-template-columns: 48px 150px minmax(0, 1fr) 100px 120px 70px 130px");
    const orderedCells = ["{location}", "cd-row-source", "{itemDetails}", "cd-row-method", "cd-row-amount", "{time}", "{action}"];
    orderedCells.reduce((previous, cell) => {
      const position = renderedRowMarkup.indexOf(cell);
      expect(position).toBeGreaterThan(previous);
      return position;
    }, -1);
  });

  it("uses queue-specific workflow/payment values and action labels without changing row handlers", () => {
    for (const value of [
      'action: "Verify Payment"',
      'action: "Print Bill"',
      'action: "Print Receipt"',
      'action: "View"',
    ]) {
      expect(page).toContain(value);
    }
    expect(page).toContain('? "Bill Requested"');
    expect(page).toContain('method !== "Not Selected"');
    expect(operationalRowsMarkup).toContain("currentQueue.action");
    expect(operationalRowsMarkup).toContain("event.stopPropagation(); openOrder()");
  });

  it("uses a quantity-aware compact item summary with accessible full details", () => {
    expect(page).toContain("summarizeOperationalItems(allItems)");
    expect(page).toContain('className="cd-row-items-preview"');
    expect(page).toContain('className="cd-row-items-more"');
    expect(page).toContain("itemSummary.hiddenDistinctCount");
    expect(page).toContain('aria-label={`${itemCountLabel}. ${fullItemLabel}`}');
    expect(operationalRowsMarkup).not.toContain("<strong>{itemCountLabel}</strong>");
    expect(finalStyles).toContain("text-overflow: ellipsis");
    expect(finalStyles).toContain("flex: 0 0 auto");
  });

  it("uses compact elapsed labels and premium white rows", () => {
    expect(page).toContain("compactElapsedLabel(elapsedFrom, now)");
    expect(page).toContain('if (minutes < 1) return "Now"');
    expect(page).toContain('if (minutes < 60) return `${minutes} min`');
    expect(page).toContain('if (hours < 24) return `${hours} hr${remainingMinutes ? ` ${remainingMinutes} min` : ""}`');
    expect(page).toContain('return `${days} d${remainingHours ? ` ${remainingHours} hr` : ""}`');
    expect(finalStyles).toContain("height: 76px");
    expect(finalStyles).toContain("border-radius: 14px");
    expect(finalStyles).toContain("background: #fff");
  });

  it("shows Payment Due until verification without fabricating Cash", () => {
    expect(page).toContain('visibleQueueTab === "pending" && source.label === "Waiter" && !paymentVerified');
    expect(page).toContain('? "Payment Due"');
    expect(page).toContain('method !== "Not Selected"');
    expect(operationalRowsMarkup).not.toContain("paymentIcon");
    expect(finalStyles).toContain(".cd-row-payment-value.payment-due { color: #d97706; }");
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

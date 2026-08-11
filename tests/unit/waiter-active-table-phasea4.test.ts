import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/waiter-dashboard/pages/WaiterDashboardPage.tsx");
const styles = read("src/modules/waiter-dashboard/styles/waiterDashboard.css");

describe("waiter active table phase A4 contract", () => {
  it("renders the active table around order, kitchen, total, and two primary actions", () => {
    expect(page).toContain('className="a4-session-header"');
    expect(page).toContain("<h2>ORDER</h2>");
    expect(page).toContain("<h2>KITCHEN</h2>");
    expect(page).toContain("<span>TOTAL</span>");
    expect(page).toContain("+ ADD ITEMS");
    expect(page).toContain("REQUEST BILL");
    expect(page).toContain("MORE");
  });

  it("keeps backend concepts out of the primary active-table presentation", () => {
    const activeTable = page.slice(page.indexOf('className="a4-session-header"'));
    expect(activeTable).not.toContain("Dining Session");
    expect(activeTable).not.toContain("Session ID");
    expect(activeTable).not.toContain("Kitchen Batches");
    expect(activeTable).not.toContain("Batch {batch.number}");
    expect(activeTable).not.toContain("Running Total");
    expect(activeTable).not.toContain("Payment Due");
  });

  it("uses presentation-only item aggregation and waiter-facing kitchen labels", () => {
    expect(page).toContain("const orderItems = sessionDetail ? sessionOrderItems(sessionDetail) : []");
    expect(page).toContain("const kitchenItems = sessionDetail ? sessionKitchenItems(sessionDetail) : []");
    expect(page).toContain('status === "ready"');
    expect(page).toContain('"READY"');
    expect(page).toContain('"COOKING"');
    expect(page).toContain('"SENT"');
    expect(page).toContain('"SERVED"');
  });

  it("confirms bill requests and prevents duplicate bill taps", () => {
    expect(page).toContain('className="a4-bill-confirm"');
    expect(page).toContain("Request bill?");
    expect(page).toContain("billAlreadyRequested");
    expect(page).toContain("requestWaiterFinalBill(sessionTable.activeOrderId)");
    expect(page).not.toContain("Could not request the final bill.");
  });

  it("defines tablet-first responsive A4 layout and large actions", () => {
    expect(styles).toContain(".a4-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)");
    expect(styles).toContain(".a4-actions button{min-height:56px");
    expect(styles).toContain("@media(max-width:820px)");
    expect(styles).toContain(".a4-columns{grid-template-columns:1fr}");
    expect(styles).toContain("@media(max-width:520px)");
  });
});

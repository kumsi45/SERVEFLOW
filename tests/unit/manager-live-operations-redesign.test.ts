import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/manager/pages/ManagerOperationsCenterPage.tsx");
const styles = read("src/modules/manager/styles/managerOperationsCenter.css");
const layout = read("src/modules/manager/components/ManagerLayout.tsx");
const service = read("src/modules/manager/services/managerDashboardService.ts");
const types = read("src/modules/manager/types.ts");

describe("Manager Live Operations redesign", () => {
  it("uses the intervention architecture without duplicate workspaces", () => {
    for (const label of ["Live Operations", "Manager Actions", "Live Service", "Shift Health", "Recent Operations", "Service Location"]) expect(page).toContain(label);
    for (const removed of ["Current Revenue", "Staff Online", "Requests & Critical Stock", "Cashier Status", "Table Assignment", "moc-kpis", "moc-task-board"]) expect(page).not.toContain(removed);
    expect(page).not.toContain("loadInventoryItems");
  });

  it("keeps free locations minimal and derives presentation state from authoritative data", () => {
    expect(page).toContain('if (!table.activeOrderId) return "free"');
    expect(page).toContain("{hasSession &&");
    expect(page).toContain("table.kitchenStatus");
    expect(page).toContain("table.cashierStatus");
    expect(page).not.toContain("Guests</dt>");
  });

  it("uses an overlay inspector and preserves authorized handlers", () => {
    expect(page).toContain('role="dialog"');
    expect(styles).toContain("position:fixed");
    expect(page).toContain("assignWaiterTables");
    expect(page).toContain("releaseManagerDiningSession");
    expect(page).toContain("Emergency release reason (required)");
  });

  it("keeps the inspector focused on current state rather than permanent controls or history", () => {
    expect(page).not.toContain('className="moc-reassign"');
    expect(page).not.toContain("Recent Session Activity");
    expect(page).not.toContain("Open Kitchen Context");
    expect(page).not.toContain("Choose staff member");
    expect(page).toContain("Assigned Waiter");
    expect(page).toContain("No active service session.");
  });

  it("shows authoritative order items and invoice payment values", () => {
    expect(service).toContain("menu_items!order_items_menu_item_id_fkey(name)");
    expect(types).toContain("orderItems: ManagerOrderItemSummary[]");
    expect(types).toContain("paidAmount: number");
    expect(types).toContain("dueAmount: number");
    expect(page).toContain("selectedTable.orderItems.slice(0, 3)");
    expect(page).toContain("selectedTable.orderItems.length - 3");
    expect(page).toContain("selectedTable.paidAmount");
    expect(page).toContain("selectedTable.dueAmount");
    expect(page).not.toContain("orderStatusLabel");
    expect(page).not.toContain("<dt>Order</dt>");
  });

  it("exposes kitchen navigation only for an existing delay alert", () => {
    expect(page).toContain('alert.type === "kitchen_delay"');
    expect(page).toContain("Kitchen delay requires intervention.");
    expect(page).toContain(">Open Kitchen</button>");
    expect(page).not.toContain("Verify Payment");
  });

  it("derives duration only from an authoritative open dining session", () => {
    expect(service).toContain('.eq("dining_session_status", "open")');
    expect(service).toContain("order?.dining_session_opened_at ?? order?.created_at ?? null");
    expect(page).toContain("selectedTable.activeOrderId && selectedTable.sessionDurationMinutes != null");
  });

  it("retains tenant-scoped realtime and route contracts", () => {
    expect(page).toContain("useTenantRealtime");
    expect(page).toContain('"kitchen_inventory_requests"');
    expect(layout).toContain('label: "Live Operations"');
    expect(layout).toContain('href: "/manager/tables"');
  });

  it("provides desktop, tablet, mobile, and narrow-mobile layouts", () => {
    expect(styles).toContain("repeat(5,minmax(118px,1fr))");
    expect(styles).toContain("@media(max-width:1023px)");
    expect(styles).toContain("@media(max-width:767px)");
    expect(styles).toContain("@media(max-width:359px)");
    expect(styles).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
  });
});

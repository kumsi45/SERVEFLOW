import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildWaiterTableCards,
  filterWaiterTableCards,
  resolveWaiterTableState,
  waiterTableCounts,
} from "../../src/modules/waiter-dashboard/services/waiterTablesPresentation";
import type {
  WaiterDashboardTable,
  WaiterTableMetric,
} from "../../src/modules/waiter-dashboard/types";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/229_phasea2_waiter_assigned_tables_only.sql");
const page = read("src/modules/waiter-dashboard/pages/WaiterDashboardPage.tsx");
const styles = read("src/modules/waiter-dashboard/styles/waiterDashboard.css");

function table(number: number, orderId: string | null = null): WaiterDashboardTable {
  return {
    restaurantId: "restaurant-a",
    restaurantSlug: "grand-royal",
    restaurantName: "Grand Royal",
    restaurantLogoUrl: null,
    waiterStaffId: "waiter-a",
    waiterDisplayName: "Waiter Abdi",
    currentShift: "Current Shift",
    assignmentMode: "assigned_tables",
    tableId: `table-${number}`,
    tableNumber: number,
    tableLabel: null,
    seats: 4,
    tableActive: true,
    assignedWaiterStaffId: "waiter-a",
    assignedWaiterName: "Waiter Abdi",
    tableStatus: orderId ? "occupied" : "available",
    activeOrderId: orderId,
    activeOrderStatus: orderId ? "paid" : null,
    activeOrderSource: orderId ? "waiter" : null,
    qrCustomerName: null,
    activeOrderCreatedAt: orderId ? "2026-08-09T12:00:00Z" : null,
  };
}

function metric(status: WaiterTableMetric["lifecycleStatus"]): WaiterTableMetric {
  return {
    total: 1250,
    invoiceCount: 1,
    sessionNumber: "S-1",
    invoiceNumbers: ["I-1"],
    readyItemCount: status === "ready_to_serve" ? 2 : 0,
    itemCount: 3,
    lifecycleStatus: status,
  };
}

describe("Phase A2 authoritative waiter table assignments", () => {
  it("returns only active tables actively assigned to the authenticated waiter", () => {
    expect(migration).toContain("join public.restaurant_table_waiter_assignments assignments");
    expect(migration).toContain("assignments.waiter_staff_id = current_waiter.id");
    expect(migration).toContain("and assignments.active");
    expect(migration).toContain("and tables.active");
    expect(migration).not.toContain("not has_assignments");
    expect(migration).not.toContain("'all_tables'");
    expect(migration).toContain("'assigned_tables'::text");
  });

  it("preserves authenticated active waiter and restaurant isolation checks", () => {
    expect(migration).toContain("if auth.uid() is null");
    expect(migration).toContain("staff.restaurant_id = target_restaurant.id");
    expect(migration).toContain("staff.user_id = auth.uid()");
    expect(migration).toContain("staff.role::text = 'waiter'");
    expect(migration).toContain("and staff.active");
    expect(migration).toContain("tables.restaurant_id = target_restaurant.id");
  });
});

describe("Phase A2 table presentation", () => {
  it("maps the authoritative metrics to exactly four short states", () => {
    const active = table(1, "order-1");
    expect(resolveWaiterTableState(table(2), null)).toBe("free");
    expect(resolveWaiterTableState(active, metric("kitchen_waiting"))).toBe("active");
    expect(resolveWaiterTableState(active, metric("ready_to_serve"))).toBe("ready");
    expect(resolveWaiterTableState(active, metric("needs_bill"))).toBe("bill");
    expect(resolveWaiterTableState(active, metric("billing"))).toBe("bill");
  });

  it("prioritizes ready, bill, active, then free before table number", () => {
    const tables = [table(2), table(8, "active"), table(5, "ready"), table(3, "bill")];
    const metrics = new Map([
      ["active", metric("kitchen_waiting")],
      ["ready", metric("ready_to_serve")],
      ["bill", metric("needs_bill")],
    ]);
    const cards = buildWaiterTableCards(tables, metrics);
    expect(cards.map((card) => [card.table.tableNumber, card.state])).toEqual([
      [5, "ready"],
      [3, "bill"],
      [8, "active"],
      [2, "free"],
    ]);
    expect(waiterTableCounts(cards)).toEqual({ all: 4, free: 1, active: 1, ready: 1, bill: 1 });
    expect(filterWaiterTableCards(cards, "ready", "")).toHaveLength(1);
  });

  it("keeps filters local, cards one-tap, realtime-backed, and zero-assignment safe", () => {
    expect(page).toContain("No tables assigned");
    expect(page).toContain("Ask your manager for a table assignment.");
    expect(page).toContain("onClick={() => openTable(table)}");
    expect(page).toContain("buildWaiterTableCards(tables, metrics)");
    expect(page).toContain('tables: ["restaurant_tables", "restaurant_table_waiter_assignments", "orders", "order_items", "order_invoices", "waiter_assistance_requests"]');
    expect(page).not.toContain("Menu opens automatically");
    expect(page).not.toContain("Tap table");
    expect(page).not.toContain("if (navigator.onLine) sync()");
  });

  it("defines compact tablet and mobile grids without delayed interaction", () => {
    expect(styles).toContain("grid-template-columns:repeat(6,minmax(0,1fr))");
    expect(styles).toContain("grid-template-columns:repeat(4,minmax(0,1fr))");
    expect(styles).toContain("grid-template-columns:repeat(3,minmax(0,1fr))");
    expect(styles).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
    expect(styles).toContain("touch-action:manipulation");
    expect(styles).toContain("prefers-reduced-motion:reduce");
  });
});

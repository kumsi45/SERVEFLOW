import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseManagerMenuPerformanceReport } from "../../src/modules/manager/services/managerR3ReportsService";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replaceAll("\r\n", "\n");
const migration = read("supabase/migrations/238_manager_reports_r3_menu_cashier.sql");
const truth = read("docs/MANAGER_REPORTS_R3_MENU_CASHIER_TRUTH.md");

describe("Manager Reports R3 menu performance", () => {
  it("uses paid invoice events and frozen item values", () => {
    expect(migration).toContain("invoices.payment_status = 'paid'");
    expect(migration).toContain("invoices.paid_at >= periods.period_start");
    expect(migration).toContain("order_items.price * order_items.quantity");
    expect(migration).not.toContain("menu_items.price *");
  });

  it("excludes cancelled orders and items", () => {
    expect(migration).toContain("orders.status::text <> 'cancelled'");
    expect(migration).toContain("order_items.kitchen_status <> 'cancelled'");
  });

  it("keeps quantity, value, order count, and comparison rankings separate", () => {
    expect(migration).toContain("sum(quantity)::integer as quantity_sold");
    expect(migration).toContain("count(distinct order_id)::integer as orders_containing_item");
    expect(migration).toContain("'top_by_quantity'");
    expect(migration).toContain("'top_by_sales'");
    expect(migration).toContain("'low_selling'");
    expect(migration).toContain("when comparison_quantity = 0 then null");
    expect(migration).toContain("when comparison_sales = 0 then null");
  });

  it("labels zero sales conservatively and exposes unavailable availability history", () => {
    expect(migration).toContain("'zero_recorded_sales'");
    expect(migration).toContain("'availability_history_available', false");
    expect(migration).toContain("'availability_history_quality', 'unavailable'");
    expect(truth).toContain("does not mean the item was available throughout the period");
  });

  it("parses menu metrics without converting null comparison percentages", () => {
    const report = parseManagerMenuPerformanceReport({
      items: [{ menu_item_id: "coffee", menu_item_name: "Coffee", category_id: "drinks", category_name: "Drinks", current_status: "Available", current_quantity: 4, comparison_quantity: 0, quantity_change: 4, quantity_change_percent: null, current_sales: "40", comparison_sales: 0, sales_change: 40, sales_change_percent: null, current_orders: 2, comparison_orders: 0 }],
      top_by_quantity: [], top_by_sales: [], low_selling: [], zero_recorded_sales: [], categories: [],
      availability_history_available: false,
      data_quality: { historical_price_quality: "complete", availability_history_quality: "unavailable", item_identity_history_quality: "legacy_unknown", legacy_order_item_quality: "complete" },
    });
    expect(report.items[0].currentQuantity).toBe(4);
    expect(report.items[0].currentSales).toBe(40);
    expect(report.items[0].quantityChangePercent).toBeNull();
    expect(report.availabilityHistoryAvailable).toBe(false);
  });
});


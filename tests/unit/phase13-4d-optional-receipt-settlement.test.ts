import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/223_phase13_4d_optional_receipt_settlement.sql");
const cashier = read("src/modules/cashier/pages/CashierDashboardPage.tsx");

describe("Phase 13.4D optional receipt settlement", () => {
  it("removes the printed-receipt settlement gate", () => {
    expect(migration).not.toContain("Every paid invoice requires a printed receipt before settlement.");
    expect(migration).not.toMatch(/exists\s*\(\s*select\s+1\s+from\s+public\.receipt_generation_events/i);
    expect(migration).toContain("the customer may decline a printed receipt");
    expect(cashier).toContain("Receipt printing is optional.");
  });

  it("preserves cashier authority and tenant-scoped settlement writes", () => {
    expect(migration).toContain("restaurant_id = target.restaurant_id");
    expect(migration).toContain("user_id = auth.uid()");
    expect(migration).toContain("and role = 'cashier'");
    expect(migration).toContain("close_dining_session_phase122a_base");
    expect(migration).toContain("payment_status in ('paid', 'cancelled', 'refunded')");
    expect(migration).toContain("'invoice_settled'");
  });

  it("keeps receipt printing available without requiring it for settlement", () => {
    expect(cashier).toContain("print_final_dining_bill");
    expect(cashier).toContain("mark_cashier_session_receipts_printed");
    expect(cashier).toContain("cashier_close_invoice_and_release_table");
    expect(migration).toContain("receipt_pending_queue");
    expect(migration).toContain("receipt_optional_filter");
  });

  it("does not introduce a parallel payment or receipt authority", () => {
    expect(migration).not.toMatch(/create\s+table/i);
    expect(migration).not.toMatch(/update\s+public\.order_invoices\s+set\s+(payment_status|grand_total|subtotal|vat_amount|service_charge_amount|discount_amount)/i);
  });
});

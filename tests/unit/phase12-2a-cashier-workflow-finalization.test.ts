import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/222_phase12_2a_cashier_workflow_finalization.sql");
const cashier = read("src/modules/cashier/pages/CashierDashboardPage.tsx");
const manager = read("src/modules/manager/services/managerDashboardService.ts");
const managerPage = read("src/modules/manager/pages/ManagerOperationsCenterPage.tsx");
const customer = read("src/modules/public-qr-ordering/services/publicQrOrderService.ts");

describe("Phase 12.2A cashier workflow finalization", () => {
  it("protects canonical tenant table occupancy and duplicate sessions", () => {
    expect(migration).toContain("enforce_canonical_open_table_identity");
    expect(migration).toContain("t.restaurant_id=new.restaurant_id");
    expect(migration).toContain("orders_one_open_dining_session_per_table_id");
    expect(migration).toContain("orders_one_open_dining_session_per_table");
  });

  it("makes receipt-backed invoice close a cashier-only release", () => {
    expect(migration).toContain("Only an active cashier may close an invoice and release its table.");
    expect(migration).toContain("Every paid invoice requires a printed receipt before settlement.");
    expect(cashier).toContain("mark_cashier_session_receipts_printed");
    expect(cashier).toContain("cashier_close_invoice_and_release_table");
    expect(migration).toContain("revoke execute on function public.close_waiter_table");
  });

  it("limits emergency release to a confirmed manager reason without changing invoices", () => {
    expect(migration).toContain("manager_emergency_release_table");
    expect(migration).toContain("Emergency release confirmation is required.");
    expect(migration).toContain("An emergency release reason is required.");
    expect(migration).toContain("Emergency release cannot bypass payment verification.");
    expect(migration).toContain("manager_emergency_table_release");
    expect(manager).toContain("manager_emergency_release_table");
    expect(managerPage).toContain("Emergency release reason (required)");
  });

  it("unifies waiter and customer bill requests on the order authority", () => {
    expect(migration).toContain("request_customer_final_bill");
    expect(migration).toContain("bill_requested_at=coalesce(bill_requested_at,now())");
    expect(customer).toContain("request_customer_final_bill");
    expect(migration).toContain("record_cashier_bill_action");
    expect(migration).toContain("'bill_requested_queue'");
  });

  it("finalizes every required queue without adding parallel authorities", () => {
    for (const queue of ["bill_requested_queue", "payment_retry_queue", "receipt_pending_queue", "invoice_settlement_queue"]) {
      expect(migration).toContain(`'${queue}'`);
    }
    expect(migration).not.toMatch(/create\s+table/i);
    expect(migration).not.toMatch(/update\s+public\.order_invoices\s+set\s+(payment_status|grand_total|subtotal|vat_amount|service_charge_amount|discount_amount)/i);
  });
});

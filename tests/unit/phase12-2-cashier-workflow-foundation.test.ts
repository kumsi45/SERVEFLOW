import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/221_phase12_2_cashier_workflow_foundation.sql");
const workflow = read("src/modules/cashier/cashierWorkflow.ts");
const realtime = read("src/core/realtime/restaurantEventService.ts");

describe("Phase 12.2 cashier workflow foundation", () => {
  it("reuses existing authorities without creating parallel tables or financial logic", () => {
    expect(migration).not.toMatch(/create\s+table/i);
    for (const authority of ["order_invoices", "receipt_generation_events", "cashier_shifts", "shift_activity_logs", "waiter_assistance_requests"]) {
      expect(migration).toContain(authority);
    }
    expect(migration).not.toMatch(/vat_percentage|service_charge_percentage|vat_rate|service_charge_rate/);
  });

  it("provides all operational queues and explicit invoice lifecycle states", () => {
    for (const queue of ["payment_submitted_queue", "waiter_payment_due_queue", "cash_payment_queue", "digital_payment_queue", "verification_queue", "receipt_queue", "daily_settlement", "customer_assistance_queue"]) {
      expect(migration).toContain(`'${queue}'`);
      expect(workflow).toContain(queue);
    }
    for (const state of ["pending_payment", "payment_submitted", "paid", "receipt_printed", "closed", "cancelled", "refunded"]) {
      expect(migration).toContain(`'${state}'`);
    }
  });

  it("keeps mutation cashier-only while owner access is projection-only", () => {
    expect(migration).toContain("role='cashier'");
    expect(migration).toContain("role in ('cashier','owner')");
    expect(migration).toContain("Only an active cashier may verify payment.");
    expect(migration).toContain("Only an active cashier may reject payment.");
    expect(migration).toContain("Only an active cashier may manage receipts.");
  });

  it("records rejection, retry, receipt and existing verification audits", () => {
    for (const action of ["payment_rejected", "payment_retry_requested", "receipt_"]) {
      expect(migration).toContain(action);
    }
    expect(migration).toContain("shift_activity_logs");
    expect(migration).toContain("A rejection reason is required");
  });

  it("subscribes the workflow to invoice, receipt, settlement and assistance events", () => {
    for (const table of ["order_invoices", "receipt_generation_events", "cashier_shifts", "shift_activity_logs", "waiter_assistance_requests"]) {
      expect(workflow).toContain(`"${table}"`);
    }
    expect(realtime).toContain('"receipt_generation_events"');
    expect(workflow).toContain("getRestaurantEventStream");
    expect(migration).toContain("call_cashier_from_smart_qr");
    expect(migration).toContain("request_type in ('call_waiter','call_cashier')");
  });
});

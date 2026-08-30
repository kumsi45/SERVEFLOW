import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/258_cashier_persistent_obligation_visibility.sql"),
  "utf8",
).replaceAll("\r\n", "\n");

const phaseA = readFileSync(
  resolve(process.cwd(), "supabase/migrations/257_cashier_settlement_integrity.sql"),
  "utf8",
).replaceAll("\r\n", "\n");

function sectionBetween(start: string, end: string) {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex + start.length);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return migration.slice(startIndex, endIndex);
}

describe("cashier Phase B persistent obligation visibility", () => {
  it("defines unresolved obligations as pending or held invoices only", () => {
    const summary = sectionBetween(
      "create or replace function public.restaurant_unresolved_obligation_summary",
      "revoke all on function public.restaurant_unresolved_obligation_summary",
    );
    const ledger = sectionBetween(
      "create or replace function public.get_restaurant_unresolved_obligations",
      "revoke all on function public.get_restaurant_unresolved_obligations",
    );

    expect(summary).toContain("invoices.payment_status in ('pending', 'held')");
    expect(ledger).toContain("invoices.payment_status in ('pending', 'held')");
    expect(ledger).not.toMatch(/payment_status\s*=\s*'paid'/);
    expect(ledger).not.toMatch(/payment_status\s+not\s+in/i);
  });

  it("keeps unresolved visibility independent of shift and age", () => {
    const ledger = sectionBetween(
      "create or replace function public.get_restaurant_unresolved_obligations",
      "revoke all on function public.get_restaurant_unresolved_obligations",
    );

    expect(ledger).not.toContain("now()-interval '36 hours'");
    expect(ledger).not.toContain("cashier_shift_id is not null");
    expect(ledger).not.toContain("cashier_shift_id =");
    expect(ledger).not.toContain("opened_by = actor.id");
    expect(ledger).toContain("'requires_open_cashier_shift_to_settle', true");
  });

  it("extends the existing queue without an unresolved age cutoff", () => {
    expect(migration).toContain(
      "and (i.payment_status in (''pending'',''held'') or o.dining_session_status=''open'' or i.created_at>=now()-interval ''36 hours'')",
    );
    expect(migration).toContain(
      "raise exception 'Cashier payment queue age filter could not be updated safely.';",
    );
  });

  it("classifies served unpaid on the backend", () => {
    const ledger = sectionBetween(
      "create or replace function public.get_restaurant_unresolved_obligations",
      "revoke all on function public.get_restaurant_unresolved_obligations",
    );

    expect(ledger).toContain("'served_unpaid', orders.operational_status = 'served'");
    expect(ledger).toContain("'bill_requested', orders.bill_requested_at is not null");
    expect(ledger).toContain("'pending_cancellation_request', exists");
  });

  it("preserves Phase A own-open-shift settlement authority", () => {
    expect(phaseA).toContain("shifts.opened_by = acting_cashier.id");
    expect(phaseA).toContain("shifts.closed_at is null");
    expect(phaseA).toContain("set cashier_shift_id = acting_shift.id");
    expect(phaseA).toContain("Only an active cashier may settle a dining session.");
    expect(migration).not.toContain("order by shifts.opened_at desc");
  });

  it("denies cross-tenant obligation visibility through staff membership", () => {
    const ledger = sectionBetween(
      "create or replace function public.get_restaurant_unresolved_obligations",
      "revoke all on function public.get_restaurant_unresolved_obligations",
    );

    expect(ledger).toContain("staff.restaurant_id = target_restaurant_id");
    expect(ledger).toContain("staff.user_id = auth.uid()");
    expect(ledger).toContain("staff.active");
    expect(ledger).toContain("staff.role::text in ('cashier', 'manager', 'owner')");
    expect(migration).toContain("revoke all on function public.get_restaurant_unresolved_obligations(uuid)\nfrom public, anon;");
    expect(migration).toContain("grant execute on function public.get_restaurant_unresolved_obligations(uuid)\nto authenticated;");
  });

  it("records shift-close acknowledgment without mutating invoices", () => {
    const closeShift = sectionBetween(
      "create or replace function public.close_cashier_shift",
      "revoke all on function public.close_cashier_shift",
    );

    expect(closeShift).toContain("'restaurant_obligations_acknowledged'");
    expect(closeShift).toContain("'acknowledged_by_staff_id'");
    expect(closeShift).toContain("public.close_cashier_shift_phase258_base");
    expect(closeShift).not.toMatch(/update\s+public\.order_invoices/i);
    expect(closeShift).not.toMatch(/update\s+public\.orders/i);
    expect(closeShift).not.toMatch(/update\s+public\.restaurant_tables/i);
    expect(closeShift).not.toContain("cashier_shift_id = target_shift.id");
  });

  it("excludes the 22 legacy paid null-shift invoices from unresolved logic", () => {
    expect(migration).toContain("invoices.payment_status in ('pending', 'held')");
    expect(migration).not.toMatch(/update\s+public\.order_invoices[\s\S]*cashier_shift_id/i);
    expect(migration).not.toMatch(/payment_status\s*=\s*'paid'[\s\S]*cashier_shift_id/i);
    expect(migration).not.toContain("ambiguous legacy paid");
  });

  it("avoids CREATE OR REPLACE hazards for changed return shapes", () => {
    expect(migration).not.toContain("returns table");
    expect(migration).not.toContain("drop function");
    expect(migration).not.toMatch(/alter function public\.create_customer_order\(text,\s*jsonb\)\s+rename/i);
    expect(migration).toContain("create or replace function public.create_customer_order(");
    expect(migration).toContain("returns jsonb");
    expect(migration).toContain("create or replace function public.close_cashier_shift(");
    expect(migration).toContain("returns jsonb");
  });

  it("repairs authenticated customer orders atomically without touching QR or waiter RPCs", () => {
    const customerOrder = sectionBetween(
      "create or replace function public.create_customer_order",
      "revoke all on function public.create_customer_order",
    );

    expect(customerOrder).toContain("insert into public.orders");
    expect(customerOrder).toContain("'authenticated'");
    expect(customerOrder).toContain("insert into public.order_invoices");
    expect(customerOrder).toContain("insert into public.order_items");
    expect(customerOrder).toContain("target_invoice.id");
    expect(customerOrder).toContain("perform public.stamp_invoice_ownership");
    expect(customerOrder).not.toContain("create_customer_order_phase258_base");
    expect(migration).not.toContain("create_public_qr_order");
    expect(migration).not.toContain("submit_waiter_order_batch");
  });

  it("adds targeted indexes without broad production data repair", () => {
    expect(migration).toContain("order_invoices_unresolved_obligations_idx");
    expect(migration).toContain("where payment_status in ('pending', 'held')");
    expect(migration).toContain("order_cancellation_requests_unresolved_lookup_idx");
    expect(migration).not.toMatch(/insert\s+into\s+public\.order_invoices[\s\S]*select[\s\S]*from\s+public\.orders/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\./i);
  });
});

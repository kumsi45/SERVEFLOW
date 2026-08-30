import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/257_cashier_settlement_integrity.sql"),
  "utf8",
).replaceAll("\r\n", "\n");
const hostedAudit = readFileSync(
  resolve(process.cwd(), "supabase/audits/cashier-settlement-integrity-hosted-audit.cjs"),
  "utf8",
).replaceAll("\r\n", "\n");

describe("cashier theft-prevention Phase A settlement integrity", () => {
  it("requires and locks the acting cashier own open shift", () => {
    expect(migration).toContain("shifts.opened_by = acting_cashier.id");
    expect(migration).toContain("shifts.closed_at is null");
    expect(migration).toContain("limit 1\n  for update");
    expect(migration).toContain(
      "No open cashier shift. Open your shift before collecting payment.",
    );
  });

  it("removes restaurant-wide inference and explicitly stamps settlement", () => {
    const validator = migration.slice(
      migration.indexOf("create or replace function public.stamp_verified_invoice_shift"),
      migration.indexOf("create or replace function public.protect_finalized_cashier_invoice_identity"),
    );
    expect(validator).not.toContain("order by (s.opened_by=new.verified_by)");
    expect(validator).not.toContain("not exists(select 1 from public.cashier_shifts own");
    expect(migration).toContain("set cashier_shift_id = acting_shift.id");
  });

  it("enforces same-tenant and same-cashier relational ownership", () => {
    expect(migration).toContain("order_invoices_cashier_shift_same_restaurant");
    expect(migration).toContain("foreign key (restaurant_id, cashier_shift_id)");
    expect(migration).toContain("order_invoices_cashier_shift_owner_same_restaurant");
    expect(migration).toContain("foreign key (restaurant_id, verified_by, cashier_shift_id)");
    expect(migration).toContain("references public.cashier_shifts (restaurant_id, opened_by, id)");
  });

  it("stages legacy null-shift rows without weakening new settlements", () => {
    expect(migration).toContain("order_invoices_terminal_cashier_shift_required");
    expect(migration).toContain("cashier_shift_id is not null");
    expect(migration).toContain("not valid");
    expect(migration).toContain("ambiguous legacy paid rows");
  });

  it("requires complete terminal cashier audit identity", () => {
    expect(migration).toContain("order_invoices_terminal_cashier_audit_complete");
    expect(migration).toContain("verified_by is not null");
    expect(migration).toContain("verified_at is not null");
    expect(migration).toContain("paid_at is not null");
  });

  it("validates the explicit shift rather than guessing one", () => {
    expect(migration).toContain("Payment must belong to the verifying cashier shift.");
    expect(migration).toContain("Cashier shift does not belong to this business.");
    expect(migration).toContain("Cashier shift is already closed.");
  });

  it("serializes settlement and close on the cashier shift row", () => {
    const lockCount = migration.match(/from public\.cashier_shifts shifts[\s\S]*?for update;/g)?.length ?? 0;
    expect(lockCount).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("close_cashier_shift");
  });

  it("requires evidence for configured non-cash settlement", () => {
    expect(migration).toContain("cashier_payment_method_requires_evidence");
    expect(migration).toContain("normalize_payment_method(payment_method) <> 'Cash'");
    expect(migration).toContain("Digital payment evidence is required before verification.");
    expect(migration).toContain("reference_number");
    expect(migration).toContain("transaction_id");
    expect(migration).toContain("screenshot_url");
  });

  it("preserves same-owner replay while rejecting another cashier settlement", () => {
    expect(migration).toContain("target_invoice.verified_by = acting_cashier.id");
    expect(migration).toContain("target_invoice.cashier_shift_id = acting_shift.id");
    expect(migration).toContain("Payment has already been settled.");
  });

  it("protects finalized financial identity without blocking status-only refunds", () => {
    const protector = migration.slice(
      migration.indexOf("create or replace function public.protect_finalized_cashier_invoice_identity"),
      migration.indexOf("create or replace function public.cashier_payment_method_requires_evidence"),
    );
    expect(protector).toContain("Finalized cashier settlement identity is immutable.");
    expect(protector).toContain("new.cashier_shift_id is distinct from old.cashier_shift_id");
    expect(protector).toContain("new.grand_total is distinct from old.grand_total");
    expect(protector).not.toContain("new.payment_status is distinct from old.payment_status");
    expect(protector).not.toContain("new.status is distinct from old.status");
  });

  it("keeps settlement authority cashier-only and changes no UI", () => {
    expect(migration).toContain("staff.role = 'cashier'");
    expect(migration).not.toContain("role in ('cashier', 'owner')");
    expect(migration).not.toContain("CashierDashboardPage");
  });

  it("covers no-shift cash, digital, and another-cashier-shift denial", () => {
    expect(hostedAudit).toContain("Cash settlement without a shift was not denied safely.");
    expect(hostedAudit).toContain("Digital settlement without a shift was not denied safely.");
    expect(hostedAudit).toContain("used another cashier's open shift");
  });

  it("covers same-cashier and two-cashier concurrent settlement", () => {
    expect(hostedAudit).toContain("Same-cashier concurrent replay");
    expect(hostedAudit).toContain("Two-cashier race");
    expect(hostedAudit).toContain("Promise.all");
  });

  it("covers cross-tenant, immutability, close-race, and drawer totals", () => {
    expect(hostedAudit).toContain("Privileged cross-tenant invoice/shift linkage was accepted.");
    expect(hostedAudit).toContain("Finalized payment method remained mutable.");
    expect(hostedAudit).toContain("Settlement committed into an already reconciled shift");
    expect(hostedAudit).toContain("drawer totals omitted");
  });
});

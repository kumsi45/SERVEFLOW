import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseManagerCashierPeriodReport } from "../../src/modules/manager/services/managerR3ReportsService";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replaceAll("\r\n", "\n");
const migration = read("supabase/migrations/238_manager_reports_r3_menu_cashier.sql");

describe("Manager Reports R3 cashier period reporting", () => {
  it("keeps Manager authority separate from shift-admin and Owner reporting", () => {
    expect(migration).toContain("public.manager_can_report(target_restaurant_id)");
    expect(migration).not.toContain("owner_can_report");
    expect(migration).toContain("from public, anon, authenticated");
  });

  it("reuses canonical drawer and immutable reconciliation truth", () => {
    expect(migration).toContain("public.cashier_shift_drawer_totals(shifts.id)");
    expect(migration).toContain("reconciliations.cash_payments");
    expect(migration).toContain("reconciliations.expected_cash");
    expect(migration).toContain("reconciliations.actual_cash");
    expect(migration).toContain("reconciliations.variance");
  });

  it("uses each cash-control event timestamp", () => {
    expect(migration).toContain("expenses.created_at >= range_start");
    expect(migration).toContain("expenses.reviewed_at >= range_start");
    expect(migration).toContain("handovers.initiated_at >= range_start");
    expect(migration).toContain("handovers.confirmed_at >= range_start");
    expect(migration).toContain("reconciliations.closed_at >= range_start");
    expect(migration).toContain("logs.created_at >= range_start");
  });

  it("includes cross-boundary open shifts and per-shift expense facts", () => {
    expect(migration).toContain("shifts.opened_at < range_end");
    expect(migration).toContain("shifts.closed_at is null or shifts.closed_at > range_start");
    expect(migration).toContain("count(*)::integer as expense_count");
    expect(migration).toContain("where expenses.status = 'rejected'");
  });

  it("does not invent closing values for open shifts", () => {
    expect(migration).toContain("when shifts.closed_at is null then 'open'");
    expect(migration).toContain("when shifts.closed_at is null then 'not_yet_reconciled'");
    expect(migration).toContain("case when reconciliations.id is not null then reconciliations.actual_cash else null end");
  });

  it("parses open and reconciled shift facts", () => {
    const report = parseManagerCashierPeriodReport({ shifts: [
      { id: "open", cashier_id: "one", cashier_name: "Hana", opened_at: "2026-08-15T08:00:00Z", opening_cash: 50, expected_cash: 75, actual_cash: null, variance: null, status: "open", reconciliation_status: "not_yet_reconciled" },
      { id: "closed", cashier_id: "two", cashier_name: "Kadir", opened_at: "2026-08-14T08:00:00Z", closed_at: "2026-08-14T16:00:00Z", opening_cash: 100, expected_cash: 230, actual_cash: 220, variance: -10, status: "closed", reconciliation_status: "reconciled" },
    ] });
    expect(report.shifts[0].actualCash).toBeNull();
    expect(report.shifts[0].reconciliationStatus).toBe("not_yet_reconciled");
    expect(report.shifts[1].variance).toBe(-10);
  });
});

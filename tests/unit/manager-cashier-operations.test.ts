import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replaceAll("\r\n", "\n");
const migration = read("supabase/migrations/236_manager_cashier_operations.sql");
const managerPage = read("src/modules/manager/pages/ManagerOperationsCenterPage.tsx");
const cashierPage = read("src/modules/cashier/pages/CashierDashboardPage.tsx");
const managerCss = read("src/modules/manager/styles/managerOperationsCenter.css");
const realtime = read("src/core/realtime/restaurantEventService.ts");

describe("manager cashier operations", () => {
  it("keeps Cashier supervision inside Live Operations", () => {
    expect(managerPage).toContain('type OperationsView = "service" | "cashier"');
    expect(managerPage).toContain('aria-label="Live Operations workspace"');
    expect(managerPage).toContain(">Cashier <span>");
  });

  it("derives physical drawer cash from cash payments and recognized expenses", () => {
    expect(migration).toContain("public.normalize_payment_method");
    expect(migration).toContain("'Cash'");
    expect(migration).toContain("target.opening_cash+cash_sales-cash_refunds-approved_expenses");
    expect(migration).toContain("cashier_shift_drawer_totals(target_shift.id)");
  });

  it("requires reasons, manager review, two-party handover, and immutable deletion", () => {
    expect(migration).toContain("Expense reason is required.");
    expect(migration).toContain("Manager or owner authority is required.");
    expect(migration).toContain("Only the outgoing cashier may initiate handover.");
    expect(migration).toContain("Only the designated incoming cashier may confirm this handover.");
    expect(migration).toContain("Cash-control records cannot be deleted.");
  });

  it("keeps reads tenant scoped and public access revoked", () => {
    expect(migration).toContain("public.has_shift_admin_role(target_restaurant_id)");
    expect(migration).toContain("cashier_shift_expenses.restaurant_id");
    expect(migration).toContain("cashier_cash_handovers.restaurant_id");
    expect(migration).toContain("revoke all on public.cashier_shift_expenses, public.cashier_cash_handovers from anon, authenticated");
    expect(migration).toContain("revoke all on function public.get_manager_cashier_operations(uuid) from public,anon");
  });

  it("integrates expense and handover controls into the existing cashier workflow", () => {
    expect(cashierPage).toContain("Record Expense");
    expect(cashierPage).toContain('supabase.rpc("record_cashier_shift_expense"');
    expect(cashierPage).toContain('supabase.rpc("initiate_cashier_handover"');
    expect(cashierPage).toContain('supabase.rpc("confirm_cashier_handover"');
    expect(cashierPage).toContain("Expense reason is required.");
  });

  it("refreshes both workspaces through tenant realtime", () => {
    for (const table of ["cashier_shift_expenses", "cashier_cash_handovers"]) {
      expect(realtime).toContain(`"${table}"`);
      expect(managerPage).toContain(`"${table}"`);
      expect(cashierPage).toContain(`"${table}"`);
    }
  });

  it("uses mobile cards instead of forcing the cashier table horizontally", () => {
    expect(managerCss).toContain("@media(max-width:767px)");
    expect(managerCss).toContain(".moc-cashier-table-head{display:none}");
    expect(managerCss).toContain("content:attr(data-label)");
    expect(managerCss).toContain(".moc-cash-secondary{grid-template-columns:1fr}");
  });
});

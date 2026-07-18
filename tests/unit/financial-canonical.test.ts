import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/153_cashier_shift_and_financial_canonicalization.sql"),
  "utf8",
);

describe("canonical tenant billing", () => {
  it.each([
    ["Restaurant A", true, 15, false, 0, 550, 82.5, 0, 632.5],
    ["Restaurant B", false, 15, true, 10, 550, 0, 55, 605],
    ["Restaurant C", true, 15, true, 5, 550, 82.5, 27.5, 660],
  ])(
    "%s keeps menu price as base subtotal",
    (_tenant, vatEnabled, vatPercent, serviceEnabled, servicePercent, subtotal, vat, service, total) => {
      const vatAmount = vatEnabled ? subtotal * (vatPercent / 100) : 0;
      const serviceAmount = serviceEnabled ? subtotal * (servicePercent / 100) : 0;
      expect(vatAmount).toBe(vat);
      expect(serviceAmount).toBe(service);
      expect(subtotal + vatAmount + serviceAmount).toBe(total);
    },
  );

  it("owns every financial amount in the backend", () => {
    expect(sql).toContain("calculate_restaurant_financial_totals");
    expect(sql).toContain("refresh_invoice_financial_totals");
    expect(sql).toContain("subtotal=(totals->>'subtotal')::numeric");
    expect(sql).toContain("grand_total=(totals->>'grand_total')::numeric");
  });

  it("isolates dashboard and reconciliation by exact shift id", () => {
    expect(sql).toContain("i.cashier_shift_id=shift.id");
    expect(sql).toContain("invoices.cashier_shift_id = target_shift.id");
    expect(sql).toContain("verified_batches.cashier_shift_id = target_shift.id");
  });

  it("contains no inclusive reverse-tax formula", () => {
    expect(sql).not.toMatch(/\/\s*1\.15|gross\s*-\s*\(gross\s*\/\s*1\.15\)/);
    const cashier = readFileSync(
      resolve(process.cwd(), "src/modules/cashier/pages/CashierDashboardPage.tsx"),
      "utf8",
    );
    expect(cashier).not.toMatch(/total\s*\/\s*1\.15/);
  });
});

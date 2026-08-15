import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  managerReportPercentageChange,
  parseManagerFinancialReport,
} from "../../src/modules/manager/services/managerFinancialReportsService";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8").replaceAll("\r\n", "\n");
const migration = read("supabase/migrations/237_manager_reports_r2_financial_read_model.sql");
const truth = read("docs/MANAGER_REPORTS_R2_FINANCIAL_TRUTH.md");

describe("Manager Reports R2 financial read model", () => {
  it("uses Manager-only tenant authority and does not reuse Owner reports", () => {
    expect(migration).toContain("public.manager_can_report(target_restaurant_id)");
    expect(migration).not.toContain("owner_can_report");
    expect(migration).not.toContain("get_daily_order_report");
    expect(migration).toContain("invoices.restaurant_id = target_restaurant_id");
    expect(migration).toContain("orders.restaurant_id = target_restaurant_id");
  });

  it("isolates collection, refund, outstanding, and order events by canonical timestamps", () => {
    expect(migration).toContain("invoices.paid_at >= periods.period_start");
    expect(migration).toContain("invoices.refunded_at >= periods.period_start");
    expect(migration).toContain("invoices.created_at >= periods.period_start");
    expect(migration).toContain("orders.created_at >= periods.period_start");
    expect(migration).toContain("invoices.payment_status in ('pending', 'held')");
    expect(migration).toContain("comparison_range_start");
    expect(migration).toContain("comparison_range_end");
  });

  it("uses frozen invoice values and canonical payment normalization", () => {
    for (const field of [
      "grand_total",
      "subtotal",
      "vat_amount",
      "service_charge_amount",
      "discount_amount",
    ]) expect(migration).toContain(`invoices.${field}`);
    expect(migration).toContain("public.normalize_payment_method(invoices.payment_method)");
    expect(migration).not.toContain("vat_percentage");
    expect(migration).not.toContain("service_charge_percentage");
  });

  it("returns explicit provenance flags rather than reconstructing legacy tax", () => {
    expect(migration).toContain("financial_snapshot_version");
    for (const status of ["complete", "mixed_legacy", "legacy_unknown", "unavailable"]) {
      expect(migration).toContain(`'${status}'`);
    }
    expect(truth).toContain("No historical VAT or service charge is reconstructed");
  });

  it("parses current and comparison values without inventing a zero-baseline percentage", () => {
    const report = parseManagerFinancialReport({
      generated_at: "2026-08-15T10:00:00Z",
      current: {
        range_start: "2026-08-15T00:00:00Z",
        range_end: "2026-08-16T00:00:00Z",
        collected_amount: "125.50",
        collected_invoice_count: 2,
        average_paid_invoice: "62.75",
        orders_created: 3,
        payment_methods: [
          { payment_method: "Telebirr", collected_amount: "75.50", invoice_count: 1 },
        ],
        data_quality: { tax_history: "mixed_legacy" },
      },
      comparison: { collected_amount: 0, average_paid_invoice: null },
      definitions: { net_collection: "Collected minus refunds." },
    });
    expect(report.current.collectedAmount).toBe(125.5);
    expect(report.current.averagePaidInvoice).toBe(62.75);
    expect(report.current.paymentMethods[0]).toEqual({
      paymentMethod: "Telebirr",
      collectedAmount: 75.5,
      invoiceCount: 1,
    });
    expect(report.current.dataQuality.taxHistory).toBe("mixed_legacy");
    expect(report.comparison.averagePaidInvoice).toBeNull();
    expect(managerReportPercentageChange(125.5, 0)).toBeNull();
    expect(managerReportPercentageChange(125, 100)).toBe(25);
  });
});


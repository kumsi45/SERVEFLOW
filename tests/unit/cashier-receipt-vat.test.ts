import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFinalBillReviewModel } from "../../src/modules/cashier/pages/CashierDashboardPage";

describe("cashier receipt VAT", () => {
  it("uses frozen paid-invoice VAT in the preview", () => {
    const batch = {
      id: "order-1", invoiceStatus: "paid", subtotal: 750, vatRate: 0.15,
      vatAmount: 112.5, serviceChargeRate: 0, serviceChargeAmount: 0,
      discountAmount: 0, totalPrice: 862.5, paymentMethod: "Cash",
      items: [{ id: "item-1", orderId: "order-1", name: "Burger", quantity: 1, price: 750 }],
      status: "served", customerName: null, tableNumber: "1", createdAt: "2026-07-30T08:00:00Z", paymentVerifiedAt: "2026-07-30T08:05:00Z",
    };
    const model = buildFinalBillReviewModel({
      diningSessionId: "order-1", diningSessionDisplayNumber: "DS-1", diningSessionStatus: "open",
      tableNumber: "1", customerName: null, waiterName: null, createdAt: batch.createdAt,
      latestAt: batch.createdAt, batches: [batch], verifiedTotal: 862.5,
      pendingCount: 0, incompleteItemCount: 0, itemCount: 1,
    } as never, { id: "restaurant-1", name: "Restaurant", logoUrl: null }, "Cashier", "a4");
    expect(model.totals).toMatchObject({ subtotal: 750, vatRate: 0.15, vatAmount: 112.5, grandTotal: 862.5 });
  });

  it("requires the payment queue to expose immutable financial totals", () => {
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202_cashier_receipt_frozen_financial_totals.sql"), "utf8");
    for (const field of ["subtotal", "vat_rate", "vat_amount", "service_charge_rate", "service_charge_amount", "discount_amount"]) {
      expect(migration).toContain(`'${field}'`);
    }
    expect(migration).toContain("'total_price',i.grand_total");
  });
});

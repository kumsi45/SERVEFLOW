import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CashierOrder } from "../../src/modules/cashier/types";
import {
  buildFinalBillPrintHtml,
  buildFinalBillReviewModel,
  CheckoutCreatorAttribution,
  CheckoutSlideOverDrawer,
  paymentDueOrder,
  resolveOrderCreatorAttribution,
  resolveSessionCreatorAttribution,
} from "../../src/modules/cashier/pages/CashierDashboardPage";

function order(overrides: Partial<CashierOrder> = {}): CashierOrder {
  return {
    id: "order-1",
    invoiceId: "invoice-1",
    invoiceSource: "cashier",
    invoiceCreatorName: "abdu",
    invoiceStatus: "pending",
    status: "accepted",
    customerName: null,
    tableNumber: "6",
    orderSource: "cashier",
    waiterName: "abdu",
    paymentMethod: null,
    totalPrice: 100,
    createdAt: "2026-10-06T10:32:10.280Z",
    paymentVerifiedAt: null,
    items: [],
    ...overrides,
  };
}

function session(batches: CashierOrder[]) {
  return {
    diningSessionId: "session-1",
    diningSessionDisplayNumber: "DS-1",
    diningSessionStatus: "open",
    tableNumber: "6",
    customerName: null,
    waiterName: batches.find((batch) => batch.waiterName)?.waiterName ?? null,
    createdAt: batches[0]?.createdAt ?? "2026-10-06T10:32:10.280Z",
    latestAt: batches.at(-1)?.createdAt ?? "2026-10-06T10:32:10.280Z",
    batches,
    verifiedTotal: 0,
    pendingCount: batches.length,
    incompleteItemCount: 0,
    itemCount: 0,
  };
}

function attributionMarkup(value: CashierOrder) {
  return renderToStaticMarkup(<CheckoutCreatorAttribution order={value} />);
}

describe("cashier checkout staff attribution", () => {
  it("renders the reported Table 6 Cashier checkout through the real drawer", () => {
    const markup = renderToStaticMarkup(
      <CheckoutSlideOverDrawer
        order={order()}
        checkoutStatus="payment-due"
        serviceLocationName="Table 6"
        onClose={() => undefined}
        onApprove={() => undefined}
        approving={false}
        paymentReference=""
        paymentTransactionId=""
        paymentScreenshotPreviewUrl={null}
        duplicateReferenceNotice={null}
        collectionPaymentMethod="Cash"
        availablePaymentMethods={[{ method_code: "cash", display_name: "Cash", value: "Cash" }]}
        paymentMethodConfigurationError={null}
        onCollectionPaymentMethodChange={() => undefined}
        formatMoney={(value) => `${value.toFixed(2)} ETB`}
      />,
    );
    expect(markup).toContain("Table 6");
    expect(markup).toContain('aria-label="Cashier: abdu"');
    expect(markup).toContain("Payment Due");
    expect(markup).not.toContain("Waiter: abdu");
  });

  it("renders the canonical Cashier source even when the legacy waiter_name field contains the creator", () => {
    const markup = attributionMarkup(order());
    expect(markup).toContain("Cashier");
    expect(markup).toContain("abdu");
    expect(markup).not.toContain("Waiter");
  });

  it("keeps a Waiter creator when a Cashier later opens checkout", () => {
    const waiterOrder = order({
      invoiceSource: "waiter",
      orderSource: "waiter",
      invoiceCreatorName: "Abdu",
      waiterName: "Abdu",
    });
    expect(attributionMarkup(waiterOrder)).toContain("Waiter");

    const model = buildFinalBillReviewModel(
      session([waiterOrder]) as never,
      { id: "restaurant-1", name: "Restaurant", logoUrl: null },
      "Hana",
      "a4",
    );
    const receipt = buildFinalBillPrintHtml(model);
    expect(receipt).toContain("<span>Waiter</span><strong>Abdu</strong>");
    expect(receipt).toContain("<span>Printed by</span><strong>Hana</strong>");
  });

  it("uses Customer QR for QR work without borrowing the viewing Cashier identity", () => {
    const qrOrder = order({
      invoiceSource: "public_qr",
      orderSource: "public_qr",
      invoiceCreatorName: "Hana",
      waiterName: "Hana",
      customerName: "Guest",
    });
    const markup = attributionMarkup(qrOrder);
    expect(markup).toContain("Customer QR");
    expect(markup).toContain("Guest");
    expect(markup).not.toContain("Waiter");
    expect(markup).not.toContain("Cashier");
  });

  it("labels an aggregated mixed-staff checkout as Staff Multiple", () => {
    const batches = [
      order({ id: "a", invoiceId: "a", invoiceSource: "waiter", orderSource: "waiter", invoiceCreatorName: "Waiter A", waiterName: "Waiter A" }),
      order({ id: "b", invoiceId: "b", invoiceSource: "cashier", orderSource: "cashier", invoiceCreatorName: "Cashier B", waiterName: "Cashier B" }),
      order({ id: "c", invoiceId: "c", invoiceSource: "waiter", orderSource: "waiter", invoiceCreatorName: "Waiter C", waiterName: "Waiter C" }),
    ];
    expect(resolveSessionCreatorAttribution(batches)).toEqual({ label: "Staff", name: "Multiple" });
    const aggregate = paymentDueOrder(session(batches) as never);
    const markup = renderToStaticMarkup(<CheckoutCreatorAttribution order={aggregate} />);
    expect(markup).toContain("Staff");
    expect(markup).toContain("Multiple");
    expect(markup).not.toContain("Waiter A");
    expect(markup).not.toContain("Cashier B");
  });

  it("preserves one creator when multiple due invoices share that creator", () => {
    for (const [source, name, label] of [
      ["cashier", "Cashier A", "Cashier"],
      ["waiter", "Waiter A", "Waiter"],
    ] as const) {
      const batches = [
        order({ id: `${source}-1`, invoiceId: `${source}-1`, invoiceSource: source, orderSource: source, invoiceCreatorName: name, waiterName: name }),
        order({ id: `${source}-2`, invoiceId: `${source}-2`, invoiceSource: source, orderSource: source, invoiceCreatorName: name, waiterName: name }),
      ];
      expect(resolveSessionCreatorAttribution(batches)).toEqual({ label, name });
    }
  });

  it("does not select the first creator when same-role creators differ", () => {
    for (const source of ["cashier", "waiter"] as const) {
      const batches = [
        order({ id: `${source}-1`, invoiceId: `${source}-1`, invoiceSource: source, orderSource: source, invoiceCreatorName: "Staff A", waiterName: "Staff A" }),
        order({ id: `${source}-2`, invoiceId: `${source}-2`, invoiceSource: source, orderSource: source, invoiceCreatorName: "Staff B", waiterName: "Staff B" }),
      ];
      expect(resolveSessionCreatorAttribution(batches)).toEqual({ label: "Staff", name: "Multiple" });
    }
  });

  it("uses a role-neutral fallback when historical creator role/source is missing", () => {
    expect(resolveOrderCreatorAttribution(order({ invoiceSource: null, orderSource: null })))
      .toEqual({ label: "Staff", name: "abdu" });
    expect(resolveOrderCreatorAttribution(order({
      invoiceSource: null,
      orderSource: null,
      invoiceCreatorName: null,
      waiterName: null,
    }))).toEqual({ label: "Customer", name: null });
    expect(resolveOrderCreatorAttribution(order({
      invoiceSource: "cashier",
      orderSource: null,
      invoiceCreatorName: null,
      waiterName: null,
    }))).toEqual({ label: "Cashier", name: null });
  });

  it("prints Cashier-created work with its creator role and name", () => {
    const model = buildFinalBillReviewModel(
      session([order()]) as never,
      { id: "restaurant-1", name: "Restaurant", logoUrl: null },
      "Hana",
      "a4",
    );
    const receipt = buildFinalBillPrintHtml(model);
    expect(receipt).toContain("<span>Cashier</span><strong>abdu</strong>");
    expect(receipt).not.toContain("<span>Waiter</span><strong>abdu</strong>");
  });

  it("prints mixed and QR sessions without false staff attribution", () => {
    const mixed = [
      order({ id: "waiter", invoiceId: "waiter", invoiceSource: "waiter", orderSource: "waiter", invoiceCreatorName: "Abdu", waiterName: "Abdu" }),
      order({ id: "cashier", invoiceId: "cashier", invoiceSource: "cashier", orderSource: "cashier", invoiceCreatorName: "Hana", waiterName: "Hana" }),
    ];
    const mixedReceipt = buildFinalBillPrintHtml(buildFinalBillReviewModel(
      session(mixed) as never,
      { id: "restaurant-1", name: "Restaurant", logoUrl: null },
      "Hana",
      "a4",
    ));
    expect(mixedReceipt).toContain("<span>Staff</span><strong>Multiple</strong>");

    const qr = order({
      invoiceSource: "public_qr",
      orderSource: "public_qr",
      invoiceCreatorName: null,
      waiterName: null,
      customerName: "Guest",
    });
    const qrReceipt = buildFinalBillPrintHtml(buildFinalBillReviewModel(
      session([qr]) as never,
      { id: "restaurant-1", name: "Restaurant", logoUrl: null },
      "Hana",
      "a4",
    ));
    expect(qrReceipt).toContain("<span>Customer QR</span><strong>Guest</strong>");
    expect(qrReceipt).not.toContain("<span>Waiter</span>");
    expect(qrReceipt).not.toContain("<span>Cashier</span><strong>Guest</strong>");
  });

  it("keeps creator name resolution tenant-scoped in the payment queue contract", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "supabase/migrations/202_cashier_receipt_frozen_financial_totals.sql"),
      "utf8",
    );
    expect(migration).toMatch(
      /left join public\.restaurant_staff c on c\.restaurant_id=i\.restaurant_id and c\.id=i\.created_by_staff_id/i,
    );
  });
});

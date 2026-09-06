import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { OperationalStatus, PaymentStatus } from "../../src/core/payment/lifecycle";
import {
  buildOwnerOrdersReadModel,
  normalizeOwnerOrderInvoiceRow,
  type OwnerOrderInvoiceRow,
  type OwnerOrderRow,
} from "../../src/modules/owner/services/ownerOrdersReadModel";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

function order(
  id: string,
  overrides: Partial<OwnerOrderRow> = {},
): OwnerOrderRow {
  return {
    id,
    restaurant_id: TENANT_A,
    display_number: `#${id}`,
    table_id: "table-a",
    table_number: "8",
    dining_session_status: "open",
    customer_name: "Guest",
    order_source: "public_qr",
    created_by_waiter_id: null,
    operational_status: "new",
    payment_method: null,
    total_price: 100,
    created_at: "2026-09-05T10:00:00.000Z",
    completed_at: null,
    table_released_at: null,
    ...overrides,
  };
}

function invoice(
  id: string,
  orderId: string,
  paymentStatus: PaymentStatus | "unknown",
  overrides: Partial<OwnerOrderInvoiceRow> = {},
): OwnerOrderInvoiceRow {
  return {
    id,
    restaurant_id: TENANT_A,
    order_id: orderId,
    payment_status: paymentStatus,
    total_price: 100,
    grand_total: 100,
    payment_method: "Cash",
    invoice_source: "public_qr",
    created_by_staff_id: null,
    created_by_display_name: "Customer QR",
    created_at: "2026-09-05T10:00:00.000Z",
    ...overrides,
  };
}

function build(
  orders: OwnerOrderRow[],
  invoices: OwnerOrderInvoiceRow[] = [],
  options: {
    restaurantId?: string;
    items?: Array<{
      id: string;
      restaurant_id: string;
      order_id: string;
      quantity: number;
    }>;
    staff?: Array<{
      id: string;
      restaurant_id: string;
      display_name: string;
      role: string;
    }>;
  } = {},
) {
  return buildOwnerOrdersReadModel({
    restaurantId: options.restaurantId ?? TENANT_A,
    orders,
    invoices,
    items: options.items ?? [],
    staff: options.staff ?? [],
  });
}

describe("Owner Orders authoritative read model", () => {
  it("isolates orders, invoices, items, and staff names to the authorized tenant", () => {
    const orders = [
      order("a"),
      order("b", { restaurant_id: TENANT_B, created_by_waiter_id: "staff-b" }),
    ];
    const result = build(
      orders,
      [
        invoice("invoice-a", "a", "pending"),
        invoice("foreign-invoice", "a", "paid", { restaurant_id: TENANT_B }),
      ],
      {
        items: [
          { id: "item-a", restaurant_id: TENANT_A, order_id: "a", quantity: 2 },
          { id: "foreign-item", restaurant_id: TENANT_B, order_id: "a", quantity: 9 },
        ],
        staff: [
          {
            id: "staff-b",
            restaurant_id: TENANT_B,
            display_name: "Foreign Staff",
            role: "waiter",
          },
        ],
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
    expect(result[0].itemCount).toBe(2);
    expect(result[0].financial.invoiceCount).toBe(1);
    expect(result[0].creator.people).toEqual([]);
  });

  it("resolves Customer QR without inventing a staff creator", () => {
    const result = build(
      [order("qr")],
      [invoice("qr-invoice", "qr", "pending")],
    )[0];
    expect(result.origin).toMatchObject({
      kind: "customer_qr",
      label: "Customer QR",
      storedValues: ["public_qr"],
    });
    expect(result.creator).toMatchObject({ kind: "none", label: null, people: [] });
  });

  it("resolves authoritative Waiter source and creator", () => {
    const result = build(
      [order("waiter", { order_source: "waiter", created_by_waiter_id: "w1" })],
      [
        invoice("waiter-invoice", "waiter", "held", {
          invoice_source: "waiter",
          created_by_staff_id: "w1",
          created_by_display_name: "Waiter Snapshot",
        }),
      ],
      {
        staff: [
          {
            id: "w1",
            restaurant_id: TENANT_A,
            display_name: "Abdi",
            role: "waiter",
          },
        ],
      },
    )[0];
    expect(result.origin.kind).toBe("waiter");
    expect(result.creator).toMatchObject({ kind: "single", label: "Abdi" });
    expect(result.creator.people[0]).toMatchObject({
      staffId: "w1",
      displayName: "Abdi",
      source: "waiter",
    });
  });

  it("resolves authoritative Cashier source and immutable-name fallback", () => {
    const result = build(
      [order("cashier", { order_source: "cashier" })],
      [
        invoice("cashier-invoice", "cashier", "paid", {
          invoice_source: "cashier",
          created_by_staff_id: "c1",
          created_by_display_name: "Hana",
        }),
      ],
    )[0];
    expect(result.origin.kind).toBe("cashier");
    expect(result.creator).toMatchObject({ kind: "single", label: "Hana" });
  });

  it("keeps authenticated data explicitly legacy instead of creating a fourth V1 source", () => {
    const result = build(
      [order("legacy", { order_source: "authenticated" })],
      [
        invoice("legacy-invoice", "legacy", "paid", {
          invoice_source: "authenticated",
        }),
      ],
    )[0];
    expect(result.origin).toMatchObject({
      kind: "legacy",
      label: "Legacy source",
      storedValues: ["authenticated"],
    });
  });

  it("preserves all operational states and derives Active only for the first four", () => {
    const statuses: OperationalStatus[] = [
      "new",
      "accepted",
      "preparing",
      "ready",
      "served",
      "closed",
    ];
    const result = build(
      statuses.map((status) => order(status, { operational_status: status })),
    );
    expect(result.map((row) => row.operationalStatus)).toEqual(statuses);
    expect(result.map((row) => row.isActive)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it.each(["pending", "held"] as const)(
    "makes Served + %s a first-class Payment Due condition",
    (status) => {
      const result = build(
        [order("served", { operational_status: "served" })],
        [invoice("due", "served", status)],
      )[0];
      expect(result.financial.summary).toBe("payment_due");
      expect(result.financial.hasPaymentDue).toBe(true);
      expect(result.isServedPaymentDue).toBe(true);
    },
  );

  it("keeps Served + Paid out of Payment Due", () => {
    const result = build(
      [order("served", { operational_status: "served" })],
      [invoice("paid", "served", "paid")],
    )[0];
    expect(result.financial.summary).toBe("paid");
    expect(result.financial.hasPaymentDue).toBe(false);
    expect(result.isServedPaymentDue).toBe(false);
  });

  it("does not infer Paid from Closed or payment_method", () => {
    const result = build([
      order("closed", {
        operational_status: "closed",
        payment_method: "Cash",
      }),
    ])[0];
    expect(result.operationalStatus).toBe("closed");
    expect(result.orderPaymentMethod).toBe("Cash");
    expect(result.financial.summary).toBe("no_invoice");
    expect(result.financial.paymentMethodSummary).toBeNull();
  });

  it.each(["pending", "held"] as const)(
    "lets %s dominate Paid across multiple invoices",
    (status) => {
      const result = build(
        [order("multi")],
        [
          invoice("paid", "multi", "paid", { grand_total: 40 }),
          invoice("due", "multi", status, { grand_total: 60 }),
        ],
      )[0];
      expect(result.financial.summary).toBe("payment_due");
      expect(result.financial.amountDue).toBe(60);
      expect(result.financial.paidAmount).toBe(40);
    },
  );

  it("summarizes fully paid invoices and prefers frozen grand totals", () => {
    const result = build(
      [order("paid")],
      [
        invoice("p1", "paid", "paid", { total_price: 999, grand_total: 45 }),
        invoice("p2", "paid", "paid", { grand_total: 55 }),
      ],
    )[0];
    expect(result.financial).toMatchObject({
      summary: "paid",
      invoiceCount: 2,
      totalInvoiced: 100,
      paidAmount: 100,
      amountDue: 0,
    });
  });

  it("keeps refunded, cancelled, and mixed terminal outcomes distinguishable", () => {
    const refunded = build(
      [order("refunded")],
      [invoice("r", "refunded", "refunded", { grand_total: 25 })],
    )[0];
    const cancelled = build(
      [order("cancelled")],
      [invoice("c", "cancelled", "cancelled", { grand_total: 30 })],
    )[0];
    const mixed = build(
      [order("mixed")],
      [
        invoice("m1", "mixed", "paid", { grand_total: 20 }),
        invoice("m2", "mixed", "refunded", { grand_total: 10 }),
      ],
    )[0];
    expect(refunded.financial).toMatchObject({
      summary: "refunded",
      refundedAmount: 25,
    });
    expect(cancelled.financial).toMatchObject({
      summary: "cancelled",
      cancelledAmount: 30,
      totalInvoiced: 0,
    });
    expect(mixed.financial.summary).toBe("mixed_terminal");
  });

  it("represents mixed invoice sources, creators, and payment methods without picking one", () => {
    const result = build(
      [order("mixed", { order_source: "waiter" })],
      [
        invoice("w", "mixed", "paid", {
          invoice_source: "waiter",
          created_by_staff_id: "w1",
          created_by_display_name: "Abdi",
          payment_method: "Cash",
        }),
        invoice("c", "mixed", "paid", {
          invoice_source: "cashier",
          created_by_staff_id: "c1",
          created_by_display_name: "Hana",
          payment_method: "Card",
        }),
      ],
    )[0];
    expect(result.origin).toMatchObject({ kind: "mixed", label: "Mixed sources" });
    expect(result.creator).toMatchObject({ kind: "mixed", label: "Multiple staff" });
    expect(result.creator.people.map((person) => person.displayName)).toEqual([
      "Abdi",
      "Hana",
    ]);
    expect(result.financial.paymentMethods).toEqual(["Cash", "Card"]);
    expect(result.financial.paymentMethodSummary).toBe("Mixed");
  });

  it("treats unexpected invoice state as unknown, never Paid", () => {
    const result = build(
      [order("unknown")],
      [invoice("u", "unknown", "unknown")],
    )[0];
    expect(result.financial.summary).toBe("unknown");
    expect(result.financial.hasPaymentDue).toBe(false);
  });

  it("merges realtime invoice updates and recomputes financial truth safely", () => {
    const pending = invoice("live", "order-live", "pending");
    const updated = normalizeOwnerOrderInvoiceRow(
      { id: "live", payment_status: "paid", grand_total: 125 },
      pending,
    );
    expect(updated).not.toBeNull();
    const result = build([order("order-live")], [updated!])[0];
    expect(result.financial).toMatchObject({
      summary: "paid",
      amountDue: 0,
      paidAmount: 125,
    });
  });
});

describe("Owner Orders read-model integration", () => {
  const page = readFileSync(
    "src/modules/owner/pages/OwnerDashboardPage.tsx",
    "utf8",
  );

  it("uses tenant-scoped batched reads and the existing filtered realtime channel", () => {
    expect(page).toContain("loadOwnerOrderInvoices(restaurantId, orderIds)");
    expect(page).toContain('.eq("restaurant_id", restaurantId)');
    expect(page).toContain('.in("order_id", ids)');
    for (const table of ["orders", "order_items", "order_invoices"]) {
      const subscription = page.slice(
        page.indexOf(`table: "${table}"`),
        page.indexOf(`table: "${table}"`) + 250,
      );
      expect(subscription).toContain(
        "filter: `restaurant_id=eq.${restaurantId}`",
      );
    }
  });

  it("feeds the normalized contract to Owner Orders without adding mutation controls", () => {
    expect(page).toContain("orders={ownerOrdersReadModel}");
    expect(page).toContain("buildOwnerOrdersReadModel({");
    const ordersPage = page.slice(
      page.indexOf("function OrdersPage"),
      page.indexOf("type FinancialPeriod"),
    );
    expect(ordersPage).not.toMatch(/update\(|delete\(|insert\(|rpc\(/);
  });

  it("retains owner-scoped RLS for orders, items, and invoices", () => {
    const orderPolicies = readFileSync(
      "supabase/migrations/020_phase4_rls_multi_tenant_isolation_audit.sql",
      "utf8",
    );
    const invoicePolicies = readFileSync(
      "supabase/migrations/053_invoice_based_billing.sql",
      "utf8",
    );
    expect(orderPolicies).toContain(
      "public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])",
    );
    expect(orderPolicies).toContain(
      "public.has_staff_role(order_items.restaurant_id, array['owner']::public.restaurant_staff_role[])",
    );
    expect(invoicePolicies).toContain(
      "create policy order_invoices_select_staff_same_restaurant",
    );
    expect(invoicePolicies).toContain(
      "public.is_restaurant_member(restaurant_id)",
    );
    expect(invoicePolicies).toContain(
      "public.is_active_restaurant_staff_member(restaurant_id)",
    );
  });
});

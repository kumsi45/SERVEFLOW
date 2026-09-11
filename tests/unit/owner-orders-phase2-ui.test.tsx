import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OperationalStatus, PaymentStatus } from "../../src/core/payment/lifecycle";
import {
  OwnerOrderDetails,
  OwnerOrdersView,
  filterOwnerOrders,
  formatOwnerOrderTime,
  ownerFinancialLabel,
  ownerOrderSourceLabel,
  summarizeOwnerOrders,
  type OwnerOrdersFilters,
} from "../../src/modules/owner/components/orders/OwnerOrdersView";
import {
  buildOwnerOrdersReadModel,
  type OwnerOrderInvoiceRow,
  type OwnerOrderReadModel,
  type OwnerOrderRow,
} from "../../src/modules/owner/services/ownerOrdersReadModel";

const ownerOrdersViewSource = readFileSync(
  "src/modules/owner/components/orders/OwnerOrdersView.tsx",
  "utf8",
);

const TENANT = "owner-orders-phase2";

function order(
  id: string,
  status: OperationalStatus,
  source: string,
  overrides: Partial<OwnerOrderRow> = {},
): OwnerOrderRow {
  return {
    id,
    restaurant_id: TENANT,
    display_number: `#${id.toUpperCase()}`,
    table_id: `table-${id}`,
    table_number: id.slice(-1),
    dining_session_status: status === "closed" ? "closed" : "open",
    customer_name: `Guest ${id}`,
    order_source: source,
    created_by_waiter_id: null,
    operational_status: status,
    payment_method: "TeleBirr",
    total_price: 100,
    created_at: "2026-09-05T10:00:00.000Z",
    completed_at: status === "served" || status === "closed"
      ? "2026-09-05T10:30:00.000Z"
      : null,
    table_released_at: status === "closed"
      ? "2026-09-05T10:45:00.000Z"
      : null,
    ...overrides,
  };
}

function invoice(
  id: string,
  orderId: string,
  status: PaymentStatus,
  source: string,
  amount: number,
  creatorId: string | null = null,
  creatorName: string | null = null,
): OwnerOrderInvoiceRow {
  return {
    id,
    restaurant_id: TENANT,
    order_id: orderId,
    payment_status: status,
    total_price: amount,
    grand_total: amount,
    payment_method: status === "paid" ? "Cash" : null,
    invoice_source: source,
    created_by_staff_id: creatorId,
    created_by_display_name: creatorName,
    created_at: "2026-09-05T10:00:00.000Z",
  };
}

const orders = [
  order("qr1", "new", "public_qr", { customer_name: "Mimi" }),
  order("wt2", "ready", "waiter", { created_by_waiter_id: "waiter-abdi" }),
  order("ws3", "served", "waiter", { created_by_waiter_id: "waiter-hana" }),
  order("cs4", "closed", "cashier"),
  order("lg5", "closed", "authenticated"),
  order("mx6", "accepted", "waiter"),
  order("ni7", "closed", "cashier"),
];

const invoices = [
  invoice("i-qr", "qr1", "pending", "public_qr", 25),
  invoice("i-wt", "wt2", "paid", "waiter", 40, "waiter-abdi", "Abdi"),
  invoice("i-ws", "ws3", "held", "waiter", 60, "waiter-hana", "Hana"),
  invoice("i-cs", "cs4", "refunded", "cashier", 70, "cashier-sara", "Sara"),
  invoice("i-mx-w", "mx6", "paid", "waiter", 30, "waiter-abdi", "Abdi"),
  invoice("i-mx-c", "mx6", "cancelled", "cashier", 20, "cashier-sara", "Sara"),
];

const models = buildOwnerOrdersReadModel({
  restaurantId: TENANT,
  orders,
  invoices,
  items: orders.map((entry, index) => ({
    id: `item-${entry.id}`,
    restaurant_id: TENANT,
    order_id: entry.id,
    quantity: index + 1,
  })),
  staff: [
    { id: "waiter-abdi", restaurant_id: TENANT, display_name: "Abdi", role: "waiter" },
    { id: "waiter-hana", restaurant_id: TENANT, display_name: "Hana", role: "waiter" },
    { id: "cashier-sara", restaurant_id: TENANT, display_name: "Sara", role: "cashier" },
  ],
});

const baseFilters: OwnerOrdersFilters = {
  search: "",
  primary: "all",
  operational: "all",
  source: "all",
  payment: "all",
};

function renderView(nextOrders: OwnerOrderReadModel[] = models) {
  return renderToStaticMarkup(
    <OwnerOrdersView
      orders={nextOrders}
      loading={false}
      financialAvailable
      formatMoney={(value) => `ETB ${value.toFixed(2)}`}
    />,
  );
}

describe("Owner Orders Phase 2 presentation", () => {
  it("removes the KDS-like hero, lanes, and duplicate Active Orders pill", () => {
    const markup = renderView();
    expect(markup).not.toContain("Live Order Center");
    expect(markup).not.toContain("Real-time operational command center");
    expect(markup).not.toContain("od-kanban");
    expect(markup).not.toContain("od-order-lane");
    expect(markup).not.toContain("Active Orders");
    expect(markup).not.toContain("<h1>Orders</h1>");
    expect(markup.indexOf('class="od-orders-summary"')).toBeGreaterThan(-1);
    expect(markup.indexOf('class="od-orders-summary"')).toBeLessThan(
      markup.indexOf('class="od-orders-toolbar"'),
    );
  });

  it("summarizes Active, authoritative Payment Due amount, Ready, and Served", () => {
    expect(summarizeOwnerOrders(models)).toEqual({
      active: 3,
      paymentDue: 2,
      paymentDueAmount: 85,
      ready: 1,
      served: 1,
    });
    const markup = renderView();
    expect(markup).toContain('class="od-orders-summary"');
    expect(markup).toContain("ETB 85.00");
  });

  it("maps every Phase 1 financial state truthfully", () => {
    expect([
      "payment_due",
      "paid",
      "refunded",
      "cancelled",
      "mixed_terminal",
      "no_invoice",
      "unknown",
    ].map((state) => ownerFinancialLabel(state as OwnerOrderReadModel["financial"]["summary"]))).toEqual([
      "Payment Due",
      "Paid",
      "Refunded",
      "Cancelled",
      "Mixed",
      "No Invoice",
      "Unknown",
    ]);
  });

  it("keeps Served and Payment Due as two visible states", () => {
    const servedDue = models.find((entry) => entry.id === "ws3")!;
    expect(servedDue.isServedPaymentDue).toBe(true);
    const markup = renderView([servedDue]);
    expect(markup).toContain("Served");
    expect(markup).toContain("Payment Due");
    expect(markup).toContain("served-payment-due");
  });

  it("does not infer Paid from Closed or the order payment method", () => {
    const noInvoice = models.find((entry) => entry.id === "ni7")!;
    const markup = renderView([noInvoice]);
    expect(markup).toContain("Closed");
    expect(markup).toContain("No Invoice");
    expect(markup).not.toContain("Paid");
    expect(markup).not.toContain("TeleBirr");
  });

  it("renders Customer QR, authoritative Waiter and Cashier creators", () => {
    expect(ownerOrderSourceLabel(models.find((entry) => entry.id === "qr1")!)).toBe("Customer QR");
    expect(ownerOrderSourceLabel(models.find((entry) => entry.id === "wt2")!)).toBe("Waiter \u00b7 Abdi");
    expect(ownerOrderSourceLabel(models.find((entry) => entry.id === "cs4")!)).toBe("Cashier \u00b7 Sara");
  });

  it("keeps mixed and legacy origins truthful", () => {
    expect(ownerOrderSourceLabel(models.find((entry) => entry.id === "mx6")!)).toBe("Mixed sources");
    expect(ownerOrderSourceLabel(models.find((entry) => entry.id === "lg5")!)).toBe("Legacy");
    const markup = renderView();
    expect(ownerOrdersViewSource).toContain('<option value="customer_qr">Customer QR</option>');
    expect(ownerOrdersViewSource).toContain('<option value="waiter">Waiter</option>');
    expect(ownerOrdersViewSource).toContain('<option value="cashier">Cashier</option>');
    expect(ownerOrdersViewSource).not.toContain('<option value="mixed">Mixed</option>');
    expect(ownerOrdersViewSource).not.toContain('<option value="legacy">Legacy</option>');
    expect(ownerOrdersViewSource).not.toContain('<option value="unknown">Unknown</option>');
    expect(markup).not.toMatch(/Takeaway|Delivery|Customer App/);
  });

  it("keeps exceptional financial states truthful while hiding them from the filter", () => {
    const markup = renderView();
    expect(markup).toContain("Mixed");
    expect(markup).toContain("No Invoice");
    expect(ownerFinancialLabel("unknown")).toBe("Unknown");
    expect(ownerOrdersViewSource).not.toContain('<option value="mixed_terminal">Mixed</option>');
    expect(ownerOrdersViewSource).not.toContain('<option value="no_invoice">No Invoice</option>');
    expect(ownerOrdersViewSource).not.toContain('<option value="unknown">Unknown</option>');
  });

  it.each([
    ["all", 7],
    ["active", 3],
    ["payment_due", 2],
    ["served", 1],
    ["closed", 3],
  ] as const)("supports the %s primary filter", (primary, count) => {
    expect(filterOwnerOrders(models, { ...baseFilters, primary })).toHaveLength(count);
  });

  it("supports secondary operational, source, and financial filtering", () => {
    for (const status of ["new", "accepted", "ready", "served", "closed"] as const) {
      expect(filterOwnerOrders(models, { ...baseFilters, operational: status }).length).toBeGreaterThan(0);
    }
    expect(filterOwnerOrders(models, { ...baseFilters, source: "customer_qr" }).map((entry) => entry.id)).toEqual(["qr1"]);
    expect(filterOwnerOrders(models, { ...baseFilters, payment: "refunded" }).map((entry) => entry.id)).toEqual(["cs4"]);
  });

  it.each([
    ["#QR1", "qr1"],
    ["1", "qr1"],
    ["Mimi", "qr1"],
    ["Abdi", "wt2"],
  ])("searches safe human-readable value %s", (search, expectedId) => {
    expect(filterOwnerOrders(models, { ...baseFilters, search }).map((entry) => entry.id)).toContain(expectedId);
  });

  it("does not search raw session UUIDs", () => {
    const secret = { ...models[0], id: "raw-session-secret" };
    expect(filterOwnerOrders([secret], { ...baseFilters, search: "raw-session-secret" })).toEqual([]);
  });

  it("renders the required dense desktop columns and a dedicated mobile list", () => {
    const markup = renderView();
    for (const heading of ["Order", "Table", "Source", "Status", "Payment", "Total", "Time"]) {
      expect(markup).toContain(`<th>${heading}</th>`);
    }
    expect(markup).toContain('class="od-orders-desktop-table"');
    expect(markup).toContain('class="od-orders-mobile-list"');
    expect(markup).toContain('class="od-orders-mobile-row');
  });

  it("uses compact empty and unavailable-financial states", () => {
    expect(renderView([])).toContain("No orders yet");
    const unavailable = renderToStaticMarkup(
      <OwnerOrdersView orders={models} loading={false} financialAvailable={false} formatMoney={(value) => `ETB ${value}`} />,
    );
    expect(unavailable).toContain("Unavailable");
    expect(unavailable).not.toContain("ETB 0");
    expect(unavailable).toContain("#QR1");
    expect(unavailable).toContain("#WT2");
    expect(unavailable).toContain("#WS3");
    expect(unavailable).toMatch(/Active<\/span><strong>3<\/strong>/);
    expect(unavailable).toMatch(/Ready<\/span><strong>1<\/strong>/);
    expect(unavailable).toMatch(/Served<\/span><strong>1<\/strong>/);
    expect(unavailable).not.toContain("No orders yet");
  });

  it("keeps finance unavailable distinct from every authoritative financial state", () => {
    const unavailable = renderToStaticMarkup(
      <OwnerOrdersView orders={models} loading={false} financialAvailable={false} formatMoney={(value) => `ETB ${value}`} />,
    );
    expect(unavailable).toContain('class="unavailable">Unavailable</strong>');
    expect(unavailable).toContain("financial-unavailable");
    expect(unavailable).not.toContain("financial-payment_due");
    expect(unavailable).not.toContain("financial-paid");
    expect(unavailable).not.toContain("financial-no_invoice");
    expect(unavailable).not.toContain("financial-unknown");
  });

  it("uses relative time for recent orders and dates for history", () => {
    const now = new Date("2026-09-06T12:00:00.000Z");
    expect(formatOwnerOrderTime("2026-09-06T11:52:00.000Z", now)).toBe("8m");
    expect(formatOwnerOrderTime("2026-09-05T09:15:00.000Z", now)).toMatch(/^Yesterday \u00b7/);
    expect(formatOwnerOrderTime("2026-08-28T14:10:00.000Z", now)).toMatch(/^Aug 28 \u00b7/);
  });

  it("keeps the details surface read-only and exposes authoritative context", () => {
    const markup = renderToStaticMarkup(
      <OwnerOrderDetails
        order={models.find((entry) => entry.id === "mx6")!}
        financialAvailable
        formatMoney={(value) => `ETB ${value.toFixed(2)}`}
        onClose={() => undefined}
      />,
    );
    for (const section of ["Order", "Origin", "Service", "Payment"]) {
      expect(markup).toContain(`<h3>${section}</h3>`);
    }
    expect(markup).toContain("Waiter");
    expect(markup).toContain("Abdi");
    expect(markup).toContain("Cashier");
    expect(markup).toContain("Sara");
    expect(markup).not.toMatch(/Verify Payment|Release Table|Start Preparing|Mark Ready|Serve Order|Refund Order|Cancel Order/);
  });
});

describe("Owner Orders Phase 2 responsive contract", () => {
  const styles = readFileSync(
    "src/modules/owner/styles/ownerDashboard.css",
    "utf8",
  );
  const page = readFileSync(
    "src/modules/owner/pages/OwnerDashboardPage.tsx",
    "utf8",
  );

  it("removes orphaned Owner KDS CSS", () => {
    for (const selector of [
      ".od-kanban",
      ".od-order-lane",
      ".od-active-pill-large",
      ".od-lane-empty",
    ]) {
      expect(styles).not.toContain(selector);
    }
  });

  it("switches to mobile rows without a forced desktop-width Orders table", () => {
    expect(styles).toMatch(/@media\(max-width:760px\)[\s\S]*?\.od-orders-desktop-table\{display:none\}/);
    expect(styles).toMatch(/@media\(max-width:760px\)[\s\S]*?\.od-orders-mobile-list\{display:grid/);
    expect(styles).not.toMatch(/\.od-orders-experience[^}]*min-width:\s*720px/);
    expect(styles).not.toContain(".od-orders-experience .od-table");
  });

  it("keeps mobile controls fluid and clears the approved bottom navigation", () => {
    expect(styles).toContain("grid-template-columns:repeat(5,minmax(0,1fr))");
    expect(styles).toContain("calc(132px + env(safe-area-inset-bottom))");
    expect(styles).toContain("text-overflow:ellipsis");
  });

  it("keeps Owner Orders wired to the Phase 1 model with no mutations", () => {
    expect(page).toContain("orders={ownerOrdersReadModel}");
    expect(page).toContain("financialAvailable={ownerOrdersFinancialAvailable}");
    const viewStart = ownerOrdersViewSource.indexOf(
      "export function OwnerOrdersView",
    );
    expect(viewStart).toBeGreaterThan(-1);
    const ownerOrdersView = ownerOrdersViewSource.slice(viewStart);
    expect(ownerOrdersView).toContain("orders: OwnerOrderReadModel[]");
    expect(ownerOrdersView).not.toMatch(
      /\bsupabase\b|\.(?:rpc|insert|update|delete)\s*\(/,
    );
  });

  it("implements modal focus containment, Escape close, inert background, and trigger restoration", () => {
    const detailStart = ownerOrdersViewSource.indexOf(
      "export function OwnerOrderDetails",
    );
    const detailEnd = ownerOrdersViewSource.indexOf(
      "export function OwnerOrdersView",
    );
    expect(detailStart).toBeGreaterThan(-1);
    expect(detailEnd).toBeGreaterThan(detailStart);
    const details = ownerOrdersViewSource.slice(detailStart, detailEnd);
    expect(details).toContain('event.key === "Escape"');
    expect(details).toContain('event.key !== "Tab"');
    expect(details).toContain("last.focus()");
    expect(details).toContain("first.focus()");
    expect(ownerOrdersViewSource).toContain('element.setAttribute("inert", "")');
    expect(ownerOrdersViewSource).toContain("detailTriggerRef.current?.focus()");
  });

  it("commits operational Orders before unrelated dashboard financial checks", () => {
    const commit = page.indexOf("setOrders(snapshot.orders)");
    const ready = page.indexOf('markResource("orders", "ready")');
    const unrelatedFinancialFailure = page.indexOf(
      "if (paymentError) throw new Error(paymentError.message)",
    );
    expect(commit).toBeGreaterThan(-1);
    expect(ready).toBeGreaterThan(commit);
    expect(unrelatedFinancialFailure).toBeGreaterThan(commit);
    expect(page).toContain("financialAvailable: financialWarning === null");
    expect(page).toContain("invoices: invoiceResult.invoices");
  });
});

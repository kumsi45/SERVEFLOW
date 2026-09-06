import type {
  OperationalStatus,
  PaymentStatus,
} from "../../../core/payment/lifecycle";

export const OWNER_ACTIVE_OPERATIONAL_STATUSES: readonly OperationalStatus[] = [
  "new",
  "accepted",
  "preparing",
  "ready",
];

export type OwnerOrderSourceKind =
  | "customer_qr"
  | "waiter"
  | "cashier"
  | "legacy"
  | "mixed"
  | "unknown";

export type OwnerOrderFinancialSummary =
  | "payment_due"
  | "paid"
  | "refunded"
  | "cancelled"
  | "mixed_terminal"
  | "no_invoice"
  | "unknown";

export type OwnerOrderRow = {
  id: string;
  restaurant_id: string;
  display_number: string | null;
  table_id: string | null;
  table_number: string | null;
  dining_session_status: string | null;
  customer_name: string | null;
  order_source: string | null;
  created_by_waiter_id: string | null;
  operational_status: OperationalStatus;
  payment_method: string | null;
  total_price: number;
  created_at: string;
  completed_at: string | null;
  table_released_at: string | null;
};

export type OwnerOrderItemRow = {
  id: string;
  restaurant_id: string;
  order_id: string;
  quantity: number;
};

export type OwnerOrderInvoiceRow = {
  id: string;
  restaurant_id: string;
  order_id: string;
  payment_status: PaymentStatus | "unknown";
  total_price: number;
  grand_total: number | null;
  payment_method: string | null;
  invoice_source: string | null;
  created_by_staff_id: string | null;
  created_by_display_name: string | null;
  created_at: string;
};

export type OwnerOrderStaffRow = {
  id: string;
  restaurant_id: string;
  display_name: string | null;
  role: string;
};

export type OwnerOrderCreator = {
  staffId: string | null;
  displayName: string;
  source: "waiter" | "cashier";
};

export type OwnerOrderReadModel = {
  id: string;
  restaurantId: string;
  displayNumber: string | null;
  tableId: string | null;
  tableNumber: string | null;
  diningSessionStatus: string | null;
  customerName: string | null;
  createdAt: string;
  completedAt: string | null;
  tableReleasedAt: string | null;
  itemCount: number;
  operationalStatus: OperationalStatus;
  isActive: boolean;
  total: number;
  orderPaymentMethod: string | null;
  origin: {
    kind: OwnerOrderSourceKind;
    label: string;
    orderStoredValue: string | null;
    invoiceStoredValues: string[];
    storedValues: string[];
  };
  creator: {
    kind: "none" | "single" | "mixed" | "unavailable";
    label: string | null;
    people: OwnerOrderCreator[];
  };
  financial: {
    summary: OwnerOrderFinancialSummary;
    invoiceCount: number;
    statuses: Array<PaymentStatus | "unknown">;
    statusCounts: Record<PaymentStatus | "unknown", number>;
    hasPaymentDue: boolean;
    hasPending: boolean;
    hasHeld: boolean;
    amountDue: number;
    totalInvoiced: number;
    paidAmount: number;
    refundedAmount: number;
    cancelledAmount: number;
    paymentMethods: string[];
    paymentMethodSummary: string | null;
  };
  isServedPaymentDue: boolean;
};

export function mergeOwnerOrderCoverage<T extends OwnerOrderRow>(
  ...groups: ReadonlyArray<readonly T[]>
): T[] {
  const byId = new Map<string, T>();
  for (const group of groups) {
    for (const order of group) byId.set(order.id, order);
  }
  return [...byId.values()].sort(
    (left, right) =>
      new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
  );
}

export function ownerOrdersRealtimeRecovery(
  recoveryPending: boolean,
  state: "connecting" | "connected" | "reconnecting",
) {
  const shouldRefresh = recoveryPending && state === "connected";
  return {
    recoveryPending:
      state === "reconnecting"
        ? true
        : shouldRefresh
          ? false
          : recoveryPending,
    shouldRefresh,
  };
}

const PAYMENT_STATUSES = new Set<string>([
  "pending",
  "held",
  "paid",
  "refunded",
  "cancelled",
]);

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeMoney(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function normalizeOwnerOrderInvoiceRow(
  value: Record<string, unknown>,
  previous?: OwnerOrderInvoiceRow,
): OwnerOrderInvoiceRow | null {
  const id = cleanText(value.id) ?? previous?.id ?? null;
  const restaurantId =
    cleanText(value.restaurant_id) ?? previous?.restaurant_id ?? null;
  const orderId = cleanText(value.order_id) ?? previous?.order_id ?? null;
  if (!id || !restaurantId || !orderId) return null;

  const rawPaymentStatus =
    cleanText(value.payment_status)?.toLowerCase() ??
    previous?.payment_status ??
    "unknown";
  const paymentStatus = PAYMENT_STATUSES.has(rawPaymentStatus)
    ? (rawPaymentStatus as PaymentStatus)
    : "unknown";

  return {
    id,
    restaurant_id: restaurantId,
    order_id: orderId,
    payment_status: paymentStatus,
    total_price:
      value.total_price === undefined
        ? (previous?.total_price ?? 0)
        : safeMoney(value.total_price),
    grand_total:
      value.grand_total === undefined
        ? (previous?.grand_total ?? null)
        : value.grand_total === null
          ? null
          : safeMoney(value.grand_total),
    payment_method:
      value.payment_method === undefined
        ? (previous?.payment_method ?? null)
        : cleanText(value.payment_method),
    invoice_source:
      value.invoice_source === undefined
        ? (previous?.invoice_source ?? null)
        : cleanText(value.invoice_source)?.toLowerCase() ?? null,
    created_by_staff_id:
      value.created_by_staff_id === undefined
        ? (previous?.created_by_staff_id ?? null)
        : cleanText(value.created_by_staff_id),
    created_by_display_name:
      value.created_by_display_name === undefined
        ? (previous?.created_by_display_name ?? null)
        : cleanText(value.created_by_display_name),
    created_at:
      cleanText(value.created_at) ?? previous?.created_at ?? "",
  };
}

function invoiceAmount(invoice: OwnerOrderInvoiceRow) {
  return invoice.grand_total === null
    ? safeMoney(invoice.total_price)
    : safeMoney(invoice.grand_total);
}

function sourceKind(value: string | null): Exclude<OwnerOrderSourceKind, "mixed"> {
  const source = cleanText(value)?.toLowerCase();
  if (source === "public_qr") return "customer_qr";
  if (source === "waiter") return "waiter";
  if (source === "cashier") return "cashier";
  if (source === "authenticated") return "legacy";
  return "unknown";
}

function sourceLabel(kind: OwnerOrderSourceKind) {
  if (kind === "customer_qr") return "Customer QR";
  if (kind === "waiter") return "Waiter";
  if (kind === "cashier") return "Cashier";
  if (kind === "legacy") return "Legacy source";
  if (kind === "mixed") return "Mixed sources";
  return "Source unavailable";
}

function creatorSnapshotName(value: string | null) {
  const name = cleanText(value);
  if (!name) return null;
  if (["waiter", "cashier", "unknown", "customer qr"].includes(name.toLowerCase())) {
    return null;
  }
  return name;
}

function emptyStatusCounts(): Record<PaymentStatus | "unknown", number> {
  return {
    pending: 0,
    held: 0,
    paid: 0,
    refunded: 0,
    cancelled: 0,
    unknown: 0,
  };
}

function financialSummary(
  counts: Record<PaymentStatus | "unknown", number>,
  invoiceCount: number,
): OwnerOrderFinancialSummary {
  if (invoiceCount === 0) return "no_invoice";
  if (counts.pending > 0 || counts.held > 0) return "payment_due";
  if (counts.unknown > 0) return "unknown";
  if (counts.paid === invoiceCount) return "paid";
  if (counts.refunded === invoiceCount) return "refunded";
  if (counts.cancelled === invoiceCount) return "cancelled";
  return "mixed_terminal";
}

export function buildOwnerOrdersReadModel(input: {
  restaurantId: string;
  orders: readonly OwnerOrderRow[];
  items: readonly OwnerOrderItemRow[];
  invoices: readonly OwnerOrderInvoiceRow[];
  staff: readonly OwnerOrderStaffRow[];
}): OwnerOrderReadModel[] {
  const tenantOrders = input.orders.filter(
    (order) => order.restaurant_id === input.restaurantId,
  );
  const orderIds = new Set(tenantOrders.map((order) => order.id));
  const tenantItems = input.items.filter(
    (item) =>
      item.restaurant_id === input.restaurantId && orderIds.has(item.order_id),
  );
  const tenantInvoices = input.invoices.filter(
    (invoice) =>
      invoice.restaurant_id === input.restaurantId &&
      orderIds.has(invoice.order_id),
  );
  const staffById = new Map(
    input.staff
      .filter((member) => member.restaurant_id === input.restaurantId)
      .map((member) => [member.id, member]),
  );
  const itemCountByOrder = new Map<string, number>();
  for (const item of tenantItems) {
    itemCountByOrder.set(
      item.order_id,
      (itemCountByOrder.get(item.order_id) ?? 0) + Math.max(0, item.quantity),
    );
  }
  const invoicesByOrder = new Map<string, OwnerOrderInvoiceRow[]>();
  for (const invoice of tenantInvoices) {
    const rows = invoicesByOrder.get(invoice.order_id) ?? [];
    rows.push(invoice);
    invoicesByOrder.set(invoice.order_id, rows);
  }

  return tenantOrders.map((order) => {
    const invoices = invoicesByOrder.get(order.id) ?? [];
    const statusCounts = emptyStatusCounts();
    const methods = new Set<string>();
    let amountDue = 0;
    let totalInvoiced = 0;
    let paidAmount = 0;
    let refundedAmount = 0;
    let cancelledAmount = 0;

    for (const invoice of invoices) {
      statusCounts[invoice.payment_status] += 1;
      const amount = invoiceAmount(invoice);
      if (invoice.payment_status !== "cancelled") totalInvoiced += amount;
      if (invoice.payment_status === "pending" || invoice.payment_status === "held") {
        amountDue += amount;
      }
      if (invoice.payment_status === "paid") paidAmount += amount;
      if (invoice.payment_status === "refunded") refundedAmount += amount;
      if (invoice.payment_status === "cancelled") cancelledAmount += amount;
      const method = cleanText(invoice.payment_method);
      if (method) methods.add(method);
    }

    const invoiceStoredSources = new Set<string>();
    for (const invoice of invoices) {
      const invoiceSource = cleanText(invoice.invoice_source)?.toLowerCase();
      if (invoiceSource) invoiceStoredSources.add(invoiceSource);
    }
    const orderStoredSource = cleanText(order.order_source)?.toLowerCase() ?? null;
    const normalizedInvoiceSources = [...invoiceStoredSources].filter(
      (source) => sourceKind(source) !== "unknown",
    );
    const presentationSources =
      normalizedInvoiceSources.length > 0
        ? normalizedInvoiceSources
        : orderStoredSource
          ? [orderStoredSource]
          : [];
    const sourceKinds = new Set(
      presentationSources.map(sourceKind),
    );
    const originKind: OwnerOrderSourceKind =
      sourceKinds.size > 1
        ? "mixed"
        : sourceKinds.values().next().value ?? "unknown";

    const creators = new Map<string, OwnerOrderCreator>();
    for (const invoice of invoices) {
      const source = sourceKind(cleanText(invoice.invoice_source)?.toLowerCase() ?? null);
      if (source !== "waiter" && source !== "cashier") continue;
      const staffMember = invoice.created_by_staff_id
        ? staffById.get(invoice.created_by_staff_id)
        : undefined;
      const displayName =
        cleanText(staffMember?.display_name) ??
        creatorSnapshotName(invoice.created_by_display_name);
      if (!displayName) continue;
      const key = invoice.created_by_staff_id
        ? `staff:${invoice.created_by_staff_id}`
        : `${source}:snapshot:${displayName.toLowerCase()}`;
      creators.set(key, {
        staffId: invoice.created_by_staff_id,
        displayName,
        source,
      });
    }
    if (
      invoices.length === 0 &&
      creators.size === 0 &&
      sourceKind(order.order_source) === "waiter"
    ) {
      const waiter = order.created_by_waiter_id
        ? staffById.get(order.created_by_waiter_id)
        : undefined;
      const displayName = cleanText(waiter?.display_name);
      if (displayName) {
        creators.set(`staff:${waiter!.id}`, {
          staffId: waiter!.id,
          displayName,
          source: "waiter",
        });
      }
    }
    const people = [...creators.values()];
    const creatorKind =
      people.length > 1
        ? "mixed"
        : people.length === 1
          ? "single"
          : originKind === "customer_qr"
            ? "none"
            : "unavailable";
    const summary = financialSummary(statusCounts, invoices.length);
    const paymentMethods = [...methods];

    return {
      id: order.id,
      restaurantId: order.restaurant_id,
      displayNumber: order.display_number,
      tableId: order.table_id,
      tableNumber: order.table_number,
      diningSessionStatus: order.dining_session_status,
      customerName: order.customer_name,
      createdAt: order.created_at,
      completedAt: order.completed_at,
      tableReleasedAt: order.table_released_at,
      itemCount: itemCountByOrder.get(order.id) ?? 0,
      operationalStatus: order.operational_status,
      isActive: OWNER_ACTIVE_OPERATIONAL_STATUSES.includes(
        order.operational_status,
      ),
      total: safeMoney(order.total_price),
      orderPaymentMethod: order.payment_method,
      origin: {
        kind: originKind,
        label: sourceLabel(originKind),
        orderStoredValue: orderStoredSource,
        invoiceStoredValues: [...invoiceStoredSources],
        storedValues: [
          ...new Set(
            [orderStoredSource, ...invoiceStoredSources].filter(
              (source): source is string => source !== null,
            ),
          ),
        ],
      },
      creator: {
        kind: creatorKind,
        label:
          creatorKind === "single"
            ? people[0].displayName
            : creatorKind === "mixed"
              ? "Multiple staff"
              : null,
        people,
      },
      financial: {
        summary,
        invoiceCount: invoices.length,
        statuses: Object.entries(statusCounts)
          .filter(([, count]) => count > 0)
          .map(([status]) => status as PaymentStatus | "unknown"),
        statusCounts,
        hasPaymentDue: summary === "payment_due",
        hasPending: statusCounts.pending > 0,
        hasHeld: statusCounts.held > 0,
        amountDue,
        totalInvoiced,
        paidAmount,
        refundedAmount,
        cancelledAmount,
        paymentMethods,
        paymentMethodSummary:
          paymentMethods.length > 1 ? "Mixed" : paymentMethods[0] ?? null,
      },
      isServedPaymentDue:
        order.operational_status === "served" && summary === "payment_due",
    };
  });
}

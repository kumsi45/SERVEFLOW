import { waiterSupabase } from "../../waiter-auth/services/waiterAuthService";
import {
  canonicalOperationalStatus,
  canonicalPaymentStatus,
} from "../../../core/payment/lifecycle";
import type {
  WaiterDashboardTable,
  WaiterSessionDetail,
  WaiterSessionInvoice,
  WaiterTableMetric,
  WaiterTableStatus,
} from "../types";

type WaiterDashboardRow = {
  restaurant_id: string;
  restaurant_slug: string;
  restaurant_name: string;
  restaurant_logo_url: string | null;
  waiter_staff_id: string;
  waiter_display_name: string;
  current_shift: string | null;
  assignment_mode: "assigned_tables" | "all_tables";
  table_id: string;
  table_number: number;
  table_label: string | null;
  seats: number | string | null;
  table_active: boolean;
  assigned_waiter_staff_id: string | null;
  assigned_waiter_name: string | null;
  table_status: WaiterTableStatus;
  active_order_id: string | null;
  active_order_status: string | null;
  active_order_source: string | null;
  qr_customer_name: string | null;
  active_order_created_at: string | null;
};

function normalizeTable(row: WaiterDashboardRow): WaiterDashboardTable {
  return {
    restaurantId: row.restaurant_id,
    restaurantSlug: row.restaurant_slug,
    restaurantName: row.restaurant_name,
    restaurantLogoUrl: row.restaurant_logo_url,
    waiterStaffId: row.waiter_staff_id,
    waiterDisplayName: row.waiter_display_name,
    currentShift: row.current_shift || "Current Shift",
    assignmentMode: row.assignment_mode,
    tableId: row.table_id,
    tableNumber: Number(row.table_number),
    tableLabel: row.table_label,
    seats: Number(row.seats ?? 4),
    tableActive: row.table_active,
    assignedWaiterStaffId: row.assigned_waiter_staff_id,
    assignedWaiterName: row.assigned_waiter_name,
    tableStatus: row.table_status,
    activeOrderId: row.active_order_id,
    activeOrderStatus: row.active_order_status,
    activeOrderSource: row.active_order_source,
    qrCustomerName: row.qr_customer_name,
    activeOrderCreatedAt: row.active_order_created_at,
  };
}

export async function loadWaiterSessionDetail(
  orderId: string,
  restaurantId: string,
): Promise<WaiterSessionDetail> {
  const [
    { data, error },
    { data: batchData, error: batchError },
    { data: policyData, error: policyError },
    { data: noteData, error: noteError },
    { data: orderingData, error: orderingError },
    { data: paymentData, error: paymentError },
  ] = await Promise.all([
    waiterSupabase.rpc("get_waiter_session_detail", {
      target_order_id: orderId,
    }),
    waiterSupabase.rpc("get_waiter_session_batches", {
      target_order_id: orderId,
    }),
    waiterSupabase.rpc("get_waiter_transfer_policy", {
      target_order_id: orderId,
    }),
    waiterSupabase.rpc("get_waiter_item_notes", { target_order_id: orderId }),
    waiterSupabase.rpc("get_waiter_ordering_policy", {
      target_order_id: orderId,
    }),
    waiterSupabase
      .from("order_invoices")
      .select("id,payment_status")
      .eq("restaurant_id", restaurantId)
      .eq("order_id", orderId),
  ]);
  if (error) throw new Error(error.message);
  if (batchError) throw new Error(batchError.message);
  if (policyError) throw new Error(policyError.message);
  if (noteError) throw new Error(noteError.message);
  if (orderingError) throw new Error(orderingError.message);
  if (paymentError) throw new Error(paymentError.message);
  const paymentByInvoice = new Map(
    (paymentData ?? []).map((row) => [
      String(row.id),
      canonicalPaymentStatus(row.payment_status),
    ]),
  );
  const boundaries = new Map(
    ((batchData ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.item_id),
      row,
    ]),
  );
  const notes = new Map(
    ((noteData ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.item_id),
      typeof row.notes === "string" ? row.notes : null,
    ]),
  );
  const policy = (policyData ?? {}) as Record<string, unknown>;
  const ordering = (orderingData ?? {}) as Record<string, unknown>;
  const order = data as Record<string, unknown>;
  const normalizedInvoices: WaiterSessionInvoice[] = (
    (order.invoices ?? []) as Array<Record<string, unknown>>
  ).map((invoice) => {
    const invoiceItems = (
      (invoice.items ?? []) as Array<Record<string, unknown>>
    ).map((item) => {
      const boundary = boundaries.get(String(item.id));
      return {
        id: String(item.id),
        name: String(item.name ?? "Menu item"),
        quantity: Number(item.quantity),
        price: Number(item.price),
        notes: notes.get(String(item.id)) ?? null,
        invoiceStatus:
          paymentByInvoice.get(String(invoice.id)) ??
          canonicalPaymentStatus(invoice.status),
        kitchenStatus: String(item.kitchen_status ?? "held"),
        appendedAt:
          typeof boundary?.appended_at === "string"
            ? boundary.appended_at
            : null,
        createdAt:
          typeof boundary?.created_at === "string" ? boundary.created_at : null,
      };
    });
    const statuses = invoiceItems.map((item) => item.kitchenStatus);
    const kitchenStatus =
      statuses.length > 0 && statuses.every((status) => status === "completed")
        ? "served"
        : statuses.includes("preparing")
          ? "preparing"
          : statuses.length > 0 &&
              statuses.every(
                (status) => status === "ready" || status === "completed",
              )
            ? "ready"
            : statuses.includes("paid")
              ? "paid"
              : "pending_payment";
    return {
      id: String(invoice.id),
      displayNumber: String(invoice.display_number ?? "Batch"),
      status:
        paymentByInvoice.get(String(invoice.id)) ??
        canonicalPaymentStatus(invoice.status),
      kitchenStatus,
      total: Number(invoice.total),
      createdAt: String(invoice.created_at),
      creatorName: String(invoice.creator_name ?? "") || null,
      source: String(invoice.source ?? order.source ?? "unknown"),
      items: invoiceItems,
    };
  });
  return {
    orderId: String(order.order_id),
    sessionNumber: String(order.session_number),
    openedAt: String(order.opened_at),
    orderStatus: canonicalOperationalStatus(
      order.operational_status ?? order.order_status,
    ),
    diningSessionStatus: String(order.dining_session_status ?? "open"),
    billRequestedAt:
      typeof order.bill_requested_at === "string"
        ? order.bill_requested_at
        : null,
    billingStartedAt:
      typeof order.billing_started_at === "string"
        ? order.billing_started_at
        : null,
    paymentVerifiedAt:
      typeof order.payment_verified_at === "string"
        ? order.payment_verified_at
        : null,
    transferAllowed: policy.allowed === true,
    transferReason: typeof policy.reason === "string" ? policy.reason : null,
    orderingAllowed: ordering.allowed === true,
    orderingReason:
      typeof ordering.reason === "string" ? ordering.reason : null,
    customerName:
      typeof order.customer_name === "string" ? order.customer_name : null,
    waiterName: String(order.waiter_name ?? order.creator_name ?? "") || null,
    source: String(order.source ?? "unknown"),
    creatorName: String(order.creator_name ?? "") || null,
    total: Number(order.total),
    invoices: normalizedInvoices,
  };
}

export async function loadWaiterTableMetrics(
  orderIds: string[],
): Promise<Map<string, WaiterTableMetric>> {
  if (orderIds.length === 0) return new Map();
  const { data, error } = await waiterSupabase.rpc("get_waiter_order_metrics", {
    target_order_ids: orderIds,
  });
  if (error) throw new Error(error.message);
  return new Map(
    ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const lifecycleStatus = row.payment_verified_at
        ? "paid"
        : row.billing_started_at
          ? "billing"
          : row.bill_requested_at
            ? "needs_bill"
            : Number(row.ready_item_count) > 0
              ? "ready_to_serve"
              : Number(row.item_count) > 0
                ? "kitchen_waiting"
                : "serving";
      return [
        String(row.order_id),
        {
          total: Number(row.total),
          invoiceCount: Number(row.invoice_count),
          sessionNumber: String(row.session_number),
          invoiceNumbers: (row.invoice_numbers ?? []) as string[],
          readyItemCount: Number(row.ready_item_count),
          itemCount: Number(row.item_count),
          lifecycleStatus,
        },
      ];
    }),
  );
}

export async function markWaiterOrderServed(orderId: string) {
  const { error } = await waiterSupabase.rpc("mark_order_completed", {
    target_order_id: orderId,
    target_station_id: null,
    target_batch_key: null,
  });
  if (error) throw new Error(error.message);
}

export async function moveWaiterDiningSession(
  orderId: string,
  destinationTableId: string,
) {
  const { error } = await waiterSupabase.rpc("move_waiter_dining_session", {
    target_order_id: orderId,
    destination_table_id: destinationTableId,
  });
  if (error) throw new Error(error.message);
}

export async function mergeWaiterDiningSessions(
  sourceOrderId: string,
  destinationOrderId: string,
) {
  const { error } = await waiterSupabase.rpc("merge_waiter_dining_sessions", {
    source_order_id: sourceOrderId,
    destination_order_id: destinationOrderId,
  });
  if (error) throw new Error(error.message);
}

export async function splitWaiterParty(
  sourceOrderId: string,
  destinationTableId: string,
  customerNames: string[],
) {
  const { error } = await waiterSupabase.rpc("split_waiter_party", {
    source_order_id: sourceOrderId,
    destination_table_id: destinationTableId,
    selected_customer_names: customerNames,
  });
  if (error) throw new Error(error.message);
}

export async function requestWaiterFinalBill(orderId: string) {
  const { error } = await waiterSupabase.rpc("request_waiter_final_bill", {
    target_order_id: orderId,
  });
  if (error) throw new Error(error.message);
}
export async function updateWaiterPendingItem(
  itemId: string,
  quantity: number,
) {
  const { error } = await waiterSupabase.rpc("update_waiter_pending_item", {
    target_item_id: itemId,
    new_quantity: quantity,
  });
  if (error) throw new Error(error.message);
}
export async function updateWaiterPendingItemNote(
  itemId: string,
  note: string,
) {
  const { error } = await waiterSupabase.rpc(
    "update_waiter_pending_item_note",
    { target_item_id: itemId, new_note: note },
  );
  if (error) throw new Error(error.message);
}
export async function splitWaiterBill(
  orderId: string,
  items: Array<{ itemId: string; quantity: number }>,
) {
  const { error } = await waiterSupabase.rpc("split_waiter_bill_quantities", {
    target_order_id: orderId,
    requested_items: items.map((item) => ({
      item_id: item.itemId,
      quantity: item.quantity,
    })),
  });
  if (error) throw new Error(error.message);
}

export async function loadWaiterDashboardTables(
  restaurantSlug: string,
): Promise<WaiterDashboardTable[]> {
  const { data, error } = await waiterSupabase.rpc(
    "get_waiter_dashboard_tables",
    {
      target_restaurant_slug: restaurantSlug,
    },
  );

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as WaiterDashboardRow[]).map(normalizeTable);
}

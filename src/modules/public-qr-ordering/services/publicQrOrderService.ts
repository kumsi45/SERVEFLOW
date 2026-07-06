import { supabase } from "../../../core/database";
import { logPublicQrContext } from "./publicQrContext";
import type {
  PublicQrCartItem,
  PublicQrOrderInvoice,
  PublicQrOrderSession,
  PublicQrPaymentMethod,
  PublicQrSessionItem,
  SubmittedPublicQrOrder,
} from "../types";

type SubmitPublicQrOrderInput = {
  restaurantSlug: string;
  tableNumber?: string;
  qrToken?: string;
  customerName?: string;
  paymentMethod: PublicQrPaymentMethod;
  items: PublicQrCartItem[];
};

function isSubmittedPublicQrOrder(value: unknown): value is SubmittedPublicQrOrder {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;

  // The RPC returns 'id' — map it to order_id for the client type
  const orderId = payload.order_id ?? payload.id;

  return Boolean(
    typeof orderId === "string" &&
      typeof payload.status === "string" &&
      typeof payload.total_price !== "undefined" &&
      typeof payload.created_at === "string"
  );
}

function normalizeSessionItem(value: unknown): PublicQrSessionItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const itemId = payload.id;
  const menuItemId = payload.menu_item_id;
  const name = payload.name;

  if (typeof itemId !== "string" || typeof menuItemId !== "string" || typeof name !== "string") {
    return null;
  }

  return {
    id: itemId,
    menu_item_id: menuItemId,
    name,
    quantity: Number(payload.quantity ?? 0),
    unit_price: Number(payload.unit_price ?? 0),
    line_total: Number(payload.line_total ?? 0),
    kitchen_status: typeof payload.kitchen_status === "string" ? payload.kitchen_status : null,
    appended_at: typeof payload.appended_at === "string" ? payload.appended_at : null,
    created_at: typeof payload.created_at === "string" ? payload.created_at : null,
  };
}

function normalizeSessionInvoice(value: unknown): PublicQrOrderInvoice | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Record<string, unknown>;

  if (typeof payload.id !== "string" || typeof payload.status !== "string") {
    return null;
  }

  return {
    id: payload.id,
    invoice_number: Number(payload.invoice_number ?? 1),
    status: payload.status,
    total_price: Number(payload.total_price ?? 0),
    payment_method: payload.payment_method as PublicQrPaymentMethod | null | undefined,
    paid_at: typeof payload.paid_at === "string" ? payload.paid_at : null,
    locked_at: typeof payload.locked_at === "string" ? payload.locked_at : null,
    created_at: typeof payload.created_at === "string" ? payload.created_at : null,
  };
}

function normalizeSession(value: unknown): PublicQrOrderSession | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const orderId = payload.order_id ?? payload.id;

  if (
    typeof orderId !== "string" ||
    typeof payload.status !== "string" ||
    typeof payload.total_price === "undefined" ||
    typeof payload.created_at !== "string"
  ) {
    return null;
  }

  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const rawInvoices = Array.isArray(payload.invoices) ? payload.invoices : [];

  return {
    order_id: orderId,
    status: payload.status,
    total_price: Number(payload.total_price),
    table_number: typeof payload.table_number === "string" ? payload.table_number : null,
    customer_name: typeof payload.customer_name === "string" ? payload.customer_name : null,
    payment_method: payload.payment_method as PublicQrPaymentMethod | null | undefined,
    created_at: payload.created_at,
    payment_verified_at: typeof payload.payment_verified_at === "string" ? payload.payment_verified_at : null,
    items: rawItems.flatMap((item) => normalizeSessionItem(item) ?? []),
    invoices: rawInvoices.flatMap((invoice) => normalizeSessionInvoice(invoice) ?? []),
  };
}

export async function fetchPublicQrOrderSession({
  restaurantSlug,
  tableNumber,
  qrToken,
}: {
  restaurantSlug: string;
  tableNumber?: string;
  qrToken?: string;
}): Promise<PublicQrOrderSession | null> {
  if (!tableNumber?.trim() || !qrToken?.trim()) {
    return null;
  }

  logPublicQrContext("publicQrOrderService:sessionLookup", {
    restaurantSlug,
    tableNumber,
    qrToken,
  });

  const { data, error } = await supabase.rpc("get_public_qr_order_session", {
    target_restaurant_slug: restaurantSlug,
    table_number: tableNumber,
    qr_token: qrToken,
  });

  if (error) {
    logPublicQrContext("publicQrOrderService:sessionLookup:error", {
      restaurantSlug,
      tableNumber,
      qrToken,
      message: error.message,
    });
    throw new Error(error.message);
  }

  const session = normalizeSession(data);
  logPublicQrContext("publicQrOrderService:sessionLookup:result", {
    restaurantSlug,
    tableNumber,
    qrToken,
    activeOrderId: session?.order_id ?? null,
  });
  return session;
}

export async function submitPublicQrOrder({
  restaurantSlug,
  tableNumber,
  qrToken,
  customerName,
  paymentMethod,
  items,
}: SubmitPublicQrOrderInput): Promise<SubmittedPublicQrOrder> {
  const requestedItems = items.map((item) => ({
    menu_item_id: item.menuItemId,
    quantity: item.quantity,
  }));

  logPublicQrContext("publicQrOrderService:submit", {
    restaurantSlug,
    tableNumber,
    qrToken,
    paymentMethod,
    itemCount: requestedItems.length,
  });

  const { data, error } = await supabase.rpc("create_public_qr_order", {
    target_restaurant_slug: restaurantSlug,
    table_number: tableNumber ?? "",
    qr_token: qrToken ?? "",
    customer_name: customerName ?? "",
    selected_payment_method: paymentMethod,
    requested_items: requestedItems,
  });

  if (error) {
    logPublicQrContext("publicQrOrderService:submit:error", {
      restaurantSlug,
      tableNumber,
      qrToken,
      message: error.message,
    });
    throw new Error(error.message);
  }

  if (!isSubmittedPublicQrOrder(data)) {
    throw new Error("Order could not be confirmed.");
  }

  // Normalize: RPC returns 'id', client expects 'order_id'
  const normalized = data as Record<string, unknown>;
  const submittedOrder: SubmittedPublicQrOrder = {
    order_id: (normalized.order_id ?? normalized.id) as string,
    invoice_id: normalized.invoice_id as string | null | undefined,
    invoice_number: typeof normalized.invoice_number === "undefined" || normalized.invoice_number === null
      ? null
      : Number(normalized.invoice_number),
    invoice_status: normalized.invoice_status as string | null | undefined,
    invoice_total: Number(normalized.invoice_total ?? normalized.added_total ?? normalized.total_price ?? 0),
    status: normalized.status as string,
    total_price: Number(normalized.total_price),
    table_number: normalized.table_number as string | null | undefined,
    customer_name: normalized.customer_name as string | null | undefined,
    payment_method: normalized.payment_method as import("../types").PublicQrPaymentMethod | null | undefined,
    created_at: normalized.created_at as string,
    session_action: normalized.session_action === "appended" ? "appended" : "created",
    appended_at: typeof normalized.appended_at === "string" ? normalized.appended_at : null,
    added_total: Number(normalized.added_total ?? normalized.total_price ?? 0),
    items_added: Array.isArray(normalized.items_added)
      ? normalized.items_added.flatMap((item) => normalizeSessionItem({ id: `${String((item as Record<string, unknown>).menu_item_id ?? "")}:${String((item as Record<string, unknown>).name ?? "")}`, ...item }) ?? [])
      : [],
  };

  logPublicQrContext("publicQrOrderService:submit:result", {
    restaurantSlug,
    tableNumber,
    qrToken,
    orderId: submittedOrder.order_id,
    status: submittedOrder.status,
    sessionAction: submittedOrder.session_action,
  });

  return submittedOrder;
}

import { supabase } from "../../../core/database";
import type {
  PublicQrCartItem,
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

  const { data, error } = await supabase.rpc("get_public_qr_order_session", {
    target_restaurant_slug: restaurantSlug,
    table_number: tableNumber,
    qr_token: qrToken,
  });

  if (error) {
    throw new Error(error.message);
  }

  return normalizeSession(data);
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

  const { data, error } = await supabase.rpc("create_public_qr_order", {
    target_restaurant_slug: restaurantSlug,
    table_number: tableNumber ?? "",
    qr_token: qrToken ?? "",
    customer_name: customerName ?? "",
    selected_payment_method: paymentMethod,
    requested_items: requestedItems,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!isSubmittedPublicQrOrder(data)) {
    throw new Error("Order could not be confirmed.");
  }

  // Normalize: RPC returns 'id', client expects 'order_id'
  const normalized = data as Record<string, unknown>;
  return {
    order_id: (normalized.order_id ?? normalized.id) as string,
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
}

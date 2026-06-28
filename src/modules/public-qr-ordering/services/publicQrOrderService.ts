import { supabase } from "../../../core/database";
import type { PublicQrCartItem, PublicQrPaymentMethod, SubmittedPublicQrOrder } from "../types";

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
  };
}

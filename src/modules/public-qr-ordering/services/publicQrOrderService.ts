import { supabase } from "../../../core/database";
import type { PublicQrCartItem, PublicQrPaymentMethod, SubmittedPublicQrOrder } from "../types";

type SubmitPublicQrOrderInput = {
  restaurantSlug: string;
  tableNumber?: string;
  customerName?: string;
  paymentMethod: PublicQrPaymentMethod;
  items: PublicQrCartItem[];
};

function isSubmittedPublicQrOrder(value: unknown): value is SubmittedPublicQrOrder {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<SubmittedPublicQrOrder>;

  return Boolean(
    typeof payload.order_id === "string" &&
      typeof payload.status === "string" &&
      typeof payload.total_price !== "undefined" &&
      typeof payload.created_at === "string"
  );
}

export async function submitPublicQrOrder({
  restaurantSlug,
  tableNumber,
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

  return {
    ...data,
    total_price: Number(data.total_price),
  };
}

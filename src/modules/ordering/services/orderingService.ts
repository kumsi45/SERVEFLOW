import { supabase } from "../../../core/database";
import type { CartLine, OrderingMenuData, SubmittedOrder } from "../types";

function isOrderingMenuData(value: unknown): value is OrderingMenuData {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<OrderingMenuData>;

  return Boolean(
    payload.restaurant &&
      typeof payload.restaurant.id === "string" &&
      typeof payload.restaurant.name === "string" &&
      typeof payload.restaurant.slug === "string" &&
      Array.isArray(payload.categories) &&
      Array.isArray(payload.items)
  );
}

function isSubmittedOrder(value: unknown): value is SubmittedOrder {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<SubmittedOrder>;

  return Boolean(
    typeof payload.order_id === "string" &&
      typeof payload.status === "string" &&
      typeof payload.total_price !== "undefined" &&
      typeof payload.created_at === "string"
  );
}

export async function fetchOrderingMenuData(restaurantSlug: string): Promise<OrderingMenuData> {
  const { data, error } = await supabase.rpc("get_public_qr_menu", {
    target_restaurant_slug: restaurantSlug,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!isOrderingMenuData(data)) {
    throw new Error("Restaurant menu not found.");
  }

  return data;
}

export async function submitCustomerOrder(
  restaurantSlug: string,
  cartLines: CartLine[]
): Promise<SubmittedOrder> {
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError) {
    throw new Error(userError.message);
  }

  if (!userData.user) {
    throw new Error("Sign in as a customer to place an order.");
  }

  const requestedItems = cartLines.map((line) => ({
    menu_item_id: line.menuItemId,
    quantity: line.quantity,
  }));

  const { data, error } = await supabase.rpc("create_customer_order", {
    target_restaurant_slug: restaurantSlug,
    requested_items: requestedItems,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!isSubmittedOrder(data)) {
    throw new Error("Order could not be confirmed.");
  }

  return {
    ...data,
    total_price: Number(data.total_price),
  };
}

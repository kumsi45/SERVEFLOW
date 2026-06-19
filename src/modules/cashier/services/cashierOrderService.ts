import { supabase } from "../../../core/database";
import type {
  CashierOrder,
  CashierOrderItem,
  CashierOrderStatus,
  CashierRestaurant,
} from "../types";

type OrderRow = {
  id: string;
  status: CashierOrderStatus;
  customer_name: string | null;
  table_number: string | null;
  payment_method: string | null;
  total_price: number | string;
  created_at: string;
  payment_verified_at: string | null;
};

type OrderItemRow = {
  id: string;
  order_id: string;
  quantity: number;
  price: number | string;
  menu_items?: { name?: string | null } | { name?: string | null }[] | null;
};

type StaffRestaurantRow = {
  role: "cashier" | "owner";
  restaurants?: { id?: string | null; name?: string | null } | { id?: string | null; name?: string | null }[] | null;
};

function isCashierOrderStatus(value: unknown): value is CashierOrderStatus {
  return value === "pending_payment" || value === "paid";
}

function isOrderRow(value: unknown): value is OrderRow {
  if (!value || typeof value !== "object") {
    return false;
  }

  const row = value as Partial<OrderRow>;

  return Boolean(
    typeof row.id === "string" &&
      isCashierOrderStatus(row.status) &&
      typeof row.created_at === "string" &&
      typeof row.total_price !== "undefined"
  );
}

function getMenuItemName(menuItem: OrderItemRow["menu_items"]): string {
  if (Array.isArray(menuItem)) {
    return menuItem[0]?.name || "Menu item";
  }

  return menuItem?.name || "Menu item";
}

function getStaffRestaurant(
  restaurant: StaffRestaurantRow["restaurants"]
): { id?: string | null; name?: string | null } | null {
  if (Array.isArray(restaurant)) {
    return restaurant[0] ?? null;
  }

  return restaurant ?? null;
}

function normalizeOrder(row: OrderRow, items: CashierOrderItem[] = []): CashierOrder {
  return {
    id: row.id,
    status: row.status,
    customerName: row.customer_name,
    tableNumber: row.table_number,
    paymentMethod: row.payment_method,
    totalPrice: Number(row.total_price),
    createdAt: row.created_at,
    paymentVerifiedAt: row.payment_verified_at,
    items,
  };
}

function normalizeOrderItem(row: OrderItemRow): CashierOrderItem {
  return {
    id: row.id,
    orderId: row.order_id,
    name: getMenuItemName(row.menu_items),
    quantity: Number(row.quantity),
    price: Number(row.price),
  };
}

export async function fetchCashierRestaurant(activeRestaurantId: string): Promise<CashierRestaurant> {
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError) {
    throw new Error(userError.message);
  }

  if (!userData.user) {
    throw new Error("Sign in as a cashier or owner to view the dashboard.");
  }

  const { data, error } = await supabase
    .from("restaurant_staff")
    .select("role,restaurants(id,name)")
    .eq("user_id", userData.user.id)
    .eq("restaurant_id", activeRestaurantId)
    .eq("active", true)
    .in("role", ["cashier", "owner"])
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const staffRow = data as StaffRestaurantRow | null;
  const restaurant = getStaffRestaurant(staffRow?.restaurants);

  if (!restaurant?.id || !restaurant.name) {
    throw new Error("No cashier restaurant was found for this account.");
  }

  return {
    id: restaurant.id,
    name: restaurant.name,
    logoUrl: null,
  };
}

export async function fetchCashierOrders(activeRestaurantId: string): Promise<CashierOrder[]> {
  const { data: orderRows, error: ordersError } = await supabase
    .from("orders")
    .select(
      "id,status,customer_name,table_number,payment_method,total_price,created_at,payment_verified_at"
    )
    .eq("restaurant_id", activeRestaurantId)
    .in("status", ["pending_payment", "paid"])
    .order("created_at", { ascending: true });

  if (ordersError) {
    throw new Error(ordersError.message);
  }

  const normalizedOrderRows = (orderRows ?? []).filter(isOrderRow);
  const orderIds = normalizedOrderRows.map((order) => order.id);
  const itemsByOrder = new Map<string, CashierOrderItem[]>();

  if (orderIds.length > 0) {
    const { data: itemRows, error: itemsError } = await supabase
      .from("order_items")
      .select("id,order_id,quantity,price,menu_items!order_items_menu_item_same_restaurant(name)")
      .eq("restaurant_id", activeRestaurantId)
      .in("order_id", orderIds)
      .order("created_at", { ascending: true });

    if (itemsError) {
      throw new Error(itemsError.message);
    }

    for (const itemRow of (itemRows ?? []) as OrderItemRow[]) {
      const item = normalizeOrderItem(itemRow);
      const existing = itemsByOrder.get(item.orderId) ?? [];
      existing.push(item);
      itemsByOrder.set(item.orderId, existing);
    }
  }

  return normalizedOrderRows.map((order) => normalizeOrder(order, itemsByOrder.get(order.id)));
}

export async function approveOrderPayment(orderId: string): Promise<CashierOrder> {
  const { data, error } = await supabase.rpc("approve_order_payment", {
    target_order_id: orderId,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!isOrderRow(data)) {
    throw new Error("Payment approval did not return an order.");
  }

  return normalizeOrder(data);
}

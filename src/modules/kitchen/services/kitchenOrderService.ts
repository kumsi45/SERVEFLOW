import { supabase } from "../../../core/database";
import type {
  KitchenDashboardContext,
  KitchenOrder,
  KitchenOrderItem,
  KitchenOrderStationProgress,
  KitchenOrderStatus,
  KitchenRestaurant,
  KitchenStationStatus,
} from "../types";

type OrderRow = {
  id: string;
  display_number?: string | null;
  kitchen_ticket_number?: string | null;
  kitchen_batch_key?: string | null;
  status?: string;
  operational_status?: string;
  customer_name: string | null;
  table_number: string | null;
  total_price: number | string;
  created_at: string;
  preparation_started_at: string | null;
  ready_marked_at: string | null;
};

type OrderItemRow = {
  id: string;
  order_id: string;
  quantity: number;
  price: number | string;
  notes?: string | null;
  appended_at?: string | null;
  kitchen_station_id?: string | null;
  kitchen_station_name?: string | null;
  kitchen_status?: string | null;
  menu_item_name?: string | null;
  menu_items?: { name?: string | null } | { name?: string | null }[] | null;
};

type StationProgressRow = {
  station_id: string;
  station_name: string;
  station_status: string;
  item_count: number | string;
  ready_count: number | string;
  completed_count: number | string;
  started_at?: string | null;
  ready_at?: string | null;
  completed_at?: string | null;
};

type StaffRestaurantRow = {
  role: "kitchen" | "owner";
  restaurants?:
    | {
        id?: string | null;
        name?: string | null;
        currency_code?: string | null;
        currency_symbol?: string | null;
        locale?: string | null;
      }
    | {
        id?: string | null;
        name?: string | null;
        currency_code?: string | null;
        currency_symbol?: string | null;
        locale?: string | null;
      }[]
    | null;
};

function isKitchenOrderStatus(value: unknown): value is KitchenOrderStatus {
  return (
    value === "accepted" ||
    value === "preparing" ||
    value === "ready" ||
    value === "served"
  );
}

function isKitchenStationStatus(value: unknown): value is KitchenStationStatus {
  return (
    value === "accepted" ||
    value === "waiting" ||
    value === "preparing" ||
    value === "ready" ||
    value === "served" ||
    value === "completed"
  );
}

function isOrderRow(value: unknown): value is OrderRow {
  if (!value || typeof value !== "object") {
    return false;
  }

  const row = value as Partial<OrderRow>;

  return Boolean(
    typeof row.id === "string" &&
    isKitchenOrderStatus(row.operational_status) &&
    typeof row.created_at === "string" &&
    typeof row.total_price !== "undefined",
  );
}

function getMenuItemName(menuItem: OrderItemRow["menu_items"]): string {
  if (Array.isArray(menuItem)) {
    return menuItem[0]?.name || "Menu item";
  }

  return menuItem?.name || "Menu item";
}

function getRpcMenuItemName(row: OrderItemRow): string {
  return row.menu_item_name || getMenuItemName(row.menu_items);
}

function getStaffRestaurant(restaurant: StaffRestaurantRow["restaurants"]): {
  id?: string | null;
  name?: string | null;
  currency_code?: string | null;
  currency_symbol?: string | null;
  locale?: string | null;
} | null {
  if (Array.isArray(restaurant)) {
    return restaurant[0] ?? null;
  }

  return restaurant ?? null;
}

function normalizeOrder(
  row: OrderRow,
  items: KitchenOrderItem[] = [],
  stationProgress: KitchenOrderStationProgress[] = [],
): KitchenOrder {
  const stationStatus = isKitchenOrderStatus(row.status)
    ? row.status
    : row.status === "paid"
      ? "accepted"
      : row.operational_status;
  return {
    id: row.id,
    displayNumber: row.display_number ?? null,
    kitchenTicketNumber: row.kitchen_ticket_number ?? null,
    kitchenBatchKey: row.kitchen_batch_key ?? null,
    status: stationStatus as KitchenOrderStatus,
    customerName: row.customer_name,
    tableNumber: row.table_number,
    totalPrice: Number(row.total_price),
    createdAt: row.created_at,
    preparationStartedAt: row.preparation_started_at,
    readyMarkedAt: row.ready_marked_at,
    items,
    stationProgress,
  };
}

function normalizeOrderItem(row: OrderItemRow): KitchenOrderItem {
  return {
    id: row.id,
    orderId: row.order_id,
    name: getRpcMenuItemName(row),
    quantity: Number(row.quantity),
    price: Number(row.price),
    notes: row.notes ?? null,
    appendedAt: row.appended_at ?? null,
    kitchenStationId: row.kitchen_station_id ?? null,
    kitchenStationName: row.kitchen_station_name ?? null,
  };
}

function normalizeStationProgress(
  row: StationProgressRow,
): KitchenOrderStationProgress {
  return {
    stationId: row.station_id,
    stationName: row.station_name,
    stationStatus:
      row.station_status === "waiting"
        ? "accepted"
        : row.station_status === "completed"
          ? "served"
          : isKitchenStationStatus(row.station_status)
            ? row.station_status
            : "accepted",
    itemCount: Number(row.item_count),
    readyCount: Number(row.ready_count),
    completedCount: Number(row.completed_count),
    startedAt: row.started_at ?? null,
    readyAt: row.ready_at ?? null,
    completedAt: row.completed_at ?? null,
  };
}

function normalizeRpcOrder(
  row: OrderRow & {
    items?: OrderItemRow[] | string | null;
    station_progress?: StationProgressRow[] | string | null;
  },
): KitchenOrder {
  const rawItems =
    typeof row.items === "string" ? JSON.parse(row.items) : row.items;
  const rawProgress =
    typeof row.station_progress === "string"
      ? JSON.parse(row.station_progress)
      : row.station_progress;
  const items = Array.isArray(rawItems)
    ? rawItems.map((item) => normalizeOrderItem(item as OrderItemRow))
    : [];
  const stationProgress = Array.isArray(rawProgress)
    ? rawProgress.map((progress) =>
        normalizeStationProgress(progress as StationProgressRow),
      )
    : [];
  return normalizeOrder(row, items, stationProgress);
}

export async function fetchKitchenRestaurant(
  activeRestaurantId: string,
): Promise<KitchenRestaurant> {
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError) {
    throw new Error(userError.message);
  }

  if (!userData.user) {
    throw new Error("Sign in as kitchen staff or owner to view the dashboard.");
  }

  const { data, error } = await supabase
    .from("restaurant_staff")
    .select("role,restaurants(id,name,currency_code,currency_symbol,locale)")
    .eq("user_id", userData.user.id)
    .eq("restaurant_id", activeRestaurantId)
    .eq("active", true)
    .in("role", ["kitchen", "owner"])
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const staffRow = data as StaffRestaurantRow | null;
  const restaurant = getStaffRestaurant(staffRow?.restaurants);

  if (!restaurant?.id || !restaurant.name) {
    throw new Error("No kitchen restaurant was found for this account.");
  }

  return {
    id: restaurant.id,
    name: restaurant.name,
    currencyCode: restaurant.currency_code ?? null,
    currencySymbol: restaurant.currency_symbol ?? null,
    locale: restaurant.locale ?? null,
  };
}

export async function fetchKitchenOrders(
  activeRestaurantId: string,
): Promise<KitchenOrder[]> {
  const { data: orderRows, error: ordersError } = await supabase
    .from("orders")
    .select(
      "id,display_number,operational_status,customer_name,table_number,total_price,created_at,preparation_started_at,ready_marked_at",
    )
    .eq("restaurant_id", activeRestaurantId)
    .in("operational_status", ["accepted", "preparing", "ready"])
    .order("created_at", { ascending: true });

  if (ordersError) {
    throw new Error(ordersError.message);
  }

  const normalizedOrderRows = (orderRows ?? []).filter(isOrderRow);
  const orderIds = normalizedOrderRows.map((order) => order.id);
  const itemsByOrder = new Map<string, KitchenOrderItem[]>();

  if (orderIds.length > 0) {
    const { data: itemRows, error: itemsError } = await supabase
      .from("order_items")
      .select(
        "id,order_id,quantity,price,menu_items!order_items_menu_item_same_restaurant(name)",
      )
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

  return normalizedOrderRows.map((order) =>
    normalizeOrder(order, itemsByOrder.get(order.id)),
  );
}

export async function fetchKitchenDashboardContext(
  activeRestaurantId: string,
): Promise<KitchenDashboardContext> {
  const { data, error } = await supabase.rpc("get_kitchen_dashboard_context", {
    target_restaurant_id: activeRestaurantId,
  });

  if (error) {
    throw new Error(error.message);
  }

  const context = data as KitchenDashboardContext | null;

  if (!context?.restaurant?.id || !context.restaurant.name) {
    throw new Error("No kitchen restaurant was found for this account.");
  }

  return {
    restaurant: context.restaurant,
    role: context.role,
    assignedStation: context.assignedStation ?? null,
    stations: context.stations ?? [],
  };
}

export async function fetchStationKitchenOrders(
  activeRestaurantId: string,
  stationId: string | null,
  includeAllStations: boolean,
  logQueueView = false,
): Promise<KitchenOrder[]> {
  const { data, error } = await supabase.rpc(
    "get_canonical_station_kitchen_orders",
    {
      target_restaurant_id: activeRestaurantId,
      target_station_id: stationId,
      include_all_stations: includeAllStations,
      log_queue_view: logQueueView,
    },
  );

  if (error) {
    throw new Error(error.message);
  }

  return (
    (data ?? []) as (OrderRow & {
      items?: OrderItemRow[] | string | null;
      station_progress?: StationProgressRow[] | string | null;
    })[]
  )
    .filter((row) => isKitchenOrderStatus(row.status))
    .map(normalizeRpcOrder);
}

export async function startOrderPreparation(
  orderId: string,
  stationId: string | null = null,
  kitchenBatchKey: string | null = null,
): Promise<KitchenOrder> {
  const { data, error } = await supabase.rpc("start_order_preparation", {
    target_order_id: orderId,
    target_station_id: stationId,
    target_batch_key: kitchenBatchKey,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!isOrderRow(data)) {
    throw new Error("Kitchen transition did not return an order.");
  }

  return normalizeOrder(data);
}

export async function markOrderReady(
  orderId: string,
  stationId: string | null = null,
  kitchenBatchKey: string | null = null,
): Promise<KitchenOrder> {
  const { data, error } = await supabase.rpc("mark_order_ready", {
    target_order_id: orderId,
    target_station_id: stationId,
    target_batch_key: kitchenBatchKey,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!isOrderRow(data)) {
    throw new Error("Kitchen transition did not return an order.");
  }

  return normalizeOrder(data);
}

export async function markOrderCompleted(
  orderId: string,
  stationId: string | null = null,
  kitchenBatchKey: string | null = null,
): Promise<KitchenOrder> {
  const { data, error } = await supabase.rpc("mark_order_completed", {
    target_order_id: orderId,
    target_station_id: stationId,
    target_batch_key: kitchenBatchKey,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!isOrderRow(data)) {
    throw new Error("Kitchen transition did not return an order.");
  }

  return normalizeOrder(data);
}

import { supabase } from "../../../core/database";
import { canonicalPaymentMethod } from "../../../core/payment/lifecycle";
import type {
  ManagerCashierStatus,
  ManagerDashboardSnapshot,
  ManagerFloorTable,
  ManagerFloorTableStatus,
  ManagerKitchenStatus,
  ManagerKpis,
  ManagerLiveMetrics,
  ManagerOperationAlert,
  ManagerRestaurant,
} from "../types";

const ALERT_THRESHOLDS = {
  waitingMinutes: 10,
  kitchenDelayMinutes: 20,
  waitingPaymentMinutes: 10,
  waitingPickupMinutes: 8,
  longSessionMinutes: 120,
};

type RestaurantRow = {
  id: string;
  name: string;
  branding?: { logo_url?: string | null } | null;
  business_hours?: { current_shift?: string | null } | null;
};

type StaffRestaurantRow = {
  display_name: string | null;
  restaurants?: RestaurantRow | RestaurantRow[] | null;
};

type TableRow = {
  id: string;
  table_number: number | string;
  label: string | null;
  seats?: number | string | null;
  active: boolean;
};

type OrderRow = {
  id: string;
  table_id: string | null;
  table_number: string | null;
  status: string;
  operational_status: string;
  order_source: string | null;
  customer_name: string | null;
  total_price: number | string | null;
  created_at: string;
  dining_session_opened_at?: string | null;
  bill_requested_at?: string | null;
  billing_started_at?: string | null;
  payment_verified_at?: string | null;
};

type OrderItemRow = {
  order_id: string;
  quantity: number | string;
  kitchen_status: string | null;
  created_at: string;
  kitchen_preparation_started_at?: string | null;
  kitchen_ready_marked_at?: string | null;
};

type InvoiceRow = {
  order_id: string;
  status: string | null;
  payment_status: string | null;
  total_price: number | string | null;
  created_at: string;
  paid_at?: string | null;
  verified_at?: string | null;
};

type LiveOrderRow = {
  id: string;
  status: string;
  operational_status: string;
  total_price: number | string | null;
  created_at: string;
  payment_verified_at?: string | null;
  bill_requested_at?: string | null;
};

type LiveInvoiceRow = {
  order_id: string;
  status: string | null;
  payment_status: string | null;
  total_price: number | string | null;
  payment_method?: string | null;
  paid_at?: string | null;
  verified_at?: string | null;
  created_at: string;
};

type AssignmentRow = {
  table_id: string;
  restaurant_staff?:
    | { display_name?: string | null }
    | { display_name?: string | null }[]
    | null;
};

type ShiftSummary = {
  active_shift?: { id?: string; opened_at?: string } | null;
};

function firstRestaurant(
  value: StaffRestaurantRow["restaurants"],
): RestaurantRow | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizeRestaurant(row: RestaurantRow): ManagerRestaurant {
  return {
    id: row.id,
    name: row.name,
    logoUrl: row.branding?.logo_url || null,
    currentShift: row.business_hours?.current_shift || "Current Shift",
  };
}

async function fetchRestaurantContext(
  restaurantId: string,
): Promise<ManagerRestaurant> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message);
  if (!userData.user)
    throw new Error("Sign in as a manager to view this dashboard.");

  const { data, error } = await supabase
    .from("restaurant_staff")
    .select("display_name,restaurants(id,name,branding,business_hours)")
    .eq("user_id", userData.user.id)
    .eq("restaurant_id", restaurantId)
    .eq("role", "manager")
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const restaurant = firstRestaurant(
    (data as StaffRestaurantRow | null)?.restaurants,
  );
  if (!restaurant?.id || !restaurant.name) {
    throw new Error("Manager access is not available for this restaurant.");
  }

  return normalizeRestaurant(restaurant);
}

async function fetchOpenOrders(restaurantId: string): Promise<OrderRow[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id,table_id,table_number,status,operational_status,order_source,customer_name,total_price,created_at,dining_session_opened_at,bill_requested_at,billing_started_at,payment_verified_at",
    )
    .eq("restaurant_id", restaurantId)
    .eq("dining_session_status", "open")
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as OrderRow[];
}

async function fetchTables(restaurantId: string): Promise<TableRow[]> {
  const { data, error } = await supabase
    .from("restaurant_tables")
    .select("id,table_number,label,seats,active")
    .eq("restaurant_id", restaurantId)
    .order("table_number", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as TableRow[];
}

async function fetchOrderItems(
  restaurantId: string,
  orderIds: string[],
): Promise<OrderItemRow[]> {
  if (orderIds.length === 0) return [];

  const { data, error } = await supabase
    .from("order_items")
    .select(
      "order_id,quantity,kitchen_status,created_at,kitchen_preparation_started_at,kitchen_ready_marked_at",
    )
    .eq("restaurant_id", restaurantId)
    .in("order_id", orderIds)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as OrderItemRow[];
}

async function fetchInvoices(
  restaurantId: string,
  orderIds: string[],
): Promise<InvoiceRow[]> {
  if (orderIds.length === 0) return [];

  const { data, error } = await supabase
    .from("order_invoices")
    .select(
      "order_id,status,payment_status,total_price,created_at,paid_at,verified_at",
    )
    .eq("restaurant_id", restaurantId)
    .in("order_id", orderIds)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as InvoiceRow[];
}

async function fetchAssignments(
  restaurantId: string,
): Promise<AssignmentRow[]> {
  const { data, error } = await supabase
    .from("restaurant_table_waiter_assignments")
    .select(
      "table_id,restaurant_staff!restaurant_table_waiter_assignments_waiter_staff_id_fkey(display_name)",
    )
    .eq("restaurant_id", restaurantId)
    .eq("active", true);

  if (error) throw new Error(error.message);
  return (data ?? []) as AssignmentRow[];
}

async function fetchStaffOnDuty(restaurantId: string): Promise<number> {
  const { count, error } = await supabase
    .from("restaurant_staff")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId)
    .eq("active", true)
    .eq("staff_session_active", true);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function fetchActiveShiftOpen(restaurantId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("get_cashier_shift_summary", {
    target_restaurant_id: restaurantId,
  });

  if (error) return false;
  return Boolean((data as ShiftSummary | null)?.active_shift?.id);
}

async function fetchLiveMetrics(
  restaurantId: string,
): Promise<ManagerLiveMetrics> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);

  const [ordersResult, invoicesResult, paidInvoicesResult] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id,status,operational_status,total_price,created_at,payment_verified_at,bill_requested_at",
      )
      .eq("restaurant_id", restaurantId)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString()),
    supabase
      .from("order_invoices")
      .select(
        "order_id,status,payment_status,total_price,payment_method,paid_at,created_at",
      )
      .eq("restaurant_id", restaurantId)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString()),
    supabase
      .from("order_invoices")
      .select(
        "order_id,status,payment_status,total_price,payment_method,paid_at,created_at",
      )
      .eq("restaurant_id", restaurantId)
      .eq("payment_status", "paid")
      .gte("paid_at", start.toISOString())
      .lt("paid_at", end.toISOString()),
  ]);

  if (ordersResult.error) throw new Error(ordersResult.error.message);
  if (invoicesResult.error) throw new Error(invoicesResult.error.message);
  if (paidInvoicesResult.error)
    throw new Error(paidInvoicesResult.error.message);

  const orders = (ordersResult.data ?? []) as LiveOrderRow[];
  const invoices = (invoicesResult.data ?? []) as LiveInvoiceRow[];
  const paidInvoices = (paidInvoicesResult.data ?? []) as LiveInvoiceRow[];
  const revenueToday = paidInvoices
    .filter(
      (invoice) => !["cancelled", "refunded"].includes(invoice.status || ""),
    )
    .reduce((sum, invoice) => sum + Number(invoice.total_price ?? 0), 0);
  const paymentMethodTotals = paidInvoices.reduce<Record<string, number>>(
    (totals, invoice) => {
      const method = canonicalPaymentMethod(invoice.payment_method);
      totals[method] = (totals[method] ?? 0) + Number(invoice.total_price ?? 0);
      return totals;
    },
    {},
  );
  const digitalCollected = Object.entries(paymentMethodTotals)
    .filter(([method]) => method !== "Cash")
    .reduce((sum, [, total]) => sum + total, 0);
  const pendingPayments = invoices.filter(
    (invoice) =>
      invoice.payment_status === "pending" || invoice.payment_status === "held",
  ).length;
  const paymentDueAmount = invoices
    .filter((invoice) => invoice.payment_status === "held")
    .reduce((sum, invoice) => sum + Number(invoice.total_price ?? 0), 0);
  const refunds = invoices
    .filter((invoice) => invoice.payment_status === "refunded")
    .reduce((sum, invoice) => sum + Number(invoice.total_price ?? 0), 0);
  const collectionDelays = paidInvoices.map((invoice) =>
    Math.max(
      0,
      (new Date(invoice.paid_at ?? invoice.created_at).getTime() -
        new Date(invoice.created_at).getTime()) /
        60000,
    ),
  );

  return {
    revenueToday,
    revenueThisShift: revenueToday,
    ordersToday: orders.length,
    ordersPending: orders.filter(
      (order) =>
        order.operational_status === "new" ||
        order.operational_status === "accepted",
    ).length,
    ordersPreparing: orders.filter(
      (order) => order.operational_status === "preparing",
    ).length,
    ordersReady: orders.filter((order) => order.operational_status === "ready")
      .length,
    ordersCompleted: orders.filter(
      (order) =>
        order.operational_status === "served" ||
        order.operational_status === "closed",
    ).length,
    ordersCancelled: invoices.filter(
      (invoice) => invoice.payment_status === "cancelled",
    ).length,
    pendingPayments,
    paymentDueAmount,
    refunds,
    averageCollectionMinutes: collectionDelays.length
      ? collectionDelays.reduce((sum, value) => sum + value, 0) /
        collectionDelays.length
      : 0,
    cashCollected: paymentMethodTotals.Cash ?? 0,
    cardPayments: paymentMethodTotals.Card ?? 0,
    mobilePayments: paymentMethodTotals["Mobile Banking"] ?? 0,
    digitalCollected,
    paymentMethodTotals,
    averageOrder: paidInvoices.length
      ? Math.round(revenueToday / paidInvoices.length)
      : 0,
  };
}

function buildKpis(openOrders: OrderRow[], staffOnDuty: number): ManagerKpis {
  const occupiedTableKeys = new Set(
    openOrders
      .map((order) => order.table_id || order.table_number)
      .filter(Boolean),
  );

  return {
    activeDiningSessions: openOrders.length,
    kitchenWaiting: openOrders.filter((order) => order.status === "paid")
      .length,
    kitchenPreparing: openOrders.filter((order) => order.status === "preparing")
      .length,
    awaitingCashier: openOrders.filter(
      (order) => order.bill_requested_at && !order.payment_verified_at,
    ).length,
    staffOnDuty,
    occupiedTables: occupiedTableKeys.size,
  };
}

function groupByOrderId<T extends { order_id: string }>(
  rows: T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const existing = groups.get(row.order_id) ?? [];
    existing.push(row);
    groups.set(row.order_id, existing);
  }
  return groups;
}

function assignmentName(row: AssignmentRow | undefined): string | null {
  const staff = Array.isArray(row?.restaurant_staff)
    ? row?.restaurant_staff[0]
    : row?.restaurant_staff;
  return staff?.display_name || null;
}

function minutesSince(value: string | null | undefined, now: Date) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.floor((now.getTime() - timestamp) / 60_000));
}

function latestDate(values: Array<string | null | undefined>): string | null {
  return (
    values
      .filter(Boolean)
      .sort(
        (a, b) => new Date(String(b)).getTime() - new Date(String(a)).getTime(),
      )[0] ?? null
  );
}

function deriveKitchenStatus(items: OrderItemRow[]): ManagerKitchenStatus {
  if (items.length === 0) return "idle";
  const statuses = items.map((item) => item.kitchen_status || "held");
  if (statuses.every((itemStatus) => itemStatus === "completed"))
    return "completed";
  if (statuses.some((itemStatus) => itemStatus === "ready")) return "ready";
  if (statuses.some((itemStatus) => itemStatus === "preparing"))
    return "preparing";
  if (statuses.some((itemStatus) => itemStatus === "paid")) return "waiting";
  return "idle";
}

function deriveCashierStatus(
  order: OrderRow,
  invoices: InvoiceRow[],
): ManagerCashierStatus {
  if (
    invoices.length > 0 &&
    invoices.every((invoice) => invoice.payment_status === "paid")
  )
    return "paid";
  if (order.billing_started_at) return "billing";
  if (
    invoices.some(
      (invoice) =>
        invoice.payment_status === "held" ||
        invoice.payment_status === "pending",
    )
  )
    return "waiting_payment";
  return order.id ? "open" : "none";
}

function buildAlerts(
  order: OrderRow,
  items: OrderItemRow[],
  kitchenStatus: ManagerKitchenStatus,
  cashierStatus: ManagerCashierStatus,
  sessionMinutes: number | null,
  now: Date,
): ManagerOperationAlert[] {
  const alerts: ManagerOperationAlert[] = [];
  const createdMinutes = minutesSince(order.created_at, now) ?? 0;
  const latestReadyMinutes = minutesSince(
    latestDate(
      items
        .filter((item) => item.kitchen_status === "ready")
        .map((item) => item.kitchen_ready_marked_at || item.created_at),
    ),
    now,
  );
  const latestKitchenStartMinutes = minutesSince(
    latestDate(
      items
        .filter((item) => item.kitchen_status === "preparing")
        .map((item) => item.kitchen_preparation_started_at || item.created_at),
    ),
    now,
  );
  const billRequestedMinutes = minutesSince(order.bill_requested_at, now);

  if (
    kitchenStatus === "waiting" &&
    createdMinutes >= ALERT_THRESHOLDS.waitingMinutes
  ) {
    alerts.push({
      type: "waiting",
      label: "Waiting more than X minutes",
      minutes: createdMinutes,
    });
  }
  if (
    kitchenStatus === "preparing" &&
    (latestKitchenStartMinutes ?? createdMinutes) >=
      ALERT_THRESHOLDS.kitchenDelayMinutes
  ) {
    alerts.push({
      type: "kitchen_delay",
      label: "Kitchen delay",
      minutes: latestKitchenStartMinutes ?? createdMinutes,
    });
  }
  if (
    cashierStatus === "waiting_payment" &&
    (billRequestedMinutes ?? createdMinutes) >=
      ALERT_THRESHOLDS.waitingPaymentMinutes
  ) {
    alerts.push({
      type: "waiting_payment",
      label: "Payment due",
      minutes: billRequestedMinutes ?? createdMinutes,
    });
  }
  if (
    kitchenStatus === "ready" &&
    (latestReadyMinutes ?? createdMinutes) >=
      ALERT_THRESHOLDS.waitingPickupMinutes
  ) {
    alerts.push({
      type: "waiting_pickup",
      label: "Waiting pickup",
      minutes: latestReadyMinutes ?? createdMinutes,
    });
  }
  if ((sessionMinutes ?? 0) >= ALERT_THRESHOLDS.longSessionMinutes) {
    alerts.push({
      type: "long_session",
      label: "Long dining session",
      minutes: sessionMinutes ?? 0,
    });
  }

  return alerts;
}

function deriveTableStatus(
  active: boolean,
  order: OrderRow | null,
  alerts: ManagerOperationAlert[],
): ManagerFloorTableStatus {
  if (!active) return "inactive";
  if (!order) return "available";
  const alertRank: ManagerOperationAlert["type"][] = [
    "waiting_payment",
    "kitchen_delay",
    "waiting_pickup",
    "long_session",
    "waiting",
  ];
  const primaryAlert = alertRank.find((alertType) =>
    alerts.some((alert) => alert.type === alertType),
  );
  if (primaryAlert) return primaryAlert;
  return order.order_source === "public_qr" ? "qr_ordering" : "occupied";
}

function buildFloorTables(
  tables: TableRow[],
  openOrders: OrderRow[],
  itemsByOrderId: Map<string, OrderItemRow[]>,
  invoicesByOrderId: Map<string, InvoiceRow[]>,
  assignmentsByTableId: Map<string, AssignmentRow>,
  now: Date,
): ManagerFloorTable[] {
  const ordersByTableId = new Map(
    openOrders
      .filter((order) => order.table_id)
      .map((order) => [order.table_id, order]),
  );
  const ordersByTableNumber = new Map(
    openOrders
      .filter((order) => order.table_number)
      .map((order) => [order.table_number, order]),
  );

  return tables.map((table) => {
    const tableNumber = Number(table.table_number);
    const order =
      ordersByTableId.get(table.id) ??
      ordersByTableNumber.get(String(tableNumber)) ??
      null;
    const items = order ? (itemsByOrderId.get(order.id) ?? []) : [];
    const invoices = order ? (invoicesByOrderId.get(order.id) ?? []) : [];
    const openedAt =
      order?.dining_session_opened_at ?? order?.created_at ?? null;
    const sessionDurationMinutes = minutesSince(openedAt, now);
    const kitchenStatus = deriveKitchenStatus(items);
    const cashierStatus = order ? deriveCashierStatus(order, invoices) : "none";
    const alerts = order
      ? buildAlerts(
          order,
          items,
          kitchenStatus,
          cashierStatus,
          sessionDurationMinutes,
          now,
        )
      : [];
    const status = deriveTableStatus(table.active, order, alerts);
    const runningBill =
      invoices.length > 0
        ? invoices
            .filter(
              (invoice) =>
                !["cancelled", "refunded"].includes(invoice.status || ""),
            )
            .reduce((sum, invoice) => sum + Number(invoice.total_price ?? 0), 0)
        : Number(order?.total_price ?? 0);

    return {
      id: table.id,
      number: tableNumber,
      label: table.label || `Table ${tableNumber}`,
      seats: table.seats == null ? null : Number(table.seats),
      active: table.active,
      status,
      activeOrderId: order?.id ?? null,
      activeOrderStatus: order?.status ?? null,
      activeOrderSource: order?.order_source ?? null,
      customerName: order?.customer_name ?? null,
      openedAt,
      assignedWaiterName: assignmentName(assignmentsByTableId.get(table.id)),
      runningBill,
      sessionDurationMinutes,
      kitchenStatus,
      cashierStatus,
      itemCount: items.reduce(
        (sum, item) => sum + Number(item.quantity ?? 0),
        0,
      ),
      readyItemCount: items
        .filter((item) => item.kitchen_status === "ready")
        .reduce((sum, item) => sum + Number(item.quantity ?? 0), 0),
      invoiceCount: invoices.length,
      alerts,
    };
  });
}

function buildNotifications(
  kpis: ManagerKpis,
  activeShiftOpen: boolean,
  floorTables: ManagerFloorTable[],
): string[] {
  const notifications: string[] = [];
  const alertTables = floorTables.filter((table) => table.alerts.length > 0);
  if (kpis.kitchenWaiting > 0)
    notifications.push(
      `${kpis.kitchenWaiting} order${kpis.kitchenWaiting === 1 ? "" : "s"} waiting for kitchen`,
    );
  if (kpis.awaitingCashier > 0)
    notifications.push(
      `${kpis.awaitingCashier} table${kpis.awaitingCashier === 1 ? "" : "s"} awaiting cashier`,
    );
  if (alertTables.length > 0)
    notifications.push(
      `${alertTables.length} table${alertTables.length === 1 ? "" : "s"} need manager attention`,
    );
  if (!activeShiftOpen) notifications.push("No active cashier shift");
  return notifications;
}

export async function fetchManagerDashboardSnapshot(
  restaurantId: string,
): Promise<ManagerDashboardSnapshot> {
  const [
    restaurant,
    openOrders,
    tables,
    staffOnDuty,
    activeShiftOpen,
    assignments,
    liveMetrics,
  ] = await Promise.all([
    fetchRestaurantContext(restaurantId),
    fetchOpenOrders(restaurantId),
    fetchTables(restaurantId),
    fetchStaffOnDuty(restaurantId),
    fetchActiveShiftOpen(restaurantId),
    fetchAssignments(restaurantId),
    fetchLiveMetrics(restaurantId),
  ]);
  const orderIds = openOrders.map((order) => order.id);
  const [orderItems, invoices] = await Promise.all([
    fetchOrderItems(restaurantId, orderIds),
    fetchInvoices(restaurantId, orderIds),
  ]);
  const kpis = buildKpis(openOrders, staffOnDuty);
  const floorTables = buildFloorTables(
    tables,
    openOrders,
    groupByOrderId(orderItems),
    groupByOrderId(invoices),
    new Map(assignments.map((assignment) => [assignment.table_id, assignment])),
    new Date(),
  );

  return {
    restaurant,
    kpis,
    liveMetrics,
    floorTables,
    notifications: buildNotifications(kpis, activeShiftOpen, floorTables),
  };
}

export async function releaseManagerDiningSession(orderId: string) {
  const { error } = await supabase.rpc("close_dining_session", {
    target_order_id: orderId,
    close_reason: "table_released_by_manager",
  });
  if (error) throw new Error(error.message);
}

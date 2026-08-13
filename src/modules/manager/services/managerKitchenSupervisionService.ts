import { supabase } from "../../../core/database";

export type ManagerKitchenAlertType = "queue" | "overdue" | "overloaded" | "inactive" | "no_cook";

export type ManagerKitchenAlert = {
  id: string;
  type: ManagerKitchenAlertType;
  severity: "warning" | "critical";
  stationId: string;
  stationName: string;
  message: string;
};

export type ManagerKitchenStationSummary = {
  id: string;
  name: string;
  color: string;
  active: boolean;
  paused: boolean;
  pausedAt: string | null;
  queueLength: number;
  waiting: number;
  preparing: number;
  ready: number;
  delayed: number;
  averagePreparationMinutes: number;
  activeStaff: number;
  activeStaffNames: string[];
  assignedStaffNames: string[];
  currentWorkload: "idle" | "normal" | "busy" | "overloaded" | "paused";
  rush: boolean;
  bottleneck: boolean;
  inactive: boolean;
  activeBatches: ManagerKitchenBatch[];
};

export type ManagerKitchenStaffMember = {
  id: string;
  name: string;
  employeeId: string;
  assignedStationId: string | null;
  online: boolean;
  breakStatus: "on_break" | "not_on_break" | "not_recorded";
};

export type ManagerKitchenBatch = {
  orderId: string;
  displayNumber: string;
  tableNumber: string | null;
  customerName: string | null;
  stationId: string;
  status: "waiting" | "preparing" | "ready";
  priority: number;
  itemCount: number;
  items: Array<{ id: string; name: string; quantity: number }>;
  waitingMinutes: number;
  preparingMinutes: number | null;
  canManage: boolean;
};

export type ManagerKitchenPerformance = {
  currentWorkload: "idle" | "normal" | "busy" | "overloaded";
  averageTicketMinutes: number;
  delayedTickets: number;
  rushIndicator: boolean;
  bottleneckIndicator: boolean;
};

export type ManagerKitchenSupervisionSnapshot = {
  stations: ManagerKitchenStationSummary[];
  kitchenStaff: ManagerKitchenStaffMember[];
  totalQueue: number;
  delayedOrders: number;
  rushStations: number;
  performance: ManagerKitchenPerformance;
  alerts: ManagerKitchenAlert[];
};

type StationRow = {
  id: string;
  name: string;
  display_color: string | null;
  active: boolean;
  paused_at?: string | null;
};

type StaffRow = {
  id: string;
  display_name: string | null;
  employee_id: string | null;
  assigned_kitchen_station_id: string | null;
  staff_session_active?: boolean | null;
};

type StaffActivityRow = { target_staff_id: string | null; action: string };

type ItemRow = {
  id: string;
  order_id: string;
  kitchen_station_id: string | null;
  kitchen_status: string | null;
  quantity: number | string;
  created_at: string;
  appended_at?: string | null;
  kitchen_preparation_started_at?: string | null;
  kitchen_ready_marked_at?: string | null;
  menu_items?: { name?: string | null } | Array<{ name?: string | null }> | null;
  orders?: {
    id?: string;
    display_number?: string | null;
    table_number?: string | null;
    customer_name?: string | null;
    kitchen_priority?: number | string | null;
    status?: string | null;
  } | Array<{
    id?: string;
    display_number?: string | null;
    table_number?: string | null;
    customer_name?: string | null;
    kitchen_priority?: number | string | null;
    status?: string | null;
  }> | null;
};

const QUEUE_THRESHOLD = 10;
const OVERDUE_WAITING_MINUTES = 20;
const OVERDUE_PREPARING_MINUTES = 25;

function minutesSince(value: string | null | undefined, now: Date) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 0;
  return Math.max(0, Math.floor((now.getTime() - timestamp) / 60_000));
}

function firstOrder(row: ItemRow) {
  return Array.isArray(row.orders) ? row.orders[0] : row.orders;
}

function itemName(row: ItemRow) {
  const menuItem = Array.isArray(row.menu_items) ? row.menu_items[0] : row.menu_items;
  return menuItem?.name?.trim() || "Menu item";
}

function workloadFor(queueLength: number, activeBatches: number, paused: boolean): ManagerKitchenStationSummary["currentWorkload"] {
  if (paused) return "paused";
  if (queueLength === 0) return "idle";
  if (queueLength >= QUEUE_THRESHOLD || activeBatches >= 5) return "overloaded";
  if (queueLength >= 6 || activeBatches >= 3) return "busy";
  return "normal";
}

function overallWorkload(totalQueue: number, overloadedStations: number): ManagerKitchenPerformance["currentWorkload"] {
  if (totalQueue === 0) return "idle";
  if (overloadedStations > 0 || totalQueue >= 18) return "overloaded";
  if (totalQueue >= 10) return "busy";
  return "normal";
}

export async function loadManagerKitchenSupervision(restaurantId: string): Promise<ManagerKitchenSupervisionSnapshot> {
  const [stationsResult, itemsResult, staffResult, staffActivityResult] = await Promise.all([
    supabase
      .from("kitchen_stations")
      .select("id,name,display_color,active,paused_at")
      .eq("restaurant_id", restaurantId)
      .is("archived_at", null)
      .order("priority", { ascending: true }),
    supabase
      .from("order_items")
      .select("id,order_id,kitchen_station_id,kitchen_status,quantity,created_at,appended_at,kitchen_preparation_started_at,kitchen_ready_marked_at,menu_items!order_items_menu_item_id_fkey(name),orders!order_items_order_same_restaurant(id,display_number,table_number,customer_name,kitchen_priority,status)")
      .eq("restaurant_id", restaurantId)
      .in("kitchen_status", ["accepted", "preparing", "ready"]),
    supabase
      .from("restaurant_staff")
      .select("id,display_name,employee_id,assigned_kitchen_station_id,staff_session_active")
      .eq("restaurant_id", restaurantId)
      .eq("role", "kitchen")
      .eq("active", true),
    supabase
      .from("staff_activity_log")
      .select("target_staff_id,action")
      .eq("restaurant_id", restaurantId)
      .in("action", ["staff_break_started", "staff_break_ended"])
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (stationsResult.error) throw new Error(stationsResult.error.message);
  if (itemsResult.error) throw new Error(itemsResult.error.message);
  if (staffResult.error) throw new Error(staffResult.error.message);
  if (staffActivityResult.error) throw new Error(staffActivityResult.error.message);

  const now = new Date();
  const stationMap = new Map<string, ManagerKitchenStationSummary>();
  const stationRows = (stationsResult.data ?? []) as StationRow[];

  for (const station of stationRows) {
    stationMap.set(station.id, {
      id: station.id,
      name: station.name,
      color: station.display_color || "#0f766e",
      active: station.active,
      paused: Boolean(station.paused_at),
      pausedAt: station.paused_at ?? null,
      queueLength: 0,
      waiting: 0,
      preparing: 0,
      ready: 0,
      delayed: 0,
      averagePreparationMinutes: 0,
      activeStaff: 0,
      activeStaffNames: [],
      assignedStaffNames: [],
      currentWorkload: "idle",
      rush: false,
      bottleneck: false,
      inactive: !station.active,
      activeBatches: [],
    });
  }

  const breakStateByStaff = new Map<string, "on_break" | "not_on_break">();
  for (const activity of (staffActivityResult.data ?? []) as StaffActivityRow[]) {
    if (!activity.target_staff_id || breakStateByStaff.has(activity.target_staff_id)) continue;
    breakStateByStaff.set(activity.target_staff_id, activity.action === "staff_break_started" ? "on_break" : "not_on_break");
  }
  const kitchenStaff = ((staffResult.data ?? []) as StaffRow[]).map((staff) => ({
    id: staff.id,
    name: staff.display_name || "Kitchen staff",
    employeeId: staff.employee_id || "Not recorded",
    assignedStationId: staff.assigned_kitchen_station_id,
    online: Boolean(staff.staff_session_active),
    breakStatus: breakStateByStaff.get(staff.id) ?? "not_recorded" as const,
  }));

  for (const staff of kitchenStaff) {
    if (!staff.assignedStationId) continue;
    const station = stationMap.get(staff.assignedStationId);
    if (!station) continue;
    station.assignedStaffNames.push(staff.name);
    if (!staff.online || staff.breakStatus === "on_break") continue;
    station.activeStaff += 1;
    station.activeStaffNames.push(staff.name);
  }

  const batchMap = new Map<string, ManagerKitchenBatch>();
  for (const item of (itemsResult.data ?? []) as ItemRow[]) {
    if (!item.kitchen_station_id) continue;
    const order = firstOrder(item);
    if (order?.status === "completed" || order?.status === "cancelled" || item.kitchen_status === "completed") continue;
    const key = `${item.kitchen_station_id}:${item.order_id}`;
    const existing = batchMap.get(key);
    const waitingMinutes = minutesSince(item.appended_at ?? item.created_at, now);
    const preparingMinutes = item.kitchen_preparation_started_at ? minutesSince(item.kitchen_preparation_started_at, now) : null;
    const quantity = Number(item.quantity ?? 1);
    const status: ManagerKitchenBatch["status"] = item.kitchen_status === "preparing" ? "preparing" : item.kitchen_status === "ready" ? "ready" : "waiting";
    if (existing) {
      existing.itemCount += quantity;
      existing.items.push({ id: item.id, name: itemName(item), quantity });
      existing.waitingMinutes = Math.max(existing.waitingMinutes, waitingMinutes);
      existing.preparingMinutes = preparingMinutes == null ? existing.preparingMinutes : Math.max(existing.preparingMinutes ?? 0, preparingMinutes);
      existing.status = existing.status === "preparing" || status === "preparing" ? "preparing" : existing.status === "ready" || status === "ready" ? "ready" : "waiting";
    } else {
      batchMap.set(key, {
        orderId: item.order_id,
        displayNumber: order?.display_number || item.order_id.slice(0, 8),
        tableNumber: order?.table_number ?? null,
        customerName: order?.customer_name ?? null,
        stationId: item.kitchen_station_id,
        status,
        priority: Number(order?.kitchen_priority ?? 0),
        itemCount: quantity,
        items: [{ id: item.id, name: itemName(item), quantity }],
        waitingMinutes,
        preparingMinutes,
        canManage: true,
      });
    }
  }

  for (const batch of batchMap.values()) {
    const station = stationMap.get(batch.stationId);
    if (!station) continue;
    station.activeBatches.push(batch);
    station.queueLength += batch.itemCount;
    if (batch.status === "waiting") station.waiting += batch.itemCount;
    if (batch.status === "preparing") station.preparing += batch.itemCount;
    if (batch.status === "ready") station.ready += batch.itemCount;
    if (batch.waitingMinutes >= OVERDUE_WAITING_MINUTES || (batch.preparingMinutes ?? 0) >= OVERDUE_PREPARING_MINUTES) station.delayed += 1;
  }

  const alerts: ManagerKitchenAlert[] = [];
  for (const station of stationMap.values()) {
    station.activeBatches.sort((left, right) => right.priority - left.priority || right.waitingMinutes - left.waitingMinutes);
    const prepDurations = station.activeBatches.map((batch) => batch.preparingMinutes).filter((value): value is number => value !== null);
    station.averagePreparationMinutes = prepDurations.length ? Math.round(prepDurations.reduce((sum, value) => sum + value, 0) / prepDurations.length) : 0;
    station.currentWorkload = workloadFor(station.queueLength, station.activeBatches.length, station.paused);
    station.rush = station.currentWorkload === "overloaded" || station.delayed >= 2;
    station.bottleneck = station.delayed >= 2 || (station.activeStaff === 0 && station.queueLength > 0) || station.averagePreparationMinutes >= OVERDUE_PREPARING_MINUTES;
    station.inactive = !station.active || (station.queueLength > 0 && station.activeStaff === 0);

    if (station.queueLength > QUEUE_THRESHOLD) alerts.push({ id: `${station.id}:queue`, type: "queue", severity: "warning", stationId: station.id, stationName: station.name, message: `${station.name} queue exceeds threshold (${station.queueLength}).` });
    if (station.delayed > 0) alerts.push({ id: `${station.id}:overdue`, type: "overdue", severity: station.delayed >= 2 ? "critical" : "warning", stationId: station.id, stationName: station.name, message: `${station.delayed} overdue ticket${station.delayed === 1 ? "" : "s"} at ${station.name}.` });
    if (station.currentWorkload === "overloaded") alerts.push({ id: `${station.id}:overloaded`, type: "overloaded", severity: "critical", stationId: station.id, stationName: station.name, message: `${station.name} is overloaded.` });
    if (!station.active || station.paused) alerts.push({ id: `${station.id}:inactive`, type: "inactive", severity: "warning", stationId: station.id, stationName: station.name, message: `${station.name} is ${station.paused ? "paused" : "inactive"}.` });
    if (station.queueLength > 0 && station.activeStaff === 0) alerts.push({ id: `${station.id}:no-cook`, type: "no_cook", severity: "critical", stationId: station.id, stationName: station.name, message: `No cook assigned to active ${station.name} queue.` });
  }

  const stations = Array.from(stationMap.values());
  const totalQueue = stations.reduce((sum, station) => sum + station.queueLength, 0);
  const delayedOrders = stations.reduce((sum, station) => sum + station.delayed, 0);
  const averageTicketMinutes = stations.length ? Math.round(stations.reduce((sum, station) => sum + station.averagePreparationMinutes, 0) / Math.max(1, stations.filter((station) => station.averagePreparationMinutes > 0).length)) : 0;
  const overloadedStations = stations.filter((station) => station.currentWorkload === "overloaded").length;

  return {
    stations,
    kitchenStaff,
    totalQueue,
    delayedOrders,
    rushStations: stations.filter((station) => station.rush).length,
    performance: {
      currentWorkload: overallWorkload(totalQueue, overloadedStations),
      averageTicketMinutes,
      delayedTickets: delayedOrders,
      rushIndicator: stations.some((station) => station.rush),
      bottleneckIndicator: stations.some((station) => station.bottleneck),
    },
    alerts,
  };
}

export async function prioritizeManagerKitchenOrder(restaurantId: string, orderId: string) {
  const { error } = await supabase.rpc("manager_prioritize_kitchen_order", { target_restaurant_id: restaurantId, target_order_id: orderId, priority_delta: 1 });
  if (error) throw new Error(error.message);
}

export async function reassignManagerKitchenBatch(restaurantId: string, orderId: string, sourceStationId: string, destinationStationId: string) {
  const { error } = await supabase.rpc("manager_reassign_kitchen_batch", { target_restaurant_id: restaurantId, target_order_id: orderId, source_station_id: sourceStationId, destination_station_id: destinationStationId });
  if (error) throw new Error(error.message);
}

export async function setManagerKitchenStationPaused(restaurantId: string, stationId: string, paused: boolean, reason?: string) {
  const { error } = await supabase.rpc("manager_set_kitchen_station_paused", { target_restaurant_id: restaurantId, target_station_id: stationId, requested_paused: paused, reason: reason ?? null });
  if (error) throw new Error(error.message);
}

export async function sendManagerKitchenMessage(restaurantId: string, stationId: string, message: string) {
  const { error } = await supabase.rpc("manager_send_kitchen_message", { target_restaurant_id: restaurantId, target_station_id: stationId, message });
  if (error) throw new Error(error.message);
}

export async function callAdditionalKitchenStaff(restaurantId: string, stationId: string, reason: string) {
  const { error } = await supabase.rpc("manager_call_additional_kitchen_staff", { target_restaurant_id: restaurantId, target_station_id: stationId, reason });
  if (error) throw new Error(error.message);
}

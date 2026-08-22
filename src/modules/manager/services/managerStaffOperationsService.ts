import { supabase } from "../../../core/database";

export type ManagerStaffRole = "cashier" | "kitchen" | "waiter" | "reception" | "inventory" | "inventory_officer";
export type ManagerDirectoryRole = ManagerStaffRole | "supervisor";
export type StaffCredentialReadiness = "legacy_credential" | "reset_required" | "password_ready" | "waiter_pin_ready";

export type ManagerKitchenStation = {
  id: string;
  name: string;
  active: boolean;
};

export type ManagerRestaurantTableOption = {
  id: string;
  label: string;
  tableNumber: number;
};

export type ManagerStaffMember = {
  id: string;
  userId: string;
  avatarInitials: string;
  fullName: string;
  employeeId: string;
  email: string | null;
  phoneNumber: string | null;
  shift: string | null;
  role: ManagerStaffRole;
  shiftStatus: "not_recorded";
  breakStatus: "on_break" | "not_on_break" | "not_recorded";
  clockIn: string | null;
  clockOut: string | null;
  assignedTables: ManagerRestaurantTableOption[];
  assignedKitchenStationId: string | null;
  assignedKitchenStationName: string | null;
  currentWorkload: number;
  activeOrders: number;
  lastActivity: string | null;
  online: boolean;
  active: boolean;
  credentialReadiness: StaffCredentialReadiness | null;
};

export type ManagerStaffActivity = {
  id: string;
  action: string;
  targetStaffId: string | null;
  targetStaffEmail: string | null;
  details: Record<string, unknown>;
  createdAt: string;
};

export type ManagerStaffOperationsSnapshot = {
  staff: ManagerStaffMember[];
  stations: ManagerKitchenStation[];
  tables: ManagerRestaurantTableOption[];
  activity: ManagerStaffActivity[];
};

type StaffRow = {
  id: string;
  user_id: string;
  display_name: string;
  employee_id: string;
  contact_email: string | null;
  shift_label: string | null;
  email: string | null;
  username: string | null;
  phone_number: string | null;
  role: ManagerStaffRole | "owner" | "manager";
  assigned_kitchen_station_id: string | null;
  active: boolean;
  last_login_at: string | null;
  last_logout_at?: string | null;
  staff_session_active: boolean | null;
  waiter_session_active: boolean | null;
};

type StationRow = { id: string; name: string; active: boolean };
type TableRow = { id: string; label: string | null; table_number: number | string };
type AssignmentRow = { waiter_staff_id: string; table_id: string };
type OrderRow = {
  id: string;
  status: string;
  created_by_waiter_id: string | null;
  payment_verified_by?: string | null;
};
type ItemRow = { id: string; kitchen_status: string | null; kitchen_station_id: string | null };
type ActivityRow = {
  id: string;
  action: string;
  target_staff_id: string | null;
  target_staff_email: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

type StaffFunctionResponse = {
  ok?: boolean;
  staffId?: string;
  error?: string;
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "SF";
}

async function getFunctionErrorMessage(error: unknown) {
  const context = error && typeof error === "object" ? (error as { context?: unknown }).context : null;
  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as { error?: unknown };
      return typeof body.error === "string" ? body.error : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function invokeManageStaff(payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke<StaffFunctionResponse>("manage-staff", { body: payload });
  if (error) throw new Error((await getFunctionErrorMessage(error)) || error.message);
  if (data?.error) throw new Error(data.error);
  return data ?? {};
}

export async function loadManagerStaffOperations(restaurantId: string): Promise<ManagerStaffOperationsSnapshot> {
  const [staffResult, stationsResult, tablesResult, assignmentsResult, ordersResult, itemsResult, activityResult, readinessResult] = await Promise.all([
    supabase.from("restaurant_staff").select("id,user_id,display_name,employee_id,contact_email,phone_number,shift_label,role,assigned_kitchen_station_id,active,last_login_at,last_logout_at,staff_session_active,waiter_session_active").eq("restaurant_id", restaurantId).not("role", "in", "(owner,manager)").order("display_name", { ascending: true }),
    supabase.from("kitchen_stations").select("id,name,active").eq("restaurant_id", restaurantId).order("priority", { ascending: true }),
    supabase.from("restaurant_tables").select("id,label,table_number").eq("restaurant_id", restaurantId).eq("active", true).order("table_number", { ascending: true }),
    supabase.from("restaurant_table_waiter_assignments").select("waiter_staff_id,table_id").eq("restaurant_id", restaurantId).eq("active", true),
    supabase.from("orders").select("id,status,created_by_waiter_id,payment_verified_by").eq("restaurant_id", restaurantId).eq("dining_session_status", "open"),
    supabase.from("order_items").select("id,kitchen_status,kitchen_station_id").eq("restaurant_id", restaurantId).in("kitchen_status", ["accepted", "preparing", "ready"]),
    supabase.from("staff_activity_log").select("id,action,target_staff_id,target_staff_email,details,created_at").eq("restaurant_id", restaurantId).order("created_at", { ascending: false }).limit(80),
    supabase.from("staff_credential_readiness").select("staff_id,readiness").eq("restaurant_id", restaurantId),
  ]);

  for (const result of [staffResult, stationsResult, tablesResult, assignmentsResult, ordersResult, itemsResult, activityResult, readinessResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const stations = ((stationsResult.data ?? []) as StationRow[]).map((station) => ({ id: station.id, name: station.name, active: station.active }));
  const stationNameById = new Map(stations.map((station) => [station.id, station.name]));
  const tables = ((tablesResult.data ?? []) as TableRow[]).map((table) => ({
    id: table.id,
    label: table.label || `Table ${Number(table.table_number)}`,
    tableNumber: Number(table.table_number),
  }));
  const tableById = new Map(tables.map((table) => [table.id, table]));
  const assignmentsByWaiter = new Map<string, ManagerRestaurantTableOption[]>();
  for (const assignment of (assignmentsResult.data ?? []) as AssignmentRow[]) {
    const table = tableById.get(assignment.table_id);
    if (!table) continue;
    const existing = assignmentsByWaiter.get(assignment.waiter_staff_id) ?? [];
    existing.push(table);
    assignmentsByWaiter.set(assignment.waiter_staff_id, existing);
  }

  const orders = (ordersResult.data ?? []) as OrderRow[];
  const items = (itemsResult.data ?? []) as ItemRow[];
  const activeOrdersByWaiter = new Map<string, number>();
  const workloadByStation = new Map<string, number>();
  for (const order of orders) {
    if (order.created_by_waiter_id) activeOrdersByWaiter.set(order.created_by_waiter_id, (activeOrdersByWaiter.get(order.created_by_waiter_id) ?? 0) + 1);
  }
  for (const item of items) {
    if (item.kitchen_station_id) workloadByStation.set(item.kitchen_station_id, (workloadByStation.get(item.kitchen_station_id) ?? 0) + 1);
  }

  const latestActivityByStaff = new Map<string, string>();
  const readinessByStaff = new Map((readinessResult.data ?? []).map((row) => [row.staff_id, row.readiness as StaffCredentialReadiness]));
  const latestBreakStateByStaff = new Map<string, "on_break" | "not_on_break">();
  const activity = ((activityResult.data ?? []) as ActivityRow[]).map((entry) => {
    if (entry.target_staff_id && !latestActivityByStaff.has(entry.target_staff_id)) latestActivityByStaff.set(entry.target_staff_id, entry.created_at);
    if (entry.target_staff_id && !latestBreakStateByStaff.has(entry.target_staff_id)) {
      if (entry.action === "staff_break_started") latestBreakStateByStaff.set(entry.target_staff_id, "on_break");
      if (entry.action === "staff_break_ended") latestBreakStateByStaff.set(entry.target_staff_id, "not_on_break");
    }
    return { id: entry.id, action: entry.action, targetStaffId: entry.target_staff_id, targetStaffEmail: entry.target_staff_email, details: entry.details ?? {}, createdAt: entry.created_at };
  });

  return {
    staff: ((staffResult.data ?? []) as StaffRow[])
      .filter((member) => member.role !== "owner" && member.role !== "manager")
      .map((member) => {
        const online = Boolean(member.staff_session_active || member.waiter_session_active);
        const assignedTables = assignmentsByWaiter.get(member.id) ?? [];
        return {
          id: member.id,
          userId: member.user_id,
          avatarInitials: initials(member.display_name),
          fullName: member.display_name,
          employeeId: member.employee_id,
          email: member.contact_email,
          phoneNumber: member.phone_number,
          shift: member.shift_label,
          role: member.role as ManagerStaffRole,
          shiftStatus: "not_recorded",
          breakStatus: latestBreakStateByStaff.get(member.id) ?? "not_recorded",
          clockIn: null,
          clockOut: member.last_logout_at ?? null,
          assignedTables,
          assignedKitchenStationId: member.assigned_kitchen_station_id,
          assignedKitchenStationName: member.assigned_kitchen_station_id ? stationNameById.get(member.assigned_kitchen_station_id) ?? null : null,
          currentWorkload: member.role === "kitchen" && member.assigned_kitchen_station_id ? workloadByStation.get(member.assigned_kitchen_station_id) ?? 0 : activeOrdersByWaiter.get(member.id) ?? 0,
          activeOrders: activeOrdersByWaiter.get(member.id) ?? 0,
          lastActivity: latestActivityByStaff.get(member.id) ?? member.last_login_at,
          online,
          active: member.active,
          credentialReadiness: readinessByStaff.get(member.id) ?? null,
        };
      }),
    stations,
    tables,
    activity,
  };
}

export function createManagerStaff(restaurantId: string, input: { fullName: string; email?: string; pinPassword: string; phoneNumber?: string; shift?: string; role: ManagerStaffRole }) {
  return invokeManageStaff({ action: "create-staff", restaurantId, ...input });
}

export function updateManagerStaff(restaurantId: string, staffId: string, input: Partial<{ fullName: string; phoneNumber: string; shift: string; role: ManagerStaffRole; assignedKitchenStationId: string | null }>) {
  return invokeManageStaff({ action: "update-staff", restaurantId, staffId, ...input });
}

export function activateManagerStaff(restaurantId: string, staffId: string) {
  return invokeManageStaff({ action: "reactivate-staff", restaurantId, staffId });
}

export function deactivateManagerStaff(restaurantId: string, staffId: string) {
  return invokeManageStaff({ action: "deactivate-staff", restaurantId, staffId });
}

export function suspendManagerStaff(restaurantId: string, staffId: string) {
  return invokeManageStaff({ action: "suspend-staff", restaurantId, staffId });
}

export function resetManagerStaffPassword(restaurantId: string, staffId: string) {
  return invokeManageStaff({ action: "send-password-reset", restaurantId, staffId });
}

export function setManagerWaiterPin(restaurantId: string, staffId: string, pin: string) {
  return invokeManageStaff({ action: "set-waiter-pin", restaurantId, staffId, pinPassword: pin });
}

export function assignWaiterTables(restaurantId: string, staffId: string, tableIds: string[]) {
  return invokeManageStaff({ action: "assign-waiter-tables", restaurantId, staffId, tableIds });
}

export function markManagerStaffBreak(restaurantId: string, staffId: string) {
  return invokeManageStaff({ action: "mark-break", restaurantId, staffId });
}

export function endManagerStaffBreak(restaurantId: string, staffId: string) {
  return invokeManageStaff({ action: "end-break", restaurantId, staffId });
}

export function sendManagerStaffMessage(restaurantId: string, staffId: string, message: string, announcement = true) {
  return invokeManageStaff({ action: announcement ? "send-announcement" : "send-notification", restaurantId, staffId, message });
}

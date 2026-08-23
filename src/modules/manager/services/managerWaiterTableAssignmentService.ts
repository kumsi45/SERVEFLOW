import { supabase } from "../../../core/database";

export type ManagerWaiterAssignmentCandidate = {
  staffId: string;
  displayName: string;
  active: boolean;
  assignedTableCount: number;
};

export type ManagerWaiterAssignmentTable = {
  tableId: string;
  tableNumber: number;
  tableLabel: string;
  active: boolean;
  currentWaiterStaffId: string | null;
  currentWaiterName: string | null;
  assignmentVersion: number | null;
  occupancyStatus: "occupied" | "available";
};

export type ManagerWaiterAssignmentContext = {
  waiters: ManagerWaiterAssignmentCandidate[];
  tables: ManagerWaiterAssignmentTable[];
};

type ContextRow = {
  waiters?: Array<{
    staff_id?: unknown;
    display_name?: unknown;
    active?: unknown;
    assigned_table_count?: unknown;
  }>;
  tables?: Array<{
    table_id?: unknown;
    table_number?: unknown;
    table_label?: unknown;
    active?: unknown;
    current_waiter_staff_id?: unknown;
    current_waiter_name?: unknown;
    assignment_version?: unknown;
    occupancy_status?: unknown;
  }>;
};

export type ManagerWaiterAssignmentResult = {
  tableId: string;
  waiterStaffId: string;
  assignedAt: string;
  assignmentVersion: number;
};

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value) throw new Error(`Table assignment data is missing ${field}.`);
  return value;
}

export async function loadManagerWaiterTableAssignments(restaurantId: string): Promise<ManagerWaiterAssignmentContext> {
  const { data, error } = await supabase.rpc("get_waiter_table_assignment_context", { target_restaurant_id: restaurantId });
  if (error) throw new Error(error.message);
  const context = (data ?? {}) as ContextRow;
  return {
    waiters: (context.waiters ?? []).map((waiter) => ({
      staffId: requiredString(waiter.staff_id, "Waiter identity"),
      displayName: requiredString(waiter.display_name, "Waiter name"),
      active: waiter.active === true,
      assignedTableCount: Number(waiter.assigned_table_count ?? 0),
    })).filter((waiter) => waiter.active),
    tables: (context.tables ?? []).map((table) => ({
      tableId: requiredString(table.table_id, "table identity"),
      tableNumber: Number(table.table_number),
      tableLabel: typeof table.table_label === "string" && table.table_label ? table.table_label : `Table ${Number(table.table_number)}`,
      active: table.active === true,
      currentWaiterStaffId: typeof table.current_waiter_staff_id === "string" ? table.current_waiter_staff_id : null,
      currentWaiterName: typeof table.current_waiter_name === "string" ? table.current_waiter_name : null,
      assignmentVersion: table.assignment_version == null ? null : Number(table.assignment_version),
      occupancyStatus: table.occupancy_status === "occupied" ? "occupied" as const : "available" as const,
    })).filter((table) => table.active),
  };
}

export async function assignManagerWaiterTables(restaurantId: string, waiterStaffId: string, tableIds: string[]) {
  const { data, error } = await supabase.rpc("assign_waiter_tables", {
    target_restaurant_id: restaurantId,
    target_waiter_staff_id: waiterStaffId,
    target_table_ids: tableIds,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((assignment): ManagerWaiterAssignmentResult => ({
    tableId: requiredString(assignment.table_id, "table identity"),
    waiterStaffId: requiredString(assignment.waiter_staff_id, "Waiter identity"),
    assignedAt: requiredString(assignment.assigned_at, "assignment time"),
    assignmentVersion: Number(assignment.assignment_version),
  }));
}

export async function unassignManagerWaiterTables(restaurantId: string, tableIds: string[]) {
  const { data, error } = await supabase.rpc("unassign_waiter_tables", {
    target_restaurant_id: restaurantId,
    target_table_ids: tableIds,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

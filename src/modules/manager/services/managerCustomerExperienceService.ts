import { supabase } from "../../../core/database";

export type CustomerExperienceAlertType = "long_wait" | "bill_wait" | "vip_wait" | "complaint" | "special_request";

export type CustomerExperienceAlert = {
  id: string;
  type: CustomerExperienceAlertType;
  severity: "warning" | "critical";
  orderId: string;
  tableNumber: string | null;
  message: string;
};

export type CustomerTimelineEvent = {
  id: string;
  orderId: string;
  label: string;
  at: string;
};

export type ManagerCustomerSession = {
  orderId: string;
  displayNumber: string;
  tableId: string | null;
  tableNumber: string | null;
  customerName: string | null;
  customerPhone: string | null;
  status: string;
  orderSource: string | null;
  openedAt: string;
  waitingMinutes: number;
  totalPrice: number;
  assignedWaiter: string | null;
  assignedWaiterId: string | null;
  billRequestedAt: string | null;
  billWaitingMinutes: number | null;
  specialRequests: string[];
  vip: boolean;
  complaintCount: number;
  unresolvedComplaintCount: number;
  timeline: CustomerTimelineEvent[];
};

export type ManagerComplaint = {
  id: string;
  orderId: string | null;
  tableNumber: string | null;
  customerName: string | null;
  category: string;
  description: string;
  status: "open" | "escalated" | "resolved";
  severity: "low" | "medium" | "high";
  createdAt: string;
  resolvedAt: string | null;
};

export type ManagerWaiterOption = {
  id: string;
  displayName: string;
};

export type ManagerCustomerExperienceSnapshot = {
  sessions: ManagerCustomerSession[];
  complaints: ManagerComplaint[];
  waiters: ManagerWaiterOption[];
  waitingCustomers: number;
  tablesRequestingBill: number;
  specialRequests: number;
  vipGuests: number;
  customerComplaints: number;
  reservationQueue: number;
  alerts: CustomerExperienceAlert[];
  timeline: CustomerTimelineEvent[];
};

type OrderRow = {
  id: string;
  display_number: string | null;
  table_id: string | null;
  table_number: string | null;
  status: string;
  order_source: string | null;
  customer_name: string | null;
  customer_phone?: string | null;
  total_price: number | string | null;
  created_at: string;
  dining_session_opened_at?: string | null;
  bill_requested_at?: string | null;
  billing_started_at?: string | null;
  payment_verified_at?: string | null;
  table_released_at?: string | null;
};

type ItemRow = {
  id: string;
  order_id: string;
  quantity: number | string;
  notes?: string | null;
  kitchen_status: string | null;
  created_at: string;
  kitchen_preparation_started_at?: string | null;
  kitchen_ready_marked_at?: string | null;
  kitchen_completed_at?: string | null;
};

type InvoiceRow = {
  order_id: string;
  status: string | null;
  created_at: string;
  paid_at?: string | null;
  verified_at?: string | null;
};

type AssignmentRow = {
  table_id: string | null;
  waiter_staff_id?: string | null;
  restaurant_staff?: { id?: string; display_name?: string | null } | Array<{ id?: string; display_name?: string | null }> | null;
};

type ComplaintRow = {
  id: string;
  order_id: string | null;
  table_number: string | null;
  customer_name: string | null;
  category: string | null;
  description: string;
  status: "open" | "escalated" | "resolved";
  severity: "low" | "medium" | "high";
  created_at: string;
  resolved_at: string | null;
};

const LONG_WAIT_MINUTES = 15;
const BILL_WAIT_MINUTES = 10;

function minutesSince(value: string | null | undefined, now: Date) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 0;
  return Math.max(0, Math.floor((now.getTime() - timestamp) / 60_000));
}

function firstStaff(row: AssignmentRow) {
  return Array.isArray(row.restaurant_staff) ? row.restaurant_staff[0] : row.restaurant_staff;
}

function groupByOrderId<T extends { order_id: string | null }>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.order_id) continue;
    const existing = groups.get(row.order_id) ?? [];
    existing.push(row);
    groups.set(row.order_id, existing);
  }
  return groups;
}

function isVip(order: OrderRow) {
  const haystack = `${order.customer_name ?? ""} ${order.customer_phone ?? ""}`.toLowerCase();
  return haystack.includes("vip");
}

function itemSpecialRequests(items: ItemRow[]) {
  return items
    .map((item) => item.notes?.trim())
    .filter((note): note is string => Boolean(note));
}

function timelineFor(order: OrderRow, items: ItemRow[], invoices: InvoiceRow[]): CustomerTimelineEvent[] {
  const events: CustomerTimelineEvent[] = [];
  const push = (label: string, at: string | null | undefined) => {
    if (at) events.push({ id: `${order.id}:${label}:${at}`, orderId: order.id, label, at });
  };
  push("Customer seated", order.dining_session_opened_at ?? order.created_at);
  push("Order placed", order.created_at);
  const acceptedAt = items.find((item) => item.kitchen_preparation_started_at)?.kitchen_preparation_started_at;
  push("Kitchen accepted", acceptedAt);
  const servedAt = items.find((item) => item.kitchen_completed_at || item.kitchen_status === "completed")?.kitchen_completed_at;
  push("Served", servedAt);
  push("Bill requested", order.bill_requested_at);
  const paidAt = invoices.find((invoice) => invoice.verified_at || invoice.paid_at)?.verified_at ?? invoices.find((invoice) => invoice.paid_at)?.paid_at;
  push("Paid", paidAt);
  push("Table released", order.table_released_at);
  return events.sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());
}

export async function loadManagerCustomerExperience(restaurantId: string): Promise<ManagerCustomerExperienceSnapshot> {
  const [ordersResult, itemsResult, invoicesResult, assignmentsResult, complaintsResult, waitersResult] = await Promise.all([
    supabase
      .from("orders")
      .select("id,display_number,table_id,table_number,status,order_source,customer_name,customer_phone,total_price,created_at,dining_session_opened_at,bill_requested_at,billing_started_at,payment_verified_at,table_released_at")
      .eq("restaurant_id", restaurantId)
      .eq("dining_session_status", "open")
      .order("created_at", { ascending: true }),
    supabase
      .from("order_items")
      .select("id,order_id,quantity,notes,kitchen_status,created_at,kitchen_preparation_started_at,kitchen_ready_marked_at,kitchen_completed_at")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: true }),
    supabase
      .from("order_invoices")
      .select("order_id,status,created_at,paid_at,verified_at")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: true }),
    supabase
      .from("restaurant_table_waiter_assignments")
      .select("table_id,waiter_staff_id,restaurant_staff!restaurant_table_waiter_assignments_waiter_staff_id_fkey(id,display_name)")
      .eq("restaurant_id", restaurantId)
      .eq("active", true),
    supabase
      .from("manager_customer_complaints")
      .select("id,order_id,table_number,customer_name,category,description,status,severity,created_at,resolved_at")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("restaurant_staff")
      .select("id,display_name")
      .eq("restaurant_id", restaurantId)
      .eq("role", "waiter")
      .eq("active", true)
      .order("display_name", { ascending: true }),
  ]);

  if (ordersResult.error) throw new Error(ordersResult.error.message);
  if (itemsResult.error) throw new Error(itemsResult.error.message);
  if (invoicesResult.error) throw new Error(invoicesResult.error.message);
  if (assignmentsResult.error) throw new Error(assignmentsResult.error.message);
  if (complaintsResult.error) throw new Error(complaintsResult.error.message);
  if (waitersResult.error) throw new Error(waitersResult.error.message);

  const now = new Date();
  const orders = (ordersResult.data ?? []) as OrderRow[];
  const itemsByOrder = groupByOrderId((itemsResult.data ?? []) as ItemRow[]);
  const invoicesByOrder = groupByOrderId((invoicesResult.data ?? []) as InvoiceRow[]);
  const complaints = ((complaintsResult.data ?? []) as ComplaintRow[]).map((row) => ({
    id: row.id,
    orderId: row.order_id,
    tableNumber: row.table_number,
    customerName: row.customer_name,
    category: row.category ?? "Service",
    description: row.description,
    status: row.status,
    severity: row.severity,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  }));
  const complaintsByOrder = groupByOrderId((complaintsResult.data ?? []) as ComplaintRow[]);
  const assignmentsByTable = new Map<string, AssignmentRow>();
  for (const assignment of (assignmentsResult.data ?? []) as AssignmentRow[]) {
    if (assignment.table_id) assignmentsByTable.set(assignment.table_id, assignment);
  }

  const sessions = orders.map((order) => {
    const assignment = order.table_id ? assignmentsByTable.get(order.table_id) : undefined;
    const waiter = assignment ? firstStaff(assignment) : null;
    const orderItems = itemsByOrder.get(order.id) ?? [];
    const orderInvoices = invoicesByOrder.get(order.id) ?? [];
    const orderComplaints = complaintsByOrder.get(order.id) ?? [];
    const openedAt = order.dining_session_opened_at ?? order.created_at;
    const specialRequests = itemSpecialRequests(orderItems);
    return {
      orderId: order.id,
      displayNumber: order.display_number ?? order.id.slice(0, 8),
      tableId: order.table_id,
      tableNumber: order.table_number,
      customerName: order.customer_name,
      customerPhone: order.customer_phone ?? null,
      status: order.status,
      orderSource: order.order_source,
      openedAt,
      waitingMinutes: minutesSince(openedAt, now),
      totalPrice: Number(order.total_price ?? 0),
      assignedWaiter: waiter?.display_name ?? null,
      assignedWaiterId: waiter?.id ?? assignment?.waiter_staff_id ?? null,
      billRequestedAt: order.bill_requested_at ?? null,
      billWaitingMinutes: order.bill_requested_at && !order.payment_verified_at ? minutesSince(order.bill_requested_at, now) : null,
      specialRequests,
      vip: isVip(order),
      complaintCount: orderComplaints.length,
      unresolvedComplaintCount: orderComplaints.filter((complaint) => complaint.status !== "resolved").length,
      timeline: timelineFor(order, orderItems, orderInvoices),
    } satisfies ManagerCustomerSession;
  });

  const alerts: CustomerExperienceAlert[] = [];
  for (const session of sessions) {
    if (session.waitingMinutes >= LONG_WAIT_MINUTES && session.status !== "completed") alerts.push({ id: `${session.orderId}:long-wait`, type: "long_wait", severity: session.waitingMinutes >= 30 ? "critical" : "warning", orderId: session.orderId, tableNumber: session.tableNumber, message: `Table ${session.tableNumber ?? "-"} has waited ${session.waitingMinutes}m.` });
    if ((session.billWaitingMinutes ?? 0) >= BILL_WAIT_MINUTES) alerts.push({ id: `${session.orderId}:bill-wait`, type: "bill_wait", severity: (session.billWaitingMinutes ?? 0) >= 20 ? "critical" : "warning", orderId: session.orderId, tableNumber: session.tableNumber, message: `Bill has waited ${session.billWaitingMinutes}m for table ${session.tableNumber ?? "-"}.` });
    if (session.vip && session.waitingMinutes >= 5) alerts.push({ id: `${session.orderId}:vip`, type: "vip_wait", severity: "critical", orderId: session.orderId, tableNumber: session.tableNumber, message: `VIP guest waiting at table ${session.tableNumber ?? "-"}.` });
    if (session.unresolvedComplaintCount > 0) alerts.push({ id: `${session.orderId}:complaint`, type: "complaint", severity: "critical", orderId: session.orderId, tableNumber: session.tableNumber, message: `${session.unresolvedComplaintCount} unresolved complaint${session.unresolvedComplaintCount === 1 ? "" : "s"}.` });
    if (session.specialRequests.length > 0 && !session.timeline.some((event) => event.label === "Served")) alerts.push({ id: `${session.orderId}:special`, type: "special_request", severity: "warning", orderId: session.orderId, tableNumber: session.tableNumber, message: `Special request pending for table ${session.tableNumber ?? "-"}.` });
  }

  const timeline = sessions.flatMap((session) => session.timeline).sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime()).slice(0, 80);

  return {
    sessions,
    complaints,
    waiters: ((waitersResult.data ?? []) as Array<{ id: string; display_name: string | null }>).map((waiter) => ({ id: waiter.id, displayName: waiter.display_name || "Waiter" })),
    waitingCustomers: sessions.filter((session) => session.waitingMinutes >= LONG_WAIT_MINUTES).length,
    tablesRequestingBill: sessions.filter((session) => session.billRequestedAt && session.billWaitingMinutes !== null).length,
    specialRequests: sessions.reduce((sum, session) => sum + session.specialRequests.length, 0),
    vipGuests: sessions.filter((session) => session.vip).length,
    customerComplaints: complaints.filter((complaint) => complaint.status !== "resolved").length,
    reservationQueue: 0,
    alerts,
    timeline,
  };
}

export async function assignManagerCustomerWaiter(restaurantId: string, orderId: string, waiterStaffId: string) {
  const { error } = await supabase.rpc("manager_assign_customer_waiter", { target_restaurant_id: restaurantId, target_order_id: orderId, waiter_staff_id: waiterStaffId });
  if (error) throw new Error(error.message);
}

export async function notifyManagerCustomerKitchen(restaurantId: string, orderId: string, message: string) {
  const { error } = await supabase.rpc("manager_notify_customer_kitchen", { target_restaurant_id: restaurantId, target_order_id: orderId, message });
  if (error) throw new Error(error.message);
}

export async function notifyManagerCustomerCashier(restaurantId: string, orderId: string, message: string) {
  const { error } = await supabase.rpc("manager_notify_customer_cashier", { target_restaurant_id: restaurantId, target_order_id: orderId, message });
  if (error) throw new Error(error.message);
}

export async function escalateManagerComplaint(restaurantId: string, complaintId: string) {
  const { error } = await supabase.rpc("manager_escalate_customer_complaint", { target_restaurant_id: restaurantId, complaint_id: complaintId });
  if (error) throw new Error(error.message);
}

export async function resolveManagerComplaint(restaurantId: string, complaintId: string) {
  const { error } = await supabase.rpc("manager_resolve_customer_complaint", { target_restaurant_id: restaurantId, complaint_id: complaintId });
  if (error) throw new Error(error.message);
}

import { waiterSupabase } from "../../waiter-auth/services/waiterAuthService";
import type { WaiterDashboardTable, WaiterSessionDetail, WaiterSessionInvoice, WaiterTableMetric, WaiterTableStatus } from "../types";

type WaiterDashboardRow = {
  restaurant_id: string;
  restaurant_slug: string;
  restaurant_name: string;
  restaurant_logo_url: string | null;
  waiter_staff_id: string;
  waiter_display_name: string;
  current_shift: string | null;
  assignment_mode: "assigned_tables" | "all_tables";
  table_id: string;
  table_number: number;
  table_label: string | null;
  seats: number | string | null;
  table_active: boolean;
  assigned_waiter_staff_id: string | null;
  assigned_waiter_name: string | null;
  table_status: WaiterTableStatus;
  active_order_id: string | null;
  active_order_status: string | null;
  active_order_source: string | null;
  qr_customer_name: string | null;
  active_order_created_at: string | null;
};

function normalizeTable(row: WaiterDashboardRow): WaiterDashboardTable {
  return {
    restaurantId: row.restaurant_id,
    restaurantSlug: row.restaurant_slug,
    restaurantName: row.restaurant_name,
    restaurantLogoUrl: row.restaurant_logo_url,
    waiterStaffId: row.waiter_staff_id,
    waiterDisplayName: row.waiter_display_name,
    currentShift: row.current_shift || "Current Shift",
    assignmentMode: row.assignment_mode,
    tableId: row.table_id,
    tableNumber: Number(row.table_number),
    tableLabel: row.table_label,
    seats: Number(row.seats ?? 4),
    tableActive: row.table_active,
    assignedWaiterStaffId: row.assigned_waiter_staff_id,
    assignedWaiterName: row.assigned_waiter_name,
    tableStatus: row.table_status,
    activeOrderId: row.active_order_id,
    activeOrderStatus: row.active_order_status,
    activeOrderSource: row.active_order_source,
    qrCustomerName: row.qr_customer_name,
    activeOrderCreatedAt: row.active_order_created_at,
  };
}

export async function loadWaiterSessionDetail(orderId: string): Promise<WaiterSessionDetail> {
  const [{ data: order, error: orderError }, { data: invoices, error: invoiceError }, { data: items, error: itemError }] = await Promise.all([
    waiterSupabase.from("orders").select("id,display_number,dining_session_display_number,created_at,customer_name,order_source,total_price,created_by_waiter_id,restaurant_staff!orders_created_by_waiter_same_restaurant(display_name)").eq("id", orderId).single(),
    waiterSupabase.from("order_invoices").select("id,display_number,invoice_number,status,total_price,created_at,created_by_display_name,created_by_staff_id,restaurant_staff!order_invoices_created_by_staff_same_restaurant(display_name)").eq("order_id", orderId).order("created_at", { ascending: true }),
    waiterSupabase.from("order_items").select("id,invoice_id,quantity,price,kitchen_status,menu_items!order_items_menu_item_same_restaurant(name)").eq("order_id", orderId).order("created_at", { ascending: true }),
  ]);
  if (orderError) throw new Error(orderError.message);
  if (invoiceError) throw new Error(invoiceError.message);
  if (itemError) throw new Error(itemError.message);
  const itemRows = (items ?? []) as Array<Record<string, unknown>>;
  const normalizedInvoices: WaiterSessionInvoice[] = ((invoices ?? []) as Array<Record<string, unknown>>).map((invoice) => {
    const invoiceItems = itemRows.filter((item) => item.invoice_id === invoice.id).map((item) => {
      const menu = Array.isArray(item.menu_items) ? item.menu_items[0] : item.menu_items;
      return { id: String(item.id), name: String((menu as { name?: unknown } | null)?.name ?? "Menu item"), quantity: Number(item.quantity), price: Number(item.price), kitchenStatus: String(item.kitchen_status ?? "held") };
    });
    const statuses = invoiceItems.map((item) => item.kitchenStatus);
    const kitchenStatus = statuses.length > 0 && statuses.every((status) => status === "completed") ? "served" : statuses.includes("preparing") ? "preparing" : statuses.length > 0 && statuses.every((status) => status === "ready" || status === "completed") ? "ready" : statuses.includes("paid") ? "paid" : "pending_payment";
    const creator = Array.isArray(invoice.restaurant_staff) ? invoice.restaurant_staff[0] : invoice.restaurant_staff;
    return { id: String(invoice.id), displayNumber: String(invoice.display_number ?? `Invoice #${invoice.invoice_number ?? 1}`), status: String(invoice.status), kitchenStatus, total: Number(invoice.total_price), createdAt: String(invoice.created_at), creatorName: String((creator as { display_name?: unknown } | null)?.display_name ?? invoice.created_by_display_name ?? "") || null, items: invoiceItems };
  });
  const creator = Array.isArray(order.restaurant_staff) ? order.restaurant_staff[0] : order.restaurant_staff;
  return { orderId: String(order.id), sessionNumber: String(order.dining_session_display_number ?? order.display_number ?? order.id), openedAt: String(order.created_at), customerName: order.customer_name ?? null, source: String(order.order_source ?? "unknown"), creatorName: String((creator as { display_name?: unknown } | null)?.display_name ?? "") || null, total: Number(order.total_price), invoices: normalizedInvoices };
}

export async function loadWaiterTableMetrics(orderIds: string[]): Promise<Map<string, WaiterTableMetric>> {
  if (orderIds.length === 0) return new Map();
  const [{ data: orders, error: orderError }, { data: invoices, error: invoiceError }] = await Promise.all([
    waiterSupabase.from("orders").select("id,total_price,display_number,dining_session_display_number").in("id", orderIds),
    waiterSupabase.from("order_invoices").select("id,order_id,display_number,invoice_number").in("order_id", orderIds),
  ]);
  if (orderError) throw new Error(orderError.message);
  if (invoiceError) throw new Error(invoiceError.message);
  const invoiceRows = (invoices ?? []) as Array<{ order_id: string; display_number: string | null; invoice_number: number }>;
  return new Map((orders ?? []).map((order) => {
    const related = invoiceRows.filter((invoice) => invoice.order_id === order.id);
    return [String(order.id), { total: Number(order.total_price), invoiceCount: related.length, sessionNumber: String(order.dining_session_display_number ?? order.display_number ?? order.id), invoiceNumbers: related.map((invoice) => invoice.display_number ?? `Invoice ${invoice.invoice_number}`) }];
  }));
}

export async function loadWaiterDashboardTables(
  restaurantSlug: string
): Promise<WaiterDashboardTable[]> {
  const { data, error } = await waiterSupabase.rpc("get_waiter_dashboard_tables", {
    target_restaurant_slug: restaurantSlug,
  });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as WaiterDashboardRow[]).map(normalizeTable);
}

import { getActiveWaiterSession, waiterSupabase } from "../../waiter-auth/services/waiterAuthService";
import type {
  PublicQrCartItem,
  PublicQrOrderInvoice,
  PublicQrOrderSession,
  PublicQrSessionItem,
  SubmittedPublicQrOrder,
} from "../../public-qr-ordering/types";

export type WaiterOrderSession = PublicQrOrderSession & {
  restaurantId: string;
  restaurantSlug: string;
  restaurantName: string;
  tableId: string;
  seats: number;
  waiterStaffId: string;
  waiterDisplayName: string;
  orderSource?: string | null;
  customerPhone?: string | null;
  orderNote?: string | null;
};
const waiterQueueKey=(restaurantSlug:string)=>`serveflow.waiter.order-queue.v2:${restaurantSlug.trim().toLowerCase()}`;
type QueuedWaiterOrder={clientRequestId:string;restaurantSlug:string;tableNumber:string;customerName?:string;customerPhone?:string;orderNote?:string;items:PublicQrCartItem[]};
export function queueWaiterOrder(order:QueuedWaiterOrder){const key=waiterQueueKey(order.restaurantSlug);const current=JSON.parse(localStorage.getItem(key)??"[]") as QueuedWaiterOrder[];if(!current.some(item=>item.clientRequestId===order.clientRequestId))localStorage.setItem(key,JSON.stringify([...current,order]));}
export async function syncWaiterOrderQueue(restaurantSlug:string){const key=waiterQueueKey(restaurantSlug);const current=(JSON.parse(localStorage.getItem(key)??"[]") as QueuedWaiterOrder[]).filter(order=>order.restaurantSlug.trim().toLowerCase()===restaurantSlug.trim().toLowerCase());const remaining=[...current];for(const order of current){try{await submitWaiterOrder(order);remaining.splice(remaining.findIndex(item=>item.clientRequestId===order.clientRequestId),1);localStorage.setItem(key,JSON.stringify(remaining));}catch{break}}return remaining.length;}
const waiterSessionRequests = new Map<string, Promise<WaiterOrderSession>>();

function waiterSessionRequestKey(restaurantSlug: string, tableNumber: string) {
  const waiterId = getActiveWaiterSession()?.staffId ?? "anonymous";
  return [
    restaurantSlug.trim().toLowerCase(),
    String(tableNumber).trim(),
    waiterId,
  ].join(":");
}

function normalizeSessionItem(value: unknown): PublicQrSessionItem | null {
  if (!value || typeof value !== "object") return null;

  const payload = value as Record<string, unknown>;
  const itemId = payload.id;
  const menuItemId = payload.menu_item_id;
  const name = payload.name;

  if (typeof itemId !== "string" || typeof menuItemId !== "string" || typeof name !== "string") {
    return null;
  }

  return {
    id: itemId,
    invoice_id: typeof payload.invoice_id === "string" ? payload.invoice_id : null,
    invoice_status: typeof payload.invoice_status === "string" ? payload.invoice_status : null,
    menu_item_id: menuItemId,
    name,
    quantity: Number(payload.quantity ?? 0),
    unit_price: Number(payload.unit_price ?? 0),
    line_total: Number(payload.line_total ?? 0),
    kitchen_status: typeof payload.kitchen_status === "string" ? payload.kitchen_status : null,
    appended_at: typeof payload.appended_at === "string" ? payload.appended_at : null,
    created_at: typeof payload.created_at === "string" ? payload.created_at : null,
  };
}

function normalizeInvoice(value: unknown): PublicQrOrderInvoice | null {
  if (!value || typeof value !== "object") return null;

  const payload = value as Record<string, unknown>;
  if (typeof payload.id !== "string" || typeof payload.status !== "string") {
    return null;
  }

  return {
    id: payload.id,
    display_number: typeof payload.display_number === "string" ? payload.display_number : null,
    kitchen_ticket_number: typeof payload.kitchen_ticket_number === "string" ? payload.kitchen_ticket_number : null,
    invoice_number: Number(payload.invoice_number ?? 1),
    status: payload.status,
    total_price: Number(payload.total_price ?? 0),
    payment_method: payload.payment_method === "Credit/Debit Card" ? "Card" : typeof payload.payment_method === "string" ? payload.payment_method as PublicQrOrderInvoice["payment_method"] : null,
    paid_at: typeof payload.paid_at === "string" ? payload.paid_at : null,
    locked_at: typeof payload.locked_at === "string" ? payload.locked_at : null,
    created_at: typeof payload.created_at === "string" ? payload.created_at : null,
  };
}

function normalizeWaiterSession(value: unknown): WaiterOrderSession {
  if (!value || typeof value !== "object") {
    throw new Error("Waiter order session could not be loaded.");
  }

  const payload = value as Record<string, unknown>;

  if (
    typeof payload.restaurant_id !== "string" ||
    typeof payload.restaurant_slug !== "string" ||
    typeof payload.restaurant_name !== "string" ||
    typeof payload.table_id !== "string" ||
    typeof payload.waiter_staff_id !== "string" ||
    typeof payload.waiter_display_name !== "string"
  ) {
    throw new Error("Waiter order session could not be loaded.");
  }

  const orderId = typeof payload.order_id === "string" ? payload.order_id : "";
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const rawInvoices = Array.isArray(payload.invoices) ? payload.invoices : [];

  return {
    restaurantId: payload.restaurant_id,
    restaurantSlug: payload.restaurant_slug,
    restaurantName: payload.restaurant_name,
    tableId: payload.table_id,
    seats: Number(payload.seats ?? 0),
    waiterStaffId: payload.waiter_staff_id,
    waiterDisplayName: payload.waiter_display_name,
    orderSource: typeof payload.order_source === "string" ? payload.order_source : null,
    customerPhone: typeof payload.customer_phone === "string" ? payload.customer_phone : null,
    orderNote: typeof payload.order_note === "string" ? payload.order_note : null,
    order_id: orderId,
    display_number: typeof payload.display_number === "string" ? payload.display_number : null,
    dining_session_display_number: typeof payload.dining_session_display_number === "string" ? payload.dining_session_display_number : null,
    status: typeof payload.status === "string" ? payload.status : "pending_payment",
    total_price: Number(payload.total_price ?? 0),
    table_number: String(payload.table_number ?? ""),
    customer_name: typeof payload.customer_name === "string" ? payload.customer_name : null,
    payment_method: payload.payment_method === "Credit/Debit Card" ? "Card" : typeof payload.payment_method === "string" ? payload.payment_method as PublicQrOrderSession["payment_method"] : null,
    created_at: typeof payload.created_at === "string" ? payload.created_at : new Date().toISOString(),
    payment_verified_at: typeof payload.payment_verified_at === "string" ? payload.payment_verified_at : null,
    items: rawItems.flatMap((item) => normalizeSessionItem(item) ?? []),
    invoices: rawInvoices.flatMap((invoice) => normalizeInvoice(invoice) ?? []),
  };
}

function normalizeSubmittedOrder(value: unknown): SubmittedPublicQrOrder {
  if (!value || typeof value !== "object") {
    throw new Error("Order could not be submitted.");
  }

  const payload = value as Record<string, unknown>;
  const orderId = payload.order_id ?? payload.id;

  if (typeof orderId !== "string" || typeof payload.status !== "string") {
    throw new Error("Order could not be submitted.");
  }

  return {
    order_id: orderId,
    display_number: typeof payload.display_number === "string" ? payload.display_number : null,
    dining_session_display_number: typeof payload.dining_session_display_number === "string" ? payload.dining_session_display_number : null,
    invoice_id: typeof payload.invoice_id === "string" ? payload.invoice_id : null,
    invoice_display_number: typeof payload.invoice_display_number === "string" ? payload.invoice_display_number : null,
    kitchen_ticket_number: typeof payload.kitchen_ticket_number === "string" ? payload.kitchen_ticket_number : null,
    invoice_number: typeof payload.invoice_number === "undefined" || payload.invoice_number === null ? null : Number(payload.invoice_number),
    invoice_status: typeof payload.invoice_status === "string" ? payload.invoice_status : null,
    invoice_total: Number(payload.invoice_total ?? payload.added_total ?? payload.total_price ?? 0),
    status: payload.status,
    total_price: Number(payload.total_price ?? 0),
    table_number: typeof payload.table_number === "string" ? payload.table_number : null,
    customer_name: typeof payload.customer_name === "string" ? payload.customer_name : null,
    payment_method: payload.payment_method === "Credit/Debit Card" ? "Card" : typeof payload.payment_method === "string" ? payload.payment_method as SubmittedPublicQrOrder["payment_method"] : null,
    created_at: typeof payload.created_at === "string" ? payload.created_at : new Date().toISOString(),
    session_action: payload.session_action === "appended" ? "appended" : "created",
    appended_at: typeof payload.appended_at === "string" ? payload.appended_at : null,
    added_total: Number(payload.added_total ?? payload.invoice_total ?? payload.total_price ?? 0),
    items_added: Array.isArray(payload.items_added)
      ? payload.items_added.flatMap((item) => normalizeSessionItem({
          id: `${String((item as Record<string, unknown>).menu_item_id ?? crypto.randomUUID())}`,
          ...item,
        }) ?? [])
      : [],
  };
}

export async function fetchWaiterOrderSession(restaurantSlug: string, tableNumber: string) {
  const requestKey = waiterSessionRequestKey(restaurantSlug, tableNumber);
  const existingRequest = waiterSessionRequests.get(requestKey);
  if (existingRequest) return existingRequest;

  const request = (async () => {
    try {
      const { data, error } = await waiterSupabase.rpc("get_waiter_order_session", {
        target_restaurant_slug: restaurantSlug,
        table_number: tableNumber,
      });
      if (error) throw new Error(error.message);
      return normalizeWaiterSession(data);
    } finally {
      waiterSessionRequests.delete(requestKey);
    }
  })();

  waiterSessionRequests.set(requestKey, request);
  return request;
}

export async function submitWaiterOrder({
  restaurantSlug,
  tableNumber,
  customerName,
  customerPhone,
  orderNote,
  items,
  clientRequestId = crypto.randomUUID(),
}: {
  restaurantSlug: string;
  tableNumber: string;
  customerName?: string;
  customerPhone?: string;
  orderNote?: string;
  items: PublicQrCartItem[];
  clientRequestId?: string;
}) {
  const requestedItems = items.map((item) => ({
    menu_item_id: item.menuItemId,
    quantity: item.quantity,
    notes: item.notes ?? "",
  }));

  const { data, error } = await waiterSupabase.rpc("submit_waiter_order_batch", {
    target_restaurant_slug: restaurantSlug,
    table_number: tableNumber,
    customer_name: customerName ?? "",
    customer_phone: customerPhone ?? "",
    order_note: orderNote ?? "",
    requested_items: requestedItems,
    client_request_id: clientRequestId,
  });

  if (error) throw new Error(error.message);
  return normalizeSubmittedOrder(data);
}

import { supabase } from "../../../core/database";
import { logPublicQrContext } from "./publicQrContext";
import type {
  PublicQrCartItem,
  PublicQrOrderInvoice,
  PublicQrOrderSession,
  PublicQrPaymentMethod,
  PublicQrSessionItem,
  SubmittedPublicQrOrder,
} from "../types";

type SubmitPublicQrOrderInput = {
  restaurantSlug: string;
  tableNumber?: string;
  qrToken?: string;
  browserSessionToken?: string;
  customerName?: string;
  paymentMethod: PublicQrPaymentMethod;
  items: PublicQrCartItem[];
};

type SubmitPublicOrderFeedbackInput = {
  restaurantSlug: string;
  tableNumber: string;
  qrToken: string;
  orderId: string;
  rating: number;
  reactions: string[];
  comment?: string;
  photoUrl?: string | null;
  customerSessionKey?: string;
};

function isSubmittedPublicQrOrder(value: unknown): value is SubmittedPublicQrOrder {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;

  // The RPC returns 'id' — map it to order_id for the client type
  const orderId = payload.order_id ?? payload.id;

  return Boolean(
    typeof orderId === "string" &&
      typeof payload.status === "string" &&
      typeof payload.total_price !== "undefined" &&
      typeof payload.created_at === "string"
  );
}

function toRpcPaymentMethod(method: PublicQrPaymentMethod) {
  return method === "Card" ? "Credit/Debit Card" : method;
}

function fromRpcPaymentMethod(method: unknown): PublicQrPaymentMethod | null | undefined {
  if (method === "Credit/Debit Card") return "Card";
  return method as PublicQrPaymentMethod | null | undefined;
}

function normalizeSessionItem(value: unknown): PublicQrSessionItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

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

function normalizeSessionInvoice(value: unknown): PublicQrOrderInvoice | null {
  if (!value || typeof value !== "object") {
    return null;
  }

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
    payment_method: fromRpcPaymentMethod(payload.payment_method),
    paid_at: typeof payload.paid_at === "string" ? payload.paid_at : null,
    locked_at: typeof payload.locked_at === "string" ? payload.locked_at : null,
    created_at: typeof payload.created_at === "string" ? payload.created_at : null,
  };
}

function normalizeSession(value: unknown): PublicQrOrderSession | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const orderId = payload.order_id ?? payload.id;

  if (
    typeof orderId !== "string" ||
    typeof payload.status !== "string" ||
    typeof payload.total_price === "undefined" ||
    typeof payload.created_at !== "string"
  ) {
    return null;
  }

  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const rawInvoices = Array.isArray(payload.invoices) ? payload.invoices : [];

  return {
    order_id: orderId,
    display_number: typeof payload.display_number === "string" ? payload.display_number : null,
    dining_session_display_number: typeof payload.dining_session_display_number === "string" ? payload.dining_session_display_number : null,
    status: payload.status,
    total_price: Number(payload.total_price),
    table_number: typeof payload.table_number === "string" ? payload.table_number : null,
    customer_name: typeof payload.customer_name === "string" ? payload.customer_name : null,
    payment_method: fromRpcPaymentMethod(payload.payment_method),
    created_at: payload.created_at,
    payment_verified_at: typeof payload.payment_verified_at === "string" ? payload.payment_verified_at : null,
    items: rawItems.flatMap((item) => normalizeSessionItem(item) ?? []),
    invoices: rawInvoices.flatMap((invoice) => normalizeSessionInvoice(invoice) ?? []),
  };
}

export async function fetchPublicQrOrderSession({
  restaurantSlug,
  tableNumber,
  qrToken,
  browserSessionToken,
}: {
  restaurantSlug: string;
  tableNumber?: string;
  qrToken?: string;
  browserSessionToken?: string;
}): Promise<PublicQrOrderSession | null> {
  if (!tableNumber?.trim() || !qrToken?.trim()) {
    return null;
  }

  logPublicQrContext("publicQrOrderService:sessionLookup", {
    restaurantSlug,
    tableNumber,
    qrToken,
  });

  const { data, error } = await supabase.rpc("get_public_qr_order_session", {
    target_restaurant_slug: restaurantSlug,
    table_number: tableNumber,
    qr_token: qrToken,
    browser_session_token: browserSessionToken ?? "",
  });

  if (error) {
    logPublicQrContext("publicQrOrderService:sessionLookup:error", {
      restaurantSlug,
      tableNumber,
      qrToken,
      message: error.message,
    });
    throw new Error(error.message);
  }

  const session = normalizeSession(data);
  logPublicQrContext("publicQrOrderService:sessionLookup:result", {
    restaurantSlug,
    tableNumber,
    qrToken,
    activeOrderId: session?.order_id ?? null,
  });
  return session;
}

export async function submitPublicQrOrder({
  restaurantSlug,
  tableNumber,
  qrToken,
  browserSessionToken,
  customerName,
  paymentMethod,
  items,
}: SubmitPublicQrOrderInput): Promise<SubmittedPublicQrOrder> {
  const requestedItems = items.map((item) => ({
    menu_item_id: item.menuItemId,
    quantity: item.quantity,
  }));

  logPublicQrContext("publicQrOrderService:submit", {
    restaurantSlug,
    tableNumber,
    qrToken,
    paymentMethod,
    itemCount: requestedItems.length,
  });

  const { data, error } = await supabase.rpc("create_public_qr_order", {
    target_restaurant_slug: restaurantSlug,
    table_number: tableNumber ?? "",
    qr_token: qrToken ?? "",
    browser_session_token: browserSessionToken ?? "",
    customer_name: customerName ?? "",
    selected_payment_method: toRpcPaymentMethod(paymentMethod),
    requested_items: requestedItems,
  });

  if (error) {
    logPublicQrContext("publicQrOrderService:submit:error", {
      restaurantSlug,
      tableNumber,
      qrToken,
      message: error.message,
    });
    throw new Error(error.message);
  }

  if (!isSubmittedPublicQrOrder(data)) {
    throw new Error("Order could not be confirmed.");
  }

  // Normalize: RPC returns 'id', client expects 'order_id'
  const normalized = data as Record<string, unknown>;
  const submittedOrder: SubmittedPublicQrOrder = {
    order_id: (normalized.order_id ?? normalized.id) as string,
    display_number: typeof normalized.display_number === "string" ? normalized.display_number : null,
    dining_session_display_number: typeof normalized.dining_session_display_number === "string" ? normalized.dining_session_display_number : null,
    invoice_id: normalized.invoice_id as string | null | undefined,
    invoice_display_number: typeof normalized.invoice_display_number === "string" ? normalized.invoice_display_number : null,
    kitchen_ticket_number: typeof normalized.kitchen_ticket_number === "string" ? normalized.kitchen_ticket_number : null,
    invoice_number: typeof normalized.invoice_number === "undefined" || normalized.invoice_number === null
      ? null
      : Number(normalized.invoice_number),
    invoice_status: normalized.invoice_status as string | null | undefined,
    invoice_total: Number(normalized.invoice_total ?? normalized.added_total ?? normalized.total_price ?? 0),
    status: normalized.status as string,
    total_price: Number(normalized.total_price),
    table_number: normalized.table_number as string | null | undefined,
    customer_name: normalized.customer_name as string | null | undefined,
    payment_method: fromRpcPaymentMethod(normalized.payment_method),
    created_at: normalized.created_at as string,
    session_action: normalized.session_action === "appended" ? "appended" : "created",
    appended_at: typeof normalized.appended_at === "string" ? normalized.appended_at : null,
    added_total: Number(normalized.added_total ?? normalized.total_price ?? 0),
    items_added: Array.isArray(normalized.items_added)
      ? normalized.items_added.flatMap((item) => normalizeSessionItem({ id: `${String((item as Record<string, unknown>).menu_item_id ?? "")}:${String((item as Record<string, unknown>).name ?? "")}`, ...item }) ?? [])
      : [],
  };

  logPublicQrContext("publicQrOrderService:submit:result", {
    restaurantSlug,
    tableNumber,
    qrToken,
    orderId: submittedOrder.order_id,
    status: submittedOrder.status,
    sessionAction: submittedOrder.session_action,
  });

  return submittedOrder;
}

export async function uploadPublicOrderFeedbackPhoto({
  restaurantId,
  orderId,
  file,
}: {
  restaurantId: string;
  orderId: string;
  file: File;
}) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Feedback photo must be an image.");
  }

  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${restaurantId}/${orderId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from("feedback-photos").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from("feedback-photos").getPublicUrl(path);
  return data.publicUrl;
}

export async function submitPublicOrderFeedback({
  restaurantSlug,
  tableNumber,
  qrToken,
  orderId,
  rating,
  reactions,
  comment,
  photoUrl,
  customerSessionKey,
}: SubmitPublicOrderFeedbackInput) {
  const { data, error } = await supabase.rpc("submit_public_order_feedback", {
    target_restaurant_slug: restaurantSlug,
    table_number: tableNumber,
    qr_token: qrToken,
    target_order_id: orderId,
    rating,
    reactions,
    comment: comment ?? null,
    photo_url: photoUrl ?? null,
    customer_session_key: customerSessionKey ?? null,
  });

  if (error) throw new Error(error.message);

  const payload = data && typeof data === "object" ? data as Record<string, unknown> : {};
  return {
    submitted: Boolean(payload.submitted),
    duplicate: Boolean(payload.duplicate),
  };
}

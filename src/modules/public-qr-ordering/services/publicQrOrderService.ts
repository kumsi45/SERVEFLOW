import { supabase } from "../../../core/database";
import { canonicalOrderLifecycle } from "../../../core/payment/lifecycle";
import { logPublicQrContext } from "./publicQrContext";
import type {
  PublicQrCartItem,
  PublicQrOrderInvoice,
  PublicQrOrderSession,
  PublicQrPaymentMethod,
  PublicQrSessionItem,
  SubmittedPublicQrOrder,
  SmartQrPortalState,
} from "../types";
import type { PublicPaymentRuntime } from "../../../core/printing-payment/runtime";

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

function normalizePublicPaymentRuntime(value: unknown): PublicPaymentRuntime {
  if (!value || typeof value !== "object") throw new Error("Payment configuration is unavailable.");
  const payload = value as Record<string, unknown>;
  return {
    businessName: String(payload.business_name ?? ""),
    paymentPolicy: payload.payment_policy === "kitchen_before_payment" || payload.payment_policy === "mixed" ? payload.payment_policy : "pay_before_kitchen",
    methods: (Array.isArray(payload.methods) ? payload.methods : []).flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const method = entry as Record<string, unknown>;
      const code = String(method.code ?? "");
      const displayName = code === "credit_card" ? "Card" : String(method.display_name ?? "");
      return [{ code, displayName, isDefault: Boolean(method.is_default), accounts: (Array.isArray(method.accounts) ? method.accounts : []).flatMap((accountEntry) => {
        if (!accountEntry || typeof accountEntry !== "object") return [];
        const account = accountEntry as Record<string, unknown>;
        const nullable = (key: string) => typeof account[key] === "string" ? account[key] as string : null;
        return [{ provider: String(account.provider ?? ""), businessName: nullable("business_name"), accountName: nullable("account_name"), accountNumber: nullable("account_number"), phoneNumber: nullable("phone_number"), referenceFormat: nullable("reference_format"), qrImageUrl: nullable("qr_image_url"), instructions: nullable("instructions") }];
      }) }];
    }),
  };
}

export async function fetchPublicPaymentRuntime(restaurantSlug: string): Promise<PublicPaymentRuntime> {
  const { data, error } = await supabase.rpc("get_public_payment_runtime", { target_restaurant_slug: restaurantSlug });
  if (error) throw new Error(error.message);
  return normalizePublicPaymentRuntime(data);
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
  if (session) {
    const { data: lifecycle, error: lifecycleError } = await supabase.rpc("get_public_qr_canonical_lifecycle", {
      target_restaurant_slug: restaurantSlug,
      table_number: tableNumber,
      qr_token: qrToken,
      target_order_id: session.order_id,
    });
    if (lifecycleError) throw new Error(lifecycleError.message);
    const canonical = lifecycle as { operational_status?: string; invoices?: Array<{ id: string; payment_status: string }> } | null;
    if (canonical?.operational_status) {
      session.status = canonicalOrderLifecycle({ operational_status: canonical.operational_status }).operational;
    }
    const paymentById = new Map((canonical?.invoices ?? []).map((invoice) => [invoice.id, invoice.payment_status]));
    session.invoices = session.invoices.map((invoice) => ({
      ...invoice,
      status: canonicalOrderLifecycle({ payment_status: paymentById.get(invoice.id) ?? invoice.status }).payment,
    }));
  }
  logPublicQrContext("publicQrOrderService:sessionLookup:result", {
    restaurantSlug,
    tableNumber,
    qrToken,
    activeOrderId: session?.order_id ?? null,
  });
  return session;
}

export async function fetchSmartQrPortalState(input: {
  restaurantSlug: string; tableNumber: string; qrToken: string; browserSessionToken: string;
}): Promise<SmartQrPortalState> {
  const { data, error } = await supabase.rpc("get_smart_qr_portal_state", {
    target_restaurant_slug: input.restaurantSlug,
    table_number: input.tableNumber,
    qr_token: input.qrToken,
    browser_session_token: input.browserSessionToken,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object") throw new Error("Table status is unavailable.");
  const payload = data as Record<string, unknown>;
  const mode = String(payload.mode ?? "available");
  if (!["available", "customer", "waiter", "occupied"].includes(mode)) throw new Error("Table status is unavailable.");
  logPublicQrContext("smartQrDecision:result", {
    restaurantId: payload.restaurant_id,
    tableId: payload.table_id,
    tableNumber: payload.table_number,
    diningSessionId: payload.dining_session_id ?? payload.order_id,
    createdBy: payload.created_by,
    sessionStatus: payload.session_status,
    paymentStatus: payload.payment_status,
    orderStatus: payload.order_status ?? payload.status,
    decisionResult: payload.decision_result ?? mode,
  });
  return {
    ...(payload as unknown as SmartQrPortalState),
    mode: mode as SmartQrPortalState["mode"],
    total_price: Number(payload.total_price ?? 0), subtotal: Number(payload.subtotal ?? 0),
    vat_amount: Number(payload.vat_amount ?? 0), service_charge_amount: Number(payload.service_charge_amount ?? 0),
    discount_amount: Number(payload.discount_amount ?? 0), grand_total: Number(payload.grand_total ?? payload.total_price ?? 0),
    items: (Array.isArray(payload.items) ? payload.items : []).flatMap((item) => normalizeSessionItem(item) ?? []),
    invoices: (Array.isArray(payload.invoices) ? payload.invoices : []).flatMap((invoice) => normalizeSessionInvoice(invoice) ?? []),
  };
}

export async function callWaiterFromSmartQr(input: {
  restaurantSlug: string; tableNumber: string; qrToken: string; browserSessionToken: string; orderId: string;
}) {
  const { data, error } = await supabase.rpc("call_waiter_from_smart_qr", {
    target_restaurant_slug: input.restaurantSlug, table_number: input.tableNumber,
    qr_token: input.qrToken, browser_session_token: input.browserSessionToken,
    target_order_id: input.orderId,
  });
  if (error) throw new Error(error.message);
  return data as { requested: boolean; request_id: string; requested_at: string };
}

export async function requestCustomerFinalBill(input: {
  restaurantSlug: string; tableNumber: string; qrToken: string;
  browserSessionToken: string; orderId: string;
}) {
  const { data, error } = await supabase.rpc("request_customer_final_bill", {
    target_restaurant_slug: input.restaurantSlug,
    table_number: input.tableNumber,
    qr_token: input.qrToken,
    browser_session_token: input.browserSessionToken,
    target_order_id: input.orderId,
  });
  if (error) throw new Error(error.message);
  return data as { requested: true; order_id: string; restaurant_id: string; table_id: string; requested_at: string };
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
  const { error: methodError } = await supabase.rpc("assert_public_payment_method_enabled", {
    target_restaurant_slug: restaurantSlug,
    selected_payment_method: toRpcPaymentMethod(paymentMethod),
  });
  if (methodError) throw new Error(methodError.message);

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

export async function submitPublicPaymentProof(input: {
  restaurantSlug: string; tableNumber: string; qrToken: string; browserSessionToken: string;
  invoiceId: string; referenceNumber?: string; screenshot?: File | null;
}) {
  const form = new FormData();
  form.set("restaurantSlug", input.restaurantSlug);
  form.set("tableNumber", input.tableNumber);
  form.set("qrToken", input.qrToken);
  form.set("browserSessionToken", input.browserSessionToken);
  form.set("invoiceId", input.invoiceId);
  if (input.referenceNumber) form.set("referenceNumber", input.referenceNumber);
  if (input.screenshot) form.set("screenshot", input.screenshot);
  const { data, error } = await supabase.functions.invoke("submit-public-payment-proof", { body: form });
  if (error) throw new Error(error.message);
  return data as { submitted: boolean; alreadySubmitted?: boolean; submittedAt?: string | null; verificationStatus?: "submitted" | "paid" };
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

  return path;
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

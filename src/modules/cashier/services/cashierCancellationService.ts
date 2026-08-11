import { supabase } from "../../../core/database";

export type CashierCancellationAuthority =
  | "cashier_direct"
  | "manager_approval_required"
  | "financial_approval_required"
  | "not_actionable";

export type CashierCancellationItem = {
  id: string;
  name: string;
  quantity: number;
  price: number;
  kitchenStatus: string;
};

export type CashierCancellationRequest = {
  id: string;
  restaurantId: string;
  orderId: string;
  orderItemId: string | null;
  scope: "order" | "item";
  reason: string;
  note: string | null;
  status: "pending_review";
  requestedAt: string;
  requesterRole: "waiter";
  requestedByStaffId: string;
  requestedByName: string;
  tableNumber: string | null;
  orderNumber: string;
  authority: CashierCancellationAuthority;
  riskReason: string | null;
  orderStatus: string;
  kitchenStatus: string;
  paymentStatus: string;
  affectedAmount: number;
  itemCount: number;
  items: CashierCancellationItem[];
  hasFinancialDocument: boolean;
};

export type CashierCancellationResult = {
  request_id: string;
  status: "resolved" | "manager_review_required";
  cashier_decision?: "cancelled_directly";
  handled_by_staff_id: string;
  handled_at: string;
  cancelled_item_count?: number;
  refund_created?: boolean;
  table_released?: boolean;
};

function normalizeRequest(value: unknown): CashierCancellationRequest | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.restaurant_id !== "string" ||
    typeof row.order_id !== "string" ||
    typeof row.requested_at !== "string" ||
    typeof row.requested_by_staff_id !== "string"
  ) return null;
  const authority = String(row.authority) as CashierCancellationAuthority;
  if (!["cashier_direct", "manager_approval_required", "financial_approval_required", "not_actionable"].includes(authority))
    return null;
  const items = Array.isArray(row.items)
    ? row.items.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const candidate = item as Record<string, unknown>;
        if (typeof candidate.id !== "string") return [];
        return [{
          id: candidate.id,
          name: String(candidate.name ?? "Menu item"),
          quantity: Number(candidate.quantity ?? 0),
          price: Number(candidate.price ?? 0),
          kitchenStatus: String(candidate.kitchen_status ?? "not_started"),
        }];
      })
    : [];
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    orderId: row.order_id,
    orderItemId: typeof row.order_item_id === "string" ? row.order_item_id : null,
    scope: row.request_scope === "order" ? "order" : "item",
    reason: String(row.reason ?? ""),
    note: typeof row.note === "string" ? row.note : null,
    status: "pending_review",
    requestedAt: row.requested_at,
    requesterRole: "waiter",
    requestedByStaffId: row.requested_by_staff_id,
    requestedByName: String(row.requested_by_name ?? "Waiter"),
    tableNumber: typeof row.table_number === "string" ? row.table_number : null,
    orderNumber: String(row.order_number ?? row.order_id),
    authority,
    riskReason: typeof row.risk_reason === "string" ? row.risk_reason : null,
    orderStatus: String(row.order_status ?? "unknown"),
    kitchenStatus: String(row.kitchen_status ?? "not_started"),
    paymentStatus: String(row.payment_status ?? "pending"),
    affectedAmount: Number(row.affected_amount ?? 0),
    itemCount: Number(row.item_count ?? items.length),
    items,
    hasFinancialDocument: row.has_financial_document === true,
  };
}

export async function loadCashierCancellationRequests(
  restaurantId: string,
): Promise<CashierCancellationRequest[]> {
  const { data, error } = await supabase.rpc("get_cashier_cancellation_requests", {
    target_restaurant_id: restaurantId,
  });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []).flatMap((row) => {
    const request = normalizeRequest(row);
    return request ? [request] : [];
  });
}

export async function handleCashierCancellationRequest(
  requestId: string,
  action: "direct_cancel" | "send_to_manager",
): Promise<CashierCancellationResult> {
  const { data, error } = await supabase.rpc("cashier_handle_cancellation_request", {
    target_request_id: requestId,
    requested_action: action,
  });
  if (error) throw new Error(error.message);
  return data as CashierCancellationResult;
}

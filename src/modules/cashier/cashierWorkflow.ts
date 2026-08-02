import type { RealtimeConnectionState } from "../../core/realtime/realtimeNotifications";
import { getRestaurantEventStream, type RestaurantEvent } from "../../core/realtime/restaurantEventService";
import { supabase } from "../../core/database";

export type CashierInvoiceLifecycle =
  | "pending_payment" | "payment_submitted" | "paid" | "receipt_printed"
  | "closed" | "cancelled" | "refunded";
export type CashierVerificationStatus =
  | "waiting" | "submitted" | "verified" | "rejected" | "expired" | "duplicate";
export type CashierReceiptStatus = "waiting" | "printed" | "reprinted" | "cancelled";

export type CashierWorkflowRow = {
  invoice_id: string;
  invoice_number: number;
  invoice_display_number?: string | null;
  invoice_lifecycle: CashierInvoiceLifecycle;
  verification_status: CashierVerificationStatus;
  payment_status: string;
  table_number?: string | null;
  order_number?: string | null;
  customer_name?: string | null;
  waiter_name?: string | null;
  source: string;
  payment_method?: string | null;
  amount: number;
  submitted_at?: string | null;
  reference_number?: string | null;
  screenshot_available: boolean;
  screenshot_url?: string | null;
  rejection_reason?: string | null;
  created_at: string;
  receipt_job_id?: string | null;
  receipt_status?: CashierReceiptStatus | null;
};

export type CashierAssistanceRequest = {
  request_id: string;
  request_type: "call_waiter" | "call_cashier";
  table_number: number | string;
  requested_at: string;
  priority: "normal" | "urgent";
  status: string;
  order_id: string;
};

export type CashierWorkflowFoundation = {
  restaurant_id: string;
  viewer_role: "cashier" | "owner";
  generated_at: string;
  payment_submitted_queue: CashierWorkflowRow[];
  waiter_payment_due_queue: CashierWorkflowRow[];
  cash_payment_queue: CashierWorkflowRow[];
  digital_payment_queue: CashierWorkflowRow[];
  verification_queue: CashierWorkflowRow[];
  receipt_queue: CashierWorkflowRow[];
  bill_requested_queue: CashierWorkflowRow[];
  payment_retry_queue: CashierWorkflowRow[];
  receipt_pending_queue: CashierWorkflowRow[];
  invoice_settlement_queue: CashierWorkflowRow[];
  daily_settlement: {
    cash_collected: number;
    digital_collected: number;
    pending_payments: number;
    verified_payments: number;
    rejected_payments: number;
    ready_for_daily_closing: boolean;
  };
  customer_assistance_queue: CashierAssistanceRequest[];
};

export async function loadCashierWorkflowFoundation(restaurantId: string) {
  const { data, error } = await supabase.rpc("get_cashier_workflow_foundation", {
    target_restaurant_id: restaurantId,
  });
  if (error) throw new Error(error.message);
  return data as CashierWorkflowFoundation;
}

export async function recordCashierReceiptAction(
  invoiceId: string,
  action: "print" | "reprint" | "cancel",
) {
  const { data, error } = await supabase.rpc("record_cashier_receipt_action", {
    target_invoice_id: invoiceId,
    requested_action: action,
  });
  if (error) throw new Error(error.message);
  return data as { receipt_job_id: string; invoice_id: string; status: CashierReceiptStatus };
}

export async function recordCashierBillAction(
  orderId: string,
  action: "prepare" | "print" | "ignore",
) {
  const { data, error } = await supabase.rpc("record_cashier_bill_action", {
    target_order_id: orderId,
    requested_action: action,
  });
  if (error) throw new Error(error.message);
  return data as { order_id: string; action: typeof action; recorded_at: string };
}

export async function closeCashierInvoiceAndReleaseTable(orderId: string) {
  const { data, error } = await supabase.rpc("cashier_close_invoice_and_release_table", {
    target_order_id: orderId,
    confirmed: true,
  });
  if (error) throw new Error(error.message);
  return data;
}

const CASHIER_WORKFLOW_TABLES = [
  "order_invoices", "receipt_generation_events", "cashier_shifts",
  "shift_activity_logs", "waiter_assistance_requests",
] as const;

export function subscribeCashierWorkflow(
  restaurantId: string,
  onChange: (event: RestaurantEvent) => void,
  onState?: (state: RealtimeConnectionState) => void,
) {
  return getRestaurantEventStream(restaurantId, supabase, CASHIER_WORKFLOW_TABLES)
    .subscribe(onChange, onState);
}

import { supabase } from "../../../core/database";

export type ManagerCashierShift = {
  id: string;
  cashierId: string;
  cashierName: string;
  employeeId: string | null;
  openedAt: string;
  openingCash: number;
  cashCollected: number;
  nonCashCollected: number;
  approvedExpenses: number;
  pendingExpenses: number;
  expectedCash: number;
};

export type ManagerCashierExpense = {
  id: string;
  shiftId: string;
  cashierId: string;
  cashierName: string;
  employeeId: string | null;
  amount: number;
  reason: string;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
};

export type ManagerCashHandover = {
  id: string;
  outgoingShiftId: string;
  outgoingName: string;
  incomingName: string;
  expectedAmount: number;
  declaredAmount: number;
  receivedAmount: number | null;
  difference: number | null;
  status: "awaiting_confirmation" | "confirmed" | "discrepancy";
  initiatedAt: string;
  confirmedAt: string | null;
  incomingNote: string | null;
};

export type ManagerCashReconciliation = {
  id: string;
  shiftId: string;
  cashierName: string;
  expectedCash: number;
  actualCash: number;
  variance: number;
  varianceReason: string | null;
  closedAt: string;
};

export type ManagerCashierEvent = {
  id: string;
  shiftId: string | null;
  actorName: string | null;
  action: string;
  message: string;
  amount: number | null;
  createdAt: string;
};

export type ManagerCashierOperationsSnapshot = {
  activeShifts: ManagerCashierShift[];
  expenses: ManagerCashierExpense[];
  handovers: ManagerCashHandover[];
  reconciliations: ManagerCashReconciliation[];
  cashCollectedToday: number;
  recentEvents: ManagerCashierEvent[];
};

type JsonRecord = Record<string, unknown>;
const array = (value: unknown) => Array.isArray(value) ? value as JsonRecord[] : [];
const text = (value: unknown) => typeof value === "string" ? value : "";
const nullableText = (value: unknown) => typeof value === "string" && value.length ? value : null;
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export async function loadManagerCashierOperations(restaurantId: string): Promise<ManagerCashierOperationsSnapshot> {
  const { data, error } = await supabase.rpc("get_manager_cashier_operations", { target_restaurant_id: restaurantId });
  if (error) throw new Error(error.message);
  const payload = (data ?? {}) as JsonRecord;
  return {
    activeShifts: array(payload.active_shifts).map((row) => ({
      id: text(row.id), cashierId: text(row.cashier_id), cashierName: text(row.cashier_name) || "Cashier",
      employeeId: nullableText(row.employee_id), openedAt: text(row.opened_at), openingCash: number(row.opening_cash),
      cashCollected: number(row.cash_collected), nonCashCollected: number(row.non_cash_collected),
      approvedExpenses: number(row.approved_expenses), pendingExpenses: number(row.pending_expenses), expectedCash: number(row.expected_cash),
    })),
    expenses: array(payload.expenses).map((row) => ({
      id: text(row.id), shiftId: text(row.shift_id), cashierId: text(row.cashier_id), cashierName: text(row.cashier_name) || "Cashier",
      employeeId: nullableText(row.employee_id), amount: number(row.amount), reason: text(row.reason), note: nullableText(row.note),
      status: text(row.status) as ManagerCashierExpense["status"], createdAt: text(row.created_at), reviewedAt: nullableText(row.reviewed_at), rejectionReason: nullableText(row.rejection_reason),
    })),
    handovers: array(payload.handovers).map((row) => ({
      id: text(row.id), outgoingShiftId: text(row.outgoing_shift_id), outgoingName: text(row.outgoing_name) || "Cashier",
      incomingName: text(row.incoming_name) || "Cashier", expectedAmount: number(row.expected_amount), declaredAmount: number(row.declared_amount),
      receivedAmount: row.received_amount == null ? null : number(row.received_amount), difference: row.difference == null ? null : number(row.difference),
      status: text(row.status) as ManagerCashHandover["status"], initiatedAt: text(row.initiated_at), confirmedAt: nullableText(row.confirmed_at), incomingNote: nullableText(row.incoming_note),
    })),
    reconciliations: array(payload.reconciliations).map((row) => ({
      id: text(row.id), shiftId: text(row.shift_id), cashierName: text(row.cashier_name) || "Cashier", expectedCash: number(row.expected_cash),
      actualCash: number(row.actual_cash), variance: number(row.variance), varianceReason: nullableText(row.variance_reason), closedAt: text(row.closed_at),
    })),
    cashCollectedToday: number(payload.cash_collected_today),
    recentEvents: array(payload.recent_events).map((row) => ({
      id: text(row.id), shiftId: nullableText(row.shift_id), actorName: nullableText(row.actor_name), action: text(row.action),
      message: text(row.message), amount: row.amount == null ? null : number(row.amount), createdAt: text(row.created_at),
    })),
  };
}

export async function reviewManagerCashierExpense(expenseId: string, decision: "approved" | "rejected", rejectionReason?: string) {
  const { error } = await supabase.rpc("review_cashier_shift_expense", {
    target_expense_id: expenseId,
    decision,
    rejection_explanation: decision === "rejected" ? rejectionReason?.trim() || null : null,
  });
  if (error) throw new Error(error.message);
}

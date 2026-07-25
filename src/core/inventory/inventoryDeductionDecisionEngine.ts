import {
  ORDER_SOURCES,
  OrderWorkflowEngine,
  type DiningSessionState,
  type OrderSource,
  type WaiterWorkflowPolicy,
  type WorkflowKitchenStatus,
  type WorkflowPaymentStatus,
} from "../workflow/orderWorkflowEngine";

export const INVENTORY_DEDUCTION_EVENTS = {
  KITCHEN_ACCEPTED: "kitchen_accepted",
  KITCHEN_PREPARING: "kitchen_preparing",
  KITCHEN_READY: "kitchen_ready",
  KITCHEN_SERVED: "kitchen_served",
  KITCHEN_COMPLETED: "kitchen_completed",
  KITCHEN_DELIVERED: "kitchen_delivered",
  KITCHEN_CANCELLED: "kitchen_cancelled",
  KITCHEN_REJECTED: "kitchen_rejected",
  KITCHEN_VOIDED: "kitchen_voided",
  CASHIER_PAID: "cashier_paid",
  QR_PAID: "qr_paid",
  CASHIER_BILL_CLOSED: "cashier_bill_closed",
  DINING_SESSION_CLOSED: "dining_session_closed",
} as const;

export type InventoryDeductionEvent =
  (typeof INVENTORY_DEDUCTION_EVENTS)[keyof typeof INVENTORY_DEDUCTION_EVENTS]
  | (string & {});

export type InventoryDeductionPaymentStatus =
  | WorkflowPaymentStatus
  | "pending"
  | "held";

export type InventoryDeductionKitchenStatus =
  | WorkflowKitchenStatus
  | "served"
  | "delivered"
  | "cancelled"
  | "rejected"
  | "voided";

export type InventoryDeductionDecisionInput = Readonly<{
  restaurantId: string;
  workflowPolicySnapshot: WaiterWorkflowPolicy;
  orderSource: OrderSource;
  diningSessionState: DiningSessionState;
  paymentStatus: InventoryDeductionPaymentStatus;
  kitchenStatus: InventoryDeductionKitchenStatus;
  event: InventoryDeductionEvent;
}>;

export type InventoryDeductionDecision = Readonly<{
  shouldDeduct: boolean;
}>;

function workflowPaymentStatus(
  paymentStatus: InventoryDeductionPaymentStatus,
): WorkflowPaymentStatus {
  if (paymentStatus === "paid") return "paid";
  if (paymentStatus === "cancelled") return "cancelled";
  if (paymentStatus === "refunded") return "refunded";
  return "unpaid";
}

function workflowOrderSource(orderSource: OrderSource): OrderSource {
  if (orderSource === "public_qr") return ORDER_SOURCES.CUSTOMER_QR;
  if (orderSource === "cashier") return ORDER_SOURCES.CASHIER_POS;
  return orderSource;
}

function workflowKitchenStatus(
  kitchenStatus: InventoryDeductionKitchenStatus,
): WorkflowKitchenStatus {
  if (kitchenStatus === "served" || kitchenStatus === "delivered") {
    return "completed";
  }
  if (
    kitchenStatus === "cancelled" ||
    kitchenStatus === "rejected" ||
    kitchenStatus === "voided"
  ) {
    return "not_started";
  }
  return kitchenStatus;
}

function isFinalServiceEvent(event: InventoryDeductionEvent): boolean {
  return (
    event === INVENTORY_DEDUCTION_EVENTS.KITCHEN_SERVED ||
    event === INVENTORY_DEDUCTION_EVENTS.KITCHEN_COMPLETED ||
    event === INVENTORY_DEDUCTION_EVENTS.KITCHEN_DELIVERED
  );
}

function isFinalServiceStatus(status: InventoryDeductionKitchenStatus): boolean {
  return status === "served" || status === "completed" || status === "delivered";
}

export function resolveInventoryDeductionDecision(
  input: InventoryDeductionDecisionInput,
): InventoryDeductionDecision {
  const workflowDecision = OrderWorkflowEngine.resolve({
    restaurantId: input.restaurantId,
    waiterPolicy: input.workflowPolicySnapshot,
    orderSource: workflowOrderSource(input.orderSource),
    diningSessionState: input.diningSessionState,
    paymentStatus: workflowPaymentStatus(input.paymentStatus),
    kitchenStatus: workflowKitchenStatus(input.kitchenStatus),
  });

  if (!isFinalServiceEvent(input.event)) {
    return { shouldDeduct: false };
  }
  if (!isFinalServiceStatus(input.kitchenStatus)) {
    return { shouldDeduct: false };
  }
  if (input.paymentStatus === "cancelled" || input.paymentStatus === "refunded") {
    return { shouldDeduct: false };
  }

  return {
    shouldDeduct:
      workflowDecision.releaseToKitchen &&
      (workflowDecision.nextState === "completed" ||
        workflowDecision.nextState === "payment_due"),
  };
}

export const InventoryDeductionDecisionEngine = Object.freeze({
  resolve: resolveInventoryDeductionDecision,
});

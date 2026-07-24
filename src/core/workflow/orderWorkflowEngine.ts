/**
 * ServeFlow's UI-independent order workflow authority.
 *
 * Keep this module pure: no React, database, realtime, routing, or clock access.
 * Persistence adapters pass canonical dining-session facts in and obey the
 * returned decision. Unknown sources intentionally use the safe pay-first path.
 */
export const ORDER_SOURCES = {
  CUSTOMER_QR: "customer_qr",
  WAITER: "waiter",
  CASHIER_POS: "cashier_pos",
  ONLINE: "online",
  DELIVERY: "delivery",
  HOTEL_PMS: "hotel_pms",
  CORPORATE_API: "corporate_api",
} as const;

export type KnownOrderSource =
  (typeof ORDER_SOURCES)[keyof typeof ORDER_SOURCES];
export type OrderSource = KnownOrderSource | (string & {});
export type WaiterWorkflowPolicy =
  | "pay_before_kitchen"
  | "kitchen_before_payment";
export type WorkflowPaymentStatus =
  | "unpaid"
  | "paid"
  | "refunded"
  | "cancelled";
export type WorkflowKitchenStatus =
  | "not_started"
  | "accepted"
  | "preparing"
  | "ready"
  | "completed";
export type DiningSessionState = "open" | "closed";
export type OrderWorkflowState =
  | "cashier_queue"
  | "kitchen_queue"
  | "ready"
  | "payment_due"
  | "completed"
  | "closed";

export type OrderWorkflowInput = Readonly<{
  restaurantId: string;
  waiterPolicy: WaiterWorkflowPolicy;
  orderSource: OrderSource;
  diningSessionState: DiningSessionState;
  paymentStatus: WorkflowPaymentStatus;
  kitchenStatus: WorkflowKitchenStatus;
}>;

export type OrderWorkflowDecision = Readonly<{
  nextState: OrderWorkflowState;
  releaseToKitchen: boolean;
  paymentRequired: boolean;
  closeDiningSession: boolean;
  reason: string;
}>;

function isDeferredWaiter(input: OrderWorkflowInput): boolean {
  return (
    input.orderSource === ORDER_SOURCES.WAITER &&
    input.waiterPolicy === "kitchen_before_payment"
  );
}

/** Resolve the next destination from dining-session facts only. */
export function resolveOrderWorkflow(
  input: OrderWorkflowInput,
): OrderWorkflowDecision {
  if (!input.restaurantId.trim()) {
    throw new Error("restaurantId is required for tenant-safe workflow resolution.");
  }

  if (input.diningSessionState === "closed") {
    return {
      nextState: "closed",
      releaseToKitchen: false,
      paymentRequired: false,
      closeDiningSession: false,
      reason: "Dining session is already closed.",
    };
  }

  const paid = input.paymentStatus === "paid";
  const deferredWaiter = isDeferredWaiter(input);
  const releaseToKitchen = paid || deferredWaiter;

  if (!releaseToKitchen) {
    return {
      nextState: "cashier_queue",
      releaseToKitchen: false,
      paymentRequired: true,
      closeDiningSession: false,
      reason: "Payment must be verified before kitchen release.",
    };
  }

  if (input.kitchenStatus === "ready") {
    return {
      nextState: "ready",
      releaseToKitchen: true,
      paymentRequired: !paid,
      closeDiningSession: false,
      reason: "Kitchen work is ready for service.",
    };
  }

  if (input.kitchenStatus === "completed") {
    if (!paid) {
      return {
        nextState: "payment_due",
        releaseToKitchen: true,
        paymentRequired: true,
        closeDiningSession: false,
        reason: "Deferred waiter session completed kitchen service before payment.",
      };
    }
    return {
      nextState: "completed",
      releaseToKitchen: true,
      paymentRequired: false,
      closeDiningSession: true,
      reason: "Kitchen service and payment are complete.",
    };
  }

  return {
    nextState: "kitchen_queue",
    releaseToKitchen: true,
    paymentRequired: !paid,
    closeDiningSession: false,
    reason: deferredWaiter
      ? "Restaurant policy releases waiter orders before payment."
      : "Verified payment releases the order to kitchen.",
  };
}

export const OrderWorkflowEngine = Object.freeze({
  resolve: resolveOrderWorkflow,
});

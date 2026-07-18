export type OperationalStatus =
  "new" | "accepted" | "preparing" | "ready" | "served" | "closed";
export type PaymentStatus =
  "pending" | "held" | "paid" | "refunded" | "cancelled";
export type PaymentPolicy = "pay_before_kitchen" | "hold_payment" | "mixed";
export type CanonicalPaymentMethod =
  | "Cash"
  | "Card"
  | "TeleBirr"
  | "CBE Birr"
  | "Chapa"
  | "Mobile Banking"
  | "Mixed";

export function canonicalPaymentMethod(
  value: unknown,
): CanonicalPaymentMethod | "Other" {
  const method = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[ _-]+/g, " ");
  if (method === "cash") return "Cash";
  if (
    method === "card" ||
    method.includes("credit") ||
    method.includes("debit")
  )
    return "Card";
  if (method === "telebirr" || method === "tele birr") return "TeleBirr";
  if (method === "cbe birr" || method === "cbebirr") return "CBE Birr";
  if (method === "chapa") return "Chapa";
  if (method === "mobile banking" || method === "mobile")
    return "Mobile Banking";
  if (method === "mixed") return "Mixed";
  return "Other";
}
export type DiningSessionStatus =
  "opened" | "dining" | "waiting_bill" | "paid" | "closed";

export type CanonicalOrderLifecycle = {
  operational: OperationalStatus;
  payment: PaymentStatus;
};

export type CanonicalLifecycleSource = {
  operational_status?: unknown;
  payment_status?: unknown;
};

export const OPERATIONAL_STATUS_LABEL: Record<OperationalStatus, string> = {
  new: "New",
  accepted: "Accepted",
  preparing: "Preparing",
  ready: "Ready",
  served: "Served",
  closed: "Closed",
};
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: "Pending",
  held: "Payment Due",
  paid: "Paid",
  refunded: "Refunded",
  cancelled: "Cancelled",
};
export const PAYMENT_POLICY_LABEL: Record<PaymentPolicy, string> = {
  pay_before_kitchen: "Pay Before Kitchen",
  hold_payment: "Hold Payment",
  mixed: "Mixed Mode",
};

export function canonicalPaymentStatus(value: unknown): PaymentStatus {
  const status = String(value ?? "").toLowerCase();
  if (status === "held") return "held";
  if (status === "paid" || status === "verified") return "paid";
  if (status === "refunded") return "refunded";
  if (status === "cancelled" || status === "rejected") return "cancelled";
  return "pending";
}

export function canonicalOperationalStatus(value: unknown): OperationalStatus {
  const status = String(value ?? "").toLowerCase();
  if (status === "accepted" || status === "paid") return "accepted";
  if (status === "preparing") return "preparing";
  if (status === "ready") return "ready";
  if (status === "served" || status === "completed") return "served";
  if (status === "closed" || status === "cancelled") return "closed";
  return "new";
}

/** The only supported UI mapper for an order lifecycle. */
export function canonicalOrderLifecycle(
  source: CanonicalLifecycleSource,
): CanonicalOrderLifecycle {
  return {
    operational: canonicalOperationalStatus(source.operational_status),
    payment: canonicalPaymentStatus(source.payment_status),
  };
}

export function canonicalKitchenProgress(
  itemStatuses: readonly unknown[],
  fallbackOperationalStatus: unknown,
): OperationalStatus {
  const statuses = itemStatuses.map(canonicalOperationalStatus);
  if (statuses.includes("preparing")) return "preparing";
  if (statuses.length > 0 && statuses.every((status) => status === "ready" || status === "served" || status === "closed")) return "ready";
  if (statuses.includes("ready")) return "preparing";
  if (statuses.includes("accepted")) return "accepted";
  return canonicalOperationalStatus(fallbackOperationalStatus);
}

export function paymentLabel(value: unknown) {
  return PAYMENT_STATUS_LABEL[canonicalPaymentStatus(value)];
}
export function operationalLabel(value: unknown) {
  return OPERATIONAL_STATUS_LABEL[canonicalOperationalStatus(value)];
}

export function customerTrackingStep(value: unknown) {
  const status = canonicalOperationalStatus(value);
  if (status === "served" || status === "closed") return 4;
  if (status === "ready") return 3;
  if (status === "preparing" || status === "accepted") return 2;
  return 1;
}

export function customerTrackingMessage(value: unknown) {
  const status = canonicalOperationalStatus(value);
  if (status === "served" || status === "closed") return "Served. Enjoy your meal.";
  if (status === "ready") return "Your order is ready.";
  if (status === "preparing") return "The kitchen is preparing your order.";
  if (status === "accepted") return "The kitchen accepted your order.";
  return "Your order was received.";
}

export function customerTrackingEta(value: unknown) {
  const status = canonicalOperationalStatus(value);
  if (status === "served" || status === "closed") return "Served";
  if (status === "ready") return "Ready now";
  if (status === "preparing") return "Est. 8-12 min";
  return "Est. 15 min";
}

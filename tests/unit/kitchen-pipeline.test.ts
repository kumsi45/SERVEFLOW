import { describe, expect, it } from "vitest";

type Ticket = {
  restaurantId: string;
  source: "public_qr" | "waiter";
  paymentTiming: "before_kitchen" | "after_meal";
  paymentStatus: "pending" | "held" | "paid";
  operationalStatus: "new" | "accepted" | "preparing" | "ready" | "served" | "closed";
  kitchenStatus: "held" | "accepted" | "preparing" | "ready" | "completed";
  sessionStatus: "open" | "closed";
  tableReleased: boolean;
};

const tenants = ["Restaurant A", "Restaurant B", "Restaurant C", "Restaurant D"];
const policies = ["pay_before_kitchen", "kitchen_before_payment"] as const;

const resolvePaymentTiming = (
  source: Ticket["source"],
  policy: (typeof policies)[number],
): Ticket["paymentTiming"] => {
  if (source === "public_qr") return "before_kitchen";
  if (policy === "kitchen_before_payment") return "after_meal";
  return "before_kitchen";
};

// Mirrors the canonical SQL predicate, including the waiter-only hold exception.
const isQueueEligible = (ticket: Ticket) =>
  ["accepted", "preparing", "ready"].includes(ticket.operationalStatus) &&
  ticket.sessionStatus === "open" &&
  !ticket.tableReleased &&
  (ticket.paymentStatus === "paid" ||
    (ticket.paymentStatus === "held" &&
      ticket.paymentTiming === "after_meal" &&
      ticket.source !== "public_qr")) &&
  ["accepted", "preparing", "ready"].includes(ticket.kitchenStatus);

const transition = (ticket: Ticket, next: "preparing" | "ready" | "completed") => {
  if (!isQueueEligible(ticket)) throw new Error("Ticket is not active kitchen work.");
  const expected = next === "preparing" ? "accepted" : next === "ready" ? "preparing" : "ready";
  if (ticket.kitchenStatus !== expected) throw new Error("Invalid kitchen transition.");
  ticket.kitchenStatus = next;
  ticket.operationalStatus = next === "completed" ? "served" : next;
};

describe.each(tenants)("%s canonical kitchen pipeline", (restaurantId) => {
  const base = (overrides: Partial<Ticket>): Ticket => ({
    restaurantId,
    source: "public_qr",
    paymentTiming: "before_kitchen",
    paymentStatus: "pending",
    operationalStatus: "accepted",
    kitchenStatus: "held",
    sessionStatus: "open",
    tableReleased: false,
    ...overrides,
  });

  it.each(policies)("routes QR through cashier first under %s", (policy) => {
    const paymentTiming = resolvePaymentTiming("public_qr", policy);
    expect(paymentTiming).toBe("before_kitchen");

    const unpaid = base({ paymentTiming });
    expect(isQueueEligible(unpaid)).toBe(false);
    expect(() => transition(unpaid, "preparing")).toThrow();

    const paid = base({ paymentTiming, paymentStatus: "paid", kitchenStatus: "accepted" });
    expect(isQueueEligible(paid)).toBe(true);
  });

  it.each(policies)("applies %s only to waiter orders", (policy) => {
    const paymentTiming = resolvePaymentTiming("waiter", policy);
    const paymentStatus = paymentTiming === "after_meal" ? "held" : "pending";
    const waiter = base({
      source: "waiter",
      paymentTiming,
      paymentStatus,
      kitchenStatus: paymentTiming === "after_meal" ? "accepted" : "held",
    });
    expect(isQueueEligible(waiter)).toBe(paymentTiming === "after_meal");
  });

  it("preserves waiter kitchen-before-payment and the complete kitchen lifecycle", () => {
    const held = base({
      source: "waiter",
      paymentTiming: "after_meal",
      paymentStatus: "held",
      kitchenStatus: "accepted",
    });
    expect(isQueueEligible(held)).toBe(true);
    transition(held, "preparing");
    transition(held, "ready");
    transition(held, "completed");
    expect(held).toMatchObject({ kitchenStatus: "completed", operationalStatus: "served" });
    expect(isQueueEligible(held)).toBe(false);
  });

  it.each([
    { operationalStatus: "served" as const },
    { operationalStatus: "closed" as const },
    { sessionStatus: "closed" as const },
    { tableReleased: true },
  ])("excludes historical or closed work: %o", (closedState) => {
    expect(isQueueEligible(base({ paymentStatus: "paid", kitchenStatus: "ready", ...closedState }))).toBe(false);
  });
});

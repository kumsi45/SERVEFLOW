import { describe, expect, it } from "vitest";
import {
  canonicalKitchenProgress,
  canonicalOperationalStatus,
  canonicalOrderLifecycle,
  canonicalPaymentMethod,
  canonicalPaymentStatus,
  customerTrackingEta,
  customerTrackingMessage,
  customerTrackingStep,
  OPERATIONAL_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
} from "../../src/core/payment/lifecycle";

describe("canonical lifecycle", () => {
  it.each(["new", "accepted", "preparing", "ready", "served", "closed"])("preserves operational state %s", (state) => {
    expect(canonicalOperationalStatus(state)).toBe(state);
    expect(OPERATIONAL_STATUS_LABEL[state as keyof typeof OPERATIONAL_STATUS_LABEL]).toBeTruthy();
  });

  it.each(["pending", "held", "paid", "refunded", "cancelled"])("preserves payment state %s", (state) => {
    expect(canonicalPaymentStatus(state)).toBe(state);
    expect(PAYMENT_STATUS_LABEL[state as keyof typeof PAYMENT_STATUS_LABEL]).toBeTruthy();
  });

  it("keeps operational and payment dimensions independent", () => {
    expect(canonicalOrderLifecycle({ operational_status: "preparing", payment_status: "held" })).toEqual({ operational: "preparing", payment: "held" });
  });

  it("computes kitchen progress without payment input", () => {
    expect(canonicalKitchenProgress(["paid", "preparing"], "accepted")).toBe("preparing");
    expect(canonicalKitchenProgress(["ready", "completed"], "preparing")).toBe("ready");
  });

  it("drives customer tracking presentation from canonical operational state", () => {
    expect(customerTrackingStep("completed")).toBe(4);
    expect(customerTrackingMessage("preparing")).toContain("preparing");
    expect(customerTrackingEta("ready")).toBe("Ready now");
  });
});

describe("payment methods", () => {
  it.each([
    ["Cash", "Cash"], ["Card", "Card"], ["TeleBirr", "TeleBirr"], ["CBE Birr", "CBE Birr"],
    ["Chapa", "Chapa"], ["Mobile Banking", "Mobile Banking"], ["Mixed", "Mixed"],
  ])("normalizes %s", (input, expected) => expect(canonicalPaymentMethod(input)).toBe(expected));
});

describe("payment policy matrix", () => {
  const policies = ["pay_before_kitchen", "kitchen_before_payment"] as const;
  it.each(policies)("has a deterministic policy fixture for %s", (policy) => {
    const expected = policy === "pay_before_kitchen" ? "pending" : "held";
    expect(canonicalOrderLifecycle({ operational_status: "new", payment_status: expected }).payment).toBe(expected);
  });

  it.each(["pending", "held"])("labels unpaid state %s as Payment Due", (status) => {
    expect(PAYMENT_STATUS_LABEL[status as "pending" | "held"]).toBe("Payment Due");
  });
});

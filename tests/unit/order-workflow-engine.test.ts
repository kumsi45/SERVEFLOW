import { describe, expect, it } from "vitest";
import {
  ORDER_SOURCES,
  OrderWorkflowEngine,
  type OrderWorkflowInput,
} from "../../src/core/workflow/orderWorkflowEngine";

const base: OrderWorkflowInput = {
  restaurantId: "restaurant-a",
  waiterPolicy: "pay_before_kitchen",
  orderSource: ORDER_SOURCES.WAITER,
  diningSessionState: "open",
  paymentStatus: "unpaid",
  kitchenStatus: "not_started",
};
const resolve = (change: Partial<OrderWorkflowInput> = {}) =>
  OrderWorkflowEngine.resolve({ ...base, ...change });

describe("OrderWorkflowEngine", () => {
  it.each(["pay_before_kitchen", "kitchen_before_payment"] as const)(
    "always routes Customer QR through payment under %s",
    (waiterPolicy) => {
      expect(resolve({ orderSource: ORDER_SOURCES.CUSTOMER_QR, waiterPolicy }).nextState)
        .toBe("cashier_queue");
    },
  );

  it("routes waiter pay-before to cashier and then kitchen", () => {
    expect(resolve().nextState).toBe("cashier_queue");
    expect(resolve({ paymentStatus: "paid" }).nextState).toBe("kitchen_queue");
  });

  it("routes waiter kitchen-before directly to kitchen", () => {
    expect(resolve({ waiterPolicy: "kitchen_before_payment" })).toMatchObject({
      nextState: "kitchen_queue",
      releaseToKitchen: true,
      paymentRequired: true,
    });
  });

  it("routes ready and deferred completed sessions correctly", () => {
    expect(resolve({ waiterPolicy: "kitchen_before_payment", kitchenStatus: "ready" }).nextState)
      .toBe("ready");
    expect(resolve({ waiterPolicy: "kitchen_before_payment", kitchenStatus: "completed" }).nextState)
      .toBe("payment_due");
  });

  it("completes paid service and instructs the caller to close the session", () => {
    expect(resolve({ paymentStatus: "paid", kitchenStatus: "completed" })).toMatchObject({
      nextState: "completed",
      closeDiningSession: true,
    });
  });

  it("treats POS and future sources as safe pay-before integrations", () => {
    for (const orderSource of [ORDER_SOURCES.CASHIER_POS, ORDER_SOURCES.ONLINE, "new_partner"]) {
      expect(resolve({ orderSource }).nextState).toBe("cashier_queue");
    }
  });

  it("is deterministic and tenant input is mandatory", () => {
    expect(resolve()).toEqual(resolve());
    expect(() => resolve({ restaurantId: "" })).toThrow(/restaurantId/);
  });

  it("keeps additional batches governed by their dining session facts", () => {
    const session = { waiterPolicy: "kitchen_before_payment" as const, restaurantId: "restaurant-b" };
    expect(resolve(session).nextState).toBe("kitchen_queue");
    expect(resolve({ ...session, kitchenStatus: "completed" }).nextState).toBe("payment_due");
  });

  it("makes a closed session terminal", () => {
    expect(resolve({ diningSessionState: "closed" }).nextState).toBe("closed");
  });
});

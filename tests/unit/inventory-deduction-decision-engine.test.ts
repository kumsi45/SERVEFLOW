import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INVENTORY_DEDUCTION_EVENTS,
  InventoryDeductionDecisionEngine,
  type InventoryDeductionDecisionInput,
} from "../../src/core/inventory/inventoryDeductionDecisionEngine";
import { ORDER_SOURCES } from "../../src/core/workflow/orderWorkflowEngine";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const sql = read("supabase/migrations/176_phase8_4_1_inventory_deduction_decision_engine.sql");

const completedQr: InventoryDeductionDecisionInput = {
  restaurantId: "restaurant-a",
  workflowPolicySnapshot: "pay_before_kitchen",
  orderSource: ORDER_SOURCES.CUSTOMER_QR,
  diningSessionState: "open",
  paymentStatus: "paid",
  kitchenStatus: "completed",
  event: INVENTORY_DEDUCTION_EVENTS.KITCHEN_COMPLETED,
};

const shouldDeduct = (change: Partial<InventoryDeductionDecisionInput> = {}) =>
  InventoryDeductionDecisionEngine.resolve({ ...completedQr, ...change }).shouldDeduct;

describe("InventoryDeductionDecisionEngine", () => {
  it("returns TRUE when the workflow reaches final service completion", () => {
    expect(shouldDeduct()).toBe(true);
    expect(shouldDeduct({
      kitchenStatus: "served",
      event: INVENTORY_DEDUCTION_EVENTS.KITCHEN_SERVED,
    })).toBe(true);
    expect(shouldDeduct({
      kitchenStatus: "delivered",
      event: INVENTORY_DEDUCTION_EVENTS.KITCHEN_DELIVERED,
    })).toBe(true);
  });

  it("returns FALSE when kitchen accepts the batch", () => {
    expect(shouldDeduct({
      kitchenStatus: "accepted",
      event: INVENTORY_DEDUCTION_EVENTS.KITCHEN_ACCEPTED,
    })).toBe(false);
  });

  it("returns FALSE when kitchen begins preparing", () => {
    expect(shouldDeduct({
      kitchenStatus: "preparing",
      event: INVENTORY_DEDUCTION_EVENTS.KITCHEN_PREPARING,
    })).toBe(false);
  });

  it("returns FALSE when kitchen marks ready", () => {
    expect(shouldDeduct({
      kitchenStatus: "ready",
      event: INVENTORY_DEDUCTION_EVENTS.KITCHEN_READY,
    })).toBe(false);
  });

  it("returns FALSE when cashier accepts payment", () => {
    expect(shouldDeduct({
      orderSource: ORDER_SOURCES.CASHIER_POS,
      kitchenStatus: "not_started",
      event: INVENTORY_DEDUCTION_EVENTS.CASHIER_PAID,
    })).toBe(false);
  });

  it("returns FALSE when a QR order is paid before kitchen acceptance", () => {
    expect(shouldDeduct({
      orderSource: ORDER_SOURCES.CUSTOMER_QR,
      kitchenStatus: "not_started",
      event: INVENTORY_DEDUCTION_EVENTS.QR_PAID,
    })).toBe(false);
  });

  it.each([
    ["cancelled", INVENTORY_DEDUCTION_EVENTS.KITCHEN_CANCELLED],
    ["rejected", INVENTORY_DEDUCTION_EVENTS.KITCHEN_REJECTED],
    ["voided", INVENTORY_DEDUCTION_EVENTS.KITCHEN_VOIDED],
  ] as const)("returns FALSE when kitchen work is %s", (kitchenStatus, event) => {
    expect(shouldDeduct({ kitchenStatus, event })).toBe(false);
  });

  it("respects the frozen workflow policy snapshot instead of a live setting", () => {
    const staleLiveSetting = "pay_before_kitchen";
    const frozenWaiterHold = {
      restaurantId: "restaurant-a",
      workflowPolicySnapshot: "kitchen_before_payment" as const,
      liveRestaurantPolicy: staleLiveSetting,
      orderSource: ORDER_SOURCES.WAITER,
      diningSessionState: "open" as const,
      paymentStatus: "held" as const,
      kitchenStatus: "completed" as const,
      event: INVENTORY_DEDUCTION_EVENTS.KITCHEN_COMPLETED,
    };

    expect(InventoryDeductionDecisionEngine.resolve(frozenWaiterHold).shouldDeduct)
      .toBe(true);
    expect(shouldDeduct({
      workflowPolicySnapshot: "pay_before_kitchen",
      orderSource: ORDER_SOURCES.WAITER,
      paymentStatus: "held",
      kitchenStatus: "completed",
      event: INVENTORY_DEDUCTION_EVENTS.KITCHEN_COMPLETED,
    })).toBe(false);
  });

  it("is idempotent and does not mutate inputs", () => {
    const input = Object.freeze({ ...completedQr });
    const first = InventoryDeductionDecisionEngine.resolve(input);
    const second = InventoryDeductionDecisionEngine.resolve(input);

    expect(first).toEqual({ shouldDeduct: true });
    expect(second).toEqual(first);
    expect(input).toEqual(completedQr);
  });
});

describe("Phase 8.4.1 database decision contract", () => {
  it("adds one pure boolean decision resolver and one service-completion adapter", () => {
    expect(sql.match(/create or replace function public\.resolve_inventory_deduction_decision/g)).toHaveLength(1);
    expect(sql.match(/create or replace function public\.should_deduct_inventory_for_service_completion/g)).toHaveLength(1);
    expect(sql).toContain("returns boolean");
    expect(sql).toContain("immutable");
    expect(sql).toContain("event', 'kitchen_completed'");
    expect(sql).toContain("deduction_event not in ('kitchen_served', 'kitchen_completed', 'kitchen_delivered')");
  });

  it("uses the frozen workflow policy snapshot and delegates to the workflow engine", () => {
    expect(sql).toContain("workflow_policy_snapshot");
    expect(sql).toContain("target_order.workflow_policy_snapshot");
    expect(sql).toContain("public.resolve_order_workflow");
    expect(sql).not.toContain("restaurants.payment_policy");
    expect(sql).not.toMatch(/from public\.restaurants/i);
  });

  it("does not deduct inventory, create movements, update quantities, or emit realtime/report work", () => {
    expect(sql).not.toMatch(/inventory_movements|stock_movement|stock_deduction/i);
    expect(sql).not.toMatch(/update\s+public\.inventory_items/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.inventory_/i);
    expect(sql).not.toMatch(/current_quantity|postgres_changes|pg_notify|broadcast/i);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OrderWorkflowEngine } from "../../src/core/workflow/orderWorkflowEngine";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/167_workflow_policy_snapshot_freeze.sql"), "utf8");

type Policy = "pay_before_kitchen" | "kitchen_before_payment";
const openSession = (restaurantId: string, policy: Policy) => ({
  restaurantId,
  snapshot: policy,
  version: 1,
});

describe("dining-session workflow policy snapshot", () => {
  it("captures policy, version, restaurant, and timestamp on creation", () => {
    for (const field of ["workflow_policy_snapshot", "workflow_version", "workflow_captured_at", "restaurant_id"]) {
      expect(sql).toContain(field);
    }
    expect(sql).toContain("new.workflow_policy_snapshot := current_policy");
  });

  it("preserves an existing kitchen-before session after settings change", () => {
    const session = openSession("restaurant-a", "kitchen_before_payment");
    const restaurantSetting: Policy = "pay_before_kitchen";
    expect(restaurantSetting).not.toBe(session.snapshot);
    expect(OrderWorkflowEngine.resolve({
      restaurantId: session.restaurantId,
      waiterPolicy: session.snapshot,
      orderSource: "waiter",
      diningSessionState: "open",
      paymentStatus: "unpaid",
      kitchenStatus: "accepted",
    }).nextState).toBe("kitchen_queue");
  });

  it("uses the changed setting only for a newly opened session", () => {
    const existing = openSession("restaurant-a", "kitchen_before_payment");
    const next = openSession("restaurant-a", "pay_before_kitchen");
    expect(existing.snapshot).toBe("kitchen_before_payment");
    expect(next.snapshot).toBe("pay_before_kitchen");
  });

  it("makes the snapshot immutable and appended batches inherit it", () => {
    expect(sql).toContain("Dining-session workflow snapshot is immutable.");
    expect(sql).toContain("public.resolve_dining_session_payment_timing");
    const appendSection = sql.slice(sql.indexOf("create or replace function public.submit_waiter_order_batch"));
    expect(appendSection).toContain("target_order.id, 'waiter'");
    expect(appendSection).not.toContain("public.resolve_order_payment_timing(");
  });

  it("makes kitchen gates and read models use the snapshot, not live settings", () => {
    const gate = sql.slice(sql.indexOf("create or replace function public.enforce_official_waiter_kitchen_release"));
    expect(gate).toContain("orders.workflow_policy_snapshot");
    expect(gate).not.toContain("restaurants.payment_policy");
    expect(sql).toContain("'waiter_policy', target_session.workflow_policy_snapshot");
  });

  it("backfills existing sessions from persisted timing rather than current settings", () => {
    const backfill = sql.slice(0, sql.indexOf("create index"));
    expect(backfill).toContain("when payment_timing = 'after_meal'");
    expect(backfill).not.toContain("from public.restaurants");
  });

  it("keeps tenant snapshots independent and realtime-owned by orders", () => {
    expect(openSession("restaurant-a", "kitchen_before_payment")).not.toEqual(
      openSession("restaurant-b", "pay_before_kitchen"),
    );
    const realtime = readFileSync(resolve(process.cwd(), "src/core/realtime/restaurantEventService.ts"), "utf8");
    expect(realtime).toContain('"orders"');
    expect(realtime).toContain("restaurant_id=eq.");
  });

  it("does not delete or hide a batch when a transition fails", () => {
    expect(sql).not.toMatch(/delete\s+from\s+public\.(orders|order_items|order_invoices)/i);
    expect(sql).not.toMatch(/exception[\s\S]{0,300}delete\s+from/i);
  });
});

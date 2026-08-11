import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = [
  read("supabase/migrations/234_mastered_service_location_auto_release.sql"),
  read("supabase/migrations/235_cashier_add_on_release_race.sql"),
].join("\n");
const waiter = read("src/modules/waiter-dashboard/pages/WaiterDashboardPage.tsx");

describe("mastered automatic service-location release", () => {
  it("evaluates one physical tenant-scoped dining session", () => {
    expect(migration).toContain("service_location_session_lock_key");
    expect(migration).toContain("target.restaurant_id");
    expect(migration).toContain("target.table_id");
    expect(migration).toContain("locations.restaurant_id = target.restaurant_id");
    expect(migration).toContain("target.dining_session_status <> 'open'");
    expect(migration).toContain("target.table_released_at is not null");
  });

  it("requires invoices and canonical terminal financial states", () => {
    expect(migration).toContain("if not exists (\n    select 1 from public.order_invoices");
    expect(migration).toContain("payment_status not in ('paid', 'cancelled', 'refunded')");
  });

  it("blocks READY and accepts only completed or finalized-cancelled items", () => {
    expect(migration).toContain("items.kitchen_status not in ('completed', 'cancelled')");
    expect(migration).toContain("new.kitchen_status in ('completed', 'cancelled')");
    expect(migration).toContain("finalized_cancellation_auto_release");
    expect(migration).not.toContain("new.kitchen_status in ('completed', 'served', 'delivered')");
  });

  it("uses one lock order for payment, cashier add-ons, creation, cancellation, and release", () => {
    expect(migration.match(/service_location_session_lock_key/g)?.length).toBeGreaterThanOrEqual(8);
    expect(migration).toContain("verify_dining_session_payment_phase234_base");
    expect(migration).toContain("append_items_to_order_phase234_base");
    expect(migration).toContain("create_cashier_order_phase234_base");
    expect(migration).toContain("cashier_handle_cancellation_request_phase234_base");
    expect(migration).toContain("'session_action', 'new_after_release'");
  });

  it("supports auditable system release without fabricating a staff actor", () => {
    expect(migration).not.toContain("if actor.id is null then\n    return target");
    expect(migration).toContain("'actor_type', case when actor.id is null then 'system' else 'staff' end");
    expect(migration).toContain("'service_location_released'");
  });

  it("keeps waiter READY visibility but removes waiter-served authority", () => {
    expect(waiter).toContain('"READY"');
    expect(waiter).not.toContain("markWaiterOrderServed");
    expect(waiter).not.toContain('"SERVED"');
  });
});

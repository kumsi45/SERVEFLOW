import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/230_phase_cancellation_waiter_request.sql");
const page = read("src/modules/waiter-dashboard/pages/WaiterDashboardPage.tsx");
const service = read("src/modules/waiter-dashboard/services/waiterDashboardService.ts");
const types = read("src/modules/waiter-dashboard/types.ts");

describe("mastered cancellation phase 1 waiter request workflow", () => {
  it("persists a tenant-scoped waiter cancellation request with status snapshots", () => {
    expect(migration).toContain("create table if not exists public.order_cancellation_requests");
    expect(migration).toContain("restaurant_id uuid not null");
    expect(migration).toContain("order_id uuid not null");
    expect(migration).toContain("order_item_id uuid");
    expect(migration).toContain("requested_by_user_id uuid not null");
    expect(migration).toContain("requester_role text not null default 'waiter'");
    expect(migration).toContain("current_order_status text not null");
    expect(migration).toContain("current_kitchen_status text not null");
    expect(migration).toContain("current_payment_status text not null");
    expect(migration).toContain("status text not null default 'pending_review'");
  });

  it("keeps cancellation request separate from operational cancellation", () => {
    const rpc = migration.slice(migration.indexOf("create or replace function public.request_waiter_cancellation"));
    expect(rpc).not.toMatch(/delete\s+from\s+public\.order_items/i);
    expect(rpc).not.toMatch(/update\s+public\.orders/i);
    expect(rpc).not.toMatch(/update\s+public\.order_items/i);
    expect(rpc).not.toMatch(/update\s+public\.order_invoices/i);
    expect(rpc).not.toContain("refunded_at");
    expect(rpc).not.toContain("table_released_at =");
    expect(migration).toContain("Request-only: no financial, kitchen, item deletion, or table-release side effects.");
  });

  it("enforces waiter authorization, tenant ownership, and no client restaurant_id trust", () => {
    expect(migration).toContain("target_order_id uuid");
    expect(migration).not.toContain("target_restaurant_id uuid");
    expect(migration).toContain("staff.user_id = auth.uid()");
    expect(migration).toContain("staff.role::text = 'waiter'");
    expect(migration).toContain("Waiter is not authorized for this order.");
    expect(migration).toContain("foreign key (restaurant_id, order_id)");
    expect(migration).toContain("foreign key (restaurant_id, order_item_id)");
    expect(migration).toContain("order_cancellation_requests_select_authorized_staff");
  });

  it("rejects duplicate pending item and order requests server-side", () => {
    expect(migration).toContain("order_cancellation_requests_pending_item_key");
    expect(migration).toContain("order_cancellation_requests_pending_order_key");
    expect(migration).toContain("Cancellation review is already requested for this item.");
    expect(migration).toContain("Cancellation review is already requested for this order.");
    expect(migration).toContain("when unique_violation");
  });

  it("captures reason, requires Other notes, and creates immutable audit evidence", () => {
    for (const reason of [
      "Customer changed mind",
      "Wrong item entered",
      "Duplicate item",
      "Wrong table",
      "Customer requested different item",
      "Other",
    ]) {
      expect(migration).toContain(reason);
      expect(page).toContain(reason);
    }
    expect(page).not.toContain("Item unavailable");
    expect(migration).toContain("Item unavailable");
    expect(migration).toContain("order_cancellation_requests_note_check");
    expect(migration).toContain("'cancellation_requested'");
    expect(migration).toContain("perform public.log_staff_activity");
    expect(migration).not.toContain("approve_waiter_cancellation");
  });

  it("surfaces persisted cancellation state in waiter detail and realtime refresh", () => {
    expect(types).toContain("WaiterCancellationRequest");
    expect(service).toContain('from("order_cancellation_requests")');
    expect(service).toContain("requestWaiterCancellation");
    expect(page).toContain("order_cancellation_requests");
    expect(page).toContain("Cancellation Requested");
    expect(page).toContain("Waiting for review");
    expect(page).toContain("item.cancellationRequest");
  });

  it("uses a compact request modal and never labels the confirmation as final cancellation", () => {
    expect(page).toContain('className="a4-cancel-modal"');
    expect(page).toContain("Request Cancellation");
    expect(page).toContain("This sends a review request only.");
    expect(page).not.toContain("onClick={() => void editPendingItem(item.id, 0)}");
  });

  it("allows preparing or paid items to request review without changing kitchen or payment state", () => {
    expect(migration).toContain("current_kitchen_status");
    expect(migration).toContain("current_payment_status");
    expect(migration).toContain("coalesce(target_item.kitchen_status, 'held') in ('completed', 'served', 'delivered', 'cancelled', 'voided')");
    expect(page).toContain("kitchenStatusName(item.kitchenStatus)");
    expect(page).toContain("paymentName(cancellationTarget.item.invoiceStatus)");
  });
});

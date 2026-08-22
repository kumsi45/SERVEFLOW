import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replaceAll("\r\n", "\n");
const migration = read("supabase/migrations/242_kitchen_request_inventory_handoff.sql");
const movementEngine = read("supabase/migrations/159_phase8_2_stock_operations_engine.sql");
const reviewFunction = migration.slice(
  migration.indexOf("create or replace function public.process_kitchen_inventory_request"),
  migration.indexOf("create or replace function public.get_inventory_kitchen_request_queue"),
);
const issueFunction = migration.slice(
  migration.indexOf("create or replace function public.issue_kitchen_inventory_request"),
  migration.indexOf("create or replace function public.mark_kitchen_inventory_request_unable_to_fulfill"),
);
const confirmationFunction = migration.slice(
  migration.indexOf("create or replace function public.confirm_kitchen_inventory_request_receipt"),
  migration.indexOf("revoke all on function public.process_kitchen_inventory_request"),
);

describe("Kitchen request to Inventory backend handoff", () => {
  it("extends the canonical request and event tables without creating a parallel workflow", () => {
    expect(migration).toContain("alter table public.kitchen_inventory_requests");
    expect(migration).toContain("alter table public.inventory_request_events");
    expect(migration).not.toContain("create table");
    for (const column of ["issued_by_staff_id", "issued_at", "issued_quantity", "inventory_movement_id", "confirmed_by_staff_id", "confirmed_at", "unable_to_fulfill_reason"]) {
      expect(migration).toContain(column);
    }
  });

  it("maps the existing statuses onto the full V1 lifecycle", () => {
    expect(migration).toContain("'pending','accepted','rejected','issued','unable_to_fulfill','delivered'");
    expect(migration).toContain("request.status<>'pending'");
    expect(issueFunction).toContain("request.status<>'accepted'");
    expect(confirmationFunction).toContain("request.status<>'issued'");
    expect(confirmationFunction).toContain("status='delivered'");
  });

  it("keeps Manager approval authorization-only and preserves reviewer attribution", () => {
    expect(reviewFunction).toContain("role::text in ('manager','owner')");
    expect(reviewFunction).toContain("Inventory link is required before approval.");
    expect(reviewFunction).toContain("reviewed_by_staff_id=actor.id");
    expect(reviewFunction).toContain("accepted_at=case when next_status='accepted'");
    expect(reviewFunction).not.toContain("record_inventory_movement(");
    expect(reviewFunction).not.toContain("insert into public.inventory_movements");
  });

  it("provides an Inventory-only same-tenant approved queue read model", () => {
    expect(migration).toContain("get_inventory_kitchen_request_queue");
    expect(migration).toContain("staff.restaurant_id=target_restaurant_id");
    expect(migration).toContain("staff.user_id=auth.uid()");
    expect(migration).toContain("staff.active=true");
    expect(migration).toContain("staff.role::text in ('inventory_officer','owner')");
    expect(migration).toContain("request.restaurant_id=target_restaurant_id and request.status='accepted'");
    for (const field of ["requested_quantity", "station_name", "requested_by_name", "priority", "approved_by_name", "approved_at", "current_quantity", "reorder_level"]) {
      expect(migration).toContain(field);
    }
  });

  it("serializes full issue, validates stock and unit, and records exactly one canonical movement", () => {
    expect(issueFunction).toContain("role::text in ('inventory_officer','owner')");
    expect(issueFunction).toContain("restaurant_id=target_restaurant_id for update");
    expect(issueFunction).toContain("Request unit does not match the inventory item unit.");
    expect(issueFunction).toContain("available_quantity:=public.get_inventory_storage_balance");
    expect(issueFunction).toContain("if available_quantity<request.quantity");
    expect(issueFunction).toContain("movement_id:=public.record_inventory_movement(");
    expect(issueFunction).toContain("'stock_out'::public.inventory_movement_type");
    expect(issueFunction).toContain("status='issued'");
    expect(issueFunction).toContain("inventory_movement_id=movement_id");
    expect(migration).toContain("kitchen_inventory_requests_movement_unique");
    expect(movementEngine).toContain("Inventory movements are immutable.");
  });

  it("supports truthful cannot-fulfill without partial or silent quantity reduction", () => {
    expect(migration).toContain("mark_kitchen_inventory_request_unable_to_fulfill");
    expect(migration).toContain("Unable to fulfill reason is required.");
    expect(migration).toContain("status='unable_to_fulfill'");
    expect(migration).toContain("event_type,from_status,to_status,details");
    expect(migration).not.toContain("least(request.quantity");
    expect(migration).not.toContain("greatest(0");
  });

  it("requires a same-tenant Kitchen actor to confirm receipt without a second stock movement", () => {
    expect(confirmationFunction).toContain("role::text in ('kitchen','owner')");
    expect(confirmationFunction).toContain("restaurant_id=target_restaurant_id for update");
    expect(confirmationFunction).toContain("inventory_movement_id is null");
    expect(confirmationFunction).toContain("Issued inventory movement is invalid.");
    expect(confirmationFunction).toContain("confirmed_by_staff_id=actor.id");
    expect(confirmationFunction).toContain("confirmed_at=now_at");
    expect(confirmationFunction).not.toContain("record_inventory_movement(");
    expect(confirmationFunction).not.toContain("insert into public.inventory_movements");
  });

  it("enforces tenant provenance with composite foreign keys and server-derived actors", () => {
    for (const constraint of [
      "kitchen_requests_inventory_item_restaurant_fk",
      "kitchen_requests_station_restaurant_fk",
      "kitchen_requests_requester_restaurant_fk",
      "kitchen_requests_reviewer_restaurant_fk",
      "kitchen_requests_issuer_restaurant_fk",
      "kitchen_requests_confirmer_restaurant_fk",
      "kitchen_requests_movement_restaurant_fk",
      "inventory_request_events_request_restaurant_fk",
      "inventory_request_events_actor_restaurant_fk",
    ]) expect(migration).toContain(constraint);
    expect(migration).toContain("user_id=auth.uid()");
    expect(migration).not.toContain("target_manager_id");
    expect(migration).not.toContain("target_inventory_staff_id");
    expect(migration).not.toContain("target_chef_id");
  });

  it("keeps RLS deny-by-default for mutation and narrows Inventory reads to approved downstream states", () => {
    expect(migration).toContain("drop policy if exists inventory_requests_read_workflow_staff");
    expect(migration).toContain("status in ('accepted','issued','unable_to_fulfill','delivered')");
    expect(migration).toContain("revoke insert,update,delete on public.kitchen_inventory_requests from authenticated");
    expect(migration).toContain("revoke insert,update,delete on public.inventory_request_events from authenticated");
    expect(migration).not.toContain("using (true)");
    expect(migration).not.toContain("with check (true)");
  });

  it("publishes the tenant-RLS-protected request table and locks down every RPC", () => {
    expect(migration).toContain("alter publication supabase_realtime add table public.kitchen_inventory_requests");
    for (const rpc of [
      "get_inventory_kitchen_request_queue(uuid)",
      "issue_kitchen_inventory_request(uuid,uuid)",
      "mark_kitchen_inventory_request_unable_to_fulfill(uuid,uuid,text)",
      "confirm_kitchen_inventory_request_receipt(uuid,uuid)",
    ]) {
      expect(migration).toContain(`revoke all on function public.${rpc} from public,anon,authenticated`);
      expect(migration).toContain(`grant execute on function public.${rpc} to authenticated,service_role`);
    }
  });
});

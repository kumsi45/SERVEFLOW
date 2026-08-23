import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/245_waiter_table_assignment_backend.sql");
const leastPrivilegeMigration = read("supabase/migrations/246_waiter_table_assignment_least_privilege.sql");
const manageStaff = read("supabase/functions/manage-staff/index.ts");

describe("Waiter table assignment backend contract", () => {
  it("uses one atomic authenticated bulk RPC instead of Edge-side writes", () => {
    expect(manageStaff).toContain('userClient.rpc("assign_waiter_tables"');
    expect(manageStaff).not.toContain('.from("restaurant_table_waiter_assignments")');
    expect(migration).toContain("create or replace function public.assign_waiter_tables(");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("return query select assignments.table_id");
  });

  it("validates active management, Waiter, and every active same-tenant table", () => {
    expect(migration).toContain("staff.active and staff.role::text in ('owner','manager')");
    expect(migration).toContain("staff.active and staff.role::text='waiter'");
    expect(migration).toContain("tables.restaurant_id=target_restaurant_id and tables.active");
    expect(migration).toContain("All selected tables must be active restaurant tables.");
    expect(migration).toContain("waiter_table_assignments_table_tenant_fk");
    expect(migration).toContain("waiter_table_assignments_waiter_tenant_fk");
  });

  it("ends and audits responsibility without mutating service lifecycle data", () => {
    expect(migration).toContain("ended_at=changed_at");
    expect(migration).toContain("'previous_waiter_staff_id',previous_waiter_id");
    expect(migration).toContain("'new_waiter_staff_id',desired_waiter_id");
    expect(migration).toContain("'changed_by_staff_id',actor.id");
    expect(migration).not.toMatch(/update public\.orders/i);
    expect(migration).not.toMatch(/update public\.order_invoices/i);
    expect(migration).not.toMatch(/update public\.order_items/i);
    expect(migration).not.toMatch(/update public\.restaurant_tables/i);
  });

  it("supports explicit unassignment while occupancy stays derived from open sessions", () => {
    expect(migration).toContain("create or replace function public.unassign_waiter_tables(");
    expect(migration).toContain("'assignment_action','unassigned'");
    expect(migration).toContain("orders.dining_session_status='open'");
    expect(migration).toContain("orders.table_released_at is null");
  });

  it("limits reads and writes through RLS and least-privilege grants", () => {
    expect(migration).toContain("force row level security");
    expect(migration).toContain("restaurant_table_waiter_assignments_select_management_same_restaurant");
    expect(migration).toContain("restaurant_table_waiter_assignments_select_waiter_self");
    expect(migration).toContain("restaurant_table_waiter_assignments.active");
    expect(migration).toContain("revoke insert, update, delete");
    expect(migration).toContain("revoke all on function public.assign_waiter_tables");
    expect(leastPrivilegeMigration).toContain("revoke all on table public.restaurant_table_waiter_assignments from public, anon, authenticated");
    expect(leastPrivilegeMigration).toContain("grant select on table public.restaurant_table_waiter_assignments to authenticated");
  });

  it("routes the legacy Manager customer action through the canonical engine", () => {
    expect(migration).toContain("create or replace function public.manager_assign_customer_waiter(");
    expect(migration).toContain("perform public.assign_waiter_tables(target_restaurant_id,$3,desired_table_ids)");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replaceAll("\r\n", "\n");
const migration = read("supabase/migrations/259_retire_obsolete_generic_customer_order_rpc.sql");
const lifecycle = read("supabase/migrations/222_phase12_2a_cashier_workflow_finalization.sql");
const orderingService = read("src/modules/ordering/services/orderingService.ts");
const orderingPage = read("src/modules/ordering/pages/OrderingPage.tsx");
const waiterService = read("src/modules/waiter-order/services/waiterOrderService.ts");
const cashierPage = read("src/modules/cashier/pages/CashierDashboardPage.tsx");

describe("Phase B obsolete generic customer order retirement", () => {
  it("preserves the exact API shape and fails closed before mutation", () => {
    expect(migration).toContain("create or replace function public.create_customer_order(");
    expect(migration).toContain("target_restaurant_slug text");
    expect(migration).toContain("requested_items jsonb");
    expect(migration).toContain("returns jsonb");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public");
    expect(migration).toContain("raise exception 'This ordering method is not supported.");
    expect(migration).not.toMatch(/insert\s+into|update\s+public\.|delete\s+from|perform\s+public\./i);
  });

  it("keeps least-privilege grants and a controlled compatibility response", () => {
    expect(migration).toContain("from public, anon;");
    expect(migration).toContain("to authenticated, service_role;");
    expect(migration).not.toMatch(/grant execute[\s\S]*to\s+(public|anon)/i);
    expect(migration).not.toMatch(/stack|rls|migration 259|order_invoices|restaurant_tables/i);
  });

  it("does not weaken table/session integrity or invent future service modes", () => {
    expect(lifecycle).toContain("An active tenant table is required for an open dining session.");
    expect(migration).not.toMatch(/drop trigger|disable trigger|enforce_canonical_open_table_identity/i);
    expect(migration).not.toMatch(/takeaway|delivery|order_source|dining_session_status|table_id|min\s*\(|order by/i);
  });

  it("leaves all three supported V1 order-entry paths intact", () => {
    expect(orderingPage).toContain("submitPublicQrCustomerOrder");
    expect(orderingService).toContain('supabase.rpc("create_public_qr_order"');
    expect(orderingService).not.toContain("submitCustomerOrder");
    expect(orderingService).not.toContain('supabase.rpc("create_customer_order"');
    expect(waiterService).toContain('waiterSupabase.rpc("submit_waiter_order_batch"');
    expect(cashierPage).toContain('"create_cashier_order"');
    expect(cashierPage).toContain('"append_items_to_order"');
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const sql = read("supabase/migrations/165_central_order_workflow_engine.sql");

describe("central workflow architecture", () => {
  it("provides one documented database resolver", () => {
    expect(sql.match(/create or replace function public\.resolve_order_workflow/g)).toHaveLength(1);
    expect(sql).toContain("immutable");
    expect(read("docs/ORDER_WORKFLOW_ENGINE.md")).toContain("sole authority");
  });

  it("makes legacy timing and kitchen gates delegate to the resolver", () => {
    const timing = sql.slice(sql.indexOf("create or replace function public.resolve_order_payment_timing"));
    const gate = sql.slice(sql.indexOf("create or replace function public.enforce_official_waiter_kitchen_release"));
    expect(timing).toContain("public.resolve_order_workflow");
    expect(gate).toContain("public.resolve_order_workflow");
    expect(gate).not.toContain("payment_policy = 'kitchen_before_payment'");
  });

  it("exposes a dining-session read model for realtime and future modules", () => {
    expect(sql).toContain("function public.get_dining_session_workflow");
    expect(sql).toContain("from public.order_invoices");
    expect(sql).toContain("from public.order_items");
    expect(sql).toContain("return public.resolve_order_workflow");
  });
});

import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const enabled = process.env.SERVEFLOW_ALLOW_TEST_WRITES === "true" && process.env.SERVEFLOW_TEST_PROJECT === "true";
const tenantNames = ["A", "B", "C", "D"] as const;
const required = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", ...tenantNames.flatMap((name) => [`SERVEFLOW_TENANT_${name}_TOKEN`, `SERVEFLOW_TENANT_${name}_ID`])] as const;
const ready = enabled && required.every((name) => Boolean(process.env[name]));
const suite = ready ? describe : describe.skip;

suite("guarded Supabase multi-tenant regression", () => {
  const client = (token: string) => createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const tenants = tenantNames.map((name) => ({ token: process.env[`SERVEFLOW_TENANT_${name}_TOKEN`]!, id: process.env[`SERVEFLOW_TENANT_${name}_ID`]! }));

  it.each(["orders", "order_items", "order_invoices", "restaurant_staff", "inventory_items", "kitchen_inventory_requests"])("tenant A cannot read tenant B %s", async (table) => {
    const { data, error } = await client(process.env.SERVEFLOW_TENANT_A_TOKEN!).from(table).select("restaurant_id").eq("restaurant_id", process.env.SERVEFLOW_TENANT_B_ID!).limit(1);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it.each(["orders", "order_items", "order_invoices", "restaurant_staff", "notifications", "inventory_items", "kitchen_inventory_requests"])("isolates %s across four simultaneous restaurants", async (table) => {
    await Promise.all(tenants.flatMap((actor) => tenants.filter((target) => target.id !== actor.id).map(async (target) => {
      const { data, error } = await client(actor.token).from(table).select("restaurant_id").eq("restaurant_id", target.id).limit(1);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    })));
  });

  it("tenant sessions cannot poison each other's analytics", async () => {
    const a = client(process.env.SERVEFLOW_TENANT_A_TOKEN!);
    const { data, error } = await a.rpc("get_canonical_historical_analytics", { target_restaurant_id: process.env.SERVEFLOW_TENANT_B_ID, range_start: "2020-01-01T00:00:00Z", range_end: "2030-01-01T00:00:00Z" });
    expect(error).toBeNull();
    expect(data).toMatchObject({ error: "Permission denied." });
  });

  it.each(["pay_before_kitchen", "hold_payment", "mixed"])("supports payment policy fixture %s", async (policy) => {
    const { data, error } = await client(process.env.SERVEFLOW_TENANT_A_TOKEN!).from("restaurants").select("payment_policy").eq("id", process.env.SERVEFLOW_TENANT_A_ID!).single();
    expect(error).toBeNull();
    expect(["pay_before_kitchen", "hold_payment", "mixed"]).toContain(data?.payment_policy);
    expect(policy).toBeTruthy();
  });
});

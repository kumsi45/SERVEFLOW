import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/263_order_time_inventory_deduction_basis.sql"), "utf8");
const section = (name: string, next: string) => sql.slice(sql.indexOf(`FUNCTION public.${name}`), sql.indexOf(next, sql.indexOf(`FUNCTION public.${name}`)));

describe("prepared order-time inventory deduction invariant", () => {
  it("captures every canonical order-item insert in its transaction", () => {
    expect(sql).toMatch(/after insert on public\.order_items for each row/i);
    expect(sql).toContain("frozen_plan := public.build_order_time_inventory_plan(new.id)");
    expect(sql).toContain("order_item_inventory_basis_lines");
    expect(sql).toMatch(/\nBEGIN;\n/);
    expect(sql).toMatch(/\nCOMMIT;\s*$/);
    expect(sql.match(/^BEGIN;|^COMMIT;/gm)).toEqual(["BEGIN;", "COMMIT;"]);
    expect(sql.indexOf("BEGIN;")).toBeLessThan(sql.indexOf("lock table public.order_items"));
  });
  it("explicitly separates No Tracking from ambiguous legacy history", () => {
    expect(sql).toContain("'recipe', 'direct', 'no_tracking', 'legacy_review', 'legacy_receipt'");
    expect(sql).toContain("then 'legacy_receipt' else 'legacy_review' end");
    expect(sql).toContain("Legacy order item has ambiguous inventory history; manual review required.");
    expect(sql).toContain("'status', 'no_tracking'");
  });
  it("freezes complete converted quantities rather than only recipe IDs", () => {
    expect(sql).toContain("ingredient.quantity_required");
    expect(sql).toContain("public.recipe_unit_conversion_ratio");
    expect(sql).toContain("/ target_recipe_yield");
    expect(sql).toContain("'required_quantity', target_item.quantity::numeric");
    expect(sql).toContain("deduction_plan jsonb not null");
  });
  it("deduction reads immutable basis and allocation descendants, not mutable Menu", () => {
    const start = sql.indexOf("create or replace function public.build_inventory_deduction_plan");
    const end = sql.indexOf("-- Private billing derivative", start);
    const planner = sql.slice(start, end);
    expect(planner).toContain("from public.order_item_inventory_basis");
    expect(planner).not.toContain("public.menu_items");
    expect(planner).not.toContain("public.recipe_ingredients");
    expect(planner).toContain("basis.deduction_plan");
  });
  it("protects snapshot mutation, tenant references and source identities", () => {
    expect(sql).toContain("before update or delete on public.order_item_inventory_basis");
    expect(sql).toContain("references public.inventory_items(restaurant_id, id) on delete restrict");
    expect(sql).toContain("references public.inventory_units(restaurant_id, id) on delete restrict");
    expect(sql).toContain("references public.inventory_storage_locations(restaurant_id, id) on delete restrict");
    expect(sql.match(/enable row level security/g)).toHaveLength(2);
    expect(sql).toContain("from public, anon, authenticated, service_role");
  });
  it("does not backfill ambiguous records from current menu configuration", () => {
    const classification = sql.slice(sql.indexOf("-- Explicit classification only"), sql.indexOf("-- Reuse the validated"));
    expect(classification).not.toContain("menu.recipe_id");
    expect(classification).not.toContain("public.inventory_movements");
    expect(classification).toContain("0, '[]'::jsonb, null");
  });
  it("preserves canonical eligibility, order/stock locks and both once-only guards", () => {
    const deduction = section("deduct_inventory_for_order_item", "-- Audit provenance");
    expect(deduction).toContain("for update");
    expect(deduction).toContain("public.should_deduct_inventory_for_service_completion");
    expect(deduction).toContain("public.get_inventory_storage_balance");
    expect(deduction).toContain("on conflict (order_item_id) do nothing");
    expect(deduction).toContain("Movement would create negative stock.");
    expect(sql).not.toMatch(/drop\s+(index|constraint)/i);
  });
  it("permits deactivated sources only for matching frozen receipt-backed plans", () => {
    expect(sql).toContain("receipt.order_item_id = basis.order_item_id");
    expect(sql).toContain("Automatic movement lacks a matching frozen deduction basis.");
    expect(sql).toContain("(status = 'active' or frozen_automatic)");
    expect(sql).toContain("item_row.unit_id is distinct from new.unit_id");
  });
  it("never attributes direct consumption to a later menu recipe", () => {
    const food = section("inventory_food_consumption_audit_row", "-- Inactive-source exception");
    expect(food).toContain("new.recipe_id := nullif(plan_entry->>'recipe_id', '')::uuid");
    expect(food).not.toContain("origin.recipe_id");
    expect(food).not.toContain("join public.menu_items");
  });
  it("preserves bill split lineage privately without changing prior basis rows", () => {
    expect(sql).toContain("public.prepare_split_inventory_basis(line.id, split_item_id, line.split_quantity)");
    expect(sql).toContain("split_parent_order_item_id");
    expect(sql).toContain("prepared.captured_transaction <> pg_current_xact_id()");
    expect(sql).toContain("already_deducted_inherited");
    expect(sql).not.toMatch(/update\s+public\.order_item_inventory_basis/i);
  });
});

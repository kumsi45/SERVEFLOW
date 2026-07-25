import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const sql = read("supabase/migrations/177_phase8_4_2_atomic_inventory_deduction_engine.sql");
const decisionSql = read("supabase/migrations/176_phase8_4_1_inventory_deduction_decision_engine.sql");

describe("Phase 8.4.2 atomic inventory deduction database contract", () => {
  it("enforces one deduction receipt per order item in PostgreSQL", () => {
    expect(sql).toContain("create table if not exists public.inventory_order_item_deductions");
    expect(sql).toMatch(/order_item_id uuid primary key/i);
    expect(sql).toContain("on conflict (order_item_id) do nothing");
    expect(sql).toContain("'status', 'already_deducted'");
    expect(sql).toContain("inventory_movements_order_item_deduction_unique");
    expect(sql).toContain("where source_system = 'automatic_order_item_deduction'");
  });

  it("locks the order item and every affected inventory item before balance reads", () => {
    const orderLock = sql.indexOf("select item.* into target_item");
    const planBuild = sql.indexOf("deduction_plan := public.build_inventory_deduction_plan");
    const inventoryLock = sql.indexOf("from public.inventory_items locked_inventory");
    const balanceRead = sql.indexOf("available_quantity := public.get_inventory_storage_balance");
    const movementInsert = sql.indexOf("insert into public.inventory_movements");

    expect(sql.slice(orderLock, planBuild)).toContain("for update");
    expect(sql.slice(inventoryLock, balanceRead)).toContain("for update");
    expect(orderLock).toBeGreaterThan(-1);
    expect(planBuild).toBeGreaterThan(orderLock);
    expect(inventoryLock).toBeGreaterThan(planBuild);
    expect(balanceRead).toBeGreaterThan(inventoryLock);
    expect(movementInsert).toBeGreaterThan(balanceRead);
  });

  it("builds and validates the complete plan before applying any movement", () => {
    expect(sql).toContain("create or replace function public.build_inventory_deduction_plan");
    expect(sql).toContain("with expanded as");
    expect(sql).toContain("aggregated as");
    expect(sql).toContain("validated_plan := validated_plan || jsonb_build_array");
    expect(sql).toContain("No movement is inserted until every entry has passed this loop.");
    expect(sql).not.toMatch(/update\s+public\.inventory_items\s+set\s+current_quantity/i);
  });

  it("reuses recipe expansion, yield, ordered quantity, and the conversion engine", () => {
    expect(sql).toContain("from public.recipe_ingredients ingredient");
    expect(sql).toContain("target_recipe_yield");
    expect(sql).toMatch(/ingredient\.quantity_required\s*\n\s*\* target_item\.quantity\s*\n\s*\/ target_recipe_yield/);
    expect(sql.match(/public\.recipe_unit_conversion_ratio/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain("'source', 'recipe'");
  });

  it("supports ready-to-serve direct inventory and multiple order quantities", () => {
    expect(sql).toContain("menu.direct_inventory_item_id");
    expect(sql).toContain("'required_quantity', target_item.quantity::numeric");
    expect(sql).toContain("'source', 'direct'");
  });

  it("reuses the existing decision and negative-stock policies", () => {
    expect(sql).toContain("public.should_deduct_inventory_for_service_completion");
    expect(sql).toContain("public.get_inventory_storage_balance");
    expect(sql).toContain("raise exception 'Movement would create negative stock.'");
    expect(sql).toContain("'stock_out'::public.inventory_movement_type");
    expect(sql).toContain("The existing immutable");
  });

  it("keeps receipt and movements atomic and lets exceptions roll everything back", () => {
    const receiptInsert = sql.indexOf("insert into public.inventory_order_item_deductions");
    const movementInsert = sql.indexOf("insert into public.inventory_movements");
    expect(receiptInsert).toBeGreaterThan(-1);
    expect(movementInsert).toBeGreaterThan(receiptInsert);
    expect(sql).not.toMatch(/exception\s+when\s+others/i);
    expect(sql).not.toMatch(/\bcommit\b|\brollback\b/i);
  });

  it("uses the canonical derived kitchen batch identity instead of a nonexistent order-item column", () => {
    expect(decisionSql).not.toContain("items.kitchen_batch_key");
    expect(decisionSql).toContain("extract(epoch from items.appended_at)");
    expect(sql).toContain("extract(epoch from item.appended_at)");
  });

  it("does not add triggers or edits to workflow, routing, payment, ordering, or reports", () => {
    expect(sql).not.toMatch(/create\s+trigger/i);
    expect(sql).not.toMatch(/update\s+public\.(orders|order_items|order_invoices|kitchen_)/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.(orders|order_items|order_invoices|kitchen_)/i);
    expect(sql).not.toMatch(/pg_notify|broadcast|insert\s+into\s+public\.purchase_/i);
  });
});

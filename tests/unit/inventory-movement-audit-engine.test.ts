import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mapInventoryMovementHistoryRow } from "../../src/modules/inventory/services/movementHistoryService";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const sql = read("supabase/migrations/178_phase8_4_3_inventory_movement_audit_engine.sql");
const deductionSql = read("supabase/migrations/177_phase8_4_2_atomic_inventory_deduction_engine.sql");
const stockSql = read("supabase/migrations/159_phase8_2_stock_operations_engine.sql");

describe("Phase 8.4.3 inventory movement and audit engine", () => {
  it("enriches the existing immutable movement inside the deduction INSERT transaction", () => {
    expect(sql).toContain("alter table public.inventory_movements");
    expect(sql).toContain("create trigger inventory_movements_food_consumption_audit");
    expect(sql).toContain("before insert on public.inventory_movements");
    expect(sql).toContain("new.audit_movement_type := 'FOOD_CONSUMPTION'");
    expect(sql).not.toContain("create or replace function public.deduct_inventory_for_order_item");
    expect(sql).not.toContain("create table if not exists public.inventory_movement");
  });

  it("captures every required order, recipe, actor, workflow, and balance field", () => {
    for (const field of [
      "menu_item_id", "recipe_id", "order_id", "order_item_id", "dining_session_id",
      "kitchen_batch_id", "waiter_id", "cashier_id", "kitchen_station_id",
      "performed_by_staff_id", "quantity_before", "quantity_after", "workflow_snapshot",
    ]) expect(sql).toContain(`add column if not exists ${field}`);
    expect(sql).toContain("origin.kitchen_completed_by");
    expect(sql).toContain("origin.created_by_waiter_id");
    expect(sql).toContain("origin.cashier_staff_id");
  });

  it("rejects orphan or plan-mismatched movements and preserves exactly-once linkage", () => {
    expect(sql).toContain("from public.inventory_order_item_deductions deduction");
    expect(sql).toContain("Food consumption movement cannot be orphaned from its deduction.");
    expect(sql).toContain("Food consumption movement does not match its deduction plan.");
    expect(sql).toContain("(plan_entry->>'required_quantity')::numeric <> new.quantity");
    expect(deductionSql).toContain("inventory_movements_order_item_deduction_unique");
    expect(deductionSql).toContain("on public.inventory_movements(source_record_id, inventory_item_id)");
  });

  it("keeps movement records immutable and rollback-coupled to deduction", () => {
    expect(stockSql).toContain("before update on public.inventory_movements");
    expect(stockSql).toContain("before delete on public.inventory_movements");
    expect(stockSql).toContain("raise exception 'Inventory movements are immutable.'");
    expect(sql).not.toMatch(/\bcommit\b|\brollback\b/i);
    expect(sql).not.toMatch(/exception\s+when\s+others/i);
  });

  it("exposes only FOOD_CONSUMPTION history with strict tenant and role access", () => {
    expect(sql).toContain("create or replace function public.get_inventory_movement_history");
    expect(sql).toContain("movement.restaurant_id = target_restaurant_id");
    expect(sql).toContain("movement.audit_movement_type = 'FOOD_CONSUMPTION'");
    expect(sql).toContain("array['owner','manager','inventory_officer']");
    expect(sql).toContain("raise exception 'Inventory movement history access denied.'");
    expect(sql).toContain("revoke all on function public.get_inventory_movement_history");
    expect(sql).toContain("to authenticated");
  });

  it("does not implement other future movement audit types or touch prohibited engines", () => {
    expect(sql).not.toMatch(/audit_movement_type\s*:=\s*'(PURCHASE|TRANSFER|WASTE|MANUAL_ADJUSTMENT|OPENING_BALANCE)'/i);
    expect(sql).not.toMatch(/create or replace function public\.(resolve_order_workflow|resolve_inventory_deduction_decision|deduct_inventory)/i);
    expect(sql).not.toMatch(/update\s+public\.(orders|order_items|inventory_items|recipes|menu_items)/i);
    expect(sql).not.toMatch(/pg_notify|broadcast|purchase_order/i);
  });

  it("maps movement history records without exposing write behavior", () => {
    const movement = mapInventoryMovementHistoryRow({
      id: "movement-1", restaurant_id: "restaurant-1", inventory_item_id: "inventory-1",
      inventory_item_name: "Flour", menu_item_id: "menu-1", menu_item_name: "Bread",
      recipe_id: "recipe-1", recipe_name: "Bread recipe", order_id: "order-1",
      order_number: "ORD-10", order_item_id: "line-1", dining_session_id: "order-1",
      dining_session_number: "DIN-10", kitchen_batch_id: "initial", waiter_id: "waiter-1",
      waiter_name: "Winta", cashier_id: "cashier-1", cashier_name: "Kaleab",
      kitchen_station_id: "station-1", kitchen_station_name: "Bakery",
      performed_by_staff_id: "cook-1", performed_by_name: "Meron",
      movement_type: "FOOD_CONSUMPTION", quantity: "1.25", unit: "kg",
      quantity_before: "8.5", quantity_after: "7.25", created_at: "2026-07-25T10:00:00Z",
      workflow_snapshot: { workflow_policy_snapshot: "pay_before_kitchen" }, notes: "Consumed",
    });
    expect(movement).toMatchObject({
      movementType: "FOOD_CONSUMPTION", quantity: 1.25, quantityBefore: 8.5,
      quantityAfter: 7.25, waiterName: "Winta", cashierName: "Kaleab",
    });
  });
});

describe("Phase 8.4.3 movement history page", () => {
  const page = read("src/modules/inventory/pages/MovementHistoryPage.tsx");
  const dashboard = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
  const router = read("src/app/router/AppRouter.tsx");
  const service = read("src/modules/inventory/services/movementHistoryService.ts");

  it("routes the read-only page through the existing inventory role guard", () => {
    expect(router).toContain('"movement-history"');
    expect(dashboard).toContain('<MovementHistoryPage movements={movementHistory}');
    expect(service).toContain('supabase.rpc("get_inventory_movement_history"');
    expect(page).not.toMatch(/insert|update|delete|save movement/i);
  });

  it("shows the required columns and all requested filters", () => {
    for (const heading of [
      "Date &amp; Time", "Inventory Item", "Movement Type", "Quantity", "Unit",
      "Order Number", "Menu Item", "Recipe", "Dining Session", "Kitchen Station",
      "Performed By", "Current Stock After Movement",
    ]) expect(page).toContain(`<th>${heading}</th>`);
    for (const filter of [
      "dateFrom", "dateTo", "inventoryItemId", "menuItemId", "recipeId",
      "kitchenStationId", "movementType",
    ]) expect(page).toContain(filter);
    expect(page).toContain("Search movement history");
    expect(page).toContain("Ready-to-Serve");
  });
});

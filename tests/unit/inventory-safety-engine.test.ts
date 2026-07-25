import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mapInventoryIntegrityCheckRow } from "../../src/modules/inventory/services/inventoryIntegrityService";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const safetySql = read("supabase/migrations/180_phase8_4_5_inventory_safety_consistency_recovery_engine.sql");
const deductionSql = read("supabase/migrations/177_phase8_4_2_atomic_inventory_deduction_engine.sql");
const movementSql = read("supabase/migrations/159_phase8_2_stock_operations_engine.sql");
const panel = read("src/modules/inventory/components/InventoryIntegrityCheckPanel.tsx");
const dashboard = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
const service = read("src/modules/inventory/services/inventoryIntegrityService.ts");

describe("Phase 8.4.5 existing safety invariants", () => {
  it("retains order-item locking, stable inventory lock ordering, and full-plan validation", () => {
    expect(deductionSql).toMatch(/where item\.id = target_order_item_id\s+for update/);
    expect(deductionSql).toContain("order by locked_inventory.id");
    expect(deductionSql).toMatch(/order by locked_inventory\.id\s+for update/);
    expect(deductionSql).toContain("No movement is inserted until every entry has passed this loop.");
  });

  it("retains database idempotency and duplicate movement guards", () => {
    expect(deductionSql).toContain("order_item_id uuid primary key");
    expect(deductionSql).toContain("inventory_movements_order_item_deduction_unique");
    expect(deductionSql).toContain("on conflict (order_item_id) do nothing");
    expect(deductionSql).toContain("'status', 'already_deducted'");
  });

  it("retains atomic rollback and immutable movement protection", () => {
    expect(deductionSql).toContain("Any failure rolls back this insert and the");
    expect(deductionSql).not.toMatch(/exception\s+when\s+others/i);
    expect(deductionSql).not.toMatch(/^\s*(commit|rollback)\s*;/im);
    expect(movementSql).toContain("before update on public.inventory_movements");
    expect(movementSql).toContain("before delete on public.inventory_movements");
    expect(movementSql).toContain("Inventory movements are immutable.");
  });
});

describe("Phase 8.4.5 read-only integrity diagnostics", () => {
  it("defines every required consistency check", () => {
    for (const check of [
      "STOCK_BALANCE_MISMATCH",
      "DUPLICATE_CONSUMPTION_RECEIPTS",
      "DUPLICATE_CONSUMPTION_MOVEMENTS",
      "ORPHAN_CONSUMPTION_MOVEMENTS",
      "RECEIPT_PLAN_MOVEMENT_MISMATCH",
      "ORDER_ITEM_LINK_MISMATCH",
      "MOVEMENT_QUANTITY_MISMATCH",
    ]) expect(safetySql).toContain(`'${check}'`);
    expect(safetySql).toContain("public.get_inventory_current_stock(target_restaurant_id)");
    expect(safetySql).toContain("jsonb_array_elements(receipt.deduction_plan)");
  });

  it("is owner-only and tenant-scoped in the database", () => {
    expect(safetySql).toContain("array['owner']::public.restaurant_staff_role[]");
    expect(safetySql).toContain("Inventory integrity check access denied.");
    expect(safetySql.match(/restaurant_id = target_restaurant_id/g)?.length).toBeGreaterThanOrEqual(7);
    expect(safetySql).toContain("revoke all on function public.run_inventory_integrity_check(uuid) from public, anon");
    expect(safetySql).toContain("to authenticated");
  });

  it("contains diagnostics only and no write or repair operation", () => {
    expect(safetySql).toContain("stable");
    expect(safetySql).not.toMatch(/\binsert\s+into\b|\bupdate\s+public\.|\bdelete\s+from\b|\bcreate\s+trigger\b|\balter\s+table\b/i);
    expect(safetySql).not.toMatch(/correct_inventory|deduct_inventory_for_order_item\s*\(/i);
    expect(service).toContain('supabase.rpc("run_inventory_integrity_check"');
    expect(service).not.toContain(".from(");
  });

  it("maps PASS and detected issue responses correctly", () => {
    expect(mapInventoryIntegrityCheckRow({
      check_code: "STOCK_BALANCE_MISMATCH",
      check_name: "Inventory quantity matches movement totals",
      check_status: "PASS",
      issue_count: 0,
      details: { samples: [] },
    })).toMatchObject({ checkStatus: "PASS", issueCount: 0 });

    expect(mapInventoryIntegrityCheckRow({
      check_code: "ORPHAN_CONSUMPTION_MOVEMENTS",
      check_name: "No orphan movements",
      check_status: "DETECTED_ISSUES",
      issue_count: "2",
      details: { samples: [{ entity_id: "movement-1", detail: { movement_id: "movement-1" } }] },
    })).toMatchObject({
      checkStatus: "DETECTED_ISSUES",
      issueCount: 2,
      details: { samples: [{ entity_id: "movement-1" }] },
    });
  });
});

describe("Phase 8.4.5 owner integrity action", () => {
  it("renders the action only for the owner inventory surface", () => {
    expect(dashboard).toContain('utilityView === "settings" && staffRole === "owner"');
    expect(dashboard).toContain("<InventoryIntegrityCheckPanel restaurantId={restaurantId} />");
    expect(dashboard).toContain("Inventory integrity tools are owner-only.");
  });

  it("reports PASS or Detected Issues and never offers repair", () => {
    expect(panel).toContain('passed ? "PASS" : "Detected Issues"');
    expect(panel).toContain("Run Inventory Integrity Check");
    expect(panel).toContain("read-only diagnostics");
    expect(panel).not.toMatch(/>\s*(Repair|Fix Issues|Correct Data)\s*</i);
  });
});

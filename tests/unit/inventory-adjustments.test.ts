import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADJUSTMENT_TYPE_LABELS,
  CORRECTION_REASON_LABELS,
  correctionHistoryPresentation,
  mapInventoryAdjustmentRow,
  validCorrectionReasons,
  validateInventoryAdjustment,
} from "../../src/modules/inventory/services/inventoryAdjustmentService";
import type { InventoryCurrentStockRow, InventoryItem, InventoryStorageLocation } from "../../src/modules/inventory/types";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const sql = read("supabase/migrations/183_phase8_5_3_inventory_adjustments.sql");
const executableSql = sql.replace(/--.*$/gm, "").replace(/comment on[\s\S]*?;/gi, "");
const page = read("src/modules/inventory/pages/InventoryAdjustmentsPage.tsx");
const service = read("src/modules/inventory/services/inventoryAdjustmentService.ts");
const dashboard = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
const wastePage = read("src/modules/inventory/pages/InventoryWastePage.tsx");
const wasteService = read("src/modules/inventory/services/wasteService.ts");

const item: InventoryItem = {
  id: "item-1", restaurantId: "restaurant-1", name: "Flour", categoryId: "category-1",
  unitId: "unit-1", storageLocationId: "storage-1", preferredSupplierId: null,
  sku: null, barcode: null, minimumStock: 0, maximumStock: null, purchasePrice: 0,
  description: null, status: "active", createdByStaffId: null, updatedByStaffId: null,
  createdAt: "", updatedAt: "",
};

const stock: InventoryCurrentStockRow = {
  inventoryItemId: item.id, itemName: item.name, categoryId: item.categoryId,
  categoryName: "Dry Goods", storageLocationId: item.storageLocationId,
  storageLocationName: "Main Store", unitId: item.unitId, unitName: "kg",
  minimumStock: 0, maximumStock: null, currentQuantity: 10,
  stockStatus: "in_stock", lastMovementAt: null,
};
const storageLocation: InventoryStorageLocation = {
  id: item.storageLocationId, restaurantId: item.restaurantId, name: "Main Store",
  description: null, status: "active", createdAt: "", updatedAt: "",
};

describe("Phase 8.5.3 inventory adjustment database", () => {
  it("creates immutable tenant-scoped adjustment and item records", () => {
    expect(sql).toContain("create table if not exists public.inventory_adjustments");
    expect(sql).toContain("create table if not exists public.inventory_adjustment_items");
    expect(sql).toContain("Confirmed inventory adjustments are immutable.");
    expect(sql).toContain("inventory_adjustments_created_by_restaurant_fk");
    expect(sql).toContain("inventory_adjustments_approved_by_restaurant_fk");
    expect(sql).toContain("inventory_adjustment_items_inventory_restaurant_fk");
  });

  it("supports every required increase and decrease reason", () => {
    for (const type of [
      "opening_stock", "manual_correction", "donation_received", "supplier_replacement",
      "waste", "spoilage", "expired", "breakage", "theft", "returned_to_supplier",
    ]) expect(sql).toContain(`'${type}'`);
    expect(sql).toContain("inventory_adjustments_direction_type_check");
  });

  it("reuses the existing movement ledger with the required audit classifications", () => {
    for (const movement of [
      "MANUAL_ADJUSTMENT_IN", "MANUAL_ADJUSTMENT_OUT", "WASTE",
      "SPOILAGE", "RETURN_TO_SUPPLIER",
    ]) expect(sql).toContain(`'${movement}'`);
    expect(sql).toContain("insert into public.inventory_movements");
    expect(sql).not.toContain("create table if not exists public.inventory_adjustment_movements");
    expect(sql).toContain("'adjustment_increase'::public.inventory_movement_type");
    expect(sql).toContain("'adjustment_decrease'::public.inventory_movement_type");
  });

  it("increases and decreases current quantity only inside the confirmation transaction", () => {
    expect(sql).toContain("create or replace function public.confirm_inventory_adjustment");
    expect(sql).toContain("item.current_quantity + line.quantity");
    expect(sql).toContain("item.current_quantity - line.quantity");
    expect(sql).toContain("set current_quantity = (plan_entry->>'quantity_after')::numeric");
    expect(sql.indexOf("adjustment_plan is null")).toBeLessThan(sql.indexOf("insert into public.inventory_adjustments"));
    expect(sql).not.toMatch(/^\s*(commit|rollback)\s*;/im);
  });

  it("prevents negative stock and invalid, inactive, deleted, or cross-tenant items", () => {
    expect(sql).toContain("quantity <= 0");
    expect(sql).toContain("quantity_after')::numeric < 0");
    expect(sql).toContain("existing negative-stock policy");
    expect(sql).toContain("item.restaurant_id = target_restaurant_id");
    expect(sql).toContain("item.status = 'active'");
    expect(sql).toContain("item.active = true");
  });

  it("is idempotent, row locked, concurrency safe, and rollback safe", () => {
    expect(sql).toContain("inventory_adjustments_idempotency_unique");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("'already_processed', true");
    expect(sql).toContain("order by item.id");
    expect(sql).toContain("for update of item");
    expect(sql).toContain("inventory_movements_adjustment_item_unique");
    expect(service).toContain("sessionStorage.getItem");
    expect(service).toContain("stored.request === request");
  });

  it("permits only inventory administrators to create while tenant staff are read only", () => {
    expect(sql).toContain("public.inventory_admin_has_access(target_restaurant_id)");
    expect(sql).toContain("public.inventory_adjustment_can_read(target_restaurant_id)");
    expect(sql).toContain("staff.user_id = auth.uid()");
    expect(sql).toContain("revoke all on public.inventory_adjustments from public, anon, authenticated");
  });

  it("contains no out-of-scope business systems", () => {
    expect(executableSql).not.toMatch(/purchase_order|supplier_payment|accounting|forecast|menu_item|kitchen_|cashier|waiter|super_admin|financial_report/i);
  });
});

describe("Inventory correction and waste workflow separation", () => {
  it("offers correction-only reasons for increases and decreases", () => {
    expect(validCorrectionReasons("increase")).toEqual([
      "opening_stock", "manual_correction", "stock_count_difference", "data_entry_correction", "other_correction",
    ]);
    expect(validCorrectionReasons("decrease")).toEqual([
      "manual_correction", "stock_count_difference", "data_entry_correction", "other_correction",
    ]);
    for (const reasons of [validCorrectionReasons("increase"), validCorrectionReasons("decrease")]) {
      expect(reasons).not.toEqual(expect.arrayContaining(["waste", "spoilage", "expired", "donation_received"]));
    }
    for (const correctionReason of validCorrectionReasons("decrease")) {
      expect(validateInventoryAdjustment({
        direction: "decrease", correctionReason, notes: "Reviewed",
        lines: [{ inventoryItemId: item.id, storageLocationId: storageLocation.id, quantity: "2" }],
      }, [item], [stock], [storageLocation])).toEqual([]);
    }
    expect(CORRECTION_REASON_LABELS.stock_count_difference).toBe("Stock Count Difference");
  });

  it("rejects zero, negative, excessive, duplicate, inactive, and invalid-direction lines", () => {
    const errors = validateInventoryAdjustment({
      direction: "decrease", correctionReason: "opening_stock", notes: "",
      lines: [
        { inventoryItemId: item.id, storageLocationId: storageLocation.id, quantity: "0" },
        { inventoryItemId: item.id, storageLocationId: storageLocation.id, quantity: "11" },
        { inventoryItemId: "deleted", storageLocationId: "cross-tenant", quantity: "-1" },
      ],
    }, [item], [stock], [storageLocation]).join(" ");
    expect(errors).toMatch(/valid reason|greater than zero|duplicated|exceeds current stock|active inventory item/i);
  });

  it("maps adjustment history and immutable movement snapshots", () => {
    const mapped = mapInventoryAdjustmentRow({
      id: "adjustment-1", restaurant_id: "restaurant-1", direction: "decrease",
      adjustment_type: "waste", reason: "Waste", status: "confirmed",
      created_by: "staff-1", created_by_name: "Manager", approved_by: "staff-1",
      approved_by_name: "Manager", created_at: "2026-07-26T12:00:00Z",
      item_count: "1", total_quantity: "2", items: [{
        id: "line-1", inventory_item_id: item.id, inventory_item_name: item.name,
        unit_id: item.unitId, unit_name: "kg", quantity: "2", quantity_before: "10",
        quantity_after: "8", movement_audit_type: "WASTE", movement_id: "movement-1",
      }],
    });
    expect(mapped).toMatchObject({ adjustmentType: "waste", status: "confirmed", totalQuantity: 2 });
    expect(mapped.items[0]).toMatchObject({ quantityBefore: 10, quantityAfter: 8, movementAuditType: "WASTE" });
    expect(ADJUSTMENT_TYPE_LABELS.returned_to_supplier).toBe("Returned to Supplier");
  });

  it("preserves a specific correction reason in immutable audit notes", () => {
    const mapped = mapInventoryAdjustmentRow({
      adjustment_type: "manual_correction", reason: "Manual Correction",
      notes: "Correction reason: Data Entry Correction\nCount sheet typo", items: [],
    });
    expect(correctionHistoryPresentation(mapped)).toEqual({ reason: "Data Entry Correction", note: "Count sheet typo" });
  });

  it("implements a compact single-material adjustment review without operational-loss language", () => {
    for (const marker of [
      "Create Adjustment", "Increase", "Decrease", "Reason", "Note",
      "Review Adjustment", "Confirm Adjustment", "Adjustment history",
      "Search", "Date From", "Date To", "Status", "Material", "Current → After",
    ]) expect(page).toContain(marker);
    for (const excluded of ["Operational Stock Control", "Add Ingredient", "Donation Received", "Supplier Replacement", "Preparation Waste", "Spillage"]) expect(page).not.toContain(excluded);
    expect(page).toContain("canCreate");
    expect(page).toContain('staffRole');
    expect(dashboard).toContain("<InventoryAdjustmentsPage");
    expect(dashboard).toContain('section === "adjustments" ? adjustments');
  });

  it("routes Waste to its dedicated one-decrease workflow", () => {
    expect(dashboard).toContain("<InventoryWastePage");
    expect(dashboard).toContain('section === "waste" ? waste');
    for (const field of ["Material *", "Storage *", "Quantity *", "Reason *", "Note", "Available → After waste", "Record Waste"]) expect(wastePage).toContain(field);
    for (const reason of ["Spoilage", "Expired", "Damaged", "Preparation Waste", "Spillage", "Contamination", "Other Waste"]) expect(wastePage).toContain(reason);
    expect(wastePage).not.toContain("Adjustment direction");
    expect(wastePage).not.toContain(">Increase<");
    expect(wastePage).not.toContain(">Decrease<");
    expect(wastePage).toContain("submissionInFlight.current");
    expect(wasteService.match(/recordInventoryWaste\(/g)).toHaveLength(1);
    expect(wastePage).toContain('entry.movementType === "waste" || entry.movementType === "spoilage"');
  });
});

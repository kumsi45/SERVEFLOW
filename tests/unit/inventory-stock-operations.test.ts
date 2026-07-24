import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  validateAdjustmentDraft,
  validateOpeningBalanceDraft,
  validateStockMovementDraft,
  validateTransferDraft,
  validateWasteDraft,
  type StockValidationContext,
} from "../../src/modules/inventory/services/stockOperationValidation";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const context: StockValidationContext = {
  categories: [
    { id: "cat-a", restaurantId: "r1", name: "Dry Goods", description: null, sortOrder: 1, status: "active", createdAt: "", updatedAt: "" },
  ],
  suppliers: [
    { id: "sup-a", restaurantId: "r1", name: "Metro Foods", phone: null, address: null, contactPerson: null, notes: null, status: "active", createdAt: "", updatedAt: "" },
  ],
  storageLocations: [
    { id: "store-a", restaurantId: "r1", name: "Main Store", description: null, status: "active", createdAt: "", updatedAt: "" },
    { id: "store-b", restaurantId: "r1", name: "Cold Room", description: null, status: "active", createdAt: "", updatedAt: "" },
    { id: "store-x", restaurantId: "r2", name: "Other Store", description: null, status: "active", createdAt: "", updatedAt: "" },
  ],
  units: [
    { id: "unit-a", restaurantId: "r1", name: "kg", description: null, status: "active", createdAt: "", updatedAt: "" },
  ],
  items: [
    {
      id: "item-a",
      restaurantId: "r1",
      name: "Flour",
      categoryId: "cat-a",
      unitId: "unit-a",
      storageLocationId: "store-a",
      preferredSupplierId: "sup-a",
      sku: null,
      barcode: null,
      minimumStock: 2,
      maximumStock: 20,
      description: null,
      status: "active",
      createdByStaffId: null,
      updatedByStaffId: null,
      createdAt: "",
      updatedAt: "",
    },
    {
      id: "item-b",
      restaurantId: "r2",
      name: "Foreign Flour",
      categoryId: "cat-a",
      unitId: "unit-a",
      storageLocationId: "store-x",
      preferredSupplierId: null,
      sku: null,
      barcode: null,
      minimumStock: 0,
      maximumStock: null,
      description: null,
      status: "active",
      createdByStaffId: null,
      updatedByStaffId: null,
      createdAt: "",
      updatedAt: "",
    },
  ],
  staffNames: {},
  currentStock: [
    {
      inventoryItemId: "item-a",
      itemName: "Flour",
      categoryId: "cat-a",
      categoryName: "Dry Goods",
      storageLocationId: "store-a",
      storageLocationName: "Main Store",
      unitId: "unit-a",
      unitName: "kg",
      minimumStock: 2,
      maximumStock: 20,
      currentQuantity: 5,
      stockStatus: "in_stock",
      lastMovementAt: "2026-07-24T08:00:00Z",
    },
  ],
};

describe("Phase 8.2 stock operation database contracts", () => {
  const sql = read("supabase/migrations/159_phase8_2_stock_operations_engine.sql");

  it("keeps a single immutable movement ledger with all supported movement types", () => {
    expect(sql).toContain("create type public.inventory_movement_type as enum");
    for (const movement of [
      "opening_balance",
      "stock_in",
      "stock_out",
      "transfer_in",
      "transfer_out",
      "adjustment_increase",
      "adjustment_decrease",
      "waste",
      "spoilage",
      "manual_correction",
      "closing_balance",
    ]) {
      expect(sql).toContain(`'${movement}'`);
    }
    expect(sql).toContain("create table if not exists public.inventory_movements");
    expect(sql).toContain("before update on public.inventory_movements");
    expect(sql).toContain("before delete on public.inventory_movements");
    expect(sql).toContain("raise exception 'Inventory movements are immutable.'");
  });

  it("derives balances from signed movements and never writes an item balance column", () => {
    expect(sql).toContain("public.inventory_movement_signed_quantity");
    expect(sql).toContain("sum(public.inventory_movement_signed_quantity(m.quantity, m.quantity_effect))");
    expect(sql).toContain("public.get_inventory_current_stock");
    expect(sql).not.toMatch(/update\s+public\.inventory_items\s+set\s+current_quantity/i);
  });

  it("enforces tenant-safe references, RLS, and role-gated RPC access", () => {
    for (const constraint of [
      "inventory_movements_item_restaurant_fk",
      "inventory_movements_storage_restaurant_fk",
      "inventory_movements_unit_restaurant_fk",
      "inventory_movements_supplier_restaurant_fk",
      "inventory_movements_staff_restaurant_fk",
    ]) {
      expect(sql).toContain(constraint);
    }
    expect(sql).toContain("alter table public.inventory_movements enable row level security");
    expect(sql).toContain("public.inventory_admin_has_access(restaurant_id)");
    expect(sql).toContain("public.inventory_admin_actor(target_restaurant_id)");
    expect(sql).toContain("revoke all on public.inventory_movements from public, anon");
  });

  it("records transfers as one balanced pair and guards duplicates", () => {
    expect(sql).toContain("record_inventory_transfer");
    expect(sql).toContain("'transfer_out', target_quantity, 'out'");
    expect(sql).toContain("'transfer_in', target_quantity, 'in'");
    expect(sql).toContain("inventory_movements_transfer_pair");
    expect(sql).toContain("Duplicate transfer reference.");
    expect(sql).toContain("Transfer would create negative stock.");
  });

  it("exposes dedicated RPCs for stock, ledger, adjustment, waste, and opening balance", () => {
    for (const rpc of [
      "record_inventory_movement",
      "record_inventory_transfer",
      "record_inventory_adjustment",
      "record_inventory_waste",
      "record_inventory_opening_balance",
      "get_inventory_balances",
      "get_inventory_ledger",
      "get_inventory_item_ledger",
      "get_inventory_current_stock",
    ]) {
      expect(sql).toContain(`public.${rpc}`);
      expect(sql).toContain(`grant execute on function public.${rpc}`);
    }
  });
});

describe("Phase 8.2 stock operation validation", () => {
  it("prevents zero, negative, and cross-restaurant stock movement inputs", () => {
    const invalid = validateStockMovementDraft({
      inventoryItemId: "item-b",
      storageLocationId: "store-x",
      movementType: "stock_out",
      quantity: "0",
      quantityEffect: "out",
      supplierId: "sup-missing",
      referenceNumber: "",
      invoiceNumber: "",
      reason: "",
      notes: "",
      movementDate: "",
    }, context, "r1");
    expect(invalid.errors).toEqual(expect.arrayContaining([
      "Movement quantity must be greater than zero.",
      "Selected inventory item is invalid.",
      "Selected storage location is invalid.",
      "Selected supplier is invalid.",
    ]));
  });

  it("prevents outgoing movements that would make stock negative", () => {
    const invalid = validateStockMovementDraft({
      inventoryItemId: "item-a",
      storageLocationId: "store-a",
      movementType: "stock_out",
      quantity: "6",
      quantityEffect: "out",
      supplierId: "",
      referenceNumber: "",
      invoiceNumber: "",
      reason: "",
      notes: "",
      movementDate: "",
    }, context, "r1");
    expect(invalid.errors).toContain("Movement would create negative stock.");
  });

  it("requires reasons for adjustments and waste", () => {
    expect(validateAdjustmentDraft({
      inventoryItemId: "item-a",
      storageLocationId: "store-a",
      direction: "decrease",
      quantity: "1",
      reason: "",
      notes: "",
      movementDate: "",
    }, context, "r1").errors).toContain("Adjustment reason is required.");

    expect(validateWasteDraft({
      inventoryItemId: "item-a",
      storageLocationId: "store-a",
      quantity: "1",
      reason: "",
      isSpoilage: false,
      notes: "",
      movementDate: "",
    }, context, "r1").errors).toContain("Waste reason is required.");
  });

  it("validates transfer locations, available source stock, and opening balance uniqueness", () => {
    expect(validateTransferDraft({
      inventoryItemId: "item-a",
      fromStorageLocationId: "store-a",
      toStorageLocationId: "store-a",
      quantity: "1",
      referenceNumber: "",
      reason: "",
      notes: "",
      movementDate: "",
    }, context, "r1").errors).toContain("Transfer locations must be different.");

    expect(validateTransferDraft({
      inventoryItemId: "item-a",
      fromStorageLocationId: "store-a",
      toStorageLocationId: "store-b",
      quantity: "8",
      referenceNumber: "",
      reason: "",
      notes: "",
      movementDate: "",
    }, context, "r1").errors).toContain("Movement would create negative stock.");

    expect(validateOpeningBalanceDraft({
      inventoryItemId: "item-a",
      storageLocationId: "store-a",
      quantity: "3",
      referenceNumber: "",
      notes: "",
      movementDate: "",
    }, context, "r1").errors).toContain("Opening balance can only be recorded before other movements.");
  });
});

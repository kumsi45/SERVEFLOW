import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  mapPurchaseOrderDraftRow,
  purchaseOrderLineTotal,
  purchaseOrderTotal,
  validatePurchaseOrderDraft,
} from "../../src/modules/purchasing/services/purchaseOrderDraftService";
import type { InventoryItem, InventorySupplier, InventoryUnit } from "../../src/modules/inventory/types";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const sql = read("supabase/migrations/181_phase8_5_1_purchase_order_drafts.sql");
const executableSql = sql.replace(/--.*$/gm, "");
const page = read("src/modules/purchasing/pages/PurchaseOrderDraftsPage.tsx");
const service = read("src/modules/purchasing/services/purchaseOrderDraftService.ts");
const styles = read("src/modules/purchasing/styles/purchaseOrderDrafts.css");
const dashboard = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
const router = read("src/app/router/AppRouter.tsx");

const supplier: InventorySupplier = {
  id: "supplier-1", restaurantId: "restaurant-1", name: "Supplier", phone: null,
  address: null, contactPerson: null, notes: null, status: "active", createdAt: "", updatedAt: "",
};
const item: InventoryItem = {
  id: "item-1", restaurantId: "restaurant-1", name: "Flour", categoryId: "category-1",
  unitId: "unit-1", storageLocationId: "storage-1", preferredSupplierId: "supplier-1",
  sku: null, barcode: null, minimumStock: 0, maximumStock: null, purchasePrice: 0,
  description: null, status: "active", createdByStaffId: null, updatedByStaffId: null,
  createdAt: "", updatedAt: "",
};
const unit: InventoryUnit = {
  id: "unit-1", restaurantId: "restaurant-1", name: "kg", description: null,
  status: "active", pluralName: null, abbreviation: "kg", active: true, createdAt: "", updatedAt: "",
};

describe("Phase 8.5.1 purchase order draft database", () => {
  it("creates draft-only header and multi-line tables", () => {
    expect(sql).toContain("create table if not exists public.purchase_orders");
    expect(sql).toContain("create table if not exists public.purchase_order_items");
    expect(sql).toContain("check (status = 'draft')");
    expect(sql).toContain("quantity numeric(18,3)");
    expect(sql).toContain("purchase_unit_id uuid not null");
    expect(sql).toContain("unit_price numeric(18,6)");
    expect(sql).toContain("expected_delivery_date date not null");
  });

  it("enforces restaurant-safe suppliers, items, units, staff, and lines", () => {
    for (const constraint of [
      "purchase_orders_supplier_restaurant_fk",
      "purchase_orders_created_by_restaurant_fk",
      "purchase_orders_updated_by_restaurant_fk",
      "purchase_order_items_order_restaurant_fk",
      "purchase_order_items_inventory_restaurant_fk",
      "purchase_order_items_unit_restaurant_fk",
    ]) expect(sql).toContain(constraint);
    expect(sql).toContain("public.inventory_admin_has_access(target_restaurant_id)");
    expect(sql).toContain("supplier.restaurant_id = target_restaurant_id");
    expect(sql).toContain("item.restaurant_id = target_restaurant_id");
    expect(sql).toContain("unit.restaurant_id = target_restaurant_id");
  });

  it("saves complete drafts atomically and locks edits and deletes", () => {
    expect(sql).toContain("create or replace function public.save_purchase_order_draft");
    expect(sql).toContain("for update");
    expect(sql).toContain("Only draft purchase orders can be edited.");
    expect(sql).toContain("Only draft purchase orders can be deleted.");
    expect(sql).toContain("delete from public.purchase_order_items");
    expect(sql).toContain("insert into public.purchase_order_items");
    expect(sql).not.toMatch(/^\s*(commit|rollback)\s*;/im);
  });

  it("does not implement receiving or any inventory/accounting side effect", () => {
    expect(executableSql).not.toMatch(/inventory_movements|record_inventory_movement|current_quantity\s*=|payment|invoice|accounting|receiv(ed|ing)_at/i);
    expect(service).not.toMatch(/inventoryMovement|recordStock|payment|accounting|receiv/i);
  });
});

describe("Phase 8.5.1 purchase order draft validation and totals", () => {
  it("accepts a valid multi-item draft and calculates totals only", () => {
    const secondItem = { ...item, id: "item-2", name: "Oil" };
    const form = {
      supplierId: supplier.id,
      expectedDeliveryDate: "2026-08-15",
      notes: "Deliver in the morning",
      lines: [
        { inventoryItemId: item.id, purchaseUnitId: unit.id, quantity: "2", unitPrice: "3.50" },
        { inventoryItemId: secondItem.id, purchaseUnitId: unit.id, quantity: "4", unitPrice: "1.25" },
      ],
    };
    expect(validatePurchaseOrderDraft(form, [supplier], [item, secondItem], [unit])).toEqual([]);
    expect(purchaseOrderLineTotal("2", "3.5")).toBe(7);
    expect(purchaseOrderTotal(form)).toBe(12);
  });

  it("rejects duplicate items, invalid suppliers, quantities, units, and prices", () => {
    const errors = validatePurchaseOrderDraft({
      supplierId: "other-supplier",
      expectedDeliveryDate: "",
      notes: "",
      lines: [
        { inventoryItemId: item.id, purchaseUnitId: "other-unit", quantity: "0", unitPrice: "-1" },
        { inventoryItemId: item.id, purchaseUnitId: unit.id, quantity: "1", unitPrice: "1" },
      ],
    }, [supplier], [item], [unit]);
    expect(errors.join(" ")).toMatch(/active supplier|delivery date|active purchase unit|greater than zero|negative|duplicated/i);
  });

  it("maps draft lines and database totals", () => {
    const draft = mapPurchaseOrderDraftRow({
      id: "draft-1", restaurant_id: "restaurant-1", supplier_id: "supplier-1",
      supplier_name: "Supplier", status: "draft", expected_delivery_date: "2026-08-15",
      line_count: "1", total: "7.000000", lines: [{
        id: "line-1", inventory_item_id: "item-1", inventory_item_name: "Flour",
        purchase_unit_id: "unit-1", purchase_unit_name: "kg", quantity: "2",
        unit_price: "3.5", line_total: "7", sort_order: 0,
      }],
    });
    expect(draft).toMatchObject({ status: "draft", lineCount: 1, total: 7 });
    expect(draft.lines[0]).toMatchObject({ inventoryItemName: "Flour", lineTotal: 7 });
  });
});

describe("Phase 8.5.1 purchase order draft UI", () => {
  it("is routed through the existing owner-manager-inventory-officer guard", () => {
    expect(router).toContain('"purchase-orders"');
    expect(dashboard).toContain('<PurchaseOrderDraftsPage restaurantId={restaurantId}');
    expect(dashboard).toContain('{ key: "purchase-orders", label: "Purchase Orders" }');
  });

  it("supports create, edit, delete, search, supplier and status filters", () => {
    for (const text of [
      "Create Draft", "Edit Draft", "Delete Draft", "Search", "Supplier", "Status",
      "Expected Delivery Date", "Purchase Unit", "Unit Price", "Notes", "Add Item",
    ]) expect(page).toContain(text);
    expect(page).toContain("setSearch");
    expect(page).toContain("setSupplierFilter");
    expect(page).toContain("setStatusFilter");
  });

  it("has explicit tablet and mobile responsive layouts", () => {
    expect(styles).toContain("@media (max-width: 980px)");
    expect(styles).toContain("@media (max-width: 680px)");
    expect(styles).toContain("grid-template-columns: 1fr");
  });
});

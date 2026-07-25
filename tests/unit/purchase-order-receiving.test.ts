import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  mapPurchaseOrderDraftRow,
  validatePurchaseOrderReceipt,
} from "../../src/modules/purchasing/services/purchaseOrderDraftService";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const sql = read("supabase/migrations/182_phase8_5_2_purchase_order_receiving.sql");
const page = read("src/modules/purchasing/pages/PurchaseOrderDraftsPage.tsx");
const service = read("src/modules/purchasing/services/purchaseOrderDraftService.ts");

describe("Phase 8.5.2 purchase receipt database", () => {
  it("supports draft, partial, and completed status with remaining quantities", () => {
    expect(sql).toContain("'draft', 'partially_received', 'completed'");
    expect(sql).toContain("received_quantity numeric(18,3)");
    expect(sql).toContain("received_quantity >= 0 and received_quantity <= quantity");
    expect(sql).toContain("'remaining_quantity', line.quantity - line.received_quantity");
  });

  it("locks the order, selected lines, and inventory in a stable order", () => {
    expect(sql).toContain("create or replace function public.receive_purchase_order");
    expect(sql.match(/for update/gi)?.length).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("order by line.id");
    expect(sql).toContain("order by item.id");
    expect(sql).toContain("receipt_plan jsonb");
    expect(sql).toContain("jsonb_array_length(receipt_plan) <> jsonb_array_length(target_lines)");
    expect(sql).not.toMatch(/^\s*(commit|rollback)\s*;/im);
  });

  it("is idempotent and prevents duplicate receipt movements", () => {
    expect(sql).toContain("purchase_order_receipts_idempotency_unique");
    expect(sql).toContain("where receipt.restaurant_id = target_restaurant_id");
    expect(sql).toContain("'already_processed', true");
    expect(sql).toContain("inventory_movements_purchase_receipt_item_unique");
    expect(service).toContain("sessionStorage.getItem");
    expect(service).toContain("sessionStorage.removeItem");
  });

  it("atomically increases stock and creates one immutable PURCHASE_RECEIPT movement", () => {
    expect(sql).toContain("update public.inventory_items");
    expect(sql).toContain("set current_quantity = after_quantity");
    expect(sql).toContain("insert into public.inventory_movements");
    expect(sql).toContain("'purchase_order_receipt'");
    expect(sql).toContain("new.audit_movement_type := 'PURCHASE_RECEIPT'");
    expect(sql).toContain("Purchase receipt history is immutable.");
    expect(sql).toContain("Purchase receipt movement does not match its immutable receipt item.");
  });

  it("preserves purchase prices and reuses the existing unit conversion engine", () => {
    expect(sql).toContain("purchase_unit_price numeric(18,6)");
    expect(sql).toContain("inventory_unit_price numeric(24,9)");
    expect(sql).toContain("line.unit_price");
    expect(sql).toContain("public.recipe_unit_conversion_ratio(purchase_unit.name, inventory_unit.name)");
  });

  it("enforces restaurant ownership through composite keys and access checks", () => {
    for (const marker of [
      "purchase_order_receipts_order_restaurant_fk",
      "purchase_order_receipts_staff_restaurant_fk",
      "purchase_order_receipt_items_receipt_restaurant_fk",
      "purchase_order_receipt_items_order_line_restaurant_fk",
      "purchase_order_receipt_items_inventory_restaurant_fk",
      "public.inventory_admin_has_access(target_restaurant_id)",
    ]) expect(sql).toContain(marker);
  });

  it("does not introduce returns, payments, accounting, or reports", () => {
    const executable = sql.replace(/--.*$/gm, "").replace(/comment on[\s\S]*?;/gi, "");
    expect(executable).not.toMatch(/supplier_payment|accounts?_payable|purchase_return|return_purchase|financial_report/i);
  });
});

describe("Phase 8.5.2 receiving validation and UI", () => {
  const form = {
    purchaseOrderId: "po-1",
    notes: "Two boxes arrived",
    lines: [{
      purchaseOrderItemId: "line-1",
      inventoryItemName: "Flour",
      purchaseUnitName: "kg",
      remainingQuantity: 8,
      receivedQuantity: "3.5",
    }],
  };

  it("accepts partial receipt quantities", () => {
    expect(validatePurchaseOrderReceipt(form)).toEqual([]);
  });

  it("rejects empty, excessive, negative, and over-precision quantities", () => {
    expect(validatePurchaseOrderReceipt({ ...form, lines: [{ ...form.lines[0], receivedQuantity: "" }] }).join(" ")).toMatch(/at least one/i);
    expect(validatePurchaseOrderReceipt({ ...form, lines: [{ ...form.lines[0], receivedQuantity: "9" }] }).join(" ")).toMatch(/exceeds/i);
    expect(validatePurchaseOrderReceipt({ ...form, lines: [{ ...form.lines[0], receivedQuantity: "-1" }] }).join(" ")).toMatch(/at least one|invalid/i);
    expect(validatePurchaseOrderReceipt({ ...form, lines: [{ ...form.lines[0], receivedQuantity: "1.2345" }] }).join(" ")).toMatch(/decimal/i);
  });

  it("maps database receipt progress and statuses", () => {
    const order = mapPurchaseOrderDraftRow({
      id: "po-1", restaurant_id: "restaurant-1", supplier_id: "supplier-1",
      supplier_name: "Supplier", status: "partially_received", total: "100",
      received_total: "40", remaining_total: "60", line_count: 1,
      lines: [{
        id: "line-1", inventory_item_id: "item-1", inventory_item_name: "Flour",
        purchase_unit_id: "unit-1", purchase_unit_name: "kg", quantity: "10",
        received_quantity: "4", remaining_quantity: "6", unit_price: "10",
        line_total: "100", sort_order: 0,
      }],
    });
    expect(order).toMatchObject({ status: "partially_received", total: 100, receivedTotal: 40, remainingTotal: 60 });
    expect(order.lines[0]).toMatchObject({ receivedQuantity: 4, remainingQuantity: 6 });
  });

  it("exposes partial and full receiving without unrelated purchasing features", () => {
    for (const marker of ["Receive", "Receive Now", "Receive Remaining", "Confirm Receipt", "Partially Received", "Completed"]) {
      expect(page).toContain(marker);
    }
    expect(page).not.toMatch(/supplier payment|accounting|purchase return/i);
  });
});

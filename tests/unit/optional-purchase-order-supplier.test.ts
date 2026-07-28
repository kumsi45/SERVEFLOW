import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validatePurchaseOrderDraft } from "../../src/modules/purchasing/services/purchaseOrderDraftService";

const page = readFileSync("src/modules/purchasing/pages/PurchaseOrderDraftsPage.tsx", "utf8");
const service = readFileSync("src/modules/purchasing/services/purchaseOrderDraftService.ts", "utf8");
const migration = readFileSync("supabase/migrations/192_optional_purchase_order_supplier.sql", "utf8");

describe("optional purchase order supplier", () => {
  it("accepts a valid purchase draft without a supplier", () => {
    const errors = validatePurchaseOrderDraft({ supplierId: "", expectedDeliveryDate: "2026-08-01", notes: "", lines: [{ inventoryItemId: "item-1", purchaseUnitId: "unit-1", quantity: "2", unitPrice: "3" }] }, [], [{ id: "item-1", status: "active" } as never], [{ id: "unit-1", status: "active", active: true } as never]);
    expect(errors).toEqual([]);
  });

  it("keeps validation when a supplier is selected", () => {
    const errors = validatePurchaseOrderDraft({ supplierId: "missing", expectedDeliveryDate: "2026-08-01", notes: "", lines: [{ inventoryItemId: "item-1", purchaseUnitId: "unit-1", quantity: "2", unitPrice: "3" }] }, [], [{ id: "item-1", status: "active" } as never], [{ id: "unit-1", status: "active", active: true } as never]);
    expect(errors).toContain("Select an active supplier.");
  });

  it("marks the field optional and sends null when omitted", () => {
    expect(page).toContain("Supplier <span>(Optional)</span>");
    expect(page).toContain('<option value="">No supplier</option>');
    expect(service).toContain("supplier_id: form.supplierId || null");
  });

  it("makes the database and read paths supplier-optional", () => {
    expect(migration).toContain("alter column supplier_id drop not null");
    expect(migration).toContain("target_supplier_id is not null and not exists");
    expect(migration).toContain("left join public.inventory_suppliers supplier");
  });
});

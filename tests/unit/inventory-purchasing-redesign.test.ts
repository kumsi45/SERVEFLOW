import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sortPurchaseOrders } from "../../src/modules/purchasing/pages/PurchaseOrderDraftsPage";
import type { PurchaseOrderDraft } from "../../src/modules/purchasing/types";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/purchasing/pages/PurchaseOrderDraftsPage.tsx");
const suppliers = read("src/modules/inventory/components/InventorySuppliersWorkspace.tsx");
const inventoryPage = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
const supplierForm = inventoryPage.slice(inventoryPage.indexOf("function SupplierForm"), inventoryPage.indexOf("function SimpleForm"));
const service = read("src/modules/purchasing/services/purchaseOrderDraftService.ts");
const receiptSql = read("supabase/migrations/182_phase8_5_2_purchase_order_receiving.sql");
const officerSql = read("supabase/migrations/160_inventory_officer_role.sql");

const order = (id: string, updatedAt: string) => ({ id, updatedAt } as PurchaseOrderDraft);

describe("Inventory Purchasing mobile-first redesign", () => {
  it("starts with active work and maps real statuses without changing backend values", () => {
    expect(page).toContain('useState<WorkTab>("open")');
    expect(page).toContain('status === "draft" ? "Open"');
    for (const status of ["draft", "partially_received", "completed"]) expect(page).toContain(status);
    expect(page).toContain("count > 0 && <span>{count}</span>");
  });

  it("orders each workflow by real update timestamps newest first", () => {
    expect(sortPurchaseOrders([order("old", "2026-08-20T10:00:00Z"), order("new", "2026-08-23T10:00:00Z")]).map((row) => row.id)).toEqual(["new", "old"]);
    expect(page).toContain("new Date(right.updatedAt).getTime()");
  });

  it("keeps cards compact and moves line detail and activity behind View Order", () => {
    for (const label of ["Materials", "Order total", "Received value", "Remaining value", "View Order"]) expect(page).toContain(label);
    expect(page).toContain("po-detail-lines");
    expect(page).toContain("<summary>Activity</summary>");
    expect(page).not.toContain("Updated By");
    expect(page).not.toContain("Delete Draft");
  });

  it("shows canonical receipt quantities and configured storage without duplicate document fields", () => {
    for (const label of ["Ordered", "Already received", "Remaining", "Receiving now", "Confirm Receipt", "storageLocationName"]) expect(page).toContain(label);
    expect(page).not.toContain("Receipt Notes");
    expect(page).not.toContain("Invoice number");
    expect(inventoryPage).toContain("storageLocations={data.storageLocations}");
  });

  it("preserves atomic, idempotent, tenant-scoped PO receipt provenance", () => {
    expect(service).toContain('supabase.rpc("receive_purchase_order"');
    for (const marker of ["target_restaurant_id", "purchase_order_receipts_idempotency_unique", "inventory_movements_purchase_receipt_item_unique", "'purchase_order_receipt'", "for update"]) expect(receiptSql).toContain(marker);
    expect(receiptSql).toContain("purchase_order.restaurant_id = target_restaurant_id");
  });

  it("uses sparse supplier cards and generic material terminology", () => {
    for (const label of ["Add Supplier", "Contact:", "Supplies", "material", "Edit"]) expect(suppliers).toContain(label);
    for (const noise of ["No contact person", "Not set", "None", "Supplied Ingredients", "Soft Delete", ">Archive</button>", "Restore"]) expect(suppliers).not.toContain(noise);
    expect(inventoryPage).toContain("ia-supplier-form");
    expect(supplierForm).not.toContain("Notes");
  });

  it("uses safe operator-facing loading errors", () => {
    expect(page).toContain("Unable to load purchase orders. Try again.");
    expect(page).not.toContain("loadError instanceof Error ? loadError.message");
  });

  it("documents the existing supplier lifecycle authorization gap without weakening it", () => {
    expect(officerSql).toContain("'owner', 'manager', 'inventory_officer'");
    expect(officerSql).toContain("inventory_admin_has_access");
    expect(inventoryPage).not.toContain('softDeleteRecord(restaurantId, "inventory_suppliers"');
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  groupInventoryTransfers,
  inventoryMovementLabel,
  inventoryMovementSource,
  newestInventoryMovements,
} from "../../src/modules/inventory/components/StockMovementsWorkspace";
import type { InventoryLedgerEntry } from "../../src/modules/inventory/types";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const workspace = read("src/modules/inventory/components/StockMovementsWorkspace.tsx");
const page = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
const styles = read("src/modules/inventory/styles/inventoryStockMovements.css");
const repository = read("src/modules/inventory/services/inventoryStockRepository.ts");
const sql = read("supabase/migrations/159_phase8_2_stock_operations_engine.sql");

const movement = (overrides: Partial<InventoryLedgerEntry> = {}): InventoryLedgerEntry => ({
  id: "move-a",
  inventoryItemId: "item-a",
  itemName: "Coffee",
  storageLocationId: "store-a",
  storageLocationName: "Main Store",
  supplierId: null,
  supplierName: null,
  movementType: "stock_in",
  quantity: 10,
  quantityEffect: "in",
  signedQuantity: 10,
  unitName: "kg",
  referenceNumber: null,
  invoiceNumber: null,
  reason: null,
  notes: null,
  transferGroupId: null,
  movementDate: "2026-08-23T15:00:00.000Z",
  createdByStaffId: "staff-a",
  staffName: "Abdi",
  ...overrides,
});

describe("Inventory V1 Phase 3B Stock Movements", () => {
  it("uses the canonical operational timestamp and deterministic newest-first ordering", () => {
    expect(sql).toContain("order by m.movement_date desc, m.created_at desc, m.id desc");
    expect(repository).toContain("movementDate: text(row.movement_date)");
    const rows = newestInventoryMovements([
      movement({ id: "old", movementDate: "2026-08-22T12:00:00Z" }),
      movement({ id: "same-a", movementDate: "2026-08-23T12:00:00Z" }),
      movement({ id: "same-b", movementDate: "2026-08-23T12:00:00Z" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["same-b", "same-a", "old"]);
  });

  it("retains the tenant-scoped, authorized and bounded ledger RPC", () => {
    expect(repository).toContain('target_restaurant_id: restaurantId');
    expect(repository).toContain("target_limit: filters.limit ?? 200");
    expect(sql).toContain("m.restaurant_id = target_restaurant_id");
    expect(sql).toContain("public.inventory_admin_has_access(target_restaurant_id)");
    expect(sql).toContain("limit least(greatest(coalesce(target_limit, 200), 1), 500)");
  });

  it("groups only safely correlated balanced transfer legs", () => {
    const transferOut = movement({ id: "out", movementType: "transfer_out", quantityEffect: "out", signedQuantity: -5, quantity: 5, transferGroupId: "pair", storageLocationId: "main", storageLocationName: "Main Store" });
    const transferIn = movement({ id: "in", movementType: "transfer_in", quantityEffect: "in", signedQuantity: 5, quantity: 5, transferGroupId: "pair", storageLocationId: "bar", storageLocationName: "Bar Store" });
    const grouped = groupInventoryTransfers([transferIn, transferOut]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].transferFrom?.storageLocationName).toBe("Main Store");
    expect(grouped[0].transferTo?.storageLocationName).toBe("Bar Store");
    expect(groupInventoryTransfers([transferOut, transferIn, movement({ id: "wrong", movementType: "transfer_in", quantity: 7, transferGroupId: "other" })])).toHaveLength(2);
  });

  it("translates workflow references while preserving useful short purchase numbers", () => {
    expect(inventoryMovementSource(movement({ movementType: "stock_out", referenceNumber: "KITCHEN-REQUEST-117f136f-e57c-4c6b-b471-123456789abc" }))).toBe("Kitchen Request");
    expect(inventoryMovementSource(movement({ referenceNumber: "PO-6670C2F2", reason: "Purchase order receipt" }))).toBe("Purchase Order #PO-6670C2F2");
    expect(inventoryMovementSource(movement())).toBe("Manual Stock In");
  });

  it("uses clear movement text in addition to signed quantity styling", () => {
    expect(inventoryMovementLabel("stock_in")).toBe("Stock In");
    expect(inventoryMovementLabel("stock_out")).toBe("Stock Out");
    expect(inventoryMovementLabel("transfer_out", true)).toBe("Transfer");
    expect(inventoryMovementLabel("manual_correction")).toBe("Manual Correction");
    expect(inventoryMovementLabel("waste")).toBe("Waste");
  });

  it("uses a mobile list and a simplified desktop table without a Reference column", () => {
    expect(page).toContain("<StockMovementsWorkspace");
    expect(workspace).toContain('className="ia-sm-mobile-list"');
    expect(workspace).toContain('className="ia-sm-desktop-table"');
    expect(workspace).toContain("Date / Time");
    expect(workspace).toContain("Source / Reason");
    expect(workspace).not.toContain("<th>Reference</th>");
    expect(styles).toContain("@media (min-width: 1024px)");
  });

  it("does not render absent optional values as visual noise", () => {
    expect(workspace).not.toContain('?? "None"');
    expect(workspace).not.toContain('?? "No supplier"');
    expect(workspace).toContain("row.primary.supplierName &&");
    expect(workspace).toContain("details.primary.invoiceNumber &&");
  });

  it("offers operational search, collapsed filters, date presets, and active count", () => {
    expect(workspace).toContain("Search materials, storage, staff...");
    for (const label of ["Movement Type", "Storage", "Material", "Staff", "Today", "Last 7 Days", "This Month", "Custom", "Clear", "Apply Filters", "active filters"]) {
      expect(workspace).toContain(label);
    }
    expect(workspace).toContain('role="dialog"');
  });

  it("distinguishes loading, overall empty, filtered empty, search empty, and safe error states", () => {
    for (const text of ["Loading stock movements...", "No stock movements yet.", "No movements match these filters.", "No movements found.", "We couldn&apos;t load stock movements."]) {
      expect(workspace).toContain(text);
    }
    for (const forbidden of ["TypeError", "PostgREST", "Supabase error", "stack trace"]) expect(workspace).not.toContain(forbidden);
  });

  it("uses bounded client pagination and resets it when search or filters change", () => {
    expect(workspace).toContain("const PAGE_SIZE = 25");
    expect(workspace).toContain("rows.slice(0, visibleCount)");
    expect(workspace).toContain("setVisibleCount(PAGE_SIZE)");
    expect(workspace).toContain("Load More");
  });

  it("keeps refresh secondary and hides global raw loading/error presentation for the ledger", () => {
    expect(workspace).toContain('<button type="button" onClick={onReload}>Refresh</button>');
    expect(page).toContain('section !== "ledger"');
    expect(styles).toContain("min-height: 40px");
    expect(styles).toContain(":focus-visible");
  });
});

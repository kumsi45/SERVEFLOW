import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { currentStockStatusLabel } from "../../src/modules/inventory/components/CurrentStockWorkspace";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const currentStock = read("src/modules/inventory/components/CurrentStockWorkspace.tsx");
const operations = read("src/modules/inventory/components/StockOperationWorkspaces.tsx");
const page = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
const validation = read("src/modules/inventory/services/stockOperationValidation.ts");
const service = read("src/modules/inventory/services/inventoryStockRepository.ts");
const styles = read("src/modules/inventory/styles/inventoryStockOperations.css");

describe("Inventory V1 Phase 3 Current Stock and stock operations", () => {
  it("uses cards below desktop and a table at desktop widths", () => {
    expect(page).toContain("<CurrentStockWorkspace");
    expect(currentStock).toContain('className="ia-cs-mobile-list"');
    expect(currentStock).toContain('className="ia-cs-desktop-table"');
    expect(styles).toContain("@media (min-width: 1024px)");
    expect(styles).toContain(".ia-cs-mobile-list { display: none; }");
    expect(styles).toContain(".ia-cs-desktop-table { display: block; }");
  });

  it("provides explicit business status labels rather than color alone", () => {
    expect(currentStockStatusLabel("out_of_stock")).toBe("Out of Stock");
    expect(currentStockStatusLabel("low_stock")).toBe("Low Stock");
    expect(currentStockStatusLabel("in_stock")).toBe("In Stock");
    expect(currentStockStatusLabel("over_stock")).toBe("Over Stock");
  });

  it("searches material, storage, and category and exposes usable filters", () => {
    expect(currentStock).toContain("row.itemName, row.storageLocationName, row.categoryName");
    for (const label of ["Status", "Storage", "Category", "Clear", "Apply Filters", "active filters"]) {
      expect(currentStock).toContain(label);
    }
  });

  it("keeps ordinary row actions to the three canonical operations and details", () => {
    for (const label of ["Stock In", "Stock Out", "Transfer", "View details"]) expect(currentStock).toContain(label);
    for (const forbidden of ["Adjustment", "Adjust Stock", "Archive", "Delete"]) expect(currentStock).not.toContain(forbidden);
  });

  it("preselects material and storage from the selected current-stock row", () => {
    expect(page).toContain("function startStockOperation");
    expect(page).toContain('inventoryItemId: row?.inventoryItemId ?? ""');
    expect(page).toContain('storageLocationId: row?.storageLocationId ?? ""');
    expect(page).toContain('fromStorageLocationId: row?.storageLocationId ?? ""');
  });

  it("keeps primary forms compact and moves audit metadata behind progressive disclosure", () => {
    for (const label of ["Material", "Storage", "Quantity", "From storage", "To storage"]) expect(operations).toContain(label);
    expect(operations).toContain("<summary>Additional details</summary>");
    for (const label of ["Supplier", "Invoice number", "Document number", "Reason", "Notes", "Movement time"]) expect(operations).toContain(label);
    expect(operations).toContain('inputMode="decimal"');
  });

  it("requires review before invoking the existing save callbacks", () => {
    for (const label of ["Review {incoming ?", "Review Transfer", "Confirm Stock In", "Confirm Stock Out", "Confirm Transfer"]) {
      expect(operations).toContain(label);
    }
    expect(operations).toContain("Current stock");
    expect(operations).toContain("Remaining after issue");
    expect(operations).toContain("Available at source");
    expect(operations).toContain("Remaining at source");
  });

  it("retains canonical tenant and stock validation", () => {
    expect(validation).toContain("item.restaurantId === restaurantId");
    expect(validation).toContain("row.restaurantId === restaurantId");
    expect(validation).toContain("draft.fromStorageLocationId === draft.toStorageLocationId");
    expect(validation).toContain("requireAvailableStock");
  });

  it("reuses the canonical movement and balanced-transfer RPC paths", () => {
    expect(service).toContain('supabase.rpc("record_inventory_movement"');
    expect(service).toContain('supabase.rpc("record_inventory_transfer"');
    expect(page).toContain("recordStockMovement(restaurantId, movementForm");
    expect(page).toContain("transferInventoryStock(restaurantId, transferForm");
  });

  it("turns connection and authorization failures into safe operator messages", () => {
    expect(page).toContain("function inventoryUserMessage");
    expect(page).toContain("Stock information couldn't be loaded. Check your connection and try again.");
    expect(page).toContain("You do not have permission to complete this inventory action");
    expect(currentStock).toContain("Stock information couldn&apos;t be loaded.");
    expect(currentStock).not.toContain("TypeError");
    expect(currentStock).not.toContain("PostgREST");
  });

  it("reports concise success feedback and preserves accessible controls", () => {
    for (const message of ["Stock received successfully.", "Stock issued successfully.", "Transfer completed."]) expect(page).toContain(message);
    expect(currentStock).toContain('aria-haspopup="dialog"');
    expect(currentStock).toContain('aria-modal="true"');
    expect(styles).toContain("min-height: 44px");
    expect(styles).toContain(":focus-visible");
    expect(styles).toContain("prefers-reduced-motion");
  });
});

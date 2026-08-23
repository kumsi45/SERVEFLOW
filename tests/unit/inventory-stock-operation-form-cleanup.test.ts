import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const operations = read("src/modules/inventory/components/StockOperationWorkspaces.tsx");
const page = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
const movementService = read("src/modules/inventory/services/stockMovementService.ts");
const transferService = read("src/modules/inventory/services/transferService.ts");
const repository = read("src/modules/inventory/services/inventoryStockRepository.ts");
const styles = read("src/modules/inventory/styles/inventoryStockOperations.css");

describe("Inventory stock operation form cleanup", () => {
  it("removes document, invoice, and notes controls from all three manual workflows", () => {
    for (const removed of ["Document number", "Invoice number", ">Notes<"]) expect(operations).not.toContain(removed);
  });

  it("keeps one compact optional explanation field", () => {
    expect(operations.match(/>Reason<textarea/g)).toHaveLength(2);
    expect(operations.match(/Why is this stock being changed\? \(optional\)/g)).toHaveLength(2);
    expect(operations).toContain('className="ia-so-reason" rows={2}');
    expect(styles).toContain("textarea.ia-so-reason");
  });

  it("shows Supplier only for Stock In and keeps it optional", () => {
    expect(operations).toContain("{incoming && <label>Supplier");
    expect(operations).toContain('<option value="">No supplier selected</option>');
    expect(operations).not.toContain("required value={draft.supplierId}");
  });

  it("keeps movement time under collapsed additional details", () => {
    expect(operations.match(/<summary>Additional details<\/summary>/g)).toHaveLength(2);
    expect(operations.match(/>Movement time<input type="datetime-local"/g)).toHaveLength(2);
    expect(operations).not.toContain('<details className="ia-so-details" open');
  });

  it("preserves current-time defaults and hidden compatibility fields in drafts", () => {
    expect(page).toContain("movementDate: dateInputValue()");
    for (const field of ['referenceNumber: ""', 'invoiceNumber: ""', 'notes: ""']) expect(page).toContain(field);
  });

  it("preserves service and RPC compatibility for existing optional columns", () => {
    for (const field of ["referenceNumber: nullableText(draft.referenceNumber)", "invoiceNumber: nullableText(draft.invoiceNumber)", "notes: nullableText(draft.notes)"]) expect(movementService).toContain(field);
    for (const field of ["referenceNumber: nullableText(draft.referenceNumber)", "notes: nullableText(draft.notes)"]) expect(transferService).toContain(field);
    for (const argument of ["target_reference_number", "target_invoice_number", "target_notes", "target_movement_date"]) expect(repository).toContain(argument);
  });

  it("retains review, validation, and canonical save callbacks", () => {
    expect(operations).toContain("validateStockMovementDraft");
    expect(operations).toContain("validateTransferDraft");
    for (const label of ["Review {incoming ?", "Review Transfer", "Confirm Stock In", "Confirm Stock Out", "Confirm Transfer"]) expect(operations).toContain(label);
    expect(page).toContain("recordStockMovement(restaurantId, movementForm");
    expect(page).toContain("transferInventoryStock(restaurantId, transferForm");
  });
});

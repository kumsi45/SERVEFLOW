import type { StockMovementDraft } from "../types";
import { recordInventoryMovement } from "./inventoryStockRepository";
import {
  parseStockQuantity,
  type StockValidationContext,
  validateStockMovementDraft,
} from "./stockOperationValidation";

function nullableText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function requireValid(errors: string[]) {
  if (errors.length) throw new Error(errors.join(" "));
}

export async function recordStockMovement(
  restaurantId: string,
  draft: StockMovementDraft,
  context: StockValidationContext,
) {
  const validation = validateStockMovementDraft(draft, context, restaurantId);
  requireValid(validation.errors);
  await recordInventoryMovement({
    restaurantId,
    inventoryItemId: draft.inventoryItemId,
    storageLocationId: draft.storageLocationId,
    movementType: draft.movementType,
    quantity: parseStockQuantity(draft.quantity),
    quantityEffect: draft.movementType === "stock_in" ? undefined : draft.movementType === "stock_out" ? undefined : draft.quantityEffect,
    supplierId: nullableText(draft.supplierId),
    referenceNumber: nullableText(draft.referenceNumber),
    invoiceNumber: nullableText(draft.invoiceNumber),
    reason: nullableText(draft.reason),
    notes: nullableText(draft.notes),
    movementDate: nullableText(draft.movementDate),
  });
}

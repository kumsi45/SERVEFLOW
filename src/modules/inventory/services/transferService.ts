import type { InventoryTransferDraft } from "../types";
import { recordInventoryTransfer } from "./inventoryStockRepository";
import {
  parseStockQuantity,
  type StockValidationContext,
  validateTransferDraft,
} from "./stockOperationValidation";

function nullableText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function requireValid(errors: string[]) {
  if (errors.length) throw new Error(errors.join(" "));
}

export async function transferInventoryStock(
  restaurantId: string,
  draft: InventoryTransferDraft,
  context: StockValidationContext,
) {
  const validation = validateTransferDraft(draft, context, restaurantId);
  requireValid(validation.errors);
  await recordInventoryTransfer({
    restaurantId,
    inventoryItemId: draft.inventoryItemId,
    fromStorageLocationId: draft.fromStorageLocationId,
    toStorageLocationId: draft.toStorageLocationId,
    quantity: parseStockQuantity(draft.quantity),
    referenceNumber: nullableText(draft.referenceNumber),
    reason: nullableText(draft.reason),
    notes: nullableText(draft.notes),
    movementDate: nullableText(draft.movementDate),
  });
}

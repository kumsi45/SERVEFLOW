import type { InventoryAdjustmentDraft } from "../types";
import { recordInventoryAdjustment } from "./inventoryStockRepository";
import {
  parseStockQuantity,
  type StockValidationContext,
  validateAdjustmentDraft,
} from "./stockOperationValidation";

function nullableText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function requireValid(errors: string[]) {
  if (errors.length) throw new Error(errors.join(" "));
}

export async function adjustInventoryStock(
  restaurantId: string,
  draft: InventoryAdjustmentDraft,
  context: StockValidationContext,
) {
  const validation = validateAdjustmentDraft(draft, context, restaurantId);
  requireValid(validation.errors);
  await recordInventoryAdjustment({
    restaurantId,
    inventoryItemId: draft.inventoryItemId,
    storageLocationId: draft.storageLocationId,
    direction: draft.direction,
    quantity: parseStockQuantity(draft.quantity),
    reason: draft.reason.trim(),
    notes: nullableText(draft.notes),
    movementDate: nullableText(draft.movementDate),
  });
}

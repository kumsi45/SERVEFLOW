import type { InventoryWasteDraft } from "../types";
import { recordInventoryWaste } from "./inventoryStockRepository";
import {
  parseStockQuantity,
  type StockValidationContext,
  validateWasteDraft,
} from "./stockOperationValidation";

function nullableText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function requireValid(errors: string[]) {
  if (errors.length) throw new Error(errors.join(" "));
}

export async function wasteInventoryStock(
  restaurantId: string,
  draft: InventoryWasteDraft,
  context: StockValidationContext,
) {
  const validation = validateWasteDraft(draft, context, restaurantId);
  requireValid(validation.errors);
  await recordInventoryWaste({
    restaurantId,
    inventoryItemId: draft.inventoryItemId,
    storageLocationId: draft.storageLocationId,
    quantity: parseStockQuantity(draft.quantity),
    reason: draft.reason.trim(),
    isSpoilage: draft.isSpoilage,
    notes: nullableText(draft.notes),
    movementDate: nullableText(draft.movementDate),
  });
}

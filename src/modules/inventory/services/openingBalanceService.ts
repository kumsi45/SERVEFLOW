import type { InventoryOpeningBalanceDraft } from "../types";
import { recordInventoryOpeningBalance } from "./inventoryStockRepository";
import {
  parseStockQuantity,
  type StockValidationContext,
  validateOpeningBalanceDraft,
} from "./stockOperationValidation";

function nullableText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function requireValid(errors: string[]) {
  if (errors.length) throw new Error(errors.join(" "));
}

export async function recordOpeningBalance(
  restaurantId: string,
  draft: InventoryOpeningBalanceDraft,
  context: StockValidationContext,
) {
  const validation = validateOpeningBalanceDraft(draft, context, restaurantId);
  requireValid(validation.errors);
  await recordInventoryOpeningBalance({
    restaurantId,
    inventoryItemId: draft.inventoryItemId,
    storageLocationId: draft.storageLocationId,
    quantity: parseStockQuantity(draft.quantity),
    referenceNumber: nullableText(draft.referenceNumber),
    notes: nullableText(draft.notes),
    movementDate: nullableText(draft.movementDate),
  });
}

import type {
  InventoryAdminData,
  InventoryAdjustmentDraft,
  InventoryCurrentStockRow,
  InventoryMovementType,
  InventoryOpeningBalanceDraft,
  InventoryTransferDraft,
  InventoryWasteDraft,
  StockMovementDraft,
} from "../types";

export type StockValidationContext = InventoryAdminData & {
  currentStock: InventoryCurrentStockRow[];
};

export type StockValidationResult = {
  valid: boolean;
  errors: string[];
};

function result(errors: string[]): StockValidationResult {
  return { valid: errors.length === 0, errors };
}

function trimmed(value: string) {
  return value.trim();
}

function quantity(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function parseStockQuantity(value: string) {
  return quantity(value);
}

function requirePositiveQuantity(value: string, label: string, errors: string[]) {
  const parsed = quantity(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    errors.push(`${label} must be greater than zero.`);
  }
}

function currentBalance(context: StockValidationContext, itemId: string, storageLocationId: string) {
  return context.currentStock
    .filter((row) => row.inventoryItemId === itemId && row.storageLocationId === storageLocationId)
    .reduce((sum, row) => sum + row.currentQuantity, 0);
}

function hasActiveItem(context: InventoryAdminData, restaurantId: string, id: string) {
  return context.items.some((item) => item.id === id && item.restaurantId === restaurantId && item.status === "active");
}

function hasActiveStorage(context: InventoryAdminData, restaurantId: string, id: string) {
  return context.storageLocations.some((row) => row.id === id && row.restaurantId === restaurantId && row.status === "active");
}

function hasActiveSupplier(context: InventoryAdminData, restaurantId: string, id: string) {
  return context.suppliers.some((row) => row.id === id && row.restaurantId === restaurantId && row.status === "active");
}

function requireItemAndStorage(
  context: InventoryAdminData,
  restaurantId: string,
  itemId: string,
  storageLocationId: string,
  errors: string[],
) {
  if (!itemId) errors.push("Inventory item is required.");
  if (!storageLocationId) errors.push("Storage location is required.");
  if (itemId && !hasActiveItem(context, restaurantId, itemId)) errors.push("Selected ingredient is invalid.");
  if (storageLocationId && !hasActiveStorage(context, restaurantId, storageLocationId)) {
    errors.push("Selected storage location is invalid.");
  }
}

function requireAvailableStock(
  context: StockValidationContext,
  itemId: string,
  storageLocationId: string,
  value: string,
  errors: string[],
) {
  const parsed = quantity(value);
  if (Number.isFinite(parsed) && parsed > currentBalance(context, itemId, storageLocationId)) {
    errors.push("Movement would create negative stock.");
  }
}

export function validateStockMovementDraft(
  draft: StockMovementDraft,
  context: StockValidationContext,
  restaurantId: string,
): StockValidationResult {
  const errors: string[] = [];
  const validTypes: InventoryMovementType[] = ["stock_in", "stock_out", "manual_correction", "closing_balance"];
  if (!validTypes.includes(draft.movementType)) errors.push("Movement type is invalid.");
  requireItemAndStorage(context, restaurantId, draft.inventoryItemId, draft.storageLocationId, errors);
  requirePositiveQuantity(draft.quantity, "Movement quantity", errors);
  if (draft.supplierId && !hasActiveSupplier(context, restaurantId, draft.supplierId)) {
    errors.push("Selected supplier is invalid.");
  }
  if ((draft.movementType === "manual_correction" || draft.movementType === "closing_balance") && !draft.quantityEffect) {
    errors.push("Movement direction is required.");
  }
  const isOutgoing =
    draft.movementType === "stock_out" ||
    (draft.movementType === "manual_correction" && draft.quantityEffect === "out") ||
    (draft.movementType === "closing_balance" && draft.quantityEffect === "out");
  if (isOutgoing) requireAvailableStock(context, draft.inventoryItemId, draft.storageLocationId, draft.quantity, errors);
  if (draft.movementType === "manual_correction" && !trimmed(draft.reason)) {
    errors.push("Correction reason is required.");
  }
  return result(errors);
}

export function validateAdjustmentDraft(
  draft: InventoryAdjustmentDraft,
  context: StockValidationContext,
  restaurantId: string,
): StockValidationResult {
  const errors: string[] = [];
  requireItemAndStorage(context, restaurantId, draft.inventoryItemId, draft.storageLocationId, errors);
  requirePositiveQuantity(draft.quantity, "Adjustment quantity", errors);
  if (draft.direction !== "increase" && draft.direction !== "decrease") errors.push("Adjustment direction is invalid.");
  if (!trimmed(draft.reason)) errors.push("Adjustment reason is required.");
  if (draft.direction === "decrease") {
    requireAvailableStock(context, draft.inventoryItemId, draft.storageLocationId, draft.quantity, errors);
  }
  return result(errors);
}

export function validateWasteDraft(
  draft: InventoryWasteDraft,
  context: StockValidationContext,
  restaurantId: string,
): StockValidationResult {
  const errors: string[] = [];
  requireItemAndStorage(context, restaurantId, draft.inventoryItemId, draft.storageLocationId, errors);
  requirePositiveQuantity(draft.quantity, "Waste quantity", errors);
  if (!trimmed(draft.reason)) errors.push("Waste reason is required.");
  requireAvailableStock(context, draft.inventoryItemId, draft.storageLocationId, draft.quantity, errors);
  return result(errors);
}

export function validateTransferDraft(
  draft: InventoryTransferDraft,
  context: StockValidationContext,
  restaurantId: string,
): StockValidationResult {
  const errors: string[] = [];
  requireItemAndStorage(context, restaurantId, draft.inventoryItemId, draft.fromStorageLocationId, errors);
  if (!draft.toStorageLocationId) errors.push("Destination storage location is required.");
  if (draft.toStorageLocationId && !hasActiveStorage(context, restaurantId, draft.toStorageLocationId)) {
    errors.push("Destination storage location is invalid.");
  }
  if (draft.fromStorageLocationId && draft.fromStorageLocationId === draft.toStorageLocationId) {
    errors.push("Transfer locations must be different.");
  }
  requirePositiveQuantity(draft.quantity, "Transfer quantity", errors);
  requireAvailableStock(context, draft.inventoryItemId, draft.fromStorageLocationId, draft.quantity, errors);
  return result(errors);
}

export function validateOpeningBalanceDraft(
  draft: InventoryOpeningBalanceDraft,
  context: StockValidationContext,
  restaurantId: string,
): StockValidationResult {
  const errors: string[] = [];
  requireItemAndStorage(context, restaurantId, draft.inventoryItemId, draft.storageLocationId, errors);
  requirePositiveQuantity(draft.quantity, "Opening balance quantity", errors);
  const existingLedger = context.currentStock.some(
    (row) =>
      row.inventoryItemId === draft.inventoryItemId &&
      row.storageLocationId === draft.storageLocationId &&
      row.lastMovementAt,
  );
  if (existingLedger) errors.push("Opening balance can only be recorded before other movements.");
  return result(errors);
}

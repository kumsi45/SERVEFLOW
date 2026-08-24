import type {
  InventoryAdminData,
  InventoryCategoryDraft,
  InventoryItemDraft,
  InventorySimpleDraft,
  InventorySupplierDraft,
} from "../types";

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};

function trimmed(value: string) {
  return value.trim();
}

function result(errors: string[]): ValidationResult {
  return { valid: errors.length === 0, errors };
}

export function hasDuplicateName(
  rows: Array<{ id: string; name: string; restaurantId: string; status: string }>,
  restaurantId: string,
  name: string,
  currentId?: string,
) {
  const normalized = trimmed(name).toLowerCase();
  return rows.some(
    (row) =>
      row.restaurantId === restaurantId &&
      row.id !== currentId &&
      row.status !== "deleted" &&
      row.name.trim().toLowerCase() === normalized,
  );
}

export function validateCategoryDraft(
  draft: InventoryCategoryDraft,
  data: InventoryAdminData,
  restaurantId: string,
): ValidationResult {
  const errors: string[] = [];
  if (!trimmed(draft.name)) errors.push("Category name is required.");
  if (hasDuplicateName(data.categories, restaurantId, draft.name, draft.id)) {
    errors.push("Category names must be unique inside the restaurant.");
  }
  if (draft.sortOrder.trim() && !Number.isInteger(Number(draft.sortOrder))) {
    errors.push("Sort order must be a whole number.");
  }
  return result(errors);
}

export function validateSimpleDraft(
  draft: InventorySimpleDraft,
  rows: Array<{ id: string; name: string; restaurantId: string; status: string }>,
  restaurantId: string,
  label: string,
): ValidationResult {
  const errors: string[] = [];
  if (!trimmed(draft.name)) errors.push(`${label} name is required.`);
  if (hasDuplicateName(rows, restaurantId, draft.name, draft.id)) {
    errors.push(`${label} names must be unique inside the restaurant.`);
  }
  return result(errors);
}

export function validateSupplierDraft(
  draft: InventorySupplierDraft,
  data: InventoryAdminData,
  restaurantId: string,
): ValidationResult {
  const errors: string[] = [];
  if (!trimmed(draft.name)) errors.push("Supplier name is required.");
  if (hasDuplicateName(data.suppliers, restaurantId, draft.name, draft.id)) {
    errors.push("Supplier names must be unique inside the restaurant.");
  }
  return result(errors);
}

export function validateItemDraft(
  draft: InventoryItemDraft,
  data: InventoryAdminData,
  restaurantId: string,
): ValidationResult {
  const errors: string[] = [];
  if (!trimmed(draft.name)) errors.push("Material name is required.");
  if (hasDuplicateName(data.items, restaurantId, draft.name, draft.id)) {
    errors.push("Material names must be unique inside the restaurant.");
  }
  if (!draft.categoryId) errors.push("Category is required.");
  if (!draft.unitId) errors.push("Unit is required.");
  if (!draft.storageLocationId) errors.push("Storage location is required.");
  if (
    draft.categoryId &&
    !data.categories.some((row) => row.id === draft.categoryId && row.restaurantId === restaurantId && row.status !== "deleted")
  ) {
    errors.push("Selected category is invalid.");
  }
  if (
    draft.unitId &&
    !data.units.some((row) => row.id === draft.unitId && row.restaurantId === restaurantId && row.status !== "deleted")
  ) {
    errors.push("Selected unit is invalid.");
  }
  if (
    draft.storageLocationId &&
    !data.storageLocations.some((row) => row.id === draft.storageLocationId && row.restaurantId === restaurantId && row.status !== "deleted")
  ) {
    errors.push("Selected storage location is invalid.");
  }
  if (
    draft.preferredSupplierId &&
    !data.suppliers.some((row) => row.id === draft.preferredSupplierId && row.restaurantId === restaurantId && row.status !== "deleted")
  ) {
    errors.push("Selected supplier is invalid.");
  }

  const minimumStock = Number(draft.minimumStock || 0);
  const maximumStock = draft.maximumStock.trim() ? Number(draft.maximumStock) : null;
  const purchasePrice = Number(draft.purchasePrice || 0);
  if (!Number.isFinite(minimumStock) || minimumStock < 0) {
    errors.push("Minimum stock must be zero or greater.");
  }
  if (maximumStock !== null && (!Number.isFinite(maximumStock) || maximumStock < 0)) {
    errors.push("Maximum stock must be zero or greater.");
  }
  if (maximumStock !== null && maximumStock < minimumStock) {
    errors.push("Maximum stock cannot be less than minimum stock.");
  }
  if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
    errors.push("Purchase price must be zero or greater.");
  }

  const duplicateSku = draft.sku.trim()
    ? data.items.some(
        (row) =>
          row.restaurantId === restaurantId &&
          row.id !== draft.id &&
          row.status !== "deleted" &&
          row.sku?.trim().toLowerCase() === draft.sku.trim().toLowerCase(),
      )
    : false;
  if (duplicateSku) errors.push("SKU must be unique inside the restaurant.");

  const duplicateBarcode = draft.barcode.trim()
    ? data.items.some(
        (row) =>
          row.restaurantId === restaurantId &&
          row.id !== draft.id &&
          row.status !== "deleted" &&
          row.barcode?.trim().toLowerCase() === draft.barcode.trim().toLowerCase(),
      )
    : false;
  if (duplicateBarcode) errors.push("Barcode must be unique inside the restaurant.");

  return result(errors);
}

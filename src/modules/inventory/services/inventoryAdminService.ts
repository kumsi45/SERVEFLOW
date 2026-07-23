import type {
  InventoryAdminData,
  InventoryCategoryDraft,
  InventoryFilters,
  InventoryItem,
  InventoryItemDraft,
  InventorySimpleDraft,
  InventorySupplierDraft,
} from "../types";
import {
  bulkSetInventoryItemStatus,
  duplicateInventoryItem,
  loadInventoryAdminData,
  saveInventoryCategory,
  saveInventoryItem,
  saveInventoryStorageLocation,
  saveInventorySupplier,
  saveInventoryUnit,
  setInventoryRecordStatus,
} from "./inventoryRepository";
import {
  validateCategoryDraft,
  validateItemDraft,
  validateSimpleDraft,
  validateSupplierDraft,
} from "./inventoryValidation";

export { loadInventoryAdminData };

function requireValid(errors: string[]) {
  if (errors.length) throw new Error(errors.join(" "));
}

function nextCopyName(baseName: string, existingNames: string[]) {
  const used = new Set(existingNames.map((name) => name.trim().toLowerCase()));
  let candidate = `${baseName} Copy`;
  let counter = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${baseName} Copy ${counter}`;
    counter += 1;
  }
  return candidate;
}

export async function saveCategory(
  restaurantId: string,
  draft: InventoryCategoryDraft,
  data: InventoryAdminData,
) {
  const validation = validateCategoryDraft(draft, data, restaurantId);
  requireValid(validation.errors);
  await saveInventoryCategory(restaurantId, draft);
}

export async function saveSupplier(
  restaurantId: string,
  draft: InventorySupplierDraft,
  data: InventoryAdminData,
) {
  const validation = validateSupplierDraft(draft, data, restaurantId);
  requireValid(validation.errors);
  await saveInventorySupplier(restaurantId, draft);
}

export async function saveStorageLocation(
  restaurantId: string,
  draft: InventorySimpleDraft,
  data: InventoryAdminData,
) {
  const validation = validateSimpleDraft(draft, data.storageLocations, restaurantId, "Storage location");
  requireValid(validation.errors);
  await saveInventoryStorageLocation(restaurantId, draft);
}

export async function saveUnit(
  restaurantId: string,
  draft: InventorySimpleDraft,
  data: InventoryAdminData,
) {
  const validation = validateSimpleDraft(draft, data.units, restaurantId, "Unit");
  requireValid(validation.errors);
  await saveInventoryUnit(restaurantId, draft);
}

export async function saveItem(
  restaurantId: string,
  draft: InventoryItemDraft,
  data: InventoryAdminData,
) {
  const validation = validateItemDraft(draft, data, restaurantId);
  requireValid(validation.errors);
  const unitName = data.units.find((unit) => unit.id === draft.unitId)?.name;
  if (!unitName) throw new Error("Selected unit is invalid.");
  await saveInventoryItem(restaurantId, draft, unitName);
}

export async function archiveRecord(
  restaurantId: string,
  table: Parameters<typeof setInventoryRecordStatus>[1],
  id: string,
) {
  await setInventoryRecordStatus(restaurantId, table, id, "archived");
}

export async function restoreRecord(
  restaurantId: string,
  table: Parameters<typeof setInventoryRecordStatus>[1],
  id: string,
) {
  await setInventoryRecordStatus(restaurantId, table, id, "active");
}

export async function softDeleteRecord(
  restaurantId: string,
  table: Parameters<typeof setInventoryRecordStatus>[1],
  id: string,
) {
  await setInventoryRecordStatus(restaurantId, table, id, "deleted");
}

export async function bulkArchiveItems(restaurantId: string, ids: string[]) {
  await bulkSetInventoryItemStatus(restaurantId, ids, "archived");
}

export async function bulkRestoreItems(restaurantId: string, ids: string[]) {
  await bulkSetInventoryItemStatus(restaurantId, ids, "active");
}

export async function bulkSoftDeleteItems(restaurantId: string, ids: string[]) {
  await bulkSetInventoryItemStatus(restaurantId, ids, "deleted");
}

export async function duplicateItem(
  restaurantId: string,
  item: InventoryItem,
  data: InventoryAdminData,
) {
  const unitName = data.units.find((unit) => unit.id === item.unitId)?.name;
  if (!unitName) throw new Error("Selected unit is invalid.");
  const copyName = nextCopyName(item.name, data.items.map((candidate) => candidate.name));
  await duplicateInventoryItem(restaurantId, item, unitName, copyName);
}

function includesText(value: string | null | undefined, search: string) {
  return (value ?? "").toLowerCase().includes(search);
}

export function getFilteredItems(data: InventoryAdminData, filters: InventoryFilters) {
  const categoryNames = new Map(data.categories.map((row) => [row.id, row.name]));
  const supplierNames = new Map(data.suppliers.map((row) => [row.id, row.name]));
  const storageNames = new Map(data.storageLocations.map((row) => [row.id, row.name]));
  const search = filters.search.trim().toLowerCase();
  const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const rows = data.items.filter((item) => {
    if (filters.status !== "all" && item.status !== filters.status) return false;
    if (filters.archived === "active" && item.status !== "active") return false;
    if (filters.archived === "archived" && item.status !== "archived") return false;
    if (filters.categoryId && item.categoryId !== filters.categoryId) return false;
    if (filters.supplierId && item.preferredSupplierId !== filters.supplierId) return false;
    if (filters.storageLocationId && item.storageLocationId !== filters.storageLocationId) return false;
    if (filters.recentlyAdded && new Date(item.createdAt).getTime() < recentCutoff) return false;
    if (!search) return true;
    return (
      includesText(item.name, search) ||
      includesText(item.sku, search) ||
      includesText(item.barcode, search) ||
      includesText(categoryNames.get(item.categoryId), search) ||
      includesText(item.preferredSupplierId ? supplierNames.get(item.preferredSupplierId) : null, search) ||
      includesText(storageNames.get(item.storageLocationId), search)
    );
  });

  return [...rows].sort((left, right) => {
    if (filters.sort === "alphabetical") return left.name.localeCompare(right.name);
    if (filters.sort === "category") return (categoryNames.get(left.categoryId) ?? "").localeCompare(categoryNames.get(right.categoryId) ?? "");
    if (filters.sort === "supplier") return (supplierNames.get(left.preferredSupplierId ?? "") ?? "").localeCompare(supplierNames.get(right.preferredSupplierId ?? "") ?? "");
    if (filters.sort === "storage") return (storageNames.get(left.storageLocationId) ?? "").localeCompare(storageNames.get(right.storageLocationId) ?? "");
    if (filters.sort === "status") return left.status.localeCompare(right.status) || left.name.localeCompare(right.name);
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
}

import { supabase } from "../../../core/database";
import type {
  InventoryAdminData,
  InventoryCategory,
  InventoryCurrentStockRow,
  InventoryFoodConsumptionMovement,
  InventoryItem,
  InventoryLedgerEntry,
  InventoryStatus,
  InventoryStorageLocation,
  InventorySupplier,
  InventoryUnit,
} from "../types";
import { loadLedger } from "./ledgerService";
import { loadInventoryMovementHistory } from "./movementHistoryService";
import { mapCurrentStock } from "./inventoryStockRepository";

export const INVENTORY_REALTIME_TABLES = [
  "inventory_movements",
  "inventory_items",
  "inventory_categories",
  "inventory_suppliers",
  "inventory_storage_locations",
  "inventory_units",
  "kitchen_inventory_requests",
] as const;

export type InventoryRealtimeTable = (typeof INVENTORY_REALTIME_TABLES)[number];
export type InventoryRealtimeAdminTable = Exclude<InventoryRealtimeTable, "inventory_movements" | "kitchen_inventory_requests">;
export type InventoryRealtimeChange = {
  operation: "INSERT" | "UPDATE" | "DELETE";
  record: Record<string, unknown>;
};

type Row = Record<string, unknown>;

const text = (value: unknown) => typeof value === "string" ? value : "";
const nullableText = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
const numberValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const statusValue = (value: unknown): InventoryStatus =>
  value === "archived" || value === "deleted" ? value : "active";

function mapItem(row: Row): InventoryItem {
  return {
    id: text(row.id),
    restaurantId: text(row.restaurant_id),
    name: text(row.name),
    categoryId: text(row.category_id),
    unitId: text(row.unit_id),
    storageLocationId: text(row.storage_location_id),
    preferredSupplierId: nullableText(row.preferred_supplier_id),
    sku: nullableText(row.sku),
    barcode: nullableText(row.barcode),
    minimumStock: numberValue(row.minimum_stock),
    maximumStock: row.maximum_stock == null ? null : numberValue(row.maximum_stock),
    purchasePrice: numberValue(row.purchase_price),
    description: nullableText(row.description),
    status: statusValue(row.status),
    createdByStaffId: nullableText(row.created_by_staff_id),
    updatedByStaffId: nullableText(row.updated_by_staff_id),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function mapCategory(row: Row): InventoryCategory {
  return {
    id: text(row.id), restaurantId: text(row.restaurant_id), name: text(row.name),
    description: nullableText(row.description), sortOrder: numberValue(row.sort_order, 1000),
    status: statusValue(row.status), createdAt: text(row.created_at), updatedAt: text(row.updated_at),
  };
}

function mapSupplier(row: Row): InventorySupplier {
  return {
    id: text(row.id), restaurantId: text(row.restaurant_id), name: text(row.name),
    phone: nullableText(row.phone), address: nullableText(row.address),
    contactPerson: nullableText(row.contact_person), notes: nullableText(row.notes),
    status: statusValue(row.status), createdAt: text(row.created_at), updatedAt: text(row.updated_at),
  };
}

function mapStorageLocation(row: Row): InventoryStorageLocation {
  return {
    id: text(row.id), restaurantId: text(row.restaurant_id), name: text(row.name),
    description: nullableText(row.description), status: statusValue(row.status),
    createdAt: text(row.created_at), updatedAt: text(row.updated_at),
  };
}

function mapUnit(row: Row): InventoryUnit {
  return {
    id: text(row.id), restaurantId: text(row.restaurant_id), name: text(row.name),
    description: nullableText(row.description), status: statusValue(row.status),
    pluralName: nullableText(row.plural_name), abbreviation: nullableText(row.abbreviation),
    active: row.active !== false, createdAt: text(row.created_at), updatedAt: text(row.updated_at),
  };
}

function applyChanges<T extends { id: string }>(
  current: T[],
  changes: InventoryRealtimeChange[],
  map: (row: Row) => T,
) {
  const next = new Map(current.map((row) => [row.id, row]));
  for (const change of changes) {
    const id = text(change.record.id);
    if (!id) continue;
    if (change.operation === "DELETE") next.delete(id);
    else next.set(id, map(change.record));
  }
  return [...next.values()];
}

export function applyInventoryAdminRealtimeChanges(
  current: InventoryAdminData,
  changes: Partial<Record<InventoryRealtimeAdminTable, InventoryRealtimeChange[]>>,
): InventoryAdminData {
  return {
    ...current,
    items: applyChanges(current.items, changes.inventory_items ?? [], mapItem),
    categories: applyChanges(current.categories, changes.inventory_categories ?? [], mapCategory),
    suppliers: applyChanges(current.suppliers, changes.inventory_suppliers ?? [], mapSupplier),
    storageLocations: applyChanges(current.storageLocations, changes.inventory_storage_locations ?? [], mapStorageLocation),
    units: applyChanges(current.units, changes.inventory_units ?? [], mapUnit),
  };
}

export async function loadRealtimeCurrentStock(
  restaurantId: string,
  inventoryItemIds: string[],
): Promise<InventoryCurrentStockRow[]> {
  const uniqueIds = [...new Set(inventoryItemIds)];
  if (!uniqueIds.length) return [];
  const chunks: string[][] = [];
  for (let index = 0; index < uniqueIds.length; index += 100) chunks.push(uniqueIds.slice(index, index + 100));
  const responses = await Promise.all(chunks.map((targetInventoryItemIds) =>
    supabase.rpc("get_inventory_current_stock_items", {
      target_restaurant_id: restaurantId,
      target_inventory_item_ids: targetInventoryItemIds,
    })));
  const failed = responses.find((response) => response.error);
  if (failed?.error) throw new Error(failed.error.message || "Affected inventory stock is unavailable.");
  return responses.flatMap((response) => ((response.data ?? []) as Row[]).map(mapCurrentStock));
}

export async function loadRealtimeLedger(
  restaurantId: string,
  inventoryItemIds: string[],
): Promise<InventoryLedgerEntry[]> {
  const rows = await Promise.all([...new Set(inventoryItemIds)].map((inventoryItemId) =>
    loadLedger(restaurantId, { inventoryItemId, limit: 200 })));
  return rows.flat();
}

export async function loadRealtimeFoodMovements(
  restaurantId: string,
  inventoryItemIds: string[],
): Promise<InventoryFoodConsumptionMovement[]> {
  const rows = await Promise.all([...new Set(inventoryItemIds)].map((inventoryItemId) =>
    loadInventoryMovementHistory(restaurantId, { inventoryItemId, limit: 500 })));
  return rows.flat();
}

export function replaceAffectedStock(
  current: InventoryCurrentStockRow[],
  affectedItemIds: string[],
  replacements: InventoryCurrentStockRow[],
) {
  const affected = new Set(affectedItemIds);
  return [...current.filter((row) => !affected.has(row.inventoryItemId)), ...replacements]
    .sort((left, right) => left.itemName.localeCompare(right.itemName)
      || left.storageLocationName.localeCompare(right.storageLocationName));
}

function mergeNewest<T extends { id: string }>(
  current: T[],
  incoming: T[],
  timestamp: (row: T) => string,
  limit: number,
) {
  const rows = new Map(current.map((row) => [row.id, row]));
  for (const row of incoming) rows.set(row.id, row);
  return [...rows.values()]
    .sort((left, right) => timestamp(right).localeCompare(timestamp(left)) || right.id.localeCompare(left.id))
    .slice(0, limit);
}

export const mergeRealtimeLedger = (current: InventoryLedgerEntry[], incoming: InventoryLedgerEntry[]) =>
  mergeNewest(current, incoming, (row) => row.movementDate, 200);

export const mergeRealtimeFoodMovements = (
  current: InventoryFoodConsumptionMovement[],
  incoming: InventoryFoodConsumptionMovement[],
) => mergeNewest(current, incoming, (row) => row.createdAt, 500);

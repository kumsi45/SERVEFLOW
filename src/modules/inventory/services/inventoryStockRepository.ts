import { supabase } from "../../../core/database";
import type {
  InventoryCurrentStockRow,
  InventoryLedgerEntry,
  InventoryMovementType,
  InventoryQuantityEffect,
  InventoryStockStatus,
} from "../types";

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function movementType(value: unknown): InventoryMovementType {
  const allowed: InventoryMovementType[] = [
    "opening_balance",
    "stock_in",
    "stock_out",
    "transfer_in",
    "transfer_out",
    "adjustment_increase",
    "adjustment_decrease",
    "waste",
    "spoilage",
    "manual_correction",
    "closing_balance",
  ];
  return allowed.includes(value as InventoryMovementType) ? (value as InventoryMovementType) : "manual_correction";
}

function quantityEffect(value: unknown): InventoryQuantityEffect {
  return value === "out" ? "out" : "in";
}

function stockStatus(value: unknown): InventoryStockStatus {
  if (value === "low_stock" || value === "in_stock" || value === "over_stock") return value;
  return "out_of_stock";
}

function errorMessage(error: { message?: string } | null | undefined) {
  return error?.message ?? "Inventory stock request failed.";
}

function mapCurrentStock(row: Row): InventoryCurrentStockRow {
  return {
    inventoryItemId: text(row.inventory_item_id),
    itemName: text(row.item_name),
    categoryId: nullableText(row.category_id),
    categoryName: nullableText(row.category_name),
    storageLocationId: text(row.storage_location_id),
    storageLocationName: text(row.storage_location_name),
    unitId: text(row.unit_id),
    unitName: text(row.unit_name),
    minimumStock: numberValue(row.minimum_stock),
    maximumStock: row.maximum_stock == null ? null : numberValue(row.maximum_stock),
    currentQuantity: numberValue(row.current_quantity),
    stockStatus: stockStatus(row.stock_status),
    lastMovementAt: nullableText(row.last_movement_at),
  };
}

function mapLedgerEntry(row: Row): InventoryLedgerEntry {
  return {
    id: text(row.id),
    inventoryItemId: text(row.inventory_item_id),
    itemName: text(row.item_name),
    storageLocationId: text(row.storage_location_id),
    storageLocationName: text(row.storage_location_name),
    supplierId: nullableText(row.supplier_id),
    supplierName: nullableText(row.supplier_name),
    movementType: movementType(row.movement_type),
    quantity: numberValue(row.quantity),
    quantityEffect: quantityEffect(row.quantity_effect),
    signedQuantity: numberValue(row.signed_quantity),
    unitName: text(row.unit_name),
    referenceNumber: nullableText(row.reference_number),
    invoiceNumber: nullableText(row.invoice_number),
    reason: nullableText(row.reason),
    notes: nullableText(row.notes),
    transferGroupId: nullableText(row.transfer_group_id),
    movementDate: text(row.movement_date),
    createdByStaffId: text(row.created_by_staff_id),
    staffName: nullableText(row.staff_name),
  };
}

export async function loadInventoryCurrentStock(restaurantId: string): Promise<InventoryCurrentStockRow[]> {
  const { data, error } = await supabase.rpc("get_inventory_current_stock", {
    target_restaurant_id: restaurantId,
  });
  if (error) throw new Error(errorMessage(error));
  return ((data ?? []) as Row[]).map(mapCurrentStock);
}

export async function loadInventoryLedger(
  restaurantId: string,
  filters: { inventoryItemId?: string; storageLocationId?: string; limit?: number } = {},
): Promise<InventoryLedgerEntry[]> {
  const { data, error } = await supabase.rpc("get_inventory_ledger", {
    target_restaurant_id: restaurantId,
    target_inventory_item_id: filters.inventoryItemId || null,
    target_storage_location_id: filters.storageLocationId || null,
    target_limit: filters.limit ?? 200,
  });
  if (error) throw new Error(errorMessage(error));
  return ((data ?? []) as Row[]).map(mapLedgerEntry);
}

export async function recordInventoryMovement(args: {
  restaurantId: string;
  inventoryItemId: string;
  storageLocationId: string;
  movementType: InventoryMovementType;
  quantity: number;
  quantityEffect?: InventoryQuantityEffect;
  supplierId?: string | null;
  referenceNumber?: string | null;
  invoiceNumber?: string | null;
  reason?: string | null;
  notes?: string | null;
  movementDate?: string | null;
}) {
  const { error } = await supabase.rpc("record_inventory_movement", {
    target_restaurant_id: args.restaurantId,
    target_inventory_item_id: args.inventoryItemId,
    target_storage_location_id: args.storageLocationId,
    target_movement_type: args.movementType,
    target_quantity: args.quantity,
    target_quantity_effect: args.quantityEffect ?? null,
    target_supplier_id: args.supplierId ?? null,
    target_reference_number: args.referenceNumber ?? null,
    target_invoice_number: args.invoiceNumber ?? null,
    target_reason: args.reason ?? null,
    target_notes: args.notes ?? null,
    target_movement_date: args.movementDate || null,
  });
  if (error) throw new Error(errorMessage(error));
}

export async function recordInventoryTransfer(args: {
  restaurantId: string;
  inventoryItemId: string;
  fromStorageLocationId: string;
  toStorageLocationId: string;
  quantity: number;
  referenceNumber?: string | null;
  reason?: string | null;
  notes?: string | null;
  movementDate?: string | null;
}) {
  const { error } = await supabase.rpc("record_inventory_transfer", {
    target_restaurant_id: args.restaurantId,
    target_inventory_item_id: args.inventoryItemId,
    target_from_storage_location_id: args.fromStorageLocationId,
    target_to_storage_location_id: args.toStorageLocationId,
    target_quantity: args.quantity,
    target_reference_number: args.referenceNumber ?? null,
    target_reason: args.reason ?? null,
    target_notes: args.notes ?? null,
    target_movement_date: args.movementDate || null,
  });
  if (error) throw new Error(errorMessage(error));
}

export async function recordInventoryAdjustment(args: {
  restaurantId: string;
  inventoryItemId: string;
  storageLocationId: string;
  direction: "increase" | "decrease";
  quantity: number;
  reason: string;
  notes?: string | null;
  movementDate?: string | null;
}) {
  const { error } = await supabase.rpc("record_inventory_adjustment", {
    target_restaurant_id: args.restaurantId,
    target_inventory_item_id: args.inventoryItemId,
    target_storage_location_id: args.storageLocationId,
    target_quantity: args.quantity,
    target_direction: args.direction,
    target_reason: args.reason,
    target_notes: args.notes ?? null,
    target_movement_date: args.movementDate || null,
  });
  if (error) throw new Error(errorMessage(error));
}

export async function recordInventoryWaste(args: {
  restaurantId: string;
  inventoryItemId: string;
  storageLocationId: string;
  quantity: number;
  reason: string;
  isSpoilage: boolean;
  notes?: string | null;
  movementDate?: string | null;
}) {
  const { error } = await supabase.rpc("record_inventory_waste", {
    target_restaurant_id: args.restaurantId,
    target_inventory_item_id: args.inventoryItemId,
    target_storage_location_id: args.storageLocationId,
    target_quantity: args.quantity,
    target_reason: args.reason,
    target_is_spoilage: args.isSpoilage,
    target_notes: args.notes ?? null,
    target_movement_date: args.movementDate || null,
  });
  if (error) throw new Error(errorMessage(error));
}

export async function recordInventoryOpeningBalance(args: {
  restaurantId: string;
  inventoryItemId: string;
  storageLocationId: string;
  quantity: number;
  referenceNumber?: string | null;
  notes?: string | null;
  movementDate?: string | null;
}) {
  const { error } = await supabase.rpc("record_inventory_opening_balance", {
    target_restaurant_id: args.restaurantId,
    target_inventory_item_id: args.inventoryItemId,
    target_storage_location_id: args.storageLocationId,
    target_quantity: args.quantity,
    target_reference_number: args.referenceNumber ?? null,
    target_notes: args.notes ?? null,
    target_movement_date: args.movementDate || null,
  });
  if (error) throw new Error(errorMessage(error));
}

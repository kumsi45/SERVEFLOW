import { createBrowserUuid } from "../../../core/browser/createBrowserUuid";
import { supabase } from "../../../core/database";
import type {
  InventoryAdjustment,
  InventoryAdjustmentDirection,
  InventoryAdjustmentForm,
  InventoryAdjustmentHistoryItem,
  InventoryAdjustmentMovementType,
  InventoryAdjustmentType,
  InventoryCorrectionReason,
  InventoryCurrentStockRow,
  InventoryItem,
  InventoryStorageLocation,
} from "../types";

type Row = Record<string, unknown>;

export const INCREASE_CORRECTION_REASONS: InventoryCorrectionReason[] = [
  "opening_stock", "manual_correction", "stock_count_difference", "data_entry_correction", "other_correction",
];

export const DECREASE_CORRECTION_REASONS: InventoryCorrectionReason[] = [
  "manual_correction", "stock_count_difference", "data_entry_correction", "other_correction",
];

export const CORRECTION_REASON_LABELS: Record<InventoryCorrectionReason, string> = {
  opening_stock: "Opening Stock",
  manual_correction: "Manual Correction",
  stock_count_difference: "Stock Count Difference",
  data_entry_correction: "Data Entry Correction",
  other_correction: "Other Correction",
};

export const ADJUSTMENT_TYPE_LABELS: Record<InventoryAdjustmentType, string> = {
  opening_stock: "Opening Stock",
  manual_correction: "Manual Correction",
  donation_received: "Donation Received",
  supplier_replacement: "Supplier Replacement",
  waste: "Waste",
  spoilage: "Spoilage",
  expired: "Expired",
  breakage: "Breakage",
  theft: "Theft",
  returned_to_supplier: "Returned to Supplier",
};

const text = (value: unknown) => typeof value === "string" ? value : "";
const nullableText = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
const numberValue = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

function mapItem(row: Row): InventoryAdjustmentHistoryItem {
  return {
    id: text(row.id),
    inventoryItemId: text(row.inventory_item_id),
    inventoryItemName: text(row.inventory_item_name),
    storageLocationId: nullableText(row.storage_location_id),
    storageLocationName: nullableText(row.storage_location_name),
    unitId: text(row.unit_id),
    unitName: text(row.unit_name),
    quantity: numberValue(row.quantity),
    quantityBefore: numberValue(row.quantity_before),
    quantityAfter: numberValue(row.quantity_after),
    movementAuditType: text(row.movement_audit_type) as InventoryAdjustmentMovementType,
    movementId: text(row.movement_id),
  };
}

export function mapInventoryAdjustmentRow(row: Row): InventoryAdjustment {
  return {
    id: text(row.id),
    restaurantId: text(row.restaurant_id),
    direction: text(row.direction) as InventoryAdjustmentDirection,
    adjustmentType: text(row.adjustment_type) as InventoryAdjustmentType,
    reason: text(row.reason),
    notes: nullableText(row.notes),
    status: "confirmed",
    createdBy: text(row.created_by),
    createdByName: text(row.created_by_name),
    approvedBy: nullableText(row.approved_by),
    approvedByName: nullableText(row.approved_by_name),
    approvedAt: nullableText(row.approved_at),
    createdAt: text(row.created_at),
    itemCount: numberValue(row.item_count),
    totalQuantity: numberValue(row.total_quantity),
    items: Array.isArray(row.items) ? (row.items as Row[]).map(mapItem) : [],
  };
}

export async function loadInventoryAdjustments(restaurantId: string) {
  const { data, error } = await supabase.rpc("get_inventory_adjustments", {
    target_restaurant_id: restaurantId,
  });
  if (error) throw new Error(error.message || "Inventory adjustment history is unavailable.");
  return ((data ?? []) as Row[]).map(mapInventoryAdjustmentRow);
}

export function validCorrectionReasons(direction: InventoryAdjustmentDirection) {
  return direction === "increase" ? INCREASE_CORRECTION_REASONS : DECREASE_CORRECTION_REASONS;
}

export function validateInventoryAdjustment(
  form: InventoryAdjustmentForm,
  items: InventoryItem[],
  currentStock: InventoryCurrentStockRow[],
  storageLocations: InventoryStorageLocation[],
) {
  const errors: string[] = [];
  if (!validCorrectionReasons(form.direction).includes(form.correctionReason as InventoryCorrectionReason)) {
    errors.push("Select a valid reason for the adjustment direction.");
  }
  if (form.notes.trim().length > 1000) errors.push("Notes cannot exceed 1,000 characters.");
  if (!form.lines.length) errors.push("Add at least one ingredient.");
  const itemIds = new Set<string>();
  for (const [index, line] of form.lines.entries()) {
    const label = `Line ${index + 1}`;
    const item = items.find((candidate) => candidate.id === line.inventoryItemId);
    if (!item || item.status !== "active") errors.push(`${label}: select an active ingredient.`);
    const storage = storageLocations.find((candidate) => candidate.id === line.storageLocationId);
    if (!storage || storage.status !== "active" || (item && storage.restaurantId !== item.restaurantId)) {
      errors.push(`${label}: select an active same-restaurant storage location.`);
    }
    if (itemIds.has(line.inventoryItemId)) errors.push(`${label}: ingredients cannot be duplicated.`);
    if (line.inventoryItemId) itemIds.add(line.inventoryItemId);
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors.push(`${label}: quantity must be greater than zero.`);
    } else if (Math.round(quantity * 1000) !== quantity * 1000) {
      errors.push(`${label}: quantity supports at most three decimal places.`);
    }
    if (form.direction === "decrease" && Number.isFinite(quantity) && quantity > 0) {
      const available = currentStock
        .filter((stock) => stock.inventoryItemId === line.inventoryItemId && stock.storageLocationId === line.storageLocationId)
        .reduce((sum, stock) => sum + stock.currentQuantity, 0);
      if (quantity > available) errors.push(`${label}: quantity exceeds current stock.`);
    }
  }
  return errors;
}

function canonicalRequest(form: InventoryAdjustmentForm) {
  return JSON.stringify({
    direction: form.direction,
    correction_reason: form.correctionReason,
    notes: form.notes.trim() || null,
    lines: form.lines.map((line) => ({
      inventory_item_id: line.inventoryItemId,
      storage_location_id: line.storageLocationId,
      quantity: Number(line.quantity),
    })).sort((left, right) => left.inventory_item_id.localeCompare(right.inventory_item_id)),
  });
}

const CORRECTION_REASON_PREFIX = "Correction reason: ";

function backendAdjustmentType(form: InventoryAdjustmentForm): InventoryAdjustmentType {
  return form.correctionReason === "opening_stock" ? "opening_stock" : "manual_correction";
}

function auditNotes(form: InventoryAdjustmentForm) {
  const reason = CORRECTION_REASON_LABELS[form.correctionReason as InventoryCorrectionReason];
  const note = form.notes.trim();
  return `${CORRECTION_REASON_PREFIX}${reason}${note ? `\n${note}` : ""}`;
}

export function correctionHistoryPresentation(adjustment: InventoryAdjustment) {
  const notes = adjustment.notes ?? "";
  if (notes.startsWith(CORRECTION_REASON_PREFIX)) {
    const [reasonLine, ...noteLines] = notes.split("\n");
    return { reason: reasonLine.slice(CORRECTION_REASON_PREFIX.length), note: noteLines.join("\n").trim() || null };
  }
  return { reason: adjustment.reason, note: adjustment.notes };
}

function idempotencyKey(restaurantId: string, request: string) {
  const storageKey = `serveflow.inventory-adjustment:${restaurantId}`;
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null") as { key?: string; request?: string } | null;
    if (stored?.key && stored.request === request) return { key: stored.key, storageKey };
  } catch {
    window.sessionStorage.removeItem(storageKey);
  }
  const key = createBrowserUuid();
  window.sessionStorage.setItem(storageKey, JSON.stringify({ key, request }));
  return { key, storageKey };
}

export async function confirmInventoryAdjustment(
  restaurantId: string,
  form: InventoryAdjustmentForm,
  items: InventoryItem[],
  currentStock: InventoryCurrentStockRow[],
  storageLocations: InventoryStorageLocation[],
) {
  const errors = validateInventoryAdjustment(form, items, currentStock, storageLocations);
  if (errors.length) throw new Error(errors.join(" "));
  const request = canonicalRequest(form);
  const idempotency = idempotencyKey(restaurantId, request);
  const { data, error } = await supabase.rpc("confirm_inventory_storage_adjustment", {
    target_restaurant_id: restaurantId,
    target_idempotency_key: idempotency.key,
    target_direction: form.direction,
    target_adjustment_type: backendAdjustmentType(form),
    target_notes: auditNotes(form),
    target_lines: form.lines.map((line) => ({
      inventory_item_id: line.inventoryItemId,
      storage_location_id: line.storageLocationId,
      quantity: Number(line.quantity),
    })),
  });
  if (error) throw new Error(error.message || "Inventory adjustment could not be confirmed.");
  window.sessionStorage.removeItem(idempotency.storageKey);
  return data as { adjustment_id: string; status: "confirmed"; already_processed: boolean };
}

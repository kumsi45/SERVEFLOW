import { createBrowserUuid } from "../../../core/browser/createBrowserUuid";
import { supabase } from "../../../core/database";
import type {
  InventoryAdjustment,
  InventoryAdjustmentDirection,
  InventoryAdjustmentForm,
  InventoryAdjustmentHistoryItem,
  InventoryAdjustmentMovementType,
  InventoryAdjustmentType,
  InventoryCurrentStockRow,
  InventoryItem,
} from "../types";

type Row = Record<string, unknown>;

export const INCREASE_ADJUSTMENT_TYPES: InventoryAdjustmentType[] = [
  "opening_stock", "manual_correction", "donation_received", "supplier_replacement",
];

export const DECREASE_ADJUSTMENT_TYPES: InventoryAdjustmentType[] = [
  "waste", "spoilage", "expired", "breakage", "theft",
  "manual_correction", "returned_to_supplier",
];

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

export function validAdjustmentTypes(direction: InventoryAdjustmentDirection) {
  return direction === "increase" ? INCREASE_ADJUSTMENT_TYPES : DECREASE_ADJUSTMENT_TYPES;
}

export function validateInventoryAdjustment(
  form: InventoryAdjustmentForm,
  items: InventoryItem[],
  currentStock: InventoryCurrentStockRow[],
) {
  const errors: string[] = [];
  if (!validAdjustmentTypes(form.direction).includes(form.adjustmentType as InventoryAdjustmentType)) {
    errors.push("Select a valid reason for the adjustment direction.");
  }
  if (form.notes.trim().length > 1000) errors.push("Notes cannot exceed 1,000 characters.");
  if (!form.lines.length) errors.push("Add at least one ingredient.");
  const itemIds = new Set<string>();
  for (const [index, line] of form.lines.entries()) {
    const label = `Line ${index + 1}`;
    const item = items.find((candidate) => candidate.id === line.inventoryItemId);
    if (!item || item.status !== "active") errors.push(`${label}: select an active ingredient.`);
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
        .filter((stock) => stock.inventoryItemId === line.inventoryItemId)
        .reduce((sum, stock) => sum + stock.currentQuantity, 0);
      if (quantity > available) errors.push(`${label}: quantity exceeds current stock.`);
    }
  }
  return errors;
}

function canonicalRequest(form: InventoryAdjustmentForm) {
  return JSON.stringify({
    direction: form.direction,
    adjustment_type: form.adjustmentType,
    notes: form.notes.trim() || null,
    lines: form.lines.map((line) => ({
      inventory_item_id: line.inventoryItemId,
      quantity: Number(line.quantity),
    })).sort((left, right) => left.inventory_item_id.localeCompare(right.inventory_item_id)),
  });
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
) {
  const errors = validateInventoryAdjustment(form, items, currentStock);
  if (errors.length) throw new Error(errors.join(" "));
  const request = canonicalRequest(form);
  const idempotency = idempotencyKey(restaurantId, request);
  const { data, error } = await supabase.rpc("confirm_inventory_adjustment", {
    target_restaurant_id: restaurantId,
    target_idempotency_key: idempotency.key,
    target_direction: form.direction,
    target_adjustment_type: form.adjustmentType,
    target_notes: form.notes.trim() || null,
    target_lines: form.lines.map((line) => ({
      inventory_item_id: line.inventoryItemId,
      quantity: Number(line.quantity),
    })),
  });
  if (error) throw new Error(error.message || "Inventory adjustment could not be confirmed.");
  window.sessionStorage.removeItem(idempotency.storageKey);
  return data as { adjustment_id: string; status: "confirmed"; already_processed: boolean };
}

import { supabase } from "../../../core/database";
import type { InventoryItem, InventorySupplier, InventoryUnit } from "../../inventory/types";
import type {
  PurchaseOrderDraft,
  PurchaseOrderDraftForm,
  PurchaseOrderDraftLine,
} from "../types";

type Row = Record<string, unknown>;

const text = (value: unknown) => typeof value === "string" ? value : "";
const nullableText = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
const numberValue = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

function mapLine(row: Row): PurchaseOrderDraftLine {
  return {
    id: text(row.id),
    inventoryItemId: text(row.inventory_item_id),
    inventoryItemName: text(row.inventory_item_name),
    purchaseUnitId: text(row.purchase_unit_id),
    purchaseUnitName: text(row.purchase_unit_name),
    quantity: numberValue(row.quantity),
    unitPrice: numberValue(row.unit_price),
    lineTotal: numberValue(row.line_total),
    sortOrder: numberValue(row.sort_order),
  };
}

export function mapPurchaseOrderDraftRow(row: Row): PurchaseOrderDraft {
  return {
    id: text(row.id),
    restaurantId: text(row.restaurant_id),
    supplierId: text(row.supplier_id),
    supplierName: text(row.supplier_name),
    status: "draft",
    expectedDeliveryDate: text(row.expected_delivery_date),
    notes: nullableText(row.notes),
    createdByStaffId: text(row.created_by_staff_id),
    createdByName: text(row.created_by_name),
    updatedByStaffId: text(row.updated_by_staff_id),
    updatedByName: text(row.updated_by_name),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    lineCount: numberValue(row.line_count),
    total: numberValue(row.total),
    lines: Array.isArray(row.lines) ? (row.lines as Row[]).map(mapLine) : [],
  };
}

export async function loadPurchaseOrderDrafts(restaurantId: string): Promise<PurchaseOrderDraft[]> {
  const { data, error } = await supabase.rpc("get_purchase_order_drafts", {
    target_restaurant_id: restaurantId,
  });
  if (error) throw new Error(error.message || "Purchase order drafts are unavailable.");
  return ((data ?? []) as Row[]).map(mapPurchaseOrderDraftRow);
}

export function validatePurchaseOrderDraft(
  form: PurchaseOrderDraftForm,
  suppliers: InventorySupplier[],
  items: InventoryItem[],
  units: InventoryUnit[],
) {
  const errors: string[] = [];
  if (!suppliers.some((supplier) => supplier.id === form.supplierId && supplier.status === "active")) {
    errors.push("Select an active supplier.");
  }
  if (!form.expectedDeliveryDate) errors.push("Expected delivery date is required.");
  if (form.notes.trim().length > 2000) errors.push("Notes cannot exceed 2,000 characters.");
  if (!form.lines.length) errors.push("Add at least one inventory item.");
  const itemIds = new Set<string>();
  for (const [index, line] of form.lines.entries()) {
    const label = `Line ${index + 1}`;
    if (!items.some((item) => item.id === line.inventoryItemId && item.status === "active")) {
      errors.push(`${label}: select an active inventory item.`);
    }
    if (itemIds.has(line.inventoryItemId)) errors.push(`${label}: inventory items cannot be duplicated.`);
    if (line.inventoryItemId) itemIds.add(line.inventoryItemId);
    if (!units.some((unit) => unit.id === line.purchaseUnitId && unit.status === "active" && unit.active)) {
      errors.push(`${label}: select an active purchase unit.`);
    }
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) errors.push(`${label}: quantity must be greater than zero.`);
    const unitPrice = Number(line.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) errors.push(`${label}: unit price cannot be negative.`);
  }
  return errors;
}

export const purchaseOrderLineTotal = (quantity: string | number, unitPrice: string | number) => {
  const parsedQuantity = Number(quantity);
  const parsedPrice = Number(unitPrice);
  return Number.isFinite(parsedQuantity) && Number.isFinite(parsedPrice) ? parsedQuantity * parsedPrice : 0;
};

export const purchaseOrderTotal = (form: Pick<PurchaseOrderDraftForm, "lines">) =>
  form.lines.reduce((total, line) => total + purchaseOrderLineTotal(line.quantity, line.unitPrice), 0);

export async function savePurchaseOrderDraft(
  restaurantId: string,
  form: PurchaseOrderDraftForm,
  suppliers: InventorySupplier[],
  items: InventoryItem[],
  units: InventoryUnit[],
) {
  const errors = validatePurchaseOrderDraft(form, suppliers, items, units);
  if (errors.length) throw new Error(errors.join(" "));
  const { data, error } = await supabase.rpc("save_purchase_order_draft", {
    target_restaurant_id: restaurantId,
    payload: {
      id: form.id ?? null,
      status: "draft",
      supplier_id: form.supplierId,
      expected_delivery_date: form.expectedDeliveryDate,
      notes: form.notes.trim() || null,
      lines: form.lines.map((line, sortOrder) => ({
        inventory_item_id: line.inventoryItemId,
        purchase_unit_id: line.purchaseUnitId,
        quantity: Number(line.quantity),
        unit_price: Number(line.unitPrice),
        sort_order: sortOrder,
      })),
    },
  });
  if (error) throw new Error(error.message || "Purchase order draft could not be saved.");
  return String(data);
}

export async function deletePurchaseOrderDraft(restaurantId: string, purchaseOrderId: string) {
  const { data, error } = await supabase.rpc("delete_purchase_order_draft", {
    target_restaurant_id: restaurantId,
    target_purchase_order_id: purchaseOrderId,
  });
  if (error) throw new Error(error.message || "Purchase order draft could not be deleted.");
  return data === true;
}

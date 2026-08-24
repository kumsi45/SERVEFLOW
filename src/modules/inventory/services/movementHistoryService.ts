import { supabase } from "../../../core/database";
import type { InventoryFoodConsumptionMovement } from "../types";

type Row = Record<string, unknown>;

const text = (value: unknown) => typeof value === "string" ? value : "";
const nullableText = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
const numberValue = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function mapInventoryMovementHistoryRow(row: Row): InventoryFoodConsumptionMovement {
  return {
    id: text(row.id),
    restaurantId: text(row.restaurant_id),
    inventoryItemId: text(row.inventory_item_id),
    inventoryItemName: text(row.inventory_item_name),
    menuItemId: text(row.menu_item_id),
    menuItemName: text(row.menu_item_name),
    recipeId: nullableText(row.recipe_id),
    recipeName: nullableText(row.recipe_name),
    orderId: text(row.order_id),
    orderNumber: text(row.order_number),
    orderItemId: text(row.order_item_id),
    diningSessionId: text(row.dining_session_id),
    diningSessionNumber: text(row.dining_session_number),
    kitchenBatchId: text(row.kitchen_batch_id),
    waiterId: nullableText(row.waiter_id),
    waiterName: nullableText(row.waiter_name),
    cashierId: nullableText(row.cashier_id),
    cashierName: nullableText(row.cashier_name),
    kitchenStationId: nullableText(row.kitchen_station_id),
    kitchenStationName: nullableText(row.kitchen_station_name),
    performedByStaffId: text(row.performed_by_staff_id),
    performedByName: text(row.performed_by_name),
    movementType: "FOOD_CONSUMPTION",
    quantity: numberValue(row.quantity),
    unit: text(row.unit),
    quantityBefore: numberValue(row.quantity_before),
    quantityAfter: numberValue(row.quantity_after),
    createdAt: text(row.created_at),
    workflowSnapshot: row.workflow_snapshot && typeof row.workflow_snapshot === "object"
      ? row.workflow_snapshot as Record<string, unknown>
      : {},
    notes: nullableText(row.notes),
  };
}

export async function loadInventoryMovementHistory(
  restaurantId: string,
  filters: { inventoryItemId?: string; limit?: number } = {},
): Promise<InventoryFoodConsumptionMovement[]> {
  const { data, error } = await supabase.rpc("get_inventory_movement_history", {
    target_restaurant_id: restaurantId,
    target_inventory_item_id: filters.inventoryItemId || null,
    result_limit: filters.limit ?? 500,
  });
  if (error) {
    console.error("Inventory movement history RPC failed.", error);
    throw new Error("Inventory movement history is unavailable.");
  }
  return ((data ?? []) as Row[]).map(mapInventoryMovementHistoryRow);
}

import { loadInventoryLedger } from "./inventoryStockRepository";

export async function loadLedger(
  restaurantId: string,
  filters: { inventoryItemId?: string; storageLocationId?: string; limit?: number } = {},
) {
  return loadInventoryLedger(restaurantId, filters);
}

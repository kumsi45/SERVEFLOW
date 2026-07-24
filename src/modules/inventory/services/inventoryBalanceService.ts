import { loadInventoryCurrentStock } from "./inventoryStockRepository";

export async function loadCurrentStock(restaurantId: string) {
  return loadInventoryCurrentStock(restaurantId);
}

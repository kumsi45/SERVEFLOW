import { supabase } from "../../../core/database";
import { loadInventoryCurrentStock } from "../../inventory/services/inventoryStockRepository";
import {
  loadInventoryIntelligence,
  loadInventoryRequests,
} from "../../kitchen/services/inventoryRequestService";
import type {
  InventoryRequest,
  InventoryIntelligence,
} from "../../kitchen/services/inventoryRequestService";

export type ManagerStockItem = {
  id: string;
  name: string;
  category: string;
  unit: string;
  current: number;
  minimum: number;
  status: "out" | "critical" | "low" | "healthy";
  storage: string;
  affectedMenuItems: string[];
  usage: InventoryIntelligence | null;
};
export type ManagerInventorySnapshot = {
  stock: ManagerStockItem[];
  requests: InventoryRequest[];
};

type MenuRow = {
  name?: string | null;
  direct_inventory_item_id?: string | null;
  recipe_id?: string | null;
};
type IngredientRow = {
  recipe_id?: string | null;
  inventory_item_id?: string | null;
};

export async function loadManagerInventoryWorkspace(
  restaurantId: string,
): Promise<ManagerInventorySnapshot> {
  const [
    stockRows,
    requests,
    intelligenceResult,
    menuResult,
    ingredientResult,
  ] = await Promise.all([
    loadInventoryCurrentStock(restaurantId),
    loadInventoryRequests(restaurantId),
    loadInventoryIntelligence(restaurantId).catch(() => []),
    supabase
      .from("menu_items")
      .select("name,direct_inventory_item_id,recipe_id")
      .eq("restaurant_id", restaurantId),
    supabase
      .from("recipe_ingredients")
      .select("recipe_id,inventory_item_id")
      .eq("restaurant_id", restaurantId),
  ]);
  if (menuResult.error) throw new Error(menuResult.error.message);
  if (ingredientResult.error) throw new Error(ingredientResult.error.message);

  const menus = (menuResult.data ?? []) as MenuRow[];
  const recipeItems = new Map<string, string[]>();
  menus.forEach((row) => {
    if (!row.recipe_id || !row.name) return;
    recipeItems.set(row.recipe_id, [
      ...(recipeItems.get(row.recipe_id) ?? []),
      row.name,
    ]);
  });
  const affected = new Map<string, Set<string>>();
  menus.forEach((row) => {
    if (!row.direct_inventory_item_id || !row.name) return;
    const inventoryItemId = row.direct_inventory_item_id;
    const menuName = row.name;
    if (!affected.has(inventoryItemId))
      affected.set(inventoryItemId, new Set());
    affected.get(inventoryItemId)!.add(menuName);
  });
  ((ingredientResult.data ?? []) as IngredientRow[]).forEach((row) => {
    if (!row.inventory_item_id || !row.recipe_id) return;
    const inventoryItemId = row.inventory_item_id;
    const recipeId = row.recipe_id;
    if (!affected.has(inventoryItemId))
      affected.set(inventoryItemId, new Set());
    (recipeItems.get(recipeId) ?? []).forEach((name) =>
      affected.get(inventoryItemId)!.add(name),
    );
  });

  const usage = new Map(intelligenceResult.map((item) => [item.id, item]));
  const grouped = new Map<string, ManagerStockItem>();
  stockRows.forEach((row) => {
    const existing = grouped.get(row.inventoryItemId);
    if (existing) {
      existing.current += row.currentQuantity;
      existing.minimum += row.minimumStock;
      existing.storage = `${existing.storage}, ${row.storageLocationName}`;
      return;
    }
    grouped.set(row.inventoryItemId, {
      id: row.inventoryItemId,
      name: row.itemName,
      category: row.categoryName ?? "Uncategorized",
      unit: row.unitName,
      current: row.currentQuantity,
      minimum: row.minimumStock,
      status: "healthy",
      storage: row.storageLocationName,
      affectedMenuItems: [...(affected.get(row.inventoryItemId) ?? [])],
      usage: usage.get(row.inventoryItemId) ?? null,
    });
  });
  const stock = [...grouped.values()].map((item) => ({
    ...item,
    status: stockStatus(item.current, item.minimum),
  }));
  return {
    stock: stock.sort(
      (a, b) =>
        statusRank(a.status) - statusRank(b.status) ||
        a.name.localeCompare(b.name),
    ),
    requests,
  };
}

function stockStatus(
  current: number,
  minimum: number,
): ManagerStockItem["status"] {
  if (current <= 0) return "out";
  if (minimum > 0 && current <= minimum) return "critical";
  if (minimum > 0 && current <= minimum * 2) return "low";
  return "healthy";
}
function statusRank(value: ManagerStockItem["status"]) {
  return { out: 0, critical: 1, low: 2, healthy: 3 }[value];
}

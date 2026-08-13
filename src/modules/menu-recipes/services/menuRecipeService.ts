import { supabase } from "../../../core/database";

export type MenuRecipeOption = { id: string; recipe_code: string; name: string };
export type DirectInventoryOption = { id: string; name: string; sku: string | null; barcode: string | null };
export type RecipeMenuUsage = { count: number; items: Array<{ id: string; name: string; available: boolean }> };
export type MenuRecipeLink = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: number;
  category_id: string | null;
  category_name: string | null;
  kitchen_station_id: string | null;
  available: boolean;
  recipe_id: string | null;
  recipe_name: string | null;
  recipe_status: string | null;
  direct_inventory_item_id: string | null;
  direct_inventory_item_name: string | null;
};

export async function searchActiveMenuRecipes(restaurantId: string, search = ""): Promise<MenuRecipeOption[]> {
  const { data, error } = await supabase.rpc("list_active_menu_recipes", {
    target_restaurant_id: restaurantId, search_text: search || null, result_limit: 50,
  });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []) as MenuRecipeOption[];
}

export async function searchActiveDirectInventoryItems(restaurantId: string, search = ""): Promise<DirectInventoryOption[]> {
  const { data, error } = await supabase.rpc("list_active_direct_menu_inventory_items", {
    target_restaurant_id: restaurantId, search_text: search || null, result_limit: 50,
  });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []) as DirectInventoryOption[];
}

export async function linkMenuItemRecipe(
  restaurantId: string,
  menuItemId: string,
  recipeId: string | null,
  directInventoryItemId: string | null = null,
) {
  const { error } = await supabase.rpc("link_menu_item_recipe", {
    target_restaurant_id: restaurantId,
    target_menu_item_id: menuItemId,
    target_recipe_id: recipeId,
    target_direct_inventory_item_id: directInventoryItemId,
  });
  if (error) throw new Error(error.message);
}

export async function fetchRecipeMenuUsage(restaurantId: string, recipeId: string): Promise<RecipeMenuUsage> {
  const { data, error } = await supabase.rpc("get_recipe_used_by", {
    target_restaurant_id: restaurantId, target_recipe_id: recipeId,
  });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as Partial<RecipeMenuUsage>;
  return { count: Number(result.count ?? 0), items: result.items ?? [] };
}

export async function fetchMenuRecipeLinks(restaurantId: string): Promise<MenuRecipeLink[]> {
  const { data, error } = await supabase.from("menu_items")
    .select("id,name,description,image_url,price,category_id,kitchen_station_id,available,recipe_id,direct_inventory_item_id,categories!menu_items_category_same_restaurant(name),recipes!menu_items_recipe_same_restaurant(name,status),inventory_items!menu_items_direct_inventory_item_same_restaurant(name)")
    .eq("restaurant_id", restaurantId).is("archived_at", null).order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: Record<string, unknown>) => {
    const recipe = Array.isArray(row.recipes) ? row.recipes[0] : row.recipes;
    const inventoryItem = Array.isArray(row.inventory_items) ? row.inventory_items[0] : row.inventory_items;
    const category = Array.isArray(row.categories) ? row.categories[0] : row.categories;
    return {
      id: String(row.id),
      name: String(row.name),
      description: row.description ? String(row.description) : null,
      image_url: row.image_url ? String(row.image_url) : null,
      price: Number(row.price ?? 0),
      category_id: row.category_id ? String(row.category_id) : null,
      category_name: (category as { name?: string } | null)?.name ?? null,
      kitchen_station_id: row.kitchen_station_id ? String(row.kitchen_station_id) : null,
      available: Boolean(row.available),
      recipe_id: row.recipe_id ? String(row.recipe_id) : null,
      recipe_name: (recipe as { name?: string } | null)?.name ?? null,
      recipe_status: (recipe as { status?: string } | null)?.status ?? null,
      direct_inventory_item_id: row.direct_inventory_item_id ? String(row.direct_inventory_item_id) : null,
      direct_inventory_item_name: (inventoryItem as { name?: string } | null)?.name ?? null,
    };
  });
}

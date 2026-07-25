import { supabase } from "../../../core/database";

export type MenuRecipeOption = { id: string; recipe_code: string; name: string };
export type RecipeMenuUsage = { count: number; items: Array<{ id: string; name: string; available: boolean }> };
export type MenuRecipeLink = { id: string; name: string; available: boolean; recipe_id: string | null; recipe_name: string | null; recipe_status: string | null };

export async function searchActiveMenuRecipes(restaurantId: string, search = ""): Promise<MenuRecipeOption[]> {
  const { data, error } = await supabase.rpc("list_active_menu_recipes", {
    target_restaurant_id: restaurantId, search_text: search || null, result_limit: 50,
  });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []) as MenuRecipeOption[];
}

export async function linkMenuItemRecipe(restaurantId: string, menuItemId: string, recipeId: string | null) {
  const { error } = await supabase.rpc("link_menu_item_recipe", {
    target_restaurant_id: restaurantId, target_menu_item_id: menuItemId, target_recipe_id: recipeId,
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
    .select("id,name,available,recipe_id,recipes!menu_items_recipe_same_restaurant(name,status)")
    .eq("restaurant_id", restaurantId).is("archived_at", null).order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: Record<string, unknown>) => {
    const recipe = Array.isArray(row.recipes) ? row.recipes[0] : row.recipes;
    return { id: String(row.id), name: String(row.name), available: Boolean(row.available), recipe_id: row.recipe_id ? String(row.recipe_id) : null, recipe_name: (recipe as { name?: string } | null)?.name ?? null, recipe_status: (recipe as { status?: string } | null)?.status ?? null };
  });
}


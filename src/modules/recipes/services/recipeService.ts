import { supabase } from "../../../core/database";
import type { Recipe, RecipeCategory, RecipeDraft, RecipeFilters, RecipePage } from "../types";

export async function fetchRecipeCategories(restaurantId: string): Promise<RecipeCategory[]> {
  const { data, error } = await supabase.from("recipe_categories")
    .select("id,name,description").eq("restaurant_id", restaurantId)
    .is("archived_at", null).order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as RecipeCategory[];
}

export async function createRecipeCategory(restaurantId: string, name: string) {
  const { error } = await supabase.from("recipe_categories").insert({ restaurant_id: restaurantId, name });
  if (error) throw new Error(error.message);
}

export async function fetchRecipes(restaurantId: string, filters: RecipeFilters): Promise<RecipePage> {
  const { data, error } = await supabase.rpc("list_recipes", {
    target_restaurant_id: restaurantId, search_text: filters.search || null,
    category_filter: filters.categoryId || null, status_filter: filters.status || "all",
    preparation_filter: filters.preparation || "all", sort_order: filters.sort,
    page_number: filters.page, page_size: filters.pageSize,
  });
  if (error) throw new Error(error.message);
  const payload = (data ?? {}) as Partial<RecipePage>;
  return { items: payload.items ?? [], total: Number(payload.total ?? 0), page: Number(payload.page ?? 1), page_size: Number(payload.page_size ?? filters.pageSize) };
}

function draftPayload(restaurantId: string, draft: RecipeDraft, recipeId?: string) {
  return { restaurant_id: restaurantId, recipe_id: recipeId ?? null, name: draft.name,
    description: draft.description || null, category_id: draft.categoryId || null,
    preparation_time_minutes: Number(draft.preparationTimeMinutes || 0),
    yield_quantity: Number(draft.yieldQuantity), yield_unit: draft.yieldUnit, status: draft.status };
}

async function action(actionName: string, payload: Record<string, unknown>): Promise<Recipe> {
  const { data, error } = await supabase.rpc("manage_recipe", { recipe_action: actionName, payload });
  if (error) throw new Error(error.message);
  return data as Recipe;
}

export const createRecipe = (restaurantId: string, draft: RecipeDraft) => action("create", draftPayload(restaurantId, draft));
export const updateRecipe = (restaurantId: string, id: string, draft: RecipeDraft) => action("update", draftPayload(restaurantId, draft, id));
export const duplicateRecipe = (restaurantId: string, id: string) => action("duplicate", { restaurant_id: restaurantId, recipe_id: id });
export const archiveRecipe = (restaurantId: string, id: string) => action("archive", { restaurant_id: restaurantId, recipe_id: id });
export const restoreRecipe = (restaurantId: string, id: string) => action("restore", { restaurant_id: restaurantId, recipe_id: id });
export const softDeleteRecipe = (restaurantId: string, id: string) => action("delete", { restaurant_id: restaurantId, recipe_id: id });

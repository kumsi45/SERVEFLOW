import { supabase } from "../../../core/database";
import type { IngredientInventoryItem, IngredientUnit, Recipe, RecipeCategory, RecipeCost, RecipeDraft, RecipeFilters, RecipeIngredient, RecipeIngredientDraft, RecipePage } from "../types";

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
export async function duplicateRecipe(restaurantId: string, id: string): Promise<Recipe> {
  const { data, error } = await supabase.rpc("duplicate_recipe_with_ingredients", {
    target_restaurant_id: restaurantId, target_recipe_id: id,
  });
  if (error) throw new Error(error.message);
  return data as Recipe;
}
export const archiveRecipe = (restaurantId: string, id: string) => action("archive", { restaurant_id: restaurantId, recipe_id: id });
export const restoreRecipe = (restaurantId: string, id: string) => action("restore", { restaurant_id: restaurantId, recipe_id: id });
export const softDeleteRecipe = (restaurantId: string, id: string) => action("delete", { restaurant_id: restaurantId, recipe_id: id });

export async function fetchRecipeIngredients(restaurantId: string, recipeId: string): Promise<RecipeIngredient[]> {
  const { data, error } = await supabase.from("recipe_ingredients")
    .select("id,restaurant_id,recipe_id,inventory_item_id,quantity_required,unit_id,optional_notes,sort_order,created_at,updated_at,inventory_items!recipe_ingredients_item_restaurant_fk(name),inventory_units!recipe_ingredients_unit_restaurant_fk(name)")
    .eq("restaurant_id", restaurantId).eq("recipe_id", recipeId)
    .order("sort_order").order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: Record<string, unknown>) => {
    const item = Array.isArray(row.inventory_items) ? row.inventory_items[0] : row.inventory_items;
    const unit = Array.isArray(row.inventory_units) ? row.inventory_units[0] : row.inventory_units;
    return { ...row, quantity_required: Number(row.quantity_required), inventory_item_name: String((item as { name?: string } | null)?.name ?? "Inventory Item"), unit_name: String((unit as { name?: string } | null)?.name ?? "Unit") } as RecipeIngredient;
  });
}

export async function searchActiveInventoryItems(restaurantId: string, search: string): Promise<IngredientInventoryItem[]> {
  let query = supabase.from("inventory_items").select("id,name,unit_id")
    .eq("restaurant_id", restaurantId).eq("status", "active").order("name").limit(50);
  if (search.trim()) query = query.ilike("name", `%${search.trim().replace(/%/g, "\\%").replace(/_/g, "\\_")}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as IngredientInventoryItem[];
}

export async function fetchActiveIngredientUnits(restaurantId: string): Promise<IngredientUnit[]> {
  const { data, error } = await supabase.from("inventory_units").select("id,name,description")
    .eq("restaurant_id", restaurantId).eq("status", "active").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as IngredientUnit[];
}

async function ingredientAction(actionName: string, restaurantId: string, recipeId: string, draft: RecipeIngredientDraft) {
  const { data, error } = await supabase.rpc("manage_recipe_ingredient", { recipe_action: actionName, payload: {
    restaurant_id: restaurantId, recipe_id: recipeId, ingredient_id: draft.id ?? null,
    inventory_item_id: draft.inventoryItemId, quantity_required: Number(draft.quantityRequired),
    unit_id: draft.unitId, optional_notes: draft.optionalNotes || null, sort_order: draft.sortOrder,
  } });
  if (error) throw new Error(error.message);
  return data as RecipeIngredient;
}

export const saveRecipeIngredient = (restaurantId: string, recipeId: string, draft: RecipeIngredientDraft) =>
  ingredientAction(draft.id ? "update" : "create", restaurantId, recipeId, draft);
export const removeRecipeIngredient = (restaurantId: string, recipeId: string, ingredientId: string) =>
  ingredientAction("delete", restaurantId, recipeId, { id: ingredientId, inventoryItemId: "", quantityRequired: "1", unitId: "", optionalNotes: "", sortOrder: 1000 });

export async function fetchRecipeCost(restaurantId: string, recipeId: string): Promise<RecipeCost> {
  const { data, error } = await supabase.rpc("get_recipe_cost", {
    target_restaurant_id: restaurantId, target_recipe_id: recipeId,
  });
  if (error) throw new Error(error.message);
  const result = data as RecipeCost;
  return {
    ...result,
    total_cost: Number(result.total_cost ?? 0),
    ingredients: (result.ingredients ?? []).map((row) => ({
      ...row,
      quantity_required: Number(row.quantity_required),
      purchase_price: Number(row.purchase_price),
      unit_cost: row.unit_cost == null ? null : Number(row.unit_cost),
      ingredient_cost: row.ingredient_cost == null ? null : Number(row.ingredient_cost),
    })),
  };
}

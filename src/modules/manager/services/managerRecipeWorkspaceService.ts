import { supabase } from "../../../core/database";
import { fetchMenuRecipeLinks, type MenuRecipeLink } from "../../menu-recipes/services/menuRecipeService";
import { fetchActiveIngredientUnits, fetchRecipeIngredientsForRecipes, fetchRecipes, searchActiveInventoryItems } from "../../recipes/services/recipeService";
import type { IngredientInventoryItem, IngredientUnit, Recipe, RecipeIngredient } from "../../recipes/types";
import { loadManagerCachedData } from "./managerDataCache";

export type RecipeStation = { id: string; name: string };
export type ManagerRecipeSnapshot = {
  menuItems: MenuRecipeLink[];
  recipes: Recipe[];
  ingredientsByRecipe: Record<string, RecipeIngredient[]>;
  inventoryItems: IngredientInventoryItem[];
  units: IngredientUnit[];
  stations: RecipeStation[];
};

const MANAGER_RECIPE_PAGE_SIZE = 100;

async function fetchManagerRecipes(restaurantId: string): Promise<Recipe[]> {
  const firstPage = await fetchRecipes(restaurantId, {
    search: "",
    categoryId: "",
    status: "all",
    preparation: "all",
    sort: "newest",
    page: 1,
    pageSize: MANAGER_RECIPE_PAGE_SIZE,
  });
  const recipes = [...firstPage.items];
  const totalPages = Math.ceil(firstPage.total / firstPage.page_size);
  for (let page = 2; page <= totalPages; page += 1) {
    const nextPage = await fetchRecipes(restaurantId, {
      search: "",
      categoryId: "",
      status: "all",
      preparation: "all",
      sort: "newest",
      page,
      pageSize: MANAGER_RECIPE_PAGE_SIZE,
    });
    recipes.push(...nextPage.items);
  }
  return recipes;
}

async function loadManagerRecipeWorkspaceUncached(restaurantId: string): Promise<ManagerRecipeSnapshot> {
  const [menuItems, recipes, inventoryItems, units, stationResult] = await Promise.all([
    fetchMenuRecipeLinks(restaurantId),
    fetchManagerRecipes(restaurantId),
    searchActiveInventoryItems(restaurantId, ""),
    fetchActiveIngredientUnits(restaurantId),
    supabase.from("kitchen_stations").select("id,name").eq("restaurant_id", restaurantId).eq("active", true).is("archived_at", null).order("name"),
  ]);
  if (stationResult.error) throw new Error(stationResult.error.message);

  const ingredients = await fetchRecipeIngredientsForRecipes(restaurantId, recipes.map((recipe) => recipe.id));
  const ingredientsByRecipe = Object.fromEntries(recipes.map((recipe) => [recipe.id, [] as RecipeIngredient[]]));
  for (const ingredient of ingredients) (ingredientsByRecipe[ingredient.recipe_id] ??= []).push(ingredient);
  return {
    menuItems,
    recipes,
    ingredientsByRecipe,
    inventoryItems,
    units,
    stations: (stationResult.data ?? []).map((row) => ({ id: String(row.id), name: String(row.name) })),
  };
}

export function loadManagerRecipeWorkspace(restaurantId: string, force = false): Promise<ManagerRecipeSnapshot> {
  return loadManagerCachedData({ restaurantId, resource: "recipes", maxAgeMs: 60_000, force, loader: () => loadManagerRecipeWorkspaceUncached(restaurantId) });
}

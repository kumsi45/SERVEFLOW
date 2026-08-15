import React from "react";
import { createRoot } from "react-dom/client";
import { RecipeEditor } from "../../../src/modules/manager/pages/ManagerRecipeWorkspacePage";
import type { ManagerRecipeSnapshot } from "../../../src/modules/manager/services/managerRecipeWorkspaceService";
import type { MenuRecipeLink } from "../../../src/modules/menu-recipes/services/menuRecipeService";
import type { IngredientInventoryItem, Recipe, RecipeIngredient } from "../../../src/modules/recipes/types";

const inventory: IngredientInventoryItem[] = [
  { id: "item-oil", name: "Cooking Oil", unit_id: "unit-ml", current_quantity: 12, minimum_stock: 2, stock_status: "in_stock" },
  { id: "item-mango", name: "Mango", unit_id: "unit-kg", current_quantity: 8, minimum_stock: 1, stock_status: "in_stock" },
];

const recipe: Recipe = {
  id: "recipe-burger", restaurant_id: "restaurant-a", recipe_code: "R-1", name: "Burger", description: null,
  category_id: null, category_name: null, preparation_time_minutes: 12, yield_quantity: 1, yield_unit: "serving",
  status: "draft", created_by: null, created_at: "2026-08-15T00:00:00Z", updated_at: "2026-08-15T00:00:00Z",
};

const canonicalIngredients: RecipeIngredient[] = [{
  id: "ingredient-oil", restaurant_id: "restaurant-a", recipe_id: recipe.id, inventory_item_id: "item-oil",
  inventory_item_name: "Cooking Oil", quantity_required: 20, unit_id: "unit-ml", unit_name: "ml",
  inventory_item_status: "active", unit_status: "active", optional_notes: null, sort_order: 100,
  created_at: "2026-08-15T00:00:00Z", updated_at: "2026-08-15T00:00:00Z",
}];

const editing = new URLSearchParams(location.search).get("mode") === "edit";
const menu: MenuRecipeLink = {
  id: "menu-burger", name: "Burger", description: null, image_url: null, price: 10, category_id: null,
  category_name: "Main Menu", kitchen_station_id: null, available: true, recipe_id: editing ? recipe.id : null,
  recipe_name: editing ? recipe.name : null, recipe_status: editing ? recipe.status : null,
  direct_inventory_item_id: null, direct_inventory_item_name: null,
};
const snapshot: ManagerRecipeSnapshot = {
  menuItems: [menu], recipes: editing ? [recipe] : [], ingredientsByRecipe: editing ? { [recipe.id]: canonicalIngredients } : {},
  inventoryItems: inventory, units: [{ id: "unit-ml", name: "ml", description: null }, { id: "unit-kg", name: "kg", description: null }], stations: [],
};
const loadIngredients = async () => {
  await new Promise((resolve) => window.setTimeout(resolve, 80));
  return canonicalIngredients;
};
const findInventory = async (_restaurantId: string, search: string) => {
  const query = search.trim().toLowerCase();
  return inventory.filter((item) => item.name.toLowerCase().includes(query));
};

createRoot(document.getElementById("root")!).render(
  <RecipeEditor
    restaurantId="restaurant-a" menu={menu} snapshot={snapshot} stationName="Main Kitchen"
    onClose={() => undefined} onSaved={async () => undefined}
    loadIngredients={loadIngredients} findInventory={findInventory}
  />,
);

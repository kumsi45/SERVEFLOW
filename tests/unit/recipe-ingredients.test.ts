import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canManageRecipes } from "../../src/core/permissions/recipeAccess";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const sql = read("supabase/migrations/171_phase8_3_2_recipe_ingredients.sql");
const service = read("src/modules/recipes/services/recipeService.ts");
const page = read("src/modules/recipes/pages/RecipeManagementPage.tsx");

describe("Phase 8.3.2 Recipe Ingredient Management", () => {
  it("defines a tenant-scoped ingredient model with composite integrity", () => {
    expect(sql).toContain("create table if not exists public.recipe_ingredients");
    for (const field of ["restaurant_id", "recipe_id", "inventory_item_id", "quantity_required", "unit_id", "optional_notes", "created_at", "updated_at"]) expect(sql).toContain(field);
    expect(sql).toContain("recipe_ingredients_recipe_restaurant_fk");
    expect(sql).toContain("recipe_ingredients_item_restaurant_fk");
    expect(sql).toContain("recipe_ingredients_unit_restaurant_fk");
    expect(sql).toContain("unique (restaurant_id, recipe_id, inventory_item_id)");
  });

  it("validates positive quantities, active raw items, active units, and duplicates", () => {
    expect(sql).toContain("quantity_required > 0");
    expect(sql).toContain("item.status = 'active'");
    expect(sql).toContain("unit.status = 'active'");
    expect(sql).toContain("Only active inventory items may be ingredients.");
    expect(sql).toContain("This inventory item is already an ingredient in the recipe.");
    expect(service).toContain('.eq("status", "active")');
    expect(service).toContain(".limit(50)");
  });

  it("allows Owner and Manager writes while Inventory Officer remains read-only", () => {
    expect(canManageRecipes("owner")).toBe(true);
    expect(canManageRecipes("manager")).toBe(true);
    expect(canManageRecipes("inventory_officer")).toBe(false);
    expect(sql).toContain("public.recipe_can_read(restaurant_id)");
    expect(sql).toContain("public.recipe_can_manage(restaurant_id)");
    expect(page).toContain("editable && !ingredientDraft");
  });

  it("supports add, edit, remove, search, and duplicate including ingredients", () => {
    for (const operation of ["fetchRecipeIngredients", "saveRecipeIngredient", "removeRecipeIngredient", "searchActiveInventoryItems"]) expect(service).toContain(operation);
    expect(service).toContain('rpc("duplicate_recipe_with_ingredients"');
    expect(sql).toContain("insert into public.recipe_ingredients");
    expect(sql).toContain("duplicated_id");
    expect(page).toContain("Search Inventory Item");
    expect(page).toContain("Save Ingredient");
  });

  it("keeps ingredient definitions disconnected from stock and downstream behavior", () => {
    expect(sql).not.toMatch(/inventory_movements|stock_deduction|order_items|menu_items/i);
    expect(service).not.toMatch(/inventory_movements|stock_deduction|order_items|menu_items/i);
    expect(page).toContain("Recipe Cost");
    expect(page).not.toMatch(/calculateCost|deductInventory|recordStockMovement/);
  });

  it("documents responsive layouts", () => {
    const css = read("src/modules/recipes/styles/recipeManagement.css");
    expect(css).toContain("@media(max-width:1050px)");
    expect(css.match(/@media\(max-width:680px\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

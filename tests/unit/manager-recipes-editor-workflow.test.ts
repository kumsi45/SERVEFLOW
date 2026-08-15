import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/manager/pages/ManagerRecipeWorkspacePage.tsx");
const styles = read("src/modules/manager/styles/managerRecipeWorkspace.css");
const service = read("src/modules/recipes/services/recipeService.ts");
const ingredientSql = read("supabase/migrations/171_phase8_3_2_recipe_ingredients.sql");
const linkingSql = read("supabase/migrations/173_phase8_3_4_menu_recipe_linking.sql");

describe("Manager recipe setup and ingredient editing", () => {
  it("loads canonical ingredient names, quantities, units, and relationship health", () => {
    expect(service).toContain("inventory_item_name");
    expect(service).toContain("quantity_required: Number(row.quantity_required)");
    expect(service).toContain("unit_name");
    expect(service).toContain("inventory_item_status");
    expect(service).toContain("unit_status");
    for (const status of ["Linked", "Inactive inventory item", "Inactive unit", "Broken/missing link"]) expect(page).toContain(status);
    expect(page).toContain("fetchRecipeIngredients(restaurantId, initialRecipe.id)");
    expect(page).toContain("Loading ingredients...");
  });

  it("provides a searchable tenant-scoped add editor with quantity and active units", () => {
    expect(page).toContain("searchActiveInventoryItems(restaurantId, search)");
    expect(page).toContain("Search this restaurant&apos;s inventory.");
    expect(page).toContain('aria-label="Ingredient quantity"');
    expect(page).toContain('aria-label="Ingredient unit"');
    expect(service).toContain('.eq("restaurant_id", restaurantId).eq("status", "active")');
  });

  it("edits the canonical ingredient row without inserting a duplicate", () => {
    expect(page).toContain("function startEditIngredient");
    expect(page).toContain("onStartEdit={startEditIngredient}");
    expect(page).toContain("index === ingredientForm.index ? candidate : row");
    expect(page).toContain("saveRecipeIngredient(restaurantId, saved.id, ingredient)");
    expect(service).toContain('ingredientAction(draft.id ? "update" : "create"');
    expect(ingredientSql).toContain("This inventory item is already an ingredient in the recipe.");
    expect(page).toContain("await saveRecipeIngredient(restaurantId, currentRecipe.id, candidate)");
    expect(page).toContain("Ingredient updated and refreshed.");
  });

  it("confirms removal and explains the future-consumption effect before canonical deletion", () => {
    expect(page).toContain("window.confirm");
    expect(page).toContain("Future expected consumption for this recipe will no longer include this ingredient.");
    expect(page).toContain("removeRecipeIngredient(restaurantId, saved.id, old.id)");
    expect(page).toContain("await removeRecipeIngredient(restaurantId, currentRecipe.id, entry.id)");
    expect(page).toContain("removed and ingredients refreshed.");
  });

  it("uses an actionable empty state", () => {
    expect(page).toContain("No ingredients added yet.");
    expect(page).toContain("Add ingredients to define expected inventory consumption for one serving.");
    expect(page).toContain("+ Add Ingredient");
    expect(page).not.toContain("No ingredients linked. Add an existing Inventory item below.");
  });

  it("rejects invalid quantities and duplicate items in both UI and database authority", () => {
    expect(page).toContain("Ingredient quantity must be greater than zero.");
    expect(page).toContain("This inventory item is already an ingredient in the recipe.");
    expect(page).toContain("Each Inventory item can appear only once in a recipe.");
    expect(ingredientSql).toContain("quantity_required > 0");
    expect(ingredientSql).toContain("recipe_ingredients_recipe_item_unique");
  });

  it("preserves inactive, cross-tenant, and unauthorized-role database rejection", () => {
    expect(ingredientSql).toContain("recipe_ingredients_item_restaurant_fk");
    expect(ingredientSql).toContain("recipe_ingredients_unit_restaurant_fk");
    expect(ingredientSql).toContain("item.status = 'active'");
    expect(ingredientSql).toContain("unit.status = 'active'");
    expect(ingredientSql).toContain("not public.recipe_can_manage(target_restaurant_id)");
    expect(ingredientSql).toContain("Only owners and managers may manage recipe ingredients.");
  });

  it("uses the active-only canonical link path while retaining the requested draft state", () => {
    expect(page).toContain('saved = await createRecipe(restaurantId, { ...draft, status: "draft" })');
    expect(page).toContain("activateAndLinkAfterIngredients = true");
    expect(page).toContain("await linkMenuItemRecipe(restaurantId, menu.id, saved.id)");
    expect(page).toContain('saved = await createRecipe(restaurantId, { ...draft, status: "active" })');
    expect(page).toContain("saved = await updateRecipe(restaurantId, saved.id, draft)");
    expect(linkingSql).toContain("recipe.status = 'active'");
    expect(linkingSql).toContain("Only an active recipe from this restaurant may be linked.");
  });

  it("does not report success until persistence finishes and then refreshes canonical ingredients", () => {
    const saveIngredient = page.indexOf("await saveRecipeIngredient(restaurantId, saved.id, ingredient)");
    const refreshIngredients = page.lastIndexOf("await fetchRecipeIngredients(restaurantId, saved.id)");
    const success = page.indexOf("Recipe changes saved and refreshed.");
    expect(saveIngredient).toBeGreaterThan(-1);
    expect(refreshIngredients).toBeGreaterThan(saveIngredient);
    expect(success).toBeGreaterThan(refreshIngredients);
    expect(page).toContain("Recipe changes are recorded. Detailed change history is not yet available.");
  });

  it("keeps the mobile editor within the viewport with stacked touch-friendly controls", () => {
    expect(styles).toContain(".mrw-drawer{display:block;max-width:100vw;height:auto;min-height:100%;overflow:visible}");
    expect(styles).toContain(".mrw-ingredient-fields{grid-template-columns:1fr}");
    expect(styles).toContain(".mrw-editor input,.mrw-editor select{min-width:0;max-width:100%}");
    expect(styles).toContain(".mrw-ingredient-actions button{flex:1;min-height:42px}");
    expect(styles).toContain(".mrw-drawer>footer{position:relative;flex:0 0 auto}");
    expect(styles).toContain(".mrw-ingredients{overflow:visible}");
    expect(styles).toContain(".mrw-editor{min-width:0;overflow:visible");
    expect(page).toContain('>{ingredients.length} ingredient{ingredients.length === 1 ? "" : "s"}<');
    expect(page).toContain("ManagerRecipeIngredientSection");
  });
});

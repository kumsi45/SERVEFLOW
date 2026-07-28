import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/recipes/pages/RecipeManagementPage.tsx");
const css = read("src/modules/recipes/styles/recipeManagement.css");
const service = read("src/modules/recipes/services/recipeService.ts");

describe("Phase W.4.1 simplified recipe creation V1", () => {
  it("uses the exact six-step menu-first workflow", () => {
    for (const label of ["Select Menu Item", "Recipe Name", "Ingredients", "Preparation Time", "Status", "Save Recipe"]) expect(page).toContain(label);
    expect(page).toContain("type WizardStep = 0 | 1 | 2 | 3 | 4 | 5 | 6");
    expect(page).toContain("setDraft(newRecipeDraft(item.name)); setStep(2)");
    expect(page).toContain("linkMenuItemRecipe(restaurantId, selectedMenu.id, recipe.id)");
  });

  it("stages inventory ingredients before the final save", () => {
    expect(page).toContain("pendingIngredients");
    expect(page).toContain("searchActiveInventoryItems");
    expect(page).toContain("for (const ingredient of pendingIngredients) await saveRecipeIngredient");
    expect(page).toContain("+ Create Ingredient");
    expect(page).toContain("Create & Add");
  });

  it("defaults to active and preserves hidden backend-ready fields", () => {
    expect(page).toContain('status: "active"');
    expect(page).toContain('description: "", categoryId: "", yieldQuantity: "1", yieldUnit: "serving"');
    expect(page).toContain("Draft");
    expect(page).toContain("Active");
    expect(service).toContain("fetchRecipeCost");
  });

  it("removes advanced V1 UI and remains mobile-first", () => {
    for (const removed of ["Preparation Steps", "Version History", "Import Recipe", "Export Recipe", "Advanced Settings", "Food Cost Summary", "Profit Margin"]) expect(page).not.toContain(removed);
    expect(page).not.toContain("Yield quantity");
    expect(css).toContain(".save-recipe-button");
    expect(css).toContain("@media(max-width:680px)");
    expect(css).toContain("orientation:landscape");
  });
});

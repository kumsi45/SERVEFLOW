import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const recipes = read("src/modules/recipes/pages/RecipeManagementPage.tsx");
const inventory = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
const inventoryDashboard = read("src/modules/inventory/components/InventoryOperationalDashboard.tsx");
const owner = read("src/modules/owner/pages/OwnerDashboardPage.tsx");

describe("Phase W.6 simplified V1 recipe and inventory workflow", () => {
  it("shows ingredient membership without recipe measurements", () => {
    expect(recipes).toContain("Tap to add");
    expect(recipes).toContain("No ingredients selected yet.");
    expect(recipes).toContain("Create & Add");
    expect(recipes).not.toMatch(/<label>Quantity|<label>Unit|Yield quantity|Serving Size|Cooking Instructions/);
  });

  it("preserves measured backend fields invisibly for future versions", () => {
    expect(recipes).toContain('quantityRequired: "1"');
    expect(recipes).toContain("unitId: item.unit_id");
    expect(recipes).toContain("saveRecipeIngredient");
    expect(recipes).not.toContain("fetchActiveIngredientUnits");
  });

  it("keeps inventory officers focused on operations", () => {
    expect(inventoryDashboard).not.toContain("Recipes");
    for (const operation of ["Receive Stock", "Issue Stock", "Waste", "Transfers", "Adjustments"]) expect(inventory).toContain(operation);
    expect(inventory).toContain("InventoryOperationalDashboard");
  });

  it("uses stock tracking language and keeps recipe items contextual", () => {
    expect(owner).toContain("Stock Tracking");
    expect(owner).toContain("Ready-to-Sell Item");
    expect(owner).toContain("No Tracking");
    expect(recipes).toContain("Recipe-Tracked Menu Items");
  });

  it("lets owners choose a menu item from the recipe dashboard", () => {
    expect(recipes).toContain("Set Up Recipe");
    expect(recipes).toContain("menuItems.filter((item) => item.recipe_id");
    expect(recipes).toContain("if (recipe) { void startEdit(recipe); return; }");
    expect(recipes).toContain("Add Ingredients");
    expect(recipes).toContain("select its ingredients, and set preparation time");
  });
});

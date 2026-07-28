import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const owner = read("src/modules/owner/pages/OwnerDashboardPage.tsx");
const ownerCss = read("src/modules/owner/styles/ownerDashboard.css");
const recipes = read("src/modules/recipes/pages/RecipeManagementPage.tsx");
const inventory = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");

describe("Phase W.5 menu recipe inventory workflow simplification", () => {
  it("derives one tracking decision from existing menu links", () => {
    expect(owner).toContain('type InventoryTrackingType = "recipe" | "ready_to_sell" | "no_tracking"');
    expect(owner).toContain("How should this menu item deduct stock?");
    for (const label of ["Recipe", "Ready-to-Sell Item", "No Tracking"]) expect(owner).toContain(label);
    expect(owner).toContain("inventoryTrackingType(item)");
  });

  it("enforces valid mutually exclusive combinations", () => {
    expect(owner).toContain('formTrackingType === "ready_to_sell" && !formDirectInventoryItemId');
    expect(owner).toContain('formTrackingType === "recipe" ? formRecipeId : ""');
    expect(owner).toContain('formTrackingType === "ready_to_sell" ? formDirectInventoryItemId : ""');
    expect(owner).toContain('setFormRecipeId(""); setFormDirectInventoryItemId("")');
  });

  it("automatically creates a recipe when recipe tracking is selected", () => {
    expect(owner).toContain("await createRecipe(restaurantId");
    expect(owner).toContain("recipe_id: resolvedRecipeId || null");
    expect(owner).toContain("recipe created automatically");
    expect(owner).toContain("softDeleteRecipe");
    expect(owner).toContain("/owner/recipes?edit=");
    expect(recipes).toContain('get("edit")');
  });

  it("keeps recipe and inventory workspaces contextual", () => {
    expect(recipes).toContain("Recipe-Tracked Menu Items");
    expect(recipes).toContain("menuItems.filter((item) => item.recipe_id");
    expect(inventory).toContain("Used In");
    expect(inventory).toContain("Linked To");
    expect(inventory).toContain('from("recipe_ingredients")');
    expect(ownerCss).toContain(".od-tracking-badge.ready_to_sell");
  });
});

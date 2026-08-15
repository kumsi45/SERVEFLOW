import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/manager/pages/ManagerRecipeWorkspacePage.tsx");
const service = read("src/modules/manager/services/managerRecipeWorkspaceService.ts");
const styles = read("src/modules/manager/styles/managerRecipeWorkspace.css");
const managerRoute = read("src/modules/staff-auth/pages/ProtectedManagerRoute.tsx");
const roleRoute = read("src/app/router/RoleNamespaceRoute.tsx");

describe("Manager Recipes operational workspace", () => {
  it("keeps Recipes in the Manager shell without a second dashboard button", () => {
    expect(managerRoute).toContain('section === "recipes"');
    expect(managerRoute).toContain("ManagerRecipeWorkspacePage");
    expect(roleRoute).toContain('section === "recipes" && state.role === "manager"');
    expect(page).not.toContain(">Dashboard<");
    expect(page).toContain("Manage recipe standards, ingredient usage, preparation details, and inventory connections.");
  });

  it("uses the four focused summaries and an exception-first attention section", () => {
    for (const label of ["Active Recipes", "Missing Recipes", "Incomplete Recipes", "Inventory Link Issues", "Attention required"]) expect(page).toContain(label);
    expect(page).not.toContain("Recipe-Tracked Menu Items");
    expect(page).toContain("Recipe setup is healthy");
  });

  it("represents prepared, direct-stock, and unconfigured sellable items without fake recipes", () => {
    for (const label of ["Prepared Item", "Direct Stock Item", "Missing Recipe", "Direct Stock", "Not Linked"]) expect(page).toContain(label);
    expect(page).toContain('menu.direct_inventory_item_id ? "direct"');
    expect(page).toContain("Recipe</dt><dd>Not required");
  });

  it("provides the compact list, search, filters, and contextual recipe editor", () => {
    for (const column of ["Item", "Category", "Type", "Recipe Status", "Ingredients", "Inventory Link", "Prep Time", "Actions"]) expect(page).toContain(`<span>${column}</span>`);
    for (const filter of ["All", "Prepared Items", "Direct Stock", "Active", "Missing Recipe", "Incomplete", "Inventory Issues"]) expect(page).toContain(`label: "${filter}"`);
    expect(page).toContain('role="dialog"');
    expect(page).toContain("saveRecipeIngredient");
    expect(page).toContain("removeRecipeIngredient");
  });

  it("reuses tenant-scoped services and the split realtime subscriptions", () => {
    expect(service).toContain("fetchMenuRecipeLinks(restaurantId)");
    expect(service).toContain("fetchRecipeIngredients(restaurantId, recipe.id)");
    expect(service).toContain('.eq("restaurant_id", restaurantId)');
    expect(page).toContain('tables: ["recipes", "menu_items"]');
    expect(page).toContain('tables: ["inventory_items", "recipe_ingredients"]');
    expect(page).not.toContain("service_role");
  });

  it("does not duplicate Inventory or expose owner profitability", () => {
    expect(page).toContain("Search inventory by item name");
    expect(page).not.toContain("Select Inventory item...");
    expect(page).not.toContain("Create Inventory");
    for (const forbidden of ["Net Profit", "Bank Balance", "Owner Withdrawals", "Payroll", "Profit Margin"]) expect(page).not.toContain(forbidden);
  });

  it("uses responsive desktop rows and mobile cards/full-screen editing", () => {
    expect(styles).toContain("@media(max-width:1199px)");
    expect(styles).toContain("@media(max-width:900px)");
    expect(styles).toContain("@media(max-width:767px)");
    expect(styles).toContain("@media(max-width:380px)");
    expect(styles).toContain(".mrw-drawer,.mrw-drawer.compact,.mrw-picker{width:100%;height:100%}");
  });
});

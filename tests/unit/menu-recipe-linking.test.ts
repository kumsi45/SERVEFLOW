import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canManageRecipes } from "../../src/core/permissions/recipeAccess";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const sql = read("supabase/migrations/173_phase8_3_4_menu_recipe_linking.sql");
const service = read("src/modules/menu-recipes/services/menuRecipeService.ts");
const owner = read("src/modules/owner/pages/OwnerDashboardPage.tsx");
const recipe = read("src/modules/recipes/pages/RecipeManagementPage.tsx");

describe("Phase 8.3.4 Menu to Recipe Linking", () => {
  it("adds one optional same-restaurant recipe relationship to menu items", () => {
    expect(sql).toContain("alter table public.menu_items add column if not exists recipe_id uuid");
    expect(sql).toContain("foreign key (restaurant_id, recipe_id)");
    expect(sql).toContain("references public.recipes(restaurant_id, id)");
    expect(sql).not.toMatch(/create table.*menu.*recipe/is);
  });

  it("allows only active, non-deleted same-tenant recipes", () => {
    expect(sql).toContain("recipe.restaurant_id = new.restaurant_id");
    expect(sql).toContain("recipe.status = 'active'");
    expect(sql).toContain("recipe.deleted_at is null");
    expect(sql).toContain("menu_recipe_validate_trigger");
    expect(sql).toContain("limit result_limit");
  });

  it("allows owner and manager linking while preserving read-only roles", () => {
    expect(sql).toContain("array['owner','manager']");
    expect(sql).toContain("public.menu_recipe_can_manage(target_restaurant_id)");
    expect(canManageRecipes("inventory_officer")).toBe(false);
    expect(read("src/app/router/AppRouter.tsx")).toContain('"recipes", "menu"');
    expect(read("src/modules/staff-auth/pages/ProtectedManagerRoute.tsx")).toContain('section === "menu"');
  });

  it("centralizes search, link mutation, and reverse usage lookup", () => {
    for (const name of ["list_active_menu_recipes", "link_menu_item_recipe", "get_recipe_used_by"]) expect(sql).toContain(name);
    for (const name of ["searchActiveMenuRecipes", "linkMenuItemRecipe", "fetchRecipeMenuUsage"]) expect(service).toContain(name);
    expect(recipe).toContain("fetchMenuRecipeLinks");
    expect(recipe).toContain("linkMenuItemRecipe");
    expect(recipe).toContain("linkMenuItemRecipe(restaurantId, selectedMenu.id, recipe.id)");
  });

  it("supports explicit no-tracking menu items without a recipe", () => {
    expect(owner).toContain("No Tracking");
    expect(owner).toContain("recipe_id: resolvedRecipeId || null");
    expect(owner).toContain("direct_inventory_item_id: directInventoryItemId || null");
    expect(sql).not.toMatch(/recipe_id uuid not null/i);
  });

  it("does not implement downstream operational behavior", () => {
    expect(sql).not.toMatch(/inventory_movements|stock_deduction|order_items|purchase_orders/i);
    expect(service).not.toMatch(/inventory_movements|stock_deduction|order_items|purchase_orders/i);
  });
});

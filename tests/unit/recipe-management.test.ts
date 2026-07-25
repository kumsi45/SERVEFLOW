import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canManageRecipes, canReadRecipes } from "../../src/core/permissions/recipeAccess";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const sql = read("supabase/migrations/168_phase8_3_1_recipe_management_foundation.sql");
const service = read("src/modules/recipes/services/recipeService.ts");
const page = read("src/modules/recipes/pages/RecipeManagementPage.tsx");
const router = read("src/app/router/RoleNamespaceRoute.tsx");

describe("Phase 8.3.1 Recipe Management", () => {
  it("defines independent recipe and category records with all required fields", () => {
    for (const field of ["recipe_code", "name text", "description text", "category_id", "preparation_time_minutes", "yield_quantity", "yield_unit", "status text", "created_by_staff_id", "created_at", "updated_at", "restaurant_id"]) {
      expect(sql).toContain(field);
    }
    expect(sql).not.toMatch(/inventory_items|order_items|menu_items|purchase|stock_deduction/i);
  });

  it("supports create, edit, duplicate, archive, restore, soft delete, and view", () => {
    for (const action of ["createRecipe", "updateRecipe", "duplicateRecipe", "archiveRecipe", "restoreRecipe", "softDeleteRecipe"]) expect(service).toContain(action);
    expect(page).toContain("setViewing(recipe)");
    expect(sql).toContain("deleted_at");
    expect(sql).not.toMatch(/delete\s+from\s+public\.recipes/i);
  });

  it("generates tenant-scoped immutable recipe codes atomically", () => {
    expect(sql).toContain("recipe_code_counters");
    expect(sql).toContain("on conflict (restaurant_id) do update");
    expect(sql).toContain("'REC-' || lpad");
    expect(sql).toContain("Recipe code is immutable.");
  });

  it("supports required search and filtering at the paginated database boundary", () => {
    expect(sql).toMatch(/recipes\.name ilike/);
    expect(sql).toMatch(/recipes\.recipe_code ilike/);
    expect(sql).toMatch(/categories\.name ilike/);
    expect(sql).toMatch(/recipes\.status ilike/);
    for (const filter of ["category_filter", "status_filter", "preparation_filter", "sort_order", "page_number", "page_size"]) expect(sql).toContain(filter);
    expect(sql).toContain("limit page_size offset (page_number-1)*page_size");
  });

  it("enforces full access for owners/managers and read-only inventory officers", () => {
    expect(canManageRecipes("owner")).toBe(true);
    expect(canManageRecipes("manager")).toBe(true);
    expect(canManageRecipes("inventory_officer")).toBe(false);
    expect(canReadRecipes("inventory_officer")).toBe(true);
    for (const denied of ["kitchen", "cashier", "waiter", "customer"]) expect(canReadRecipes(denied)).toBe(false);
    expect(sql).toContain("array['owner','manager','inventory_officer']");
    expect(sql).toContain("array['owner','manager']");
  });

  it("isolates every query and mutation by restaurant", () => {
    expect(sql).toContain("recipes.restaurant_id=target_restaurant_id");
    expect(sql).toContain("categories.restaurant_id=recipes.restaurant_id");
    expect(sql).toContain("recipes_category_same_restaurant");
    expect(service).toContain('.eq("restaurant_id", restaurantId)');
  });

  it("exposes only authorized role routes and has responsive layouts", () => {
    expect(router).toContain('section === "recipes" && canReadRecipes(state.role)');
    expect(read("src/app/router/AppRouter.tsx")).toContain("const recipeMatch");
    const css = read("src/modules/recipes/styles/recipeManagement.css");
    expect(css).toContain("@media(max-width:1050px)");
    expect(css).toContain("@media(max-width:680px)");
  });
});

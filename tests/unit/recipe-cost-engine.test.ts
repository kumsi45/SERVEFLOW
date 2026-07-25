import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canManageRecipes, canReadRecipes } from "../../src/core/permissions/recipeAccess";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const sql = read("supabase/migrations/172_phase8_3_3_recipe_cost_engine.sql");
const service = read("src/modules/recipes/services/recipeService.ts");
const page = read("src/modules/recipes/pages/RecipeManagementPage.tsx");

describe("Phase 8.3.3 Recipe Cost Engine", () => {
  it("derives precise recipe cost as the sum of current ingredient costs", () => {
    expect(sql).toContain("public.get_recipe_cost");
    expect(sql).toContain("item.purchase_price * public.recipe_unit_conversion_ratio");
    expect(sql).toContain("ingredient.quantity_required * item.purchase_price");
    expect(sql).toContain("'total_cost', coalesce(sum(ingredient_cost), 0)");
    expect(sql).not.toMatch(/add column if not exists recipe_cost|update public\.recipes set.*cost/is);
  });

  it("converts mass, volume, and count units centrally", () => {
    for (const unit of ["kilogram", "gram", "liter", "milliliter", "dozen", "piece"]) expect(sql).toContain(`'${unit}'`);
    expect(sql).toContain("recipe_unit_conversion_ratio");
    expect(sql).toContain("recipe_unit_base_factor(from_unit) / public.recipe_unit_base_factor(to_unit)");
  });

  it("always reads the latest item price and retains archived historical ingredients", () => {
    expect(sql).toContain("add column if not exists purchase_price numeric(18,6)");
    expect(sql).toContain("join public.inventory_items item");
    expect(sql).not.toMatch(/item\.status\s*=\s*'active'/);
    expect(page).toContain('tables: ["inventory_items", "recipe_ingredients"]');
    expect(service).toContain('rpc("get_recipe_cost"');
  });

  it("isolates every calculation by restaurant and preserves read-only officer access", () => {
    expect(sql).toContain("public.recipe_can_read(target_restaurant_id)");
    expect(sql).toContain("ingredient.restaurant_id = target_restaurant_id");
    expect(sql).toContain("recipe.restaurant_id = target_restaurant_id");
    expect(canReadRecipes("inventory_officer")).toBe(true);
    expect(canManageRecipes("inventory_officer")).toBe(false);
  });

  it("displays unit and ingredient costs to two decimal places without manual recalculation", () => {
    expect(page).toContain("minimumFractionDigits: 2, maximumFractionDigits: 2");
    expect(page).toContain("ETB /");
    expect(page).toContain("Calculated automatically from current inventory purchase prices.");
    expect(page).not.toMatch(/Recalculate|Save Recipe Cost|Selling Price|Profit/);
  });

  it("does not touch downstream operational domains", () => {
    expect(sql).not.toMatch(/inventory_movements|menu_items|order_items|purchase_orders|kitchen_tickets/i);
    expect(service).not.toMatch(/inventory_movements|menu_items|order_items|purchase_orders|kitchen_tickets/i);
  });
});

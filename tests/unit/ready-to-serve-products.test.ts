import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const sql = read("supabase/migrations/174_ready_to_serve_menu_inventory_architecture.sql");
const service = read("src/modules/menu-recipes/services/menuRecipeService.ts");
const owner = read("src/modules/owner/pages/OwnerDashboardPage.tsx");
const manager = read("src/modules/menu-recipes/pages/MenuRecipeLinkingPage.tsx");

describe("Ready-to-Serve Product Architecture", () => {
  it("keeps recipes optional for menu items", () => {
    expect(read("supabase/migrations/173_phase8_3_4_menu_recipe_linking.sql")).toContain(
      "alter table public.menu_items add column if not exists recipe_id uuid",
    );
    expect(sql).not.toMatch(/recipe_id uuid not null/i);
    expect(owner).toContain("recipe_id: formRecipeId || null");
  });

  it("adds an optional direct inventory path without forcing it", () => {
    expect(sql).toContain("alter table public.menu_items add column if not exists direct_inventory_item_id uuid");
    expect(sql).toContain("menu_items_direct_inventory_item_same_restaurant");
    expect(sql).toContain("references public.inventory_items(restaurant_id, id)");
    expect(sql).toContain("menu_items_one_deduction_source");
    expect(owner).toContain("direct_inventory_item_id: formDirectInventoryItemId || null");
  });

  it("shows a warning badge instead of blocking saves or publishing", () => {
    for (const source of [owner, manager]) {
      expect(source).toContain("No Recipe Assigned");
      expect(source).not.toContain("Recipe Required");
    }
    expect(owner).toContain("od-recipe-warning");
    expect(manager).toContain("mrl-warning");
  });

  it("centralizes active direct inventory lookup for menu management", () => {
    expect(sql).toContain("list_active_direct_menu_inventory_items");
    expect(sql).toContain("item.status = 'active'");
    expect(sql).toContain("item.active = true");
    expect(service).toContain("searchActiveDirectInventoryItems");
    expect(service).toContain("target_direct_inventory_item_id");
  });

  it("does not implement automatic inventory deduction yet", () => {
    expect(sql).not.toMatch(/inventory_movements|stock_deduction|update public\.inventory_items set current_quantity/i);
    expect(service).not.toMatch(/inventory_movements|stock_deduction|current_quantity/i);
  });
});

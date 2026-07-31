import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const foundationMigration = read(
  "supabase/migrations/197_phase9_12_serveflow_smart_menu_library.sql",
);
const masterCategoryMigration = read(
  "supabase/migrations/198_phase9_12_1_master_category_architecture.sql",
);
const masterMenuMigration = read(
  "supabase/migrations/199_phase9_12_2_master_menu_library.sql",
);
const wizard = read(
  "src/modules/setup-wizard/pages/RestaurantSetupWizardPage.tsx",
);
const libraryStep = read(
  "src/modules/setup-wizard/components/SmartMenuLibraryStep.tsx",
);
const featureFlags = read(
  "src/modules/setup-wizard/services/setupFeatureFlags.ts",
);
const edgeFunction = read("supabase/functions/menu-ai-import/index.ts");
const envExample = read(".env.example");

describe("Phase 9.12 ServeFlow Smart Menu foundation", () => {
  it("offers the six approved restaurant types", () => {
    for (const type of [
      "Restaurant",
      "Hotel",
      "Cafe",
      "Fast Food",
      "Bar & Lounge",
      "Bakery",
    ]) {
      expect(libraryStep).toContain(`\"${type}\"`);
    }
    expect(libraryStep).toContain('SmartMenuBusinessType');
    expect(libraryStep).toContain('libraryTypeForBusiness');
    expect(libraryStep).toContain('Business Type');
  });

  it("keeps the six global restaurant-type libraries", () => {
    expect(foundationMigration).toContain("serveflow_smart_menu_libraries");
    expect(foundationMigration).toContain("for select");
  });

  it("creates one canonical registry containing all 21 master categories", () => {
    expect(masterCategoryMigration).toContain("serveflow_master_menu_categories");
    for (const category of [
      "Breakfast", "Ethiopian Traditional Dishes", "Chicken", "Fish & Seafood",
      "Salads", "Soups", "Wraps", "Pasta", "Pizza", "Burgers", "Sandwiches",
      "Rice Dishes", "Snacks & Fast Food", "Bakery", "Desserts", "Coffee",
      "Tea & Hot Drinks", "Fresh Juice", "Smoothies & Milkshakes", "Soft Drinks",
      "Alcoholic Drinks",
    ]) {
      expect(masterCategoryMigration).toContain(`('${category}',`);
    }
    for (const column of ["id", "name", "slug", "icon", "display_order", "active"]) {
      expect(masterCategoryMigration).toContain(column);
    }
  });

  it("maps restaurant types to master categories without duplicating categories", () => {
    expect(masterCategoryMigration).toContain("serveflow_smart_menu_library_categories");
    expect(masterCategoryMigration).toContain("primary key (library_id, category_id)");
    expect(masterCategoryMigration).toContain("category_id uuid not null references public.serveflow_master_menu_categories(id)");
    for (const type of ["Restaurant", "Hotel", "Cafe", "Fast Food", "Bar & Lounge", "Bakery"]) {
      expect(masterCategoryMigration).toContain(`('${type}',`);
    }
  });

  it("retired the provisional item layer before the approved v1 library", () => {
    expect(masterCategoryMigration).toContain("drop table if exists public.serveflow_smart_menu_items");
    expect(masterCategoryMigration).toContain("drop table if exists public.serveflow_smart_menu_categories");
    expect(masterCategoryMigration).not.toMatch(/default_description|default_image_reference|selling_price|recipe_id/i);
    expect(edgeFunction).toContain("serveflow_smart_menu_library_categories");
  });

  it("creates the approved normalized master item and template mapping tables", () => {
    expect(masterMenuMigration).toContain("create table public.serveflow_master_menu_items");
    expect(masterMenuMigration).toContain("create table public.serveflow_smart_menu_library_items");
    for (const field of ["id", "category_id", "name", "default_description", "default_image_reference", "display_order", "keywords", "active"]) {
      expect(masterMenuMigration).toContain(field);
    }
    expect(masterMenuMigration).toContain("serveflow_master_menu_items_name_unique_idx");
    expect(masterMenuMigration).toContain("primary key (library_id, item_id)");
  });

  it("contains every approved item name without operational data", () => {
    for (const item of [
      "Chechebsa", "Tegabino", "Chicken Cutlet", "Tuna Pizza", "Continental Breakfast",
      "Energy Drink", "Mango Milkshake", "Classic Hot Dog", "Long Island Iced Tea",
      "Black Forest Cake", "Chocolate Chip Cookie", "Meat Pie",
    ]) {
      expect(masterMenuMigration).toContain(`\"${item}\"`);
    }
    const itemTableStart = masterMenuMigration.indexOf("create table public.serveflow_master_menu_items");
    const itemTable = masterMenuMigration.slice(itemTableStart, masterMenuMigration.indexOf("\n);", itemTableStart) + 3).toLowerCase();
    for (const forbidden of ["price", "recipe", "inventory", "kitchen", "nutrition", "food_cost", "preparation_time"]) {
      expect(itemTable).not.toContain(forbidden);
    }
    expect(masterMenuMigration).toContain("length(btrim(default_description)) between 1 and 240");
    expect(masterMenuMigration).toContain("if not exists (");
  });

  it("loads approved items into the same private Review Draft with empty prices", () => {
    expect(edgeFunction).toContain("serveflow_smart_menu_library_items");
    expect(edgeFunction).toContain("default_description");
    expect(edgeFunction).toContain("default_image_reference");
    expect(edgeFunction).toContain("price: confidence(null, 0)");
    expect(edgeFunction).toContain("currency: confidence(null, 0)");
    expect(edgeFunction).toContain('model", "smart-menu-library-v1"');
  });

  it("routes the V1 onboarding through Smart Menu and Review Studio", () => {
    expect(wizard).toContain("SmartMenuLibraryStep");
    expect(wizard).toContain('smartLibraryOnly');
    expect(wizard).not.toContain("AiMenuUploadStep");
    expect(wizard).not.toMatch(/Upload Menu|OCR/i);
    expect(libraryStep).toContain("createSmartMenuLibraryDraft");
  });

  it("disables AI import while preserving its provider architecture", () => {
    expect(envExample).toContain("ENABLE_AI_MENU_IMPORT=false");
    expect(envExample).toContain("VITE_ENABLE_AI_MENU_IMPORT=false");
    expect(featureFlags).toContain('=== "true"');
    expect(edgeFunction).toContain('type ImportMode = "ai"');
    expect(edgeFunction).toContain("getAiMenuProvider");
    expect(edgeFunction).toContain(
      'source_kind: mode === "library" ? "smart_library" : mode',
    );
  });

  it("creates the same private review draft without touching production menu tables", () => {
    expect(edgeFunction).toContain('.from("ai_menu_import_drafts")');
    expect(edgeFunction).not.toMatch(
      /\.from\("(categories|menu_items|inventory_items|recipes|orders|payments)"\)/,
    );
    expect(foundationMigration).toContain("'smart_library'");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const migration = read(
  "supabase/migrations/197_phase9_12_serveflow_smart_menu_library.sql",
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
  });

  it("uses a global read-only library with reusable categories and items", () => {
    expect(migration).toContain("serveflow_smart_menu_libraries");
    expect(migration).toContain("serveflow_smart_menu_categories");
    expect(migration).toContain("serveflow_smart_menu_items");
    expect(migration).toContain("default_description");
    expect(migration).toContain("default_image_reference");
    expect(migration).toContain("display_order");
    expect(migration).toContain("for select");
    expect(migration).not.toMatch(/create policy[\s\S]*for (insert|update|delete)/i);
  });

  it("keeps prices and operational data out of library items", () => {
    const itemTableStart = migration.indexOf(
      "create table if not exists public.serveflow_smart_menu_items",
    );
    const itemTable = migration.slice(
      itemTableStart,
      migration.indexOf("\n);", itemTableStart) + 3,
    );
    const itemColumns = itemTable.toLowerCase();
    for (const forbiddenColumn of [
      "price ",
      "recipe_id",
      "inventory_id",
      "kitchen_station_id",
      "preparation_time",
      "nutrition",
      "food_cost",
    ]) {
      expect(itemColumns).not.toContain(forbiddenColumn);
    }
    expect(edgeFunction).toContain("price: confidence(null, 0)");
    expect(edgeFunction).toContain("currency: confidence(null, 0)");
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
    expect(migration).toContain("'smart_library'");
  });
});

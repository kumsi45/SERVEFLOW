import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MASTER_DISH_SPECIFICATIONS, getMasterDishSpecification } from "../../src/modules/setup-wizard/data/masterDishSpecificationLibrary";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/199_phase9_12_2_master_menu_library.sql"), "utf8");
const match = migration.match(/specification jsonb := \$library\$\s*([\s\S]*?)\s*\$library\$/);
if (!match) throw new Error("Approved Phase 9.12.2 source was not found.");
const approved = JSON.parse(match[1]) as Array<{ type: string; sections: Array<{ name: string; items: string[] }> }>;
const placements = approved.flatMap((template) => template.sections.flatMap((section) => section.items.map((name) => ({ name, category: section.name, type: template.type }))));
const approvedNames = new Set(placements.map((entry) => entry.name));
const requiredFields = ["id", "item_name", "slug", "category", "business_types_using_this_item", "food_origin", "dish_type", "serving_style", "plate_style", "camera_angle", "composition", "background", "lighting", "garnish", "ingredients_summary", "visual_description", "negative_prompt", "image_status", "version", "active"] as const;

describe("Phase 9.13.2 Master Dish Specification Library", () => {
  it("contains exactly one specification for every approved unique item", () => {
    expect(approvedNames.size).toBe(180);
    expect(MASTER_DISH_SPECIFICATIONS).toHaveLength(180);
    expect(new Set(MASTER_DISH_SPECIFICATIONS.map((entry) => entry.item_name))).toEqual(approvedNames);
    expect(new Set(MASTER_DISH_SPECIFICATIONS.map((entry) => entry.slug)).size).toBe(180);
    expect(new Set(MASTER_DISH_SPECIFICATIONS.map((entry) => entry.id)).size).toBe(180);
  });

  it("keeps the exact approved item names and canonical first category", () => {
    for (const specification of MASTER_DISH_SPECIFICATIONS) {
      const first = placements.find((entry) => entry.name === specification.item_name);
      expect(first).toBeDefined();
      expect(specification.category).toBe(first?.category);
    }
  });

  it("aggregates every business type without duplicating specifications", () => {
    for (const specification of MASTER_DISH_SPECIFICATIONS) {
      const expected = [...new Set(placements.filter((entry) => entry.name === specification.item_name).map((entry) => entry.type))].sort();
      expect(specification.business_types_using_this_item).toEqual(expected);
      expect(expected.length).toBeGreaterThan(0);
    }
  });

  it("contains every required field with valid deterministic values", () => {
    for (const specification of MASTER_DISH_SPECIFICATIONS) {
      for (const field of requiredFields) expect(specification).toHaveProperty(field);
      expect(specification.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(specification.category.length).toBeGreaterThan(0);
      expect(specification.camera_angle).toMatch(/^(Top-down|45°|Front)$/);
      expect(specification.image_status).toBe("PLACEHOLDER");
      expect(specification.version).toBe(1);
      expect(specification.active).toBe(true);
    }
  });

  it("enforces the approved professional visual and negative standards", () => {
    for (const specification of MASTER_DISH_SPECIFICATIONS) {
      expect(specification.visual_description).toContain(`Authentic ${specification.item_name}`);
      expect(specification.background).toMatch(/white|neutral/i);
      expect(specification.lighting).toMatch(/natural/i);
      for (const exclusion of ["No text", "no logo", "no watermark", "no blur", "no duplicate food", "no people", "no hands", "no unrealistic colors", "no cartoon style"]) {
        expect(specification.negative_prompt.toLocaleLowerCase()).toContain(exclusion.toLocaleLowerCase());
      }
    }
  });

  it("provides deterministic lookup for future provider adapters", () => {
    expect(getMasterDishSpecification("chechebsa")?.item_name).toBe("Chechebsa");
    expect(getMasterDishSpecification("chicken-burger")?.business_types_using_this_item).toEqual(["Fast Food", "Restaurant"]);
    expect(getMasterDishSpecification("not-approved")).toBeNull();
  });

  it("contains no image provider or storage execution code", () => {
    const generator = readFileSync(resolve(process.cwd(), "scripts/generate-master-dish-specifications.mjs"), "utf8");
    expect(generator).not.toMatch(/openai|dall.?e|gemini|stability|midjourney|supabase\.storage|fetch\(/i);
  });
});

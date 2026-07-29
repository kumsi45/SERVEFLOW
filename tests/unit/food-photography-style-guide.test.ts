import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MASTER_DISH_SPECIFICATIONS } from "../../src/modules/setup-wizard/data/masterDishSpecificationLibrary";
import { composeServeFlowPhotographyBrief, SERVEFLOW_FOOD_PHOTOGRAPHY_STYLE_GUIDE_V1 as guide } from "../../src/modules/setup-wizard/data/foodPhotographyStyleGuide.v1";
import { SMART_MENU_RESPONSIVE_WIDTHS } from "../../src/modules/setup-wizard/services/smartImageLibrary";

const document = readFileSync(resolve(process.cwd(), "docs/product/SERVEFLOW_FOOD_PHOTOGRAPHY_STYLE_GUIDE_V1.md"), "utf8");
const contractSource = readFileSync(resolve(process.cwd(), "src/modules/setup-wizard/data/foodPhotographyStyleGuide.v1.ts"), "utf8");

describe("Phase 9.13.2.5 ServeFlow global food photography style", () => {
  it("freezes one global provider-independent identity", () => {
    expect(guide.id).toBe("serveflow-food-photography-v1");
    expect(guide.version).toBe("1.0");
    expect(guide.status).toBe("FROZEN");
    expect(guide.identity).toContain("Professional restaurant food photography");
    expect(document).toContain("one premium global collection");
  });

  it("enforces the approved background, plate, light, color, and composition rules", () => {
    expect(guide.background.primary).toBe("White marble");
    expect(guide.background.alternative).toBe("Light gray matte");
    expect(guide.plate.default).toContain("white ceramic");
    expect(guide.lighting.required).toEqual(["Soft daylight", "Balanced exposure", "Natural shadows"]);
    expect(guide.composition).toContain("One dish only");
    expect(guide.composition).toContain("Entire plate or vessel visible");
    expect(guide.color).toContain("No oversaturation");
  });

  it("permits only the three approved camera angles", () => {
    expect(guide.camera.allowed).toEqual(["Top-down", "45°", "Front"]);
    for (const specification of MASTER_DISH_SPECIFICATIONS) expect(guide.camera.allowed).toContain(specification.camera_angle);
  });

  it("aligns the master and responsive output architecture", () => {
    expect(guide.master).toEqual({ width: 2048, height: 2048, aspectRatio: "1:1", format: "WEBP" });
    expect(guide.derivatives).toEqual([1280, 1024, 768, 512, 320]);
    expect([...SMART_MENU_RESPONSIVE_WIDTHS]).toEqual([320, 512, 768, 1024, 1280]);
  });

  it("contains every prohibited visual element in the reusable negative contract", () => {
    for (const term of ["text", "watermark", "logo", "human hands", "people", "forks", "knives", "phones", "extra plates", "messy table", "artificial colors", "AI artifacts", "floating ingredients", "duplicate food", "cartoon appearance", "painting style", "illustration"]) {
      expect(guide.globalNegativePrompt.toLocaleLowerCase()).toContain(term.toLocaleLowerCase());
    }
  });

  it("defines bounded category exceptions without weakening global rules", () => {
    expect(new Set(Object.keys(guide.categoryExceptions))).toEqual(new Set(["bar", "bakery", "coffee", "ethiopian", "western"]));
    expect(guide.categoryExceptions.ethiopian).toContain("injera");
    expect(guide.categoryExceptions.coffee).toContain("traditional cup");
    expect(document).toContain("Exceptions preserve authenticity; they never override");
  });

  it("composes every dish with the same immutable style identity", () => {
    const briefs = MASTER_DISH_SPECIFICATIONS.map(composeServeFlowPhotographyBrief);
    expect(briefs).toHaveLength(180);
    expect(new Set(briefs.map((brief) => brief.styleGuideId))).toEqual(new Set([guide.id]));
    expect(briefs.find((brief) => brief.itemName === "Kitfo")?.visualDirection).toContain("White marble");
    expect(briefs.find((brief) => brief.itemName === "Chicken Burger")?.negativePrompt.toLocaleLowerCase()).toContain("no watermark");
  });

  it("provides all required operational checklists", () => {
    for (const heading of ["Photography Rules", "Lighting Rules", "Composition Rules", "Camera Rules", "Plate and Vessel Rules", "Background Rules", "Color Rules", "Category Exceptions", "Quality Checklist", "Generation Checklist", "Approval Checklist"]) expect(document).toContain(`## ${heading}`);
  });

  it("contains no generation, upload, migration, storage, or provider call", () => {
    expect(contractSource).not.toMatch(/openai|dall.?e|gemini|stability|midjourney|supabase|fetch\(|storage\./i);
  });
});

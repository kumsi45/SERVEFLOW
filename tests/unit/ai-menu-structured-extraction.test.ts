import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeExtraction,
  type RawExtractionResult,
} from "../../supabase/functions/menu-ocr-extract/contracts.ts";
import {
  getExtractionIssues,
  groupExtractionItems,
} from "../../src/modules/setup-wizard/services/menuExtractionTypes";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const migration = read(
  "supabase/migrations/188_phase9_8_2_ai_menu_structured_extraction.sql",
);
const edgeFunction = read(
  "supabase/functions/menu-ocr-extract/index.ts",
);
const provider = read(
  "supabase/functions/menu-ocr-extract/providers/openai.ts",
);
const registry = read(
  "supabase/functions/menu-ocr-extract/providers/registry.ts",
);
const review = read(
  "src/modules/setup-wizard/components/AiMenuReviewStudio.tsx",
);
const extractionTypes = read(
  "src/modules/setup-wizard/services/menuExtractionTypes.ts",
);

function stringField(value: string | null, confidence = value ? 0.9 : 0) {
  return { value, confidence };
}

const languageField = (
  value: "en" | "om" | "am" | "mixed" | "unknown",
  confidence = 0.9,
) => ({ value, confidence });

function menuItem(name: string, category: string | null, price: number | null) {
  return {
    category: stringField(category),
    categoryLanguage: languageField(category ? "en" : "unknown"),
    name: stringField(name),
    nameLanguage: languageField("en"),
    description: stringField(null),
    descriptionLanguage: languageField("unknown", 0),
    price: { value: price, confidence: price === null ? 0 : 0.98 },
    currency: stringField(price === null ? null : "ETB"),
    variants: { value: [], confidence: 0.9 },
    comboMeal: { value: false, confidence: 0.9 },
    drink: { value: false, confidence: 0.9 },
    optionalNotes: stringField(null),
    optionalNotesLanguage: languageField("unknown", 0),
    sourceText: stringField(`${name} ${price ?? ""}`.trim(), 1),
  };
}

describe("Phase 9.8.2 AI menu structured extraction", () => {
  it("normalizes confidence and flags duplicates without merging them", () => {
    const raw: RawExtractionResult = {
      restaurantName: stringField("Sample Cafe", 1),
      restaurantNameLanguage: languageField("en", 1),
      categories: [{
        name: stringField("Breakfast"),
        detectedLanguage: languageField("en"),
      }],
      items: [
        menuItem("Chechebsa", "Breakfast", 150),
        menuItem(" chechebsa ", null, null),
      ],
      unrecognizedSections: [{ text: stringField("Call us", 0.7) }],
    };

    const result = normalizeExtraction(raw);
    expect(result.items).toHaveLength(2);
    expect(result.items.every((item) => item.duplicate)).toBe(true);
    expect(result.items[0].duplicateOf).toEqual(["item-2"]);
    expect(result.items[1].duplicateOf).toEqual(["item-1"]);
    expect(result.unrecognizedSections[0].text.value).toBe("Call us");
  });

  it("groups owner preview by category and highlights review issues", () => {
    const result = normalizeExtraction({
      restaurantName: stringField(null),
      restaurantNameLanguage: languageField("unknown", 0),
      categories: [],
      items: [menuItem("Kitfo", null, null)],
      unrecognizedSections: [],
    });
    expect(groupExtractionItems(result.items)).toHaveProperty(
      "Missing Category",
    );
    expect(getExtractionIssues(result.items[0])).toEqual(
      expect.arrayContaining(["Missing price", "Missing category"]),
    );
  });

  it("keeps extraction drafts isolated and owner-readable only", () => {
    expect(migration).toContain(
      "create table if not exists public.ai_menu_import_drafts",
    );
    expect(migration).toContain("grant select");
    expect(migration).toContain(
      "array['owner']::public.restaurant_staff_role[]",
    );
    expect(migration).not.toMatch(
      /insert into public\.(menu_items|categories|inventory_items|recipes|orders|payments)/i,
    );
    expect(edgeFunction).toContain('.from("ai_menu_import_drafts")');
    expect(edgeFunction).not.toMatch(
      /\.from\("(menu_items|categories|inventory_items|recipes|orders|payments)"\)/,
    );
  });

  it("uses a swappable provider and strict structured output", () => {
    expect(registry).toContain("getMenuExtractionProvider");
    expect(registry).toContain("MENU_OCR_PROVIDER");
    expect(provider).toContain('type: "json_schema"');
    expect(provider).toContain("strict: true");
    expect(provider).toContain("Never infer or invent those fields");
    expect(provider).toContain("restaurant-quality description");
    expect(provider).toContain("under 160 characters");
    expect(provider).toContain("Never discard readable text");
    expect(provider).toContain("store: false");
  });

  it("shows confidence, missing data, duplicates, and unrecognized text", () => {
    const previewSource = `${review}\n${extractionTypes}`;
    expect(previewSource).toContain("formatConfidence");
    expect(previewSource).toContain("Missing price");
    expect(previewSource).toContain("Possible duplicate");
    expect(previewSource).toContain("Missing Category");
    expect(review).toContain("Unrecognized Text");
    expect(review).toContain("Nothing reaches the live menu");
  });
});

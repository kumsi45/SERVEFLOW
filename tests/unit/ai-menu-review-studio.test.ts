import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createMenuReviewState,
  getDuplicateItemIds,
  getMenuReviewWarnings,
  matchesMenuReviewFilter,
  matchesMenuReviewSearch,
  summarizeMenuReview,
} from "../../src/modules/setup-wizard/services/menuReviewState";
import type { MenuExtractionResult } from "../../src/modules/setup-wizard/services/menuExtractionTypes";
import { normalizeReviewState } from "../../supabase/functions/menu-review-draft/validation.ts";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const studio = read(
  "src/modules/setup-wizard/components/AiMenuReviewStudio.tsx",
);
const card = read(
  "src/modules/setup-wizard/components/AiMenuReviewItemCard.tsx",
);
const virtualized = read(
  "src/modules/setup-wizard/components/VirtualizedReviewItems.tsx",
);
const service = read(
  "src/modules/setup-wizard/services/menuExtractionService.ts",
);
const imageService = read(
  "src/modules/setup-wizard/services/menuImageDraftService.ts",
);
const imageDraftEdgeFunction = read(
  "supabase/functions/menu-item-image-draft/index.ts",
);
const imageDraftRegistry = read(
  "supabase/functions/menu-item-image-draft/providers/registry.ts",
);
const imageDraftOpenAi = read(
  "supabase/functions/menu-item-image-draft/providers/openai.ts",
);
const imageDraftMigration = read(
  "supabase/migrations/191_phase9_8_5_ai_food_image_drafts.sql",
);
const edgeFunction = read(
  "supabase/functions/menu-review-draft/index.ts",
);
const migration = read(
  "supabase/migrations/189_phase9_8_3_ai_menu_review_studio.sql",
);
const css = read(
  "src/modules/setup-wizard/pages/restaurantSetupWizard.css",
);

const field = <T>(value: T | null, confidence = value === null ? 0 : 0.9) => ({
  value,
  confidence,
});

function extractionResult(): MenuExtractionResult {
  return {
    schemaVersion: 1,
    restaurantName: field("Review Cafe", 0.98),
    categories: [field("Breakfast", 0.9), field("Drinks", 0.88)],
    items: [
      {
        id: "item-1",
        category: field("Breakfast", 0.9),
        name: field("Chechebsa", 0.95),
        description: field(null),
        price: field<number>(null),
        currency: field("ETB", 0.92),
        variants: field([]),
        comboMeal: field(false),
        drink: field(false),
        optionalNotes: field("???", 0.3),
        sourceText: field("Chechebsa ???", 0.6),
        duplicate: false,
        duplicateOf: [],
      },
      {
        id: "item-2",
        category: field<string>(null),
        name: field("chechebsa", 0.7),
        description: field("Traditional breakfast", 0.9),
        price: field(150, 0.96),
        currency: field("ETB", 0.96),
        variants: field([]),
        comboMeal: field(false),
        drink: field(false),
        optionalNotes: field<string>(null),
        sourceText: field("chechebsa 150 ETB", 0.9),
        duplicate: true,
        duplicateOf: ["item-1"],
      },
    ],
    unrecognizedSections: [{ text: field("Call for catering", 0.72) }],
  };
}

describe("Phase 9.8.3 AI Menu Review Studio", () => {
  it("creates a complete editable draft without creating operational records", () => {
    let id = 0;
    const state = createMenuReviewState(
      extractionResult(),
      () => `review-${++id}`,
    );
    expect(state.categories.map((category) => category.name)).toEqual([
      "Breakfast",
      "Drinks",
    ]);
    expect(state.items).toHaveLength(2);
    expect(state.items.every((item) => !item.approved && !item.deleted)).toBe(true);
    expect(state.items.every((item) => item.trackingType === "no_tracking")).toBe(true);
    expect(state.unrecognizedText[0].text).toBe("Call for catering");
  });

  it("summarizes confidence, missing fields, categories, duplicates, and progress", () => {
    let id = 0;
    const state = createMenuReviewState(
      extractionResult(),
      () => `review-${++id}`,
    );
    const duplicateIds = getDuplicateItemIds(state.items);
    const firstWarnings = getMenuReviewWarnings(state.items[0], duplicateIds);
    expect(firstWarnings).toEqual(expect.arrayContaining([
      "Missing Price",
      "Missing Description",
      "Duplicate Name",
      "Suspicious Text",
    ]));
    expect(getMenuReviewWarnings(state.items[1], duplicateIds)).toContain(
      "Missing Category",
    );
    expect(summarizeMenuReview(state)).toMatchObject({
      totalCategories: 2,
      totalItems: 2,
      lowConfidenceItems: 2,
      missingPrices: 1,
      missingCategories: 1,
      duplicates: 2,
      unrecognizedText: 1,
      progress: 0,
    });
  });

  it("supports debounced search semantics and every requested filter", () => {
    let id = 0;
    const state = createMenuReviewState(
      extractionResult(),
      () => `review-${++id}`,
    );
    const duplicateIds = getDuplicateItemIds(state.items);
    const item = state.items[0];
    const warnings = getMenuReviewWarnings(item, duplicateIds);
    expect(matchesMenuReviewSearch(item, "Breakfast", "breakfast")).toBe(true);
    expect(matchesMenuReviewSearch(item, "Breakfast", "chechebsa")).toBe(true);
    expect(matchesMenuReviewFilter(item, "needs-review", warnings)).toBe(true);
    expect(matchesMenuReviewFilter(item, "missing-price", warnings)).toBe(true);
    expect(matchesMenuReviewFilter(item, "duplicates", warnings)).toBe(true);
    expect(matchesMenuReviewFilter(item, "deleted", warnings)).toBe(false);
  });

  it("validates and normalizes the complete autosave payload", () => {
    let id = 0;
    const state = createMenuReviewState(
      extractionResult(),
      () => `review-${++id}`,
    );
    expect(normalizeReviewState(state)).toEqual(state);
    expect(() => normalizeReviewState({
      ...state,
      items: [{ ...state.items[0], categoryId: "missing-category" }],
    })).toThrow("unknown review category");
    expect(() => normalizeReviewState({
      ...state,
      items: [{ ...state.items[0], trackingType: "invalid" as "no_tracking" }],
    })).toThrow("inventory consumption is invalid");
  });

  it("exposes all category, item, unrecognized, search, filter, and bulk actions", () => {
    for (const label of [
      "Rename category",
      "Merge into...",
      "Create Category",
      "Delete Empty",
      "Create New Item",
      "Bulk Delete",
      "Bulk Move",
      "Bulk Approve",
      "Bulk Restore",
      "Generate Missing Images",
      "Convert into Menu Item",
      "Ignore",
      "Unrecognized Text",
    ]) {
      expect(studio).toContain(label);
    }
    for (const label of [
      "No Image Yet",
      "Food Name",
      "Description",
      "Price",
      "Currency",
      "Notes",
      "Restore Item",
      "Duplicate",
      "Inventory Consumption",
      "No Inventory Tracking",
      "Recipe Item",
      "Ready-to-Sell Item",
      "Hide from Customers",
    ]) {
      expect(card).toContain(label);
    }
    for (const label of [
      "All",
      "Needs Review",
      "Low Confidence",
      "Missing Price",
      "Duplicates",
      "Deleted",
    ]) {
      expect(studio).toContain(label);
    }
  });

  it("autosaves with optimistic revisions and enforces owner/manager boundaries", () => {
    expect(service).toContain('"menu-review-draft"');
    expect(edgeFunction).toContain('eq("review_revision", expectedRevision)');
    expect(edgeFunction).toContain('.eq("role", "owner")');
    expect(migration).toContain(
      "array['owner', 'manager']::public.restaurant_staff_role[]",
    );
    expect(migration).toContain(
      "revoke insert, update, delete on public.ai_menu_import_drafts",
    );
    expect(studio).toContain("Managers can review AI import drafts");
    expect(studio).toContain('access === "owner" ? saveStateLabel(saveStatus, offline) : "Synced"');
  });

  it("is memoized, virtualized, lazy, debounced, responsive, and accessible", () => {
    expect(studio).toContain("memo(function AiMenuReviewStudio");
    expect(card).toContain("memo(function AiMenuReviewItemCard");
    expect(virtualized).toContain("VIRTUALIZATION_THRESHOLD");
    expect(virtualized).toContain("ResizeObserver");
    expect(studio).toContain("setTimeout(() => setSearch(searchInput), 250)");
    expect(css).toContain("content-visibility: auto");
    expect(css).toContain("@media (max-width: 1180px)");
    expect(css).toContain("@media (max-width: 720px)");
    expect(css).toContain("@media (max-width: 420px)");
    expect(css).toContain("min-height: 44px");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });

  it("supports draft-only AI food image generation with owner version control", () => {
    const state = createMenuReviewState(extractionResult(), () => "review-id");
    expect(state.items[0].imageDraft).toMatchObject({
      status: "Pending",
      selectedVersionId: null,
      versions: [],
    });
    for (const label of [
      "Generate Image",
      "Regenerate",
      "Upload Own Image",
      "Accept",
      "Reject",
      "Crop",
      "Remove",
      "Compare Versions",
    ]) {
      expect(card).toContain(label);
    }
    expect(imageService).toContain("Professional restaurant food photography");
    expect(imageService).toContain("do not add unmentioned");
    expect(imageService).toContain('"menu-item-image-draft"');
  });

  it("routes image generation through a pluggable provider registry", () => {
    expect(imageDraftEdgeFunction).toContain("getImageGenerationProvider");
    expect(imageDraftEdgeFunction).not.toContain("OpenAiImageGenerationProvider");
    expect(imageDraftRegistry).toContain("MENU_IMAGE_PROVIDER");
    expect(imageDraftRegistry).toContain("openai");
    expect(imageDraftOpenAi).toContain("OPENAI_MENU_IMAGE_MODEL");
    expect(imageDraftOpenAi).toContain("/images/generations");
  });

  it("stores AI image drafts in versioned deterministic storage paths", () => {
    expect(imageDraftMigration).toContain("'menu-item-image-drafts'");
    expect(imageDraftMigration).toContain("public = excluded.public");
    expect(imageDraftMigration).toContain("for update");
    expect(imageDraftMigration).toContain("using (false)");
    expect(imageDraftEdgeFunction).toContain('const BUCKET = "menu-item-image-drafts"');
    expect(imageDraftEdgeFunction).toContain("upsert: false");
    expect(imageDraftEdgeFunction).toContain('"ai-menu"');
    expect(imageDraftEdgeFunction).toContain("version-${versionNumber}.webp");
    expect(imageDraftEdgeFunction).toContain("getPublicUrl");
  });

  it("authoritatively generates only from approved canonical Review Studio data", () => {
    expect(imageDraftEdgeFunction).toContain('draft.status !== "completed"');
    expect(imageDraftEdgeFunction).toContain("assertEligibleItem");
    expect(imageDraftEdgeFunction).toContain('selectedVersion?.status === "Approved"');
    expect(imageDraftEdgeFunction).toContain("review_revision");
    expect(imageDraftEdgeFunction).toContain("reviewRevision");
    expect(imageDraftEdgeFunction).not.toMatch(/translation|translated/i);
  });

  it("keeps Phase 9.8.5 image generation draft-only", () => {
    const productionSource = `${service}\n${imageService}\n${edgeFunction}\n${migration}\n${imageDraftEdgeFunction}\n${imageDraftMigration}`;
    expect(productionSource).not.toMatch(
      /publishMenu|\.from\("(menu_items|categories|inventory_items|recipes|orders|payments)"\)/,
    );
    expect(imageDraftMigration).toContain("Generated assets remain Review Studio drafts");
    expect(imageDraftEdgeFunction).not.toContain("publish_ai_menu_draft");
  });
});

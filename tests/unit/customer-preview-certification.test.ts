import { describe, expect, it } from "vitest";
import { certifyMenuPreview } from "../../src/modules/setup-wizard/services/menuPreviewCertification";
import type { MenuReviewState } from "../../src/modules/setup-wizard/services/menuReviewTypes";
import type { MenuPreviewRestaurant } from "../../src/modules/setup-wizard/services/menuPublishService";

const restaurant: MenuPreviewRestaurant = { id: "restaurant-1", name: "Test Cafe", slug: "test-cafe", menu_theme: "modern", logo_url: null, cover_url: null, ordering_settings: null, currency_code: "ETB", currency_symbol: "Br", locale: "en" };
const localizedField = (value: string | null) => ({ values: { en: { value, confidence: 1 }, om: { value: null, confidence: 0 }, am: { value: null, confidence: 0 } }, detectedLanguage: "en" as const, languageConfidence: 1, ownerEdited: { en: false, om: false, am: false } });
const state = (overrides: Partial<MenuReviewState["items"][number]> = {}): MenuReviewState => ({
  schemaVersion: 2,
  restaurantName: { value: "Test Cafe", confidence: 1 },
  restaurantNameLocalization: localizedField("Test Cafe"),
  categories: [{ id: "category-1", name: "Coffee", localization: localizedField("Coffee"), confidence: 1, order: 0 }],
  items: [{ id: "item-1", sourceItemId: null, categoryId: "category-1", categoryConfidence: 1, name: { value: "Latte", confidence: 1 }, nameLocalization: localizedField("Latte"), description: { value: "Milk coffee", confidence: 1 }, descriptionLocalization: localizedField("Milk coffee"), price: { value: 100, confidence: 1 }, currency: { value: "ETB", confidence: 1 }, notes: { value: null, confidence: 0 }, notesLocalization: localizedField(null), sourceText: { value: "Latte 100", confidence: 1 }, approved: true, deleted: false, imageDraft: { status: "Approved", selectedVersionId: "image-1", versions: [{ id: "image-1", version: 1, status: "Approved", source: "ai", imageUrl: "https://example.com/latte.jpg", thumbnailUrl: null, prompt: "", createdAt: "2026-01-01", errorMessage: null, crop: null }], lastPrompt: null, generationProgress: 1, errorMessage: null }, order: 0, ...overrides }],
  unrecognizedText: [],
});

describe("customer preview pre-publish certification", () => {
  it("certifies a complete customer menu", () => {
    const result = certifyMenuPreview(restaurant, state());
    expect(result.canPublish).toBe(true);
    expect(result.readiness).toBeGreaterThan(80);
    expect(result.summary).toMatchObject({ itemCount: 1, categoryCount: 1, missingImages: 0, missingPrices: 0, missingDescriptions: 0 });
  });

  it("blocks invalid prices but treats missing presentation content as fixable warnings", () => {
    const invalid = certifyMenuPreview(restaurant, state({ price: { value: null, confidence: 0 }, description: { value: null, confidence: 0 }, imageDraft: { status: "Pending", selectedVersionId: null, versions: [], lastPrompt: null, generationProgress: 0, errorMessage: null } }));
    expect(invalid.canPublish).toBe(false);
    expect(invalid.checks.find((check) => check.id === "prices")).toMatchObject({ ready: false, blocking: true });
    expect(invalid.checks.find((check) => check.id === "images")).toMatchObject({ ready: false, blocking: false });
    expect(invalid.checks.find((check) => check.id === "descriptions")).toMatchObject({ ready: false, blocking: false });
    expect(invalid.readiness).toBeLessThan(100);
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { normalizeAiMenuResult } from "../../supabase/functions/menu-ai-import/contracts";
import { createMenuReviewState, createSmartMenuImageDraft, refreshMenuReviewStateImages } from "../../src/modules/setup-wizard/services/menuReviewState";
import { resolveMenuItemImage } from "../../src/core/presentation/menuItemImage";
import { resolveSmartImage } from "../../src/core/presentation/smartImageDelivery";
import { menuReviewImageCandidates } from "../../src/modules/setup-wizard/services/menuReviewImageCandidates";
import { SmartImage } from "../../src/core/presentation/SmartImage";
import type { ExtractedMenuItem, ExtractedSmartImage } from "../../src/modules/setup-wizard/services/menuExtractionTypes";

const edgeFunction = readFileSync(
  resolve(process.cwd(), "supabase/functions/menu-ai-import/index.ts"),
  "utf8",
);
const reviewStudio = readFileSync(resolve(process.cwd(), "src/modules/setup-wizard/components/AiMenuReviewStudio.tsx"), "utf8");

const field = <T>(value: T | null) => ({ value, confidence: value === null ? 0 : 1 });

function smartImage(status: ExtractedSmartImage["status"] = "PENDING_REVIEW"): ExtractedSmartImage {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    status,
    currentVersion: 1,
    baseStoragePath: "restaurant/breakfast/chechebsa",
    placeholderStoragePath: "_placeholders/default/v1/menu-item-640w.webp",
    providerKey: "master-library",
    providerMetadata: { specification_id: "breakfast.chechebsa.v1" },
    restaurantType: "restaurant",
    category: { id: "category-1", name: "Breakfast", slug: "breakfast" },
    menuItem: { id: "item-1", name: "Chechebsa" },
    versions: [{
      id: "20000000-0000-4000-8000-000000000001",
      version: 1,
      status,
      storagePath: "restaurant/breakfast/chechebsa/v001/chechebsa-v001-2048w.webp",
      publicUrl: "https://project.supabase.co/storage/v1/object/public/smart-menu-images/restaurant/breakfast/chechebsa/v001/chechebsa-v001-2048w.webp",
      thumbnailUrl: "https://project.supabase.co/storage/v1/object/public/smart-menu-images/restaurant/breakfast/chechebsa/v001/chechebsa-v001-2048w.webp",
      mimeType: "image/webp",
      width: 2048,
      height: 2048,
      byteSize: 123456,
      checksumSha256: "a".repeat(64),
      providerKey: "master-library",
      providerAssetId: "chechebsa-v001-2048w.webp",
      providerMetadata: { immutable: true },
      createdAt: "2026-07-29T00:00:00.000Z",
      reviewedAt: null,
    }],
    override: null,
  };
}

function extractedItem(image: ExtractedSmartImage | null): ExtractedMenuItem {
  return {
    id: "item-1",
    category: field("Breakfast"),
    name: field("Chechebsa"),
    description: field("Traditional Ethiopian breakfast."),
    price: field<number>(null),
    currency: field<string>(null),
    variants: field([]),
    comboMeal: field(false),
    drink: field(false),
    optionalNotes: field<string>(null),
    sourceText: field<string>(null),
    duplicate: false,
    duplicateOf: [],
    defaultImageReference: "serveflow://smart-menu/v1/breakfast/chechebsa",
    smartImage: image,
  };
}

describe("Phase 9.13.3.1 Smart Menu image pipeline", () => {
  it("preserves Smart Image identity and immutable version metadata during normalization", () => {
    const image = smartImage();
    const normalized = normalizeAiMenuResult({
      restaurantName: field<string>(null),
      restaurantNameLanguage: field("unknown"),
      categories: [{ name: field("Breakfast"), detectedLanguage: field("unknown") }],
      items: [{
        category: field("Breakfast"), categoryLanguage: field("unknown"),
        name: field("Chechebsa"), nameLanguage: field("unknown"),
        description: field("Traditional Ethiopian breakfast."), descriptionLanguage: field("unknown"),
        price: field<number>(null), currency: field<string>(null),
        defaultImageReference: "serveflow://smart-menu/v1/breakfast/chechebsa",
        smartImage: image,
      }],
    });
    expect(normalized.items[0].defaultImageReference).toContain("chechebsa");
    expect(normalized.items[0].smartImage).toEqual(image);
  });

  it("initializes Review Studio from a pending master instead of a placeholder", () => {
    const draft = createSmartMenuImageDraft(extractedItem(smartImage()));
    expect(draft).toMatchObject({
      status: "PENDING_REVIEW",
      selectedVersionId: "20000000-0000-4000-8000-000000000001",
      masterImageId: "10000000-0000-4000-8000-000000000001",
    });
    expect(draft.versions[0]).toMatchObject({
      source: "master",
      storagePath: "restaurant/breakfast/chechebsa/v001/chechebsa-v001-2048w.webp",
      width: 2048,
      height: 2048,
      checksumSha256: "a".repeat(64),
    });
    expect(draft.versions[0].thumbnailUrl).toContain("smart-menu-images");
  });

  it("uses CUSTOM then MASTER then PLACEHOLDER and keeps customers approved-only", () => {
    const image = smartImage();
    image.override = {
      id: "30000000-0000-4000-8000-000000000001",
      source: "CUSTOM",
      status: "APPROVED",
      imageUrl: "https://cdn.example/custom.webp",
      thumbnailUrl: "https://cdn.example/custom-thumb.webp",
      version: 3,
    };
    expect(createSmartMenuImageDraft(extractedItem(image))).toMatchObject({
      status: "Owner Upload",
      selectedVersionId: image.override.id,
    });
    const pending = { source: "MASTER", status: "PENDING_REVIEW", url: "master.webp", version: 1 } as const;
    expect(resolveMenuItemImage({ itemId: "item", master: pending, placeholderUrl: "placeholder.webp" }).url).toBe("placeholder.webp");
    expect(resolveMenuItemImage({ itemId: "item", master: pending, placeholderUrl: "placeholder.webp" }, "owner-review").url).toBe("master.webp");
    expect(resolveMenuItemImage({ itemId: "item", master: { ...pending, status: "APPROVED" }, placeholderUrl: "placeholder.webp" }).url).toBe("master.webp");
    expect(createSmartMenuImageDraft(extractedItem(null)).versions).toEqual([]);
  });

  it("creates Review Studio state with the existing master selected", () => {
    const state = createMenuReviewState({
      schemaVersion: 1,
      restaurantName: field<string>(null),
      categories: [field("Breakfast")],
      items: [extractedItem(smartImage())],
      unrecognizedSections: [],
    }, () => "review-id");
    expect(state.items[0].imageDraft.status).toBe("PENDING_REVIEW");
    expect(state.items[0].imageDraft.versions[0].imageUrl).toContain("chechebsa-v001-2048w.webp");
    const candidates = menuReviewImageCandidates(state.items[0].imageDraft);
    const resolved = resolveSmartImage({ itemId: state.items[0].id, ...candidates, placeholderUrl: "placeholder.webp" }, "card", "owner-review");
    expect(resolved.source).toBe("MASTER");
    expect(resolved.url).toContain("chechebsa-v001-2048w.webp");
    const html = renderToStaticMarkup(createElement(SmartImage, {
      resolution: resolved,
      alt: "Chechebsa",
      fallback: "C",
      fallbackClassName: "placeholder",
      eager: true,
    }));
    expect(html).toContain('src="https://project.supabase.co/storage/v1/object/public/smart-menu-images/restaurant/breakfast/chechebsa/v001/chechebsa-v001-2048w.webp"');
    expect(html).toContain('alt="Chechebsa"');
  });

  it("refreshes a stale owner review state when a master is deployed later", () => {
    const source = { schemaVersion: 1 as const, restaurantName: field<string>(null), categories: [field("Breakfast")], items: [extractedItem(null)], unrecognizedSections: [] };
    const stale = createMenuReviewState(source, () => "review-id");
    stale.items[0].approved = true;
    const refreshed = refreshMenuReviewStateImages(stale, { ...source, items: [extractedItem(smartImage())] });
    expect(refreshed.items[0].approved).toBe(true);
    expect(refreshed.items[0].imageDraft.status).toBe("PENDING_REVIEW");
    expect(refreshed.items[0].imageDraft.selectedVersionId).toBe("20000000-0000-4000-8000-000000000001");
    expect(refreshed.items[0].imageDraft.versions[0].imageUrl).toContain("smart-menu-images");
  });

  it("loads versions, overrides, and public URLs without upload or generation calls", () => {
    expect(edgeFunction).toContain('from("serveflow_smart_menu_images")');
    expect(edgeFunction).toContain('from("serveflow_smart_menu_image_versions")');
    expect(edgeFunction).toContain('from("restaurant_smart_menu_image_overrides")');
    expect(edgeFunction).toContain('getPublicUrl(version.storage_path)');
    expect(edgeFunction).toContain("masterSelectionScore");
    expect(edgeFunction).toContain("master.current_version > 0 && versionedMasterIds.has(master.id)");
    expect(edgeFunction).toContain("smartImagesRefreshed: true");
    expect(reviewStudio).toContain("createSmartMenuLibraryDraft(restaurantId, entry.sourceReference)");
    expect(edgeFunction).not.toContain('.storage.from("smart-menu-images").upload(');
  });
});

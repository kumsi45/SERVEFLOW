import { createBrowserUuid } from "../../../core/browser/createBrowserUuid";
import { supabase } from "../../../core/database";
import { resolveMenuReviewText } from "./menuReviewState";
import type {
  MenuReviewCategory,
  MenuReviewImageVersion,
  MenuReviewItem,
} from "./menuReviewTypes";

type GenerateImageResponse = {
  imageUrl?: string;
  thumbnailUrl?: string;
  version?: MenuReviewImageVersion;
  reviewRevision?: number;
  generationProgress?: number;
  error?: string;
};

function compact(parts: Array<string | null | undefined>) {
  return parts.map((part) => part?.trim()).filter(Boolean).join(". ");
}

export function isEligibleForImageGeneration(item: MenuReviewItem) {
  return Boolean(
    item.approved &&
      !item.deleted &&
      !item.hidden &&
      !item.rejected,
  );
}

export function buildMenuImagePrompt(
  item: MenuReviewItem,
  categories: MenuReviewCategory[],
  restaurantType?: string | null,
  cuisine?: string | null,
) {
  const category = categories.find((entry) => entry.id === item.categoryId);
  const categoryName = category?.name ?? null;
  const foodName = resolveMenuReviewText(item.name, item.nameLocalization);
  const description = resolveMenuReviewText(
    item.description,
    item.descriptionLocalization,
  );
  const notes = resolveMenuReviewText(item.notes, item.notesLocalization);
  const sourceText = item.sourceText.value;

  return compact([
    "Professional restaurant food photography, premium restaurant plating, sharp 4K quality, natural lighting, professional shadows, realistic food texture, natural plate, no watermark, no logo, no text, no menu background, not illustration, not painting, not cartoon, not CGI",
    foodName ? `Food name: ${foodName}` : null,
    description ? `Description: ${description}` : null,
    categoryName ? `Category: ${categoryName}` : null,
    restaurantType ? `Restaurant type: ${restaurantType}` : null,
    cuisine ? `Cuisine: ${cuisine}` : null,
    notes ? `Owner notes: ${notes}` : null,
    sourceText ? `Canonical source text: ${sourceText}` : null,
    "Use only the named or described ingredients; do not add unmentioned toppings, sides, sauces, labels, utensils, or garnish",
  ]);
}

export async function generateMenuItemImageDraft(
  item: MenuReviewItem,
  categories: MenuReviewCategory[],
  extractionId: string,
  expectedRevision: number,
) {
  const prompt = buildMenuImagePrompt(item, categories);
  const { data, error } = await supabase.functions.invoke(
    "menu-item-image-draft",
    {
      body: {
        extractionId,
        itemId: item.id,
        expectedRevision,
      },
    },
  );
  if (error) throw new Error(error.message);
  const payload = (data ?? {}) as GenerateImageResponse;
  if (payload.error) throw new Error(payload.error);
  if (payload.version) {
    return {
      version: payload.version,
      reviewRevision: typeof payload.reviewRevision === "number"
        ? payload.reviewRevision
        : null,
      generationProgress: typeof payload.generationProgress === "number"
        ? payload.generationProgress
        : 1,
    };
  }
  if (!payload.imageUrl) {
    throw new Error("Image generation returned no draft image.");
  }
  const version = Math.max(0, ...item.imageDraft.versions.map((entry) => entry.version)) + 1;
  return {
    version: createImageVersion(
      version,
      "ai",
      payload.imageUrl,
      payload.thumbnailUrl ?? payload.imageUrl,
      prompt,
    ),
    reviewRevision: typeof payload.reviewRevision === "number"
      ? payload.reviewRevision
      : null,
    generationProgress: typeof payload.generationProgress === "number"
      ? payload.generationProgress
      : 1,
  };
}

export function createImageVersion(
  version: number,
  source: MenuReviewImageVersion["source"],
  imageUrl: string,
  thumbnailUrl: string,
  prompt: string,
): MenuReviewImageVersion {
  return {
    id: createBrowserUuid(),
    version,
    status: source === "owner" ? "Owner Upload" : "Ready",
    source,
    imageUrl,
    thumbnailUrl,
    prompt,
    createdAt: new Date().toISOString(),
    errorMessage: null,
    crop: null,
  };
}

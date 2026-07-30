export type ImageDraftStatus =
  | "Pending"
  | "Generating"
  | "Ready"
  | "Approved"
  | "Rejected"
  | "Owner Upload"
  | "GENERATING"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "PLACEHOLDER"
  | "ARCHIVED";

export type ConfidenceField<T> = {
  value: T | null;
  confidence: number;
};

export type ReviewCategory = {
  id: string;
  name: string;
  localization?: MenuReviewLocalization;
};

export type ImageDraftVersion = {
  id: string;
  version: number;
  status: ImageDraftStatus;
  source: "ai" | "owner" | "master";
  imageUrl: string | null;
  thumbnailUrl: string | null;
  prompt: string;
  createdAt: string;
  errorMessage: string | null;
  crop: { x: number; y: number; scale: number } | null;
};

export type ReviewItem = {
  id: string;
  categoryId: string | null;
  name: ConfidenceField<string>;
  nameLocalization?: MenuReviewLocalization;
  description: ConfidenceField<string>;
  descriptionLocalization?: MenuReviewLocalization;
  notes: ConfidenceField<string>;
  notesLocalization?: MenuReviewLocalization;
  sourceText: ConfidenceField<string>;
  approved: boolean;
  deleted: boolean;
  hidden?: boolean;
  rejected?: boolean;
  imageDraft: {
    status: ImageDraftStatus;
    selectedVersionId: string | null;
    versions: ImageDraftVersion[];
    lastPrompt: string | null;
    generationProgress: number;
    errorMessage: string | null;
  };
};

export type ReviewState = {
  schemaVersion: 2;
  restaurantName?: ConfidenceField<string>;
  restaurantNameLocalization?: MenuReviewLocalization;
  categories: ReviewCategory[];
  items: ReviewItem[];
};

export type RestaurantProfile = {
  name: string | null;
  restaurantType: string | null;
  cuisine: string | null;
  description: string | null;
  style: string | null;
  nameLocalization: MenuReviewLocalization | null;
};

export type ImageGenerationPrompt = {
  prompt: string;
  negativePrompt: string;
  foodName: string;
};

export type GeneratedImage = {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  providerAssetId: string | null;
};

export type ImageGenerationProvider = {
  name: string;
  model: string;
  generate(prompt: ImageGenerationPrompt): Promise<GeneratedImage>;
};

function clean(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

type MenuLanguage = "en" | "om" | "am";

type MenuReviewLocalization = {
  values: Record<MenuLanguage, ConfidenceField<string>>;
  detectedLanguage: MenuLanguage | "mixed" | "unknown";
  languageConfidence: number;
  ownerEdited: Record<MenuLanguage, boolean>;
};

export function canonicalText(field: ConfidenceField<string> | undefined) {
  return clean(field?.value, 2000);
}

export function compact(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(". ");
}

function localizedSummary(
  label: string,
  localization: MenuReviewLocalization | undefined,
) {
  if (!localization) return null;
  const values = (["en", "om", "am"] as const)
    .map((language) => {
      const value = clean(localization.values?.[language]?.value, 500);
      return value ? `${language}: ${value}` : null;
    })
    .filter(Boolean);
  return values.length
    ? `${label} localized fields (${localization.detectedLanguage} detected): ${values.join("; ")}`
    : `${label} detected language: ${localization.detectedLanguage}`;
}

function imageHistory(item: ReviewItem) {
  const history = item.imageDraft.versions
    .filter((version) => version.imageUrl || version.prompt || version.errorMessage)
    .slice(-5)
    .map((version) =>
      [
        `version ${version.version}`,
        version.status,
        version.source,
        clean(version.prompt, 400),
        version.errorMessage ? `error: ${clean(version.errorMessage, 200)}` : null,
      ].filter(Boolean).join(" - ")
    );
  return history.length ? `Existing image history: ${history.join(" | ")}` : null;
}

export function buildImageGenerationPrompt(
  item: ReviewItem,
  categories: ReviewCategory[],
  restaurant: RestaurantProfile,
): ImageGenerationPrompt {
  const foodName = canonicalText(item.name);
  if (!foodName) throw new Error("Approved food name is required.");

  const category = categories.find((entry) => entry.id === item.categoryId);
  const description = canonicalText(item.description);
  const notes = canonicalText(item.notes);
  const sourceText = canonicalText(item.sourceText);
  const categoryName = clean(category?.name, 160);
  const detectedLanguages = [
    item.nameLocalization?.detectedLanguage,
    item.descriptionLocalization?.detectedLanguage,
    item.notesLocalization?.detectedLanguage,
    category?.localization?.detectedLanguage,
  ].filter(Boolean).join(", ");

  return {
    foodName,
    prompt: compact([
      "Photorealistic restaurant-quality food photography",
      "natural lighting, real ingredients, real plate, appetizing texture, sharp focus, premium plating",
      "clean restaurant surface with no background clutter",
      "no text, no watermark, no logo, no menu page, no hands, no packaging",
      "never cartoon, never illustration, never CGI, never AI-art style",
      `Food name: ${foodName}`,
      description ? `Description: ${description}` : null,
      categoryName ? `Category: ${categoryName}` : null,
      restaurant.restaurantType ? `Restaurant type: ${restaurant.restaurantType}` : null,
      restaurant.cuisine ? `Cuisine: ${restaurant.cuisine}` : null,
      restaurant.style ? `Restaurant style: ${restaurant.style}` : null,
      restaurant.name ? `Restaurant: ${restaurant.name}` : null,
      restaurant.description ? `Restaurant profile: ${restaurant.description}` : null,
      notes ? `Owner notes: ${notes}` : null,
      sourceText ? `Canonical source text: ${sourceText}` : null,
      detectedLanguages ? `Detected language signals: ${detectedLanguages}` : null,
      localizedSummary("Food name", item.nameLocalization),
      localizedSummary("Description", item.descriptionLocalization),
      localizedSummary("Notes", item.notesLocalization),
      localizedSummary("Category", category?.localization),
      localizedSummary("Restaurant name", restaurant.nameLocalization ?? undefined),
      imageHistory(item),
      "Use only the named or described ingredients. Do not add unmentioned toppings, sides, sauces, labels, utensils, garnish, or drinks.",
    ]),
    negativePrompt:
      "cartoon, illustration, painting, CGI, AI-art style, text, watermark, logo, label, menu, background clutter, extra ingredients, extra sides, extra garnish",
  };
}

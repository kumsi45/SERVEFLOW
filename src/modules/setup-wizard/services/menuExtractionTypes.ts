import type { DetectedMenuLanguage } from "../../../core/menu/menuLanguage";

export type ConfidenceField<T> = {
  value: T | null;
  confidence: number;
};

export type ExtractedLanguageDetection =
  ConfidenceField<DetectedMenuLanguage>;

export type ExtractedMenuCategory = {
  name: ConfidenceField<string>;
  detectedLanguage: ExtractedLanguageDetection;
};

export type ExtractedVariant = {
  name: ConfidenceField<string>;
  price: ConfidenceField<number>;
  currency: ConfidenceField<string>;
};

export type ExtractedMenuItem = {
  id: string;
  category: ConfidenceField<string>;
  categoryLanguage?: ExtractedLanguageDetection;
  name: ConfidenceField<string>;
  nameLanguage?: ExtractedLanguageDetection;
  description: ConfidenceField<string>;
  descriptionLanguage?: ExtractedLanguageDetection;
  price: ConfidenceField<number>;
  currency: ConfidenceField<string>;
  variants: ConfidenceField<ExtractedVariant[]>;
  comboMeal: ConfidenceField<boolean>;
  drink: ConfidenceField<boolean>;
  optionalNotes: ConfidenceField<string>;
  optionalNotesLanguage?: ExtractedLanguageDetection;
  sourceText: ConfidenceField<string>;
  duplicate: boolean;
  duplicateOf: string[];
  defaultImageReference?: string | null;
  smartImage?: ExtractedSmartImage | null;
};

export type ExtractedSmartImageStatus =
  | "PLACEHOLDER"
  | "GENERATING"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "ARCHIVED";

export type ExtractedSmartImageVersion = {
  id: string;
  version: number;
  status: ExtractedSmartImageStatus;
  storagePath: string;
  publicUrl: string;
  thumbnailUrl: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number | null;
  checksumSha256: string | null;
  providerKey: string | null;
  providerAssetId: string | null;
  providerMetadata: Record<string, unknown>;
  createdAt: string;
  reviewedAt: string | null;
};

export type ExtractedSmartImage = {
  id: string;
  status: ExtractedSmartImageStatus;
  currentVersion: number;
  baseStoragePath: string;
  placeholderStoragePath: string;
  providerKey: string | null;
  providerMetadata: Record<string, unknown>;
  restaurantType: string;
  category: { id: string; name: string; slug: string };
  menuItem: { id: string; name: string };
  versions: ExtractedSmartImageVersion[];
  override: {
    id: string;
    source: "MASTER" | "CUSTOM" | "PLACEHOLDER";
    status: ExtractedSmartImageStatus;
    imageUrl: string | null;
    thumbnailUrl: string | null;
    version: number;
  } | null;
};

export type UnrecognizedSection = {
  text: ConfidenceField<string>;
};

export type MenuExtractionResult = {
  schemaVersion: 1;
  restaurantName: ConfidenceField<string>;
  restaurantNameLanguage?: ExtractedLanguageDetection;
  categories: Array<ConfidenceField<string> | ExtractedMenuCategory>;
  items: ExtractedMenuItem[];
  unrecognizedSections: UnrecognizedSection[];
};

export type MenuExtractionStatus = "processing" | "completed" | "failed";

export type MenuExtractionDraft = {
  id: string;
  restaurantId: string;
  sourceDraftId: string | null;
  sourceKind: "upload" | "starter" | "manual" | "smart_library";
  sourceReference: string | null;
  sourceUpdatedAt: string;
  provider: string;
  model: string;
  status: MenuExtractionStatus;
  result: MenuExtractionResult | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
  reviewState: import("./menuReviewTypes").MenuReviewState | null;
  reviewRevision: number;
  reviewUpdatedAt: string | null;
};

export const LOW_CONFIDENCE_THRESHOLD = 0.75;

export function formatConfidence(confidence: number) {
  return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;
}

export function getExtractionIssues(item: ExtractedMenuItem) {
  const issues: string[] = [];
  if (item.price.value === null) issues.push("Missing price");
  if (!item.category.value) issues.push("Missing category");
  if (
    [
      item.category,
      item.name,
      item.description,
      item.price,
      item.currency,
      item.variants,
      item.comboMeal,
      item.drink,
      item.optionalNotes,
    ].some((field) => field.value !== null && field.confidence < LOW_CONFIDENCE_THRESHOLD)
  ) {
    issues.push("Low confidence");
  }
  if (item.duplicate) issues.push("Possible duplicate");
  return issues;
}

export function groupExtractionItems(items: ExtractedMenuItem[]) {
  return items.reduce<Record<string, ExtractedMenuItem[]>>((groups, item) => {
    const category = item.category.value?.trim() || "Missing Category";
    (groups[category] ??= []).push(item);
    return groups;
  }, {});
}

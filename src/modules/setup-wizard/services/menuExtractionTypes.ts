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
  sourceDraftId: string;
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

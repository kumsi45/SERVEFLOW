import { createBrowserUuid } from "../../../core/browser/createBrowserUuid";
import { LOW_CONFIDENCE_THRESHOLD } from "./menuExtractionTypes";
import type {
  MenuReviewFilter,
  MenuReviewItem,
  MenuReviewState,
  MenuReviewSummary,
  MenuReviewWarning,
  MenuReviewSource,
} from "./menuReviewTypes";

function normalizedName(value: string | null) {
  return value
    ?.normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim() || "";
}

function hasUnknownCharacters(value: string) {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/u.test(value);
}

function looksSuspicious(value: string) {
  return /([^\p{L}\p{N}\s])\1{2,}/u.test(value)
    || /(?:\b[lI|]{4,}\b)|(?:\?{2,})/u.test(value);
}

export function createMenuReviewState(
  source: MenuReviewSource,
  createId: () => string = createBrowserUuid,
): MenuReviewState {
  const categories = new Map<string, {
    id: string;
    name: string;
    confidence: number;
    order: number;
  }>();

  function ensureCategory(name: string | null, confidence: number) {
    const trimmed = name?.trim();
    if (!trimmed) return null;
    const key = normalizedName(trimmed);
    const existing = categories.get(key);
    if (existing) {
      existing.confidence = Math.max(existing.confidence, confidence);
      return existing.id;
    }
    const category = {
      id: createId(),
      name: trimmed,
      confidence,
      order: categories.size,
    };
    categories.set(key, category);
    return category.id;
  }

  source.categories.forEach((category) => {
    ensureCategory(category.value, category.confidence);
  });

  const items = source.items.map<MenuReviewItem>((item, index) => ({
    id: createId(),
    sourceItemId: item.id,
    categoryId: ensureCategory(item.category.value, item.category.confidence),
    categoryConfidence: item.category.confidence,
    name: { ...item.name },
    description: { ...item.description },
    price: { ...item.price },
    currency: { ...item.currency },
    notes: { ...item.optionalNotes },
    sourceText: { ...item.sourceText },
    approved: false,
    deleted: false,
    order: index,
  }));

  return {
    schemaVersion: 1,
    restaurantName: { ...source.restaurantName },
    categories: Array.from(categories.values()),
    items,
    unrecognizedText: source.unrecognizedSections.map((section) => ({
      id: createId(),
      text: section.text.value || "",
      confidence: section.text.confidence,
      status: "active",
      convertedItemId: null,
    })),
  };
}

export function getDuplicateItemIds(items: MenuReviewItem[]) {
  const names = new Map<string, string[]>();
  for (const item of items) {
    if (item.deleted) continue;
    const key = normalizedName(item.name.value);
    if (!key) continue;
    const ids = names.get(key) ?? [];
    ids.push(item.id);
    names.set(key, ids);
  }
  return new Set(
    Array.from(names.values())
      .filter((ids) => ids.length > 1)
      .flat(),
  );
}

export function getMenuReviewWarnings(
  item: MenuReviewItem,
  duplicateIds: ReadonlySet<string>,
): MenuReviewWarning[] {
  const warnings: MenuReviewWarning[] = [];
  const text = [
    item.name.value,
    item.description.value,
    item.notes.value,
    item.sourceText.value,
  ].filter((value): value is string => Boolean(value)).join(" ");
  if (
    [
      item.name,
      item.description,
      item.price,
      item.currency,
      item.notes,
    ].some((field) =>
      field.value !== null && field.confidence < LOW_CONFIDENCE_THRESHOLD
    ) || (
      item.categoryId !== null
      && item.categoryConfidence < LOW_CONFIDENCE_THRESHOLD
    )
  ) {
    warnings.push("Low Confidence");
  }
  if (item.price.value === null) warnings.push("Missing Price");
  if (!item.description.value?.trim()) warnings.push("Missing Description");
  if (!item.categoryId) warnings.push("Missing Category");
  if (duplicateIds.has(item.id)) warnings.push("Duplicate Name");
  if (looksSuspicious(text)) warnings.push("Suspicious OCR");
  if (hasUnknownCharacters(text)) warnings.push("Unknown Characters");
  return warnings;
}

export function summarizeMenuReview(state: MenuReviewState): MenuReviewSummary {
  const activeItems = state.items.filter((item) => !item.deleted);
  const duplicateIds = getDuplicateItemIds(activeItems);
  const warnings = activeItems.map((item) =>
    getMenuReviewWarnings(item, duplicateIds)
  );
  const approvedItems = activeItems.filter((item) => item.approved).length;
  return {
    totalCategories: state.categories.length,
    totalItems: activeItems.length,
    approvedItems,
    lowConfidenceItems: warnings.filter((entry) =>
      entry.includes("Low Confidence")
    ).length,
    missingPrices: warnings.filter((entry) =>
      entry.includes("Missing Price")
    ).length,
    missingCategories: warnings.filter((entry) =>
      entry.includes("Missing Category")
    ).length,
    duplicates: duplicateIds.size,
    unrecognizedText: state.unrecognizedText.filter(
      (entry) => entry.status === "active",
    ).length,
    progress: activeItems.length === 0
      ? 0
      : Math.round((approvedItems / activeItems.length) * 100),
  };
}

export function matchesMenuReviewSearch(
  item: MenuReviewItem,
  categoryName: string,
  query: string,
) {
  const normalizedQuery = normalizedName(query);
  if (!normalizedQuery) return true;
  return normalizedName([
    item.name.value,
    item.description.value,
    categoryName,
  ].filter(Boolean).join(" ")).includes(normalizedQuery);
}

export function matchesMenuReviewFilter(
  item: MenuReviewItem,
  filter: MenuReviewFilter,
  warnings: MenuReviewWarning[],
) {
  if (filter === "deleted") return item.deleted;
  if (item.deleted) return false;
  if (filter === "all") return true;
  if (filter === "needs-review") {
    return !item.approved || warnings.length > 0;
  }
  if (filter === "low-confidence") return warnings.includes("Low Confidence");
  if (filter === "missing-price") return warnings.includes("Missing Price");
  if (filter === "duplicates") return warnings.includes("Duplicate Name");
  return true;
}


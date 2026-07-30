import { createBrowserUuid } from "../../../core/browser/createBrowserUuid";
import {
  MENU_LANGUAGES,
  detectMenuTextScript,
  isMenuLanguage,
  normalizeDetectedMenuLanguage,
  type MenuLanguage,
} from "../../../core/menu/menuLanguage";
import { LOW_CONFIDENCE_THRESHOLD } from "./menuExtractionTypes";
import type {
  ConfidenceField,
  ExtractedLanguageDetection,
  ExtractedMenuCategory,
} from "./menuExtractionTypes";
import type {
  MenuReviewFilter,
  MenuReviewCategory,
  MenuReviewItem,
  MenuReviewState,
  MenuReviewSummary,
  MenuReviewWarning,
  MenuReviewSource,
  MenuReviewLocalization,
  MenuReviewImageDraft,
} from "./menuReviewTypes";
import type { ExtractedMenuItem } from "./menuExtractionTypes";
import { resolveMenuItemImage } from "../../../core/presentation/menuItemImage";
import { SERVEFLOW_MENU_PLACEHOLDER_IMAGE } from "./ownerMenuItemDefaults";

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

function emptyLocalizedValues(): MenuReviewLocalization["values"] {
  return {
    en: { value: null, confidence: 0 },
    om: { value: null, confidence: 0 },
    am: { value: null, confidence: 0 },
  };
}

export function createMenuReviewLocalization(
  source: ConfidenceField<string>,
  detection?: ExtractedLanguageDetection,
): MenuReviewLocalization {
  const detectedLanguage = normalizeDetectedMenuLanguage(
    detection?.value ?? detectMenuTextScript(source.value),
  );
  const values = emptyLocalizedValues();
  if (isMenuLanguage(detectedLanguage) && source.value !== null) {
    values[detectedLanguage] = { ...source };
  }
  return {
    values,
    detectedLanguage,
    languageConfidence: detection?.confidence ?? (
      detectedLanguage === "am" ? 0.98 : detectedLanguage === "mixed" ? 0.9 : 0
    ),
    ownerEdited: { en: false, om: false, am: false },
  };
}

export function resolveMenuReviewText(
  source: ConfidenceField<string>,
  localization: MenuReviewLocalization,
  language?: MenuLanguage,
) {
  if (language) {
    const translated = localization.values[language]?.value;
    if (translated?.trim()) return translated;
  }
  if (isMenuLanguage(localization.detectedLanguage)) {
    const detected = localization.values[localization.detectedLanguage]?.value;
    if (detected?.trim()) return detected;
  }
  return source.value ?? "";
}

export function createPendingImageDraft(): MenuReviewImageDraft {
  return {
    status: "Pending",
    selectedVersionId: null,
    versions: [],
    lastPrompt: null,
    generationProgress: 0,
    errorMessage: null,
    defaultImageReference: null,
    masterImageId: null,
    masterImageStatus: null,
    masterImageBaseStoragePath: null,
    masterImageMetadata: null,
  };
}

export function createSmartMenuImageDraft(
  item: Pick<ExtractedMenuItem, "defaultImageReference" | "smartImage">,
): MenuReviewImageDraft {
  const smartImage = item.smartImage;
  if (!smartImage) return createPendingImageDraft();
  const current = smartImage.versions.find(
    (version) => version.version === smartImage.currentVersion,
  ) ?? smartImage.versions[smartImage.versions.length - 1] ?? null;
  const master = {
    id: current?.id,
    source: "MASTER" as const,
    status: smartImage.status,
    url: current?.publicUrl ?? null,
    thumbnailUrl: current?.thumbnailUrl ?? current?.publicUrl ?? null,
    version: current?.version ?? smartImage.currentVersion,
  };
  const override = smartImage.override
    ? {
      id: smartImage.override.id,
      source: smartImage.override.source,
      status: smartImage.override.status,
      url: smartImage.override.imageUrl,
      thumbnailUrl: smartImage.override.thumbnailUrl,
      version: smartImage.override.version,
    }
    : null;
  const selected = resolveMenuItemImage({
    itemId: item.defaultImageReference ?? smartImage.id,
    master,
    custom: override,
    placeholderUrl: SERVEFLOW_MENU_PLACEHOLDER_IMAGE,
  }, "owner-review");
  const versions = smartImage.versions.map<MenuReviewImageDraft["versions"][number]>(
    (version) => ({
      id: version.id,
      version: version.version,
      status: version.status,
      source: "master",
      imageUrl: version.publicUrl,
      thumbnailUrl: version.thumbnailUrl,
      prompt: "Existing ServeFlow Smart Menu master image.",
      createdAt: version.createdAt,
      errorMessage: null,
      crop: null,
      storagePath: version.storagePath,
      mimeType: version.mimeType,
      width: version.width,
      height: version.height,
      byteSize: version.byteSize,
      checksumSha256: version.checksumSha256,
      providerKey: version.providerKey,
      providerAssetId: version.providerAssetId,
      providerMetadata: version.providerMetadata,
      reviewedAt: version.reviewedAt,
    }),
  );
  if (selected.source === "CUSTOM" && selected.url && selected.id) {
    versions.push({
      id: selected.id,
      version: selected.version,
      status: "Owner Upload",
      source: "owner",
      imageUrl: selected.url,
      thumbnailUrl: selected.thumbnailUrl ?? selected.url,
      prompt: "Owner uploaded image.",
      createdAt: new Date().toISOString(),
      errorMessage: null,
      crop: null,
    });
  }
  const selectedVersionId = selected.source === "PLACEHOLDER"
    ? null
    : selected.id ?? null;
  return {
    status: selected.source === "CUSTOM"
      ? "Owner Upload"
      : smartImage.status === "GENERATING" ||
          smartImage.status === "PENDING_REVIEW" ||
          smartImage.status === "APPROVED"
        ? smartImage.status
        : "Pending",
    selectedVersionId,
    versions,
    lastPrompt: null,
    generationProgress: selectedVersionId ? 1 : 0,
    errorMessage: null,
    defaultImageReference: item.defaultImageReference ?? null,
    masterImageId: smartImage.id,
    masterImageStatus: smartImage.status,
    masterImageBaseStoragePath: smartImage.baseStoragePath,
    masterImageMetadata: {
      restaurantType: smartImage.restaurantType,
      category: smartImage.category,
      menuItem: smartImage.menuItem,
      providerMetadata: smartImage.providerMetadata,
    },
  };
}

function asExtractedCategory(
  category: MenuReviewSource["categories"][number],
): ExtractedMenuCategory {
  if ("name" in category) return category;
  return {
    name: category,
    detectedLanguage: {
      value: detectMenuTextScript(category.value),
      confidence: 0,
    },
  };
}

export function createMenuReviewState(
  source: MenuReviewSource,
  createId: () => string = createBrowserUuid,
): MenuReviewState {
  const categories = new Map<string, MenuReviewCategory>();

  function ensureCategory(
    name: string | null,
    confidence: number,
    detection?: ExtractedLanguageDetection,
  ) {
    const sourceName = name ?? "";
    if (!sourceName.trim()) return null;
    const key = normalizedName(sourceName);
    const existing = categories.get(key);
    if (existing) {
      existing.confidence = Math.max(existing.confidence, confidence);
      if (
        detection &&
        existing.localization.detectedLanguage === "unknown"
      ) {
        existing.localization = createMenuReviewLocalization(
          { value: sourceName, confidence },
          detection,
        );
      }
      return existing.id;
    }
    const category = {
      id: createId(),
      name: sourceName,
      confidence,
      localization: createMenuReviewLocalization(
        { value: sourceName, confidence },
        detection,
      ),
      order: categories.size,
    };
    categories.set(key, category);
    return category.id;
  }

  source.categories.forEach((category) => {
    const extracted = asExtractedCategory(category);
    const categoryId = ensureCategory(
      extracted.name.value,
      extracted.name.confidence,
      extracted.detectedLanguage,
    );
    if (categoryId) {
      const entry = Array.from(categories.values()).find(
        (candidate) => candidate.id === categoryId,
      );
      if (entry) {
        entry.localization = createMenuReviewLocalization(
          extracted.name,
          extracted.detectedLanguage,
        );
      }
    }
  });

  const items = source.items.map<MenuReviewItem>((item, index) => ({
    id: createId(),
    sourceItemId: item.id,
    categoryId: ensureCategory(
      item.category.value,
      item.category.confidence,
      item.categoryLanguage,
    ),
    categoryConfidence: item.category.confidence,
    name: { ...item.name },
    nameLocalization: createMenuReviewLocalization(
      item.name,
      item.nameLanguage,
    ),
    description: { ...item.description },
    descriptionLocalization: createMenuReviewLocalization(
      item.description,
      item.descriptionLanguage,
    ),
    price: { ...item.price },
    currency: { ...item.currency },
    notes: { ...item.optionalNotes },
    notesLocalization: createMenuReviewLocalization(
      item.optionalNotes,
      item.optionalNotesLanguage,
    ),
    sourceText: { ...item.sourceText },
    approved: false,
    deleted: false,
    hidden: false,
    rejected: false,
    trackingType: "no_tracking",
    imageDraft: createSmartMenuImageDraft(item),
    order: index,
  }));

  return {
    schemaVersion: 2,
    restaurantName: { ...source.restaurantName },
    restaurantNameLocalization: createMenuReviewLocalization(
      source.restaurantName,
      source.restaurantNameLanguage,
    ),
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

function isLocalization(value: unknown): value is MenuReviewLocalization {
  if (!value || typeof value !== "object") return false;
  const localization = value as Partial<MenuReviewLocalization>;
  return Boolean(
    localization.values &&
    typeof localization.values === "object" &&
    localization.ownerEdited &&
    typeof localization.ownerEdited === "object",
  );
}

export function upgradeMenuReviewState(value: MenuReviewState): MenuReviewState {
  const legacy = value as unknown as Record<string, unknown>;
  const categories = Array.isArray(legacy.categories)
    ? legacy.categories as Array<Record<string, unknown>>
    : [];
  const items = Array.isArray(legacy.items)
    ? legacy.items as Array<Record<string, unknown>>
    : [];
  const restaurantName = legacy.restaurantName as ConfidenceField<string>;
  return {
    ...(value as MenuReviewState),
    schemaVersion: 2,
    restaurantNameLocalization: isLocalization(
      legacy.restaurantNameLocalization,
    )
      ? legacy.restaurantNameLocalization
      : createMenuReviewLocalization(restaurantName),
    categories: categories.map((category) => {
      const source = {
        value: typeof category.name === "string" ? category.name : null,
        confidence: typeof category.confidence === "number"
          ? category.confidence
          : 0,
      };
      return {
        ...(category as unknown as MenuReviewState["categories"][number]),
        localization: isLocalization(category.localization)
          ? category.localization
          : createMenuReviewLocalization(source),
      };
    }),
    items: items.map((item) => {
      const typed = item as unknown as MenuReviewItem;
      return {
        ...typed,
        nameLocalization: isLocalization(item.nameLocalization)
          ? item.nameLocalization
          : createMenuReviewLocalization(typed.name),
        descriptionLocalization: isLocalization(item.descriptionLocalization)
          ? item.descriptionLocalization
          : createMenuReviewLocalization(typed.description),
        notesLocalization: isLocalization(item.notesLocalization)
          ? item.notesLocalization
          : createMenuReviewLocalization(typed.notes),
        hidden: Boolean(item.hidden),
        rejected: Boolean(item.rejected),
        trackingType: item.trackingType === "recipe" || item.trackingType === "ready_to_sell"
          ? item.trackingType
          : "no_tracking",
        imageDraft: isImageDraft(item.imageDraft)
          ? normalizeImageDraft(item.imageDraft)
          : createPendingImageDraft(),
      };
    }),
  };
}

function isImageDraft(value: unknown): value is MenuReviewImageDraft {
  return Boolean(value && typeof value === "object" && "versions" in value);
}

function normalizeImageDraft(value: MenuReviewImageDraft): MenuReviewImageDraft {
  return {
    status: value.status ?? "Pending",
    selectedVersionId: value.selectedVersionId ?? null,
    versions: Array.isArray(value.versions) ? value.versions : [],
    lastPrompt: value.lastPrompt ?? null,
    generationProgress: Number(value.generationProgress ?? 0),
    errorMessage: value.errorMessage ?? null,
    defaultImageReference: value.defaultImageReference ?? null,
    masterImageId: value.masterImageId ?? null,
    masterImageStatus: value.masterImageStatus ?? null,
    masterImageBaseStoragePath: value.masterImageBaseStoragePath ?? null,
    masterImageMetadata: value.masterImageMetadata ?? null,
  };
}

export function getDuplicateItemIds(items: MenuReviewItem[]) {
  const names = new Map<string, string[]>();
  for (const item of items) {
    if (item.deleted) continue;
    const key = normalizedName(resolveMenuReviewText(
      item.name,
      item.nameLocalization,
    ));
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
    ...MENU_LANGUAGES.flatMap((language) => [
      item.nameLocalization.values[language].value,
      item.descriptionLocalization.values[language].value,
      item.notesLocalization.values[language].value,
    ]),
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
  if (!resolveMenuReviewText(
    item.description,
    item.descriptionLocalization,
  ).trim()) {
    warnings.push("Missing Description");
  }
  if (!item.categoryId) warnings.push("Missing Category");
  if (duplicateIds.has(item.id)) warnings.push("Duplicate Name");
  if (looksSuspicious(text)) warnings.push("Suspicious Text");
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
    ...MENU_LANGUAGES.flatMap((language) => [
      item.nameLocalization.values[language].value,
      item.descriptionLocalization.values[language].value,
    ]),
  ].filter(Boolean).join(" ")).includes(normalizedQuery);
}

export function matchesMenuReviewFilter(
  item: MenuReviewItem,
  filter: MenuReviewFilter,
  warnings: MenuReviewWarning[],
) {
  if (filter === "hidden") return !item.deleted && Boolean(item.hidden);
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

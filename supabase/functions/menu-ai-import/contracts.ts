export type ConfidenceField<T> = {
  value: T | null;
  confidence: number;
};

export type DetectedMenuLanguage =
  | "en"
  | "om"
  | "am"
  | "mixed"
  | "unknown";

export type LanguageDetection = ConfidenceField<DetectedMenuLanguage>;

export type RawMenuCategory = {
  name: ConfidenceField<string>;
  detectedLanguage: LanguageDetection;
};

export type RawMenuItem = {
  category: ConfidenceField<string>;
  categoryLanguage: LanguageDetection;
  name: ConfidenceField<string>;
  nameLanguage: LanguageDetection;
  description: ConfidenceField<string>;
  descriptionLanguage: LanguageDetection;
  price: ConfidenceField<number>;
  currency: ConfidenceField<string>;
  defaultImageReference?: string | null;
  smartImage?: SmartMenuImagePayload | null;
};

export type SmartMenuImageStatus =
  | "PLACEHOLDER"
  | "GENERATING"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "ARCHIVED";

export type SmartMenuImageVersionPayload = {
  id: string;
  version: number;
  status: SmartMenuImageStatus;
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

export type SmartMenuImagePayload = {
  id: string;
  status: SmartMenuImageStatus;
  currentVersion: number;
  baseStoragePath: string;
  placeholderStoragePath: string;
  providerKey: string | null;
  providerMetadata: Record<string, unknown>;
  restaurantType: string;
  category: { id: string; name: string; slug: string };
  menuItem: { id: string; name: string };
  versions: SmartMenuImageVersionPayload[];
  override: {
    id: string;
    source: "MASTER" | "CUSTOM" | "PLACEHOLDER";
    status: SmartMenuImageStatus;
    imageUrl: string | null;
    thumbnailUrl: string | null;
    version: number;
  } | null;
};

export type RawAiMenuResult = {
  restaurantName: ConfidenceField<string>;
  restaurantNameLanguage: LanguageDetection;
  categories: RawMenuCategory[];
  items: RawMenuItem[];
};

export type NormalizedMenuItem = RawMenuItem & {
  variants: ConfidenceField<Array<{
    name: ConfidenceField<string>;
    price: ConfidenceField<number>;
    currency: ConfidenceField<string>;
  }>>;
  comboMeal: ConfidenceField<boolean>;
  drink: ConfidenceField<boolean>;
  optionalNotes: ConfidenceField<string>;
  optionalNotesLanguage: LanguageDetection;
  sourceText: ConfidenceField<string>;
  id: string;
  duplicate: boolean;
  duplicateOf: string[];
};

function smartImageValue(value: unknown): SmartMenuImagePayload | null {
  if (!value || typeof value !== "object") return null;
  const image = value as SmartMenuImagePayload;
  if (!image.id || !Array.isArray(image.versions)) return null;
  return image;
}

export type NormalizedAiMenuResult = {
  schemaVersion: 1;
  restaurantName: ConfidenceField<string>;
  restaurantNameLanguage: LanguageDetection;
  categories: RawMenuCategory[];
  items: NormalizedMenuItem[];
  unrecognizedSections: Array<{ text: ConfidenceField<string> }>;
};

export type AiMenuSource = {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
};

export type AiMenuProvider = {
  name: string;
  model: string;
  importMenu(source: AiMenuSource): Promise<RawAiMenuResult>;
};

const confidenceField = (valueSchema: Record<string, unknown>) => ({
  type: "object",
  properties: {
    value: { anyOf: [valueSchema, { type: "null" }] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["value", "confidence"],
  additionalProperties: false,
});

const stringField = confidenceField({ type: "string" });
const numberField = confidenceField({ type: "number" });
const languageField = confidenceField({
  type: "string",
  enum: ["en", "om", "am", "mixed", "unknown"],
});

export const AI_MENU_JSON_SCHEMA = {
  type: "object",
  properties: {
    restaurantName: stringField,
    restaurantNameLanguage: languageField,
    categories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: stringField,
          detectedLanguage: languageField,
        },
        required: ["name", "detectedLanguage"],
        additionalProperties: false,
      },
    },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: stringField,
          categoryLanguage: languageField,
          name: stringField,
          nameLanguage: languageField,
          description: stringField,
          descriptionLanguage: languageField,
          price: numberField,
          currency: stringField,
        },
        required: [
          "category",
          "categoryLanguage",
          "name",
          "nameLanguage",
          "description",
          "descriptionLanguage",
          "price",
          "currency",
        ],
        additionalProperties: false,
      },
    },
  },
  required: [
    "restaurantName",
    "restaurantNameLanguage",
    "categories",
    "items",
  ],
  additionalProperties: false,
} as const;

function clampConfidence(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0;
}

function stringValue(value: unknown) {
  if (typeof value !== "string") return null;
  return value.trim() ? value : null;
}

function stringFieldValue(value: unknown): ConfidenceField<string> {
  const field = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return {
    value: stringValue(field.value),
    confidence: clampConfidence(field.confidence),
  };
}

function numberFieldValue(value: unknown): ConfidenceField<number> {
  const field = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return {
    value:
      typeof field.value === "number" && Number.isFinite(field.value) && field.value > 0
        ? field.value
        : null,
    confidence: clampConfidence(field.confidence),
  };
}

const KNOWN_CURRENCIES = new Set([
  "ETB", "USD", "EUR", "GBP", "KES", "UGX", "TZS", "RWF", "ZAR",
  "NGN", "GHS", "AED", "SAR",
]);

function currencyFieldValue(value: unknown): ConfidenceField<string> {
  const field = stringFieldValue(value);
  const currency = field.value?.toUpperCase() ?? null;
  return currency && KNOWN_CURRENCIES.has(currency)
    ? { value: currency, confidence: field.confidence }
    : { value: null, confidence: 0 };
}

function descriptionFieldValue(value: unknown): ConfidenceField<string> {
  const field = stringFieldValue(value);
  if (!field.value) return field;
  const compact = field.value.split(/\r?\n/).slice(0, 2).join("\n").slice(0, 160).trim();
  return { value: compact || null, confidence: compact ? field.confidence : 0 };
}

function languageFieldValue(value: unknown): LanguageDetection {
  const field = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const language = field.value;
  return {
    value:
      language === "en" ||
      language === "om" ||
      language === "am" ||
      language === "mixed" ||
      language === "unknown"
        ? language
        : "unknown",
    confidence: clampConfidence(field.confidence),
  };
}

function duplicateKey(item: NormalizedMenuItem) {
  const name = item.name.value
    ?.normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return name || null;
}

export function normalizeAiMenuResult(
  raw: RawAiMenuResult,
): NormalizedAiMenuResult {
  const record = raw && typeof raw === "object"
    ? raw as unknown as Record<string, unknown>
    : {};
  const rawItems = Array.isArray(record.items) ? record.items : [];
  const items: NormalizedMenuItem[] = rawItems.map((entry, index) => {
    const item = entry && typeof entry === "object"
      ? entry as Record<string, unknown>
      : {};
    return {
      id: `item-${index + 1}`,
      category: stringFieldValue(item.category),
      categoryLanguage: languageFieldValue(item.categoryLanguage),
      name: stringFieldValue(item.name),
      nameLanguage: languageFieldValue(item.nameLanguage),
      description: descriptionFieldValue(item.description),
      descriptionLanguage: languageFieldValue(item.descriptionLanguage),
      price: numberFieldValue(item.price),
      currency: currencyFieldValue(item.currency),
      defaultImageReference: stringValue(item.defaultImageReference),
      smartImage: smartImageValue(item.smartImage),
      variants: { value: [], confidence: 1 },
      comboMeal: { value: null, confidence: 0 },
      drink: { value: null, confidence: 0 },
      optionalNotes: { value: null, confidence: 0 },
      optionalNotesLanguage: { value: "unknown", confidence: 0 },
      sourceText: { value: null, confidence: 0 },
      duplicate: false,
      duplicateOf: [],
    };
  });

  const matches = new Map<string, string[]>();
  for (const item of items) {
    const key = duplicateKey(item);
    if (key) (matches.get(key) ?? matches.set(key, []).get(key))?.push(item.id);
  }
  for (const item of items) {
    const key = duplicateKey(item);
    const ids = key ? matches.get(key) ?? [] : [];
    item.duplicate = ids.length > 1;
    item.duplicateOf = ids.filter((id) => id !== item.id);
  }

  const rawCategories = Array.isArray(record.categories)
    ? record.categories
    : [];
  return {
    schemaVersion: 1,
    restaurantName: stringFieldValue(record.restaurantName),
    restaurantNameLanguage: languageFieldValue(
      record.restaurantNameLanguage,
    ),
    categories: rawCategories.map((entry) => {
      const category = entry && typeof entry === "object"
        ? entry as Record<string, unknown>
        : {};
      return {
        name: stringFieldValue(category.name),
        detectedLanguage: languageFieldValue(category.detectedLanguage),
      };
    }),
    items,
    unrecognizedSections: [],
  };
}

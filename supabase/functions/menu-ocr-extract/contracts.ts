export type ConfidenceField<T> = {
  value: T | null;
  confidence: number;
};

export type RawVariant = {
  name: ConfidenceField<string>;
  price: ConfidenceField<number>;
  currency: ConfidenceField<string>;
};

export type RawMenuItem = {
  category: ConfidenceField<string>;
  name: ConfidenceField<string>;
  description: ConfidenceField<string>;
  price: ConfidenceField<number>;
  currency: ConfidenceField<string>;
  variants: ConfidenceField<RawVariant[]>;
  comboMeal: ConfidenceField<boolean>;
  drink: ConfidenceField<boolean>;
  optionalNotes: ConfidenceField<string>;
  sourceText: ConfidenceField<string>;
};

export type RawExtractionResult = {
  restaurantName: ConfidenceField<string>;
  categories: ConfidenceField<string>[];
  items: RawMenuItem[];
  unrecognizedSections: Array<{ text: ConfidenceField<string> }>;
};

export type NormalizedMenuItem = RawMenuItem & {
  id: string;
  duplicate: boolean;
  duplicateOf: string[];
};

export type NormalizedExtractionResult = {
  schemaVersion: 1;
  restaurantName: ConfidenceField<string>;
  categories: ConfidenceField<string>[];
  items: NormalizedMenuItem[];
  unrecognizedSections: Array<{ text: ConfidenceField<string> }>;
};

export type ExtractionSource = {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
};

export type ExtractionProvider = {
  name: string;
  model: string;
  extract(source: ExtractionSource): Promise<RawExtractionResult>;
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
const booleanField = confidenceField({ type: "boolean" });

const variantSchema = {
  type: "object",
  properties: {
    name: stringField,
    price: numberField,
    currency: stringField,
  },
  required: ["name", "price", "currency"],
  additionalProperties: false,
};

export const MENU_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    restaurantName: stringField,
    categories: {
      type: "array",
      items: stringField,
    },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: stringField,
          name: stringField,
          description: stringField,
          price: numberField,
          currency: stringField,
          variants: confidenceField({
            type: "array",
            items: variantSchema,
          }),
          comboMeal: booleanField,
          drink: booleanField,
          optionalNotes: stringField,
          sourceText: stringField,
        },
        required: [
          "category",
          "name",
          "description",
          "price",
          "currency",
          "variants",
          "comboMeal",
          "drink",
          "optionalNotes",
          "sourceText",
        ],
        additionalProperties: false,
      },
    },
    unrecognizedSections: {
      type: "array",
      items: {
        type: "object",
        properties: { text: stringField },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "restaurantName",
    "categories",
    "items",
    "unrecognizedSections",
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
  const trimmed = value.trim();
  return trimmed || null;
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
      typeof field.value === "number" && Number.isFinite(field.value)
        ? field.value
        : null,
    confidence: clampConfidence(field.confidence),
  };
}

function booleanFieldValue(value: unknown): ConfidenceField<boolean> {
  const field = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return {
    value: typeof field.value === "boolean" ? field.value : null,
    confidence: clampConfidence(field.confidence),
  };
}

function variantFieldValue(value: unknown): ConfidenceField<RawVariant[]> {
  const field = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const variants = Array.isArray(field.value)
    ? field.value.map((entry) => {
        const variant = entry && typeof entry === "object"
          ? entry as Record<string, unknown>
          : {};
        return {
          name: stringFieldValue(variant.name),
          price: numberFieldValue(variant.price),
          currency: stringFieldValue(variant.currency),
        };
      })
    : null;
  return {
    value: variants,
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

export function normalizeExtraction(
  raw: RawExtractionResult,
): NormalizedExtractionResult {
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
      name: stringFieldValue(item.name),
      description: stringFieldValue(item.description),
      price: numberFieldValue(item.price),
      currency: stringFieldValue(item.currency),
      variants: variantFieldValue(item.variants),
      comboMeal: booleanFieldValue(item.comboMeal),
      drink: booleanFieldValue(item.drink),
      optionalNotes: stringFieldValue(item.optionalNotes),
      sourceText: stringFieldValue(item.sourceText),
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
  const rawUnrecognized = Array.isArray(record.unrecognizedSections)
    ? record.unrecognizedSections
    : [];

  return {
    schemaVersion: 1,
    restaurantName: stringFieldValue(record.restaurantName),
    categories: rawCategories.map(stringFieldValue),
    items,
    unrecognizedSections: rawUnrecognized.map((entry) => {
      const section = entry && typeof entry === "object"
        ? entry as Record<string, unknown>
        : {};
      return { text: stringFieldValue(section.text) };
    }),
  };
}

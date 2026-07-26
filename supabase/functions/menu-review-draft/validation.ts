type JsonRecord = Record<string, unknown>;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_CATEGORIES = 500;
const MAX_ITEMS = 5000;
const MAX_UNRECOGNIZED = 5000;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as JsonRecord;
}

function id(value: unknown, label: string) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function text(
  value: unknown,
  label: string,
  maximum: number,
  nullable = false,
) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.length > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function confidence(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new Error("A confidence score is invalid.");
  }
  return value;
}

function order(value: unknown, label: string) {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return Number(value);
}

function stringField(value: unknown, label: string, maximum: number) {
  const field = record(value, label);
  return {
    value: text(field.value, label, maximum, true),
    confidence: confidence(field.confidence),
  };
}

function numberField(value: unknown, label: string) {
  const field = record(value, label);
  if (
    field.value !== null &&
    (
      typeof field.value !== "number" ||
      !Number.isFinite(field.value) ||
      field.value < 0 ||
      field.value > 1_000_000_000
    )
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return {
    value: field.value as number | null,
    confidence: confidence(field.confidence),
  };
}

export function normalizeReviewState(value: unknown) {
  const state = record(value, "Review state");
  if (state.schemaVersion !== 1) {
    throw new Error("Unsupported review state version.");
  }

  if (
    !Array.isArray(state.categories) ||
    state.categories.length > MAX_CATEGORIES
  ) {
    throw new Error("Review categories are invalid.");
  }
  const categoryIds = new Set<string>();
  const categories = state.categories.map((value, index) => {
    const category = record(value, `Category ${index + 1}`);
    const categoryId = id(category.id, "Category ID");
    if (categoryIds.has(categoryId)) {
      throw new Error("Duplicate category IDs are not allowed.");
    }
    categoryIds.add(categoryId);
    return {
      id: categoryId,
      name: text(category.name, "Category name", 160),
      confidence: confidence(category.confidence),
      order: order(category.order, "Category order"),
    };
  });

  if (!Array.isArray(state.items) || state.items.length > MAX_ITEMS) {
    throw new Error("Review items are invalid.");
  }
  const itemIds = new Set<string>();
  const items = state.items.map((value, index) => {
    const item = record(value, `Item ${index + 1}`);
    const itemId = id(item.id, "Item ID");
    if (itemIds.has(itemId)) {
      throw new Error("Duplicate item IDs are not allowed.");
    }
    itemIds.add(itemId);
    const categoryId = item.categoryId === null
      ? null
      : id(item.categoryId, "Item category ID");
    if (categoryId && !categoryIds.has(categoryId)) {
      throw new Error("An item references an unknown review category.");
    }
    return {
      id: itemId,
      sourceItemId: item.sourceItemId === null
        ? null
        : id(item.sourceItemId, "Source item ID"),
      categoryId,
      categoryConfidence: confidence(item.categoryConfidence),
      name: stringField(item.name, "Food name", 240),
      description: stringField(item.description, "Description", 5000),
      price: numberField(item.price, "Price"),
      currency: stringField(item.currency, "Currency", 20),
      notes: stringField(item.notes, "Notes", 3000),
      sourceText: stringField(item.sourceText, "Source text", 5000),
      approved: Boolean(item.approved),
      deleted: Boolean(item.deleted),
      order: order(item.order, "Item order"),
    };
  });

  if (
    !Array.isArray(state.unrecognizedText) ||
    state.unrecognizedText.length > MAX_UNRECOGNIZED
  ) {
    throw new Error("Unrecognized text is invalid.");
  }
  const unrecognizedIds = new Set<string>();
  const allowedStatuses = new Set([
    "active",
    "ignored",
    "deleted",
    "converted",
  ]);
  const unrecognizedText = state.unrecognizedText.map((value, index) => {
    const entry = record(value, `Unrecognized text ${index + 1}`);
    const entryId = id(entry.id, "Unrecognized text ID");
    if (unrecognizedIds.has(entryId)) {
      throw new Error("Duplicate unrecognized text IDs are not allowed.");
    }
    unrecognizedIds.add(entryId);
    if (
      typeof entry.status !== "string" ||
      !allowedStatuses.has(entry.status)
    ) {
      throw new Error("An unrecognized text status is invalid.");
    }
    const convertedItemId = entry.convertedItemId === null
      ? null
      : id(entry.convertedItemId, "Converted item ID");
    if (convertedItemId && !itemIds.has(convertedItemId)) {
      throw new Error("Converted text references an unknown review item.");
    }
    return {
      id: entryId,
      text: text(entry.text, "Unrecognized text", 5000),
      confidence: confidence(entry.confidence),
      status: entry.status,
      convertedItemId,
    };
  });

  return {
    schemaVersion: 1,
    restaurantName: stringField(
      state.restaurantName,
      "Restaurant name",
      240,
    ),
    categories,
    items,
    unrecognizedText,
  };
}


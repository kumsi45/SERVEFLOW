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

function optionalBoolean(value: unknown) {
  return value === true;
}

function localization(value: unknown, label: string) {
  const localized = record(value, `${label} localization`);
  const values = record(localized.values, `${label} localized values`);
  const ownerEdited = record(
    localized.ownerEdited,
    `${label} owner edit markers`,
  );
  const detected = localized.detectedLanguage;
  if (
    detected !== "en" &&
    detected !== "om" &&
    detected !== "am" &&
    detected !== "mixed" &&
    detected !== "unknown"
  ) {
    throw new Error(`${label} detected language is invalid.`);
  }
  return {
    values: {
      en: stringField(values.en, `${label} English`, 5000),
      om: stringField(values.om, `${label} Afaan Oromoo`, 5000),
      am: stringField(values.am, `${label} Amharic`, 5000),
    },
    detectedLanguage: detected,
    languageConfidence: confidence(localized.languageConfidence),
    ownerEdited: {
      en: ownerEdited.en === true,
      om: ownerEdited.om === true,
      am: ownerEdited.am === true,
    },
  };
}

function imageDraft(value: unknown) {
  if (value === undefined || value === null) {
    return {
      status: "Pending",
      selectedVersionId: null,
      versions: [],
      lastPrompt: null,
      generationProgress: 0,
      errorMessage: null,
    };
  }
  const draft = record(value, "Image draft");
  const allowedStatuses = new Set([
    "Pending",
    "Generating",
    "Ready",
    "Approved",
    "Rejected",
    "Owner Upload",
    "GENERATING",
    "PENDING_REVIEW",
    "APPROVED",
    "PLACEHOLDER",
    "ARCHIVED",
  ]);
  if (
    typeof draft.status !== "string" ||
    !allowedStatuses.has(draft.status)
  ) {
    throw new Error("Image draft status is invalid.");
  }
  if (!Array.isArray(draft.versions) || draft.versions.length > 20) {
    throw new Error("Image draft versions are invalid.");
  }
  const versionIds = new Set<string>();
  const versions = draft.versions.map((value, index) => {
    const version = record(value, `Image version ${index + 1}`);
    const versionId = id(version.id, "Image version ID");
    if (versionIds.has(versionId)) {
      throw new Error("Duplicate image version IDs are not allowed.");
    }
    versionIds.add(versionId);
    if (version.source !== "ai" && version.source !== "owner" && version.source !== "master") {
      throw new Error("Image version source is invalid.");
    }
    return {
      id: versionId,
      version: order(version.version, "Image version"),
      status: text(version.status, "Image version status", 40),
      source: version.source,
      imageUrl: text(version.imageUrl, "Image URL", 5000, true),
      thumbnailUrl: text(version.thumbnailUrl, "Image thumbnail URL", 5000, true),
      prompt: text(version.prompt, "Image prompt", 8000),
      createdAt: text(version.createdAt, "Image creation date", 80),
      errorMessage: text(version.errorMessage, "Image error", 1000, true),
      crop: version.crop === null ? null : record(version.crop, "Image crop"),
      storagePath: text(version.storagePath ?? null, "Image storage path", 1000, true),
      mimeType: text(version.mimeType ?? null, "Image MIME type", 100, true),
      width: version.width === null || version.width === undefined ? null : order(version.width, "Image width"),
      height: version.height === null || version.height === undefined ? null : order(version.height, "Image height"),
      byteSize: version.byteSize === null || version.byteSize === undefined ? null : order(version.byteSize, "Image byte size"),
      checksumSha256: text(version.checksumSha256 ?? null, "Image checksum", 128, true),
      providerKey: text(version.providerKey ?? null, "Image provider", 160, true),
      providerAssetId: text(version.providerAssetId ?? null, "Image provider asset", 500, true),
      providerMetadata: version.providerMetadata === undefined
        ? {}
        : record(version.providerMetadata, "Image provider metadata"),
      reviewedAt: text(version.reviewedAt ?? null, "Image review date", 80, true),
    };
  });
  const selectedVersionId = draft.selectedVersionId === null
    ? null
    : id(draft.selectedVersionId, "Selected image version ID");
  if (selectedVersionId && !versionIds.has(selectedVersionId)) {
    throw new Error("Selected image version is invalid.");
  }
  return {
    status: draft.status,
    selectedVersionId,
    versions,
    lastPrompt: text(draft.lastPrompt, "Last image prompt", 8000, true),
    generationProgress: confidence(draft.generationProgress),
    errorMessage: text(draft.errorMessage, "Image draft error", 1000, true),
    defaultImageReference: text(draft.defaultImageReference ?? null, "Default image reference", 500, true),
    masterImageId: draft.masterImageId === null || draft.masterImageId === undefined
      ? null
      : id(draft.masterImageId, "Master image ID"),
    masterImageStatus: text(draft.masterImageStatus ?? null, "Master image status", 40, true),
    masterImageBaseStoragePath: text(draft.masterImageBaseStoragePath ?? null, "Master image base path", 1000, true),
    masterImageMetadata: draft.masterImageMetadata === null || draft.masterImageMetadata === undefined
      ? null
      : record(draft.masterImageMetadata, "Master image metadata"),
  };
}

export function normalizeReviewState(value: unknown) {
  const state = record(value, "Review state");
  if (state.schemaVersion !== 2) {
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
      localization: localization(category.localization, "Category name"),
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
    const trackingType = item.trackingType === undefined
      ? "no_tracking"
      : item.trackingType;
    if (
      trackingType !== "recipe" &&
      trackingType !== "ready_to_sell" &&
      trackingType !== "no_tracking"
    ) {
      throw new Error("Item inventory consumption is invalid.");
    }
    return {
      id: itemId,
      sourceItemId: item.sourceItemId === null
        ? null
        : id(item.sourceItemId, "Source item ID"),
      categoryId,
      categoryConfidence: confidence(item.categoryConfidence),
      name: stringField(item.name, "Food name", 240),
      nameLocalization: localization(item.nameLocalization, "Food name"),
      description: stringField(item.description, "Description", 5000),
      descriptionLocalization: localization(
        item.descriptionLocalization,
        "Description",
      ),
      price: numberField(item.price, "Price"),
      currency: stringField(item.currency, "Currency", 20),
      notes: stringField(item.notes, "Notes", 3000),
      notesLocalization: localization(item.notesLocalization, "Notes"),
      sourceText: stringField(item.sourceText, "Source text", 5000),
      approved: Boolean(item.approved),
      deleted: Boolean(item.deleted),
      hidden: optionalBoolean(item.hidden),
      rejected: optionalBoolean(item.rejected),
      trackingType,
      imageDraft: imageDraft(item.imageDraft),
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
    schemaVersion: 2,
    restaurantName: stringField(
      state.restaurantName,
      "Restaurant name",
      240,
    ),
    restaurantNameLocalization: localization(
      state.restaurantNameLocalization,
      "Restaurant name",
    ),
    categories,
    items,
    unrecognizedText,
  };
}

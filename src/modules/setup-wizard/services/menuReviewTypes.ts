import type {
  DetectedMenuLanguage,
  MenuLanguage,
} from "../../../core/menu/menuLanguage";
import type {
  ConfidenceField,
  MenuExtractionResult,
} from "./menuExtractionTypes";

export type MenuReviewLocalization = {
  values: Record<MenuLanguage, ConfidenceField<string>>;
  detectedLanguage: DetectedMenuLanguage;
  languageConfidence: number;
  ownerEdited: Record<MenuLanguage, boolean>;
};

export type MenuReviewCategory = {
  id: string;
  name: string;
  localization: MenuReviewLocalization;
  confidence: number;
  order: number;
};

export type MenuInventoryTrackingType =
  | "recipe"
  | "ready_to_sell"
  | "no_tracking";

export type MenuReviewItem = {
  id: string;
  sourceItemId: string | null;
  categoryId: string | null;
  categoryConfidence: number;
  name: ConfidenceField<string>;
  nameLocalization: MenuReviewLocalization;
  description: ConfidenceField<string>;
  descriptionLocalization: MenuReviewLocalization;
  price: ConfidenceField<number>;
  currency: ConfidenceField<string>;
  notes: ConfidenceField<string>;
  notesLocalization: MenuReviewLocalization;
  sourceText: ConfidenceField<string>;
  approved: boolean;
  deleted: boolean;
  hidden?: boolean;
  rejected?: boolean;
  trackingType?: MenuInventoryTrackingType;
  imageDraft: MenuReviewImageDraft;
  order: number;
};

export type MenuReviewImageStatus =
  | "Pending"
  | "Generating"
  | "Ready"
  | "Approved"
  | "Rejected"
  | "Owner Upload";

export type MenuReviewImageVersionSource = "ai" | "owner";

export type MenuReviewImageVersion = {
  id: string;
  version: number;
  status: MenuReviewImageStatus;
  source: MenuReviewImageVersionSource;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  prompt: string;
  createdAt: string;
  errorMessage: string | null;
  crop: {
    x: number;
    y: number;
    scale: number;
  } | null;
};

export type MenuReviewImageDraft = {
  status: MenuReviewImageStatus;
  selectedVersionId: string | null;
  versions: MenuReviewImageVersion[];
  lastPrompt: string | null;
  generationProgress: number;
  errorMessage: string | null;
};

export type MenuReviewUnrecognizedStatus =
  | "active"
  | "ignored"
  | "deleted"
  | "converted";

export type MenuReviewUnrecognized = {
  id: string;
  text: string;
  confidence: number;
  status: MenuReviewUnrecognizedStatus;
  convertedItemId: string | null;
};

export type MenuReviewState = {
  schemaVersion: 2;
  restaurantName: ConfidenceField<string>;
  restaurantNameLocalization: MenuReviewLocalization;
  categories: MenuReviewCategory[];
  items: MenuReviewItem[];
  unrecognizedText: MenuReviewUnrecognized[];
};

export type MenuReviewFilter =
  | "all"
  | "needs-review"
  | "low-confidence"
  | "missing-price"
  | "hidden"
  | "duplicates"
  | "deleted";

export type MenuReviewWarning =
  | "Low Confidence"
  | "Missing Price"
  | "Missing Description"
  | "Missing Category"
  | "Duplicate Name"
  | "Suspicious Text"
  | "Unknown Characters";

export type MenuReviewSummary = {
  totalCategories: number;
  totalItems: number;
  approvedItems: number;
  lowConfidenceItems: number;
  missingPrices: number;
  missingCategories: number;
  duplicates: number;
  unrecognizedText: number;
  progress: number;
};

export type MenuReviewAccess = "owner" | "manager";

export type MenuReviewSource = MenuExtractionResult;

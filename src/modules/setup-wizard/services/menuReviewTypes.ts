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
  order: number;
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
  | "duplicates"
  | "deleted";

export type MenuReviewWarning =
  | "Low Confidence"
  | "Missing Price"
  | "Missing Description"
  | "Missing Category"
  | "Duplicate Name"
  | "Suspicious OCR"
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

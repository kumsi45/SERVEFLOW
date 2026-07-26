import type {
  ConfidenceField,
  MenuExtractionResult,
} from "./menuExtractionTypes";

export type MenuReviewCategory = {
  id: string;
  name: string;
  confidence: number;
  order: number;
};

export type MenuReviewItem = {
  id: string;
  sourceItemId: string | null;
  categoryId: string | null;
  categoryConfidence: number;
  name: ConfidenceField<string>;
  description: ConfidenceField<string>;
  price: ConfidenceField<number>;
  currency: ConfidenceField<string>;
  notes: ConfidenceField<string>;
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
  schemaVersion: 1;
  restaurantName: ConfidenceField<string>;
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


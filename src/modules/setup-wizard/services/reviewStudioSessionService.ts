import type { MenuExtractionDraft } from "./menuExtractionTypes";
import type { MenuImportDraft } from "./menuImportDraftService";
import type { MenuReviewAccess, MenuReviewFilter, MenuReviewState } from "./menuReviewTypes";

export type ReviewStudioSession = {
  version: 1;
  updatedAt: string;
  access: MenuReviewAccess;
  sourceDrafts: MenuImportDraft[];
  extractions: MenuExtractionDraft[];
  reviewStates: Record<string, MenuReviewState>;
  revisions: Record<string, number>;
  selectedSourceId: string | null;
  expandedCategoryId: string | null;
  searchInput: string;
  filter: MenuReviewFilter;
  selectedItemIds: string[];
  quickPriceMode: boolean;
  quickPriceCategoryId: string;
  scrollY: number;
  unsynced: boolean;
  pendingPhotoNames: string[];
  addItemWorkspace?: {
    open: boolean;
    categoryId: string;
    foodName: string;
    price: string;
    description: string;
    showNewCategory: boolean;
    categoryName: string;
    categoryOrder: string;
    imageName: string | null;
  };
};

function key(restaurantId: string) {
  return `serveflow:review-studio:v1:${restaurantId}`;
}

export function readReviewStudioSession(restaurantId: string): ReviewStudioSession | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key(restaurantId)) ?? "null") as Partial<ReviewStudioSession> | null;
    if (!parsed || parsed.version !== 1 || !parsed.reviewStates || !Array.isArray(parsed.extractions)) return null;
    return parsed as ReviewStudioSession;
  } catch {
    return null;
  }
}

export function writeReviewStudioSession(restaurantId: string, session: ReviewStudioSession) {
  try {
    window.localStorage.setItem(key(restaurantId), JSON.stringify(session));
  } catch {
    // The remote Review Draft remains canonical when browser storage is unavailable.
  }
}

export function clearReviewStudioSession(restaurantId: string) {
  try { window.localStorage.removeItem(key(restaurantId)); } catch { /* noop */ }
}

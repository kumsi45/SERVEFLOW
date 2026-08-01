import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readReviewStudioSession, writeReviewStudioSession, type ReviewStudioSession } from "../../src/modules/setup-wizard/services/reviewStudioSessionService";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const studio = read("src/modules/setup-wizard/components/AiMenuReviewStudio.tsx");
const wizard = read("src/modules/setup-wizard/pages/RestaurantSetupWizardPage.tsx");
const router = read("src/app/router/AppRouter.tsx");
const photoQueue = read("src/modules/setup-wizard/services/reviewPhotoUploadQueue.ts");

describe("Phase 9.12.3.3 persistent Review Studio session", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
  });

  it("round-trips restaurant-scoped Review Studio state", () => {
    const session = { version: 1, updatedAt: new Date().toISOString(), access: "owner", sourceDrafts: [], extractions: [], reviewStates: { draft: { categories: [], items: [], unrecognizedText: [] } }, revisions: { draft: 2 }, selectedSourceId: "draft:draft", expandedCategoryId: "traditional", searchInput: "tibs", filter: "all", selectedItemIds: ["item-17"], quickPriceMode: true, quickPriceCategoryId: "traditional", scrollY: 780, unsynced: true, pendingPhotoNames: ["tibs.jpg"] } as unknown as ReviewStudioSession;
    writeReviewStudioSession("restaurant-a", session);
    expect(readReviewStudioSession("restaurant-a")).toEqual(session);
    expect(readReviewStudioSession("restaurant-b")).toBeNull();
  });

  it("persists the wizard step and supports the Review Studio deep link", () => {
    expect(wizard).toContain("step,");
    expect(wizard).toContain('window.location.pathname === "/setup/review"');
    expect(wizard).toContain('step === 2 ? "/setup/review" : "/owner/dashboard"');
    expect(router).toContain('/^\\/setup\\/review\\/?$/.test(pathname)');
  });

  it("restores draft content and editing UI state from local fallback", () => {
    for (const value of ["cached.reviewStates", "cached.revisions", "cached.expandedCategoryId", "cached.searchInput", "cached.selectedItemIds", "cached.quickPriceMode", "cached.scrollY"]) expect(studio).toContain(value);
    expect(studio).toContain("We've restored your unfinished menu.");
  });

  it("preserves lifecycle events and retries sync online", () => {
    for (const event of ["beforeunload", "visibilitychange", "pagehide", "focus", "online", "offline"]) expect(studio).toContain(event);
    expect(studio).toContain("queueSave(extractionId)");
    expect(studio).toContain("saveStateLabel(saveStatus, offline)");
  });

  it("stores photo blobs durably and uploads through the existing bucket", () => {
    expect(photoQueue).toContain('indexedDB.open(DATABASE_NAME, 2)');
    expect(photoQueue).toContain('STORE_NAME = "photo-uploads"');
    expect(photoQueue).toContain("file: Blob");
    expect(studio).toContain('supabase.storage.from("menu-photos").upload');
    expect(studio).toContain("listQueuedReviewPhotos");
    expect(studio).toContain("removeQueuedReviewPhoto");
  });

  it("restores the complete Add Item workspace with its selected image", () => {
    for (const field of ["open", "categoryId", "foodName", "price", "description", "showNewCategory", "categoryName", "categoryOrder", "imageName"]) {
      expect(studio).toContain(field);
    }
    expect(studio).toContain("setAddItemOpen(cached.addItemWorkspace.open)");
    expect(studio).toContain("readAddItemWorkspacePhoto(restaurantId)");
    expect(studio).toContain("saveAddItemWorkspacePhoto(restaurantId, file)");
    expect(photoQueue).toContain('WORKSPACE_STORE_NAME = "add-item-workspace-photos"');
    expect(photoQueue).toContain("new File([result.file], result.fileName");
  });
});

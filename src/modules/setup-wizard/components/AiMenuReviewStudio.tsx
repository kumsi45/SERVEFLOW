import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import QRCode from "qrcode";
import { createBrowserUuid } from "../../../core/browser/createBrowserUuid";
import { supabase } from "../../../core/database";
import { createSmartImagePublicUrl } from "../../../core/presentation/smartImageDelivery";
import {
  MENU_LANGUAGE_OPTIONS,
  isMenuLanguage,
  type MenuLanguage,
} from "../../../core/menu/menuLanguage";
import {
  createAiMenuImportDraft,
  createStarterMenuReviewDraft,
  getMenuReviewAccess,
  listMenuExtractionDrafts,
  saveMenuReviewDraft,
} from "../services/menuExtractionService";
import { formatConfidence } from "../services/menuExtractionTypes";
import {
  createMenuReviewState,
  refreshMenuReviewStateImages,
  createMenuReviewLocalization,
  createPendingImageDraft,
  getDuplicateItemIds,
  getMenuReviewWarnings,
  matchesMenuReviewFilter,
  matchesMenuReviewSearch,
  resolveMenuReviewText,
  summarizeMenuReview,
} from "../services/menuReviewState";
import {
  createImageVersion,
  generateMenuItemImageDraft,
} from "../services/menuImageDraftService";
import type {
  MenuReviewAccess,
  MenuReviewFilter,
  MenuReviewItem,
  MenuReviewCategory,
  MenuReviewState,
} from "../services/menuReviewTypes";
import {
  listMenuImportDrafts,
  type MenuImportDraft,
} from "../services/menuImportDraftService";
import type { MenuExtractionDraft } from "../services/menuExtractionTypes";
import type { MenuTheme } from "../../menu/theme-engine/ThemeTypes";
import { VirtualizedReviewItems } from "./VirtualizedReviewItems";
import { AiMenuFinalPreview } from "./AiMenuFinalPreview";
import { OwnerMenuItemCard } from "./OwnerMenuItemCard";
import { createSafeMenuDescription, SERVEFLOW_MENU_PLACEHOLDER_IMAGE } from "../services/ownerMenuItemDefaults";
import { readReviewStudioSession, writeReviewStudioSession } from "../services/reviewStudioSessionService";
import { clearAddItemWorkspacePhoto, listQueuedReviewPhotos, queueReviewPhoto, readAddItemWorkspacePhoto, removeQueuedReviewPhoto, saveAddItemWorkspacePhoto, type QueuedReviewPhoto } from "../services/reviewPhotoUploadQueue";
import { loadMenuPreviewRestaurant, loadMenuPublishHistory, persistMenuPreviewTheme, publishMenuDraft, restoreMenuPublishVersion, type MenuPreviewRestaurant, type MenuPublishHistoryEntry, type MenuPublishSummary } from "../services/menuPublishService";
import { draftFingerprint, draftManager, saveStateLabel, workflowErrorMessage } from "../services/draftManager";

type AiMenuReviewStudioProps = {
  restaurantId: string;
  restaurantName?: string;
  businessType?: string;
  onBusyChange: (busy: boolean) => void;
  onFinishSetup?: () => Promise<void>;
  mode?: "review" | "preview";
  onBack?: () => void;
  onContinue?: () => void;
  smartLibraryOnly?: boolean;
};

type SaveStatus = "saved" | "dirty" | "saving" | "error";

const FILTERS: Array<{ id: MenuReviewFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "needs-review", label: "Needs Review" },
  { id: "low-confidence", label: "Low Confidence" },
  { id: "missing-price", label: "Missing Price" },
  { id: "duplicates", label: "Duplicates" },
  { id: "deleted", label: "Deleted" },
];

function freshItem(categoryId: string | null, order: number): MenuReviewItem {
  const emptyText = { value: null, confidence: 0 };
  return {
    id: createBrowserUuid(),
    sourceItemId: null,
    categoryId,
    categoryConfidence: categoryId ? 1 : 0,
    name: { ...emptyText },
    nameLocalization: createMenuReviewLocalization(emptyText),
    description: { ...emptyText },
    descriptionLocalization: createMenuReviewLocalization(emptyText),
    price: { value: null, confidence: 0 },
    currency: { value: null, confidence: 0 },
    notes: { ...emptyText },
    notesLocalization: createMenuReviewLocalization(emptyText),
    sourceText: { value: null, confidence: 0 },
    approved: false,
    deleted: false,
    hidden: false,
    rejected: false,
    trackingType: "no_tracking",
    imageDraft: createPendingImageDraft(),
    order,
  };
}

export const AiMenuReviewStudio = memo(function AiMenuReviewStudio({
  restaurantId,
  restaurantName = "Your Restaurant",
  businessType,
  onBusyChange,
  onFinishSetup,
  mode = "review",
  onBack,
  onContinue,
  smartLibraryOnly = false,
}: AiMenuReviewStudioProps) {
  const [sourceDrafts, setSourceDrafts] = useState<MenuImportDraft[]>([]);
  const [extractions, setExtractions] = useState<MenuExtractionDraft[]>([]);
  const [access, setAccess] = useState<MenuReviewAccess | null>(null);
  const [reviewStates, setReviewStates] = useState<Record<string, MenuReviewState>>({});
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [busyExtractionId, setBusyExtractionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatuses, setSaveStatuses] = useState<Record<string, SaveStatus>>({});
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<MenuReviewFilter>("all");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [expandedOwnerCategoryId, setExpandedOwnerCategoryId] = useState<string | null>(null);
  const [quickPriceMode, setQuickPriceMode] = useState(false);
  const [quickPriceCategoryId, setQuickPriceCategoryId] = useState("");
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null);
  const [pendingBulkRemoval, setPendingBulkRemoval] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [addItemCategoryId, setAddItemCategoryId] = useState("");
  const [addItemName, setAddItemName] = useState("");
  const [addItemPrice, setAddItemPrice] = useState("");
  const [addItemDescription, setAddItemDescription] = useState("");
  const [addItemImage, setAddItemImage] = useState<File | null>(null);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [inlineCategoryName, setInlineCategoryName] = useState("");
  const [inlineCategoryOrder, setInlineCategoryOrder] = useState("");
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveDestinationId, setMoveDestinationId] = useState("");
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
  const [sessionRecovered, setSessionRecovered] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryLanguage, setNewCategoryLanguage] =
    useState<MenuLanguage>("en");
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [previewRestaurant, setPreviewRestaurant] = useState<MenuPreviewRestaurant | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishStage, setPublishStage] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<MenuPublishSummary | null>(null);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [publishHistory, setPublishHistory] = useState<MenuPublishHistoryEntry[]>([]);
  const [finishingSetup, setFinishingSetup] = useState(false);

  const reviewStatesRef = useRef(reviewStates);
  const revisionsRef = useRef<Record<string, number>>({});
  const versionsRef = useRef<Record<string, number>>({});
  const savePromisesRef = useRef(new Map<string, Promise<void>>());
  const savedFingerprintsRef = useRef<Record<string, string>>({});
  const saveErrorsRef = useRef<Record<string, Error | null>>({});
  const timersRef = useRef(new Map<string, number>());
  const persistRef = useRef<(extractionId: string) => Promise<void>>(async () => undefined);
  const restoredSessionRef = useRef(false);
  const skipSelectionResetRef = useRef(false);
  const sessionSnapshotRef = useRef<() => void>(() => undefined);
  const photoQueueSyncRef = useRef<() => Promise<void>>(async () => undefined);

  const queueSave = useCallback((extractionId: string) => {
    const existing = timersRef.current.get(extractionId);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      timersRef.current.delete(extractionId);
      void persistRef.current(extractionId);
    }, 650);
    timersRef.current.set(extractionId, timer);
  }, []);

  persistRef.current = async (extractionId: string) => {
    const existing = savePromisesRef.current.get(extractionId);
    if (existing) return existing;
    const save = (async () => {
      try {
        while (access === "owner") {
          const state = reviewStatesRef.current[extractionId];
          const revision = revisionsRef.current[extractionId];
          if (!state || revision === undefined) return;
          const fingerprint = draftFingerprint(state);
          if (savedFingerprintsRef.current[extractionId] === fingerprint) {
            setSaveStatuses((current) => ({ ...current, [extractionId]: "saved" }));
            return;
          }
          setSaveStatuses((current) => ({ ...current, [extractionId]: "saving" }));
          saveErrorsRef.current[extractionId] = null;
          const saved = await saveMenuReviewDraft(extractionId, revision, state);
          revisionsRef.current[extractionId] = saved.reviewRevision;
          savedFingerprintsRef.current[extractionId] = fingerprint;
          draftManager.synced(extractionId, state, saved.reviewRevision);
          setExtractions((current) => current.map((entry) => entry.id === saved.id ? saved : entry));
          if (draftFingerprint(reviewStatesRef.current[extractionId]) === fingerprint) {
            setSaveStatuses((current) => ({ ...current, [extractionId]: "saved" }));
            return;
          }
        }
      } catch (saveError) {
        saveErrorsRef.current[extractionId] = saveError instanceof Error ? saveError : new Error("We couldn't sync your changes.");
        setSaveStatuses((current) => ({ ...current, [extractionId]: "error" }));
        if (!navigator.onLine) setOffline(true);
        else setError(workflowErrorMessage(saveError, "We couldn't sync your changes. Your draft is safe on this device."));
      } finally {
        savePromisesRef.current.delete(extractionId);
      }
    })();
    savePromisesRef.current.set(extractionId, save);
    return save;
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const cached = readReviewStudioSession(restaurantId);
    try {
      const [drafts, loadedExtractions, loadedAccess] = await Promise.all([
        listMenuImportDrafts(restaurantId),
        listMenuExtractionDrafts(restaurantId),
        getMenuReviewAccess(restaurantId),
      ]);
      const libraryExtractions = loadedExtractions.filter((entry) => entry.sourceKind === "smart_library");
      const visibleExtractions = smartLibraryOnly ? libraryExtractions : loadedExtractions;
      const visibleSourceDrafts = smartLibraryOnly ? [] : drafts;
      const states: Record<string, MenuReviewState> = {};
      const revisions: Record<string, number> = {};
      const statuses: Record<string, SaveStatus> = {};
      for (const extraction of visibleExtractions) {
        if (extraction.status !== "completed" || !extraction.result) continue;
        states[extraction.id] = extraction.reviewState
          ? refreshMenuReviewStateImages(extraction.reviewState, extraction.result)
          : createMenuReviewState(extraction.result);
        revisions[extraction.id] = extraction.reviewRevision;
        statuses[extraction.id] = "saved";
      }
      const recoverCachedEdits = Boolean(cached?.unsynced && Object.keys(cached.reviewStates).length);
      const restoredStates = recoverCachedEdits
        ? Object.fromEntries(Object.entries(cached!.reviewStates).map(([id, state]) => {
          const result = visibleExtractions.find((entry) => entry.id === id)?.result;
          return [id, result ? refreshMenuReviewStateImages(state, result) : state];
        }))
        : states;
      const restoredRevisions = recoverCachedEdits ? cached!.revisions : revisions;
      reviewStatesRef.current = restoredStates;
      revisionsRef.current = restoredRevisions;
      versionsRef.current = Object.fromEntries(
        Object.keys(restoredStates).map((id) => [id, 0]),
      );
      savedFingerprintsRef.current = Object.fromEntries(Object.entries(states).map(([id, value]) => [id, draftFingerprint(value)]));
      for (const extraction of visibleExtractions) {
        const draftState = restoredStates[extraction.id];
        if (draftState) draftManager.hydrate(extraction.id, draftState, restoredRevisions[extraction.id] ?? extraction.reviewRevision, recoverCachedEdits ? "Editing" : "Synced");
      }
      setSourceDrafts(visibleSourceDrafts);
      setExtractions(visibleExtractions);
      setAccess(loadedAccess);
      setReviewStates(restoredStates);
      setSaveStatuses(recoverCachedEdits
        ? Object.fromEntries(Object.keys(restoredStates).map((id) => [id, "dirty" as SaveStatus]))
        : statuses);
      const standalone = visibleExtractions.filter((entry) => !entry.sourceDraftId);
      const restoredSourceId = cached?.selectedSourceId ?? null;
      if (cached && !restoredSessionRef.current) {
        restoredSessionRef.current = true;
        skipSelectionResetRef.current = true;
        setExpandedOwnerCategoryId(cached.expandedCategoryId);
        setSearchInput(cached.searchInput);
        setSearch(cached.searchInput);
        setFilter(cached.filter);
        setSelectedItems(new Set(cached.selectedItemIds));
        setQuickPriceMode(cached.quickPriceMode);
        setQuickPriceCategoryId(cached.quickPriceCategoryId);
        if (cached.addItemWorkspace) {
          setAddItemOpen(cached.addItemWorkspace.open);
          setAddItemCategoryId(cached.addItemWorkspace.categoryId);
          setAddItemName(cached.addItemWorkspace.foodName);
          setAddItemPrice(cached.addItemWorkspace.price);
          setAddItemDescription(cached.addItemWorkspace.description);
          setShowNewCategory(cached.addItemWorkspace.showNewCategory);
          setInlineCategoryName(cached.addItemWorkspace.categoryName);
          setInlineCategoryOrder(cached.addItemWorkspace.categoryOrder);
          if (cached.addItemWorkspace.imageName) void readAddItemWorkspacePhoto(restaurantId).then((file) => { if (file) setAddItemImage(file); });
        }
        setSessionRecovered(true);
        window.setTimeout(() => window.scrollTo({ top: cached.scrollY, behavior: "auto" }), 80);
      }
      setSelectedSourceId((current) =>
        restoredSourceId && (
          visibleSourceDrafts.some((draft) => draft.id === restoredSourceId)
          || standalone.some((entry) => `draft:${entry.id}` === restoredSourceId)
        ) ? restoredSourceId :
        current && (
          visibleSourceDrafts.some((draft) => draft.id === current)
          || standalone.some((entry) => `draft:${entry.id}` === current)
        )
          ? current
          : visibleSourceDrafts[0]?.id ?? (standalone[0] ? `draft:${standalone[0].id}` : null)
      );
      if (recoverCachedEdits) window.setTimeout(() => {
        for (const extractionId of Object.keys(restoredStates)) queueSave(extractionId);
      }, 0);
    } catch (loadError) {
      if (cached) {
        reviewStatesRef.current = cached.reviewStates;
        revisionsRef.current = cached.revisions;
        versionsRef.current = Object.fromEntries(Object.keys(cached.reviewStates).map((id) => [id, 0]));
        setSourceDrafts(cached.sourceDrafts);
        setExtractions(cached.extractions);
        setAccess(cached.access);
        setReviewStates(cached.reviewStates);
        setSaveStatuses(Object.fromEntries(Object.keys(cached.reviewStates).map((id) => [id, "dirty" as SaveStatus])));
        skipSelectionResetRef.current = true;
        setSelectedSourceId(cached.selectedSourceId);
        setExpandedOwnerCategoryId(cached.expandedCategoryId);
        setSearchInput(cached.searchInput);
        setSearch(cached.searchInput);
        setFilter(cached.filter);
        setSelectedItems(new Set(cached.selectedItemIds));
        setQuickPriceMode(cached.quickPriceMode);
        setQuickPriceCategoryId(cached.quickPriceCategoryId);
        if (cached.addItemWorkspace) {
          setAddItemOpen(cached.addItemWorkspace.open);
          setAddItemCategoryId(cached.addItemWorkspace.categoryId);
          setAddItemName(cached.addItemWorkspace.foodName);
          setAddItemPrice(cached.addItemWorkspace.price);
          setAddItemDescription(cached.addItemWorkspace.description);
          setShowNewCategory(cached.addItemWorkspace.showNewCategory);
          setInlineCategoryName(cached.addItemWorkspace.categoryName);
          setInlineCategoryOrder(cached.addItemWorkspace.categoryOrder);
          if (cached.addItemWorkspace.imageName) void readAddItemWorkspacePhoto(restaurantId).then((file) => { if (file) setAddItemImage(file); });
        }
        setOffline(true);
        setSessionRecovered(true);
        window.setTimeout(() => window.scrollTo({ top: cached.scrollY, behavior: "auto" }), 80);
      } else {
        setError(loadError instanceof Error ? loadError.message : "The menu editor could not be loaded.");
      }
    } finally {
      setLoading(false);
    }
  }, [queueSave, restaurantId, smartLibraryOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const busy = busyExtractionId !== null || Object.values(saveStatuses)
      .some((status) => status === "dirty" || status === "saving");
    onBusyChange(busy);
  }, [busyExtractionId, onBusyChange, saveStatuses]);

  useEffect(
    () => () => {
      for (const timer of timersRef.current.values()) {
        window.clearTimeout(timer);
      }
      onBusyChange(false);
    },
    [onBusyChange],
  );

  useEffect(() => {
    if (skipSelectionResetRef.current) { skipSelectionResetRef.current = false; return; }
    setSelectedItems(new Set()); setSearchInput(""); setSearch(""); setFilter("all");
  }, [selectedSourceId]);

  const extractionBySource = useMemo(
    () => new Map(extractions.filter((entry) => entry.sourceDraftId).map((extraction) => [
      extraction.sourceDraftId,
      extraction,
    ])),
    [extractions],
  );
  const selectedSource = sourceDrafts.find(
    (draft) => draft.id === selectedSourceId,
  ) ?? null;
  const selectedStandaloneExtraction = selectedSourceId?.startsWith("draft:")
    ? extractions.find((entry) => entry.id === selectedSourceId.slice(6)) ?? null
    : null;
  const selectedExtraction = selectedSource
    ? extractionBySource.get(selectedSource.id) ?? null
    : selectedStandaloneExtraction;
  const staleExtraction = Boolean(
    selectedSource &&
    selectedExtraction &&
    selectedExtraction.sourceUpdatedAt !== selectedSource.updatedAt
  );
  const activeExtraction = staleExtraction ? null : selectedExtraction;
  const state = activeExtraction
    ? reviewStates[activeExtraction.id] ?? null
    : null;
  const canEdit = access === "owner";
  const saveStatus = activeExtraction
    ? saveStatuses[activeExtraction.id] ?? "saved"
    : "saved";

  const changeState = useCallback((
    extractionId: string,
    update: (current: MenuReviewState) => MenuReviewState,
  ) => {
    if (access !== "owner") return;
    const current = reviewStatesRef.current[extractionId];
    if (!current) return;
    const next = update(current);
    if (draftFingerprint(next) === draftFingerprint(current)) return;
    reviewStatesRef.current = {
      ...reviewStatesRef.current,
      [extractionId]: next,
    };
    versionsRef.current[extractionId] =
      (versionsRef.current[extractionId] ?? 0) + 1;
    draftManager.edit(extractionId, next);
    setReviewStates(reviewStatesRef.current);
    setSaveStatuses((statuses) => ({
      ...statuses,
      [extractionId]: "dirty",
    }));
    queueSave(extractionId);
  }, [access, queueSave]);

  const changeActive = useCallback((
    update: (current: MenuReviewState) => MenuReviewState,
  ) => {
    if (activeExtraction) changeState(activeExtraction.id, update);
  }, [activeExtraction, changeState]);

  async function runExtraction(draft: MenuImportDraft) {
    if (!canEdit) return;
    setBusyExtractionId(draft.id);
    setError(null);
    try {
      const extraction = await createAiMenuImportDraft(draft.id);
      setExtractions((current) => [
        ...current.filter((entry) => entry.sourceDraftId !== draft.id),
        extraction,
      ]);
      if (extraction.status === "completed" && extraction.result) {
        const nextState = createMenuReviewState(extraction.result);
        reviewStatesRef.current = {
          ...reviewStatesRef.current,
          [extraction.id]: nextState,
        };
        revisionsRef.current[extraction.id] = extraction.reviewRevision;
        versionsRef.current[extraction.id] = 0;
        setReviewStates(reviewStatesRef.current);
        setSaveStatuses((current) => ({
          ...current,
          [extraction.id]: "saved",
        }));
      }
      if (extraction.status === "failed") {
        setError("We couldn't create your digital menu.");
      }
    } catch {
      setError("We couldn't create your digital menu.");
    } finally {
      setBusyExtractionId(null);
    }
  }

  async function createStarterFallback() {
    if (!canEdit) return;
    try {
      setBusyExtractionId("starter-menu");
      setError(null);
      await createStarterMenuReviewDraft(restaurantId, "Restaurant");
      await load();
    } catch {
      setError("We couldn't create your digital menu.");
    } finally {
      setBusyExtractionId(null);
    }
  }

  const categoryNameById = useMemo(
    () => new Map(state?.categories.map((category) => [
      category.id,
      [
        category.name,
        ...MENU_LANGUAGE_OPTIONS.map(
          (option) => category.localization.values[option.code].value,
        ),
      ].filter(Boolean).join(" "),
    ]) ?? []),
    [state?.categories],
  );
  const duplicateIds = useMemo(
    () => getDuplicateItemIds(state?.items ?? []),
    [state?.items],
  );
  const warningsById = useMemo(
    () => new Map((state?.items ?? []).map((item) => [
      item.id,
      getMenuReviewWarnings(item, duplicateIds),
    ])),
    [duplicateIds, state?.items],
  );
  const summary = useMemo(
    () => state ? summarizeMenuReview(state) : null,
    [state],
  );

  const visibleItems = useMemo(() => {
    if (!state) return [];
    return state.items
      .filter((item) => {
        const warnings = warningsById.get(item.id) ?? [];
        const categoryName = item.categoryId
          ? categoryNameById.get(item.categoryId) ?? ""
          : "Missing Category";
        return matchesMenuReviewFilter(item, filter, warnings)
          && matchesMenuReviewSearch(item, categoryName, search);
      })
      .sort((first, second) => first.order - second.order);
  }, [categoryNameById, filter, search, state, warningsById]);
  const ownerVisibleItems = useMemo(() => {
    if (!state) return [];
    const query = searchInput.trim().toLocaleLowerCase();
    return state.items.filter((item) => {
      if (item.deleted) return false;
      if (filter === "missing-price" && item.price.value !== null) return false;
      if (filter === "hidden" && !item.hidden) return false;
      if (filter === "all" && item.hidden) return false;
      if (!query) return true;
      const name = resolveMenuReviewText(item.name, item.nameLocalization).toLocaleLowerCase();
      const category = item.categoryId ? categoryNameById.get(item.categoryId)?.toLocaleLowerCase() ?? "" : "";
      return name.includes(query) || category.includes(query);
    });
  }, [categoryNameById, filter, searchInput, state]);

  sessionSnapshotRef.current = () => {
    if (!Object.keys(reviewStatesRef.current).length) return;
    writeReviewStudioSession(restaurantId, {
      version: 1,
      updatedAt: new Date().toISOString(),
      access: access ?? "owner",
      sourceDrafts,
      extractions,
      reviewStates: reviewStatesRef.current,
      revisions: revisionsRef.current,
      selectedSourceId,
      expandedCategoryId: expandedOwnerCategoryId,
      searchInput,
      filter,
      selectedItemIds: [...selectedItems],
      quickPriceMode,
      quickPriceCategoryId,
      scrollY: window.scrollY,
      unsynced: offline || Object.values(saveStatuses).some((status) => status !== "saved"),
      pendingPhotoNames: addItemImage ? [addItemImage.name] : [],
      addItemWorkspace: {
        open: addItemOpen,
        categoryId: addItemCategoryId,
        foodName: addItemName,
        price: addItemPrice,
        description: addItemDescription,
        showNewCategory,
        categoryName: inlineCategoryName,
        categoryOrder: inlineCategoryOrder,
        imageName: addItemImage?.name ?? null,
      },
    });
  };

  useEffect(() => {
    if (loading) return;
    const timer = window.setTimeout(() => sessionSnapshotRef.current(), 100);
    return () => window.clearTimeout(timer);
  }, [addItemCategoryId, addItemDescription, addItemImage, addItemName, addItemOpen, addItemPrice, expandedOwnerCategoryId, extractions, filter, inlineCategoryName, inlineCategoryOrder, loading, offline, quickPriceCategoryId, quickPriceMode, restaurantId, reviewStates, saveStatuses, searchInput, selectedItems, selectedSourceId, showNewCategory, sourceDrafts]);

  useEffect(() => {
    let scrollTimer = 0;
    const preserve = () => sessionSnapshotRef.current();
    const preserveScroll = () => {
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(preserve, 120);
    };
    const reconnect = () => {
      setOffline(false);
      for (const [extractionId, status] of Object.entries(saveStatuses)) {
        if (status !== "saved") queueSave(extractionId);
      }
      void photoQueueSyncRef.current();
    };
    const disconnect = () => { setOffline(true); preserve(); };
    const visible = () => { if (document.visibilityState === "hidden") preserve(); else if (navigator.onLine) reconnect(); };
    window.addEventListener("beforeunload", preserve);
    window.addEventListener("pagehide", preserve);
    window.addEventListener("focus", reconnect);
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", disconnect);
    window.addEventListener("scroll", preserveScroll, { passive: true });
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearTimeout(scrollTimer);
      window.removeEventListener("beforeunload", preserve);
      window.removeEventListener("pagehide", preserve);
      window.removeEventListener("focus", reconnect);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("offline", disconnect);
      window.removeEventListener("scroll", preserveScroll);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [queueSave, saveStatuses]);

  useEffect(() => {
    if (!sessionRecovered) return;
    const timer = window.setTimeout(() => setSessionRecovered(false), 3000);
    return () => window.clearTimeout(timer);
  }, [sessionRecovered]);

  useEffect(() => {
    if (!loading && !offline) void photoQueueSyncRef.current();
  }, [loading, offline, restaurantId]);

  function updateItem(
    itemId: string,
    update: (item: MenuReviewItem) => MenuReviewItem,
  ) {
    changeActive((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === itemId ? update(item) : item
      ),
    }));
  }

  function updateText(
    itemId: string,
    field: "name" | "description" | "currency" | "notes",
    value: string,
    language?: MenuLanguage,
  ) {
    if (field !== "currency" && language) {
      const localizationKey = `${field}Localization` as
        | "nameLocalization"
        | "descriptionLocalization"
        | "notesLocalization";
      updateItem(itemId, (item) => ({
        ...item,
        [localizationKey]: {
          ...item[localizationKey],
          values: {
            ...item[localizationKey].values,
            [language]: { value: value || null, confidence: value ? 1 : 0 },
          },
          ownerEdited: {
            ...item[localizationKey].ownerEdited,
            [language]: true,
          },
        },
        approved: false,
      }));
      return;
    }
    updateItem(itemId, (item) => ({
      ...item,
      [field]: { value: value || null, confidence: 1 },
      approved: false,
    }));
  }

  function updatePrice(itemId: string, value: string) {
    const parsed = value === "" ? null : Number(value);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) return;
    updateItem(itemId, (item) => ({
      ...item,
      price: { value: parsed, confidence: 1 },
      currency: { value: parsed === null ? null : "ETB", confidence: 1 },
      approved: false,
    }));
  }

  function updateCategory(itemId: string, categoryId: string | null) {
    updateItem(itemId, (item) => ({
      ...item,
      categoryId,
      categoryConfidence: categoryId ? 1 : 0,
      approved: false,
    }));
  }

  function createItem(categoryId: string | null) {
    changeActive((current) => ({
      ...current,
      items: [
        ...current.items,
        freshItem(
          categoryId,
          Math.max(-1, ...current.items.map((item) => item.order)) + 1,
        ),
      ],
    }));
  }

  function closeAddItemDialog() {
    setAddItemOpen(false);
    setAddItemName("");
    setAddItemPrice("");
    setAddItemDescription("");
    setAddItemImage(null);
    setShowNewCategory(false);
    setInlineCategoryName("");
    setInlineCategoryOrder("");
    void clearAddItemWorkspacePhoto(restaurantId);
  }

  function changeAddItemImage(file: File | null) {
    setAddItemImage(file);
    if (file) void saveAddItemWorkspacePhoto(restaurantId, file).catch(() => setError("The selected image could not be preserved on this device."));
    else void clearAddItemWorkspacePhoto(restaurantId);
  }

  function openAddItemDialog() {
    setAddItemCategoryId(expandedOwnerCategoryId ?? state?.categories[0]?.id ?? "");
    setAddItemOpen(true);
  }

  function createOwnerCategory() {
    const name = inlineCategoryName.trim();
    if (!name) return;
    const id = createBrowserUuid();
    const localization = createMenuReviewLocalization({ value: name, confidence: 1 });
    const requestedOrder = inlineCategoryOrder === "" ? null : Number(inlineCategoryOrder);
    changeActive((current) => {
      const categories = [...current.categories, {
        id,
        name,
        confidence: 1,
        localization,
        order: Number.isFinite(requestedOrder) && requestedOrder !== null
          ? Math.max(0, requestedOrder - 1)
          : current.categories.length,
      }].sort((first, second) => first.order - second.order)
        .map((category, order) => ({ ...category, order }));
      return { ...current, categories };
    });
    setAddItemCategoryId(id);
    setInlineCategoryName("");
    setInlineCategoryOrder("");
    setShowNewCategory(false);
  }

  function createOwnerItem() {
    const name = addItemName.trim();
    if (!name || !addItemCategoryId) return;
    const id = createBrowserUuid();
    const description = (addItemDescription.trim() || createSafeMenuDescription(name)).slice(0, 160);
    const price = addItemPrice === "" ? null : Number(addItemPrice);
    if (price !== null && (!Number.isFinite(price) || price < 0)) return;
    const placeholder = createImageVersion(1, "owner", SERVEFLOW_MENU_PLACEHOLDER_IMAGE, SERVEFLOW_MENU_PLACEHOLDER_IMAGE, "ServeFlow placeholder image.");
    changeActive((current) => {
      const item = freshItem(addItemCategoryId, Math.max(-1, ...current.items.map((entry) => entry.order)) + 1);
      item.id = id;
      item.name = { value: name, confidence: 1 };
      item.nameLocalization = createMenuReviewLocalization(item.name);
      item.description = { value: description, confidence: 1 };
      item.descriptionLocalization = createMenuReviewLocalization(item.description);
      item.price = { value: price, confidence: 1 };
      item.currency = { value: price === null ? null : "ETB", confidence: 1 };
      item.imageDraft = { ...item.imageDraft, status: "Owner Upload", selectedVersionId: placeholder.id, versions: [placeholder], generationProgress: 1 };
      return { ...current, items: [...current.items, item] };
    });
    if (addItemImage) window.setTimeout(() => uploadOwnImage(id, addItemImage), 0);
    setExpandedOwnerCategoryId(addItemCategoryId);
    setSearchInput("");
    setSearch("");
    setFilter("all");
    setHighlightedItemId(id);
    closeAddItemDialog();
    window.setTimeout(() => document.getElementById(`owner-item-${id}`)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }), 50);
    window.setTimeout(() => setHighlightedItemId((current) => current === id ? null : current), 2200);
  }

  function moveSelectedItems() {
    if (!moveDestinationId || selectedItems.size === 0) return;
    changeActive((current) => ({ ...current, items: current.items.map((item) => selectedItems.has(item.id) ? { ...item, categoryId: moveDestinationId, categoryConfidence: 1, approved: false } : item) }));
    setExpandedOwnerCategoryId(moveDestinationId);
    setSelectedItems(new Set());
    setMoveDialogOpen(false);
    setMoveDestinationId("");
  }

  function trapDialogFocus(event: ReactKeyboardEvent<HTMLElement>, close: () => void) {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function duplicateItem(itemId: string) {
    changeActive((current) => {
      const source = current.items.find((item) => item.id === itemId);
      if (!source) return current;
      return {
        ...current,
        items: [
          ...current.items,
          {
            ...structuredClone(source),
            id: createBrowserUuid(),
            sourceItemId: null,
            approved: false,
            deleted: false,
            imageDraft: createPendingImageDraft(),
            order: Math.max(-1, ...current.items.map((item) => item.order)) + 1,
          },
        ],
      };
    });
  }

  function createCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    const localization = createMenuReviewLocalization(
      { value: name, confidence: 1 },
      { value: newCategoryLanguage, confidence: 1 },
    );
    localization.ownerEdited[newCategoryLanguage] = true;
    changeActive((current) => ({
      ...current,
      categories: [
        ...current.categories,
        {
          id: createBrowserUuid(),
          name,
          confidence: 1,
          localization,
          order: Math.max(-1, ...current.categories.map((entry) => entry.order)) + 1,
        },
      ],
    }));
    setNewCategoryName("");
  }

  function mergeCategory(sourceId: string, targetId: string) {
    if (!targetId || sourceId === targetId) return;
    changeActive((current) => ({
      ...current,
      categories: current.categories
        .filter((category) => category.id !== sourceId)
        .sort((first, second) => first.order - second.order)
        .map((category, index) => ({ ...category, order: index })),
      items: current.items.map((item) =>
        item.categoryId === sourceId
          ? {
              ...item,
              categoryId: targetId,
              categoryConfidence: 1,
              approved: false,
            }
          : item
      ),
    }));
  }

  function deleteEmptyCategory(categoryId: string) {
    if (state?.items.some((item) => item.categoryId === categoryId)) return;
    changeActive((current) => ({
      ...current,
      categories: current.categories
        .filter((category) => category.id !== categoryId)
        .sort((first, second) => first.order - second.order)
        .map((category, index) => ({ ...category, order: index })),
    }));
  }

  function moveCategory(categoryId: string, direction: -1 | 1) {
    changeActive((current) => {
      const ordered = [...current.categories].sort(
        (first, second) => first.order - second.order,
      );
      const index = ordered.findIndex((category) => category.id === categoryId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ordered.length) return current;
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      return {
        ...current,
        categories: ordered.map((category, order) => ({ ...category, order })),
      };
    });
  }

  function applyBulk(action: "delete" | "restore" | "approve" | "move") {
    if (selectedItems.size === 0) return;
    changeActive((current) => ({
      ...current,
      items: current.items.map((item) => {
        if (!selectedItems.has(item.id)) return item;
        if (action === "delete") return { ...item, deleted: true, approved: false };
        if (action === "restore") return { ...item, deleted: false };
        if (action === "approve") return { ...item, approved: true };
        return {
          ...item,
          categoryId: bulkCategoryId || null,
          categoryConfidence: bulkCategoryId ? 1 : 0,
          approved: false,
        };
      }),
    }));
    setSelectedItems(new Set());
  }

  async function generateImageDraft(itemId: string) {
    if (!activeExtraction || !state || !canEdit) return;
    const target = state.items.find((item) => item.id === itemId);
    if (!target || !target.approved || target.deleted || target.hidden || target.rejected) return;
    if (target.imageDraft.status === "Generating" || target.imageDraft.status === "GENERATING") return;
    const promptVersion = Math.max(
      0,
      ...target.imageDraft.versions.map((entry) => entry.version),
    ) + 1;
    changeState(activeExtraction.id, (current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              imageDraft: {
                ...item.imageDraft,
                status: "Generating",
                generationProgress: 0.35,
                errorMessage: null,
              },
            }
          : item
      ),
    }));
    await persistRef.current(activeExtraction.id);
    try {
      const generated = await generateMenuItemImageDraft(
        target,
        state.categories,
        activeExtraction.id,
        revisionsRef.current[activeExtraction.id] ?? activeExtraction.reviewRevision,
      );
      if (generated.reviewRevision !== null) {
        revisionsRef.current[activeExtraction.id] = generated.reviewRevision;
        setExtractions((current) => current.map((entry) =>
          entry.id === activeExtraction.id
            ? { ...entry, reviewRevision: generated.reviewRevision ?? entry.reviewRevision }
            : entry
        ));
      }
      const version = generated.version;
      changeState(activeExtraction.id, (current) => ({
        ...current,
        items: current.items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                imageDraft: {
                  ...item.imageDraft,
                  status: version.imageUrl
                    ? "Ready"
                    : item.imageDraft.versions.length
                      ? "Ready"
                      : "Pending",
                  selectedVersionId: version.imageUrl
                    ? version.id
                    : item.imageDraft.selectedVersionId,
                  versions: [...item.imageDraft.versions, version],
                  lastPrompt: version.prompt,
                  generationProgress: generated.generationProgress,
                  errorMessage: version.errorMessage,
                },
              }
            : item
        ),
      }));
    } catch (imageError) {
      changeState(activeExtraction.id, (current) => ({
        ...current,
        items: current.items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                imageDraft: {
                  ...item.imageDraft,
                  status: "Pending",
                  generationProgress: 0,
                  errorMessage: imageError instanceof Error
                    ? imageError.message
                    : "Image generation failed.",
                  lastPrompt: item.imageDraft.lastPrompt,
                  selectedVersionId: item.imageDraft.selectedVersionId,
                  versions: [
                    ...item.imageDraft.versions,
                    {
                      id: createBrowserUuid(),
                      version: promptVersion,
                      status: "Rejected",
                      source: "ai",
                      imageUrl: null,
                      thumbnailUrl: null,
                      prompt: item.imageDraft.lastPrompt ?? "",
                      createdAt: new Date().toISOString(),
                      errorMessage: "Image generation failed.",
                      crop: null,
                    },
                  ],
                },
              }
            : item
        ),
      }));
    }
  }

  async function generateMissingImages() {
    if (!state || !canEdit) return;
    const itemIds = state.items
      .filter((item) => item.approved && !item.deleted && !item.hidden && !item.rejected)
      .filter((item) => !item.imageDraft.selectedVersionId && item.imageDraft.status !== "Generating" && item.imageDraft.status !== "GENERATING")
      .map((item) => item.id);
    for (const itemId of itemIds) {
      await generateImageDraft(itemId);
    }
  }

  function changeImageDraft(
    itemId: string,
    update: (item: MenuReviewItem) => MenuReviewItem,
  ) {
    updateItem(itemId, update);
  }

  async function uploadQueuedPhoto(entry: QueuedReviewPhoto) {
    if (!navigator.onLine || !reviewStatesRef.current[entry.extractionId]) return;
    const extension = entry.fileName.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLocaleLowerCase() || "jpg";
    const path = `${restaurantId}/review-drafts/${entry.extractionId}/${entry.itemId}/${entry.id}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("menu-photos").upload(path, entry.file, {
      cacheControl: "31536000", upsert: false, contentType: entry.contentType,
    });
    if (uploadError && !uploadError.message.toLocaleLowerCase().includes("already exists")) throw new Error(uploadError.message);
    const publicUrl = createSmartImagePublicUrl("menu-photos", path);
    changeState(entry.extractionId, (current) => ({
      ...current,
      items: current.items.map((item) => {
        if (item.id !== entry.itemId) return item;
        const version = createImageVersion(Math.max(0, ...item.imageDraft.versions.map((candidate) => candidate.version)) + 1, "owner", publicUrl, publicUrl, "Owner uploaded image.");
        return { ...item, imageDraft: { ...item.imageDraft, status: "Owner Upload", selectedVersionId: version.id, versions: [...item.imageDraft.versions.filter((candidate) => !candidate.imageUrl?.startsWith("blob:")), version], generationProgress: 1, errorMessage: null } };
      }),
    }));
    await removeQueuedReviewPhoto(entry.id);
  }

  async function syncQueuedPhotos() {
    if (!navigator.onLine || access !== "owner") return;
    try {
      const entries = await listQueuedReviewPhotos(restaurantId);
      for (const entry of entries) await uploadQueuedPhoto(entry);
    } catch {
      // The durable IndexedDB queue is retried on focus, visibility, and online events.
    }
  }

  photoQueueSyncRef.current = syncQueuedPhotos;

  function uploadOwnImage(itemId: string, file: File | null) {
    if (!file || !file.type.startsWith("image/")) return;
    const objectUrl = URL.createObjectURL(file);
    updateItem(itemId, (item) => {
      const version = createImageVersion(
        Math.max(0, ...item.imageDraft.versions.map((entry) => entry.version)) + 1,
        "owner",
        objectUrl,
        objectUrl,
        "Owner uploaded image.",
      );
      return {
        ...item,
        imageDraft: {
          ...item.imageDraft,
          status: "Owner Upload",
          selectedVersionId: version.id,
          versions: [...item.imageDraft.versions, version],
          generationProgress: 1,
          errorMessage: null,
        },
      };
    });
    if (activeExtraction) {
      void queueReviewPhoto(restaurantId, activeExtraction.id, itemId, file)
        .then((entry) => navigator.onLine ? uploadQueuedPhoto(entry) : undefined)
        .catch(() => setError("The photo is displayed locally but could not be queued for upload."));
    }
  }

  function convertUnrecognized(entryId: string) {
    changeActive((current) => {
      const entry = current.unrecognizedText.find((item) => item.id === entryId);
      if (!entry || !entry.text.trim()) return current;
      const item = freshItem(
        null,
        Math.max(-1, ...current.items.map((candidate) => candidate.order)) + 1,
      );
      item.name = { value: entry.text, confidence: entry.confidence };
      item.nameLocalization = createMenuReviewLocalization(item.name);
      item.sourceText = { value: entry.text, confidence: entry.confidence };
      return {
        ...current,
        items: [...current.items, item],
        unrecognizedText: current.unrecognizedText.map((candidate) =>
          candidate.id === entryId
            ? {
                ...candidate,
                status: "converted",
                convertedItemId: item.id,
              }
            : candidate
        ),
      };
    });
  }

  async function openPreview() {
    if (!activeExtraction || !state || !canEdit) return;
    if (saveStatus === "dirty" || saveStatus === "saving") await persistRef.current(activeExtraction.id);
    if (savePromisesRef.current.has(activeExtraction.id)) await savePromisesRef.current.get(activeExtraction.id);
    if (saveErrorsRef.current[activeExtraction.id]) return;
    try {
      setError(null);
      const restaurant = await loadMenuPreviewRestaurant(restaurantId);
      setPreviewRestaurant({
        ...restaurant,
        name: restaurantName,
        profile: { ...restaurant.profile, restaurant_type: businessType?.trim() || restaurant.profile.restaurant_type },
      });
      setPublishHistory(await loadMenuPublishHistory(restaurantId, activeExtraction.id));
      setPreviewOpen(true);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "The final menu preview could not be opened.");
    }
  }

  async function prepareOwnerMenu(next: () => void | Promise<void>) {
    if (!activeExtraction || !state || !canEdit) return;
    changeActive((current) => ({
      ...current,
      items: current.items.map((item) => item.deleted ? item : { ...item, approved: true }),
    }));
    await persistRef.current(activeExtraction.id);
    if (saveErrorsRef.current[activeExtraction.id]) return;
    await next();
  }

  function confirmItemRemoval() {
    if (!pendingRemovalId) return;
    updateItem(pendingRemovalId, (item) => ({ ...item, deleted: true, approved: false }));
    setSelectedItems((current) => {
      const next = new Set(current);
      next.delete(pendingRemovalId);
      return next;
    });
    setPendingRemovalId(null);
  }

  function confirmBulkRemoval() {
    applyBulk("delete");
    setPendingBulkRemoval(false);
  }

  useEffect(() => {
    if (mode !== "preview" || previewOpen || !activeExtraction || !state || !canEdit) return;
    void openPreview();
  }, [activeExtraction, canEdit, mode, previewOpen, state]);

  async function publishReviewedMenu(selectedTheme: MenuTheme) {
    if (!activeExtraction || publishing) return;
    setPublishing(true);
    setPublishResult(null);
    setPublishedAt(null);
    setError(null);
    setPublishStage("Publishing");
    try {
      await persistMenuPreviewTheme(restaurantId, selectedTheme);
      setPreviewRestaurant((current) => current ? { ...current, menu_theme: selectedTheme } : current);
      const result = await publishMenuDraft(restaurantId, activeExtraction.id, revisionsRef.current[activeExtraction.id]);
      setPublishStage("Published");
      setPublishResult(result);
      setPublishedAt(new Date().toISOString());
      setPublishHistory(await loadMenuPublishHistory(restaurantId, activeExtraction.id));
    } catch (publishError) {
      setPublishStage("Failed");
      setError(publishError instanceof Error ? publishError.message : "The menu could not be published. No menu changes were committed.");
    } finally {
      setPublishing(false);
    }
  }

  async function downloadPublishedQr() {
    if (!previewRestaurant) return;
    const link = document.createElement("a");
    link.href = await QRCode.toDataURL(`${window.location.origin}/r/${previewRestaurant.slug}`, { width: 1200, margin: 2 });
    link.download = `${previewRestaurant.slug}-menu-qr.png`;
    link.click();
  }

  async function sharePublishedMenu() {
    if (!previewRestaurant) return;
    try {
      const url = `${window.location.origin}/r/${previewRestaurant.slug}`;
      if (navigator.share) {
        await navigator.share({ title: `${previewRestaurant.name} menu`, text: `View ${previewRestaurant.name}'s digital menu.`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setPublishStage("Link copied");
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      setError(shareError instanceof Error ? shareError.message : "The menu link could not be shared.");
    }
  }

  async function printPublishedQr() {
    if (!previewRestaurant) return;
    const dataUrl = await QRCode.toDataURL(`${window.location.origin}/r/${previewRestaurant.slug}`, { width: 1200, margin: 2 });
    const printWindow = window.open("", "_blank");
    if (!printWindow) throw new Error("Allow pop-ups to print the QR code.");
    printWindow.opener = null;
    const title = printWindow.document.createElement("title");
    title.textContent = `${previewRestaurant.name} QR Menu`;
    const main = printWindow.document.createElement("main");
    main.style.cssText = "font-family:system-ui;text-align:center;padding:40px";
    const heading = printWindow.document.createElement("h1");
    heading.textContent = previewRestaurant.name;
    const copy = printWindow.document.createElement("p");
    copy.textContent = "Scan to view our digital menu";
    const image = printWindow.document.createElement("img");
    image.src = dataUrl;
    image.alt = "Digital menu QR code";
    image.style.cssText = "width:min(80vw,520px)";
    image.addEventListener("load", () => { printWindow.print(); printWindow.close(); });
    main.append(heading, copy, image);
    printWindow.document.head.append(title);
    printWindow.document.body.append(main);
    printWindow.document.close();
  }

  async function finishPublishedSetup() {
    if (!onFinishSetup || finishingSetup) return;
    try {
      setFinishingSetup(true);
      setError(null);
      await onFinishSetup();
    } catch (finishError) {
      setError(finishError instanceof Error ? finishError.message : "Restaurant setup could not be completed.");
    } finally {
      setFinishingSetup(false);
    }
  }

  async function restorePublishedDraft(versionId: string) {
    if (!activeExtraction || publishing) return;
    try {
      setError(null);
      await restoreMenuPublishVersion(restaurantId, activeExtraction.id, versionId);
      setPreviewOpen(false);
      await load();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "The previous draft could not be restored.");
    }
  }

  if (loading) {
    return <p className="setup-import-empty">Loading menu editor...</p>;
  }

  if (previewOpen && previewRestaurant && state) {
    return <div className="ai-review-studio">
      {error && publishStage !== "Failed" ? <div className="setup-warning" role="alert">{error}</div> : null}
      {publishStage && !publishResult ? <section className={`menu-publish-progress ${publishStage === "Failed" ? "failed" : ""}`} aria-live="polite"><span>{publishStage === "Failed" ? "Publishing paused" : "Publishing menu"}</span><strong>{publishStage === "Failed" ? "We couldn't publish yet" : "Publishing your menu securely..."}</strong>{publishing ? <div><span className="running" /></div> : null}{publishStage === "Failed" && error ? <p role="alert">{error}</p> : null}<small>{publishStage === "Failed" ? "Your draft is safe. Make the requested change and try again." : "Approved content is being committed safely. Optional images still awaiting review will be skipped."}</small></section> : null}
      {publishResult ? <section className="menu-publish-success" role="status"><span className="menu-live-celebration" aria-hidden="true">✓</span><div><span>Publish complete</span><h2>Your Restaurant Is Live</h2><p>{previewRestaurant.name} is ready for customers.</p></div><dl><div><dt>Menu Items</dt><dd>{publishResult.itemsPublished}</dd></div><div><dt>Categories</dt><dd>{publishResult.categoriesPublished}</dd></div><div><dt>Languages</dt><dd>{publishResult.languagesPublished}</dd></div><div><dt>Theme</dt><dd>{(previewRestaurant.menu_theme ?? "modern").replace("_", " ")}</dd></div><div><dt>QR Ordering</dt><dd><strong>READY</strong></dd></div><div><dt>Published At</dt><dd>{publishedAt ? new Date(publishedAt).toLocaleString() : "Just now"}</dd></div><div><dt>Status</dt><dd><strong>LIVE</strong></dd></div></dl>{publishResult.warnings.length ? <p className="menu-publish-warning">{publishResult.warnings.join(" ")}</p> : null}<div className="menu-success-actions"><a className="setup-primary" href={`/r/${previewRestaurant.slug}`} target="_blank" rel="noreferrer">Open Live Menu</a><button type="button" onClick={() => void downloadPublishedQr()}>Download QR</button><button type="button" onClick={() => void printPublishedQr()}>Print QR</button><button type="button" onClick={() => void sharePublishedMenu()}>Share Menu</button>{onFinishSetup ? <button type="button" disabled={finishingSetup} onClick={() => void finishPublishedSetup()}>{finishingSetup ? "Opening Dashboard..." : "Go To Dashboard"}</button> : <a href="/owner">Go To Dashboard</a>}</div></section> : <AiMenuFinalPreview restaurant={previewRestaurant} state={state} draftVersion={activeExtraction?.reviewRevision ?? 0} lastUpdated={activeExtraction?.reviewUpdatedAt ?? activeExtraction?.updatedAt ?? new Date().toISOString()} onReturn={onBack ?? (() => setPreviewOpen(false))} onPublish={(theme) => void publishReviewedMenu(theme)} publishing={publishing} />}
      {publishHistory.length ? <section className="menu-publish-history"><h3>Publish History</h3>{publishHistory.map((entry) => <article key={entry.id}><strong>Version {entry.publishedVersion}</strong><span>{new Date(entry.publishedAt).toLocaleString()}</span><small>{entry.itemsPublished} items · {entry.imagesPublished} images · revision {entry.reviewRevision}</small><button type="button" disabled={publishing} onClick={() => void restorePublishedDraft(entry.id)}>Restore Previous Draft</button></article>)}</section> : null}
    </div>;
  }

  if (smartLibraryOnly && mode === "review" && state && summary && activeExtraction) {
    const ownerFilters: Array<{ id: MenuReviewFilter; label: string }> = [
      { id: "all", label: "All" },
      { id: "missing-price", label: "Missing Price" },
      { id: "hidden", label: "Hidden" },
    ];
    const activeItems = state.items.filter((item) => !item.deleted && !item.hidden);
    const readyItems = activeItems.filter((item) => item.price.value !== null);
    const needsPrices = activeItems.length - readyItems.length;
    const allActiveHavePrices = activeItems.length > 0 && needsPrices === 0;
    const orderedCategories = [...state.categories].sort((first, second) => first.order - second.order);
    const quickCategoryId = quickPriceCategoryId || expandedOwnerCategoryId || orderedCategories[0]?.id || "";
    const quickItems = state.items.filter((item) => !item.deleted && item.categoryId === quickCategoryId && (!selectedItems.size || selectedItems.has(item.id)));
    return (
      <div className="owner-menu-editor">
        {sessionRecovered ? <div className="owner-session-restored" role="status" aria-live="polite"><strong>Welcome back.</strong><span>We've restored your unfinished menu.</span></div> : null}
        <header className="owner-menu-topbar">
          {onBack ? <button className="setup-secondary" type="button" onClick={onBack} aria-label="Go back">← Back</button> : null}
          <strong>{restaurantName}</strong>
          <label className="owner-menu-search">
            <span className="setup-visually-hidden">Search menu items by name or category</span>
            <input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search menu..." />
          </label>
          <span className="owner-save-status" aria-live="polite">{saveStateLabel(saveStatus, offline)}</span>
          <button type="button" onClick={() => void prepareOwnerMenu(openPreview)}>Preview Menu</button>
          <button className="setup-primary" type="button" disabled={!allActiveHavePrices} onClick={() => void prepareOwnerMenu(async () => onContinue?.())}>Continue</button>
        </header>

        {error ? <div className="setup-warning" role="alert">{error}</div> : null}

        <section className="owner-menu-summary" aria-label="Menu progress">
          <div className="items"><span>Menu Items</span><strong>{activeItems.length}</strong></div>
          <div className="categories"><span>Categories</span><strong>{summary.totalCategories}</strong></div>
          <div className="prices"><span>Missing Prices</span><strong>{needsPrices}</strong></div>
          <div className="ready"><span>Ready Items</span><strong>{readyItems.length}</strong></div>
        </section>

        <section className="owner-menu-toolbar" aria-label="Menu filters and actions">
          <div className="owner-menu-filters">
            {ownerFilters.map((entry) => <button type="button" className={filter === entry.id ? "active" : ""} aria-pressed={filter === entry.id} onClick={() => setFilter(entry.id)} key={entry.id}>{entry.label}</button>)}
          </div>
          <button type="button" onClick={() => setQuickPriceMode((current) => !current)}>Quick Price Mode</button>
          {canEdit ? <button className="owner-add-menu-item" type="button" onClick={openAddItemDialog}>+ Add Menu Item</button> : null}
        </section>

        {quickPriceMode ? <section className="owner-quick-price" aria-labelledby="quick-price-title">
          <header><div><h3 id="quick-price-title">Quick Price Mode</h3><p>Enter prices quickly. Changes save automatically.</p></div><button type="button" onClick={() => setQuickPriceMode(false)}>Done</button></header>
          <select value={quickCategoryId} onChange={(event) => setQuickPriceCategoryId(event.target.value)} aria-label="Category to price">
            {orderedCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
          </select>
          <div role="grid" aria-label="Quick price editor">
            {quickItems.map((item) => <label role="row" key={item.id}><span>{resolveMenuReviewText(item.name, item.nameLocalization)}</span><strong>ETB</strong><input type="number" inputMode="decimal" min="0" step="0.01" value={item.price.value ?? ""} onChange={(event) => updatePrice(item.id, event.target.value)} aria-label={`${resolveMenuReviewText(item.name, item.nameLocalization)} price`} /></label>)}
          </div>
        </section> : null}

        <section className="owner-menu-accordion" aria-label="Menu categories">
          {orderedCategories.map((category) => {
            const categoryItems = ownerVisibleItems.filter((item) => item.categoryId === category.id);
            if (searchInput.trim() && categoryItems.length === 0) return null;
            const expanded = expandedOwnerCategoryId === category.id;
            return <section className="owner-menu-category" key={category.id}>
              <button type="button" className="owner-category-toggle" aria-expanded={expanded} aria-controls={`owner-category-${category.id}`} onClick={() => setExpandedOwnerCategoryId(expanded ? null : category.id)}>
                <span aria-hidden="true">{expanded ? "▼" : "▶"}</span><strong>{category.name}</strong><small>{categoryItems.length}</small>
              </button>
              {expanded ? <div className="owner-menu-card-list" id={`owner-category-${category.id}`}>
                {categoryItems.map((item) => <OwnerMenuItemCard
                  item={item} categories={state.categories} selected={selectedItems.has(item.id)} canEdit={canEdit} highlighted={highlightedItemId === item.id}
                  onSelect={(selected) => setSelectedItems((current) => { const next = new Set(current); if (selected) next.add(item.id); else next.delete(item.id); return next; })}
                  onNameChange={(value) => updateText(item.id, "name", value)}
                  onDescriptionChange={(value) => updateText(item.id, "description", value.slice(0, 160))}
                  onPriceChange={(value) => updatePrice(item.id, value)}
                  onCategoryChange={(categoryId) => updateCategory(item.id, categoryId || null)}
                  onPhotoChange={(file) => uploadOwnImage(item.id, file)}
                  onPhotoRemove={() => changeImageDraft(item.id, (current) => ({ ...current, imageDraft: { ...current.imageDraft, selectedVersionId: null, status: "Pending" } }))}
                  onRemove={() => setPendingRemovalId(item.id)} key={item.id}
                />)}
                {categoryItems.length === 0 ? <p className="owner-menu-empty">No menu items match your search.</p> : null}
              </div> : null}
            </section>;
          })}
        </section>

        {selectedItems.size > 0 ? <section className="owner-selection-toolbar" aria-label="Selected menu item actions">
          <strong>{selectedItems.size} Selected</strong>
          <button type="button" onClick={() => setQuickPriceMode(true)}>Update Prices</button>
          <button type="button" onClick={() => { setMoveDestinationId(""); setMoveDialogOpen(true); }}>Move Category</button>
          <button className="danger" type="button" onClick={() => setPendingBulkRemoval(true)}>Remove Selected</button>
          <button type="button" aria-label="Close selection toolbar" onClick={() => setSelectedItems(new Set())}>Close</button>
        </section> : null}

        {addItemOpen ? <div className="owner-remove-dialog-backdrop" role="presentation"><section className="owner-add-item-dialog" role="dialog" aria-modal="true" aria-labelledby="add-menu-item-title" onKeyDown={(event) => trapDialogFocus(event, closeAddItemDialog)}>
          <header><div><span>Add to your digital menu</span><h3 id="add-menu-item-title">Add New Menu Item</h3></div><button type="button" aria-label="Close Add New Menu Item" onClick={closeAddItemDialog}>×</button></header>
          <div className="owner-add-item-fields">
            <label><span>Category *</span><select autoFocus required value={addItemCategoryId} onChange={(event) => setAddItemCategoryId(event.target.value)}><option value="">Choose category</option>{orderedCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
            <button className="owner-inline-category-toggle" type="button" aria-expanded={showNewCategory} onClick={() => setShowNewCategory((current) => !current)}>+ Create New Category</button>
            {showNewCategory ? <section className="owner-inline-category" aria-label="Create new category"><label><span>Category Name *</span><input value={inlineCategoryName} maxLength={80} onChange={(event) => setInlineCategoryName(event.target.value)} /></label><label><span>Display Order <small>(optional)</small></span><input type="number" min="1" inputMode="numeric" value={inlineCategoryOrder} onChange={(event) => setInlineCategoryOrder(event.target.value)} /></label><button type="button" disabled={!inlineCategoryName.trim()} onClick={createOwnerCategory}>Create</button></section> : null}
            <label><span>Food Name *</span><input required maxLength={160} value={addItemName} onChange={(event) => setAddItemName(event.target.value)} onBlur={() => { if (!addItemDescription.trim() && addItemName.trim()) setAddItemDescription(createSafeMenuDescription(addItemName)); }} placeholder="Chicken Burger" /></label>
            <label><span>Price <small>(optional)</small></span><div className="owner-dialog-price"><strong>ETB</strong><input type="number" min="0" step="0.01" inputMode="decimal" value={addItemPrice} onChange={(event) => setAddItemPrice(event.target.value)} placeholder="180" /></div></label>
            <label className="owner-dialog-description"><span>Description</span><textarea rows={3} maxLength={160} value={addItemDescription} onChange={(event) => setAddItemDescription(event.target.value)} placeholder="A short description will be added automatically." /><small>This appears under the menu item. {addItemDescription.length}/160</small></label>
            <label><span>Image <small>(optional)</small></span><input type="file" accept="image/*" onChange={(event) => changeAddItemImage(event.target.files?.[0] ?? null)} /><small>{addItemImage?.name ?? "ServeFlow placeholder image will be used."}</small></label>
          </div>
          <footer><button type="button" onClick={closeAddItemDialog}>Cancel</button><button className="setup-primary" type="button" disabled={!addItemName.trim() || !addItemCategoryId} onClick={createOwnerItem}>Create Item</button></footer>
        </section></div> : null}

        {moveDialogOpen ? <div className="owner-remove-dialog-backdrop" role="presentation"><section className="owner-remove-dialog" role="dialog" aria-modal="true" aria-labelledby="move-selected-title" onKeyDown={(event) => trapDialogFocus(event, () => setMoveDialogOpen(false))}><h3 id="move-selected-title">Move Selected Items</h3><label className="owner-move-category-field"><span>Destination category</span><select autoFocus value={moveDestinationId} onChange={(event) => setMoveDestinationId(event.target.value)}><option value="">Choose destination category</option>{orderedCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><div><button type="button" onClick={() => setMoveDialogOpen(false)}>Cancel</button><button className="setup-primary" type="button" disabled={!moveDestinationId} onClick={moveSelectedItems}>Move</button></div></section></div> : null}

        {pendingRemovalId || pendingBulkRemoval ? <div className="owner-remove-dialog-backdrop" role="presentation"><section className="owner-remove-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-menu-item-title" onKeyDown={(event) => trapDialogFocus(event, () => { setPendingRemovalId(null); setPendingBulkRemoval(false); })}><h3 id="remove-menu-item-title">{pendingBulkRemoval ? "Remove selected menu items?" : "Remove Menu Item?"}</h3><p>{pendingBulkRemoval ? <>Items are removed only from this restaurant draft.<br />Smart Menu Library remains unchanged.</> : <>This removes the item from your restaurant menu.<br />The Smart Menu Library remains unchanged.</>}</p><div><button type="button" autoFocus onClick={() => { setPendingRemovalId(null); setPendingBulkRemoval(false); }}>Cancel</button><button className="danger" type="button" onClick={pendingBulkRemoval ? confirmBulkRemoval : confirmItemRemoval}>Remove</button></div></section></div> : null}
      </div>
    );
  }

  if (smartLibraryOnly && mode === "review") {
    return <div className="owner-menu-editor">
      {error ? <div className="setup-warning" role="alert">{error}</div> : null}
      <p className="owner-menu-empty">Your menu is not ready yet. Go back and load a restaurant menu first.</p>
      {onBack ? <div className="onboarding-studio-navigation"><button className="setup-secondary" type="button" onClick={onBack}>Back</button></div> : null}
    </div>;
  }

  return (
    <div className="ai-review-studio">
      <header className="review-studio-heading">
        <div>
          <p className="setup-import-kicker">{smartLibraryOnly ? "ServeFlow Smart Menu" : "Private menu draft"}</p>
          <h2>{smartLibraryOnly ? "Review Digital Menu" : "Menu Review Studio"}</h2>
          <p>
            Verify, edit, organize, and approve your digital menu before publishing.
          </p>
        </div>
        <div className="review-access-status">
          <strong>{access === "owner" ? "Owner editing" : "Manager review"}</strong>
          <span>
            {access === "owner" ? saveStateLabel(saveStatus, offline) : "Synced"}
          </span>
          {saveStatus === "error" && activeExtraction && canEdit ? (
            <button
              type="button"
              onClick={() => queueSave(activeExtraction.id)}
            >
              Retry Save
            </button>
          ) : null}
        </div>
      </header>

      {error ? <div className="setup-warning" role="alert">{error}</div> : null}
      {access === "manager" ? (
        <div className="review-readonly-notice" role="status">
          Managers can review AI import drafts. Only the restaurant owner can
          edit or approve them.
        </div>
      ) : null}

      <nav className="review-source-tabs" aria-label="Uploaded menu sources">
        {sourceDrafts.map((draft) => {
          const extraction = extractionBySource.get(draft.id);
          const stale = Boolean(
            extraction && extraction.sourceUpdatedAt !== draft.updatedAt,
          );
          return (
            <button
              type="button"
              className={selectedSourceId === draft.id ? "active" : ""}
              onClick={() => setSelectedSourceId(draft.id)}
              key={draft.id}
            >
              <strong>{draft.fileName}</strong>
              <span>
                {stale
                  ? "Needs AI import"
                  : extraction?.status === "completed"
                    ? "Review draft"
                    : extraction?.status ?? "Not imported"}
              </span>
            </button>
          );
        })}
        {extractions.filter((entry) => !entry.sourceDraftId).map((entry) => (
          <button
            type="button"
            className={selectedSourceId === `draft:${entry.id}` ? "active" : ""}
            onClick={() => setSelectedSourceId(`draft:${entry.id}`)}
            key={entry.id}
          >
            <strong>{entry.sourceKind === "smart_library" ? "ServeFlow Smart Menu" : entry.sourceKind === "starter" ? "Smart Starter Menu" : "Manual Menu"}</strong>
            <span>{entry.status === "completed" ? "Review draft" : entry.status}</span>
          </button>
        ))}
      </nav>

      {sourceDrafts.length === 0 && extractions.length === 0 ? (
        <p className="setup-import-empty">
          No menu draft is available. Return to the ServeFlow Smart Menu Library first.
        </p>
      ) : selectedSource && (
        !activeExtraction || activeExtraction.status !== "completed" || !state
      ) ? (
        <section className="review-extraction-gate">
          <div>
            <h3>{selectedSource.fileName}</h3>
            <p>
              {staleExtraction
                ? "This menu was replaced and must be imported again."
                : activeExtraction?.status === "failed"
                  ? "We couldn't create your digital menu. Retry AI Import, use Smart Starter Menu, or cancel. Your uploaded menu is still available. Nothing will be published until you approve it."
                  : "Run AI Menu Import before starting review."}
            </p>
          </div>
          {canEdit ? (
            <div className="review-import-failure-actions">
              <button className="setup-primary" type="button" onClick={() => void runExtraction(selectedSource)} disabled={busyExtractionId !== null}>{busyExtractionId === selectedSource.id ? "Creating..." : activeExtraction?.status === "failed" ? "Retry AI Import" : "Import Menu with AI"}</button>
              {activeExtraction?.status === "failed" ? <button className="setup-secondary" type="button" onClick={() => void createStarterFallback()} disabled={busyExtractionId !== null}>{busyExtractionId === "starter-menu" ? "Creating..." : "Use Smart Starter Menu"}</button> : null}
              {activeExtraction?.status === "failed" && onBack ? <button type="button" onClick={onBack}>Cancel</button> : null}
            </div>
          ) : null}
        </section>
      ) : state && summary && activeExtraction ? (
        <>
          <section className="review-overview" aria-labelledby="review-summary-title">
            <div className="review-restaurant-name">
              <span>Restaurant Name</span>
              <strong>
                {resolveMenuReviewText(
                  state.restaurantName,
                  state.restaurantNameLocalization,
                ) || "Not recognized"}
              </strong>
              <small>{formatConfidence(state.restaurantName.confidence)} confidence</small>
            </div>
            <div className="review-progress">
              <div>
                <span id="review-summary-title">Review Progress</span>
                <strong>{summary.progress}%</strong>
              </div>
              <div
                role="progressbar"
                aria-label="Menu review progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={summary.progress}
              >
                <span style={{ width: `${summary.progress}%` }} />
              </div>
              <small>
                {summary.approvedItems} of {summary.totalItems} active items approved
              </small>
            </div>
            <div className="review-summary-grid">
              {[
                ["Total Categories", summary.totalCategories],
                ["Total Menu Items", summary.totalItems],
                ["Low Confidence Items", summary.lowConfidenceItems],
                ["Missing Prices", summary.missingPrices],
                ["Missing Categories", summary.missingCategories],
                ["Duplicates", summary.duplicates],
                ["Unrecognized Text", summary.unrecognizedText],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="review-tools" aria-label="Review search and filters">
            <label className="review-search">
              <span>Search draft</span>
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Food name, category, or description"
              />
            </label>
            <div className="review-filters" aria-label="Menu item filters">
              {FILTERS.map((entry) => (
                <button
                  type="button"
                  className={filter === entry.id ? "active" : ""}
                  onClick={() => setFilter(entry.id)}
                  aria-pressed={filter === entry.id}
                  key={entry.id}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </section>

          {canEdit ? (
            <section className="review-bulk-bar" aria-label="Bulk item actions">
              <strong>{selectedItems.size} selected</strong>
              <button type="button" onClick={() => applyBulk("approve")} disabled={!selectedItems.size}>
                Bulk Approve
              </button>
              <button type="button" onClick={() => applyBulk("delete")} disabled={!selectedItems.size}>
                Bulk Delete
              </button>
              <button type="button" onClick={() => applyBulk("restore")} disabled={!selectedItems.size}>
                Bulk Restore
              </button>
              <button
                type="button"
                onClick={() => void generateMissingImages()}
                disabled={!state.items.some((item) => item.approved && !item.deleted && !item.hidden && !item.rejected && !item.imageDraft.selectedVersionId)}
              >
                Generate Missing Images
              </button>
              <select
                value={bulkCategoryId}
                onChange={(event) => setBulkCategoryId(event.target.value)}
                aria-label="Bulk move destination"
              >
                <option value="">Missing Category</option>
                {state.categories.map((category) => (
                  <option value={category.id} key={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => applyBulk("move")} disabled={!selectedItems.size}>
                Bulk Move
              </button>
            </section>
          ) : null}

          <section className="review-category-creator">
            <label>
              Create Category
              <input
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                placeholder="Category name"
                disabled={!canEdit}
              />
            </label>
            <select
              value={newCategoryLanguage}
              onChange={(event) =>
                setNewCategoryLanguage(event.target.value as MenuLanguage)}
              disabled={!canEdit}
              aria-label="New category language"
            >
              {MENU_LANGUAGE_OPTIONS.map((option) => (
                <option value={option.code} key={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={createCategory}
              disabled={!canEdit || !newCategoryName.trim()}
            >
              Add Category
            </button>
            <button
              type="button"
              onClick={() => createItem(null)}
              disabled={!canEdit}
            >
              Create New Item
            </button>
          </section>

          <div className="review-categories">
            {[...state.categories]
              .sort((first, second) => first.order - second.order)
              .map((category, categoryIndex) => {
                const items = visibleItems.filter(
                  (item) => item.categoryId === category.id,
                );
                const allCategoryItems = state.items.filter(
                  (item) => item.categoryId === category.id,
                );
                const collapsed = collapsedCategories.has(category.id);
                return (
                  <section className="review-category" key={category.id}>
                    <header className="review-category-header">
                      <button
                        type="button"
                        className="review-collapse"
                        onClick={() => setCollapsedCategories((current) => {
                          const next = new Set(current);
                          if (next.has(category.id)) next.delete(category.id);
                          else next.add(category.id);
                          return next;
                        })}
                        aria-expanded={!collapsed}
                      >
                        <span aria-hidden="true">{collapsed ? "+" : "−"}</span>
                        <strong>{resolveMenuReviewText(
                          {
                            value: category.name,
                            confidence: category.confidence,
                          },
                          category.localization,
                        )}</strong>
                        <small>{allCategoryItems.length} items</small>
                      </button>
                      {canEdit ? (
                        <div className="review-category-actions">
                          <CategoryLocalizedEditor
                            category={category}
                            onChange={(language, value) =>
                              changeActive((current) => ({
                                ...current,
                                categories: current.categories.map((entry) =>
                                  entry.id === category.id
                                    ? {
                                        ...entry,
                                        localization: {
                                          ...entry.localization,
                                          values: {
                                            ...entry.localization.values,
                                            [language]: {
                                              value: value || null,
                                              confidence: value ? 1 : 0,
                                            },
                                          },
                                          ownerEdited: {
                                            ...entry.localization.ownerEdited,
                                            [language]: true,
                                          },
                                        },
                                      }
                                    : entry
                                ),
                              }))}
                          />
                          <button
                            type="button"
                            onClick={() => moveCategory(category.id, -1)}
                            disabled={categoryIndex === 0}
                            aria-label={`Move category up`}
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            onClick={() => moveCategory(category.id, 1)}
                            disabled={categoryIndex === state.categories.length - 1}
                            aria-label={`Move category down`}
                          >
                            Down
                          </button>
                          <select
                            value={mergeTargets[category.id] ?? ""}
                            onChange={(event) => setMergeTargets((current) => ({
                              ...current,
                              [category.id]: event.target.value,
                            }))}
                            aria-label={`Merge ${category.name} into`}
                          >
                            <option value="">Merge into...</option>
                            {state.categories
                              .filter((entry) => entry.id !== category.id)
                              .map((entry) => (
                                <option value={entry.id} key={entry.id}>
                                  {resolveMenuReviewText(
                                    {
                                      value: entry.name,
                                      confidence: entry.confidence,
                                    },
                                    entry.localization,
                                  )}
                                </option>
                              ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => mergeCategory(
                              category.id,
                              mergeTargets[category.id] ?? "",
                            )}
                            disabled={!mergeTargets[category.id]}
                          >
                            Merge
                          </button>
                          <button
                            type="button"
                            onClick={() => createItem(category.id)}
                          >
                            Add Item
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => deleteEmptyCategory(category.id)}
                            disabled={allCategoryItems.length > 0}
                          >
                            Delete Empty
                          </button>
                        </div>
                      ) : null}
                    </header>
                    {!collapsed ? (
                      items.length > 0 ? (
                        <VirtualizedReviewItems
                          items={items}
                          warningsById={warningsById}
                          selectedIds={selectedItems}
                          categories={state.categories}
                          canEdit={canEdit}
                          onSelect={(itemId, selected) => setSelectedItems((current) => {
                            const next = new Set(current);
                            if (selected) next.add(itemId);
                            else next.delete(itemId);
                            return next;
                          })}
                          onTextChange={updateText}
                          onPriceChange={updatePrice}
                          onCategoryChange={updateCategory}
                          onTrackingTypeChange={(itemId, trackingType) => updateItem(itemId, (item) => ({ ...item, trackingType }))}
                          onVisibilityChange={(itemId) => updateItem(itemId, (item) => ({ ...item, hidden: !item.hidden }))}
                          onApprove={(itemId) => updateItem(itemId, (item) => ({
                            ...item,
                            approved: !item.approved,
                          }))}
                          onDelete={(itemId) => updateItem(itemId, (item) => ({
                            ...item,
                            deleted: true,
                            approved: false,
                          }))}
                          onRestore={(itemId) => updateItem(itemId, (item) => ({
                            ...item,
                            deleted: false,
                          }))}
                          onDuplicate={duplicateItem}
                          onGenerateImage={generateImageDraft}
                          onImageDraftChange={changeImageDraft}
                          onOwnerImageUpload={uploadOwnImage}
                        />
                      ) : (
                        <p className="review-category-empty">
                          No items match the current search and filter.
                        </p>
                      )
                    ) : null}
                  </section>
                );
              })}

            <UncategorizedSection
              items={visibleItems.filter((item) => !item.categoryId)}
              state={state}
              warningsById={warningsById}
              canEdit={canEdit}
              selectedItems={selectedItems}
              setSelectedItems={setSelectedItems}
              updateText={updateText}
              updatePrice={updatePrice}
              updateCategory={updateCategory}
              updateItem={updateItem}
              duplicateItem={duplicateItem}
              generateImageDraft={generateImageDraft}
              changeImageDraft={changeImageDraft}
              uploadOwnImage={uploadOwnImage}
            />
          </div>

          <section className="review-unrecognized" aria-labelledby="unrecognized-text-title">
            <header>
              <div>
                <h3 id="unrecognized-text-title">Unrecognized Text</h3>
                <p>Nothing is discarded. Decide what each source fragment means.</p>
              </div>
              <strong>
                {state.unrecognizedText.filter((entry) => entry.status === "active").length} active
              </strong>
            </header>
            {state.unrecognizedText.length === 0 ? (
              <p className="review-category-empty">No unrecognized text was found.</p>
            ) : (
              <ul>
                {state.unrecognizedText.map((entry) => (
                  <li className={entry.status !== "active" ? "resolved" : ""} key={entry.id}>
                    <div>
                      <span>{entry.text || "Unreadable fragment"}</span>
                      <small>{formatConfidence(entry.confidence)} confidence · {entry.status}</small>
                    </div>
                    {canEdit && entry.status === "active" ? (
                      <div>
                        <button type="button" onClick={() => convertUnrecognized(entry.id)}>
                          Convert into Menu Item
                        </button>
                        <button type="button" onClick={() => changeActive((current) => ({
                          ...current,
                          unrecognizedText: current.unrecognizedText.map((candidate) =>
                            candidate.id === entry.id
                              ? { ...candidate, status: "ignored" }
                              : candidate
                          ),
                        }))}>
                          Ignore
                        </button>
                        <button type="button" className="danger" onClick={() => changeActive((current) => ({
                          ...current,
                          unrecognizedText: current.unrecognizedText.map((candidate) =>
                            candidate.id === entry.id
                              ? { ...candidate, status: "deleted" }
                              : candidate
                          ),
                        }))}>
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}

      {state && activeExtraction && mode === "review" ? <div className="setup-draft-safety review-publish-actions" role="status"><div><strong>Your changes save automatically</strong><span>Nothing is published until you approve it from Customer Preview.</span></div><div className="onboarding-studio-navigation">{onBack ? <button className="setup-secondary" type="button" onClick={onBack}>Back</button> : null}{canEdit ? <button className="setup-primary" type="button" disabled={saveStatus !== "saved" || summary?.progress !== 100} onClick={onContinue}>Continue to Branding</button> : null}</div></div> : null}
      {mode === "review" && !state && onBack ? <div className="onboarding-studio-navigation"><button className="setup-secondary" type="button" onClick={onBack}>Back</button></div> : null}
      {mode === "preview" && !state ? <div className="setup-warning" role="alert">A reviewed menu is required before Customer Preview. Go back to Review Studio and finish your menu.{onBack ? <button className="setup-secondary" type="button" onClick={onBack}>Back to Branding</button> : null}</div> : null}
    </div>
  );
});

type UncategorizedSectionProps = {
  items: MenuReviewItem[];
  state: MenuReviewState;
  warningsById: ReadonlyMap<string, ReturnType<typeof getMenuReviewWarnings>>;
  canEdit: boolean;
  selectedItems: Set<string>;
  setSelectedItems: Dispatch<SetStateAction<Set<string>>>;
  updateText: (
    itemId: string,
    field: "name" | "description" | "currency" | "notes",
    value: string,
  ) => void;
  updatePrice: (itemId: string, value: string) => void;
  updateCategory: (itemId: string, categoryId: string | null) => void;
  updateItem: (
    itemId: string,
    update: (item: MenuReviewItem) => MenuReviewItem,
  ) => void;
  duplicateItem: (itemId: string) => void;
  generateImageDraft: (itemId: string) => Promise<void>;
  changeImageDraft: (
    itemId: string,
    update: (item: MenuReviewItem) => MenuReviewItem,
  ) => void;
  uploadOwnImage: (itemId: string, file: File | null) => void;
};

function UncategorizedSection({
  items,
  state,
  warningsById,
  canEdit,
  selectedItems,
  setSelectedItems,
  updateText,
  updatePrice,
  updateCategory,
  updateItem,
  duplicateItem,
  generateImageDraft,
  changeImageDraft,
  uploadOwnImage,
}: UncategorizedSectionProps) {
  if (items.length === 0) return null;
  return (
    <section className="review-category missing">
      <header className="review-category-header">
        <div className="review-collapse static">
          <strong>Missing Category</strong>
          <small>{items.length} items</small>
        </div>
      </header>
      <VirtualizedReviewItems
        items={items}
        warningsById={warningsById}
        selectedIds={selectedItems}
        categories={state.categories}
        canEdit={canEdit}
        onSelect={(itemId, selected) => setSelectedItems((current) => {
          const next = new Set(current);
          if (selected) next.add(itemId);
          else next.delete(itemId);
          return next;
        })}
        onTextChange={updateText}
        onPriceChange={updatePrice}
        onCategoryChange={updateCategory}
        onTrackingTypeChange={(itemId, trackingType) => updateItem(itemId, (item) => ({ ...item, trackingType }))}
        onVisibilityChange={(itemId) => updateItem(itemId, (item) => ({ ...item, hidden: !item.hidden }))}
        onApprove={(itemId) => updateItem(itemId, (item) => ({
          ...item,
          approved: !item.approved,
        }))}
        onDelete={(itemId) => updateItem(itemId, (item) => ({
          ...item,
          deleted: true,
          approved: false,
        }))}
        onRestore={(itemId) => updateItem(itemId, (item) => ({
          ...item,
          deleted: false,
        }))}
        onDuplicate={duplicateItem}
        onGenerateImage={generateImageDraft}
        onImageDraftChange={changeImageDraft}
        onOwnerImageUpload={uploadOwnImage}
      />
      <span className="setup-visually-hidden">
        {selectedItems.size} items selected
      </span>
    </section>
  );
}

function CategoryLocalizedEditor({
  category,
  onChange,
}: {
  category: MenuReviewCategory;
  onChange: (language: MenuLanguage, value: string) => void;
}) {
  const initialLanguage = isMenuLanguage(
    category.localization.detectedLanguage,
  )
    ? category.localization.detectedLanguage
    : "en";
  const [language, setLanguage] = useState<MenuLanguage>(initialLanguage);
  const field = category.localization.values[language];
  return (
    <fieldset className="review-category-localized">
      <legend>Rename category</legend>
      <div className="review-language-tabs" aria-label="Category language">
        {MENU_LANGUAGE_OPTIONS.map((option) => (
          <button
            type="button"
            className={language === option.code ? "active" : ""}
            onClick={() => setLanguage(option.code)}
            aria-pressed={language === option.code}
            key={option.code}
          >
            {option.label}
          </button>
        ))}
      </div>
      <input
        value={field.value ?? ""}
        onChange={(event) => onChange(language, event.target.value)}
        placeholder="Not translated yet."
      />
      <small>
        Detected: {category.localization.detectedLanguage} · Source preserved:{" "}
        {category.name}
      </small>
    </fieldset>
  );
}

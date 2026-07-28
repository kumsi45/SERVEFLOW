import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import QRCode from "qrcode";
import { createBrowserUuid } from "../../../core/browser/createBrowserUuid";
import {
  MENU_LANGUAGE_OPTIONS,
  isMenuLanguage,
  type MenuLanguage,
} from "../../../core/menu/menuLanguage";
import {
  extractMenuImportDraft,
  getMenuReviewAccess,
  listMenuExtractionDrafts,
  saveMenuReviewDraft,
} from "../services/menuExtractionService";
import { formatConfidence } from "../services/menuExtractionTypes";
import {
  createMenuReviewState,
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
import { loadMenuPreviewRestaurant, loadMenuPublishHistory, persistMenuPreviewTheme, publishMenuDraft, restoreMenuPublishVersion, type MenuPreviewRestaurant, type MenuPublishHistoryEntry, type MenuPublishSummary } from "../services/menuPublishService";

type AiMenuReviewStudioProps = {
  restaurantId: string;
  onBusyChange: (busy: boolean) => void;
  onFinishSetup?: () => Promise<void>;
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
  onBusyChange,
  onFinishSetup,
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
  const savingIdsRef = useRef(new Set<string>());
  const timersRef = useRef(new Map<string, number>());
  const persistRef = useRef<(extractionId: string) => Promise<void>>(async () => undefined);

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
    if (savingIdsRef.current.has(extractionId)) return;
    const state = reviewStatesRef.current[extractionId];
    const revision = revisionsRef.current[extractionId];
    if (!state || revision === undefined || access !== "owner") return;
    const version = versionsRef.current[extractionId] ?? 0;
    savingIdsRef.current.add(extractionId);
    setSaveStatuses((current) => ({ ...current, [extractionId]: "saving" }));
    try {
      const saved = await saveMenuReviewDraft(extractionId, revision, state);
      revisionsRef.current[extractionId] = saved.reviewRevision;
      setExtractions((current) => current.map((entry) =>
        entry.id === saved.id ? saved : entry
      ));
      if ((versionsRef.current[extractionId] ?? 0) === version) {
        setSaveStatuses((current) => ({
          ...current,
          [extractionId]: "saved",
        }));
      } else {
        setSaveStatuses((current) => ({
          ...current,
          [extractionId]: "dirty",
        }));
        queueSave(extractionId);
      }
    } catch (saveError) {
      setSaveStatuses((current) => ({
        ...current,
        [extractionId]: "error",
      }));
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The AI import draft could not be autosaved.",
      );
    } finally {
      savingIdsRef.current.delete(extractionId);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [drafts, loadedExtractions, loadedAccess] = await Promise.all([
        listMenuImportDrafts(restaurantId),
        listMenuExtractionDrafts(restaurantId),
        getMenuReviewAccess(restaurantId),
      ]);
      const states: Record<string, MenuReviewState> = {};
      const revisions: Record<string, number> = {};
      const statuses: Record<string, SaveStatus> = {};
      for (const extraction of loadedExtractions) {
        if (extraction.status !== "completed" || !extraction.result) continue;
        states[extraction.id] =
          extraction.reviewState ?? createMenuReviewState(extraction.result);
        revisions[extraction.id] = extraction.reviewRevision;
        statuses[extraction.id] = "saved";
      }
      reviewStatesRef.current = states;
      revisionsRef.current = revisions;
      versionsRef.current = Object.fromEntries(
        Object.keys(states).map((id) => [id, 0]),
      );
      setSourceDrafts(drafts);
      setExtractions(loadedExtractions);
      setAccess(loadedAccess);
      setReviewStates(states);
      setSaveStatuses(statuses);
      setSelectedSourceId((current) =>
        current && drafts.some((draft) => draft.id === current)
          ? current
          : drafts[0]?.id ?? null
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "The AI Review Studio could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

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
    setSelectedItems(new Set());
    setSearchInput("");
    setSearch("");
    setFilter("all");
  }, [selectedSourceId]);

  const extractionBySource = useMemo(
    () => new Map(extractions.map((extraction) => [
      extraction.sourceDraftId,
      extraction,
    ])),
    [extractions],
  );
  const selectedSource = sourceDrafts.find(
    (draft) => draft.id === selectedSourceId,
  ) ?? null;
  const selectedExtraction = selectedSource
    ? extractionBySource.get(selectedSource.id) ?? null
    : null;
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
    reviewStatesRef.current = {
      ...reviewStatesRef.current,
      [extractionId]: next,
    };
    versionsRef.current[extractionId] =
      (versionsRef.current[extractionId] ?? 0) + 1;
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
      const extraction = await extractMenuImportDraft(draft.id);
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
        setError(extraction.errorMessage || "AI menu import failed.");
      }
    } catch (extractionError) {
      setError(
        extractionError instanceof Error
          ? extractionError.message
          : "The source could not be extracted.",
      );
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
    if (target.imageDraft.status === "Generating") return;
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
      .filter((item) => !item.imageDraft.selectedVersionId && item.imageDraft.status !== "Generating")
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
    try {
      setError(null);
      setPreviewRestaurant(await loadMenuPreviewRestaurant(restaurantId));
      setPublishHistory(await loadMenuPublishHistory(restaurantId, activeExtraction.id));
      setPreviewOpen(true);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "The final menu preview could not be opened.");
    }
  }

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
    return <p className="setup-import-empty">Loading AI Review Studio...</p>;
  }

  if (previewOpen && previewRestaurant && state) {
    return <div className="ai-review-studio">
      {error ? <div className="setup-warning" role="alert">{error}</div> : null}
      {publishStage && !publishResult ? <section className={`menu-publish-progress ${publishStage === "Failed" ? "failed" : ""}`} aria-live="polite"><span>Publishing menu</span><strong>{publishStage === "Failed" ? "Publish failed" : "Publishing approved menu securely..."}</strong><div><span className={publishing ? "running" : "complete"} /></div><small>The publish engine is copying approved images and committing the menu atomically. This screen will update when the server confirms completion.</small></section> : null}
      {publishResult ? <section className="menu-publish-success" role="status"><span className="menu-live-celebration" aria-hidden="true">✓</span><div><span>Publish complete</span><h2>Your Restaurant Is Live</h2><p>{previewRestaurant.name} is ready for customers.</p></div><dl><div><dt>Menu Items</dt><dd>{publishResult.itemsPublished}</dd></div><div><dt>Categories</dt><dd>{publishResult.categoriesPublished}</dd></div><div><dt>Languages</dt><dd>{publishResult.languagesPublished}</dd></div><div><dt>Theme</dt><dd>{(previewRestaurant.menu_theme ?? "modern").replace("_", " ")}</dd></div><div><dt>QR Ordering</dt><dd><strong>READY</strong></dd></div><div><dt>Published At</dt><dd>{publishedAt ? new Date(publishedAt).toLocaleString() : "Just now"}</dd></div><div><dt>Status</dt><dd><strong>LIVE</strong></dd></div></dl>{publishResult.warnings.length ? <p className="menu-publish-warning">{publishResult.warnings.join(" ")}</p> : null}<div className="menu-success-actions"><a className="setup-primary" href={`/r/${previewRestaurant.slug}`} target="_blank" rel="noreferrer">Open Live Menu</a><button type="button" onClick={() => void downloadPublishedQr()}>Download QR</button><button type="button" onClick={() => void printPublishedQr()}>Print QR</button><button type="button" onClick={() => void sharePublishedMenu()}>Share Menu</button>{onFinishSetup ? <button type="button" disabled={finishingSetup} onClick={() => void finishPublishedSetup()}>{finishingSetup ? "Opening Dashboard..." : "Go To Dashboard"}</button> : <a href="/owner">Go To Dashboard</a>}</div></section> : <AiMenuFinalPreview restaurant={previewRestaurant} state={state} draftVersion={activeExtraction?.reviewRevision ?? 0} lastUpdated={activeExtraction?.reviewUpdatedAt ?? activeExtraction?.updatedAt ?? new Date().toISOString()} onReturn={() => setPreviewOpen(false)} onPublish={(theme) => void publishReviewedMenu(theme)} publishing={publishing} />}
      {publishHistory.length ? <section className="menu-publish-history"><h3>Publish History</h3>{publishHistory.map((entry) => <article key={entry.id}><strong>Version {entry.publishedVersion}</strong><span>{new Date(entry.publishedAt).toLocaleString()}</span><small>{entry.itemsPublished} items · {entry.imagesPublished} images · revision {entry.reviewRevision}</small><button type="button" disabled={publishing} onClick={() => void restorePublishedDraft(entry.id)}>Restore Previous Draft</button></article>)}</section> : null}
    </div>;
  }

  return (
    <div className="ai-review-studio">
      <header className="review-studio-heading">
        <div>
          <p className="setup-import-kicker">AI Import Draft only</p>
          <h2>AI Menu Review Studio</h2>
          <p>
            Verify, edit, organize, and approve extracted information before a
            future publishing phase.
          </p>
        </div>
        <div className="review-access-status">
          <strong>{access === "owner" ? "Owner editing" : "Manager review"}</strong>
          <span>
            {access === "owner"
              ? saveStatus === "saving"
                ? "Autosaving..."
                : saveStatus === "dirty"
                  ? "Waiting to autosave"
                  : saveStatus === "error"
                    ? "Autosave needs attention"
                    : "All changes saved"
              : "Read-only draft access"}
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
                    : extraction?.status ?? "Not extracted"}
              </span>
            </button>
          );
        })}
      </nav>

      {sourceDrafts.length === 0 ? (
        <p className="setup-import-empty">
          No uploaded source is available. Return to AI Menu Builder first.
        </p>
      ) : selectedSource && (
        !activeExtraction || activeExtraction.status !== "completed" || !state
      ) ? (
        <section className="review-extraction-gate">
          <div>
            <h3>{selectedSource.fileName}</h3>
            <p>
              {staleExtraction
                ? "This source was replaced and must be extracted again."
                : activeExtraction?.status === "failed"
                  ? activeExtraction.errorMessage || "AI menu import failed."
                  : "Run AI Menu Import before starting review."}
            </p>
          </div>
          {canEdit ? (
            <button
              className="setup-primary"
              type="button"
              onClick={() => void runExtraction(selectedSource)}
              disabled={busyExtractionId !== null}
            >
              {busyExtractionId === selectedSource.id
                ? "Extracting..."
                : "Import Menu with AI"}
            </button>
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
              <p className="review-category-empty">No unrecognized text was extracted.</p>
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

      <div className="setup-draft-safety phase-985-safety-retired" role="status">
        <strong>AI Import Draft only — publishing is not available</strong>
        <span>
          Nothing reaches the live menu, categories, ordering, inventory,
          recipes, or QR menu in this phase.
        </span>
      </div>
      {state && activeExtraction ? <div className="setup-draft-safety review-publish-actions" role="status"><div><strong>Review Studio is the publishing source</strong><span>Preview the customer menu before publishing. Nothing changes until Publish Menu is confirmed.</span></div>{canEdit ? <button className="setup-primary" type="button" disabled={saveStatus !== "saved" || summary?.progress !== 100} onClick={() => void openPreview()}>Preview Digital Menu</button> : null}</div> : null}
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

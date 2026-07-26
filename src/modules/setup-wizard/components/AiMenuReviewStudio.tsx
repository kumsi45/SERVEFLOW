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
import { createBrowserUuid } from "../../../core/browser/createBrowserUuid";
import {
  extractMenuImportDraft,
  getMenuReviewAccess,
  listMenuExtractionDrafts,
  saveMenuReviewDraft,
} from "../services/menuExtractionService";
import { formatConfidence } from "../services/menuExtractionTypes";
import {
  createMenuReviewState,
  getDuplicateItemIds,
  getMenuReviewWarnings,
  matchesMenuReviewFilter,
  matchesMenuReviewSearch,
  summarizeMenuReview,
} from "../services/menuReviewState";
import type {
  MenuReviewAccess,
  MenuReviewFilter,
  MenuReviewItem,
  MenuReviewState,
} from "../services/menuReviewTypes";
import {
  listMenuImportDrafts,
  type MenuImportDraft,
} from "../services/menuImportDraftService";
import type { MenuExtractionDraft } from "../services/menuExtractionTypes";
import { VirtualizedReviewItems } from "./VirtualizedReviewItems";

type AiMenuReviewStudioProps = {
  restaurantId: string;
  onBusyChange: (busy: boolean) => void;
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
  return {
    id: createBrowserUuid(),
    sourceItemId: null,
    categoryId,
    categoryConfidence: categoryId ? 1 : 0,
    name: { value: null, confidence: 0 },
    description: { value: null, confidence: 0 },
    price: { value: null, confidence: 0 },
    currency: { value: null, confidence: 0 },
    notes: { value: null, confidence: 0 },
    sourceText: { value: null, confidence: 0 },
    approved: false,
    deleted: false,
    order,
  };
}

export const AiMenuReviewStudio = memo(function AiMenuReviewStudio({
  restaurantId,
  onBusyChange,
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
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

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
        setError(extraction.errorMessage || "Extraction failed.");
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
      category.name,
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
  ) {
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
            order: Math.max(-1, ...current.items.map((item) => item.order)) + 1,
          },
        ],
      };
    });
  }

  function createCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    changeActive((current) => ({
      ...current,
      categories: [
        ...current.categories,
        {
          id: createBrowserUuid(),
          name,
          confidence: 1,
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

  function convertUnrecognized(entryId: string) {
    changeActive((current) => {
      const entry = current.unrecognizedText.find((item) => item.id === entryId);
      if (!entry || !entry.text.trim()) return current;
      const item = freshItem(
        null,
        Math.max(-1, ...current.items.map((candidate) => candidate.order)) + 1,
      );
      item.name = { value: entry.text, confidence: entry.confidence };
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

  if (loading) {
    return <p className="setup-import-empty">Loading AI Review Studio...</p>;
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
                  ? "Needs extraction"
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
                  ? activeExtraction.errorMessage || "Extraction failed."
                  : "Run structured extraction before starting review."}
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
                : "Extract Menu"}
            </button>
          ) : null}
        </section>
      ) : state && summary && activeExtraction ? (
        <>
          <section className="review-overview" aria-labelledby="review-summary-title">
            <div className="review-restaurant-name">
              <span>Restaurant Name</span>
              <strong>{state.restaurantName.value || "Not recognized"}</strong>
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
                        <strong>{category.name}</strong>
                        <small>{allCategoryItems.length} items</small>
                      </button>
                      {canEdit ? (
                        <div className="review-category-actions">
                          <label>
                            Rename category
                            <input
                              value={category.name}
                              onChange={(event) => changeActive((current) => ({
                                ...current,
                                categories: current.categories.map((entry) =>
                                  entry.id === category.id
                                    ? {
                                        ...entry,
                                        name: event.target.value,
                                        confidence: 1,
                                      }
                                    : entry
                                ),
                              }))}
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => moveCategory(category.id, -1)}
                            disabled={categoryIndex === 0}
                            aria-label={`Move ${category.name} up`}
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            onClick={() => moveCategory(category.id, 1)}
                            disabled={categoryIndex === state.categories.length - 1}
                            aria-label={`Move ${category.name} down`}
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
                                  {entry.name}
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

      <div className="setup-draft-safety" role="status">
        <strong>AI Import Draft only — publishing is not available</strong>
        <span>
          Nothing reaches the live menu, categories, ordering, inventory,
          recipes, or QR menu in this phase.
        </span>
      </div>
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
      />
      <span className="setup-visually-hidden">
        {selectedItems.size} items selected
      </span>
    </section>
  );
}

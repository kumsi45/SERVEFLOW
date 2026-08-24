import { useCallback, useEffect, useMemo, useState } from "react";
import { useTenantRealtime } from "../../../core/realtime/useTenantRealtime";
import { linkMenuItemRecipe, type MenuRecipeLink } from "../../menu-recipes/services/menuRecipeService";
import {
  createRecipe, fetchRecipeIngredients, removeRecipeIngredient, saveRecipeIngredient, searchActiveInventoryItems, updateRecipe,
} from "../../recipes/services/recipeService";
import type { IngredientInventoryItem, Recipe, RecipeDraft, RecipeIngredient, RecipeIngredientDraft } from "../../recipes/types";
import { loadManagerRecipeWorkspace, type ManagerRecipeSnapshot } from "../services/managerRecipeWorkspaceService";
import "../styles/managerRecipeWorkspace.css";
import { managerFacingMessage } from "../managerPresentation";

type Props = { restaurantId: string; restaurantName: string; managerName: string };
type Filter = "all" | "prepared" | "direct" | "active" | "missing" | "incomplete" | "issues";
type RecipeRow = {
  menu: MenuRecipeLink;
  recipe: Recipe | null;
  kind: "prepared" | "direct" | "unconfigured";
  ingredientCount: number;
  incomplete: boolean;
  inventoryIssue: boolean;
};

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" }, { id: "prepared", label: "Prepared Items" }, { id: "direct", label: "Direct Stock" },
  { id: "active", label: "Active" }, { id: "missing", label: "Missing Recipe" }, { id: "incomplete", label: "Incomplete" },
  { id: "issues", label: "Inventory Issues" },
];
const recipeDraft = (menu: MenuRecipeLink, recipe?: Recipe | null): RecipeDraft => ({
  name: recipe?.name ?? menu.name, description: recipe?.description ?? "", categoryId: recipe?.category_id ?? "",
  preparationTimeMinutes: recipe ? String(recipe.preparation_time_minutes) : "", yieldQuantity: String(recipe?.yield_quantity ?? 1),
  yieldUnit: recipe?.yield_unit ?? "serving", status: recipe?.status === "active" ? "active" : "draft",
});

function rowType(row: RecipeRow) {
  if (row.kind === "direct") return "Direct Stock Item";
  return "Prepared Item";
}

export function ManagerRecipeWorkspacePage({ restaurantId }: Props) {
  const [snapshot, setSnapshot] = useState<ManagerRecipeSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editor, setEditor] = useState<MenuRecipeLink | null>(null);
  const [directView, setDirectView] = useState<MenuRecipeLink | null>(null);
  const [setupPicker, setSetupPicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (force = true) => {
    setLoading(true);
    try { setSnapshot(await loadManagerRecipeWorkspace(restaurantId, force)); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Recipes could not be loaded."); }
    finally { setLoading(false); }
  }, [restaurantId]);
  useEffect(() => { void refresh(false); }, [refresh]);
  useTenantRealtime({ channelName: "manager-recipe-workspace", restaurantId, tables: ["recipes", "menu_items", "inventory_items", "recipe_ingredients"], refresh, skipInitialConnectRefresh: true });

  const recipeById = useMemo(() => new Map((snapshot?.recipes ?? []).map((recipe) => [recipe.id, recipe])), [snapshot]);
  const stationById = useMemo(() => new Map((snapshot?.stations ?? []).map((station) => [station.id, station.name])), [snapshot]);
  const rows = useMemo<RecipeRow[]>(() => (snapshot?.menuItems ?? []).map((menu) => {
    const recipe = menu.recipe_id ? recipeById.get(menu.recipe_id) ?? null : null;
    const ingredients = recipe ? snapshot?.ingredientsByRecipe[recipe.id] ?? [] : [];
    const kind = menu.direct_inventory_item_id ? "direct" : recipe ? "prepared" : "unconfigured";
    const inventoryIssue = kind === "prepared" && ingredients.length === 0;
    const incomplete = Boolean(recipe && (recipe.status !== "active" || recipe.preparation_time_minutes <= 0 || ingredients.length === 0));
    return { menu, recipe, kind, ingredientCount: ingredients.length, inventoryIssue, incomplete };
  }), [recipeById, snapshot]);
  const counts = useMemo(() => ({
    active: rows.filter((row) => row.recipe?.status === "active").length,
    missing: rows.filter((row) => row.kind === "unconfigured").length,
    incomplete: rows.filter((row) => row.incomplete).length,
    issues: rows.filter((row) => row.inventoryIssue).length,
  }), [rows]);
  const visibleRows = useMemo(() => rows.filter((row) => {
    const needle = query.trim().toLowerCase();
    if (needle && !`${row.menu.name} ${row.menu.category_name ?? ""} ${row.recipe?.name ?? ""}`.toLowerCase().includes(needle)) return false;
    if (filter === "prepared") return row.kind === "prepared";
    if (filter === "direct") return row.kind === "direct";
    if (filter === "active") return row.recipe?.status === "active";
    if (filter === "missing") return row.kind === "unconfigured";
    if (filter === "incomplete") return row.incomplete;
    if (filter === "issues") return row.inventoryIssue;
    return true;
  }), [filter, query, rows]);
  const setupChoices = rows.filter((row) => row.kind === "unconfigured");

  function openRow(row: RecipeRow) {
    if (row.kind === "direct") setDirectView(row.menu);
    else setEditor(row.menu);
  }

  return <main className="mrw-page">
    {error && <div className="mrw-message error" role="alert">{managerFacingMessage(error, "Unable to load recipes. Try again.")}</div>}{notice && <div className="mrw-message">{notice}</div>}

    <div className="mrw-summary-row">
      <section className="mrw-summary" aria-label="Recipe summary">
        <button type="button" onClick={() => setFilter("active")}><span>Active Recipes</span><strong>{counts.active}</strong></button>
        <button type="button" onClick={() => setFilter("missing")}><span>Missing Recipes</span><strong>{counts.missing}</strong></button>
        <button type="button" onClick={() => setFilter("incomplete")}><span>Incomplete Recipes</span><strong>{counts.incomplete}</strong></button>
        <button type="button" onClick={() => setFilter("issues")}><span>Inventory Link Issues</span><strong>{counts.issues}</strong></button>
      </section>
      <button type="button" className="mrw-setup-action" onClick={() => setSetupPicker(true)}>+ Set Up Recipe</button>
    </div>

    <section className="mrw-attention">
      <header className="mrw-compact-heading"><div><h2>Attention required</h2></div></header>
      {counts.missing + counts.incomplete + counts.issues === 0 ? <div className="mrw-healthy"><i>✓</i><span><strong>Recipe setup is healthy</strong><small>No recipe intervention is currently required.</small></span></div> : <div className="mrw-attention-list">
        {counts.missing > 0 && <button type="button" onClick={() => setFilter("missing")}><i className="critical"/><span><strong>{counts.missing} sellable item{counts.missing === 1 ? " has" : "s have"} no recipe or direct-stock connection</strong><small>Review the intended inventory-consumption method.</small></span><b>Review →</b></button>}
        {rows.filter((row) => row.recipe && row.ingredientCount === 0).length > 0 && <button type="button" onClick={() => setFilter("issues")}><i/><span><strong>{rows.filter((row) => row.recipe && row.ingredientCount === 0).length} recipe{rows.filter((row) => row.recipe && row.ingredientCount === 0).length === 1 ? " has" : "s have"} no inventory-linked ingredients</strong><small>Add ingredients from the existing Inventory catalog.</small></span><b>Review →</b></button>}
        {rows.filter((row) => row.recipe && row.recipe.preparation_time_minutes <= 0).length > 0 && <button type="button" onClick={() => setFilter("incomplete")}><i/><span><strong>{rows.filter((row) => row.recipe && row.recipe.preparation_time_minutes <= 0).length} recipe{rows.filter((row) => row.recipe && row.recipe.preparation_time_minutes <= 0).length === 1 ? " has" : "s have"} no preparation time</strong><small>Add a practical preparation target.</small></span><b>Review →</b></button>}
      </div>}
    </section>

    <section className="mrw-workspace">
      <header className="mrw-toolbar mrw-compact-heading"><div><h2>{visibleRows.length} sellable items</h2></div><input aria-label="Search recipes and menu items" placeholder="Search recipes or menu items..." value={query} onChange={(event) => setQuery(event.target.value)}/></header>
      <nav className="mrw-filters" aria-label="Recipe filters">{FILTERS.map((entry) => <button type="button" key={entry.id} className={filter === entry.id ? "active" : ""} onClick={() => setFilter(entry.id)}>{entry.label}</button>)}</nav>
      {loading ? <div className="mrw-empty">Loading recipes...</div> : <div className="mrw-list">
        <div className="mrw-row mrw-row-head"><span>Item</span><span>Category</span><span>Type</span><span>Recipe Status</span><span>Ingredients</span><span>Inventory Link</span><span>Prep Time</span><span>Actions</span></div>
        {visibleRows.map((row) => <article className="mrw-row" key={row.menu.id}>
          <div className="mrw-item">{row.menu.image_url ? <img src={row.menu.image_url} alt=""/> : <i>{row.menu.name.slice(0, 2).toUpperCase()}</i>}<span><strong>{row.menu.name}</strong><small>{row.menu.description || "No description"}</small></span></div>
          <span data-label="Category">{row.menu.category_name ?? "Uncategorized"}</span>
          <span data-label="Type"><em className={`mrw-badge ${row.kind}`}>{rowType(row)}</em></span>
          <span data-label="Recipe status">{row.kind === "direct" ? "—" : <em className={`mrw-badge ${row.recipe?.status === "active" && !row.incomplete ? "active" : row.recipe ? "incomplete" : "missing"}`}>{row.recipe?.status === "active" && !row.incomplete ? "Active" : row.recipe ? "Incomplete" : "Missing Recipe"}</em>}</span>
          <span data-label="Ingredients">{row.kind === "direct" ? "1 inventory item" : row.recipe ? `${row.ingredientCount} ingredient${row.ingredientCount === 1 ? "" : "s"}` : "—"}</span>
          <span data-label="Inventory link"><em className={`mrw-badge ${row.kind === "direct" || (row.recipe && !row.inventoryIssue) ? "linked" : "not-linked"}`}>{row.kind === "direct" || (row.recipe && !row.inventoryIssue) ? "Linked" : "Not Linked"}</em></span>
          <span data-label="Prep time">{row.recipe?.preparation_time_minutes ? `${row.recipe.preparation_time_minutes} min` : "—"}</span>
          <button type="button" onClick={() => openRow(row)}>{row.kind === "direct" ? "View" : row.recipe ? "View/Edit" : "Set Up Recipe"}</button>
        </article>)}
        {!visibleRows.length && <div className="mrw-empty">No recipes or menu items match this view.</div>}
      </div>}
    </section>

    {setupPicker && <div className="mrw-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSetupPicker(false); }}><section className="mrw-picker" role="dialog" aria-modal="true" aria-label="Set up recipe"><header><div><span>Recipe setup</span><h2>Select a sellable item</h2></div><button type="button" onClick={() => setSetupPicker(false)} aria-label="Close">×</button></header><div>{setupChoices.map((row) => <button type="button" key={row.menu.id} onClick={() => { setSetupPicker(false); setEditor(row.menu); }}><span><strong>{row.menu.name}</strong><small>{row.menu.category_name ?? "Uncategorized"}</small></span><b>Set up →</b></button>)}{!setupChoices.length && <div className="mrw-empty">Every sellable item already has a recipe or direct-stock connection.</div>}</div></section></div>}
    {editor && snapshot && <RecipeEditor
      restaurantId={restaurantId}
      menu={editor}
      snapshot={snapshot}
      stationName={editor.kitchen_station_id ? stationById.get(editor.kitchen_station_id) ?? null : null}
      onClose={() => setEditor(null)}
      onSaved={async (message) => { setNotice(message); await refresh(); }}
    />}
    {directView && <div className="mrw-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDirectView(null); }}><aside className="mrw-drawer compact" role="dialog" aria-modal="true" aria-label={`${directView.name} details`}><header><div><span>Direct stock item</span><h2>{directView.name}</h2></div><button type="button" onClick={() => setDirectView(null)} aria-label="Close">×</button></header><div className="mrw-direct"><dl><div><dt>Category</dt><dd>{directView.category_name ?? "Uncategorized"}</dd></div><div><dt>Inventory connection</dt><dd>{directView.direct_inventory_item_name ?? "Linked inventory item"}</dd></div><div><dt>Recipe</dt><dd>Not required</dd></div></dl><p>Ready-to-serve stock is consumed through its direct Inventory connection. Stock quantities remain in Inventory.</p></div></aside></div>}
  </main>;
}

export type IngredientFormState = { index: number | null; search: string; draft: RecipeIngredientDraft };

export function selectIngredientInventoryItem(form: IngredientFormState, item: IngredientInventoryItem): IngredientFormState {
  return { ...form, search: "", draft: { ...form.draft, inventoryItemId: item.id, unitId: item.unit_id } };
}

function toIngredientDraft(row: RecipeIngredient): RecipeIngredientDraft {
  return { id: row.id, inventoryItemId: row.inventory_item_id, quantityRequired: String(row.quantity_required), unitId: row.unit_id, optionalNotes: row.optional_notes ?? "", sortOrder: row.sort_order };
}

type IngredientSectionProps = {
  ingredients: RecipeIngredientDraft[];
  loading: boolean;
  saving: boolean;
  form: IngredientFormState | null;
  results: IngredientInventoryItem[];
  searching: boolean;
  searchError: string | null;
  units: ManagerRecipeSnapshot["units"];
  itemName: (entry: RecipeIngredientDraft) => string;
  unitName: (entry: RecipeIngredientDraft) => string;
  linkStatus: (entry: RecipeIngredientDraft) => string;
  onStartAdd: () => void;
  onStartEdit: (entry: RecipeIngredientDraft, index: number) => void;
  onRemove: (entry: RecipeIngredientDraft) => void;
  onCloseForm: () => void;
  onSearch: (value: string) => void;
  onSelectItem: (item: IngredientInventoryItem) => void;
  onQuantity: (value: string) => void;
  onUnit: (value: string) => void;
  onApply: () => void;
  onRetry: () => void;
};

export function ManagerRecipeIngredientSection({ ingredients, loading, saving, form, results, searching, searchError, units, itemName, unitName, linkStatus, onStartAdd, onStartEdit, onRemove, onCloseForm, onSearch, onSelectItem, onQuantity, onUnit, onApply, onRetry }: IngredientSectionProps) {
  const query = form?.search.trim() ?? "";
  return <section className="mrw-ingredients" aria-label="Recipe ingredients"><header><div><span>Expected consumption per serving</span><h3>Ingredients</h3></div>{!form && <button type="button" className="mrw-add-trigger" disabled={loading || saving} onClick={onStartAdd}>+ Add Ingredient</button>}</header>
    {loading ? <div className="mrw-ingredient-loading">Loading ingredients...</div> : <>
      {ingredients.length > 0 && <><div className="mrw-ingredient-head"><span>Ingredient</span><span>Quantity</span><span>Unit</span><span>Inventory Link</span><span>Actions</span></div>{ingredients.map((entry, index) => { const status = linkStatus(entry); return <div className="mrw-ingredient" key={entry.id ?? `${entry.inventoryItemId}-${index}`}><strong>{itemName(entry)}</strong><span>{entry.quantityRequired}</span><span>{unitName(entry)}</span><em className={`mrw-badge ${status === "Linked" ? "linked" : "not-linked"}`}>{status}</em><div className="mrw-ingredient-actions"><button type="button" disabled={saving} onClick={() => onStartEdit(entry, index)}>Edit</button><button type="button" disabled={saving} onClick={() => onRemove(entry)}>Remove</button></div><small>{entry.quantityRequired} {unitName(entry)} per serving</small></div>; })}</>}
      {!ingredients.length && <div className="mrw-ingredient-empty"><strong>No ingredients added yet.</strong><p>Add ingredients to define expected inventory consumption for one serving.</p></div>}
    </>}
    {form && <div className="mrw-ingredient-form"><header><strong>{form.index == null ? "Add ingredient" : `Edit ${itemName(form.draft)}`}</strong><button type="button" disabled={saving} onClick={onCloseForm} aria-label="Close ingredient editor">×</button></header>
      <label>Search Inventory<input autoFocus disabled={saving} value={form.search} onChange={(event) => onSearch(event.target.value)} placeholder="Search inventory by item name"/></label>
      {form.draft.inventoryItemId && <div className="mrw-inventory-selected" data-selected-inventory-item-id={form.draft.inventoryItemId}><span>Selected inventory item</span><strong>{itemName(form.draft)}</strong></div>}
      <div className="mrw-inventory-results" aria-live="polite">
        {searching ? <div className="mrw-inventory-state">Loading inventory...</div>
          : searchError ? <div className="mrw-inventory-state error"><span>{managerFacingMessage(searchError, "Unable to load Inventory. Try again.")}</span><button type="button" onClick={onRetry}>Retry</button></div>
          : !query ? <div className="mrw-inventory-state">Search this restaurant&apos;s inventory.</div>
          : results.length ? results.map((item) => <button type="button" className="mrw-inventory-result" data-inventory-item-id={item.id} key={item.id} disabled={saving || ingredients.some((row, index) => index !== form.index && row.inventoryItemId === item.id)} onClick={() => onSelectItem(item)}><span><strong>{item.name}</strong><small>Inventory ingredient</small></span><small>Available: {item.current_quantity} {units.find((unit) => unit.id === item.unit_id)?.name ?? "units"}</small></button>)
          : <div className="mrw-inventory-state">No matching inventory items found.</div>}
      </div>
      <div className="mrw-ingredient-fields"><label>Quantity<input aria-label="Ingredient quantity" disabled={saving || !form.draft.inventoryItemId} type="number" min="0.001" step="any" value={form.draft.quantityRequired} onChange={(event) => onQuantity(event.target.value)}/></label><label>Unit<select aria-label="Ingredient unit" disabled={saving || !form.draft.inventoryItemId} value={form.draft.unitId} onChange={(event) => onUnit(event.target.value)}><option value="">Select active unit...</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label></div>
      <footer><button type="button" disabled={saving} onClick={onCloseForm}>Cancel</button><button type="button" disabled={saving || !form.draft.inventoryItemId} onClick={onApply}>{saving ? "Saving..." : form.index == null ? "Add Ingredient" : "Update Ingredient"}</button></footer>
    </div>}
  </section>;
}

type RecipeEditorProps = {
  restaurantId: string;
  menu: MenuRecipeLink;
  snapshot: ManagerRecipeSnapshot;
  stationName: string | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
  loadIngredients?: typeof fetchRecipeIngredients;
  findInventory?: typeof searchActiveInventoryItems;
};

export function RecipeEditor({ restaurantId, menu, snapshot, stationName, onClose, onSaved, loadIngredients, findInventory }: RecipeEditorProps) {
  const initialRecipe = menu.recipe_id ? snapshot.recipes.find((entry) => entry.id === menu.recipe_id) ?? null : null;
  const initialIngredients = initialRecipe ? snapshot.ingredientsByRecipe[initialRecipe.id] ?? [] : [];
  const [currentRecipe, setCurrentRecipe] = useState<Recipe | null>(initialRecipe);
  const [persistedIngredients, setPersistedIngredients] = useState<RecipeIngredient[]>(initialIngredients);
  const [draft, setDraft] = useState<RecipeDraft>(() => recipeDraft(menu, initialRecipe));
  const [ingredients, setIngredients] = useState<RecipeIngredientDraft[]>(() => initialIngredients.map(toIngredientDraft));
  const [ingredientForm, setIngredientForm] = useState<IngredientFormState | null>(null);
  const [inventoryResults, setInventoryResults] = useState<IngredientInventoryItem[]>([]);
  const [selectedInventoryItem, setSelectedInventoryItem] = useState<IngredientInventoryItem | null>(null);
  const [searchingInventory, setSearchingInventory] = useState(false);
  const [inventorySearchError, setInventorySearchError] = useState<string | null>(null);
  const [inventorySearchVersion, setInventorySearchVersion] = useState(0);
  const [ingredientLoading, setIngredientLoading] = useState(Boolean(initialRecipe));
  const [ingredientSaving, setIngredientSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorNotice, setEditorNotice] = useState<string | null>(null);
  const inventoryById = useMemo(() => new Map([...snapshot.inventoryItems, ...inventoryResults, ...(selectedInventoryItem ? [selectedInventoryItem] : [])].map((item) => [item.id, item])), [inventoryResults, selectedInventoryItem, snapshot.inventoryItems]);
  const unitById = useMemo(() => new Map(snapshot.units.map((unit) => [unit.id, unit.name])), [snapshot.units]);

  useEffect(() => {
    if (!initialRecipe) return;
    let current = true;
    setIngredientLoading(true);
    const request = loadIngredients
      ? loadIngredients(restaurantId, initialRecipe.id)
      : fetchRecipeIngredients(restaurantId, initialRecipe.id);
    void request
      .then((rows) => {
        if (!current) return;
        setPersistedIngredients(rows);
        setIngredients(rows.map(toIngredientDraft));
        setEditorError(null);
      })
      .catch((cause) => { if (current) setEditorError(cause instanceof Error ? cause.message : "Recipe ingredients could not be loaded."); })
      .finally(() => { if (current) setIngredientLoading(false); });
    return () => { current = false; };
  }, [initialRecipe?.id, loadIngredients, restaurantId]);

  useEffect(() => {
    if (!ingredientForm) return;
    const search = ingredientForm.search.trim();
    if (!search) {
      setInventoryResults([]); setSearchingInventory(false); setInventorySearchError(null);
      return;
    }
    let current = true;
    const timer = window.setTimeout(() => {
      setSearchingInventory(true); setInventorySearchError(null);
      const request = findInventory
        ? findInventory(restaurantId, search)
        : searchActiveInventoryItems(restaurantId, search);
      void request
        .then((rows) => { if (current) setInventoryResults(rows); })
        .catch(() => { if (current) { setInventoryResults([]); setInventorySearchError("Unable to load inventory. Retry."); } })
        .finally(() => { if (current) setSearchingInventory(false); });
    }, 180);
    return () => { current = false; window.clearTimeout(timer); };
  }, [findInventory, ingredientForm?.search, inventorySearchVersion, restaurantId]);

  function itemName(entry: RecipeIngredientDraft) {
    return inventoryById.get(entry.inventoryItemId)?.name ?? persistedIngredients.find((row) => row.id === entry.id)?.inventory_item_name ?? "Missing inventory item";
  }
  function linkStatus(entry: RecipeIngredientDraft) {
    const persisted = persistedIngredients.find((row) => row.id === entry.id);
    if (persisted && persisted.inventory_item_id === entry.inventoryItemId && !persisted.inventory_item_status) return "Broken/missing link";
    if (persisted && persisted.inventory_item_id === entry.inventoryItemId && persisted.inventory_item_status !== "active") return "Inactive inventory item";
    if (persisted && persisted.unit_id === entry.unitId && !persisted.unit_status) return "Broken/missing link";
    if (persisted && persisted.unit_id === entry.unitId && persisted.unit_status !== "active") return "Inactive unit";
    return "Linked";
  }
  function startAddIngredient() {
    setIngredientForm({ index: null, search: "", draft: { inventoryItemId: "", quantityRequired: "", unitId: "", optionalNotes: "", sortOrder: (ingredients.length + 1) * 100 } });
    setSelectedInventoryItem(null); setInventoryResults([]); setInventorySearchError(null); setEditorError(null);
  }
  function startEditIngredient(entry: RecipeIngredientDraft, index: number) {
    setIngredientForm({ index, search: "", draft: { ...entry } });
    setSelectedInventoryItem(inventoryById.get(entry.inventoryItemId) ?? null); setInventoryResults([]); setInventorySearchError(null); setEditorError(null);
  }
  function chooseInventoryItem(item: IngredientInventoryItem) {
    setIngredientForm((form) => form ? selectIngredientInventoryItem(form, item) : null);
    setSelectedInventoryItem(item);
    setInventoryResults([]); setInventorySearchError(null);
  }
  async function applyIngredient() {
    if (!ingredientForm) return;
    const candidate = ingredientForm.draft;
    const quantity = Number(candidate.quantityRequired);
    if (!candidate.inventoryItemId) return setEditorError("Choose an active Inventory item.");
    if (!Number.isFinite(quantity) || quantity <= 0) return setEditorError("Ingredient quantity must be greater than zero.");
    if (!candidate.unitId || !unitById.has(candidate.unitId)) return setEditorError("Choose an active Inventory unit.");
    if (ingredients.some((row, index) => index !== ingredientForm.index && row.inventoryItemId === candidate.inventoryItemId)) return setEditorError("This inventory item is already an ingredient in the recipe.");
    if (!currentRecipe) {
      setIngredients((rows) => ingredientForm.index == null ? [...rows, candidate] : rows.map((row, index) => index === ingredientForm.index ? candidate : row));
      setIngredientForm(null); setEditorError(null);
      setEditorNotice(ingredientForm.index == null ? "Ingredient added. Save the recipe to persist it." : "Ingredient updated. Save the recipe to persist it.");
      return;
    }
    setIngredientSaving(true); setEditorError(null); setEditorNotice(null);
    try {
      await saveRecipeIngredient(restaurantId, currentRecipe.id, candidate);
      const refreshed = await fetchRecipeIngredients(restaurantId, currentRecipe.id);
      setPersistedIngredients(refreshed); setIngredients(refreshed.map(toIngredientDraft)); setIngredientForm(null);
      setEditorNotice(ingredientForm.index == null ? "Ingredient added and refreshed." : "Ingredient updated and refreshed.");
      await onSaved(ingredientForm.index == null ? "Ingredient added." : "Ingredient updated.");
    } catch (cause) { setEditorError(cause instanceof Error ? cause.message : "Ingredient could not be saved."); }
    finally { setIngredientSaving(false); }
  }
  async function removeIngredient(entry: RecipeIngredientDraft) {
    const name = itemName(entry);
    if (!window.confirm(`Remove ${name} from this recipe?\n\nFuture expected consumption for this recipe will no longer include this ingredient.`)) return;
    if (!currentRecipe || !entry.id) {
      setIngredients((rows) => rows.filter((row) => row !== entry));
      setIngredientForm(null); setEditorNotice(`${name} removed from this setup.`);
      return;
    }
    setIngredientSaving(true); setEditorError(null); setEditorNotice(null);
    try {
      await removeRecipeIngredient(restaurantId, currentRecipe.id, entry.id);
      const refreshed = await fetchRecipeIngredients(restaurantId, currentRecipe.id);
      setPersistedIngredients(refreshed); setIngredients(refreshed.map(toIngredientDraft)); setIngredientForm(null);
      setEditorNotice(`${name} removed and ingredients refreshed.`);
      await onSaved("Ingredient removed.");
    } catch (cause) { setEditorError(cause instanceof Error ? cause.message : "Ingredient could not be removed."); }
    finally { setIngredientSaving(false); }
  }
  async function save() {
    const prepTime = Number(draft.preparationTimeMinutes);
    if (!draft.name.trim() || draft.preparationTimeMinutes === "" || !Number.isFinite(prepTime) || prepTime < 0) return setEditorError("Recipe name and a valid preparation time are required.");
    if (ingredients.some((entry) => !entry.inventoryItemId || !entry.unitId || !Number.isFinite(Number(entry.quantityRequired)) || Number(entry.quantityRequired) <= 0)) return setEditorError("Every ingredient requires a positive quantity and an active unit.");
    if (new Set(ingredients.map((entry) => entry.inventoryItemId)).size !== ingredients.length) return setEditorError("Each Inventory item can appear only once in a recipe.");
    setSaving(true); setEditorError(null); setEditorNotice(null);
    try {
      let saved: Recipe;
      const wasNew = currentRecipe == null;
      let activateAndLinkAfterIngredients = false;
      if (currentRecipe) {
        saved = await updateRecipe(restaurantId, currentRecipe.id, draft);
      } else if (draft.status === "active") {
        saved = await createRecipe(restaurantId, { ...draft, status: "draft" });
        activateAndLinkAfterIngredients = true;
      } else {
        saved = await createRecipe(restaurantId, { ...draft, status: "active" });
        await linkMenuItemRecipe(restaurantId, menu.id, saved.id);
        saved = await updateRecipe(restaurantId, saved.id, draft);
      }
      for (const old of persistedIngredients.filter((row) => !ingredients.some((entry) => entry.id === row.id))) await removeRecipeIngredient(restaurantId, saved.id, old.id);
      for (const ingredient of ingredients) await saveRecipeIngredient(restaurantId, saved.id, ingredient);
      if (activateAndLinkAfterIngredients) {
        saved = await updateRecipe(restaurantId, saved.id, draft);
        await linkMenuItemRecipe(restaurantId, menu.id, saved.id);
      }
      const refreshedIngredients = await fetchRecipeIngredients(restaurantId, saved.id);
      setCurrentRecipe(saved); setPersistedIngredients(refreshedIngredients); setIngredients(refreshedIngredients.map(toIngredientDraft));
      setEditorNotice(wasNew ? "Recipe created, linked, and refreshed." : "Recipe changes saved and refreshed.");
      await onSaved(wasNew ? "Recipe created and linked." : "Recipe updated.");
    } catch (cause) { setEditorError(cause instanceof Error ? cause.message : "Recipe could not be saved. Check your connection and try again."); }
    finally { setSaving(false); }
  }
  return <div className="mrw-layer" role="presentation"><aside className="mrw-drawer" role="dialog" aria-modal="true" aria-label={`Edit ${menu.name}`}><header><div><span>{currentRecipe ? "Recipe Detail" : "Recipe Setup"}</span><h2>{menu.name}</h2></div><button type="button" onClick={onClose} aria-label="Close">×</button></header><div className="mrw-editor">
    {editorError && <div className="mrw-message error" role="alert">{managerFacingMessage(editorError, "Unable to complete the recipe action. Try again.")}</div>}{editorNotice && <div className="mrw-message" role="status">{editorNotice}</div>}
    <section className="mrw-current"><div><span>Category</span><strong>{menu.category_name ?? "Uncategorized"}</strong></div><div><span>Kitchen / station</span><strong>{stationName ?? "Not configured"}</strong></div><div><span>Recipe status</span><strong>{currentRecipe ? (currentRecipe.status === "active" ? "Active" : "Draft") : (draft.status === "active" ? "Active after save" : "Draft after save")}</strong></div><div><span>Last updated</span><strong>{currentRecipe ? new Date(currentRecipe.updated_at).toLocaleString() : "Not saved"}</strong></div></section>
    <label>Recipe name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/></label>
    <label>Preparation time<div className="mrw-unit-input"><input type="number" min="0" value={draft.preparationTimeMinutes} onChange={(event) => setDraft({ ...draft, preparationTimeMinutes: event.target.value })}/><span>minutes</span></div></label>
    <label className="mrw-switch"><input type="checkbox" checked={draft.status === "active"} onChange={(event) => setDraft({ ...draft, status: event.target.checked ? "active" : "draft" })}/><span>Recipe active</span></label>
    <ManagerRecipeIngredientSection
      ingredients={ingredients} loading={ingredientLoading} saving={ingredientSaving} form={ingredientForm}
      results={inventoryResults} searching={searchingInventory} searchError={inventorySearchError} units={snapshot.units}
      itemName={itemName}
      unitName={(entry) => unitById.get(entry.unitId) ?? persistedIngredients.find((row) => row.id === entry.id)?.unit_name ?? "Missing unit"}
      linkStatus={linkStatus} onStartAdd={startAddIngredient} onStartEdit={startEditIngredient}
      onRemove={(entry) => void removeIngredient(entry)} onCloseForm={() => setIngredientForm(null)}
      onSearch={(value) => setIngredientForm((form) => form ? { ...form, search: value } : null)}
      onSelectItem={chooseInventoryItem}
      onQuantity={(value) => setIngredientForm((form) => form ? { ...form, draft: { ...form.draft, quantityRequired: value } } : null)}
      onUnit={(value) => setIngredientForm((form) => form ? { ...form, draft: { ...form.draft, unitId: value } } : null)}
      onApply={() => void applyIngredient()} onRetry={() => setInventorySearchVersion((version) => version + 1)}
    />
    {!ingredientLoading && <section className="mrw-review" aria-label="Recipe review"><strong>Review before saving</strong><span>{draft.name.trim() || "Recipe name required"}</span><span>{draft.preparationTimeMinutes || "0"} minutes</span><span>{ingredients.length} ingredient{ingredients.length === 1 ? "" : "s"}</span><span>{draft.status === "active" ? "Activate" : "Keep as draft"}</span></section>}
    <div className="mrw-audit-note"><strong>Change record</strong><span>Recipe changes are recorded. Detailed change history is not yet available.</span></div>
  </div><footer><button type="button" onClick={onClose}>Cancel</button><button type="button" disabled={saving} onClick={() => void save()}>{saving ? "Saving..." : currentRecipe ? "Save Changes" : "Save Recipe"}</button></footer></aside></div>;
}

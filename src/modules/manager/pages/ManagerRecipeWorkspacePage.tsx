import { useCallback, useEffect, useMemo, useState } from "react";
import { useTenantRealtime } from "../../../core/realtime/useTenantRealtime";
import { linkMenuItemRecipe, type MenuRecipeLink } from "../../menu-recipes/services/menuRecipeService";
import {
  createRecipe, removeRecipeIngredient, saveRecipeIngredient, updateRecipe,
} from "../../recipes/services/recipeService";
import type { Recipe, RecipeDraft, RecipeIngredientDraft } from "../../recipes/types";
import { loadManagerRecipeWorkspace, type ManagerRecipeSnapshot } from "../services/managerRecipeWorkspaceService";
import "../styles/managerRecipeWorkspace.css";

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

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setSnapshot(await loadManagerRecipeWorkspace(restaurantId)); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Recipes could not be loaded."); }
    finally { setLoading(false); }
  }, [restaurantId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useTenantRealtime({ channelName: "manager-recipe-workspace", restaurantId, tables: ["recipes", "menu_items"], refresh });
  useTenantRealtime({ channelName: "manager-recipe-ingredients", restaurantId, tables: ["inventory_items", "recipe_ingredients"], refresh });

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
    <header className="mrw-header"><div><h1>Recipes</h1><p>Manage recipe standards, ingredient usage, preparation details, and inventory connections.</p></div><button type="button" onClick={() => setSetupPicker(true)}>+ Set Up Recipe</button></header>
    {error && <div className="mrw-message error" role="alert">{error}</div>}{notice && <div className="mrw-message">{notice}</div>}

    <section className="mrw-summary" aria-label="Recipe summary">
      <button type="button" onClick={() => setFilter("active")}><span>Active Recipes</span><strong>{counts.active}</strong></button>
      <button type="button" onClick={() => setFilter("missing")}><span>Missing Recipes</span><strong>{counts.missing}</strong></button>
      <button type="button" onClick={() => setFilter("incomplete")}><span>Incomplete Recipes</span><strong>{counts.incomplete}</strong></button>
      <button type="button" onClick={() => setFilter("issues")}><span>Inventory Link Issues</span><strong>{counts.issues}</strong></button>
    </section>

    <section className="mrw-attention">
      <header><div><span>Exceptions</span><h2>Attention required</h2></div></header>
      {counts.missing + counts.incomplete + counts.issues === 0 ? <div className="mrw-healthy"><i>✓</i><span><strong>Recipe setup is healthy</strong><small>No recipe intervention is currently required.</small></span></div> : <div className="mrw-attention-list">
        {counts.missing > 0 && <button type="button" onClick={() => setFilter("missing")}><i className="critical"/><span><strong>{counts.missing} sellable item{counts.missing === 1 ? " has" : "s have"} no recipe or direct-stock connection</strong><small>Review the intended inventory-consumption method.</small></span><b>Review →</b></button>}
        {rows.filter((row) => row.recipe && row.ingredientCount === 0).length > 0 && <button type="button" onClick={() => setFilter("issues")}><i/><span><strong>{rows.filter((row) => row.recipe && row.ingredientCount === 0).length} recipe{rows.filter((row) => row.recipe && row.ingredientCount === 0).length === 1 ? " has" : "s have"} no inventory-linked ingredients</strong><small>Add ingredients from the existing Inventory catalog.</small></span><b>Review →</b></button>}
        {rows.filter((row) => row.recipe && row.recipe.preparation_time_minutes <= 0).length > 0 && <button type="button" onClick={() => setFilter("incomplete")}><i/><span><strong>{rows.filter((row) => row.recipe && row.recipe.preparation_time_minutes <= 0).length} recipe{rows.filter((row) => row.recipe && row.recipe.preparation_time_minutes <= 0).length === 1 ? " has" : "s have"} no preparation time</strong><small>Add a practical preparation target.</small></span><b>Review →</b></button>}
      </div>}
    </section>

    <section className="mrw-workspace">
      <header className="mrw-toolbar"><div><span>Recipe source of truth</span><h2>{visibleRows.length} sellable items</h2></div><input aria-label="Search recipes and menu items" placeholder="Search recipes or menu items..." value={query} onChange={(event) => setQuery(event.target.value)}/></header>
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
    {editor && snapshot && <RecipeEditor restaurantId={restaurantId} menu={editor} snapshot={snapshot} stationName={editor.kitchen_station_id ? stationById.get(editor.kitchen_station_id) ?? null : null} onClose={() => setEditor(null)} onSaved={async (message) => { setEditor(null); setNotice(message); await refresh(); }} onError={setError}/>} 
    {directView && <div className="mrw-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDirectView(null); }}><aside className="mrw-drawer compact" role="dialog" aria-modal="true" aria-label={`${directView.name} details`}><header><div><span>Direct stock item</span><h2>{directView.name}</h2></div><button type="button" onClick={() => setDirectView(null)} aria-label="Close">×</button></header><div className="mrw-direct"><dl><div><dt>Category</dt><dd>{directView.category_name ?? "Uncategorized"}</dd></div><div><dt>Inventory connection</dt><dd>{directView.direct_inventory_item_name ?? "Linked inventory item"}</dd></div><div><dt>Recipe</dt><dd>Not required</dd></div></dl><p>Ready-to-serve stock is consumed through its direct Inventory connection. Stock quantities remain in Inventory.</p></div></aside></div>}
  </main>;
}

function RecipeEditor({ restaurantId, menu, snapshot, stationName, onClose, onSaved, onError }: { restaurantId: string; menu: MenuRecipeLink; snapshot: ManagerRecipeSnapshot; stationName: string | null; onClose: () => void; onSaved: (message: string) => Promise<void>; onError: (message: string) => void }) {
  const recipe = menu.recipe_id ? snapshot.recipes.find((entry) => entry.id === menu.recipe_id) ?? null : null;
  const existing = recipe ? snapshot.ingredientsByRecipe[recipe.id] ?? [] : [];
  const [draft, setDraft] = useState<RecipeDraft>(() => recipeDraft(menu, recipe));
  const [ingredients, setIngredients] = useState<RecipeIngredientDraft[]>(() => existing.map((row) => ({ id: row.id, inventoryItemId: row.inventory_item_id, quantityRequired: String(row.quantity_required), unitId: row.unit_id, optionalNotes: row.optional_notes ?? "", sortOrder: row.sort_order })));
  const [ingredientId, setIngredientId] = useState("");
  const [saving, setSaving] = useState(false);
  const inventoryById = new Map(snapshot.inventoryItems.map((item) => [item.id, item]));
  const unitById = new Map(snapshot.units.map((unit) => [unit.id, unit.name]));
  function addIngredient() { const item = snapshot.inventoryItems.find((entry) => entry.id === ingredientId); if (!item || ingredients.some((entry) => entry.inventoryItemId === item.id)) return; setIngredients((rows) => [...rows, { inventoryItemId: item.id, quantityRequired: "1", unitId: item.unit_id, optionalNotes: "", sortOrder: (rows.length + 1) * 100 }]); setIngredientId(""); }
  async function save() {
    if (!draft.name.trim() || draft.preparationTimeMinutes === "" || Number(draft.preparationTimeMinutes) < 0) return onError("Recipe name and a valid preparation time are required.");
    if (ingredients.some((entry) => !entry.inventoryItemId || !entry.unitId || Number(entry.quantityRequired) <= 0)) return onError("Every ingredient requires a positive quantity and unit.");
    setSaving(true);
    try {
      let saved = recipe ? await updateRecipe(restaurantId, recipe.id, draft) : await createRecipe(restaurantId, draft);
      if (!recipe) await linkMenuItemRecipe(restaurantId, menu.id, saved.id);
      for (const old of existing.filter((row) => !ingredients.some((entry) => entry.id === row.id))) await removeRecipeIngredient(restaurantId, saved.id, old.id);
      for (const ingredient of ingredients) await saveRecipeIngredient(restaurantId, saved.id, ingredient);
      await onSaved(recipe ? "Recipe updated." : "Recipe created and linked.");
    } catch (cause) { onError(cause instanceof Error ? cause.message : "Recipe could not be saved."); }
    finally { setSaving(false); }
  }
  return <div className="mrw-layer" role="presentation"><aside className="mrw-drawer" role="dialog" aria-modal="true" aria-label={`Edit ${menu.name}`}><header><div><span>{recipe ? "Recipe detail" : "Recipe setup"}</span><h2>{menu.name}</h2></div><button type="button" onClick={onClose} aria-label="Close">×</button></header><div className="mrw-editor">
    <section className="mrw-current"><div><span>Category</span><strong>{menu.category_name ?? "Uncategorized"}</strong></div><div><span>Kitchen / station</span><strong>{stationName ?? "Not configured"}</strong></div><div><span>Recipe status</span><strong>{draft.status === "active" ? "Active" : "Draft"}</strong></div><div><span>Last updated</span><strong>{recipe ? new Date(recipe.updated_at).toLocaleString() : "Not saved"}</strong></div></section>
    <label>Recipe name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/></label>
    <label>Preparation time<div className="mrw-unit-input"><input type="number" min="0" value={draft.preparationTimeMinutes} onChange={(event) => setDraft({ ...draft, preparationTimeMinutes: event.target.value })}/><span>minutes</span></div></label>
    <label className="mrw-switch"><input type="checkbox" checked={draft.status === "active"} onChange={(event) => setDraft({ ...draft, status: event.target.checked ? "active" : "draft" })}/><span>Recipe active</span></label>
    <section className="mrw-ingredients"><header><div><span>Expected consumption</span><h3>Ingredients</h3></div><small>{ingredients.length} linked</small></header><div className="mrw-ingredient-head"><span>Ingredient</span><span>Quantity</span><span>Unit</span><span>Inventory Link</span><span/></div>{ingredients.map((entry, index) => <div className="mrw-ingredient" key={entry.id ?? `${entry.inventoryItemId}-${index}`}><strong>{inventoryById.get(entry.inventoryItemId)?.name ?? "Inventory ingredient"}</strong><input aria-label="Ingredient quantity" type="number" min="0.0001" step="any" value={entry.quantityRequired} onChange={(event) => setIngredients((rows) => rows.map((row) => row === entry ? { ...row, quantityRequired: event.target.value } : row))}/><select aria-label="Ingredient unit" value={entry.unitId} onChange={(event) => setIngredients((rows) => rows.map((row) => row === entry ? { ...row, unitId: event.target.value } : row))}>{snapshot.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select><em className="mrw-badge linked">Linked</em><button type="button" onClick={() => setIngredients((rows) => rows.filter((row) => row !== entry))}>Remove</button><small>{entry.quantityRequired || "0"} {unitById.get(entry.unitId) ?? "unit"} per sellable item</small></div>)}{!ingredients.length && <div className="mrw-empty compact">No ingredients linked. Add an existing Inventory item below.</div>}<div className="mrw-add"><select aria-label="Select inventory ingredient" value={ingredientId} onChange={(event) => setIngredientId(event.target.value)}><option value="">Select Inventory item...</option>{snapshot.inventoryItems.filter((item) => !ingredients.some((entry) => entry.inventoryItemId === item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" disabled={!ingredientId} onClick={addIngredient}>+ Add Ingredient</button></div></section>
    <div className="mrw-audit-note"><strong>Change record</strong><span>The current backend records the recipe update timestamp but does not expose field-level before/after history.</span></div>
  </div><footer><button type="button" onClick={onClose}>Cancel</button><button type="button" disabled={saving} onClick={() => void save()}>{saving ? "Saving..." : "Save Changes"}</button></footer></aside></div>;
}

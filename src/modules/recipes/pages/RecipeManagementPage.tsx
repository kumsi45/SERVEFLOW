import { useCallback, useEffect, useMemo, useState } from "react";
import { canManageRecipes, type RecipeRole } from "../../../core/permissions/recipeAccess";
import { useTenantRealtime } from "../../../core/realtime/useTenantRealtime";
import {
  archiveRecipe, createRecipe, createRecipeCategory, duplicateRecipe, fetchActiveIngredientUnits, fetchRecipeCost,
  fetchRecipeCategories, fetchRecipeIngredients, fetchRecipes, removeRecipeIngredient,
  restoreRecipe, saveRecipeIngredient, searchActiveInventoryItems, softDeleteRecipe, updateRecipe,
} from "../services/recipeService";
import type {
  IngredientInventoryItem, IngredientUnit, Recipe, RecipeCategory, RecipeCost, RecipeDraft, RecipeFilters,
  RecipeIngredient, RecipeIngredientDraft,
} from "../types";
import "../styles/recipeManagement.css";
import { fetchRecipeMenuUsage, type RecipeMenuUsage } from "../../menu-recipes/services/menuRecipeService";

const emptyDraft: RecipeDraft = { name: "", description: "", categoryId: "", preparationTimeMinutes: "0", yieldQuantity: "1", yieldUnit: "servings", status: "draft" };
const initialFilters: RecipeFilters = { search: "", categoryId: "", status: "all", preparation: "all", sort: "newest", page: 1, pageSize: 12 };
const emptyIngredient = (): RecipeIngredientDraft => ({ inventoryItemId: "", quantityRequired: "", unitId: "", optionalNotes: "", sortOrder: 1000 });

export function RecipeManagementPage({ restaurantId, role }: { restaurantId: string; role: RecipeRole }) {
  const editable = canManageRecipes(role);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [categories, setCategories] = useState<RecipeCategory[]>([]);
  const [filters, setFilters] = useState(initialFilters);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<RecipeDraft>(emptyDraft);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [viewing, setViewing] = useState<Recipe | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [inventoryItems, setInventoryItems] = useState<IngredientInventoryItem[]>([]);
  const [units, setUnits] = useState<IngredientUnit[]>([]);
  const [ingredientDraft, setIngredientDraft] = useState<RecipeIngredientDraft | null>(null);
  const [ingredientSearch, setIngredientSearch] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [recipeCost, setRecipeCost] = useState<RecipeCost | null>(null);
  const [menuUsage, setMenuUsage] = useState<RecipeMenuUsage>({ count: 0, items: [] });

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [page, categoryRows] = await Promise.all([fetchRecipes(restaurantId, filters), fetchRecipeCategories(restaurantId)]);
      setRecipes(page.items); setTotal(page.total); setCategories(categoryRows);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Recipes could not be loaded."); }
    finally { setLoading(false); }
  }, [restaurantId, filters]);
  useEffect(() => { void refresh(); }, [refresh]);
  useTenantRealtime({ channelName: "recipe-management", restaurantId, tables: ["recipes"], refresh });

  const loadDetail = useCallback(async (recipeId: string) => {
    setDetailLoading(true);
    try {
      const [rows, unitRows, cost, usage] = await Promise.all([fetchRecipeIngredients(restaurantId, recipeId), fetchActiveIngredientUnits(restaurantId), fetchRecipeCost(restaurantId, recipeId), fetchRecipeMenuUsage(restaurantId, recipeId)]);
      setIngredients(rows); setUnits(unitRows); setRecipeCost(cost); setMenuUsage(usage);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ingredients could not be loaded."); }
    finally { setDetailLoading(false); }
  }, [restaurantId]);
  const refreshRecipeCosts = useCallback(async () => {
    if (viewing) await loadDetail(viewing.id);
  }, [loadDetail, viewing]);
  useTenantRealtime({ channelName: "recipe-costs", restaurantId, tables: ["inventory_items", "recipe_ingredients"], refresh: refreshRecipeCosts });
  useEffect(() => {
    if (!viewing || !editable) return;
    const timer = window.setTimeout(() => {
      void searchActiveInventoryItems(restaurantId, ingredientSearch).then(setInventoryItems).catch((cause) => setError(cause instanceof Error ? cause.message : "Inventory items could not be loaded."));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [editable, ingredientSearch, restaurantId, viewing]);

  const pages = Math.max(1, Math.ceil(total / filters.pageSize));
  const categoryName = useMemo(() => new Map(categories.map((row) => [row.id, row.name])), [categories]);
  const ingredientCosts = useMemo(() => new Map((recipeCost?.ingredients ?? []).map((row) => [row.id, row])), [recipeCost]);
  const money = (value: number) => new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  function patchFilter(change: Partial<RecipeFilters>) { setFilters((value) => ({ ...value, ...change, page: change.page ?? 1 })); }
  function openCreate() { setEditing(null); setDraft(emptyDraft); setShowEditor(true); }
  function openEdit(recipe: Recipe) { setEditing(recipe); setDraft({ name: recipe.name, description: recipe.description ?? "", categoryId: recipe.category_id ?? "", preparationTimeMinutes: String(recipe.preparation_time_minutes), yieldQuantity: String(recipe.yield_quantity), yieldUnit: recipe.yield_unit, status: recipe.status }); setShowEditor(true); }
  function openDetail(recipe: Recipe) { setViewing(recipe); setIngredientDraft(null); setIngredientSearch(""); void loadDetail(recipe.id); }
  async function run(message: string, operation: () => Promise<unknown>) { setBusy(true); setError(null); try { await operation(); setNotice(message); setShowEditor(false); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Recipe action failed."); } finally { setBusy(false); } }
  async function save() { if (!draft.name.trim() || !draft.yieldUnit.trim() || Number(draft.yieldQuantity) <= 0) { setError("Name, yield quantity, and yield unit are required."); return; } await run(editing ? "Recipe updated." : "Recipe created.", () => editing ? updateRecipe(restaurantId, editing.id, draft) : createRecipe(restaurantId, draft)); }
  async function addCategory() { const name = window.prompt("Category name"); if (name?.trim()) await run("Category created.", () => createRecipeCategory(restaurantId, name.trim())); }
  function editIngredient(row: RecipeIngredient) { setIngredientSearch(row.inventory_item_name); setIngredientDraft({ id: row.id, inventoryItemId: row.inventory_item_id, quantityRequired: String(row.quantity_required), unitId: row.unit_id, optionalNotes: row.optional_notes ?? "", sortOrder: row.sort_order }); }
  async function saveIngredient() {
    if (!viewing || !ingredientDraft) return;
    if (!ingredientDraft.inventoryItemId || !ingredientDraft.unitId || Number(ingredientDraft.quantityRequired) <= 0) { setError("Inventory item, quantity greater than zero, and unit are required."); return; }
    setBusy(true); setError(null);
    try { await saveRecipeIngredient(restaurantId, viewing.id, ingredientDraft); setNotice(ingredientDraft.id ? "Ingredient updated." : "Ingredient added."); setIngredientDraft(null); setIngredientSearch(""); await loadDetail(viewing.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Ingredient could not be saved."); }
    finally { setBusy(false); }
  }
  async function removeIngredient(row: RecipeIngredient) {
    if (!viewing || !window.confirm(`Remove ${row.inventory_item_name}?`)) return;
    setBusy(true); setError(null);
    try { await removeRecipeIngredient(restaurantId, viewing.id, row.id); setNotice("Ingredient removed."); await loadDetail(viewing.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Ingredient could not be removed."); }
    finally { setBusy(false); }
  }

  return <main className="recipe-page">
    <header className="recipe-header"><div><span>Phase 8.3.2</span><h1>Recipe Management</h1><p>Recipe information and raw inventory ingredients.</p></div><div><a href={`/${role === "inventory_officer" ? "inventory" : role}/dashboard`}>Back to dashboard</a>{editable && <button onClick={openCreate}>Create Recipe</button>}</div></header>
    {!editable && <div className="recipe-readonly">Read-only access · Inventory Officers cannot change recipes or ingredients.</div>}
    {(error || notice) && <div className={error ? "recipe-alert error" : "recipe-alert success"}>{error || notice}</div>}
    <section className="recipe-toolbar">
      <input aria-label="Search recipes" placeholder="Search name, code, category, status" value={filters.search} onChange={(event) => patchFilter({ search: event.target.value })} />
      <select aria-label="Category filter" value={filters.categoryId} onChange={(event) => patchFilter({ categoryId: event.target.value })}><option value="">All categories</option>{categories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
      <select aria-label="Status filter" value={filters.status} onChange={(event) => patchFilter({ status: event.target.value })}><option value="all">All statuses</option><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></select>
      <select aria-label="Preparation time filter" value={filters.preparation} onChange={(event) => patchFilter({ preparation: event.target.value })}><option value="all">Any prep time</option><option value="quick">Up to 15 min</option><option value="medium">16–45 min</option><option value="long">Over 45 min</option></select>
      <select aria-label="Sort recipes" value={filters.sort} onChange={(event) => patchFilter({ sort: event.target.value as RecipeFilters["sort"] })}><option value="newest">Newest</option><option value="oldest">Oldest</option></select>
      {editable && <button className="secondary" onClick={() => void addCategory()}>New Category</button>}
    </section>
    <div className="recipe-summary"><strong>{total}</strong> recipes <span>· Page {filters.page} of {pages}</span></div>
    {loading ? <div className="recipe-empty">Loading recipes…</div> : recipes.length === 0 ? <div className="recipe-empty">No recipes match these filters.</div> : <section className="recipe-grid">{recipes.map((recipe) => <article className="recipe-card" key={recipe.id}>
      <header><div><code>{recipe.recipe_code}</code><h2>{recipe.name}</h2></div><span className={`status ${recipe.status}`}>{recipe.status}</span></header>
      <p>{recipe.description || "No description"}</p><dl><div><dt>Category</dt><dd>{recipe.category_name || "Uncategorized"}</dd></div><div><dt>Preparation</dt><dd>{recipe.preparation_time_minutes} min</dd></div><div><dt>Yield</dt><dd>{recipe.yield_quantity} {recipe.yield_unit}</dd></div><div><dt>Updated</dt><dd>{new Date(recipe.updated_at).toLocaleDateString()}</dd></div></dl>
      <footer><button className="secondary" onClick={() => openDetail(recipe)}>View</button>{editable && <><button onClick={() => openEdit(recipe)}>Edit</button><button className="secondary" onClick={() => void run("Recipe and ingredients duplicated.", () => duplicateRecipe(restaurantId, recipe.id))}>Duplicate</button>{recipe.status === "archived" ? <button onClick={() => void run("Recipe restored as draft.", () => restoreRecipe(restaurantId, recipe.id))}>Restore</button> : <button className="secondary" onClick={() => void run("Recipe archived.", () => archiveRecipe(restaurantId, recipe.id))}>Archive</button>}<button className="danger" onClick={() => window.confirm("Soft delete this recipe?") && void run("Recipe deleted.", () => softDeleteRecipe(restaurantId, recipe.id))}>Delete</button></>}</footer>
    </article>)}</section>}
    <nav className="recipe-pagination"><button disabled={filters.page <= 1} onClick={() => patchFilter({ page: filters.page - 1 })}>Previous</button><span>{filters.page} / {pages}</span><button disabled={filters.page >= pages} onClick={() => patchFilter({ page: filters.page + 1 })}>Next</button></nav>
    {showEditor && editable && <div className="recipe-modal" role="dialog" aria-modal="true"><form onSubmit={(event) => { event.preventDefault(); void save(); }}><header><h2>{editing ? "Edit Recipe" : "Create Recipe"}</h2><button type="button" className="secondary" onClick={() => setShowEditor(false)}>Close</button></header><label>Name<input required maxLength={160} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>Description<textarea maxLength={2000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><label>Category<select value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}><option value="">Uncategorized</option>{categories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><div className="recipe-form-row"><label>Preparation minutes<input type="number" min="0" max="10080" value={draft.preparationTimeMinutes} onChange={(event) => setDraft({ ...draft, preparationTimeMinutes: event.target.value })} /></label><label>Yield quantity<input required type="number" min="0.001" step="0.001" value={draft.yieldQuantity} onChange={(event) => setDraft({ ...draft, yieldQuantity: event.target.value })} /></label></div><div className="recipe-form-row"><label>Yield unit<input required maxLength={40} value={draft.yieldUnit} onChange={(event) => setDraft({ ...draft, yieldUnit: event.target.value })} /></label><label>Status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as RecipeDraft["status"] })}><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></select></label></div><button disabled={busy} type="submit">{busy ? "Saving…" : "Save Recipe"}</button></form></div>}
    {viewing && <div className="recipe-modal" role="dialog" aria-modal="true"><article className="recipe-detail ingredient-detail"><header><div><code>{viewing.recipe_code}</code><h2>{viewing.name}</h2></div><button className="secondary" onClick={() => setViewing(null)}>Close</button></header>
      <section><h3>Recipe Information</h3><p>{viewing.description || "No description"}</p><dl><div><dt>Category</dt><dd>{categoryName.get(viewing.category_id ?? "") || "Uncategorized"}</dd></div><div><dt>Status</dt><dd>{viewing.status}</dd></div><div><dt>Created by</dt><dd>{viewing.created_by || "Staff"}</dd></div><div><dt>Created</dt><dd>{new Date(viewing.created_at).toLocaleString()}</dd></div></dl></section>
      <section><h3>Preparation</h3><dl><div><dt>Preparation time</dt><dd>{viewing.preparation_time_minutes} minutes</dd></div><div><dt>Yield</dt><dd>{viewing.yield_quantity} {viewing.yield_unit}</dd></div></dl></section>
      <section className="ingredient-section"><header><div><h3>Ingredients</h3><p>Raw inventory required for one serving.</p></div>{editable && !ingredientDraft && <button onClick={() => setIngredientDraft(emptyIngredient())}>Add Ingredient</button>}</header>
        {detailLoading ? <div className="recipe-empty">Loading ingredients…</div> : ingredients.length === 0 ? <div className="recipe-empty">No ingredients added.</div> : <div className="ingredient-list costed">{ingredients.map((row) => { const cost = ingredientCosts.get(row.id); return <article key={row.id}><div><strong>{row.inventory_item_name}</strong>{row.optional_notes && <small>{row.optional_notes}</small>}</div><span>{row.quantity_required} {row.unit_name}</span><span className="ingredient-unit-cost">{cost?.unit_cost == null ? "Cost unavailable" : `${money(cost.unit_cost)} ETB / ${row.unit_name}`}</span><strong className="ingredient-line-cost">{cost?.ingredient_cost == null ? "—" : `${money(cost.ingredient_cost)} ETB`}</strong>{editable && <div><button className="secondary" onClick={() => editIngredient(row)}>Edit</button><button className="danger" onClick={() => void removeIngredient(row)}>Remove</button></div>}</article>; })}</div>}
        {editable && ingredientDraft && <form className="ingredient-form" onSubmit={(event) => { event.preventDefault(); void saveIngredient(); }}>
          <label>Search Inventory Item<input autoFocus placeholder="Search active inventory items" value={ingredientSearch} onChange={(event) => setIngredientSearch(event.target.value)} /></label>
          <label>Inventory Item<select required value={ingredientDraft.inventoryItemId} onChange={(event) => { const item = inventoryItems.find((row) => row.id === event.target.value); setIngredientDraft({ ...ingredientDraft, inventoryItemId: event.target.value, unitId: item?.unit_id ?? ingredientDraft.unitId }); }}><option value="">Choose inventory item</option>{inventoryItems.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <div className="recipe-form-row"><label>Quantity<input required type="number" min="0.001" step="0.001" value={ingredientDraft.quantityRequired} onChange={(event) => setIngredientDraft({ ...ingredientDraft, quantityRequired: event.target.value })} /></label><label>Unit<select required value={ingredientDraft.unitId} onChange={(event) => setIngredientDraft({ ...ingredientDraft, unitId: event.target.value })}><option value="">Choose unit</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.description ? ` (${unit.description})` : ""}</option>)}</select></label></div>
          <label>Notes (optional)<textarea maxLength={500} value={ingredientDraft.optionalNotes} onChange={(event) => setIngredientDraft({ ...ingredientDraft, optionalNotes: event.target.value })} /></label>
          <footer><button disabled={busy} type="submit">{busy ? "Saving…" : "Save Ingredient"}</button><button type="button" className="secondary" onClick={() => setIngredientDraft(null)}>Cancel</button></footer>
        </form>}
      </section>
      <section className="recipe-cost-summary"><span>Recipe Cost</span><strong>{recipeCost?.complete ? `${money(recipeCost.total_cost)} ${recipeCost.currency}` : "Cost unavailable"}</strong><p>Calculated automatically from current inventory purchase prices.</p></section>
      <section className="recipe-used-by"><h3>Used By</h3><strong>{menuUsage.count} Menu Item{menuUsage.count === 1 ? "" : "s"}</strong>{menuUsage.items.length === 0 ? <p>Not linked to a menu item.</p> : <div>{menuUsage.items.map((item) => role === "inventory_officer" ? <span key={item.id}>{item.name}</span> : <a key={item.id} href={`/${role}/menu?item=${item.id}`}>{item.name}</a>)}</div>}</section>
    </article></div>}
  </main>;
}

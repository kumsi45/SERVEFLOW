import { useCallback, useEffect, useMemo, useState } from "react";
import { canManageRecipes, type RecipeRole } from "../../../core/permissions/recipeAccess";
import { useTenantRealtime } from "../../../core/realtime/useTenantRealtime";
import { archiveRecipe, createRecipe, createRecipeCategory, duplicateRecipe, fetchRecipeCategories, fetchRecipes, restoreRecipe, softDeleteRecipe, updateRecipe } from "../services/recipeService";
import type { Recipe, RecipeCategory, RecipeDraft, RecipeFilters } from "../types";
import "../styles/recipeManagement.css";

const emptyDraft: RecipeDraft = { name: "", description: "", categoryId: "", preparationTimeMinutes: "0", yieldQuantity: "1", yieldUnit: "servings", status: "draft" };
const initialFilters: RecipeFilters = { search: "", categoryId: "", status: "all", preparation: "all", sort: "newest", page: 1, pageSize: 12 };

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

  const pages = Math.max(1, Math.ceil(total / filters.pageSize));
  const categoryName = useMemo(() => new Map(categories.map((row) => [row.id, row.name])), [categories]);
  function patchFilter(change: Partial<RecipeFilters>) { setFilters((value) => ({ ...value, ...change, page: change.page ?? 1 })); }
  function openCreate() { setEditing(null); setDraft(emptyDraft); setShowEditor(true); }
  function openEdit(recipe: Recipe) { setEditing(recipe); setDraft({ name: recipe.name, description: recipe.description ?? "", categoryId: recipe.category_id ?? "", preparationTimeMinutes: String(recipe.preparation_time_minutes), yieldQuantity: String(recipe.yield_quantity), yieldUnit: recipe.yield_unit, status: recipe.status }); setShowEditor(true); }
  async function run(message: string, operation: () => Promise<unknown>) { setBusy(true); setError(null); try { await operation(); setNotice(message); setShowEditor(false); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Recipe action failed."); } finally { setBusy(false); } }
  async function save() { if (!draft.name.trim() || !draft.yieldUnit.trim() || Number(draft.yieldQuantity) <= 0) { setError("Name, yield quantity, and yield unit are required."); return; } await run(editing ? "Recipe updated." : "Recipe created.", () => editing ? updateRecipe(restaurantId, editing.id, draft) : createRecipe(restaurantId, draft)); }
  async function addCategory() { const name = window.prompt("Category name"); if (name?.trim()) await run("Category created.", () => createRecipeCategory(restaurantId, name.trim())); }

  return <main className="recipe-page">
    <header className="recipe-header"><div><span>Phase 8.3.1</span><h1>Recipe Management</h1><p>Independent recipe records and lifecycle management.</p></div><div><a href={`/${role === "inventory_officer" ? "inventory" : role}/dashboard`}>Back to dashboard</a>{editable && <button onClick={openCreate}>Create Recipe</button>}</div></header>
    {!editable && <div className="recipe-readonly">Read-only access · Inventory Officers cannot change recipes.</div>}
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
      <footer><button className="secondary" onClick={() => setViewing(recipe)}>View</button>{editable && <><button onClick={() => openEdit(recipe)}>Edit</button><button className="secondary" onClick={() => void run("Recipe duplicated.", () => duplicateRecipe(restaurantId, recipe.id))}>Duplicate</button>{recipe.status === "archived" ? <button onClick={() => void run("Recipe restored as draft.", () => restoreRecipe(restaurantId, recipe.id))}>Restore</button> : <button className="secondary" onClick={() => void run("Recipe archived.", () => archiveRecipe(restaurantId, recipe.id))}>Archive</button>}<button className="danger" onClick={() => window.confirm("Soft delete this recipe?") && void run("Recipe deleted.", () => softDeleteRecipe(restaurantId, recipe.id))}>Delete</button></>}</footer>
    </article>)}</section>}
    <nav className="recipe-pagination"><button disabled={filters.page <= 1} onClick={() => patchFilter({ page: filters.page - 1 })}>Previous</button><span>{filters.page} / {pages}</span><button disabled={filters.page >= pages} onClick={() => patchFilter({ page: filters.page + 1 })}>Next</button></nav>
    {showEditor && editable && <div className="recipe-modal" role="dialog" aria-modal="true"><form onSubmit={(event) => { event.preventDefault(); void save(); }}><header><h2>{editing ? "Edit Recipe" : "Create Recipe"}</h2><button type="button" className="secondary" onClick={() => setShowEditor(false)}>Close</button></header><label>Name<input required maxLength={160} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>Description<textarea maxLength={2000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><label>Category<select value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}><option value="">Uncategorized</option>{categories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><div className="recipe-form-row"><label>Preparation minutes<input type="number" min="0" max="10080" value={draft.preparationTimeMinutes} onChange={(event) => setDraft({ ...draft, preparationTimeMinutes: event.target.value })} /></label><label>Yield quantity<input required type="number" min="0.001" step="0.001" value={draft.yieldQuantity} onChange={(event) => setDraft({ ...draft, yieldQuantity: event.target.value })} /></label></div><div className="recipe-form-row"><label>Yield unit<input required maxLength={40} value={draft.yieldUnit} onChange={(event) => setDraft({ ...draft, yieldUnit: event.target.value })} /></label><label>Status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as RecipeDraft["status"] })}><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></select></label></div><button disabled={busy} type="submit">{busy ? "Saving…" : "Save Recipe"}</button></form></div>}
    {viewing && <div className="recipe-modal" role="dialog" aria-modal="true"><article className="recipe-detail"><header><div><code>{viewing.recipe_code}</code><h2>{viewing.name}</h2></div><button className="secondary" onClick={() => setViewing(null)}>Close</button></header><p>{viewing.description || "No description"}</p><dl><div><dt>Category</dt><dd>{categoryName.get(viewing.category_id ?? "") || "Uncategorized"}</dd></div><div><dt>Status</dt><dd>{viewing.status}</dd></div><div><dt>Preparation</dt><dd>{viewing.preparation_time_minutes} minutes</dd></div><div><dt>Yield</dt><dd>{viewing.yield_quantity} {viewing.yield_unit}</dd></div><div><dt>Created by</dt><dd>{viewing.created_by || "Staff"}</dd></div><div><dt>Created</dt><dd>{new Date(viewing.created_at).toLocaleString()}</dd></div></dl></article></div>}
  </main>;
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canManageRecipes, type RecipeRole } from "../../../core/permissions/recipeAccess";
import { useTenantRealtime } from "../../../core/realtime/useTenantRealtime";
import { loadInventoryAdminData, saveItem } from "../../inventory/services/inventoryAdminService";
import type { InventoryAdminData, InventoryItemDraft } from "../../inventory/types";
import { fetchMenuRecipeLinks, linkMenuItemRecipe, type MenuRecipeLink } from "../../menu-recipes/services/menuRecipeService";
import {
  createRecipe, fetchRecipeIngredients, fetchRecipes,
  removeRecipeIngredient, saveRecipeIngredient, searchActiveInventoryItems, softDeleteRecipe, updateRecipe,
} from "../services/recipeService";
import type { IngredientInventoryItem, Recipe, RecipeDraft, RecipeFilters, RecipeIngredient, RecipeIngredientDraft } from "../types";
import "../styles/recipeManagement.css";

type WizardStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;
const hiddenV1Defaults = { description: "", categoryId: "", yieldQuantity: "1", yieldUnit: "serving" };
const newRecipeDraft = (name = ""): RecipeDraft => ({ ...hiddenV1Defaults, name, preparationTimeMinutes: "", status: "active" });
const filters: RecipeFilters = { search: "", categoryId: "", status: "all", preparation: "all", sort: "newest", page: 1, pageSize: 100 };
const hiddenIngredientDefaults = (item: IngredientInventoryItem, sortOrder: number): RecipeIngredientDraft => ({ inventoryItemId: item.id, quantityRequired: "1", unitId: item.unit_id, optionalNotes: "", sortOrder });
const inventoryDraft = (data: InventoryAdminData): InventoryItemDraft => ({
  name: "", categoryId: data.categories.find((row) => row.status === "active")?.id ?? "",
  unitId: data.units.find((row) => row.status === "active")?.id ?? "",
  storageLocationId: data.storageLocations.find((row) => row.status === "active")?.id ?? "",
  preferredSupplierId: "", sku: "", barcode: "", minimumStock: "0", maximumStock: "",
  purchasePrice: "0", description: "",
});

export function RecipeManagementPage({ restaurantId, role }: { restaurantId: string; role: RecipeRole }) {
  const editable = canManageRecipes(role);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [menuItems, setMenuItems] = useState<MenuRecipeLink[]>([]);
  const [inventoryItems, setInventoryItems] = useState<IngredientInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [viewing, setViewing] = useState<Recipe | null>(null);
  const [detailIngredients, setDetailIngredients] = useState<RecipeIngredient[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [step, setStep] = useState<WizardStep>(0);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [selectedMenu, setSelectedMenu] = useState<MenuRecipeLink | null>(null);
  const [draft, setDraft] = useState<RecipeDraft>(newRecipeDraft());
  const [menuSearch, setMenuSearch] = useState("");
  const [ingredientSearch, setIngredientSearch] = useState("");
  const [ingredientDraft, setIngredientDraft] = useState<RecipeIngredientDraft | null>(null);
  const [pendingIngredients, setPendingIngredients] = useState<RecipeIngredientDraft[]>([]);
  const [originalIngredientIds, setOriginalIngredientIds] = useState<string[]>([]);
  const [adminData, setAdminData] = useState<InventoryAdminData | null>(null);
  const [newInventoryItem, setNewInventoryItem] = useState<InventoryItemDraft | null>(null);
  const handledEditTarget = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [page, menu, inventory] = await Promise.all([
        fetchRecipes(restaurantId, filters), fetchMenuRecipeLinks(restaurantId),
        searchActiveInventoryItems(restaurantId, ""),
      ]);
      setRecipes(page.items); setMenuItems(menu); setInventoryItems(inventory);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Menu recipes could not be loaded."); }
    finally { setLoading(false); }
  }, [restaurantId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useTenantRealtime({ channelName: "menu-recipe-management", restaurantId, tables: ["recipes", "menu_items"], refresh });
  useTenantRealtime({ channelName: "recipe-costs", restaurantId, tables: ["inventory_items", "recipe_ingredients"], refresh });

  useEffect(() => {
    if (step !== 3) return;
    const timer = window.setTimeout(() => {
      void searchActiveInventoryItems(restaurantId, ingredientSearch).then(setInventoryItems)
        .catch((cause) => setError(cause instanceof Error ? cause.message : "Ingredients could not be loaded."));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [ingredientSearch, restaurantId, step]);

  const recipeById = useMemo(() => new Map(recipes.map((recipe) => [recipe.id, recipe])), [recipes]);
  const menuByRecipe = useMemo(() => new Map(menuItems.filter((item) => item.recipe_id).map((item) => [item.recipe_id!, item])), [menuItems]);
  const visibleRecipes = useMemo(() => menuItems.filter((item) => item.recipe_id && recipeById.has(item.recipe_id)).filter((item) => {
    const recipe = recipeById.get(item.recipe_id!);
    return `${item.name} ${item.category_name ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()) && (statusFilter === "all" || recipe?.status === statusFilter);
  }), [menuItems, recipeById, search, statusFilter]);
  const menuChoices = useMemo(() => menuItems.filter((item) => item.recipe_id && recipeById.has(item.recipe_id)).filter((item) => `${item.name} ${item.category_name ?? ""}`.toLowerCase().includes(menuSearch.trim().toLowerCase())), [menuItems, menuSearch, recipeById]);
  const inventoryById = useMemo(() => new Map(inventoryItems.map((item) => [item.id, item])), [inventoryItems]);
  const money = (value: number) => new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

  useEffect(() => {
    if (handledEditTarget.current || recipes.length === 0) return;
    const targetId = new URLSearchParams(window.location.search).get("edit");
    if (!targetId) return;
    const target = recipes.find((recipe) => recipe.id === targetId && menuByRecipe.has(recipe.id));
    if (!target) return;
    handledEditTarget.current = true;
    window.history.replaceState({}, "", window.location.pathname);
    void startEdit(target);
  }, [menuByRecipe, recipes]);

  function resetWizard() {
    setStep(0); setEditing(null); setSelectedMenu(null); setDraft(newRecipeDraft());
    setPendingIngredients([]); setOriginalIngredientIds([]); setIngredientDraft(null);
    setMenuSearch(""); setIngredientSearch(""); setNewInventoryItem(null);
  }
  function startCreate() { resetWizard(); setStep(1); }
  function chooseMenu(item: MenuRecipeLink) {
    const recipe = item.recipe_id ? recipeById.get(item.recipe_id) : null;
    if (recipe) { void startEdit(recipe); return; }
    setSelectedMenu(item); setDraft(newRecipeDraft(item.name)); setStep(2);
  }
  async function startEdit(recipe: Recipe) {
    const menu = menuByRecipe.get(recipe.id) ?? null;
    setEditing(recipe); setSelectedMenu(menu);
    setDraft({ ...hiddenV1Defaults, name: recipe.name, preparationTimeMinutes: String(recipe.preparation_time_minutes), status: recipe.status === "archived" ? "draft" : recipe.status });
    setPendingIngredients([]); setOriginalIngredientIds([]); setIngredientDraft(null); setBusy(true);
    try {
      const rows = await fetchRecipeIngredients(restaurantId, recipe.id);
      setPendingIngredients(rows.map((row) => ({ id: row.id, inventoryItemId: row.inventory_item_id, quantityRequired: String(row.quantity_required), unitId: row.unit_id, optionalNotes: "", sortOrder: row.sort_order })));
      setOriginalIngredientIds(rows.map((row) => row.id)); setStep(2);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Recipe could not be opened."); }
    finally { setBusy(false); }
  }
  function addPendingIngredient(item: IngredientInventoryItem) {
    if (pendingIngredients.some((row) => row.inventoryItemId === item.id)) return setError("This ingredient is already in the recipe.");
    setPendingIngredients((rows) => [...rows, hiddenIngredientDefaults(item, (rows.length + 1) * 100)]);
    setIngredientDraft(null); setIngredientSearch(""); setError(null);
  }
  async function saveRecipe() {
    if (!draft.name.trim()) return setError("Recipe name is required.");
    if (Number(draft.preparationTimeMinutes) < 0 || draft.preparationTimeMinutes === "") return setError("Preparation time is required.");
    setBusy(true); setError(null);
    try {
      let recipe: Recipe;
      if (editing) {
        recipe = await updateRecipe(restaurantId, editing.id, draft);
      } else {
        const creationDraft = draft.status === "draft" ? { ...draft, status: "active" as const } : draft;
        recipe = await createRecipe(restaurantId, creationDraft);
        if (selectedMenu) await linkMenuItemRecipe(restaurantId, selectedMenu.id, recipe.id);
        if (draft.status === "draft") recipe = await updateRecipe(restaurantId, recipe.id, draft);
      }
      for (const ingredientId of originalIngredientIds.filter((id) => !pendingIngredients.some((row) => row.id === id))) {
        await removeRecipeIngredient(restaurantId, recipe.id, ingredientId);
      }
      for (const ingredient of pendingIngredients) await saveRecipeIngredient(restaurantId, recipe.id, ingredient);
      resetWizard(); setNotice(editing ? "Recipe updated." : "Recipe created."); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Recipe could not be saved."); }
    finally { setBusy(false); }
  }
  async function openDetail(recipe: Recipe) {
    setViewing(recipe); setDetailLoading(true);
    try { setDetailIngredients(await fetchRecipeIngredients(restaurantId, recipe.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Recipe details could not be loaded."); }
    finally { setDetailLoading(false); }
  }
  async function beginInlineIngredient() {
    try { const data = await loadInventoryAdminData(restaurantId); setAdminData(data); setNewInventoryItem(inventoryDraft(data)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Ingredient form could not be opened."); }
  }
  async function createInlineIngredient() {
    if (!adminData || !newInventoryItem) return;
    setBusy(true);
    try {
      await saveItem(restaurantId, newInventoryItem, adminData);
      const results = await searchActiveInventoryItems(restaurantId, newInventoryItem.name);
      const created = results.find((item) => item.name.toLowerCase() === newInventoryItem.name.trim().toLowerCase());
      if (!created) throw new Error("Ingredient was created but could not be selected.");
      setInventoryItems(results); addPendingIngredient(created);
      setIngredientSearch(created.name); setNewInventoryItem(null); setNotice("Ingredient created and added.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ingredient could not be created."); }
    finally { setBusy(false); }
  }

  return <main className="recipe-page recipe-v1">
    <header className="recipe-header"><div><span>Inventory • Menu Recipes</span><h1>Menu Recipes</h1><p>Choose a menu item, select its ingredients, and set preparation time.</p></div><div><a href={`/${role === "inventory_officer" ? "inventory" : role}/dashboard`}>Dashboard</a>{editable && <button onClick={startCreate}>Set Up Recipe</button>}</div></header>
    {!editable && <div className="recipe-readonly">Read-only access • Recipe changes are limited to owners and managers.</div>}
    {(error || notice) && <div role="status" className={error ? "recipe-alert error" : "recipe-alert success"}>{error || notice}<button aria-label="Dismiss message" onClick={() => { setError(null); setNotice(null); }}>×</button></div>}

    <section className="recipe-kpis v1-kpis"><div><span>Recipe-Tracked Menu Items</span><strong>{visibleRecipes.length}</strong></div><div><span>Active Recipes</span><strong>{recipes.filter((recipe) => recipe.status === "active" && menuByRecipe.has(recipe.id)).length}</strong></div></section>
    <section className="recipe-toolbar"><input aria-label="Search recipes" placeholder="Search recipes" value={search} onChange={(event) => setSearch(event.target.value)} /><button className="secondary" onClick={() => setShowFilters((value) => !value)}>{showFilters ? "Hide Filters" : "Filters"}</button>{showFilters && <div className="recipe-filter-panel v1-filter"><select aria-label="Recipe status filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="draft">Draft</option></select></div>}</section>
    {loading ? <div className="recipe-empty">Loading recipes…</div> : visibleRecipes.length === 0 ? <div className="recipe-empty"><strong>No Recipe-Tracked Menu Items</strong><p>Choose Recipe as the stock tracking type when creating a menu item.</p></div> : <section className="recipe-grid">{visibleRecipes.map((menu) => { const recipe = recipeById.get(menu.recipe_id!)!; return <article className="recipe-card" key={menu.id} onClick={() => editable ? void startEdit(recipe) : void openDetail(recipe)}>{menu.image_url ? <img src={menu.image_url} alt="" loading="lazy" /> : <div className="recipe-image-placeholder">{menu.name.slice(0, 1)}</div>}<div className="recipe-card-body"><header><div><small>{menu.category_name ?? "Uncategorized"}</small><h2>{recipe.name}</h2></div><span className={`status ${recipe.status}`}>{recipe.status}</span></header><p className="recipe-menu-price">{money(menu.price)} ETB</p><footer><button onClick={(event) => { event.stopPropagation(); void openDetail(recipe); }}>View</button>{editable && <button className="secondary" onClick={(event) => { event.stopPropagation(); void startEdit(recipe); }}>Add Ingredients</button>}</footer></div></article>; })}</section>}

    {step > 0 && editable && <div className="recipe-modal" role="dialog" aria-modal="true"><section className="recipe-builder v1-builder"><header><div><small>{editing ? "Edit Recipe" : `Create Recipe • Step ${step} of 6`}</small><h2>{step === 1 ? "Select Menu Item" : step === 2 ? "Recipe Name" : step === 3 ? "Ingredients" : step === 4 ? "Preparation Time" : step === 5 ? "Status" : "Save Recipe"}</h2></div><button className="secondary" onClick={resetWizard}>Cancel</button></header><div className="wizard-progress">{[1,2,3,4,5,6].map((number) => <span key={number} className={step >= number ? "active" : ""} />)}</div>
      {step === 1 && <><input autoFocus aria-label="Search menu items" placeholder="Search menu items" value={menuSearch} onChange={(event) => setMenuSearch(event.target.value)} /><div className="menu-picker-list v1-menu-list">{menuChoices.map((item) => <button key={item.id} onClick={() => chooseMenu(item)}>{item.image_url ? <img src={item.image_url} alt="" loading="lazy" /> : <span>{item.name.slice(0, 1)}</span>}<div><strong>{item.name}</strong><small>{item.category_name ?? "Uncategorized"} • {money(item.price)} ETB</small></div><b>Choose →</b></button>)}{menuChoices.length === 0 && <div className="recipe-empty">No available menu items match.</div>}</div></>}
      {step === 2 && <div className="wizard-screen"><div className="selected-menu compact">{selectedMenu?.image_url ? <img src={selectedMenu.image_url} alt="" /> : <span>{selectedMenu?.name.slice(0,1) ?? draft.name.slice(0,1)}</span>}<div><small>{selectedMenu?.category_name}</small><strong>{selectedMenu?.name ?? draft.name}</strong></div></div><label>Recipe Name<input autoFocus required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><button className="wizard-next" disabled={!draft.name.trim()} onClick={() => setStep(3)}>Continue</button></div>}
      {step === 3 && <div className="wizard-screen ingredients-step"><div className="pending-ingredients">{pendingIngredients.map((row, index) => <article key={row.id ?? `${row.inventoryItemId}-${index}`}><strong>{inventoryById.get(row.inventoryItemId)?.name ?? "Inventory ingredient"}</strong><button className="danger" onClick={() => setPendingIngredients((rows) => rows.filter((candidate) => candidate !== row))}>Remove</button></article>)}{pendingIngredients.length === 0 && <div className="recipe-empty compact-empty">No ingredients selected yet.</div>}</div>{ingredientDraft ? <div className="ingredient-form ingredient-choice-only"><label>Search Ingredient<input autoFocus value={ingredientSearch} onChange={(event) => setIngredientSearch(event.target.value)} placeholder="Search inventory ingredients" /></label><div className="ingredient-picker-list">{inventoryItems.map((item) => <button type="button" disabled={pendingIngredients.some((row) => row.inventoryItemId === item.id)} key={item.id} onClick={() => addPendingIngredient(item)}><strong>{item.name}</strong><small>{pendingIngredients.some((row) => row.inventoryItemId === item.id) ? "Added" : "Tap to add"}</small></button>)}</div><button type="button" className="create-inline" onClick={() => void beginInlineIngredient()}>+ Create Ingredient</button><button type="button" className="secondary" onClick={() => setIngredientDraft(null)}>Done</button></div> : <button className="add-ingredient-button" onClick={() => setIngredientDraft({ inventoryItemId: "picker", quantityRequired: "1", unitId: "hidden", optionalNotes: "", sortOrder: 0 })}>+ Add Ingredient</button>}<footer className="wizard-nav"><button className="secondary" onClick={() => setStep(2)}>Back</button><button className="wizard-next" onClick={() => setStep(4)}>Continue</button></footer></div>}
      {step === 4 && <div className="wizard-screen single-field"><label>Preparation Time<div className="minute-field"><input autoFocus type="number" min="0" required placeholder="20" value={draft.preparationTimeMinutes} onChange={(event) => setDraft({ ...draft, preparationTimeMinutes: event.target.value })} /><span>Minutes</span></div></label><footer className="wizard-nav"><button className="secondary" onClick={() => setStep(3)}>Back</button><button className="wizard-next" disabled={draft.preparationTimeMinutes === "" || Number(draft.preparationTimeMinutes) < 0} onClick={() => setStep(5)}>Continue</button></footer></div>}
      {step === 5 && <div className="wizard-screen"><div className="status-choice"><button className={draft.status === "draft" ? "selected" : ""} onClick={() => setDraft({ ...draft, status: "draft" })}><strong>Draft</strong><small>Finish it later</small></button><button className={draft.status === "active" ? "selected" : ""} onClick={() => setDraft({ ...draft, status: "active" })}><strong>Active</strong><small>Ready to use</small></button></div><footer className="wizard-nav"><button className="secondary" onClick={() => setStep(4)}>Back</button><button className="wizard-next" onClick={() => setStep(6)}>Continue</button></footer></div>}
      {step === 6 && <div className="wizard-screen save-screen"><div className="save-review"><strong>{draft.name}</strong><span>{pendingIngredients.length} ingredient{pendingIngredients.length === 1 ? "" : "s"}</span><span>{draft.preparationTimeMinutes} minutes</span><span className={`status ${draft.status}`}>{draft.status}</span></div><button className="save-recipe-button" disabled={busy} onClick={() => void saveRecipe()}>{busy ? "Saving…" : "Save Recipe"}</button><button className="secondary" onClick={resetWizard}>Cancel</button></div>}
    </section></div>}

    {viewing && <div className="recipe-modal" role="dialog" aria-modal="true"><article className="recipe-detail v1-detail"><header><div><small>{menuByRecipe.get(viewing.id)?.category_name ?? "Menu Recipe"}</small><h2>{viewing.name}</h2></div><button className="secondary" onClick={() => setViewing(null)}>Close</button></header><section><dl><div><dt>Preparation Time</dt><dd>{viewing.preparation_time_minutes} minutes</dd></div><div><dt>Status</dt><dd><span className={`status ${viewing.status}`}>{viewing.status}</span></dd></div></dl></section><section className="ingredient-section"><header><h3>Ingredients</h3></header>{detailLoading ? <div className="recipe-empty">Loading ingredients…</div> : <div className="simple-ingredient-list">{detailIngredients.map((row) => <div key={row.id}><strong>{row.inventory_item_name}</strong></div>)}{detailIngredients.length === 0 && <div className="recipe-empty compact-empty">No ingredients added.</div>}</div>}</section>{editable && <footer className="detail-actions"><button onClick={() => { setViewing(null); void startEdit(viewing); }}>Edit Recipe</button><button className="danger" onClick={() => window.confirm("Delete this recipe? The menu item will remain.") && void (async () => { setBusy(true); try { await softDeleteRecipe(restaurantId, viewing.id); setViewing(null); setNotice("Recipe deleted. Menu item preserved."); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Recipe could not be deleted."); } finally { setBusy(false); } })()}>Delete Recipe</button></footer>}</article></div>}

    {newInventoryItem && adminData && <div className="nested-modal"><form onSubmit={(event) => { event.preventDefault(); void createInlineIngredient(); }}><header><h3>Create Ingredient</h3><button type="button" className="secondary" onClick={() => setNewInventoryItem(null)}>Close</button></header><p>Create the ingredient now. Inventory staff can complete its operational setup later.</p><label>Ingredient Name<input autoFocus required value={newInventoryItem.name} onChange={(event) => setNewInventoryItem({ ...newInventoryItem, name: event.target.value })} /></label><button disabled={busy || !newInventoryItem.categoryId || !newInventoryItem.unitId || !newInventoryItem.storageLocationId}>Create & Add</button></form></div>}
  </main>;
}

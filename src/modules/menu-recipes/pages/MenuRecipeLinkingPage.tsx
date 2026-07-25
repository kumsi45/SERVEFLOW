import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMenuRecipeLinks, linkMenuItemRecipe, searchActiveMenuRecipes, type MenuRecipeLink, type MenuRecipeOption } from "../services/menuRecipeService";
import "../styles/menuRecipeLinking.css";

export function MenuRecipeLinkingPage({ restaurantId, editable = true }: { restaurantId: string; editable?: boolean }) {
  const [items, setItems] = useState<MenuRecipeLink[]>([]);
  const [recipes, setRecipes] = useState<MenuRecipeOption[]>([]);
  const [search, setSearch] = useState("");
  const [recipeSearch, setRecipeSearch] = useState("");
  const [editing, setEditing] = useState<MenuRecipeLink | null>(null);
  const [selectedRecipe, setSelectedRecipe] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => setItems(await fetchMenuRecipeLinks(restaurantId)), [restaurantId]);
  useEffect(() => { void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Menu links could not be loaded.")); }, [refresh]);
  useEffect(() => {
    if (!editing) return;
    const timer = window.setTimeout(() => void searchActiveMenuRecipes(restaurantId, recipeSearch).then(setRecipes).catch((error) => setMessage(error instanceof Error ? error.message : "Recipes could not be loaded.")), 180);
    return () => window.clearTimeout(timer);
  }, [editing, recipeSearch, restaurantId]);
  const filtered = useMemo(() => items.filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase())), [items, search]);

  function open(item: MenuRecipeLink) { setEditing(item); setSelectedRecipe(item.recipe_id ?? ""); setRecipeSearch(item.recipe_name ?? ""); setMessage(null); }
  useEffect(() => {
    const targetId = new URLSearchParams(window.location.search).get("item");
    if (!targetId || editing) return;
    const target = items.find((item) => item.id === targetId);
    if (target) { window.history.replaceState({}, "", window.location.pathname); open(target); }
  }, [editing, items]);
  async function save() {
    if (!editing) return;
    setBusy(true); setMessage(null);
    try { await linkMenuItemRecipe(restaurantId, editing.id, selectedRecipe || null); setEditing(null); setMessage("Menu recipe link updated."); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Menu recipe link could not be saved."); }
    finally { setBusy(false); }
  }

  return <section className="mrl-page"><header><div><span>Menu Management</span><h1>Menu Recipes</h1><p>Connect each sellable menu item to its production recipe.</p></div></header>
    {message && <div className="mrl-alert">{message}</div>}
    <input className="mrl-search" aria-label="Search menu items" placeholder="Search menu items" value={search} onChange={(event) => setSearch(event.target.value)} />
    <div className="mrl-list">{filtered.map((item) => <article key={item.id}><div><strong>{item.name}</strong><small>{item.available ? "Sellable" : "Unavailable"}</small></div><div>{item.recipe_id ? <><strong>{item.recipe_name ?? "Linked Recipe"}</strong><span className="mrl-linked">Linked</span></> : <><span>No Recipe Assigned</span><span className="mrl-warning">Recipe Required</span></>}</div>{editable && <button type="button" onClick={() => open(item)}>Edit Recipe</button>}</article>)}</div>
    {editing && <div className="mrl-modal" role="dialog" aria-modal="true"><form onSubmit={(event) => { event.preventDefault(); void save(); }}><header><div><span>Menu Item</span><h2>{editing.name}</h2></div><button type="button" className="secondary" onClick={() => setEditing(null)}>Close</button></header><label>Search Recipe<input autoFocus value={recipeSearch} onChange={(event) => setRecipeSearch(event.target.value)} placeholder="Search active recipes" /></label><label>Recipe<select value={selectedRecipe} onChange={(event) => setSelectedRecipe(event.target.value)}><option value="">No Recipe Assigned</option>{recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name} ({recipe.recipe_code})</option>)}</select></label>{!selectedRecipe && <div className="mrl-warning">Recipe Required — saving without one is allowed for bottled drinks.</div>}<button disabled={busy} type="submit">{busy ? "Saving…" : "Save Link"}</button></form></div>}
  </section>;
}

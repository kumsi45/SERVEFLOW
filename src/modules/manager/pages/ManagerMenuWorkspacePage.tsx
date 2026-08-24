import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { CurrencyConfig } from "../../../core/format/currency";
import { formatCurrency } from "../../../core/format/currency";
import { useTenantRealtime } from "../../../core/realtime/useTenantRealtime";
import {
  loadManagerMenu, setManagerMenuItemAvailability, updateManagerMenuItem,
  type ManagerMenuItem, type ManagerMenuSnapshot,
} from "../services/managerMenuService";
import "../styles/managerMenuWorkspace.css";
import { managerFacingMessage } from "../managerPresentation";

type Props = { restaurantId: string; restaurantName: string; managerName: string; currency?: CurrencyConfig };
type Tab = "overview" | "items" | "categories" | "preview";
type AvailabilityFilter = "all" | "available" | "hidden" | "recipe";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" }, { id: "items", label: "Menu Items" },
  { id: "categories", label: "Categories" }, { id: "preview", label: "Customer Menu Preview" },
];
const ThemeCustomizationStudio = lazy(() => import("../../menu/theme-engine/customization/ThemeCustomizationStudio").then((module) => ({ default: module.ThemeCustomizationStudio })));

function recipeLabel(item: ManagerMenuItem) {
  if (item.recipeId) return item.recipeStatus === "active" ? "Recipe linked" : `Recipe ${item.recipeStatus ?? "linked"}`;
  if (item.directInventoryItemId) return "Ready-to-serve item";
  return "Recipe missing";
}

export function ManagerMenuWorkspacePage({ restaurantId, currency }: Props) {
  const [snapshot, setSnapshot] = useState<ManagerMenuSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [station, setStation] = useState("all");
  const [availability, setAvailability] = useState<AvailabilityFilter>("all");
  const [selected, setSelected] = useState<ManagerMenuItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  const refresh = useCallback(async (force = true) => {
    try { setSnapshot(await loadManagerMenu(restaurantId, force)); setError(null); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Unable to load menu."); }
  }, [restaurantId]);
  useEffect(() => { void refresh(false); }, [refresh]);
  useTenantRealtime({ channelName: "manager-menu", restaurantId, tables: ["menu_items", "categories", "kitchen_stations", "recipes"], refresh, skipInitialConnectRefresh: true });

  const categoryNames = useMemo(() => new Map((snapshot?.categories ?? []).map((entry) => [entry.id, entry.name])), [snapshot]);
  const stationNames = useMemo(() => new Map((snapshot?.stations ?? []).map((entry) => [entry.id, entry.name])), [snapshot]);
  const counts = useMemo(() => {
    const items = snapshot?.items ?? [];
    return { available: items.filter((item) => item.available).length, hidden: items.filter((item) => !item.available).length,
      missing: items.filter((item) => !item.recipeId && !item.directInventoryItemId).length };
  }, [snapshot]);
  const filtered = useMemo(() => (snapshot?.items ?? []).filter((item) => {
    const text = `${item.name} ${item.description ?? ""} ${categoryNames.get(item.categoryId) ?? ""}`.toLowerCase();
    if (query.trim() && !text.includes(query.trim().toLowerCase())) return false;
    if (category !== "all" && item.categoryId !== category) return false;
    if (station === "unassigned" && item.kitchenStationId) return false;
    if (station !== "all" && station !== "unassigned" && item.kitchenStationId !== station) return false;
    if (availability === "available" && !item.available) return false;
    if (availability === "hidden" && item.available) return false;
    if (availability === "recipe" && (item.recipeId || item.directInventoryItemId)) return false;
    return true;
  }), [availability, category, categoryNames, query, snapshot, station]);

  async function toggleAvailability(item: ManagerMenuItem) {
    try {
      setBusyId(item.id); setError(null); setNotice(null);
      await setManagerMenuItemAvailability(restaurantId, item.id, !item.available);
      setNotice(item.available ? `${item.name} is hidden from the customer menu.` : `${item.name} is available to order.`);
      await refresh();
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Menu update failed."); }
    finally { setBusyId(null); }
  }

  const itemRows = (items: ManagerMenuItem[], compact = false) => (
    <div className={`mmw-list${compact ? " compact" : ""}`}>
      <div className="mmw-row mmw-row-head"><span>Item</span><span>Category</span><span>Price</span><span>Status</span><span>Recipe</span><span>Station</span>{!compact && <span>Actions</span>}</div>
      {items.map((item) => <div className="mmw-row" key={item.id}>
        <div className="mmw-item"><div className="mmw-thumb">{item.imageUrl ? <img src={item.imageUrl} alt="" /> : item.name.slice(0, 2).toUpperCase()}</div><span><strong>{item.name}</strong><small>{item.description || "No description"}</small></span></div>
        <span data-label="Category">{categoryNames.get(item.categoryId) ?? "Uncategorized"}</span>
        <strong data-label="Price">{formatCurrency(item.price, currency)}</strong>
        <span data-label="Status" className={`mmw-status ${item.available ? "available" : "hidden"}`}>{item.available ? "Available" : "Hidden"}</span>
        <span data-label="Recipe" className={!item.recipeId && !item.directInventoryItemId ? "mmw-warning" : ""}>{recipeLabel(item)}</span>
        <span data-label="Station">{item.kitchenStationId ? stationNames.get(item.kitchenStationId) ?? "Station unavailable" : "Not assigned"}</span>
        {!compact && <div className="mmw-actions"><button type="button" onClick={() => setSelected(item)}>Edit</button><button type="button" disabled={busyId === item.id} onClick={() => void toggleAvailability(item)}>{item.available ? "Hide" : "Make available"}</button></div>}
      </div>)}
      {!items.length && <div className="mmw-empty">No menu items match these filters.</div>}
    </div>
  );

  return <main className="mmw-page">
    <div className="mmw-nav"><nav className="mmw-tabs" aria-label="Menu workspace">{tabs.map((entry) => <button type="button" key={entry.id} className={tab === entry.id ? "active" : ""} onClick={() => setTab(entry.id)}>{entry.label}</button>)}</nav><button type="button" className="mmw-appearance-button" onClick={() => setAppearanceOpen(true)}>Appearance</button></div>
    {error && <div className="mmw-message error" role="alert">{managerFacingMessage(error, "Unable to complete the menu action. Try again.")}</div>}{notice && <div className="mmw-message">{notice}</div>}
    <div className="mmw-summary" aria-label="Menu status summary">
      <button type="button" onClick={() => { setTab("items"); setAvailability("available"); }}><span>Available</span><strong>{counts.available}</strong></button>
      <div><span>Sold out</span><strong>—</strong><small>Not tracked separately</small></div>
      <button type="button" onClick={() => { setTab("items"); setAvailability("hidden"); }}><span>Hidden</span><strong>{counts.hidden}</strong></button>
      <button type="button" onClick={() => { setTab("items"); setAvailability("recipe"); }}><span>Recipe missing</span><strong>{counts.missing}</strong></button>
    </div>

    {tab === "overview" && <section className="mmw-grid">
      <div className="mmw-panel"><header><div><span>Operational menu</span><h2>Items needing attention</h2></div><button type="button" onClick={() => setTab("items")}>View all</button></header>
        {itemRows((snapshot?.items ?? []).filter((item) => !item.available || (!item.recipeId && !item.directInventoryItemId)).slice(0, 6), true)}</div>
      <aside className="mmw-panel mmw-side"><header><div><span>Customer state</span><h2>Published menu</h2></div></header><strong>{counts.available} items orderable</strong><p>Hidden items are excluded from the current customer menu.</p>{snapshot?.restaurantSlug && <a href={`/r/${encodeURIComponent(snapshot.restaurantSlug)}`} target="_blank" rel="noreferrer">Open customer menu</a>}<button type="button" onClick={() => setTab("preview")}>Preview here</button></aside>
    </section>}

    {tab === "items" && <section className="mmw-panel"><header className="mmw-toolbar"><div><span>Menu items</span><h2>{filtered.length} items</h2></div><div className="mmw-filters"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search menu items..." aria-label="Search menu items"/><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter category"><option value="all">All categories</option>{snapshot?.categories.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select><select value={availability} onChange={(event) => setAvailability(event.target.value as AvailabilityFilter)} aria-label="Filter status"><option value="all">All statuses</option><option value="available">Available</option><option value="hidden">Hidden</option><option value="recipe">Recipe missing</option></select><select value={station} onChange={(event) => setStation(event.target.value)} aria-label="Filter station"><option value="all">All stations</option><option value="unassigned">Not assigned</option>{snapshot?.stations.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></div></header>{itemRows(filtered)}</section>}

    {tab === "categories" && <section className="mmw-panel"><header><div><span>Menu organization</span><h2>Categories</h2></div></header><div className="mmw-category-grid">{snapshot?.categories.map((entry) => { const items = snapshot.items.filter((item) => item.categoryId === entry.id); return <article key={entry.id}><strong>{entry.name}</strong><p>{entry.description || "No description"}</p><span>{items.length} items · {items.filter((item) => item.available).length} available</span></article>; })}{!snapshot?.categories.length && <div className="mmw-empty">No menu categories configured.</div>}</div></section>}

    {tab === "preview" && <section className="mmw-panel mmw-preview"><header><div><span>Customer menu preview</span><h2>Currently orderable items</h2></div>{snapshot?.restaurantSlug && <a href={`/r/${encodeURIComponent(snapshot.restaurantSlug)}`} target="_blank" rel="noreferrer">Open live menu</a>}</header><p className="mmw-preview-note">Only currently available items appear.</p>{snapshot?.categories.map((entry) => { const items = snapshot.items.filter((item) => item.categoryId === entry.id && item.available); if (!items.length) return null; return <div className="mmw-preview-category" key={entry.id}><h3>{entry.name}</h3><div>{items.map((item) => <article key={item.id}>{item.imageUrl && <img src={item.imageUrl} alt=""/>}<span><strong>{item.name}</strong><small>{item.description || ""}</small></span><b>{formatCurrency(item.price, currency)}</b></article>)}</div></div>; })}{!counts.available && <div className="mmw-empty">No items are currently available on the customer menu.</div>}</section>}

    {selected && <ItemEditor item={selected} snapshot={snapshot!} currency={currency} onClose={() => setSelected(null)} onSaved={async () => { setSelected(null); setNotice("Menu item updated."); await refresh(); }} onError={setError} restaurantId={restaurantId}/>} 
    {appearanceOpen && <div className="mmw-appearance-layer"><div className="mmw-appearance"><header><div><span>Secondary menu settings</span><h2>Customer menu appearance</h2></div><button type="button" onClick={() => setAppearanceOpen(false)} aria-label="Close appearance">×</button></header><div><Suspense fallback={<div className="mmw-empty">Loading appearance settings...</div>}><ThemeCustomizationStudio restaurantId={restaurantId} role="manager" /></Suspense></div></div></div>}
  </main>;
}

function ItemEditor({ item, snapshot, onClose, onSaved, onError, restaurantId }: { item: ManagerMenuItem; snapshot: ManagerMenuSnapshot; currency?: CurrencyConfig; onClose: () => void; onSaved: () => Promise<void>; onError: (message: string) => void; restaurantId: string }) {
  const [name, setName] = useState(item.name); const [description, setDescription] = useState(item.description ?? ""); const [price, setPrice] = useState(String(item.price));
  const [categoryId, setCategoryId] = useState(item.categoryId); const [stationId, setStationId] = useState(item.kitchenStationId ?? ""); const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) { event.preventDefault(); const amount = Number(price); if (!name.trim() || !Number.isFinite(amount) || amount < 0) { onError("Enter a valid item name and price."); return; } try { setSaving(true); await updateManagerMenuItem(restaurantId, item.id, { name: name.trim(), description: description.trim() || null, price: amount, category_id: categoryId, kitchen_station_id: stationId || null }); await onSaved(); } catch (saveError) { onError(saveError instanceof Error ? saveError.message : "Menu item update failed."); } finally { setSaving(false); } }
  return <div className="mmw-drawer-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="mmw-drawer" role="dialog" aria-modal="true" aria-label={`Edit ${item.name}`}><header><div><span>Menu item</span><h2>Edit details</h2></div><button type="button" onClick={onClose} aria-label="Close">×</button></header><form onSubmit={submit}><label>Name<input value={name} onChange={(event) => setName(event.target.value)} required/></label><label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4}/></label><label>Price<input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} required/></label><label>Category<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{snapshot.categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><label>Kitchen station<select value={stationId} onChange={(event) => setStationId(event.target.value)}><option value="">Not assigned</option>{snapshot.stations.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.active ? "" : " (inactive)"}</option>)}</select></label><div className="mmw-drawer-note"><strong>{recipeLabel(item)}</strong><span>Recipe work remains in the Recipes workspace.</span><a href="/manager/recipes">Open Recipes</a></div><footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={saving}>{saving ? "Saving..." : "Save changes"}</button></footer></form></aside></div>;
}

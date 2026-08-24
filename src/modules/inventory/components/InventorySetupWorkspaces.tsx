import { useMemo, useState } from "react";
import type { InventoryCategory, InventoryItem, InventoryStorageLocation, InventoryUnit } from "../types";

type LifecycleProps = {
  canManageLifecycle: boolean;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
};
type MaterialProps = LifecycleProps & {
  items: InventoryItem[];
  categories: InventoryCategory[];
  units: InventoryUnit[];
  onAdd: () => void;
  onEdit: (item: InventoryItem) => void;
};
type StorageProps = LifecycleProps & {
  locations: InventoryStorageLocation[];
  items: InventoryItem[];
  onAdd: () => void;
  onEdit: (location: InventoryStorageLocation) => void;
};

export function InventoryMaterialsWorkspace({ items, categories, units, canManageLifecycle, onAdd, onEdit, onArchive, onRestore }: MaterialProps) {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState<"active" | "archived" | "all">("active");
  const categoryNames = useMemo(() => new Map(categories.map((row) => [row.id, row.name])), [categories]);
  const unitNames = useMemo(() => new Map(units.map((row) => [row.id, row.name])), [units]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items
      .filter((item) => item.status !== "deleted")
      .filter((item) => status === "all" || item.status === status)
      .filter((item) => !categoryId || item.categoryId === categoryId)
      .filter((item) => !query || item.name.toLowerCase().includes(query))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [categoryId, items, search, status]);
  const hasFilters = Boolean(search.trim() || categoryId || status !== "active");

  return <div className="ia-setup-page ia-materials-page">
    <header className="ia-setup-heading"><div><h2>Materials</h2><p>Materials tracked by this business.</p></div><button type="button" onClick={onAdd}>Add Material</button></header>
    <div className="ia-setup-tools"><label><span>Search materials</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search materials" /></label><details><summary>Filters{(categoryId || status !== "active") && <b>Active</b>}</summary><div><label>Category<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">All categories</option>{categories.filter((row) => row.status === "active").map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select></label></div></details></div>
    {visible.length ? <section className="ia-material-list" aria-label="Materials">
      <div className="ia-material-row header" aria-hidden="true"><span>Material</span><span>Category</span><span>Unit</span><span>Status</span><span>Action</span></div>
      {visible.map((item) => <article className={`ia-material-row ${item.status}`} key={item.id}>
        <div><strong>{item.name}</strong><span>{categoryNames.get(item.categoryId) ?? "Uncategorized"}</span></div>
        <span className="category">{categoryNames.get(item.categoryId) ?? "Uncategorized"}</span>
        <span className="unit">{unitNames.get(item.unitId) ?? "Unit unavailable"}</span>
        <span className={`ia-setup-status ${item.status}`}>{item.status === "active" ? "Active" : "Archived"}</span>
        <div className="ia-setup-actions">{(item.status === "active" || canManageLifecycle) && <button type="button" onClick={() => onEdit(item)}>Edit</button>}{canManageLifecycle && <details><summary aria-label={`More actions for ${item.name}`}>More</summary><div>{item.status === "archived" ? <button type="button" onClick={() => onRestore(item.id)}>Restore</button> : <button type="button" onClick={() => onArchive(item.id)}>Archive</button>}</div></details>}</div>
      </article>)}
    </section> : <section className="ia-setup-empty"><strong>{hasFilters ? "No materials match your search." : "No materials yet."}</strong>{hasFilters ? <button type="button" onClick={() => { setSearch(""); setCategoryId(""); setStatus("active"); }}>Clear filters</button> : <button type="button" onClick={onAdd}>Add Material</button>}</section>}
  </div>;
}

export function InventoryStorageWorkspace({ locations, items, canManageLifecycle, onAdd, onEdit, onArchive, onRestore }: StorageProps) {
  const visible = useMemo(() => locations.filter((location) => location.status !== "deleted").sort((left, right) => left.name.localeCompare(right.name)), [locations]);
  const materialCounts = useMemo(() => items.reduce<Record<string, number>>((counts, item) => {
    if (item.status !== "deleted") counts[item.storageLocationId] = (counts[item.storageLocationId] ?? 0) + 1;
    return counts;
  }, {}), [items]);
  return <div className="ia-setup-page ia-storage-page">
    <header className="ia-setup-heading"><div><h2>Storage</h2><p>Places where inventory materials are kept.</p></div><button type="button" onClick={onAdd}>Add Storage</button></header>
    {visible.length ? <section className="ia-storage-grid" aria-label="Storage locations">{visible.map((location) => {
      const count = materialCounts[location.id] ?? 0;
      return <article className={`ia-storage-card ${location.status}`} key={location.id}>
        <header><strong>{location.name}</strong>{location.status !== "active" && <span className="ia-setup-status archived">Archived</span>}</header>
        {location.description && <p>{location.description}</p>}
        {count > 0 && <span>{count} {count === 1 ? "material" : "materials"}</span>}
        <footer>{(location.status === "active" || canManageLifecycle) && <button type="button" onClick={() => onEdit(location)}>Edit</button>}{canManageLifecycle && <details><summary aria-label={`More actions for ${location.name}`}>More</summary><div>{location.status === "archived" ? <button type="button" onClick={() => onRestore(location.id)}>Restore</button> : <button type="button" onClick={() => onArchive(location.id)}>Archive</button>}</div></details>}</footer>
      </article>;
    })}</section> : <section className="ia-setup-empty"><strong>No storage locations yet.</strong><button type="button" onClick={onAdd}>Add Storage</button></section>}
  </div>;
}

export function InventorySetupLoadError({ resource }: { resource: "materials" | "storage locations" }) {
  return <section className="ia-setup-load-error" role="alert"><strong>Unable to load {resource}.</strong><span>Try again.</span></section>;
}

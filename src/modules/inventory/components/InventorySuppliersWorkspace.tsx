import { useMemo, useState } from "react";
import type { InventoryItem, InventorySupplier } from "../types";

type Props = {
  suppliers: InventorySupplier[];
  items: InventoryItem[];
  onCreate: () => void;
  onEdit: (supplier: InventorySupplier) => void;
};

export function InventorySuppliersWorkspace({ suppliers, items, onCreate, onEdit }: Props) {
  const [search, setSearch] = useState("");
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return suppliers
      .filter((supplier) => supplier.status !== "deleted")
      .filter((supplier) => !query || [supplier.name, supplier.phone, supplier.contactPerson, supplier.address]
        .some((value) => (value ?? "").toLowerCase().includes(query)))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [search, suppliers]);
  const suppliedMaterialCounts = useMemo(() => items.reduce<Record<string, number>>((counts, item) => {
    if (item.status === "active" && item.preferredSupplierId) counts[item.preferredSupplierId] = (counts[item.preferredSupplierId] ?? 0) + 1;
    return counts;
  }, {}), [items]);

  return <div className="ia-suppliers-page">
    <header className="ia-suppliers-heading"><div><h2>Suppliers</h2></div><button type="button" onClick={onCreate}>Add Supplier</button></header>
    <label className="ia-suppliers-search"><span>Search suppliers</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, phone, or contact" /></label>
    {visible.length > 0 ? <section className="ia-suppliers-grid" aria-label="Suppliers">
      {visible.map((supplier) => {
        const materialCount = suppliedMaterialCounts[supplier.id] ?? 0;
        return <article className="ia-supplier-card" key={supplier.id}>
          <header><strong>{supplier.name}</strong>{supplier.status !== "active" && <span className={`ia-supplier-status ${supplier.status}`}>Archived</span>}</header>
          <div className="ia-supplier-contact">
            {supplier.contactPerson && <span>Contact: {supplier.contactPerson}</span>}
            {supplier.phone && <a href={`tel:${supplier.phone}`}>{supplier.phone}</a>}
            {supplier.address && <span>{supplier.address}</span>}
            {materialCount > 0 && <span>Supplies {materialCount} {materialCount === 1 ? "material" : "materials"}</span>}
          </div>
          <footer><button type="button" onClick={() => onEdit(supplier)}>Edit</button></footer>
        </article>;
      })}
    </section> : <section className="ia-suppliers-empty"><strong>{search.trim() ? "No suppliers match this search." : "No suppliers yet."}</strong>{!search.trim() && <button type="button" onClick={onCreate}>Add Supplier</button>}</section>}
  </div>;
}

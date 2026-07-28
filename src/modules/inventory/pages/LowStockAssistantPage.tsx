import { useCallback, useEffect, useMemo, useState } from "react";
import type { PurchaseOrderDraftForm } from "../../purchasing/types";
import { purchaseOrderLineTotal, purchaseOrderTotal } from "../../purchasing/services/purchaseOrderDraftService";
import type {
  InventoryAdjustment,
  InventoryCategory,
  InventoryCurrentStockRow,
  InventoryItem,
  InventoryStorageLocation,
  InventorySupplier,
  InventoryUnit,
} from "../types";
import type { LowStockAssistantFilters, LowStockClassification } from "../lowStockAssistantTypes";
import { ADJUSTMENT_TYPE_LABELS, loadInventoryAdjustments } from "../services/inventoryAdjustmentService";
import {
  buildLowStockAssistantRows,
  canCreateLowStockPurchaseDraft,
  createSuggestedPurchaseDraft,
  filterLowStockAssistantRows,
  suggestedPurchaseDraft,
} from "../services/lowStockAssistantService";
import "../styles/lowStockAssistant.css";

type Props = {
  restaurantId: string;
  staffRole: string;
  currentStock: InventoryCurrentStockRow[];
  items: InventoryItem[];
  categories: InventoryCategory[];
  suppliers: InventorySupplier[];
  storageLocations: InventoryStorageLocation[];
  units: InventoryUnit[];
  onOpenPurchaseOrders?: () => void;
};

const ALL_CLASSIFICATIONS: LowStockClassification[] = ["out_of_stock", "critical", "low", "healthy"];
const CLASSIFICATION_LABELS: Record<LowStockClassification, string> = {
  out_of_stock: "Out of Stock",
  critical: "Critical Stock",
  low: "Low Stock",
  healthy: "Healthy Stock",
};

const defaultFilters: LowStockAssistantFilters = {
  search: "",
  storageLocationId: "",
  categoryId: "",
  supplierId: "",
  adjustmentType: "all",
  classifications: ALL_CLASSIFICATIONS,
};

const quantity = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
const money = (value: number) => new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

export function LowStockAssistantPage({
  restaurantId,
  staffRole,
  currentStock,
  items,
  categories,
  suppliers,
  storageLocations,
  units,
  onOpenPurchaseOrders,
}: Props) {
  const [adjustments, setAdjustments] = useState<InventoryAdjustment[]>([]);
  const [filters, setFilters] = useState<LowStockAssistantFilters>(defaultFilters);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<PurchaseOrderDraftForm | null>(null);
  const [loadingAdjustments, setLoadingAdjustments] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const canCreate = canCreateLowStockPurchaseDraft(staffRole);
  const activeSuppliers = useMemo(() => suppliers.filter((supplier) => supplier.status === "active"), [suppliers]);
  const activeItems = useMemo(() => items.filter((item) => item.status === "active"), [items]);
  const activeUnits = useMemo(() => units.filter((unit) => unit.status === "active" && unit.active), [units]);

  const loadAdjustmentMetadata = useCallback(async () => {
    try {
      setLoadingAdjustments(true);
      setAdjustments(await loadInventoryAdjustments(restaurantId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Adjustment metadata is unavailable.");
    } finally {
      setLoadingAdjustments(false);
    }
  }, [restaurantId]);

  useEffect(() => { void loadAdjustmentMetadata(); }, [loadAdjustmentMetadata]);

  const rows = useMemo(() => buildLowStockAssistantRows({
    restaurantId,
    currentStock,
    items,
    categories,
    suppliers,
    adjustments,
  }), [adjustments, categories, currentStock, items, restaurantId, suppliers]);

  const filteredRows = useMemo(() => filterLowStockAssistantRows(rows, filters), [filters, rows]);
  const summary = useMemo(() => Object.fromEntries(ALL_CLASSIFICATIONS.map((classification) => [
    classification,
    rows.filter((row) => row.classification === classification).length,
  ])) as Record<LowStockClassification, number>, [rows]);
  const selectableRows = filteredRows.filter((row) => row.classification !== "healthy" && row.suggestedPurchase > 0);

  useEffect(() => {
    const valid = new Set(rows.filter((row) => row.classification !== "healthy" && row.suggestedPurchase > 0)
      .map((row) => row.inventoryItemId));
    setSelectedItemIds((current) => current.filter((id) => valid.has(id)));
  }, [rows]);

  function setFilter<K extends keyof LowStockAssistantFilters>(key: K, value: LowStockAssistantFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function toggleClassification(classification: LowStockClassification) {
    setFilters((current) => ({
      ...current,
      classifications: current.classifications.includes(classification)
        ? current.classifications.filter((value) => value !== classification)
        : [...current.classifications, classification],
    }));
  }

  function toggleItem(id: string) {
    setSelectedItemIds((current) => current.includes(id)
      ? current.filter((itemId) => itemId !== id)
      : [...current, id]);
  }

  function openDraft() {
    if (!canCreate) return;
    if (!selectedItemIds.length) {
      setError("Select at least one out-of-stock, critical, or low-stock ingredient with a maximum stock value.");
      return;
    }
    const form = suggestedPurchaseDraft({ rows, selectedItemIds, supplierId: "", expectedDeliveryDate: "", items });
    if (!form.lines.length) {
      setError("The selected ingredients do not have a positive suggested purchase quantity.");
      return;
    }
    setDraft(form);
    setError(null);
    setMessage(null);
  }

  function updateDraftLine(index: number, field: "quantity" | "unitPrice", value: string) {
    setDraft((current) => current ? {
      ...current,
      lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line),
    } : current);
  }

  async function saveDraft() {
    if (!draft || !canCreate) return;
    try {
      setWorking(true);
      setError(null);
      const id = await createSuggestedPurchaseDraft({
        restaurantId,
        form: draft,
        suppliers: activeSuppliers,
        items: activeItems,
        units: activeUnits,
      });
      setDraft(null);
      setSelectedItemIds([]);
      setMessage(`Purchase draft ${id.slice(0, 8).toUpperCase()} created. Inventory was not changed.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Purchase draft could not be created.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="lsa-page">
      <header className="lsa-heading">
        <div><span>Purchasing Assistant</span><h2>Low Stock Assistant</h2><p>Review stock levels and prepare a purchase draft when you decide to reorder.</p></div>
        {canCreate ? <button type="button" onClick={openDraft}>Create Purchase Draft ({selectedItemIds.length})</button>
          : <span className="lsa-readonly">Read only</span>}
      </header>

      {(error || message) && <div className={`ia-alert ${error ? "error" : ""}`}>
        <span>{error ?? message}</span>
        {message && onOpenPurchaseOrders && <button type="button" onClick={onOpenPurchaseOrders}>View Purchase Orders</button>}
      </div>}

      <section className="lsa-summary" aria-label="Stock classification summary">
        {ALL_CLASSIFICATIONS.map((classification) => (
          <button type="button" className={classification} key={classification} onClick={() => setFilter("classifications", [classification])}>
            <span>{CLASSIFICATION_LABELS[classification]}</span><strong>{summary[classification]}</strong>
          </button>
        ))}
      </section>

      <section className="lsa-filters" aria-label="Low stock assistant filters">
        <label className="wide">Search<input value={filters.search} onChange={(event) => setFilter("search", event.target.value)} placeholder="Ingredient, supplier, or category" /></label>
        <label>Storage Location<select value={filters.storageLocationId} onChange={(event) => setFilter("storageLocationId", event.target.value)}><option value="">All locations</option>{storageLocations.filter((row) => row.status !== "deleted").map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label>Category<select value={filters.categoryId} onChange={(event) => setFilter("categoryId", event.target.value)}><option value="">All categories</option>{categories.filter((row) => row.status !== "deleted").map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label>Supplier<select value={filters.supplierId} onChange={(event) => setFilter("supplierId", event.target.value)}><option value="">All suppliers</option>{suppliers.filter((row) => row.status !== "deleted").map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label>Adjustment Type<select value={filters.adjustmentType} disabled={loadingAdjustments} onChange={(event) => setFilter("adjustmentType", event.target.value as LowStockAssistantFilters["adjustmentType"])}><option value="all">All types</option><option value="none">No adjustment</option>{Object.entries(ADJUSTMENT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="lsa-status-filters"><span>Stock Level</span>{ALL_CLASSIFICATIONS.map((classification) => <label key={classification}><input type="checkbox" checked={filters.classifications.includes(classification)} onChange={() => toggleClassification(classification)} />{CLASSIFICATION_LABELS[classification]}</label>)}</div>
      </section>

      {canCreate && selectableRows.length > 0 && (
        <div className="lsa-selection-bar">
          <span>{selectedItemIds.length} selected</span>
          <button type="button" onClick={() => setSelectedItemIds(selectableRows.map((row) => row.inventoryItemId))}>Select Visible Suggested Ingredients</button>
          <button type="button" onClick={() => setSelectedItemIds([])}>Clear</button>
        </div>
      )}

      <section className="lsa-table-wrap">
        <table className="lsa-table">
          <thead><tr>{canCreate && <th aria-label="Select" />}<th>Ingredient</th><th>Stock Level</th><th>Current Quantity</th><th>Minimum Stock</th><th>Maximum Stock</th><th>Suggested Purchase</th><th>Supplier</th><th>Category</th><th>Storage Location</th><th>Adjustment Type</th></tr></thead>
          <tbody>
            {filteredRows.map((row) => {
              const selectable = row.classification !== "healthy" && row.suggestedPurchase > 0;
              return <tr key={row.inventoryItemId}>
                {canCreate && <td><input aria-label={`Select ${row.itemName}`} type="checkbox" disabled={!selectable} checked={selectedItemIds.includes(row.inventoryItemId)} onChange={() => toggleItem(row.inventoryItemId)} /></td>}
                <td><strong>{row.itemName}</strong><small>{row.unitName || "Base unit"}</small></td>
                <td><span className={`lsa-badge ${row.classification}`}>{CLASSIFICATION_LABELS[row.classification]}</span></td>
                <td>{quantity(row.currentQuantity)} {row.unitName}</td>
                <td>{quantity(row.minimumStock)} {row.unitName}</td>
                <td>{row.maximumStock === null ? "Not set" : `${quantity(row.maximumStock)} ${row.unitName}`}</td>
                <td><strong>{row.maximumStock === null ? "Set maximum stock" : `${quantity(row.suggestedPurchase)} ${row.unitName}`}</strong></td>
                <td>{row.supplierName ?? "Not assigned"}</td>
                <td>{row.categoryName}</td>
                <td>{row.storageLocationNames.join(", ") || "Default location"}</td>
                <td>{row.latestAdjustmentType ? ADJUSTMENT_TYPE_LABELS[row.latestAdjustmentType] : "None"}</td>
              </tr>;
            })}
          </tbody>
        </table>
        {!filteredRows.length && <div className="ia-empty">No ingredients match these filters.</div>}
      </section>

      {draft && canCreate && (
        <div className="lsa-overlay" role="presentation">
          <section className="lsa-draft" role="dialog" aria-modal="true" aria-label="Create purchase draft from low stock ingredients">
            <header><div><span>Purchase Shortcut</span><h3>Create Purchase Draft</h3><p>Review every value. Nothing is created until you select Save Draft.</p></div><button type="button" onClick={() => setDraft(null)} aria-label="Close">×</button></header>
            <div className="lsa-draft-fields">
              <label>Supplier<select required value={draft.supplierId} onChange={(event) => setDraft({ ...draft, supplierId: event.target.value })}><option value="">Select supplier manually</option>{activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
              <label>Expected Delivery Date<input required type="date" value={draft.expectedDeliveryDate} onChange={(event) => setDraft({ ...draft, expectedDeliveryDate: event.target.value })} /></label>
              <label className="wide">Notes<textarea maxLength={2000} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
            </div>
            <div className="lsa-draft-lines">
              {draft.lines.map((line, index) => {
                const item = items.find((candidate) => candidate.id === line.inventoryItemId);
                const unit = units.find((candidate) => candidate.id === line.purchaseUnitId);
                return <div key={line.inventoryItemId}>
                  <strong>{item?.name ?? "Ingredient"}</strong>
                  <label>Quantity<input min="0.001" step="0.001" type="number" value={line.quantity} onChange={(event) => updateDraftLine(index, "quantity", event.target.value)} /></label>
                  <span>{unit?.name ?? "Base unit"}</span>
                  <label>Unit Price<input min="0" step="0.01" type="number" value={line.unitPrice} onChange={(event) => updateDraftLine(index, "unitPrice", event.target.value)} /></label>
                  <div><span>Line Total</span><strong>{money(purchaseOrderLineTotal(line.quantity, line.unitPrice))}</strong></div>
                </div>;
              })}
            </div>
            <footer><div><span>Draft Total</span><strong>{money(purchaseOrderTotal(draft))}</strong></div><p>This action creates a draft only. It does not receive stock or create a movement.</p><button type="button" onClick={() => setDraft(null)}>Cancel</button><button type="button" disabled={working} onClick={() => void saveDraft()}>{working ? "Saving..." : "Save Draft"}</button></footer>
          </section>
        </div>
      )}
    </div>
  );
}

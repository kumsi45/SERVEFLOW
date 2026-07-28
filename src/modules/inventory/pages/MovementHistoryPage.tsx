import { useMemo, useState } from "react";
import type { InventoryFoodConsumptionMovement } from "../types";

type Props = {
  movements: InventoryFoodConsumptionMovement[];
  onRefresh: () => void;
};

type Filters = {
  search: string;
  dateFrom: string;
  dateTo: string;
  inventoryItemId: string;
  menuItemId: string;
  recipeId: string;
  kitchenStationId: string;
  movementType: "FOOD_CONSUMPTION";
};

const EMPTY_FILTERS: Filters = {
  search: "",
  dateFrom: "",
  dateTo: "",
  inventoryItemId: "",
  menuItemId: "",
  recipeId: "",
  kitchenStationId: "",
  movementType: "FOOD_CONSUMPTION",
};

function dateTimeLabel(value: string) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function quantityLabel(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
}

function options(
  rows: InventoryFoodConsumptionMovement[],
  id: (row: InventoryFoodConsumptionMovement) => string | null,
  label: (row: InventoryFoodConsumptionMovement) => string | null,
) {
  const values = new Map<string, string>();
  for (const row of rows) {
    const value = id(row);
    const name = label(row);
    if (value && name) values.set(value, name);
  }
  return [...values].sort((left, right) => left[1].localeCompare(right[1]));
}

export function MovementHistoryPage({ movements, onRefresh }: Props) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const inventoryItems = useMemo(() => options(movements, (row) => row.inventoryItemId, (row) => row.inventoryItemName), [movements]);
  const menuItems = useMemo(() => options(movements, (row) => row.menuItemId, (row) => row.menuItemName), [movements]);
  const recipes = useMemo(() => options(movements, (row) => row.recipeId, (row) => row.recipeName), [movements]);
  const stations = useMemo(() => options(movements, (row) => row.kitchenStationId, (row) => row.kitchenStationName), [movements]);

  const rows = useMemo(() => movements.filter((movement) => {
    if (filters.inventoryItemId && movement.inventoryItemId !== filters.inventoryItemId) return false;
    if (filters.menuItemId && movement.menuItemId !== filters.menuItemId) return false;
    if (filters.recipeId && movement.recipeId !== filters.recipeId) return false;
    if (filters.kitchenStationId && movement.kitchenStationId !== filters.kitchenStationId) return false;
    const movementTime = new Date(movement.createdAt).getTime();
    if (filters.dateFrom && movementTime < new Date(`${filters.dateFrom}T00:00:00`).getTime()) return false;
    if (filters.dateTo && movementTime >= new Date(`${filters.dateTo}T00:00:00`).getTime() + 86_400_000) return false;
    const search = filters.search.trim().toLowerCase();
    if (!search) return true;
    return [
      movement.inventoryItemName,
      movement.menuItemName,
      movement.recipeName,
      movement.orderNumber,
      movement.diningSessionNumber,
      movement.kitchenStationName,
      movement.performedByName,
      movement.waiterName,
      movement.cashierName,
      movement.notes,
    ].some((value) => (value ?? "").toLowerCase().includes(search));
  }), [filters, movements]);

  const setFilter = <Key extends keyof Filters,>(key: Key, value: Filters[Key]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  return (
    <div className="ia-stack movement-history-page">
      <section className="ia-toolbar">
        <label className="ia-search">
          <span>Search movement history</span>
          <input value={filters.search} onChange={(event) => setFilter("search", event.target.value)} placeholder="Search ingredient, order, menu item, recipe, station, or staff" />
        </label>
        <div className="ia-actions">
          <button type="button" onClick={() => setFilters(EMPTY_FILTERS)}>Clear Filters</button>
          <button type="button" onClick={onRefresh}>Refresh</button>
        </div>
      </section>
      <section className="ia-filters movement-history-filters" aria-label="Movement history filters">
        <label><span>From</span><input type="date" value={filters.dateFrom} onChange={(event) => setFilter("dateFrom", event.target.value)} /></label>
        <label><span>To</span><input type="date" value={filters.dateTo} onChange={(event) => setFilter("dateTo", event.target.value)} /></label>
        <label><span>Ingredient</span><select value={filters.inventoryItemId} onChange={(event) => setFilter("inventoryItemId", event.target.value)}><option value="">All ingredients</option>{inventoryItems.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label><span>Menu Item</span><select value={filters.menuItemId} onChange={(event) => setFilter("menuItemId", event.target.value)}><option value="">All menu items</option>{menuItems.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label><span>Recipe</span><select value={filters.recipeId} onChange={(event) => setFilter("recipeId", event.target.value)}><option value="">All recipes</option>{recipes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label><span>Kitchen Station</span><select value={filters.kitchenStationId} onChange={(event) => setFilter("kitchenStationId", event.target.value)}><option value="">All kitchen stations</option>{stations.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label><span>Movement Type</span><select value={filters.movementType} onChange={(event) => setFilter("movementType", event.target.value as "FOOD_CONSUMPTION")}><option value="FOOD_CONSUMPTION">Food Consumption</option></select></label>
      </section>
      <section className="ia-section-title">
        <h2>Movement History</h2>
        <span>{rows.length} immutable food-consumption {rows.length === 1 ? "movement" : "movements"}</span>
      </section>
      <section className="ia-table-wrap">
        <table className="ia-table movement-history">
          <thead><tr><th>Date &amp; Time</th><th>Ingredient</th><th>Movement Type</th><th>Quantity</th><th>Unit</th><th>Order Number</th><th>Menu Item</th><th>Recipe</th><th>Dining Session</th><th>Kitchen Station</th><th>Performed By</th><th>Current Stock After Movement</th></tr></thead>
          <tbody>{rows.map((movement) => <tr key={movement.id}>
            <td data-label="Date & Time">{dateTimeLabel(movement.createdAt)}</td>
            <td data-label="Ingredient"><strong>{movement.inventoryItemName}</strong><small>Before: {quantityLabel(movement.quantityBefore)} {movement.unit}</small></td>
            <td data-label="Movement Type"><span className="ia-status food-consumption">Food Consumption</span></td>
            <td data-label="Quantity"><strong className="ia-negative">-{quantityLabel(movement.quantity)}</strong></td>
            <td data-label="Unit">{movement.unit}</td>
            <td data-label="Order Number"><strong>{movement.orderNumber}</strong><small>Order line {movement.orderItemId.slice(0, 8)}</small></td>
            <td data-label="Menu Item">{movement.menuItemName}</td>
            <td data-label="Recipe">{movement.recipeName ?? "Ready-to-Serve"}</td>
            <td data-label="Dining Session"><strong>{movement.diningSessionNumber}</strong><small>Batch {movement.kitchenBatchId}</small></td>
            <td data-label="Kitchen Station">{movement.kitchenStationName ?? "Not assigned"}</td>
            <td data-label="Performed By"><strong>{movement.performedByName || "Staff"}</strong><small>{movement.waiterName ? `Waiter: ${movement.waiterName}` : "No waiter"} · {movement.cashierName ? `Cashier: ${movement.cashierName}` : "No cashier"}</small></td>
            <td data-label="Current Stock After Movement"><strong>{quantityLabel(movement.quantityAfter)} {movement.unit}</strong></td>
          </tr>)}</tbody>
        </table>
        {rows.length === 0 && <div className="ia-empty">No food-consumption movements match the current filters.</div>}
      </section>
    </div>
  );
}

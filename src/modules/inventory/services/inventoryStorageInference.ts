import type { InventoryCurrentStockRow, InventoryStorageLocation } from "../types";

export type InventoryStorageChoice = {
  id: string;
  name: string;
  quantity: number;
  unitName: string;
};

type StorageContext = {
  currentStock: InventoryCurrentStockRow[];
  storageLocations: InventoryStorageLocation[];
};

export function inferMaterialStorageChoices(
  context: StorageContext,
  restaurantId: string,
  inventoryItemId: string,
  mode: "relationship" | "positive-source",
) {
  if (!inventoryItemId) return [];
  const allowed = new Map(context.storageLocations
    .filter((storage) => storage.restaurantId === restaurantId && storage.status === "active")
    .map((storage) => [storage.id, storage]));
  const choices = new Map<string, InventoryStorageChoice>();
  for (const row of context.currentStock) {
    const storage = allowed.get(row.storageLocationId);
    if (!storage || row.inventoryItemId !== inventoryItemId) continue;
    const current = choices.get(storage.id);
    choices.set(storage.id, {
      id: storage.id,
      name: storage.name,
      quantity: (current?.quantity ?? 0) + row.currentQuantity,
      unitName: current?.unitName ?? row.unitName,
    });
  }
  return [...choices.values()]
    .filter((choice) => mode === "relationship" || choice.quantity > 0)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function activeTenantStorageChoices(context: StorageContext, restaurantId: string, unitName = "units") {
  return context.storageLocations
    .filter((storage) => storage.restaurantId === restaurantId && storage.status === "active")
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((storage) => ({ id: storage.id, name: storage.name, quantity: 0, unitName }));
}

export function resolveInferredStorage(currentStorageId: string, choices: InventoryStorageChoice[]) {
  if (choices.length === 1) return choices[0].id;
  return choices.some((choice) => choice.id === currentStorageId) ? currentStorageId : "";
}

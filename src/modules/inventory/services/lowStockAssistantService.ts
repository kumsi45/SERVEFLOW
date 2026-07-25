import type { PurchaseOrderDraftForm } from "../../purchasing/types";
import { savePurchaseOrderDraft } from "../../purchasing/services/purchaseOrderDraftService";
import type {
  InventoryAdjustment,
  InventoryCategory,
  InventoryCurrentStockRow,
  InventoryItem,
  InventorySupplier,
  InventoryUnit,
} from "../types";
import type {
  LowStockAssistantFilters,
  LowStockAssistantRow,
  LowStockClassification,
} from "../lowStockAssistantTypes";

const roundQuantity = (value: number) => Math.round((value + Number.EPSILON) * 1000) / 1000;

export function classifyLowStock(currentQuantity: number, minimumStock: number): LowStockClassification {
  if (currentQuantity === 0) return "out_of_stock";
  if (currentQuantity < minimumStock) return "critical";
  if (currentQuantity <= minimumStock) return "low";
  return "healthy";
}

export function suggestedPurchaseQuantity(currentQuantity: number, maximumStock: number | null) {
  if (maximumStock === null) return 0;
  return roundQuantity(Math.max(0, maximumStock - currentQuantity));
}

export function buildLowStockAssistantRows(args: {
  restaurantId: string;
  currentStock: InventoryCurrentStockRow[];
  items: InventoryItem[];
  categories: InventoryCategory[];
  suppliers: InventorySupplier[];
  adjustments?: InventoryAdjustment[];
}): LowStockAssistantRow[] {
  const categories = new Map(args.categories.map((category) => [category.id, category.name]));
  const suppliers = new Map(args.suppliers.map((supplier) => [supplier.id, supplier.name]));
  const latestAdjustment = new Map<string, { type: InventoryAdjustment["adjustmentType"]; createdAt: number }>();

  for (const adjustment of args.adjustments ?? []) {
    const createdAt = new Date(adjustment.createdAt).getTime();
    for (const line of adjustment.items) {
      const current = latestAdjustment.get(line.inventoryItemId);
      if (!current || createdAt > current.createdAt) {
        latestAdjustment.set(line.inventoryItemId, { type: adjustment.adjustmentType, createdAt });
      }
    }
  }

  const stockByItem = new Map<string, {
    quantity: number;
    locations: Map<string, string>;
    unitName: string;
  }>();
  for (const stock of args.currentStock) {
    const aggregate = stockByItem.get(stock.inventoryItemId) ?? {
      quantity: 0,
      locations: new Map<string, string>(),
      unitName: stock.unitName,
    };
    aggregate.quantity = roundQuantity(aggregate.quantity + stock.currentQuantity);
    aggregate.locations.set(stock.storageLocationId, stock.storageLocationName);
    if (!aggregate.unitName) aggregate.unitName = stock.unitName;
    stockByItem.set(stock.inventoryItemId, aggregate);
  }

  return args.items
    .filter((item) => item.restaurantId === args.restaurantId && item.status === "active")
    .map((item) => {
      const stock = stockByItem.get(item.id);
      const currentQuantity = stock?.quantity ?? 0;
      const locations = stock?.locations ?? new Map<string, string>();
      const supplierName = item.preferredSupplierId ? suppliers.get(item.preferredSupplierId) ?? null : null;
      return {
        inventoryItemId: item.id,
        itemName: item.name,
        categoryId: item.categoryId,
        categoryName: categories.get(item.categoryId) ?? "Uncategorized",
        storageLocationIds: [...locations.keys()],
        storageLocationNames: [...locations.values()],
        supplierId: item.preferredSupplierId,
        supplierName,
        unitId: item.unitId,
        unitName: stock?.unitName ?? "",
        currentQuantity,
        minimumStock: item.minimumStock,
        maximumStock: item.maximumStock,
        classification: classifyLowStock(currentQuantity, item.minimumStock),
        suggestedPurchase: suggestedPurchaseQuantity(currentQuantity, item.maximumStock),
        latestAdjustmentType: latestAdjustment.get(item.id)?.type ?? null,
      };
    })
    .sort((left, right) => left.itemName.localeCompare(right.itemName));
}

export function filterLowStockAssistantRows(rows: LowStockAssistantRow[], filters: LowStockAssistantFilters) {
  const classifications = new Set(filters.classifications);
  const query = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.storageLocationId && !row.storageLocationIds.includes(filters.storageLocationId)) return false;
    if (filters.categoryId && row.categoryId !== filters.categoryId) return false;
    if (filters.supplierId && row.supplierId !== filters.supplierId) return false;
    if (filters.adjustmentType === "none" && row.latestAdjustmentType !== null) return false;
    if (filters.adjustmentType !== "all" && filters.adjustmentType !== "none"
      && row.latestAdjustmentType !== filters.adjustmentType) return false;
    if (!classifications.has(row.classification)) return false;
    if (!query) return true;
    return [row.itemName, row.supplierName, row.categoryName]
      .some((value) => (value ?? "").toLowerCase().includes(query));
  });
}

export function canCreateLowStockPurchaseDraft(staffRole: string) {
  return ["owner", "manager", "inventory_officer"].includes(staffRole);
}

export function suggestedPurchaseDraft(args: {
  rows: LowStockAssistantRow[];
  selectedItemIds: string[];
  supplierId: string;
  expectedDeliveryDate: string;
  notes?: string;
  items: InventoryItem[];
}): PurchaseOrderDraftForm {
  const selected = new Set(args.selectedItemIds);
  const items = new Map(args.items.map((item) => [item.id, item]));
  return {
    supplierId: args.supplierId,
    expectedDeliveryDate: args.expectedDeliveryDate,
    notes: args.notes ?? "Created from the Low Stock Purchasing Assistant.",
    lines: args.rows
      .filter((row) => selected.has(row.inventoryItemId)
        && row.classification !== "healthy"
        && row.suggestedPurchase > 0)
      .map((row) => ({
        inventoryItemId: row.inventoryItemId,
        purchaseUnitId: row.unitId,
        quantity: String(row.suggestedPurchase),
        unitPrice: String(items.get(row.inventoryItemId)?.purchasePrice ?? 0),
      })),
  };
}

export async function createSuggestedPurchaseDraft(args: {
  restaurantId: string;
  form: PurchaseOrderDraftForm;
  suppliers: InventorySupplier[];
  items: InventoryItem[];
  units: InventoryUnit[];
}) {
  return savePurchaseOrderDraft(args.restaurantId, args.form, args.suppliers, args.items, args.units);
}

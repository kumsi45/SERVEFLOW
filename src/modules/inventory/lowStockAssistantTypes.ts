import type { InventoryAdjustmentType } from "./types";

export type LowStockClassification = "out_of_stock" | "critical" | "low" | "healthy";

export type LowStockAssistantRow = {
  inventoryItemId: string;
  itemName: string;
  categoryId: string;
  categoryName: string;
  storageLocationIds: string[];
  storageLocationNames: string[];
  supplierId: string | null;
  supplierName: string | null;
  unitId: string;
  unitName: string;
  currentQuantity: number;
  minimumStock: number;
  maximumStock: number | null;
  classification: LowStockClassification;
  suggestedPurchase: number;
  latestAdjustmentType: InventoryAdjustmentType | null;
};

export type LowStockAssistantFilters = {
  search: string;
  storageLocationId: string;
  categoryId: string;
  supplierId: string;
  adjustmentType: "all" | InventoryAdjustmentType | "none";
  classifications: LowStockClassification[];
};

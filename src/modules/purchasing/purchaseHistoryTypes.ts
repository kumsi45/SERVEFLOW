export type PurchaseHistoryStatus =
  | "draft"
  | "approved"
  | "partially_received"
  | "completed"
  | "cancelled";

export type PurchaseHistoryLine = {
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  orderedQuantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
  purchaseUnitId: string;
  purchaseUnitName: string;
  unitPrice: number;
  lineTotal: number;
  sortOrder: number;
};

export type PurchaseHistoryRecord = {
  id: string;
  restaurantId: string;
  purchaseNumber: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseHistoryStatus;
  expectedDeliveryDate: string;
  notes: string | null;
  createdByStaffId: string;
  createdByName: string;
  createdAt: string;
  firstReceivedAt: string | null;
  receivedAt: string | null;
  receivedByNames: string | null;
  itemCount: number;
  totalCost: number;
  receivedCost: number;
  remainingCost: number;
  lines: PurchaseHistoryLine[];
};

export type PurchaseHistorySort = "newest" | "oldest" | "highest_cost" | "lowest_cost";

export type PurchaseHistoryFilters = {
  search: string;
  supplierId: string;
  status: "all" | PurchaseHistoryStatus;
  dateFrom: string;
  dateTo: string;
  createdByStaffId: string;
  sort: PurchaseHistorySort;
};

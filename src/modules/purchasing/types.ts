export type PurchaseOrderDraftLine = {
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  purchaseUnitId: string;
  purchaseUnitName: string;
  quantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
  unitPrice: number;
  lineTotal: number;
  sortOrder: number;
};

export type PurchaseOrderDraft = {
  id: string;
  restaurantId: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  expectedDeliveryDate: string;
  notes: string | null;
  createdByStaffId: string;
  createdByName: string;
  updatedByStaffId: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
  lineCount: number;
  total: number;
  receivedTotal: number;
  remainingTotal: number;
  lines: PurchaseOrderDraftLine[];
};

export type PurchaseOrderStatus = "draft" | "partially_received" | "completed";

export type PurchaseOrderDraftFormLine = {
  inventoryItemId: string;
  purchaseUnitId: string;
  quantity: string;
  unitPrice: string;
};

export type PurchaseOrderDraftForm = {
  id?: string;
  supplierId: string;
  expectedDeliveryDate: string;
  notes: string;
  lines: PurchaseOrderDraftFormLine[];
};

export type PurchaseOrderReceiptFormLine = {
  purchaseOrderItemId: string;
  inventoryItemName: string;
  purchaseUnitName: string;
  orderedQuantity: number;
  alreadyReceivedQuantity: number;
  remainingQuantity: number;
  storageLocationName: string;
  receivedQuantity: string;
};

export type PurchaseOrderReceiptForm = {
  purchaseOrderId: string;
  notes: string;
  lines: PurchaseOrderReceiptFormLine[];
};

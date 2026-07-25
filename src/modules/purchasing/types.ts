export type PurchaseOrderDraftLine = {
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  purchaseUnitId: string;
  purchaseUnitName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  sortOrder: number;
};

export type PurchaseOrderDraft = {
  id: string;
  restaurantId: string;
  supplierId: string;
  supplierName: string;
  status: "draft";
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
  lines: PurchaseOrderDraftLine[];
};

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

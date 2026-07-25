export type InventoryStatus = "active" | "archived" | "deleted";

export type InventorySection =
  | "dashboard"
  | "items"
  | "current-stock"
  | "movements"
  | "stock-in"
  | "stock-out"
  | "adjustments"
  | "waste"
  | "transfers"
  | "ledger"
  | "movement-history"
  | "purchase-orders"
  | "categories"
  | "suppliers"
  | "storage-locations"
  | "units";

export type InventoryMovementType =
  | "opening_balance"
  | "stock_in"
  | "stock_out"
  | "transfer_in"
  | "transfer_out"
  | "adjustment_increase"
  | "adjustment_decrease"
  | "waste"
  | "spoilage"
  | "manual_correction"
  | "closing_balance";

export type InventoryQuantityEffect = "in" | "out";

export type InventoryStockStatus = "out_of_stock" | "low_stock" | "in_stock" | "over_stock";

export type InventorySortKey =
  | "recent"
  | "alphabetical"
  | "category"
  | "supplier"
  | "storage"
  | "status";

export type InventoryMasterRecord = {
  id: string;
  restaurantId: string;
  name: string;
  description: string | null;
  status: InventoryStatus;
  createdAt: string;
  updatedAt: string;
};

export type InventoryCategory = InventoryMasterRecord & {
  sortOrder: number;
};

export type InventorySupplier = Omit<InventoryMasterRecord, "description"> & {
  phone: string | null;
  address: string | null;
  contactPerson: string | null;
  notes: string | null;
};

export type InventoryStorageLocation = InventoryMasterRecord;

export type InventoryUnit = InventoryMasterRecord & {
  pluralName: string | null;
  abbreviation: string | null;
  active: boolean;
};

export type InventoryItem = {
  id: string;
  restaurantId: string;
  name: string;
  categoryId: string;
  unitId: string;
  storageLocationId: string;
  preferredSupplierId: string | null;
  sku: string | null;
  barcode: string | null;
  minimumStock: number;
  maximumStock: number | null;
  purchasePrice: number;
  description: string | null;
  status: InventoryStatus;
  createdByStaffId: string | null;
  updatedByStaffId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InventoryAdminData = {
  items: InventoryItem[];
  categories: InventoryCategory[];
  suppliers: InventorySupplier[];
  storageLocations: InventoryStorageLocation[];
  units: InventoryUnit[];
  staffNames: Record<string, string>;
};

export type InventoryCurrentStockRow = {
  inventoryItemId: string;
  itemName: string;
  categoryId: string | null;
  categoryName: string | null;
  storageLocationId: string;
  storageLocationName: string;
  unitId: string;
  unitName: string;
  minimumStock: number;
  maximumStock: number | null;
  currentQuantity: number;
  stockStatus: InventoryStockStatus;
  lastMovementAt: string | null;
};

export type InventoryLedgerEntry = {
  id: string;
  inventoryItemId: string;
  itemName: string;
  storageLocationId: string;
  storageLocationName: string;
  supplierId: string | null;
  supplierName: string | null;
  movementType: InventoryMovementType;
  quantity: number;
  quantityEffect: InventoryQuantityEffect;
  signedQuantity: number;
  unitName: string;
  referenceNumber: string | null;
  invoiceNumber: string | null;
  reason: string | null;
  notes: string | null;
  transferGroupId: string | null;
  movementDate: string;
  createdByStaffId: string;
  staffName: string | null;
};

export type InventoryOperationsData = InventoryAdminData & {
  currentStock: InventoryCurrentStockRow[];
  ledger: InventoryLedgerEntry[];
};

export type InventoryFoodConsumptionMovement = {
  id: string;
  restaurantId: string;
  inventoryItemId: string;
  inventoryItemName: string;
  menuItemId: string;
  menuItemName: string;
  recipeId: string | null;
  recipeName: string | null;
  orderId: string;
  orderNumber: string;
  orderItemId: string;
  diningSessionId: string;
  diningSessionNumber: string;
  kitchenBatchId: string;
  waiterId: string | null;
  waiterName: string | null;
  cashierId: string | null;
  cashierName: string | null;
  kitchenStationId: string | null;
  kitchenStationName: string | null;
  performedByStaffId: string;
  performedByName: string;
  movementType: "FOOD_CONSUMPTION";
  quantity: number;
  unit: string;
  quantityBefore: number;
  quantityAfter: number;
  createdAt: string;
  workflowSnapshot: Record<string, unknown>;
  notes: string | null;
};

export type InventoryIntegrityCheckResult = {
  checkCode: string;
  checkName: string;
  checkStatus: "PASS" | "DETECTED_ISSUES";
  issueCount: number;
  details: { samples: Array<{ entity_id: string; detail: Record<string, unknown> }> };
};

export type InventoryItemDraft = {
  id?: string;
  name: string;
  categoryId: string;
  unitId: string;
  storageLocationId: string;
  preferredSupplierId: string;
  sku: string;
  barcode: string;
  minimumStock: string;
  maximumStock: string;
  purchasePrice: string;
  description: string;
};

export type InventoryCategoryDraft = {
  id?: string;
  name: string;
  description: string;
  sortOrder: string;
};

export type InventorySupplierDraft = {
  id?: string;
  name: string;
  phone: string;
  address: string;
  contactPerson: string;
  notes: string;
};

export type InventorySimpleDraft = {
  id?: string;
  name: string;
  description: string;
};

export type InventoryFilters = {
  search: string;
  categoryId: string;
  supplierId: string;
  storageLocationId: string;
  status: "all" | InventoryStatus;
  archived: "all" | "active" | "archived";
  recentlyAdded: boolean;
  sort: InventorySortKey;
};

export type StockMovementDraft = {
  inventoryItemId: string;
  storageLocationId: string;
  movementType: InventoryMovementType;
  quantity: string;
  quantityEffect: InventoryQuantityEffect;
  supplierId: string;
  referenceNumber: string;
  invoiceNumber: string;
  reason: string;
  notes: string;
  movementDate: string;
};

export type InventoryAdjustmentDraft = {
  inventoryItemId: string;
  storageLocationId: string;
  direction: "increase" | "decrease";
  quantity: string;
  reason: string;
  notes: string;
  movementDate: string;
};

export type InventoryWasteDraft = {
  inventoryItemId: string;
  storageLocationId: string;
  quantity: string;
  reason: string;
  isSpoilage: boolean;
  notes: string;
  movementDate: string;
};

export type InventoryTransferDraft = {
  inventoryItemId: string;
  fromStorageLocationId: string;
  toStorageLocationId: string;
  quantity: string;
  referenceNumber: string;
  reason: string;
  notes: string;
  movementDate: string;
};

export type InventoryOpeningBalanceDraft = {
  inventoryItemId: string;
  storageLocationId: string;
  quantity: string;
  referenceNumber: string;
  notes: string;
  movementDate: string;
};

export type InventoryAdjustmentDirection = "increase" | "decrease";

export type InventoryAdjustmentType =
  | "opening_stock"
  | "manual_correction"
  | "donation_received"
  | "supplier_replacement"
  | "waste"
  | "spoilage"
  | "expired"
  | "breakage"
  | "theft"
  | "returned_to_supplier";

export type InventoryAdjustmentMovementType =
  | "MANUAL_ADJUSTMENT_IN"
  | "MANUAL_ADJUSTMENT_OUT"
  | "WASTE"
  | "SPOILAGE"
  | "RETURN_TO_SUPPLIER";

export type InventoryAdjustmentHistoryItem = {
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  unitId: string;
  unitName: string;
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  movementAuditType: InventoryAdjustmentMovementType;
  movementId: string;
};

export type InventoryAdjustment = {
  id: string;
  restaurantId: string;
  direction: InventoryAdjustmentDirection;
  adjustmentType: InventoryAdjustmentType;
  reason: string;
  notes: string | null;
  status: "confirmed";
  createdBy: string;
  createdByName: string;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  createdAt: string;
  itemCount: number;
  totalQuantity: number;
  items: InventoryAdjustmentHistoryItem[];
};

export type InventoryAdjustmentFormLine = {
  inventoryItemId: string;
  quantity: string;
};

export type InventoryAdjustmentForm = {
  direction: InventoryAdjustmentDirection;
  adjustmentType: InventoryAdjustmentType | "";
  notes: string;
  lines: InventoryAdjustmentFormLine[];
};

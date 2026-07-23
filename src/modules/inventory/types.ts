export type InventoryStatus = "active" | "archived" | "deleted";

export type InventorySection =
  | "dashboard"
  | "items"
  | "categories"
  | "suppliers"
  | "storage-locations"
  | "units";

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

export type InventoryUnit = InventoryMasterRecord;

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

import { supabase } from "../../../core/database";
import type {
  InventoryAdminData,
  InventoryCategory,
  InventoryCategoryDraft,
  InventoryItem,
  InventoryItemDraft,
  InventorySimpleDraft,
  InventoryStatus,
  InventoryStorageLocation,
  InventorySupplier,
  InventorySupplierDraft,
  InventoryUnit,
} from "../types";

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function statusValue(value: unknown): InventoryStatus {
  return value === "archived" || value === "deleted" ? value : "active";
}

function errorMessage(error: { message?: string } | null | undefined) {
  return error?.message ?? "Inventory administration request failed.";
}

function mapCategory(row: Row): InventoryCategory {
  return {
    id: text(row.id),
    restaurantId: text(row.restaurant_id),
    name: text(row.name),
    description: nullableText(row.description),
    sortOrder: numberValue(row.sort_order, 1000),
    status: statusValue(row.status),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function mapSupplier(row: Row): InventorySupplier {
  return {
    id: text(row.id),
    restaurantId: text(row.restaurant_id),
    name: text(row.name),
    phone: nullableText(row.phone),
    address: nullableText(row.address),
    contactPerson: nullableText(row.contact_person),
    notes: nullableText(row.notes),
    status: statusValue(row.status),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function mapStorageLocation(row: Row): InventoryStorageLocation {
  return {
    id: text(row.id),
    restaurantId: text(row.restaurant_id),
    name: text(row.name),
    description: nullableText(row.description),
    status: statusValue(row.status),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function mapUnit(row: Row): InventoryUnit {
  return {
    id: text(row.id),
    restaurantId: text(row.restaurant_id),
    name: text(row.name),
    description: nullableText(row.description),
    status: statusValue(row.status),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function mapItem(row: Row): InventoryItem {
  return {
    id: text(row.id),
    restaurantId: text(row.restaurant_id),
    name: text(row.name),
    categoryId: text(row.category_id),
    unitId: text(row.unit_id),
    storageLocationId: text(row.storage_location_id),
    preferredSupplierId: nullableText(row.preferred_supplier_id),
    sku: nullableText(row.sku),
    barcode: nullableText(row.barcode),
    minimumStock: numberValue(row.minimum_stock),
    maximumStock: row.maximum_stock == null ? null : numberValue(row.maximum_stock),
    description: nullableText(row.description),
    status: statusValue(row.status),
    createdByStaffId: nullableText(row.created_by_staff_id),
    updatedByStaffId: nullableText(row.updated_by_staff_id),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

async function loadStaffNames(restaurantId: string, staffIds: string[]) {
  const uniqueIds = [...new Set(staffIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};
  const { data, error } = await supabase
    .from("restaurant_staff")
    .select("id,display_name,email,role")
    .eq("restaurant_id", restaurantId)
    .in("id", uniqueIds);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).reduce<Record<string, string>>((map, row) => {
    map[text(row.id)] = nullableText(row.display_name) ?? nullableText(row.email) ?? text(row.role);
    return map;
  }, {});
}

export async function loadInventoryAdminData(restaurantId: string): Promise<InventoryAdminData> {
  const [items, categories, suppliers, storageLocations, units] = await Promise.all([
    supabase
      .from("inventory_items")
      .select("id,restaurant_id,name,category_id,unit_id,storage_location_id,preferred_supplier_id,sku,barcode,minimum_stock,maximum_stock,description,status,created_by_staff_id,updated_by_staff_id,created_at,updated_at")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false }),
    supabase
      .from("inventory_categories")
      .select("id,restaurant_id,name,description,sort_order,status,created_at,updated_at")
      .eq("restaurant_id", restaurantId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("inventory_suppliers")
      .select("id,restaurant_id,name,phone,address,contact_person,notes,status,created_at,updated_at")
      .eq("restaurant_id", restaurantId)
      .order("name", { ascending: true }),
    supabase
      .from("inventory_storage_locations")
      .select("id,restaurant_id,name,description,status,created_at,updated_at")
      .eq("restaurant_id", restaurantId)
      .order("name", { ascending: true }),
    supabase
      .from("inventory_units")
      .select("id,restaurant_id,name,description,status,created_at,updated_at")
      .eq("restaurant_id", restaurantId)
      .order("name", { ascending: true }),
  ]);

  for (const response of [items, categories, suppliers, storageLocations, units]) {
    if (response.error) throw new Error(response.error.message);
  }

  const mappedItems = ((items.data ?? []) as Row[]).map(mapItem);
  const staffNames = await loadStaffNames(
    restaurantId,
    mappedItems.flatMap((item) => [item.createdByStaffId ?? "", item.updatedByStaffId ?? ""]),
  );

  return {
    items: mappedItems,
    categories: ((categories.data ?? []) as Row[]).map(mapCategory),
    suppliers: ((suppliers.data ?? []) as Row[]).map(mapSupplier),
    storageLocations: ((storageLocations.data ?? []) as Row[]).map(mapStorageLocation),
    units: ((units.data ?? []) as Row[]).map(mapUnit),
    staffNames,
  };
}

export async function saveInventoryCategory(restaurantId: string, draft: InventoryCategoryDraft) {
  const payload = {
    restaurant_id: restaurantId,
    name: draft.name.trim(),
    description: nullableText(draft.description),
    sort_order: draft.sortOrder.trim() ? Number(draft.sortOrder) : 1000,
  };
  const query = draft.id
    ? supabase.from("inventory_categories").update(payload).eq("restaurant_id", restaurantId).eq("id", draft.id)
    : supabase.from("inventory_categories").insert(payload);
  const { error } = await query;
  if (error) throw new Error(errorMessage(error));
}

export async function saveInventorySupplier(restaurantId: string, draft: InventorySupplierDraft) {
  const payload = {
    restaurant_id: restaurantId,
    name: draft.name.trim(),
    phone: nullableText(draft.phone),
    address: nullableText(draft.address),
    contact_person: nullableText(draft.contactPerson),
    notes: nullableText(draft.notes),
  };
  const query = draft.id
    ? supabase.from("inventory_suppliers").update(payload).eq("restaurant_id", restaurantId).eq("id", draft.id)
    : supabase.from("inventory_suppliers").insert(payload);
  const { error } = await query;
  if (error) throw new Error(errorMessage(error));
}

export async function saveInventoryStorageLocation(restaurantId: string, draft: InventorySimpleDraft) {
  const payload = {
    restaurant_id: restaurantId,
    name: draft.name.trim(),
    description: nullableText(draft.description),
  };
  const query = draft.id
    ? supabase.from("inventory_storage_locations").update(payload).eq("restaurant_id", restaurantId).eq("id", draft.id)
    : supabase.from("inventory_storage_locations").insert(payload);
  const { error } = await query;
  if (error) throw new Error(errorMessage(error));
}

export async function saveInventoryUnit(restaurantId: string, draft: InventorySimpleDraft) {
  const payload = {
    restaurant_id: restaurantId,
    name: draft.name.trim(),
    description: nullableText(draft.description),
  };
  const query = draft.id
    ? supabase.from("inventory_units").update(payload).eq("restaurant_id", restaurantId).eq("id", draft.id)
    : supabase.from("inventory_units").insert(payload);
  const { error } = await query;
  if (error) throw new Error(errorMessage(error));
}

export async function saveInventoryItem(restaurantId: string, draft: InventoryItemDraft, unitName: string) {
  const payload = {
    restaurant_id: restaurantId,
    name: draft.name.trim(),
    category_id: draft.categoryId,
    unit_id: draft.unitId,
    unit: unitName,
    storage_location_id: draft.storageLocationId,
    preferred_supplier_id: nullableText(draft.preferredSupplierId),
    sku: nullableText(draft.sku),
    barcode: nullableText(draft.barcode),
    minimum_stock: Number(draft.minimumStock || 0),
    maximum_stock: draft.maximumStock.trim() ? Number(draft.maximumStock) : null,
    description: nullableText(draft.description),
  };
  const query = draft.id
    ? supabase.from("inventory_items").update(payload).eq("restaurant_id", restaurantId).eq("id", draft.id)
    : supabase.from("inventory_items").insert(payload);
  const { error } = await query;
  if (error) throw new Error(errorMessage(error));
}

export async function setInventoryRecordStatus(
  restaurantId: string,
  table:
    | "inventory_items"
    | "inventory_categories"
    | "inventory_suppliers"
    | "inventory_storage_locations"
    | "inventory_units",
  id: string,
  status: InventoryStatus,
) {
  const { error } = await supabase
    .from(table)
    .update({ status })
    .eq("restaurant_id", restaurantId)
    .eq("id", id);
  if (error) throw new Error(errorMessage(error));
}

export async function bulkSetInventoryItemStatus(
  restaurantId: string,
  ids: string[],
  status: InventoryStatus,
) {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from("inventory_items")
    .update({ status })
    .eq("restaurant_id", restaurantId)
    .in("id", ids);
  if (error) throw new Error(errorMessage(error));
}

export async function duplicateInventoryItem(
  restaurantId: string,
  item: InventoryItem,
  unitName: string,
  copyName: string,
) {
  const { error } = await supabase.from("inventory_items").insert({
    restaurant_id: restaurantId,
    name: copyName,
    category_id: item.categoryId,
    unit_id: item.unitId,
    unit: unitName,
    storage_location_id: item.storageLocationId,
    preferred_supplier_id: item.preferredSupplierId,
    minimum_stock: item.minimumStock,
    maximum_stock: item.maximumStock,
    description: item.description,
  });
  if (error) throw new Error(errorMessage(error));
}

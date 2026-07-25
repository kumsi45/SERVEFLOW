import { supabase } from "../../../core/database";
import type {
  PurchaseHistoryFilters,
  PurchaseHistoryLine,
  PurchaseHistoryRecord,
  PurchaseHistoryStatus,
} from "../purchaseHistoryTypes";

type Row = Record<string, unknown>;

const text = (value: unknown) => typeof value === "string" ? value : "";
const nullableText = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
const numberValue = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

function mapLine(row: Row): PurchaseHistoryLine {
  return {
    id: text(row.id),
    inventoryItemId: text(row.inventory_item_id),
    inventoryItemName: text(row.inventory_item_name),
    orderedQuantity: numberValue(row.ordered_quantity),
    receivedQuantity: numberValue(row.received_quantity),
    remainingQuantity: numberValue(row.remaining_quantity),
    purchaseUnitId: text(row.purchase_unit_id),
    purchaseUnitName: text(row.purchase_unit_name),
    unitPrice: numberValue(row.unit_price),
    lineTotal: numberValue(row.line_total),
    sortOrder: numberValue(row.sort_order),
  };
}

export function mapPurchaseHistoryRow(row: Row): PurchaseHistoryRecord {
  return {
    id: text(row.id),
    restaurantId: text(row.restaurant_id),
    purchaseNumber: text(row.purchase_number),
    supplierId: text(row.supplier_id),
    supplierName: text(row.supplier_name),
    status: text(row.status) as PurchaseHistoryStatus,
    expectedDeliveryDate: text(row.expected_delivery_date),
    notes: nullableText(row.notes),
    createdByStaffId: text(row.created_by_staff_id),
    createdByName: text(row.created_by_name),
    createdAt: text(row.created_at),
    firstReceivedAt: nullableText(row.first_received_at),
    receivedAt: nullableText(row.received_at),
    receivedByNames: nullableText(row.received_by_names),
    itemCount: numberValue(row.item_count),
    totalCost: numberValue(row.total_cost),
    receivedCost: numberValue(row.received_cost),
    remainingCost: numberValue(row.remaining_cost),
    lines: Array.isArray(row.lines) ? (row.lines as Row[]).map(mapLine) : [],
  };
}

export async function loadPurchaseHistory(restaurantId: string) {
  const { data, error } = await supabase.rpc("get_purchase_history", {
    target_restaurant_id: restaurantId,
  });
  if (error) throw new Error(error.message || "Purchase history is unavailable.");
  return ((data ?? []) as Row[]).map(mapPurchaseHistoryRow);
}

export function filterAndSortPurchaseHistory(
  records: PurchaseHistoryRecord[],
  filters: PurchaseHistoryFilters,
) {
  const query = filters.search.trim().toLowerCase();
  const fromTime = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`).getTime() : null;
  const toTime = filters.dateTo
    ? new Date(`${filters.dateTo}T00:00:00`).getTime() + 24 * 60 * 60 * 1000
    : null;
  const filtered = records.filter((purchase) => {
    if (filters.supplierId && purchase.supplierId !== filters.supplierId) return false;
    if (filters.status !== "all" && purchase.status !== filters.status) return false;
    if (filters.createdByStaffId && purchase.createdByStaffId !== filters.createdByStaffId) return false;
    const created = new Date(purchase.createdAt).getTime();
    if (fromTime !== null && created < fromTime) return false;
    if (toTime !== null && created >= toTime) return false;
    if (!query) return true;
    return [
      purchase.purchaseNumber,
      purchase.supplierName,
      ...purchase.lines.map((line) => line.inventoryItemName),
    ].some((value) => value.toLowerCase().includes(query));
  });

  return [...filtered].sort((left, right) => {
    if (filters.sort === "oldest") return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    if (filters.sort === "highest_cost") return right.totalCost - left.totalCost;
    if (filters.sort === "lowest_cost") return left.totalCost - right.totalCost;
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
}

function csvCell(value: string | number | null) {
  const normalized = value === null ? "" : String(value);
  return `"${normalized.replace(/"/g, '""')}"`;
}

export function purchaseHistoryCsv(records: PurchaseHistoryRecord[]) {
  const header = [
    "Purchase Number", "Supplier", "Status", "Created By", "Created Date",
    "Received Date", "Received By", "Inventory Item", "Ordered Quantity",
    "Received Quantity", "Remaining Quantity", "Purchase Unit", "Unit Price",
    "Line Total", "Overall Total",
  ];
  const rows = records.flatMap((purchase) => {
    const lines: Array<PurchaseHistoryLine | null> = purchase.lines.length ? purchase.lines : [null];
    return lines.map((line) => [
      purchase.purchaseNumber,
      purchase.supplierName,
      purchase.status,
      purchase.createdByName,
      purchase.createdAt,
      purchase.receivedAt,
      purchase.receivedByNames,
      line?.inventoryItemName ?? null,
      line?.orderedQuantity ?? null,
      line?.receivedQuantity ?? null,
      line?.remainingQuantity ?? null,
      line?.purchaseUnitName ?? null,
      line?.unitPrice ?? null,
      line?.lineTotal ?? null,
      purchase.totalCost,
    ]);
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function exportPurchaseHistoryCsv(records: PurchaseHistoryRecord[]) {
  const csv = purchaseHistoryCsv(records);
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `purchase-history-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

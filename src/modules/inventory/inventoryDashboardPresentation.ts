import type { PurchaseHistoryRecord } from "../purchasing/purchaseHistoryTypes";
import type { LowStockAssistantRow } from "./lowStockAssistantTypes";
import type { InventoryCurrentStockRow, InventoryItem, InventorySupplier } from "./types";

export type InventoryDashboardKpis = {
  totalInventoryValue: number;
  totalInventoryItems: number;
  lowStockItems: number;
  outOfStockItems: number;
  activeSuppliers: number;
  pendingPurchaseOrders: number;
};

export function calculateInventoryDashboardKpis(args: {
  items: InventoryItem[];
  currentStock: InventoryCurrentStockRow[];
  stockLevels: LowStockAssistantRow[];
  suppliers: InventorySupplier[];
  purchases: PurchaseHistoryRecord[];
}): InventoryDashboardKpis {
  const prices = new Map(args.items.map((item) => [item.id, item.purchasePrice]));
  const totalInventoryValue = args.currentStock.reduce((total, row) => (
    total + Math.max(0, row.currentQuantity) * (prices.get(row.inventoryItemId) ?? 0)
  ), 0);

  return {
    totalInventoryValue: Math.round((totalInventoryValue + Number.EPSILON) * 100) / 100,
    totalInventoryItems: args.items.filter((item) => item.status !== "deleted").length,
    lowStockItems: args.stockLevels.filter((row) => row.classification === "critical" || row.classification === "low").length,
    outOfStockItems: args.stockLevels.filter((row) => row.classification === "out_of_stock").length,
    activeSuppliers: args.suppliers.filter((supplier) => supplier.status === "active").length,
    pendingPurchaseOrders: args.purchases.filter((purchase) => (
      purchase.status === "draft" || purchase.status === "approved" || purchase.status === "partially_received"
    )).length,
  };
}

const stockPriority: Record<LowStockAssistantRow["classification"], number> = {
  out_of_stock: 0,
  critical: 1,
  low: 2,
  healthy: 3,
};

export function stockAttentionRows(rows: LowStockAssistantRow[]) {
  return [...rows]
    .filter((row) => row.classification !== "healthy")
    .sort((left, right) => stockPriority[left.classification] - stockPriority[right.classification]
      || left.currentQuantity - right.currentQuantity
      || left.itemName.localeCompare(right.itemName));
}

export function inventoryStatusLabel(status: string) {
  const labels: Record<string, string> = {
    healthy: "Healthy",
    in_stock: "Healthy",
    low: "Low Stock",
    low_stock: "Low Stock",
    critical: "Critical",
    out_of_stock: "Out of Stock",
    archived: "Archived",
    draft: "Draft",
    completed: "Completed",
    partially_received: "Partially Received",
    approved: "Approved",
  };
  return labels[status] ?? status.replace(/_/g, " ");
}

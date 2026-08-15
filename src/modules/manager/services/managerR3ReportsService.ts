import type { ReportingPeriodWindow } from "../../../core/analytics/historicalAnalytics";
import { supabase } from "../../../core/database";
import type { ManagerReportQuality } from "./managerFinancialReportsService";

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord => value && typeof value === "object" ? value as JsonRecord : {};
const array = (value: unknown): JsonRecord[] => Array.isArray(value) ? value as JsonRecord[] : [];
const text = (value: unknown) => typeof value === "string" ? value : "";
const nullableText = (value: unknown) => typeof value === "string" && value ? value : null;
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const nullableNumber = (value: unknown) => value == null ? null : number(value);
const quality = (value: unknown): ManagerReportQuality =>
  value === "complete" || value === "mixed_legacy" || value === "legacy_unknown" || value === "unavailable"
    ? value
    : "unavailable";

export type ManagerMenuPerformanceRow = {
  menuItemId: string;
  menuItemName: string;
  categoryId: string;
  categoryName: string;
  currentStatus: "Available" | "Sold Out" | "Hidden";
  currentQuantity: number;
  comparisonQuantity: number;
  quantityChange: number;
  quantityChangePercent: number | null;
  currentSales: number;
  comparisonSales: number;
  salesChange: number;
  salesChangePercent: number | null;
  currentOrders: number;
  comparisonOrders: number;
  currentOrderItemCount: number;
  comparisonOrderItemCount: number;
};

export type ManagerMenuCategoryRow = {
  categoryId: string;
  categoryName: string;
  currentQuantity: number;
  comparisonQuantity: number;
  currentSales: number;
  comparisonSales: number;
  currentOrderItemCount: number;
  comparisonOrderItemCount: number;
  currentOrders: number;
  comparisonOrders: number;
};

export type ManagerMenuPerformanceReport = {
  generatedAt: string;
  rangeStart: string;
  rangeEnd: string;
  comparisonRangeStart: string;
  comparisonRangeEnd: string;
  items: ManagerMenuPerformanceRow[];
  topByQuantity: ManagerMenuPerformanceRow[];
  topBySales: ManagerMenuPerformanceRow[];
  lowSelling: ManagerMenuPerformanceRow[];
  zeroRecordedSales: ManagerMenuPerformanceRow[];
  categories: ManagerMenuCategoryRow[];
  availabilityHistoryAvailable: false;
  dataQuality: {
    historicalPriceQuality: ManagerReportQuality;
    availabilityHistoryQuality: ManagerReportQuality;
    itemIdentityHistoryQuality: ManagerReportQuality;
    legacyOrderItemQuality: ManagerReportQuality;
  };
};

function menuItem(value: unknown): ManagerMenuPerformanceRow {
  const row = record(value);
  return {
    menuItemId: text(row.menu_item_id), menuItemName: text(row.menu_item_name),
    categoryId: text(row.category_id), categoryName: text(row.category_name),
    currentStatus: (text(row.current_status) || "Hidden") as ManagerMenuPerformanceRow["currentStatus"],
    currentQuantity: number(row.current_quantity), comparisonQuantity: number(row.comparison_quantity),
    quantityChange: number(row.quantity_change), quantityChangePercent: nullableNumber(row.quantity_change_percent),
    currentSales: number(row.current_sales), comparisonSales: number(row.comparison_sales),
    salesChange: number(row.sales_change), salesChangePercent: nullableNumber(row.sales_change_percent),
    currentOrders: number(row.current_orders), comparisonOrders: number(row.comparison_orders),
    currentOrderItemCount: number(row.current_order_item_count), comparisonOrderItemCount: number(row.comparison_order_item_count),
  };
}

export function parseManagerMenuPerformanceReport(value: unknown): ManagerMenuPerformanceReport {
  const payload = record(value);
  if (typeof payload.error === "string") throw new Error(payload.error);
  const dataQuality = record(payload.data_quality);
  const category = (value: unknown): ManagerMenuCategoryRow => {
    const row = record(value);
    return {
      categoryId: text(row.category_id), categoryName: text(row.category_name),
      currentQuantity: number(row.current_quantity), comparisonQuantity: number(row.comparison_quantity),
      currentSales: number(row.current_sales), comparisonSales: number(row.comparison_sales),
      currentOrderItemCount: number(row.current_order_item_count), comparisonOrderItemCount: number(row.comparison_order_item_count),
      currentOrders: number(row.current_orders), comparisonOrders: number(row.comparison_orders),
    };
  };
  return {
    generatedAt: text(payload.generated_at), rangeStart: text(payload.range_start), rangeEnd: text(payload.range_end),
    comparisonRangeStart: text(payload.comparison_range_start), comparisonRangeEnd: text(payload.comparison_range_end),
    items: array(payload.items).map(menuItem), topByQuantity: array(payload.top_by_quantity).map(menuItem),
    topBySales: array(payload.top_by_sales).map(menuItem), lowSelling: array(payload.low_selling).map(menuItem),
    zeroRecordedSales: array(payload.zero_recorded_sales).map(menuItem), categories: array(payload.categories).map(category),
    availabilityHistoryAvailable: false,
    dataQuality: {
      historicalPriceQuality: quality(dataQuality.historical_price_quality),
      availabilityHistoryQuality: quality(dataQuality.availability_history_quality),
      itemIdentityHistoryQuality: quality(dataQuality.item_identity_history_quality),
      legacyOrderItemQuality: quality(dataQuality.legacy_order_item_quality),
    },
  };
}

export type ManagerCashierPeriodShift = {
  id: string;
  cashierId: string;
  cashierName: string;
  employeeId: string | null;
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  cashSales: number;
  cashRefunds: number;
  nonCashSales: number;
  expenseCount: number;
  approvedExpenses: number;
  pendingExpenses: number;
  rejectedExpenses: number;
  expectedCash: number;
  actualCash: number | null;
  variance: number | null;
  status: "open" | "closed";
  reconciliationStatus: "not_yet_reconciled" | "reconciled" | "missing_reconciliation";
};

export type ManagerCashierPeriodReport = {
  generatedAt: string;
  rangeStart: string;
  rangeEnd: string;
  shifts: ManagerCashierPeriodShift[];
  expenses: JsonRecord[];
  handovers: JsonRecord[];
  reconciliations: JsonRecord[];
  events: JsonRecord[];
};

export function parseManagerCashierPeriodReport(value: unknown): ManagerCashierPeriodReport {
  const payload = record(value);
  if (typeof payload.error === "string") throw new Error(payload.error);
  return {
    generatedAt: text(payload.generated_at), rangeStart: text(payload.range_start), rangeEnd: text(payload.range_end),
    shifts: array(payload.shifts).map((row) => ({
      id: text(row.id), cashierId: text(row.cashier_id), cashierName: text(row.cashier_name) || "Cashier",
      employeeId: nullableText(row.employee_id), openedAt: text(row.opened_at), closedAt: nullableText(row.closed_at),
      openingCash: number(row.opening_cash), cashSales: number(row.cash_sales), cashRefunds: number(row.cash_refunds),
      nonCashSales: number(row.non_cash_sales), expenseCount: number(row.expense_count),
      approvedExpenses: number(row.approved_expenses), pendingExpenses: number(row.pending_expenses),
      rejectedExpenses: number(row.rejected_expenses), expectedCash: number(row.expected_cash),
      actualCash: nullableNumber(row.actual_cash), variance: nullableNumber(row.variance),
      status: text(row.status) as ManagerCashierPeriodShift["status"],
      reconciliationStatus: text(row.reconciliation_status) as ManagerCashierPeriodShift["reconciliationStatus"],
    })),
    expenses: array(payload.expenses), handovers: array(payload.handovers),
    reconciliations: array(payload.reconciliations), events: array(payload.events),
  };
}

export async function loadManagerMenuPerformanceReport(restaurantId: string, window: ReportingPeriodWindow) {
  const { data, error } = await supabase.rpc("get_manager_menu_performance_report", {
    target_restaurant_id: restaurantId, range_start: window.rangeStart, range_end: window.rangeEnd,
    comparison_range_start: window.comparisonRangeStart, comparison_range_end: window.comparisonRangeEnd,
  });
  if (error) throw new Error(error.message);
  return parseManagerMenuPerformanceReport(data);
}

export async function loadManagerCashierPeriodReport(restaurantId: string, window: ReportingPeriodWindow) {
  const { data, error } = await supabase.rpc("get_manager_cashier_period_report", {
    target_restaurant_id: restaurantId, range_start: window.rangeStart, range_end: window.rangeEnd,
  });
  if (error) throw new Error(error.message);
  return parseManagerCashierPeriodReport(data);
}

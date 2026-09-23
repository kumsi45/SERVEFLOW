import { supabase } from "../../../core/database";

export type OwnerReportsPeriodKey = "today" | "yesterday" | "week" | "month" | "custom";
export type OwnerReportsQualityState = "available" | "partial" | "no_activity" | "unavailable";

export type OwnerReportsQuality = {
  state: OwnerReportsQualityState;
  completeness: "complete" | "in_progress";
  history: string;
  attribution: string;
  affectedCount: number;
  unknownCount: number;
  notices: string[];
};

export type OwnerReportsPeriod = {
  requestedPeriod: OwnerReportsPeriodKey;
  currentStart: string;
  currentEnd: string;
  comparisonStart: string;
  comparisonEnd: string;
  timezone: string;
  completeness: "complete" | "in_progress";
  granularity: "hour" | "day" | "week";
  durationSecondsEqual: boolean;
};

export type OwnerReportsMetricComparison = {
  collectedSales: number;
  collectedInvoices: number;
  averageCollectedInvoice: number | null;
  ordersStarted: number;
  refundAmount: number;
  refundCount: number;
  collectedSalesPercentChange: number | null;
};

export type OwnerReportsReadModel = {
  contractVersion: "owner_reports_v1";
  generatedAt: string;
  currency: string;
  period: OwnerReportsPeriod;
  summary: {
    collectedSales: number;
    collectedInvoices: number;
    averageCollectedInvoice: number | null;
    ordersStarted: number;
    refundAmount: number;
    refundCount: number;
    comparison: OwnerReportsMetricComparison;
    quality: OwnerReportsQuality;
  };
  salesAndOrders: {
    granularity: OwnerReportsPeriod["granularity"];
    buckets: Array<{ bucketStart: string; bucketLocalStart: string; collectedSales: number; collectedInvoices: number; ordersStarted: number }>;
    quality: OwnerReportsQuality;
  };
  menu: {
    identityBasis: "current_catalog";
    topSelling: OwnerReportsMenuRow[];
    currentMenuItemsWithLowestRecordedSales: OwnerReportsMenuRow[];
    categories: Array<{ categoryKey: string; name: string; quantity: number; itemLineSalesValue: number }>;
    legacyUnattributedItemCount: number;
    quality: OwnerReportsQuality;
  };
  operations: {
    orderSources: Array<{ source: string; ordersStarted: number }>;
    tableActivity: { busiestByOrdersStarted: OwnerReportsTableRow[]; topByCollectedSales: OwnerReportsTableRow[] };
    kitchen: OwnerReportsKitchen;
    quality: OwnerReportsQuality;
  };
  payments: { methods: OwnerReportsPaymentMethod[]; quality: OwnerReportsQuality };
  feedback: OwnerReportsFeedbackSummary;
  detailAvailability: { feedbackPage: boolean; staffOperationsPage: boolean };
  definitions: Record<string, string>;
};

export type OwnerReportsMenuRow = { menuItemKey: string | null; name: string; category: string; archived?: boolean; quantity: number; itemLineSalesValue: number };
export type OwnerReportsTableRow = { tableKey: string; label: string; identityBasis: string; ordersStarted?: number; collectedSales?: number; collectedInvoices?: number };
export type OwnerReportsKitchen = {
  completedItems: number; timedItems: number; untimedItems: number; timingCoveragePercent: number | null;
  averagePreparationMinutes: number | null; medianPreparationMinutes: number | null;
  stations: Array<{ stationKey: string; name: string; identityBasis: string; completedItems: number; timedItems: number; averagePreparationMinutes: number | null; medianPreparationMinutes: number | null }>;
  quality: OwnerReportsQuality;
};
export type OwnerReportsPaymentMethod = { methodIdentity: string | null; methodCode: string | null; displayLabel: string; classification: "known_configured" | "legacy_unrecognized" | "unknown_unclassified"; currentlyEnabled: boolean | null; collectedAmount: number; collectedInvoices: number; sharePercent: number | null };
export type OwnerReportsFeedbackSummary = { reviewCount: number; averageOrderExperienceRating: number | null; ratingDistribution: Array<{ rating: number; reviewCount: number }>; comparison: { reviewCount: number; averageOrderExperienceRating: number | null }; detailAvailable: boolean; quality: OwnerReportsQuality };

export type OwnerReportsFeedbackCursor = { createdAt: string; id: string };
export type OwnerReportsFeedbackPage = { contractVersion: "owner_reports_v1"; period: OwnerReportsPeriod; items: Array<{ rating: number; reactions: string[]; comment: string | null; hasPhoto: boolean; submittedAt: string }>; nextCursor: OwnerReportsFeedbackCursor | null; quality: OwnerReportsQuality };

export type OwnerReportsStaffCursor = { role: string; displayName: string; staffId: string };
export type OwnerReportsStaffOperation =
  | { role: "waiter"; displayName: string; employeeId: string | null; membershipState: "active" | "inactive"; operations: { ordersTaken: number } }
  | { role: "cashier"; displayName: string; employeeId: string | null; membershipState: "active" | "inactive"; operations: { settlementsHandled: number; collectedAmountHandled: number; financialShiftsOpened: number; financialShiftsClosed: number; reconciliationsCompleted: number; recordedVariance: number; expensesRecorded: number; handoversInitiated: number; handoversConfirmed: number; handoverDiscrepancies: number } }
  | { role: "kitchen"; displayName: string; employeeId: string | null; membershipState: "active" | "inactive"; operations: { itemsCompleted: number } };
export type OwnerReportsStaffPage = { contractVersion: "owner_reports_v1"; period: OwnerReportsPeriod; items: OwnerReportsStaffOperation[]; unattributedHistoricalActivity: { waiterOrdersTaken: number; cashierSettlements: number; kitchenItemsCompleted: number }; nextCursor: OwnerReportsStaffCursor | null; quality: OwnerReportsQuality };

export class OwnerReportsReadModelError extends Error {}

const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OwnerReportsReadModelError(`${label} is unavailable.`);
  return value as Record<string, unknown>;
};
const array = (value: unknown, label: string): unknown[] => Array.isArray(value) ? value : (() => { throw new OwnerReportsReadModelError(`${label} is unavailable.`); })();
const string = (value: unknown, label: string): string => typeof value === "string" && value ? value : (() => { throw new OwnerReportsReadModelError(`${label} is unavailable.`); })();
const nullableString = (value: unknown): string | null => typeof value === "string" ? value : null;
const number = (value: unknown, label: string): number => typeof value === "number" && Number.isFinite(value) ? value : (() => { throw new OwnerReportsReadModelError(`${label} is unavailable.`); })();
const nullableNumber = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const bool = (value: unknown, fallback = false): boolean => typeof value === "boolean" ? value : fallback;

function quality(value: unknown): OwnerReportsQuality {
  const row = object(value, "Report quality");
  const state = string(row.state, "Report quality");
  if (!["available", "partial", "no_activity"].includes(state)) throw new OwnerReportsReadModelError("Report quality is unavailable.");
  const completeness = string(row.periodCompleteness, "Report quality");
  if (!["complete", "in_progress"].includes(completeness)) throw new OwnerReportsReadModelError("Report quality is unavailable.");
  return { state: state as OwnerReportsQualityState, completeness: completeness as "complete" | "in_progress", history: nullableString(row.history) ?? "modern", attribution: nullableString(row.attribution) ?? "complete", affectedCount: nullableNumber(row.legacyCount) ?? 0, unknownCount: nullableNumber(row.unknownAttributionCount) ?? 0, notices: Array.isArray(row.limitations) ? row.limitations.filter((notice): notice is string => typeof notice === "string") : [] };
}

function period(value: unknown): OwnerReportsPeriod {
  const row = object(value, "Report period");
  const requestedPeriod = string(row.key, "Report period");
  const completeness = string(row.completeness, "Report period");
  const granularity = string(row.granularity, "Report period");
  if (!["today", "yesterday", "week", "month", "custom"].includes(requestedPeriod) || !["complete", "in_progress"].includes(completeness) || !["hour", "day", "week"].includes(granularity)) throw new OwnerReportsReadModelError("Report period is unavailable.");
  return { requestedPeriod: requestedPeriod as OwnerReportsPeriodKey, currentStart: string(row.currentStart, "Report period"), currentEnd: string(row.currentEnd, "Report period"), comparisonStart: string(row.comparisonStart, "Report period"), comparisonEnd: string(row.comparisonEnd, "Report period"), timezone: string(row.timezone, "Report period"), completeness: completeness as "complete" | "in_progress", granularity: granularity as OwnerReportsPeriod["granularity"], durationSecondsEqual: bool(row.durationSecondsEqual) };
}

const menuRow = (value: unknown): OwnerReportsMenuRow => { const row = object(value, "Menu data"); return { menuItemKey: nullableString(row.menuItemKey), name: string(row.name, "Menu data"), category: string(row.category, "Menu data"), archived: bool(row.archived), quantity: number(row.quantity, "Menu data"), itemLineSalesValue: number(row.itemLineSalesValue, "Menu data") }; };

function parseMain(value: unknown): OwnerReportsReadModel {
  const root = object(value, "Reports");
  if (root.contractVersion !== "owner_reports_v1") throw new OwnerReportsReadModelError("Reports are temporarily unavailable.");
  const summary = object(root.summary, "Business summary"); const comparison = object(summary.comparison, "Business comparison");
  const salesAndOrders = object(root.salesAndOrders, "Sales and orders"); const menu = object(root.menu, "Menu performance"); const operations = object(root.operations, "Operations"); const tableActivity = object(operations.tableActivity, "Table activity"); const kitchen = object(operations.kitchen, "Kitchen preparation"); const payments = object(root.payments, "Payment methods"); const feedback = object(root.feedback, "Customer feedback"); const feedbackComparison = object(feedback.comparison, "Customer feedback");
  return {
    contractVersion: "owner_reports_v1", generatedAt: string(root.generatedAt, "Reports"), currency: string(root.currency, "Reports"), period: period(root.period),
    summary: { collectedSales: number(summary.collectedSales, "Business summary"), collectedInvoices: number(summary.collectedInvoices, "Business summary"), averageCollectedInvoice: nullableNumber(summary.averageCollectedInvoice), ordersStarted: number(summary.ordersStarted, "Business summary"), refundAmount: number(summary.refundAmount, "Business summary"), refundCount: number(summary.refundCount, "Business summary"), comparison: { collectedSales: number(comparison.collectedSales, "Business comparison"), collectedInvoices: number(comparison.collectedInvoices, "Business comparison"), averageCollectedInvoice: nullableNumber(comparison.averageCollectedInvoice), ordersStarted: number(comparison.ordersStarted, "Business comparison"), refundAmount: number(comparison.refundAmount, "Business comparison"), refundCount: number(comparison.refundCount, "Business comparison"), collectedSalesPercentChange: nullableNumber(comparison.collectedSalesPercentChange) }, quality: quality(summary.quality) },
    salesAndOrders: { granularity: period(root.period).granularity, buckets: array(salesAndOrders.buckets, "Sales and orders").map((item) => { const row = object(item, "Sales and orders"); return { bucketStart: string(row.bucketStart, "Sales and orders"), bucketLocalStart: string(row.bucketLocalStart, "Sales and orders"), collectedSales: number(row.collectedSales, "Sales and orders"), collectedInvoices: number(row.collectedInvoices, "Sales and orders"), ordersStarted: number(row.ordersStarted, "Sales and orders") }; }), quality: quality(salesAndOrders.quality) },
    menu: { identityBasis: "current_catalog", topSelling: array(menu.topSelling, "Menu performance").map(menuRow), currentMenuItemsWithLowestRecordedSales: array(menu.currentMenuItemsWithLowestRecordedSales, "Menu performance").map(menuRow), categories: array(menu.categories, "Menu performance").map((item) => { const row = object(item, "Menu performance"); return { categoryKey: string(row.categoryKey, "Menu performance"), name: string(row.name, "Menu performance"), quantity: number(row.quantity, "Menu performance"), itemLineSalesValue: number(row.itemLineSalesValue, "Menu performance") }; }), legacyUnattributedItemCount: number(menu.legacyUnattributedItemCount, "Menu performance"), quality: quality(menu.quality) },
    operations: { orderSources: array(operations.orderSources, "Order sources").map((item) => { const row = object(item, "Order sources"); return { source: string(row.source, "Order sources"), ordersStarted: number(row.ordersStarted, "Order sources") }; }), tableActivity: { busiestByOrdersStarted: array(tableActivity.busiestByOrdersStarted, "Table activity").map((item) => { const row = object(item, "Table activity"); return { tableKey: string(row.tableKey, "Table activity"), label: string(row.label, "Table activity"), identityBasis: string(row.identityBasis, "Table activity"), ordersStarted: nullableNumber(row.ordersStarted) ?? undefined }; }), topByCollectedSales: array(tableActivity.topByCollectedSales, "Table activity").map((item) => { const row = object(item, "Table activity"); return { tableKey: string(row.tableKey, "Table activity"), label: string(row.label, "Table activity"), identityBasis: string(row.identityBasis, "Table activity"), collectedSales: nullableNumber(row.collectedSales) ?? undefined, collectedInvoices: nullableNumber(row.collectedInvoices) ?? undefined }; }) }, kitchen: { completedItems: number(kitchen.completedItems, "Kitchen preparation"), timedItems: number(kitchen.timedItems, "Kitchen preparation"), untimedItems: number(kitchen.untimedItems, "Kitchen preparation"), timingCoveragePercent: nullableNumber(kitchen.timingCoveragePercent), averagePreparationMinutes: nullableNumber(kitchen.averagePreparationMinutes), medianPreparationMinutes: nullableNumber(kitchen.medianPreparationMinutes), stations: array(kitchen.stations, "Kitchen preparation").map((item) => { const row = object(item, "Kitchen preparation"); return { stationKey: string(row.stationKey, "Kitchen preparation"), name: string(row.name, "Kitchen preparation"), identityBasis: string(row.identityBasis, "Kitchen preparation"), completedItems: number(row.completedItems, "Kitchen preparation"), timedItems: number(row.timedItems, "Kitchen preparation"), averagePreparationMinutes: nullableNumber(row.averagePreparationMinutes), medianPreparationMinutes: nullableNumber(row.medianPreparationMinutes) }; }), quality: quality(kitchen.quality) }, quality: quality(operations.quality) },
    payments: { methods: array(payments.methods, "Payment methods").map((item) => { const row = object(item, "Payment methods"); const classification = string(row.classification, "Payment methods"); if (!["known_configured", "legacy_unrecognized", "unknown_unclassified"].includes(classification)) throw new OwnerReportsReadModelError("Payment methods are unavailable."); return { methodIdentity: nullableString(row.methodIdentity), methodCode: nullableString(row.methodCode), displayLabel: string(row.displayLabel, "Payment methods"), classification: classification as OwnerReportsPaymentMethod["classification"], currentlyEnabled: typeof row.currentlyEnabled === "boolean" ? row.currentlyEnabled : null, collectedAmount: number(row.collectedAmount, "Payment methods"), collectedInvoices: number(row.collectedInvoices, "Payment methods"), sharePercent: nullableNumber(row.sharePercent) }; }), quality: quality(payments.quality) },
    feedback: { reviewCount: number(feedback.reviewCount, "Customer feedback"), averageOrderExperienceRating: nullableNumber(feedback.averageOrderExperienceRating), ratingDistribution: array(feedback.ratingDistribution, "Customer feedback").map((item) => { const row = object(item, "Customer feedback"); return { rating: number(row.rating, "Customer feedback"), reviewCount: number(row.reviewCount, "Customer feedback") }; }), comparison: { reviewCount: number(feedbackComparison.reviewCount, "Customer feedback"), averageOrderExperienceRating: nullableNumber(feedbackComparison.averageOrderExperienceRating) }, detailAvailable: bool(feedback.detailAvailable), quality: quality(feedback.quality) },
    detailAvailability: { feedbackPage: bool(object(root.detailAvailability, "Reports").feedbackPage), staffOperationsPage: bool(object(root.detailAvailability, "Reports").staffOperationsPage) }, definitions: object(root.definitions, "Reports") as Record<string, string>,
  };
}

export async function loadOwnerReportsReadModel(restaurantId: string, periodKey: OwnerReportsPeriodKey, customStart: string | null = null, customEnd: string | null = null): Promise<OwnerReportsReadModel> {
  const { data, error } = await supabase.rpc("get_owner_reports_read_model", { target_restaurant_id: restaurantId, requested_period: periodKey, custom_start_date: customStart, custom_end_date: customEnd });
  if (error) throw new OwnerReportsReadModelError("Couldn’t load this report. Try again.");
  return parseMain(data);
}

export async function loadOwnerReportFeedbackPage(restaurantId: string, periodKey: OwnerReportsPeriodKey, customStart: string | null, customEnd: string | null, cursor: OwnerReportsFeedbackCursor | null): Promise<OwnerReportsFeedbackPage> {
  const { data, error } = await supabase.rpc("get_owner_report_feedback_page", { target_restaurant_id: restaurantId, requested_period: periodKey, custom_start_date: customStart, custom_end_date: customEnd, page_size: 25, cursor_created_at: cursor?.createdAt ?? null, cursor_id: cursor?.id ?? null });
  if (error) throw new OwnerReportsReadModelError("Couldn’t load feedback. Try again.");
  const root = object(data, "Feedback"); return { contractVersion: "owner_reports_v1", period: period(root.period), items: array(root.items, "Feedback").map((item) => { const row = object(item, "Feedback"); return { rating: number(row.rating, "Feedback"), reactions: Array.isArray(row.reactions) ? row.reactions.filter((reaction): reaction is string => typeof reaction === "string") : [], comment: nullableString(row.comment), hasPhoto: bool(row.hasPhoto), submittedAt: string(row.submittedAt, "Feedback") }; }), nextCursor: root.nextCursor ? { createdAt: string(object(root.nextCursor, "Feedback").createdAt, "Feedback"), id: string(object(root.nextCursor, "Feedback").id, "Feedback") } : null, quality: quality(root.quality) };
}

export async function loadOwnerReportStaffOperationsPage(restaurantId: string, periodKey: OwnerReportsPeriodKey, customStart: string | null, customEnd: string | null, cursor: OwnerReportsStaffCursor | null): Promise<OwnerReportsStaffPage> {
  const { data, error } = await supabase.rpc("get_owner_report_staff_operations_page", { target_restaurant_id: restaurantId, requested_period: periodKey, custom_start_date: customStart, custom_end_date: customEnd, page_size: 25, cursor_role: cursor?.role ?? null, cursor_display_name: cursor?.displayName ?? null, cursor_staff_id: cursor?.staffId ?? null });
  if (error) throw new OwnerReportsReadModelError("Couldn’t load staff operations. Try again.");
  const root = object(data, "Staff operations"); const staff = array(root.items, "Staff operations").map((item): OwnerReportsStaffOperation => { const row = object(item, "Staff operations"); const role = string(row.role, "Staff operations"); const base = { displayName: string(row.displayName, "Staff operations"), employeeId: nullableString(row.employeeId), membershipState: string(row.membershipState, "Staff operations") === "inactive" ? "inactive" as const : "active" as const }; const facts = object(row.operations, "Staff operations"); if (role === "waiter") return { role, ...base, operations: { ordersTaken: number(facts.ordersTaken, "Staff operations") } }; if (role === "cashier") return { role, ...base, operations: { settlementsHandled: number(facts.settlementsHandled, "Staff operations"), collectedAmountHandled: number(facts.collectedAmountHandled, "Staff operations"), financialShiftsOpened: number(facts.financialShiftsOpened, "Staff operations"), financialShiftsClosed: number(facts.financialShiftsClosed, "Staff operations"), reconciliationsCompleted: number(facts.reconciliationsCompleted, "Staff operations"), recordedVariance: number(facts.recordedVariance, "Staff operations"), expensesRecorded: number(facts.expensesRecorded, "Staff operations"), handoversInitiated: number(facts.handoversInitiated, "Staff operations"), handoversConfirmed: number(facts.handoversConfirmed, "Staff operations"), handoverDiscrepancies: number(facts.handoverDiscrepancies, "Staff operations") } }; return { role: "kitchen", ...base, operations: { itemsCompleted: number(facts.itemsCompleted, "Staff operations") } }; });
  const unattributed = object(root.unattributedHistoricalActivity, "Staff operations"); return { contractVersion: "owner_reports_v1", period: period(root.period), items: staff, unattributedHistoricalActivity: { waiterOrdersTaken: number(unattributed.waiterOrdersTaken, "Staff operations"), cashierSettlements: number(unattributed.cashierSettlements, "Staff operations"), kitchenItemsCompleted: number(unattributed.kitchenItemsCompleted, "Staff operations") }, nextCursor: root.nextCursor ? { role: string(object(root.nextCursor, "Staff operations").role, "Staff operations"), displayName: string(object(root.nextCursor, "Staff operations").displayName, "Staff operations"), staffId: string(object(root.nextCursor, "Staff operations").staffId, "Staff operations") } : null, quality: quality(root.quality) };
}

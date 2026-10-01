import { supabase } from "../../../core/database";
import type { OwnerReportsPeriod, OwnerReportsPeriodKey, OwnerReportsQuality } from "./ownerReportsReadModel";

export type OwnerInventoryReport = {
  contractVersion: "owner_inventory_report_v2";
  period: OwnerReportsPeriod;
  summary: { receivedMovementCount: number; deductedMovementCount: number; wasteMovementCount: number; movementCount: number; requestCount: number };
  movements: Array<{ id: string; itemName: string; movementType: string; quantity: number; direction: "in" | "out"; unit: string; reason: string | null; recordedAt: string }>;
  requests: Array<{ id: string; itemName: string; quantity: number; unit: string; urgency: string; status: string; requestedAt: string; deliveredAt: string | null }>;
  waste: Array<{ id: string; itemName: string; quantity: number; unit: string; movementType: string; reason: string | null; recordedAt: string }>;
  next: { movements: OwnerReportCursor | null; requests: OwnerReportCursor | null; waste: OwnerReportCursor | null };
  quality: OwnerReportsQuality;
};

export type OwnerCashierReport = {
  contractVersion: "owner_cashier_report_v2";
  period: OwnerReportsPeriod;
  summary: { openShifts: number; shiftsRequiringReconciliation: number; recordedVariance: number; handoverCount: number };
  shifts: Array<{ id: string; cashierName: string; openedAt: string; closedAt: string | null; actualCash: number | null; variance: number | null; reconciliationStatus: "open" | "reconciled" | "requires_reconciliation" }>;
  handovers: Array<{ id: string; outgoingCashier: string; incomingCashier: string; declaredAmount: number; receivedAmount: number | null; difference: number | null; status: string; recordedAt: string }>;
  next: { shifts: OwnerReportCursor | null; handovers: OwnerReportCursor | null };
  quality: OwnerReportsQuality;
};

export type OwnerReportCursor = { at: string; id: string };
export type OwnerInventorySection = "initial" | "movements" | "requests" | "waste";
export type OwnerCashierSection = "initial" | "shifts" | "handovers";

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Report detail is unavailable.");
  return value as Record<string, unknown>;
};
const asArray = (value: unknown) => Array.isArray(value) ? value : (() => { throw new Error("Report detail is unavailable."); })();
const asText = (value: unknown) => typeof value === "string" ? value : (() => { throw new Error("Report detail is unavailable."); })();
const asNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : (() => { throw new Error("Report detail is unavailable."); })();
const nullableText = (value: unknown) => typeof value === "string" ? value : null;
const nullableNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const parseCursor = (value: unknown): OwnerReportCursor | null => { if (value === null) return null; const row=asRecord(value); const at=asText(row.at); if(!Number.isFinite(Date.parse(at))) throw new Error("Report detail is unavailable."); return {at,id:asText(row.id)}; };
const parsePage = (value: unknown) => { const row=asRecord(value); return {items:asArray(row.items),nextCursor:parseCursor(row.nextCursor)}; };
const parsePeriod = (value: unknown) => {
  const row = asRecord(value);
  const requestedPeriod = asText(row.key);
  const completeness = asText(row.completeness);
  const granularity = asText(row.granularity);
  if (!["today", "yesterday", "week", "month", "custom"].includes(requestedPeriod)
    || !["complete", "in_progress"].includes(completeness)
    || !["hour", "day", "week"].includes(granularity)) throw new Error("Report detail is unavailable.");
  return {
    requestedPeriod: requestedPeriod as OwnerReportsPeriodKey,
    currentStart: asText(row.currentStart), currentEnd: asText(row.currentEnd), comparisonStart: asText(row.comparisonStart), comparisonEnd: asText(row.comparisonEnd),
    timezone: asText(row.timezone), completeness: completeness as OwnerReportsPeriod["completeness"], granularity: granularity as OwnerReportsPeriod["granularity"], durationSecondsEqual: typeof row.durationSecondsEqual === "boolean" ? row.durationSecondsEqual : (() => { throw new Error("Report detail is unavailable."); })(),
  };
};
const parseQuality = (value: unknown, periodCompleteness: OwnerReportsQuality["completeness"]): OwnerReportsQuality => {
  const row = asRecord(value);
  const completeness = row.periodCompleteness === null ? periodCompleteness : asText(row.periodCompleteness);
  if (!["complete", "in_progress"].includes(completeness)) throw new Error("Report detail is unavailable.");
  return { state: asText(row.state) as OwnerReportsQuality["state"], completeness: completeness as OwnerReportsQuality["completeness"], history: asText(row.history), attribution: asText(row.attribution), affectedCount: asNumber(row.legacyCount) + asNumber(row.excludedCount), unknownCount: asNumber(row.unknownAttributionCount), notices: asArray(row.limitations).filter((item): item is string => typeof item === "string") };
};

export function parseOwnerInventoryReport(value: unknown): OwnerInventoryReport {
  const root = asRecord(value); if (root.contractVersion !== "owner_inventory_report_v2") throw new Error("Inventory report is unavailable.");
  const summary = asRecord(root.summary), period = parsePeriod(root.period);
  const movements=parsePage(root.movements),requests=parsePage(root.requests),waste=parsePage(root.waste);
  return {
    contractVersion: "owner_inventory_report_v2", period,
    summary: { receivedMovementCount: asNumber(summary.receivedMovementCount), deductedMovementCount: asNumber(summary.deductedMovementCount), wasteMovementCount: asNumber(summary.wasteMovementCount), movementCount: asNumber(summary.movementCount), requestCount: asNumber(summary.requestCount) },
    movements: movements.items.map((value) => { const row=asRecord(value); const direction=asText(row.direction); if(direction!=="in"&&direction!=="out") throw new Error("Inventory report is unavailable."); return { id:asText(row.id),itemName:asText(row.itemName),movementType:asText(row.movementType),quantity:asNumber(row.quantity),direction,unit:asText(row.unit),reason:nullableText(row.reason),recordedAt:asText(row.recordedAt) }; }),
    requests: requests.items.map((value) => { const row=asRecord(value); return { id:asText(row.id),itemName:asText(row.itemName),quantity:asNumber(row.quantity),unit:asText(row.unit),urgency:asText(row.urgency),status:asText(row.status),requestedAt:asText(row.requestedAt),deliveredAt:nullableText(row.deliveredAt) }; }),
    waste: waste.items.map((value) => { const row=asRecord(value); return { id:asText(row.id),itemName:asText(row.itemName),quantity:asNumber(row.quantity),unit:asText(row.unit),movementType:asText(row.movementType),reason:nullableText(row.reason),recordedAt:asText(row.recordedAt) }; }), next:{movements:movements.nextCursor,requests:requests.nextCursor,waste:waste.nextCursor}, quality: parseQuality(root.quality, period.completeness),
  };
}

export function parseOwnerCashierReport(value: unknown): OwnerCashierReport {
  const root=asRecord(value); if(root.contractVersion!=="owner_cashier_report_v2") throw new Error("Cashier report is unavailable."); const period=parsePeriod(root.period),summary=asRecord(root.summary),shifts=parsePage(root.shifts),handovers=parsePage(root.handovers);
  return { contractVersion:"owner_cashier_report_v2",period,summary:{openShifts:asNumber(summary.openShifts),shiftsRequiringReconciliation:asNumber(summary.shiftsRequiringReconciliation),recordedVariance:asNumber(summary.recordedVariance),handoverCount:asNumber(summary.handoverCount)},
    shifts:shifts.items.map((value)=>{const row=asRecord(value);const status=asText(row.reconciliationStatus);if(!["open","reconciled","requires_reconciliation"].includes(status))throw new Error("Cashier report is unavailable.");return{id:asText(row.id),cashierName:asText(row.cashierName),openedAt:asText(row.openedAt),closedAt:nullableText(row.closedAt),actualCash:nullableNumber(row.actualCash),variance:nullableNumber(row.variance),reconciliationStatus:status as OwnerCashierReport["shifts"][number]["reconciliationStatus"]};}),
    handovers:handovers.items.map((value)=>{const row=asRecord(value);return{id:asText(row.id),outgoingCashier:asText(row.outgoingCashier),incomingCashier:asText(row.incomingCashier),declaredAmount:asNumber(row.declaredAmount),receivedAmount:nullableNumber(row.receivedAmount),difference:nullableNumber(row.difference),status:asText(row.status),recordedAt:asText(row.recordedAt)};}),next:{shifts:shifts.nextCursor,handovers:handovers.nextCursor},quality:parseQuality(root.quality, period.completeness)};
}

export async function loadOwnerInventoryReport(restaurantId:string,period:OwnerReportsPeriodKey,start:string|null,end:string|null,section:OwnerInventorySection="initial",cursor:OwnerReportCursor|null=null){const {data,error}=await supabase.rpc("get_owner_report_inventory_v2",{target_restaurant_id:restaurantId,requested_period:period,custom_start_date:start,custom_end_date:end,detail_section:section,cursor_at:cursor?.at??null,cursor_id:cursor?.id??null,page_size:50});if(error)throw Object.assign(new Error("We couldn’t retrieve this report. Try again."), { cause: error });return parseOwnerInventoryReport(data);}
export async function loadOwnerCashierReport(restaurantId:string,period:OwnerReportsPeriodKey,start:string|null,end:string|null,section:OwnerCashierSection="initial",cursor:OwnerReportCursor|null=null){const {data,error}=await supabase.rpc("get_owner_report_cashier_shifts_v2",{target_restaurant_id:restaurantId,requested_period:period,custom_start_date:start,custom_end_date:end,detail_section:section,cursor_at:cursor?.at??null,cursor_id:cursor?.id??null,page_size:50});if(error)throw Object.assign(new Error("We couldn’t retrieve this report. Try again."), { cause: error });return parseOwnerCashierReport(data);}

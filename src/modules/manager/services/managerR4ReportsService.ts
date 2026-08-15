import type { ReportingPeriodWindow } from "../../../core/analytics/historicalAnalytics";
import { supabase } from "../../../core/database";

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord => value && typeof value === "object" ? value as JsonRecord : {};
const rows = (value: unknown): JsonRecord[] => Array.isArray(value) ? value.map(record) : [];
const text = (value: unknown) => typeof value === "string" ? value : "";
const nullableText = (value: unknown) => typeof value === "string" && value ? value : null;
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const nullableNumber = (value: unknown) => value == null ? null : number(value);

export type OperationalPeriodFacts = {
  itemsReceived?: number;
  itemsStarted?: number;
  itemsCompleted?: number;
  timedItems?: number;
  delayedItems?: number;
  avgMinutes?: number | null;
  medianMinutes?: number | null;
  longestMinutes?: number | null;
  movementCount?: number;
  quantityIn?: number;
  quantityOut?: number;
  wasteSpoilage?: number;
  sessionsOpened?: number;
  sessionsClosed?: number;
  tablesServed?: number;
  avgSessionMinutes?: number | null;
  longestSessionMinutes?: number | null;
};

export type ManagerR4OperationalReport = {
  generatedAt: string;
  rangeStart: string;
  rangeEnd: string;
  comparisonRangeStart: string;
  comparisonRangeEnd: string;
  kitchen: { current: OperationalPeriodFacts; comparison: OperationalPeriodFacts; stations: JsonRecord[]; menuItems: JsonRecord[]; delayThresholdMinutes: number };
  staff: { facts: JsonRecord[]; rankingAvailable: false; scoreAvailable: false };
  inventory: { current: OperationalPeriodFacts; comparison: OperationalPeriodFacts; movements: JsonRecord[]; requests: JsonRecord[] };
  guests: { current: OperationalPeriodFacts; comparison: OperationalPeriodFacts; assistanceRequests: number; comparisonAssistanceRequests: number; complaints: number; comparisonComplaints: number; feedbackCount: number; comparisonFeedbackCount: number; averageFeedbackRating: number | null; comparisonAverageFeedbackRating: number | null; unresolvedAssistanceRequests: number; unresolvedComplaints: number; guestCountAvailable: false };
  exceptions: { native: JsonRecord[]; manual: JsonRecord[] };
  managerRecords: { decisions: JsonRecord[]; notes: JsonRecord[] };
  dataQuality: JsonRecord;
  definitions: JsonRecord;
};

function periodFacts(value: unknown): OperationalPeriodFacts {
  const row = record(value);
  const result: OperationalPeriodFacts = {};
  const integerKeys = ["items_received","items_started","items_completed","timed_items","delayed_items","movement_count","sessions_opened","sessions_closed","tables_served"] as const;
  const outputKeys = ["itemsReceived","itemsStarted","itemsCompleted","timedItems","delayedItems","movementCount","sessionsOpened","sessionsClosed","tablesServed"] as const;
  integerKeys.forEach((key, index) => { if (key in row) result[outputKeys[index]] = number(row[key]); });
  if ("quantity_in" in row) result.quantityIn = number(row.quantity_in);
  if ("quantity_out" in row) result.quantityOut = number(row.quantity_out);
  if ("waste_spoilage" in row) result.wasteSpoilage = number(row.waste_spoilage);
  if ("avg_minutes" in row) result.avgMinutes = nullableNumber(row.avg_minutes);
  if ("median_minutes" in row) result.medianMinutes = nullableNumber(row.median_minutes);
  if ("longest_minutes" in row) result.longestMinutes = nullableNumber(row.longest_minutes);
  if ("avg_session_minutes" in row) result.avgSessionMinutes = nullableNumber(row.avg_session_minutes);
  if ("longest_session_minutes" in row) result.longestSessionMinutes = nullableNumber(row.longest_session_minutes);
  return result;
}

export function parseManagerR4OperationalReport(value: unknown): ManagerR4OperationalReport {
  const payload = record(value);
  if (typeof payload.error === "string") throw new Error(payload.error);
  const kitchen = record(payload.kitchen), staff = record(payload.staff), inventory = record(payload.inventory);
  const guests = record(payload.guests), exceptions = record(payload.exceptions), managerRecords = record(payload.manager_records);
  return {
    generatedAt: text(payload.generated_at), rangeStart: text(payload.range_start), rangeEnd: text(payload.range_end),
    comparisonRangeStart: text(payload.comparison_range_start), comparisonRangeEnd: text(payload.comparison_range_end),
    kitchen: { current: periodFacts(kitchen.current), comparison: periodFacts(kitchen.comparison), stations: rows(kitchen.stations), menuItems: rows(kitchen.menu_items), delayThresholdMinutes: number(kitchen.delay_threshold_minutes) },
    staff: { facts: rows(staff.facts), rankingAvailable: false, scoreAvailable: false },
    inventory: { current: periodFacts(inventory.current), comparison: periodFacts(inventory.comparison), movements: rows(inventory.movements), requests: rows(inventory.requests) },
    guests: { current: periodFacts(guests.current), comparison: periodFacts(guests.comparison), assistanceRequests: number(guests.assistance_requests), comparisonAssistanceRequests: number(guests.comparison_assistance_requests), complaints: number(guests.complaints), comparisonComplaints: number(guests.comparison_complaints), feedbackCount: number(guests.feedback_count), comparisonFeedbackCount: number(guests.comparison_feedback_count), averageFeedbackRating: nullableNumber(guests.average_feedback_rating), comparisonAverageFeedbackRating: nullableNumber(guests.comparison_average_feedback_rating), unresolvedAssistanceRequests: number(guests.unresolved_assistance_requests), unresolvedComplaints: number(guests.unresolved_complaints), guestCountAvailable: false },
    exceptions: { native: rows(exceptions.native), manual: rows(exceptions.manual) },
    managerRecords: { decisions: rows(managerRecords.decisions), notes: rows(managerRecords.notes) },
    dataQuality: record(payload.data_quality), definitions: record(payload.definitions),
  };
}

export async function loadManagerR4OperationalReport(restaurantId: string, window: ReportingPeriodWindow) {
  const { data, error } = await supabase.rpc("get_manager_operational_report", {
    target_restaurant_id: restaurantId, range_start: window.rangeStart, range_end: window.rangeEnd,
    comparison_range_start: window.comparisonRangeStart, comparison_range_end: window.comparisonRangeEnd,
  });
  if (error) throw new Error(error.message);
  return parseManagerR4OperationalReport(data);
}

export type CreateManagerIncidentInput = { incidentType: string; sourceEntityType?: string; sourceEntityId?: string | null; severity: "info"|"attention"|"high"|"critical"; title: string; summary: string; occurredAt: string; assignedToStaffId?: string | null };
export async function createManagerReportIncident(restaurantId: string, input: CreateManagerIncidentInput) {
  const { data, error } = await supabase.rpc("create_manager_report_incident", { target_restaurant_id: restaurantId, incident_type: input.incidentType, source_entity_type: input.sourceEntityType ?? "manual", source_entity_id: input.sourceEntityId ?? null, severity: input.severity, title: input.title, summary: input.summary, occurred_at: input.occurredAt, assigned_to_staff_id: input.assignedToStaffId ?? null });
  if (error) throw new Error(error.message); return text(data);
}

export async function recordManagerIncidentDecision(incidentId: string, decisionType: string, decisionNote: string, nextStatus: "reviewed"|"in_progress"|"resolved", assignedToStaffId: string|null = null, resolutionNote: string|null = null) {
  const { data, error } = await supabase.rpc("record_manager_incident_decision", { target_incident_id: incidentId, decision_type: decisionType, decision_note: decisionNote, next_status: nextStatus, target_assigned_to_staff_id: assignedToStaffId, target_resolution_note: resolutionNote });
  if (error) throw new Error(error.message); return record(data);
}

export async function createManagerOperationalNote(restaurantId: string, noteText: string, noteDate: string, periodStart: string|null = null, periodEnd: string|null = null) {
  const { data, error } = await supabase.rpc("create_manager_operational_note", { target_restaurant_id: restaurantId, note_text: noteText, note_date: noteDate, period_start: periodStart, period_end: periodEnd });
  if (error) throw new Error(error.message); return nullableText(data);
}

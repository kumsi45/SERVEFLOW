import { supabase } from "../database";

export type AnalyticsPeriod = "today" | "yesterday" | "week" | "last_week" | "month" | "last_month" | "custom";
export type AnalyticsWindow = { rangeStart: string; rangeEnd: string; timezone: string };
export type CanonicalHistoricalSummary = {
  revenue: number;
  orderVolume: number;
  kitchenServed: number;
  diningSessionsClosed: number;
};

type DateParts = { year: number; month: number; day: number };

function partsAt(date: Date, timezone: string): DateParts {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function addDays(parts: DateParts, days: number): DateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function startOfMonth(parts: DateParts) { return { ...parts, day: 1 }; }
function addMonths(parts: DateParts, months: number): DateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: 1 };
}

function zonedMidnight(parts: DateParts, timezone: string): Date {
  const wallClock = Date.UTC(parts.year, parts.month - 1, parts.day);
  let instant = wallClock;
  for (let pass = 0; pass < 3; pass += 1) {
    const rendered = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
    const value = (type: Intl.DateTimeFormatPartTypes) => Number(rendered.find((part) => part.type === type)?.value);
    const renderedClock = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
    instant -= renderedClock - wallClock;
  }
  return new Date(instant);
}

function parseInput(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
}

export function analyticsWindow(period: AnalyticsPeriod, timezone: string, customStart = "", customEnd = "", now = new Date()): AnalyticsWindow {
  const today = partsAt(now, timezone);
  let start = today;
  let end = addDays(today, 1);
  if (period === "yesterday") { start = addDays(today, -1); end = today; }
  if (period === "week") {
    const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay() || 7;
    start = addDays(today, 1 - weekday); end = addDays(start, 7);
  }
  if (period === "last_week") {
    const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay() || 7;
    end = addDays(today, 1 - weekday); start = addDays(end, -7);
  }
  if (period === "month") { start = startOfMonth(today); end = addMonths(start, 1); }
  if (period === "last_month") { end = startOfMonth(today); start = addMonths(end, -1); }
  if (period === "custom") {
    start = parseInput(customStart) ?? today;
    end = addDays(parseInput(customEnd) ?? start, 1);
  }
  return { rangeStart: zonedMidnight(start, timezone).toISOString(), rangeEnd: zonedMidnight(end, timezone).toISOString(), timezone };
}

export function completedDaysWindow(days: number, timezone: string, now = new Date()): AnalyticsWindow {
  const endParts = partsAt(now, timezone);
  const startParts = addDays(endParts, -Math.max(1, Math.floor(days)));
  return { rangeStart: zonedMidnight(startParts, timezone).toISOString(), rangeEnd: zonedMidnight(endParts, timezone).toISOString(), timezone };
}

export async function loadCanonicalHistoricalSummary(restaurantId: string, window: Pick<AnalyticsWindow, "rangeStart" | "rangeEnd">): Promise<CanonicalHistoricalSummary> {
  const { data, error } = await supabase.rpc("get_canonical_historical_analytics", { target_restaurant_id: restaurantId, range_start: window.rangeStart, range_end: window.rangeEnd });
  if (error) throw new Error(error.message);
  const value = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (typeof value.error === "string") throw new Error(value.error);
  return { revenue: Number(value.revenue ?? 0), orderVolume: Number(value.order_volume ?? 0), kitchenServed: Number(value.kitchen_served ?? 0), diningSessionsClosed: Number(value.dining_sessions_closed ?? 0) };
}

import { supabase } from "../../../core/database";
import { loadCanonicalHistoricalSummary, reportingPeriodWindow } from "../../../core/analytics/historicalAnalytics";

export type ManagerReportRange = "today" | "week" | "month" | "custom";

export type ChartRow = {
  label: string;
  value: number;
  secondary?: number;
};

export type WaiterPerformanceRow = {
  staffId: string;
  waiter: string;
  orders: number;
  averageWaitMinutes: number;
  delayedOrders: number;
};

export type KitchenEfficiencyRow = {
  stationId: string;
  station: string;
  tickets: number;
  completed: number;
  delayed: number;
  averagePrepMinutes: number;
  efficiency: number;
};

export type TableTurnoverRow = {
  tableNumber: string;
  sessions: number;
  averageStayMinutes: number;
};

export type ManagerOperationalReport = {
  rangeStart: string;
  rangeEnd: string;
  generatedAt: string;
  summary: {
    orders: number;
    revenue: number;
    averageTicket: number;
    averagePreparationMinutes: number;
    tableTurnover: number;
    delayedOrders: number;
    cancelledOrders: number;
    averageCustomerWaitMinutes: number;
    peakHour: string | null;
    collected: number;
    paymentDue: number;
    pendingPayments: number;
    refunds: number;
    averagePaymentDelayMinutes: number;
    paymentConversionRate: number;
  };
  ordersPerHour: ChartRow[];
  peakHours: ChartRow[];
  tableTurnover: TableTurnoverRow[];
  waiterPerformance: WaiterPerformanceRow[];
  kitchenEfficiency: KitchenEfficiencyRow[];
  stationUtilization: ChartRow[];
  delayedOrders: ChartRow[];
  cancelledOrders: ChartRow[];
  customerWaitTime: ChartRow[];
};

export function managerReportDateRange(
  range: ManagerReportRange,
  customStart: string,
  customEnd: string,
  timezone = "Africa/Nairobi",
) {
  return reportingPeriodWindow(range, timezone, customStart, customEnd);
}

export async function loadRestaurantAnalyticsTimezone(restaurantId: string) {
  const { data, error } = await supabase.from("restaurants").select("profile").eq("id", restaurantId).single();
  if (error) throw new Error(error.message);
  const profile = data?.profile && typeof data.profile === "object" ? data.profile as Record<string, unknown> : {};
  return typeof profile.timezone === "string" && profile.timezone ? profile.timezone : "Africa/Nairobi";
}

function chartRows(value: unknown): ChartRow[] {
  return Array.isArray(value)
    ? value.map((row) => {
        const record = row as Record<string, unknown>;
        return {
          label: String(record.label ?? ""),
          value: Number(record.value ?? 0),
          secondary:
            record.secondary == null ? undefined : Number(record.secondary),
        };
      })
    : [];
}

function tableRows(value: unknown): TableTurnoverRow[] {
  return Array.isArray(value)
    ? value.map((row) => {
        const record = row as Record<string, unknown>;
        return {
          tableNumber: String(record.table_number ?? record.tableNumber ?? "-"),
          sessions: Number(record.sessions ?? 0),
          averageStayMinutes: Number(
            record.average_stay_minutes ?? record.averageStayMinutes ?? 0,
          ),
        };
      })
    : [];
}

function waiterRows(value: unknown): WaiterPerformanceRow[] {
  return Array.isArray(value)
    ? value.map((row) => {
        const record = row as Record<string, unknown>;
        return {
          staffId: String(record.staff_id ?? ""),
          waiter: String(record.waiter ?? "Waiter"),
          orders: Number(record.orders ?? 0),
          averageWaitMinutes: Number(record.average_wait_minutes ?? 0),
          delayedOrders: Number(record.delayed_orders ?? 0),
        };
      })
    : [];
}

function kitchenRows(value: unknown): KitchenEfficiencyRow[] {
  return Array.isArray(value)
    ? value.map((row) => {
        const record = row as Record<string, unknown>;
        return {
          stationId: String(record.station_id ?? ""),
          station: String(record.station ?? "Station"),
          tickets: Number(record.tickets ?? 0),
          completed: Number(record.completed ?? 0),
          delayed: Number(record.delayed ?? 0),
          averagePrepMinutes: Number(record.average_prep_minutes ?? 0),
          efficiency: Number(record.efficiency ?? 0),
        };
      })
    : [];
}

export async function loadManagerOperationalReport(
  restaurantId: string,
  rangeStart: string,
  rangeEnd: string,
  timezone = "Africa/Nairobi",
): Promise<ManagerOperationalReport> {
  const [{ data, error }, invoiceResult, paidInvoiceResult, canonical, servedItemsResult, closedSessionsResult, volumeOrdersResult] = await Promise.all(
    [
      supabase.rpc("get_manager_operational_report", {
        target_restaurant_id: restaurantId,
        range_start: rangeStart,
        range_end: rangeEnd,
      }),
      supabase
        .from("order_invoices")
        .select("payment_status,total_price,created_at,paid_at")
        .eq("restaurant_id", restaurantId)
        .gte("created_at", rangeStart)
        .lt("created_at", rangeEnd),
      supabase
        .from("order_invoices")
        .select("payment_status,total_price,created_at,paid_at,payment_method")
        .eq("restaurant_id", restaurantId)
        .eq("payment_status", "paid")
        .gte("paid_at", rangeStart)
        .lt("paid_at", rangeEnd),
      loadCanonicalHistoricalSummary(restaurantId, { rangeStart, rangeEnd }),
      supabase.from("order_items").select("order_id,kitchen_station_id,kitchen_preparation_started_at,kitchen_completed_at,kitchen_stations(name)").eq("restaurant_id", restaurantId).gte("kitchen_completed_at", rangeStart).lt("kitchen_completed_at", rangeEnd),
      supabase.from("orders").select("table_number,dining_session_opened_at,created_at,dining_session_closed_at").eq("restaurant_id", restaurantId).gte("dining_session_closed_at", rangeStart).lt("dining_session_closed_at", rangeEnd),
      supabase.from("orders").select("created_at").eq("restaurant_id", restaurantId).gte("created_at", rangeStart).lt("created_at", rangeEnd),
    ],
  );
  if (error) throw new Error(error.message);
  if (invoiceResult.error) throw new Error(invoiceResult.error.message);
  if (paidInvoiceResult.error) throw new Error(paidInvoiceResult.error.message);
  if (servedItemsResult.error) throw new Error(servedItemsResult.error.message);
  if (closedSessionsResult.error) throw new Error(closedSessionsResult.error.message);
  if (volumeOrdersResult.error) throw new Error(volumeOrdersResult.error.message);
  const invoices = invoiceResult.data ?? [];
  const paid = paidInvoiceResult.data ?? [];
  const collected = paid.reduce(
    (sum, invoice) => sum + Number(invoice.total_price ?? 0),
    0,
  );
  const paymentDue = invoices
    .filter((invoice) => invoice.payment_status === "held")
    .reduce((sum, invoice) => sum + Number(invoice.total_price ?? 0), 0);
  const pendingPayments = invoices.filter(
    (invoice) => invoice.payment_status === "pending",
  ).length;
  const refunds = invoices
    .filter((invoice) => invoice.payment_status === "refunded")
    .reduce((sum, invoice) => sum + Number(invoice.total_price ?? 0), 0);
  const delays = paid.map((invoice) =>
    Math.max(
      0,
      (new Date(invoice.paid_at as string).getTime() -
        new Date(invoice.created_at).getTime()) /
        60000,
    ),
  );
  const payload =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  if (typeof payload.error === "string") throw new Error(payload.error);
  const summary =
    payload.summary && typeof payload.summary === "object"
      ? (payload.summary as Record<string, unknown>)
      : {};
  const servedItems = servedItemsResult.data ?? [];
  const stationGroups = new Map<string, { stationId: string; station: string; durations: number[] }>();
  for (const item of servedItems) {
    const stationId = String(item.kitchen_station_id ?? "unassigned");
    const relation = Array.isArray(item.kitchen_stations) ? item.kitchen_stations[0] : item.kitchen_stations;
    const group: { stationId: string; station: string; durations: number[] } = stationGroups.get(stationId) ?? { stationId, station: relation?.name ?? "Unassigned", durations: [] };
    if (item.kitchen_preparation_started_at && item.kitchen_completed_at) group.durations.push(Math.max(0, (new Date(item.kitchen_completed_at).getTime() - new Date(item.kitchen_preparation_started_at).getTime()) / 60000));
    stationGroups.set(stationId, group);
  }
  const canonicalKitchen = [...stationGroups.values()].map((group) => ({ staffId: group.stationId, stationId: group.stationId, station: group.station, tickets: group.durations.length, completed: group.durations.length, delayed: group.durations.filter((value) => value >= 25).length, averagePrepMinutes: group.durations.length ? group.durations.reduce((sum, value) => sum + value, 0) / group.durations.length : 0, efficiency: 100 }));
  const sessionGroups = new Map<string, number[]>();
  for (const session of closedSessionsResult.data ?? []) {
    const table = String(session.table_number ?? "-");
    const opened = session.dining_session_opened_at ?? session.created_at;
    if (!opened || !session.dining_session_closed_at) continue;
    const values = sessionGroups.get(table) ?? [];
    values.push(Math.max(0, (new Date(session.dining_session_closed_at).getTime() - new Date(opened).getTime()) / 60000));
    sessionGroups.set(table, values);
  }
  const canonicalTurnover = [...sessionGroups].map(([tableNumber, values]) => ({ tableNumber, sessions: values.length, averageStayMinutes: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length) }));
  const hourCounts = new Map<string, number>();
  for (const order of volumeOrdersResult.data ?? []) {
    const label = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(new Date(order.created_at)) + ":00";
    hourCounts.set(label, (hourCounts.get(label) ?? 0) + 1);
  }
  const canonicalHours = [...hourCounts].map(([label, value]) => ({ label, value })).sort((a, b) => a.label.localeCompare(b.label));
  return {
    rangeStart: String(payload.range_start ?? rangeStart),
    rangeEnd: String(payload.range_end ?? rangeEnd),
    generatedAt: String(payload.generated_at ?? new Date().toISOString()),
    summary: {
      orders: canonical.orderVolume,
      revenue: canonical.revenue,
      averageTicket: Number(
        summary.average_ticket ?? summary.average_ticket_value ?? 0,
      ),
      averagePreparationMinutes: servedItems.length ? canonicalKitchen.reduce((sum, row) => sum + row.averagePrepMinutes * row.completed, 0) / Math.max(1, canonicalKitchen.reduce((sum, row) => sum + row.completed, 0)) : 0,
      tableTurnover: canonical.diningSessionsClosed,
      delayedOrders: Number(summary.delayed_orders ?? 0),
      cancelledOrders: Number(summary.cancelled_orders ?? 0),
      averageCustomerWaitMinutes: Number(
        summary.average_customer_wait_minutes ?? 0,
      ),
      peakHour:
        typeof summary.peak_hour === "string" ? summary.peak_hour : null,
      collected,
      paymentDue,
      pendingPayments,
      refunds,
      averagePaymentDelayMinutes: delays.length
        ? delays.reduce((sum, value) => sum + value, 0) / delays.length
        : 0,
      paymentConversionRate: invoices.length
        ? (paid.length / invoices.length) * 100
        : 0,
    },
    ordersPerHour: canonicalHours,
    peakHours: [...canonicalHours].sort((a, b) => b.value - a.value).slice(0, 8),
    tableTurnover: canonicalTurnover,
    waiterPerformance: waiterRows(payload.waiter_performance),
    kitchenEfficiency: canonicalKitchen,
    stationUtilization: canonicalKitchen.map((row) => ({ label: row.station, value: row.tickets, secondary: row.completed })),
    delayedOrders: chartRows(payload.delayed_orders),
    cancelledOrders: chartRows(payload.cancelled_orders),
    customerWaitTime: chartRows(payload.customer_wait_time),
  };
}

export function exportOperationalReportCsv(
  report: ManagerOperationalReport,
  filename = "serveflow-manager-operational-report.csv",
) {
  const rows: Array<Array<string | number>> = [
    ["Section", "Metric", "Value", "Secondary"],
    ["Summary", "Orders", report.summary.orders, ""],
    ["Summary", "Revenue", report.summary.revenue, ""],
    ["Summary", "Average ticket", report.summary.averageTicket, ""],
    [
      "Summary",
      "Average preparation time",
      report.summary.averagePreparationMinutes,
      "minutes",
    ],
    ["Summary", "Table turnover", report.summary.tableTurnover, "sessions"],
    ["Summary", "Delayed orders", report.summary.delayedOrders, ""],
    ["Summary", "Cancelled orders", report.summary.cancelledOrders, ""],
    [
      "Summary",
      "Customer wait time",
      report.summary.averageCustomerWaitMinutes,
      "minutes",
    ],
    ...report.ordersPerHour.map((row) => [
      "Orders Per Hour",
      row.label,
      row.value,
      row.secondary ?? "",
    ]),
    ...report.peakHours.map((row) => [
      "Peak Hours",
      row.label,
      row.value,
      row.secondary ?? "",
    ]),
    ...report.tableTurnover.map((row) => [
      "Table Turnover",
      row.tableNumber,
      row.sessions,
      `${row.averageStayMinutes} min avg stay`,
    ]),
    ...report.waiterPerformance.map((row) => [
      "Waiter Performance",
      row.waiter,
      row.orders,
      `${row.averageWaitMinutes} min avg wait / ${row.delayedOrders} delayed`,
    ]),
    ...report.kitchenEfficiency.map((row) => [
      "Kitchen Efficiency",
      row.station,
      row.tickets,
      `${row.averagePrepMinutes} min prep / ${row.efficiency}% efficiency`,
    ]),
    ...report.stationUtilization.map((row) => [
      "Station Utilization",
      row.label,
      row.value,
      row.secondary ?? "",
    ]),
  ];
  const csv = rows
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function exportOperationalReportExcel(
  report: ManagerOperationalReport,
  filename = "serveflow-manager-operational-report.xls",
) {
  const tableRows = [
    ["Section", "Metric", "Value", "Secondary"],
    ["Summary", "Orders", report.summary.orders, ""],
    ["Summary", "Revenue", report.summary.revenue, ""],
    ["Summary", "Average ticket", report.summary.averageTicket, ""],
    [
      "Summary",
      "Average preparation time",
      report.summary.averagePreparationMinutes,
      "minutes",
    ],
    ...report.ordersPerHour.map((row) => [
      "Orders Per Hour",
      row.label,
      row.value,
      row.secondary ?? "",
    ]),
    ...report.tableTurnover.map((row) => [
      "Table Turnover",
      row.tableNumber,
      row.sessions,
      `${row.averageStayMinutes} min avg stay`,
    ]),
    ...report.waiterPerformance.map((row) => [
      "Waiter Performance",
      row.waiter,
      row.orders,
      `${row.averageWaitMinutes} min avg wait`,
    ]),
    ...report.kitchenEfficiency.map((row) => [
      "Kitchen Efficiency",
      row.station,
      row.tickets,
      `${row.averagePrepMinutes} min prep`,
    ]),
  ];
  const html = `<table>${tableRows.map((row) => `<tr>${row.map((cell) => `<td>${String(cell).replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[char] ?? char)}</td>`).join("")}</tr>`).join("")}</table>`;
  const blob = new Blob([html], { type: "application/vnd.ms-excel" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

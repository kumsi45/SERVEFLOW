import { supabase } from "../../../core/database";

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

export function managerReportDateRange(range: ManagerReportRange, customStart: string, customEnd: string) {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  if (range === "today") {
    start.setHours(0, 0, 0, 0);
    end.setDate(start.getDate() + 1);
    end.setHours(0, 0, 0, 0);
  } else if (range === "week") {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    start.setHours(0, 0, 0, 0);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 7);
  } else if (range === "month") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    end.setTime(start.getTime());
    end.setMonth(start.getMonth() + 1);
  } else {
    const customStartDate = new Date(`${customStart}T00:00:00`);
    const customEndDate = new Date(`${customEnd}T00:00:00`);
    if (!Number.isNaN(customStartDate.getTime())) start.setTime(customStartDate.getTime());
    if (!Number.isNaN(customEndDate.getTime())) {
      end.setTime(customEndDate.getTime());
      end.setDate(end.getDate() + 1);
    }
  }
  return { rangeStart: start.toISOString(), rangeEnd: end.toISOString() };
}

function chartRows(value: unknown): ChartRow[] {
  return Array.isArray(value)
    ? value.map((row) => {
        const record = row as Record<string, unknown>;
        return { label: String(record.label ?? ""), value: Number(record.value ?? 0), secondary: record.secondary == null ? undefined : Number(record.secondary) };
      })
    : [];
}

function tableRows(value: unknown): TableTurnoverRow[] {
  return Array.isArray(value)
    ? value.map((row) => {
        const record = row as Record<string, unknown>;
        return { tableNumber: String(record.table_number ?? record.tableNumber ?? "-"), sessions: Number(record.sessions ?? 0), averageStayMinutes: Number(record.average_stay_minutes ?? record.averageStayMinutes ?? 0) };
      })
    : [];
}

function waiterRows(value: unknown): WaiterPerformanceRow[] {
  return Array.isArray(value)
    ? value.map((row) => {
        const record = row as Record<string, unknown>;
        return { staffId: String(record.staff_id ?? ""), waiter: String(record.waiter ?? "Waiter"), orders: Number(record.orders ?? 0), averageWaitMinutes: Number(record.average_wait_minutes ?? 0), delayedOrders: Number(record.delayed_orders ?? 0) };
      })
    : [];
}

function kitchenRows(value: unknown): KitchenEfficiencyRow[] {
  return Array.isArray(value)
    ? value.map((row) => {
        const record = row as Record<string, unknown>;
        return { stationId: String(record.station_id ?? ""), station: String(record.station ?? "Station"), tickets: Number(record.tickets ?? 0), completed: Number(record.completed ?? 0), delayed: Number(record.delayed ?? 0), averagePrepMinutes: Number(record.average_prep_minutes ?? 0), efficiency: Number(record.efficiency ?? 0) };
      })
    : [];
}

export async function loadManagerOperationalReport(restaurantId: string, rangeStart: string, rangeEnd: string): Promise<ManagerOperationalReport> {
  const { data, error } = await supabase.rpc("get_manager_operational_report", {
    target_restaurant_id: restaurantId,
    range_start: rangeStart,
    range_end: rangeEnd,
  });
  if (error) throw new Error(error.message);
  const payload = data && typeof data === "object" ? data as Record<string, unknown> : {};
  if (typeof payload.error === "string") throw new Error(payload.error);
  const summary = payload.summary && typeof payload.summary === "object" ? payload.summary as Record<string, unknown> : {};
  return {
    rangeStart: String(payload.range_start ?? rangeStart),
    rangeEnd: String(payload.range_end ?? rangeEnd),
    generatedAt: String(payload.generated_at ?? new Date().toISOString()),
    summary: {
      orders: Number(summary.orders ?? 0),
      revenue: Number(summary.revenue ?? summary.current_revenue ?? 0),
      averageTicket: Number(summary.average_ticket ?? summary.average_ticket_value ?? 0),
      averagePreparationMinutes: Number(summary.average_preparation_minutes ?? 0),
      tableTurnover: Number(summary.table_turnover ?? 0),
      delayedOrders: Number(summary.delayed_orders ?? 0),
      cancelledOrders: Number(summary.cancelled_orders ?? 0),
      averageCustomerWaitMinutes: Number(summary.average_customer_wait_minutes ?? 0),
      peakHour: typeof summary.peak_hour === "string" ? summary.peak_hour : null,
    },
    ordersPerHour: chartRows(payload.orders_per_hour),
    peakHours: chartRows(payload.peak_hours),
    tableTurnover: tableRows(payload.table_turnover),
    waiterPerformance: waiterRows(payload.waiter_performance),
    kitchenEfficiency: kitchenRows(payload.kitchen_efficiency),
    stationUtilization: chartRows(payload.station_utilization),
    delayedOrders: chartRows(payload.delayed_orders),
    cancelledOrders: chartRows(payload.cancelled_orders),
    customerWaitTime: chartRows(payload.customer_wait_time),
  };
}

export function exportOperationalReportCsv(report: ManagerOperationalReport, filename = "serveflow-manager-operational-report.csv") {
  const rows: Array<Array<string | number>> = [
    ["Section", "Metric", "Value", "Secondary"],
    ["Summary", "Orders", report.summary.orders, ""],
    ["Summary", "Revenue", report.summary.revenue, ""],
    ["Summary", "Average ticket", report.summary.averageTicket, ""],
    ["Summary", "Average preparation time", report.summary.averagePreparationMinutes, "minutes"],
    ["Summary", "Table turnover", report.summary.tableTurnover, "sessions"],
    ["Summary", "Delayed orders", report.summary.delayedOrders, ""],
    ["Summary", "Cancelled orders", report.summary.cancelledOrders, ""],
    ["Summary", "Customer wait time", report.summary.averageCustomerWaitMinutes, "minutes"],
    ...report.ordersPerHour.map((row) => ["Orders Per Hour", row.label, row.value, row.secondary ?? ""]),
    ...report.peakHours.map((row) => ["Peak Hours", row.label, row.value, row.secondary ?? ""]),
    ...report.tableTurnover.map((row) => ["Table Turnover", row.tableNumber, row.sessions, `${row.averageStayMinutes} min avg stay`]),
    ...report.waiterPerformance.map((row) => ["Waiter Performance", row.waiter, row.orders, `${row.averageWaitMinutes} min avg wait / ${row.delayedOrders} delayed`]),
    ...report.kitchenEfficiency.map((row) => ["Kitchen Efficiency", row.station, row.tickets, `${row.averagePrepMinutes} min prep / ${row.efficiency}% efficiency`]),
    ...report.stationUtilization.map((row) => ["Station Utilization", row.label, row.value, row.secondary ?? ""]),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function exportOperationalReportExcel(report: ManagerOperationalReport, filename = "serveflow-manager-operational-report.xls") {
  const tableRows = [
    ["Section", "Metric", "Value", "Secondary"],
    ["Summary", "Orders", report.summary.orders, ""],
    ["Summary", "Revenue", report.summary.revenue, ""],
    ["Summary", "Average ticket", report.summary.averageTicket, ""],
    ["Summary", "Average preparation time", report.summary.averagePreparationMinutes, "minutes"],
    ...report.ordersPerHour.map((row) => ["Orders Per Hour", row.label, row.value, row.secondary ?? ""]),
    ...report.tableTurnover.map((row) => ["Table Turnover", row.tableNumber, row.sessions, `${row.averageStayMinutes} min avg stay`]),
    ...report.waiterPerformance.map((row) => ["Waiter Performance", row.waiter, row.orders, `${row.averageWaitMinutes} min avg wait`]),
    ...report.kitchenEfficiency.map((row) => ["Kitchen Efficiency", row.station, row.tickets, `${row.averagePrepMinutes} min prep`]),
  ];
  const html = `<table>${tableRows.map((row) => `<tr>${row.map((cell) => `<td>${String(cell).replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[char] ?? char))}</td>`).join("")}</tr>`).join("")}</table>`;
  const blob = new Blob([html], { type: "application/vnd.ms-excel" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

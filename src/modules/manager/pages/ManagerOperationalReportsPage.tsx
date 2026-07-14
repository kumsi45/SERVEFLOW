import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../core/database";
import { formatCurrency, type CurrencyConfig } from "../../../core/format/currency";
import {
  exportOperationalReportCsv,
  exportOperationalReportExcel,
  loadManagerOperationalReport,
  managerReportDateRange,
  type ChartRow,
  type ManagerOperationalReport,
  type ManagerReportRange,
} from "../services/managerOperationalReportsService";
import "../styles/managerOperationalReports.css";

type Props = {
  restaurantId: string;
  restaurantName: string;
  managerName: string;
  currency?: CurrencyConfig;
};

type ChartKey = "orders" | "peak" | "preparation" | "kitchen" | "customers" | "station";

const CHARTS: Array<{ key: ChartKey; label: string }> = [
  { key: "orders", label: "Orders" },
  { key: "peak", label: "Peak Hours" },
  { key: "preparation", label: "Preparation" },
  { key: "kitchen", label: "Kitchen" },
  { key: "customers", label: "Customers" },
  { key: "station", label: "Station Utilization" },
];

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartInput() {
  const date = new Date();
  date.setDate(1);
  return date.toISOString().slice(0, 10);
}

function fmtMinutes(value: number) {
  if (!value) return "0m";
  if (value < 60) return `${Math.round(value)}m`;
  return `${Math.floor(value / 60)}h ${Math.round(value % 60)}m`;
}

function chartRows(report: ManagerOperationalReport | null, chart: ChartKey): ChartRow[] {
  if (!report) return [];
  if (chart === "orders") return report.ordersPerHour;
  if (chart === "peak") return report.peakHours;
  if (chart === "preparation") return report.delayedOrders;
  if (chart === "kitchen") return report.kitchenEfficiency.map((row) => ({ label: row.station, value: row.efficiency, secondary: row.averagePrepMinutes }));
  if (chart === "customers") return report.customerWaitTime;
  return report.stationUtilization;
}

function OperationalBars({ rows }: { rows: ChartRow[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className="mor-bars">
      {rows.map((row) => (
        <button key={row.label} type="button" className={selected === row.label ? "selected" : ""} onClick={() => setSelected(row.label)}>
          <span>{row.label}</span>
          <div><i style={{ height: `${Math.max(6, (row.value / max) * 100)}%` }} /></div>
          <strong>{row.value}</strong>
          {selected === row.label && <em>{row.secondary != null ? `Secondary: ${row.secondary}` : "Selected"}</em>}
        </button>
      ))}
      {rows.length === 0 && <p className="mor-empty">No report data for this range.</p>}
    </div>
  );
}

export function ManagerOperationalReportsPage({ restaurantId, restaurantName, managerName, currency }: Props) {
  const [range, setRange] = useState<ManagerReportRange>("today");
  const [customStart, setCustomStart] = useState(monthStartInput());
  const [customEnd, setCustomEnd] = useState(todayInput());
  const [activeChart, setActiveChart] = useState<ChartKey>("orders");
  const [report, setReport] = useState<ManagerOperationalReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dateRange = useMemo(() => managerReportDateRange(range, customStart, customEnd), [range, customStart, customEnd]);

  const refresh = useCallback(async () => {
    try {
      const next = await loadManagerOperationalReport(restaurantId, dateRange.rangeStart, dateRange.rangeEnd);
      setReport(next);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Operational reports unavailable.");
    }
  }, [restaurantId, dateRange.rangeStart, dateRange.rangeEnd]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const channel = supabase
      .channel(`manager-operational-reports:${restaurantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "order_invoices", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_table_waiter_assignments", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_staff", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh, restaurantId]);

  const rawRows = chartRows(report, activeChart);
  const rows = rawRows.some((row) => row.value > 0) ? rawRows.filter((row) => row.value > 0) : rawRows;

  return (
    <main className="mor-page">
      <header className="mor-header">
        <div>
          <span>Operational Reporting</span>
          <h1>{restaurantName}</h1>
          <p>{managerName} · operational metrics only</p>
        </div>
        <div className="mor-export">
          <button type="button" onClick={() => void refresh()}>Refresh</button>
          <button type="button" onClick={() => window.print()}>PDF</button>
          {report && <button type="button" onClick={() => exportOperationalReportExcel(report)}>Excel</button>}
          {report && <button type="button" onClick={() => exportOperationalReportCsv(report)}>CSV</button>}
        </div>
      </header>

      <section className="mor-range">
        {(["today", "week", "month", "custom"] as ManagerReportRange[]).map((option) => (
          <button key={option} type="button" className={range === option ? "active" : ""} onClick={() => setRange(option)}>{option}</button>
        ))}
        {range === "custom" && (
          <>
            <label>From<input type="date" value={customStart} max={customEnd} onChange={(event) => setCustomStart(event.target.value)} /></label>
            <label>To<input type="date" value={customEnd} min={customStart} onChange={(event) => setCustomEnd(event.target.value)} /></label>
          </>
        )}
      </section>

      {error && <div className="mor-error">{error}</div>}

      <section className="mor-summary">
        <article><span>Orders</span><strong>{report?.summary.orders ?? 0}</strong></article>
        <article><span>Revenue</span><strong>{formatCurrency(report?.summary.revenue ?? 0, currency)}</strong></article>
        <article><span>Average Bill</span><strong>{formatCurrency(report?.summary.averageTicket ?? 0, currency)}</strong></article>
        <article><span>Prep Time</span><strong>{fmtMinutes(report?.summary.averagePreparationMinutes ?? 0)}</strong></article>
        <article><span>Kitchen Efficiency</span><strong>{Math.round((report?.kitchenEfficiency.reduce((sum, row) => sum + row.efficiency, 0) ?? 0) / Math.max(1, report?.kitchenEfficiency.length ?? 0))}%</strong></article>
        <article><span>Wait Time</span><strong>{fmtMinutes(report?.summary.averageCustomerWaitMinutes ?? 0)}</strong></article>
        <article><span>Cancelled</span><strong>{report?.summary.cancelledOrders ?? 0}</strong></article>
        <article><span>Customer Count</span><strong>{report?.summary.tableTurnover ?? 0}</strong></article>
      </section>

      <section className="mor-chart-card">
        <div className="mor-chart-head">
          <div>
            <span>Interactive charts</span>
            <h2>{CHARTS.find((chart) => chart.key === activeChart)?.label}</h2>
          </div>
          <div className="mor-chart-tabs">
            {CHARTS.map((chart) => <button key={chart.key} type="button" className={activeChart === chart.key ? "active" : ""} onClick={() => setActiveChart(chart.key)}>{chart.label}</button>)}
          </div>
        </div>
        <OperationalBars rows={rows} />
      </section>

      <section className="mor-grid mor-grid-compact" hidden>
        <article className="mor-table">
          <h2>Waiter Performance</h2>
          <table><thead><tr><th>Waiter</th><th>Orders</th><th>Avg Wait</th><th>Delayed</th></tr></thead><tbody>{(report?.waiterPerformance ?? []).map((row) => <tr key={row.staffId || row.waiter}><td>{row.waiter}</td><td>{row.orders}</td><td>{fmtMinutes(row.averageWaitMinutes)}</td><td>{row.delayedOrders}</td></tr>)}</tbody></table>
        </article>
        <article className="mor-table">
          <h2>Kitchen Efficiency</h2>
          <table><thead><tr><th>Station</th><th>Tickets</th><th>Avg Prep</th><th>Efficiency</th></tr></thead><tbody>{(report?.kitchenEfficiency ?? []).map((row) => <tr key={row.stationId || row.station}><td>{row.station}</td><td>{row.tickets}</td><td>{fmtMinutes(row.averagePrepMinutes)}</td><td>{row.efficiency}%</td></tr>)}</tbody></table>
        </article>
        <article className="mor-table">
          <h2>Table Turnover</h2>
          <table><thead><tr><th>Table</th><th>Sessions</th><th>Avg Stay</th></tr></thead><tbody>{(report?.tableTurnover ?? []).map((row) => <tr key={row.tableNumber}><td>{row.tableNumber}</td><td>{row.sessions}</td><td>{fmtMinutes(row.averageStayMinutes)}</td></tr>)}</tbody></table>
        </article>
      </section>
    </main>
  );
}

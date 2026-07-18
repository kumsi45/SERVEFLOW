import { useCallback, useEffect, useMemo, useState } from "react";
import { useTenantRealtime } from "../../../core/realtime/useTenantRealtime";
import { formatCurrency, type CurrencyConfig } from "../../../core/format/currency";
import {
  exportOperationalReportCsv,
  exportOperationalReportExcel,
  loadManagerOperationalReport,
  loadRestaurantAnalyticsTimezone,
  managerReportDateRange,
  type ChartRow,
  type ManagerOperationalReport,
  type ManagerReportRange,
} from "../services/managerOperationalReportsService";
import "../styles/managerOperationalReports.css";

type Props = { restaurantId: string; restaurantName: string; managerName: string; currency?: CurrencyConfig };

function todayInput() { return new Date().toISOString().slice(0, 10); }
function monthStartInput() { const date = new Date(); date.setDate(1); return date.toISOString().slice(0, 10); }
function fmtMinutes(value: number) { return value < 60 ? `${Math.round(value)}m` : `${Math.floor(value / 60)}h ${Math.round(value % 60)}m`; }
function bestRow(rows: ChartRow[]) { return rows.reduce<ChartRow | null>((best, row) => !best || row.value > best.value ? row : best, null); }

function LineChart({ rows, suffix = "" }: { rows: ChartRow[]; suffix?: string }) {
  const values = rows.length ? rows : [{ label: "No data", value: 0 }];
  const max = Math.max(1, ...values.map((row) => row.value));
  const points = values.map((row, index) => `${values.length === 1 ? 50 : (index / (values.length - 1)) * 100},${92 - (row.value / max) * 78}`).join(" ");
  return <div className="mor-line"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Trend line"><line x1="0" y1="92" x2="100" y2="92" /><polyline points={points} /></svg><div>{values.filter((_, index) => index === 0 || index === values.length - 1 || index === Math.floor(values.length / 2)).map((row) => <span key={row.label}>{row.label}<b>{row.value}{suffix}</b></span>)}</div></div>;
}

function HorizontalBars({ rows, suffix = "" }: { rows: ChartRow[]; suffix?: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return <div className="mor-horizontal">{rows.slice(0, 8).map((row) => <div key={row.label}><span>{row.label}</span><i><b style={{ width: `${(row.value / max) * 100}%` }} /></i><strong>{row.value}{suffix}</strong></div>)}{rows.length === 0 && <p className="mor-empty">No activity in this period.</p>}</div>;
}

function InsightCard({ eyebrow, question, story, children, wide = false }: { eyebrow: string; question: string; story: string; children: React.ReactNode; wide?: boolean }) {
  return <article className={`mor-insight ${wide ? "is-wide" : ""}`}><header><span>{eyebrow}</span><h2>{question}</h2><p>{story}</p></header>{children}</article>;
}

function hourNumber(label: string) { const value = Number.parseInt(label.slice(0, 2), 10); return Number.isFinite(value) ? value : 0; }
function displayHour(label: string) { const hour = hourNumber(label); return `${hour % 12 || 12}:00 ${hour >= 12 ? "PM" : "AM"}`; }
function servicePeriod(label: string) { const hour = hourNumber(label); return hour < 11 ? "Breakfast" : hour < 16 ? "Lunch" : "Dinner"; }

function CustomerTrafficReport({ report }: { report: ManagerOperationalReport | null }) {
  const [selectedHour, setSelectedHour] = useState<ChartRow | null>(null);
  const rows = useMemo(() => {
    const byHour = new Map<string, number>();
    for (const row of report?.ordersPerHour ?? []) byHour.set(row.label, (byHour.get(row.label) ?? 0) + row.value);
    return Array.from(byHour, ([label, value]) => ({ label, value })).sort((a, b) => hourNumber(a.label) - hourNumber(b.label));
  }, [report?.ordersPerHour]);
  const activeRows = rows.filter((row) => row.value > 0);
  const peak = bestRow(rows);
  const slowest = activeRows.reduce<ChartRow | null>((result, row) => !result || row.value < result.value ? row : result, null);
  const average = activeRows.length ? Math.round(activeRows.reduce((sum, row) => sum + row.value, 0) / activeRows.length) : 0;
  const max = Math.max(1, ...rows.map((row) => row.value));
  const rushHours = peak ? rows.filter((row) => row.value >= peak.value * .7).length : 0;
  const recent = activeRows.slice(-3).reduce((sum, row) => sum + row.value, 0);
  const previous = activeRows.slice(-6, -3).reduce((sum, row) => sum + row.value, 0);
  const trend = previous === 0 ? "Establishing" : recent > previous * 1.1 ? "Increasing" : recent < previous * .9 ? "Decreasing" : "Stable";
  return <section className="mor-traffic">
    <header className="mor-traffic-title"><div><span>Customer Traffic Report</span><h2>When did customers arrive?</h2><p>Historical arrival demand is represented by orders because the current report does not record party size by hour.</p></div><em>{trend}</em></header>
    <div className="mor-traffic-summary">
      <article><span>Peak Hour</span><strong>{peak ? displayHour(peak.label) : "—"}</strong><small>{peak ? `${peak.value} orders` : "No arrivals"}</small></article>
      <article><span>Average per Active Hour</span><strong>{average}</strong><small>Orders</small></article>
      <article><span>Slowest Active Hour</span><strong>{slowest ? displayHour(slowest.label) : "—"}</strong><small>{slowest ? `${slowest.value} orders` : "No arrivals"}</small></article>
      <article><span>Current Trend</span><strong>{trend}</strong><small>Latest active hours</small></article>
    </div>
    <div className="mor-traffic-layout">
      <article className="mor-traffic-chart"><div className="mor-chart-caption"><div><strong>Arrival Orders by Hour</strong><span>Tap an hour to inspect it</span></div><div><i />Breakfast <i />Lunch <i />Dinner</div></div><div className="mor-vertical-bars">{rows.map((row) => <button key={row.label} type="button" className={`is-${servicePeriod(row.label).toLowerCase()}`} onClick={() => setSelectedHour(row)} aria-label={`${displayHour(row.label)}: ${row.value} orders`}><b style={{ height: `${Math.max(row.value ? 5 : 1, (row.value / max) * 100)}%` }}><span>{row.value || ""}</span></b><small>{displayHour(row.label).replace(":00 ", "")}</small></button>)}</div></article>
      <aside className="mor-traffic-actions"><section><span>Period Summary</span><p>{peak ? `${servicePeriod(peak.label)} contained the strongest arrival period, peaking at ${displayHour(peak.label)}.` : "No customer-flow pattern was recorded for this period."}</p><p>{trend === "Establishing" ? "More active hours are needed to describe the period direction." : `Arrival pace was ${trend.toLowerCase()} across the latest active hours.`}</p><p>Recommendations and forecasts are available in Restaurant Intelligence.</p></section></aside>
    </div>
    <div className="mor-traffic-indicators"><span><b>{peak ? displayHour(peak.label) : "—"}</b>Peak hour</span><span><b>{rushHours ? `${rushHours}h` : "—"}</b>Rush duration</span><span><b>{fmtMinutes(report?.summary.averageCustomerWaitMinutes ?? 0)}</b>Avg wait</span></div>
    {selectedHour && <div className="mor-drill-layer" role="presentation" onClick={() => setSelectedHour(null)}><aside className="mor-drill" role="dialog" aria-modal="true" aria-label={`${displayHour(selectedHour.label)} traffic details`} onClick={(event) => event.stopPropagation()}><header><div><span>{servicePeriod(selectedHour.label)}</span><h2>{displayHour(selectedHour.label)}</h2></div><button type="button" onClick={() => setSelectedHour(null)}>Close</button></header><dl><div><dt>Orders</dt><dd>{selectedHour.value}</dd></div></dl></aside></div>}
  </section>;
}

export function ManagerOperationalReportsPage({ restaurantId, restaurantName, managerName, currency }: Props) {
  const [range, setRange] = useState<ManagerReportRange>("today");
  const [customStart, setCustomStart] = useState(monthStartInput());
  const [customEnd, setCustomEnd] = useState(todayInput());
  const [report, setReport] = useState<ManagerOperationalReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState("Africa/Nairobi");
  const dateRange = useMemo(() => managerReportDateRange(range, customStart, customEnd, timezone), [range, customStart, customEnd, timezone]);
  useEffect(() => { void loadRestaurantAnalyticsTimezone(restaurantId).then(setTimezone).catch(() => undefined); }, [restaurantId]);
  const refresh = useCallback(async () => { try { setReport(await loadManagerOperationalReport(restaurantId, dateRange.rangeStart, dateRange.rangeEnd, timezone)); setError(null); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Operational reports unavailable."); } }, [restaurantId, dateRange.rangeStart, dateRange.rangeEnd, timezone]);

  useEffect(() => { void refresh(); }, [refresh]);
  useTenantRealtime({ channelName: "manager-operational-reports", restaurantId, tables: ["orders", "order_items", "order_invoices", "restaurant_table_waiter_assignments", "restaurant_staff"], refresh });

  const peak = bestRow(report?.ordersPerHour ?? []);
  const busiestWaiter = [...(report?.waiterPerformance ?? [])].sort((a, b) => b.orders - a.orders)[0];
  const slowestTable = [...(report?.tableTurnover ?? [])].sort((a, b) => b.averageStayMinutes - a.averageStayMinutes)[0];
  const slowestStation = [...(report?.kitchenEfficiency ?? [])].sort((a, b) => b.averagePrepMinutes - a.averagePrepMinutes)[0];
  const tableRows = (report?.tableTurnover ?? []).map((row) => ({ label: `Table ${row.tableNumber}`, value: row.averageStayMinutes, secondary: row.sessions }));
  const waiterRows = (report?.waiterPerformance ?? []).map((row) => ({ label: row.waiter, value: row.orders, secondary: row.delayedOrders }));
  const kitchenRows = (report?.kitchenEfficiency ?? []).map((row) => ({ label: row.station, value: row.averagePrepMinutes, secondary: row.delayed }));

  return <main className="mor-page">
    <header className="mor-header"><div><span>Operational Intelligence</span><h1>Reports</h1><p>{restaurantName} · insights for {managerName}</p></div><details className="mor-export manager-actions-menu"><summary>Export report</summary><div><button type="button" onClick={() => void refresh()}>Refresh</button><button type="button" onClick={() => window.print()}>PDF</button>{report && <button type="button" onClick={() => exportOperationalReportExcel(report)}>Excel</button>}{report && <button type="button" onClick={() => exportOperationalReportCsv(report)}>CSV</button>}</div></details></header>
    <section className="mor-range" aria-label="Report period">{(["today", "week", "month", "custom"] as ManagerReportRange[]).map((option) => <button key={option} type="button" className={range === option ? "active" : ""} onClick={() => setRange(option)}>{option}</button>)}{range === "custom" && <><label>From<input type="date" value={customStart} max={customEnd} onChange={(event) => setCustomStart(event.target.value)} /></label><label>To<input type="date" value={customEnd} min={customStart} onChange={(event) => setCustomEnd(event.target.value)} /></label></>}</section>
    {error && <div className="mor-error">{error}</div>}
    <section className="mor-summary">
      <article><span>Revenue</span><strong>{formatCurrency(report?.summary.revenue ?? 0, currency)}</strong><small>Selected period</small></article>
      <article><span>Orders</span><strong>{report?.summary.orders ?? 0}</strong><small>{peak ? `Peak ${peak.label}` : "No peak yet"}</small></article>
      <article><span>Avg Prep Time</span><strong>{fmtMinutes(report?.summary.averagePreparationMinutes ?? 0)}</strong><small>{report?.summary.delayedOrders ?? 0} delayed</small></article>
      <article><span>Table Turnover</span><strong>{report?.summary.tableTurnover ?? 0}</strong><small>Dining sessions</small></article>
      <article><span>Cancelled</span><strong>{report?.summary.cancelledOrders ?? 0}</strong><small>Orders lost</small></article>
      <article><span>Collected</span><strong>{formatCurrency(report?.summary.collected ?? 0, currency)}</strong><small>Paid invoices</small></article>
      <article><span>Payment Due</span><strong>{formatCurrency(report?.summary.paymentDue ?? 0, currency)}</strong><small>Outstanding held invoices</small></article>
      <article><span>Refunds</span><strong>{formatCurrency(report?.summary.refunds ?? 0, currency)}</strong><small>Selected period</small></article>
      <article><span>Payment Conversion</span><strong>{Math.round(report?.summary.paymentConversionRate ?? 0)}%</strong><small>{fmtMinutes(report?.summary.averagePaymentDelayMinutes ?? 0)} average delay</small></article>
    </section>
    <section className="mor-intelligence">
      <CustomerTrafficReport report={report} />
      <InsightCard eyebrow="Orders by hour" question="When are we busiest?" story={peak ? `Peak hour was ${peak.label}, handling ${peak.value} orders.` : "Order volume has not established a peak yet."}><LineChart rows={report?.ordersPerHour ?? []} /></InsightCard>
      <InsightCard eyebrow="Kitchen performance" question="Is the kitchen slowing down?" story={slowestStation ? `${slowestStation.station} has the longest average prep time at ${fmtMinutes(slowestStation.averagePrepMinutes)}.` : "No kitchen tickets were completed in this period."}><HorizontalBars rows={kitchenRows} suffix="m" /></InsightCard>
      <InsightCard eyebrow="Staff productivity" question="Who handled the most tables?" story={busiestWaiter ? `${busiestWaiter.waiter} handled the most orders (${busiestWaiter.orders}).` : "No waiter activity is available for this period."}><HorizontalBars rows={waiterRows} /></InsightCard>
      <InsightCard eyebrow="Table turnover" question="Which tables stay occupied longest?" story={slowestTable ? `Table ${slowestTable.tableNumber} has the longest average stay at ${fmtMinutes(slowestTable.averageStayMinutes)}.` : "No completed table sessions are available."}><HorizontalBars rows={tableRows} suffix="m" /></InsightCard>
      <InsightCard eyebrow="Cancelled orders" question="When are we losing orders?" story={(report?.summary.cancelledOrders ?? 0) ? `${report?.summary.cancelledOrders} orders were cancelled. Cancellation reasons are not currently recorded in this report.` : "No cancelled orders were recorded in this period."} wide><LineChart rows={report?.cancelledOrders ?? []} /></InsightCard>
    </section>
  </main>;
}

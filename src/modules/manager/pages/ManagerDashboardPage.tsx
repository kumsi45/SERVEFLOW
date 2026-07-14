import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../core/database";
import { formatCurrency, type CurrencyConfig } from "../../../core/format/currency";
import { fetchManagerDashboardSnapshot } from "../services/managerDashboardService";
import type { ManagerDashboardSnapshot, ManagerFloorTable } from "../types";
import "../styles/managerDashboard.css";

type Props = {
  restaurantId: string;
  restaurantName: string;
  managerName: string;
  currency?: CurrencyConfig;
};

function tableStatusLabel(table: ManagerFloorTable) {
  if (table.status === "waiting_payment") return "Payment";
  if (table.status === "kitchen_delay") return "Kitchen delay";
  if (table.status === "waiting_pickup") return "Pickup";
  if (table.status === "long_session") return "Long session";
  if (table.status === "waiting") return "Waiting";
  if (table.status === "qr_ordering") return "QR active";
  if (table.status === "occupied") return "Occupied";
  if (table.status === "inactive") return "Inactive";
  return "Available";
}

function statusText(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDuration(minutes: number | null) {
  if (minutes == null) return "--";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function tableVisualStatus(table: ManagerFloorTable) {
  if (!table.active) return "cleaning";
  if (table.alerts.length > 0 || ["kitchen_delay", "long_session", "waiting_pickup"].includes(table.status)) return "attention";
  if (table.status === "waiting_payment" || ["waiting_payment", "billing"].includes(table.cashierStatus)) return "cashier";
  if (table.status === "occupied" || table.status === "waiting" || table.status === "qr_ordering") return "occupied";
  return "available";
}

function tableVisualLabel(table: ManagerFloorTable) {
  const visualStatus = tableVisualStatus(table);
  if (visualStatus === "attention") return "Attention";
  if (visualStatus === "cashier") return "Payment";
  if (visualStatus === "occupied") return "Occupied";
  if (visualStatus === "cleaning") return "Cleaning";
  return "Available";
}

function buildActivityItems(tables: ManagerFloorTable[]) {
  const items = tables
    .filter((table) => table.active || table.runningBill > 0 || table.alerts.length > 0)
    .slice(0, 5)
    .map((table) => {
      if (table.status === "waiting_payment") return `${table.label} requested bill`;
      if (table.readyItemCount > 0) return `Kitchen ready for ${table.label}`;
      if (table.assignedWaiterName) return `${table.assignedWaiterName} assigned to ${table.label}`;
      if (table.active) return `${table.label} seated`;
      return `${table.label} released`;
    });
  return items.length > 0 ? items : ["Restaurant floor is ready", "No recent table events"];
}

export function ManagerDashboardPage({ restaurantId, restaurantName, managerName, currency }: Props) {
  const [snapshot, setSnapshot] = useState<ManagerDashboardSnapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [tableQuery, setTableQuery] = useState("");
  const [tableFilter, setTableFilter] = useState("all");
  const [visibleTableCount, setVisibleTableCount] = useState(8);

  const loadSnapshot = useCallback(async () => {
    try {
      const nextSnapshot = await fetchManagerDashboardSnapshot(restaurantId);
      setSnapshot(nextSnapshot);
      setStatus("ready");
      setError(null);
    } catch (loadError) {
      setStatus("error");
      setError(loadError instanceof Error ? loadError.message : "Unable to load manager dashboard.");
    }
  }, [restaurantId]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    const channel = supabase
      .channel(`manager-dashboard:${restaurantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` }, () => void loadSnapshot())
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items", filter: `restaurant_id=eq.${restaurantId}` }, () => void loadSnapshot())
      .on("postgres_changes", { event: "*", schema: "public", table: "order_invoices", filter: `restaurant_id=eq.${restaurantId}` }, () => void loadSnapshot())
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_tables", filter: `restaurant_id=eq.${restaurantId}` }, () => void loadSnapshot())
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_table_waiter_assignments", filter: `restaurant_id=eq.${restaurantId}` }, () => void loadSnapshot())
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_staff", filter: `restaurant_id=eq.${restaurantId}` }, () => void loadSnapshot())
      .on("postgres_changes", { event: "*", schema: "public", table: "cashier_shifts", filter: `restaurant_id=eq.${restaurantId}` }, () => void loadSnapshot())
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadSnapshot, restaurantId]);

  const notifications = snapshot?.notifications ?? [];
  const floorTables = snapshot?.floorTables ?? [];
  const filteredTables = floorTables.filter((table) => {
    const query = tableQuery.trim().toLowerCase();
    const matchesQuery = !query || table.label.toLowerCase().includes(query) || (table.assignedWaiterName || "").toLowerCase().includes(query);
    const visual = tableVisualStatus(table);
    const matchesFilter = tableFilter === "all" || visual === tableFilter;
    return matchesQuery && matchesFilter;
  });
  const visibleTables = filteredTables.slice(0, visibleTableCount);
  const occupiedPercent = useMemo(() => {
    if (!snapshot?.floorTables.length) return 0;
    const activeTableCount = snapshot.floorTables.filter((table) => table.active).length;
    if (!activeTableCount) return 0;
    return Math.round((snapshot.kpis.occupiedTables / activeTableCount) * 100) || 0;
  }, [snapshot]);
  const selectedTable = snapshot?.floorTables.find((table) => table.id === selectedTableId) ?? null;
  const activityItems = useMemo(() => buildActivityItems(floorTables), [floorTables]);
  const healthScore = Math.max(68, 100 - notifications.length * 5 - floorTables.filter((table) => table.alerts.length > 0).length * 4);
  const kitchenLoad = (snapshot?.kpis.kitchenWaiting ?? 0) + (snapshot?.kpis.kitchenPreparing ?? 0);
  const suggestedAction = notifications[0] ?? (kitchenLoad > 0 ? "Monitor kitchen queue and payment flow." : "Keep floor coverage balanced.");
  const liveMetrics = snapshot?.liveMetrics;
  const revenueToday = liveMetrics?.revenueToday ?? 0;
  const averageWait = floorTables.length ? Math.round(floorTables.reduce((sum, table) => sum + (table.sessionDurationMinutes ?? 0), 0) / floorTables.length) : 0;
  const overviewCards = [
    { label: "Restaurant Health", value: `${healthScore}%`, tone: "green" },
    { label: "Revenue Today", value: formatCurrency(revenueToday, currency), tone: "blue" },
    { label: "Revenue This Shift", value: formatCurrency(liveMetrics?.revenueThisShift ?? 0, currency), tone: "violet" },
    { label: "Orders Today", value: liveMetrics?.ordersToday ?? 0, tone: "slate" },
    { label: "Tables Occupied", value: snapshot?.kpis.occupiedTables ?? 0, tone: "green" },
    { label: "Kitchen Delays", value: floorTables.filter((table) => table.status === "kitchen_delay").length, tone: "red" },
    { label: "Average Wait Time", value: formatDuration(averageWait), tone: "amber" },
    { label: "Staff Online", value: snapshot?.kpis.staffOnDuty ?? 0, tone: "slate" },
    { label: "Pending Payments", value: liveMetrics?.pendingPayments ?? snapshot?.kpis.awaitingCashier ?? 0, tone: "red" },
    { label: "Critical Alerts", value: notifications.length, tone: "red" },
  ];

  return (
    <main className="md-overview">
      <div className="manager-module-header">
        <div>
          <span>Overview</span>
          <h1>Manager Dashboard</h1>
        </div>
        <p>{status === "loading" ? "Syncing live operations..." : status === "error" ? error : `${restaurantName} · ${managerName}`}</p>
      </div>

      <section className="md-kpis" aria-label="Live KPIs">
        {overviewCards.map((kpi) => (
          <article className={`md-kpi md-kpi-${kpi.tone}`} key={kpi.label}>
            <span>{kpi.label}</span>
            <strong>{kpi.value}</strong>
            <small>Live</small>
          </article>
        ))}
      </section>

      <section className="md-main-grid">
        <article className="md-floor">
          <div className="md-section-heading">
            <div>
              <h1>Floor Overview</h1>
              <span>{occupiedPercent}% occupied · {floorTables.length} tables monitored</span>
            </div>
            <div className="md-floor-tabs" aria-label="Floor sections">
              <button type="button">Main Hall</button>
              <button type="button">Terrace</button>
            </div>
          </div>
          <div className="md-floor-controls">
            <input value={tableQuery} onChange={(event) => setTableQuery(event.target.value)} placeholder="Search table or waiter" />
            <select value={tableFilter} onChange={(event) => setTableFilter(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="available">Available</option>
              <option value="occupied">Occupied</option>
              <option value="cashier">Waiting Payment</option>
              <option value="attention">Needs Attention</option>
              <option value="cleaning">Cleaning</option>
            </select>
          </div>
          <div className="md-table-grid">
            {visibleTables.map((table) => (
              <button className={`md-table md-table-${tableVisualStatus(table)}`} key={table.id} type="button" onClick={() => setSelectedTableId(table.id)}>
                <div className="md-table-topline">
                  <strong>{table.label}</strong>
                  <span>{tableVisualLabel(table)}</span>
                </div>
                <div className="md-table-meta">
                  <small>Waiter</small>
                  <b>{table.assignedWaiterName || "Unassigned"}</b>
                </div>
                <div className="md-table-metrics">
                  <div>
                    <small>Bill</small>
                    <b>{formatCurrency(table.runningBill, currency)}</b>
                  </div>
                  <div>
                    <small>Duration</small>
                    <b>{formatDuration(table.sessionDurationMinutes)}</b>
                  </div>
                </div>
                <div className="md-table-status-row">
                  <em>{statusText(table.kitchenStatus)}</em>
                  <em>{statusText(table.cashierStatus)}</em>
                </div>
                {table.alerts.length > 0 && <p>{table.alerts[0].label}</p>}
              </button>
            ))}
            {filteredTables.length === 0 && <p className="md-empty">No matching tables. Clear filters or check table setup.</p>}
          </div>
          {visibleTableCount < filteredTables.length && <button className="md-load-more" type="button" onClick={() => setVisibleTableCount((count) => count + 8)}>Show more tables</button>}
        </article>

        <aside className="md-side">
          <article className="md-panel md-alert-panel" id="notifications">
            <div className="md-panel-title">
              <span>!</span>
              <strong>Notifications</strong>
            </div>
            <div className="md-alert-list">
              {notifications.length > 0 ? notifications.slice(0, 5).map((message) => <p key={message}>{message}</p>) : <p>No urgent operational alerts.</p>}
            </div>
          </article>

          <article className="md-panel">
            <div className="md-panel-title">
              <strong>Live Activity</strong>
              <a href="/manager/dashboard">View All</a>
            </div>
            <div className="md-activity-list">
              {activityItems.map((item, index) => (
                <p key={`${item}-${index}`}><span />{item}<small>{index === 0 ? "Just now" : `${index * 3 + 2} mins ago`}</small></p>
              ))}
            </div>
          </article>

          <article className="md-panel md-ai-panel">
            <div className="md-panel-title">
              <span>AI</span>
              <strong>AI Summary</strong>
            </div>
            <dl>
              <div><dt>Restaurant Health</dt><dd>{healthScore}/100</dd></div>
              <div><dt>Kitchen Load</dt><dd>{kitchenLoad} active</dd></div>
              <div><dt>Waiter Load</dt><dd>{snapshot?.kpis.staffOnDuty ?? 0} on duty</dd></div>
              <div><dt>Suggested Action</dt><dd>{suggestedAction}</dd></div>
            </dl>
            <a href="/manager/ai">Open AI Advisor</a>
          </article>
        </aside>
      </section>

      {selectedTable && (
        <div className="md-detail-layer" role="presentation" onClick={() => setSelectedTableId(null)}>
          <aside className="md-detail" role="dialog" aria-modal="true" aria-label={`${selectedTable.label} details`} onClick={(event) => event.stopPropagation()}>
            <div className="md-detail-header">
              <div>
                <span>{tableStatusLabel(selectedTable)}</span>
                <h2>{selectedTable.label}</h2>
              </div>
              <button type="button" onClick={() => setSelectedTableId(null)} aria-label="Close table details">Close</button>
            </div>
            <div className="md-detail-grid">
              <div><span>Assigned waiter</span><strong>{selectedTable.assignedWaiterName || "Unassigned"}</strong></div>
              <div><span>Running bill</span><strong>{formatCurrency(selectedTable.runningBill, currency)}</strong></div>
              <div><span>Session duration</span><strong>{formatDuration(selectedTable.sessionDurationMinutes)}</strong></div>
              <div><span>Kitchen status</span><strong>{statusText(selectedTable.kitchenStatus)}</strong></div>
              <div><span>Cashier status</span><strong>{statusText(selectedTable.cashierStatus)}</strong></div>
              <div><span>Items ready</span><strong>{selectedTable.readyItemCount} / {selectedTable.itemCount}</strong></div>
            </div>
            <section className="md-detail-section">
              <h3>Alerts</h3>
              {selectedTable.alerts.length > 0 ? (
                <div className="md-detail-alerts">
                  {selectedTable.alerts.map((alert) => <p key={alert.type}>{alert.label}: {alert.minutes}m</p>)}
                </div>
              ) : (
                <p>No active table alerts.</p>
              )}
            </section>
            <section className="md-detail-section">
              <h3>Session</h3>
              <p>{selectedTable.customerName || "No customer name"} · {selectedTable.invoiceCount} bill batch{selectedTable.invoiceCount === 1 ? "" : "es"} · {selectedTable.activeOrderSource ? statusText(selectedTable.activeOrderSource) : "No active source"}</p>
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}

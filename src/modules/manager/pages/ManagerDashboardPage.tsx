import { useCallback, useEffect, useMemo, useState } from "react";
import { useTenantRealtime } from "../../../core/realtime/useTenantRealtime";
import {
  formatCurrency,
  type CurrencyConfig,
} from "../../../core/format/currency";
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
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDuration(minutes: number | null) {
  if (minutes == null) return "--";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function tableVisualStatus(table: ManagerFloorTable) {
  if (!table.active) return "cleaning";
  if (
    table.alerts.length > 0 ||
    ["kitchen_delay", "long_session", "waiting_pickup"].includes(table.status)
  )
    return "attention";
  if (
    table.status === "waiting_payment" ||
    ["waiting_payment", "billing"].includes(table.cashierStatus)
  )
    return "cashier";
  if (
    table.status === "occupied" ||
    table.status === "waiting" ||
    table.status === "qr_ordering"
  )
    return "occupied";
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
    .filter(
      (table) =>
        table.active || table.runningBill > 0 || table.alerts.length > 0,
    )
    .slice(0, 5)
    .map((table) => {
      if (table.status === "waiting_payment")
        return `${table.label} requested bill`;
      if (table.readyItemCount > 0) return `Kitchen ready for ${table.label}`;
      if (table.assignedWaiterName)
        return `${table.assignedWaiterName} assigned to ${table.label}`;
      if (table.active) return `${table.label} seated`;
      return `${table.label} released`;
    });
  return items.length > 0
    ? items
    : ["Restaurant floor is ready", "No recent table events"];
}

export function ManagerDashboardPage({
  restaurantId,
  restaurantName,
  managerName,
  currency,
}: Props) {
  const [snapshot, setSnapshot] = useState<ManagerDashboardSnapshot | null>(
    null,
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
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
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load manager dashboard.",
      );
    }
  }, [restaurantId]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useTenantRealtime({ channelName: "manager-dashboard", restaurantId, tables: ["orders", "order_items", "order_invoices", "restaurant_tables", "restaurant_table_waiter_assignments", "restaurant_staff", "cashier_shifts"], refresh: loadSnapshot });

  const notifications = snapshot?.notifications ?? [];
  const floorTables = snapshot?.floorTables ?? [];
  const filteredTables = floorTables.filter((table) => {
    const query = tableQuery.trim().toLowerCase();
    const matchesQuery =
      !query ||
      table.label.toLowerCase().includes(query) ||
      (table.assignedWaiterName || "").toLowerCase().includes(query);
    const visual = tableVisualStatus(table);
    const matchesFilter = tableFilter === "all" || visual === tableFilter;
    return matchesQuery && matchesFilter;
  });
  const visibleTables = filteredTables.slice(0, visibleTableCount);
  const occupiedPercent = useMemo(() => {
    if (!snapshot?.floorTables.length) return 0;
    const activeTableCount = snapshot.floorTables.filter(
      (table) => table.active,
    ).length;
    if (!activeTableCount) return 0;
    return (
      Math.round((snapshot.kpis.occupiedTables / activeTableCount) * 100) || 0
    );
  }, [snapshot]);
  const selectedTable =
    snapshot?.floorTables.find((table) => table.id === selectedTableId) ?? null;
  const activityItems = useMemo(
    () => buildActivityItems(floorTables),
    [floorTables],
  );
  const kitchenLoad =
    (snapshot?.kpis.kitchenWaiting ?? 0) +
    (snapshot?.kpis.kitchenPreparing ?? 0);
  const suggestedAction =
    notifications[0] ??
    (kitchenLoad > 0
      ? "Monitor kitchen queue and payment flow."
      : "Keep floor coverage balanced.");
  const liveMetrics = snapshot?.liveMetrics;
  const revenueToday = liveMetrics?.revenueToday ?? 0;
  const digitalRevenue = liveMetrics?.digitalCollected ?? 0;
  const averageWait = floorTables.length
    ? Math.round(
        floorTables.reduce(
          (sum, table) => sum + (table.sessionDurationMinutes ?? 0),
          0,
        ) / floorTables.length,
      )
    : 0;
  const kitchenDelays = floorTables.filter(
    (table) => table.status === "kitchen_delay",
  ).length;
  const pendingPayments =
    liveMetrics?.pendingPayments ?? snapshot?.kpis.awaitingCashier ?? 0;
  const waitingTables = floorTables.filter(
    (table) =>
      table.status === "waiting" ||
      (table.activeOrderId && !table.assignedWaiterName),
  ).length;
  const complaints = notifications.filter((message) =>
    message.toLowerCase().includes("complaint"),
  ).length;
  const vipWaiting = floorTables.filter(
    (table) =>
      (table.customerName ?? "").toLowerCase().includes("vip") &&
      table.status === "waiting",
  ).length;
  const shiftIssues = notifications.filter((message) =>
    message.toLowerCase().includes("shift"),
  ).length;
  const overviewCards = [
    {
      icon: "$",
      label: "Revenue Today",
      value: formatCurrency(revenueToday, currency),
      tone: "green",
      status: "Live sales",
    },
    {
      icon: "#",
      label: "Orders",
      value: liveMetrics?.ordersToday ?? 0,
      tone: "blue",
      status: `${liveMetrics?.ordersPending ?? 0} pending`,
    },
    {
      icon: "Ø",
      label: "Average Bill",
      value: formatCurrency(liveMetrics?.averageOrder ?? 0, currency),
      tone: "violet",
      status: "Today",
    },
    {
      icon: "▦",
      label: "Tables Occupied",
      value: snapshot?.kpis.occupiedTables ?? 0,
      tone: "green",
      status: `${occupiedPercent}% occupancy`,
    },
    {
      icon: "!",
      label: "Pending Payments",
      value: pendingPayments,
      tone: pendingPayments ? "red" : "slate",
      status: pendingPayments ? "Needs review" : "Clear",
    },
    {
      icon: "$",
      label: "Payment Due",
      value: formatCurrency(liveMetrics?.paymentDueAmount ?? 0, currency),
      tone: (liveMetrics?.paymentDueAmount ?? 0) > 0 ? "amber" : "slate",
      status: "Outstanding bills",
    },
    {
      icon: "↺",
      label: "Refunds",
      value: formatCurrency(liveMetrics?.refunds ?? 0, currency),
      tone: (liveMetrics?.refunds ?? 0) > 0 ? "red" : "slate",
      status: "Today",
    },
    {
      icon: "⌛",
      label: "Collection Time",
      value: formatDuration(
        Math.round(liveMetrics?.averageCollectionMinutes ?? 0),
      ),
      tone: "blue",
      status: "Average today",
    },
    {
      icon: "◫",
      label: "Kitchen Load",
      value: kitchenLoad,
      tone: kitchenDelays ? "red" : "amber",
      status: `${kitchenDelays} delayed`,
    },
    {
      icon: "♙",
      label: "Staff On Shift",
      value: snapshot?.kpis.staffOnDuty ?? 0,
      tone: "blue",
      status: "Active now",
    },
    {
      icon: "⌛",
      label: "Waiting Tables",
      value: waitingTables,
      tone: waitingTables ? "amber" : "slate",
      status: averageWait ? `${formatDuration(averageWait)} avg` : "No wait",
    },
  ];
  const attentionItems = [
    {
      label: "Late Orders",
      value: floorTables.filter((table) =>
        table.alerts.some((alert) => alert.type === "long_session"),
      ).length,
      href: "/manager/tables",
      available: true,
    },
    {
      label: "Kitchen Delay",
      value: kitchenDelays,
      href: "/manager/kitchen",
      available: true,
    },
    {
      label: "VIP Waiting",
      value: vipWaiting,
      href: "/manager/customers",
      available: true,
    },
    {
      label: "Complaints",
      value: complaints,
      href: "/manager/customers",
      available: true,
    },
    {
      label: "Pending Bills",
      value: pendingPayments,
      href: "/manager/tables",
      available: true,
    },
    {
      label: "Tables Waiting",
      value: waitingTables,
      href: "/manager/tables",
      available: true,
    },
    {
      label: "Shift Issues",
      value: shiftIssues,
      href: "/manager/staff",
      available: true,
    },
  ];

  return (
    <main className="md-overview">
      <div className="manager-module-header">
        <div>
          <span>Overview</span>
          <h1>Manager Dashboard</h1>
        </div>
        <p>
          {status === "loading"
            ? "Syncing live operations..."
            : status === "error"
              ? error
              : `${restaurantName} · ${managerName}`}
        </p>
      </div>

      <div className="md-block-heading">
        <div>
          <span>Today</span>
          <h2>Today&apos;s KPIs</h2>
        </div>
        <small>Updates in realtime</small>
      </div>
      <section className="md-kpis" aria-label="Live KPIs">
        {overviewCards.map((kpi) => (
          <article className={`md-kpi md-kpi-${kpi.tone}`} key={kpi.label}>
            <i aria-hidden="true">{kpi.icon}</i>
            <span>{kpi.label}</span>
            <strong>{kpi.value}</strong>
            <small>{kpi.status}</small>
          </article>
        ))}
      </section>

      <section className="md-attention" id="notifications">
        <div className="md-block-heading">
          <div>
            <span>Prioritized</span>
            <h2>Attention Center</h2>
          </div>
          <small>
            {attentionItems.filter((item) => item.value > 0).length} items need
            review
          </small>
        </div>
        <div className="md-attention-grid">
          {attentionItems.map((item) => (
            <a key={item.label} href={item.href}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <small>{item.value ? "Review now" : "Clear"}</small>
            </a>
          ))}
        </div>
      </section>

      <section className="md-main-grid">
        <article className="md-floor">
          <div className="md-section-heading">
            <div>
              <h1>Floor Status</h1>
              <span>
                {occupiedPercent}% occupied · {floorTables.length} tables
                monitored
              </span>
            </div>
          </div>
          <div className="md-floor-controls">
            <input
              value={tableQuery}
              onChange={(event) => setTableQuery(event.target.value)}
              placeholder="Search table or waiter"
            />
            <select
              value={tableFilter}
              onChange={(event) => setTableFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="available">Available</option>
              <option value="occupied">Occupied</option>
              <option value="cashier">Payment Due</option>
              <option value="attention">Needs Attention</option>
              <option value="cleaning">Cleaning</option>
            </select>
          </div>
          <div className="md-table-grid">
            {visibleTables.map((table) => (
              <button
                className={`md-table md-table-${tableVisualStatus(table)}`}
                key={table.id}
                type="button"
                onClick={() => setSelectedTableId(table.id)}
              >
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
                    <small>Guests</small>
                    <b>{table.seats ?? "—"}</b>
                  </div>
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
                  <em>
                    {table.alerts.length
                      ? `Priority · ${table.alerts[0].minutes}m`
                      : "Normal priority"}
                  </em>
                </div>
                {table.alerts.length > 0 && <p>{table.alerts[0].label}</p>}
              </button>
            ))}
            {filteredTables.length === 0 && (
              <p className="md-empty">
                No matching tables. Clear filters or check table setup.
              </p>
            )}
          </div>
          {visibleTableCount < filteredTables.length && (
            <button
              className="md-load-more"
              type="button"
              onClick={() => setVisibleTableCount((count) => count + 8)}
            >
              Show more tables
            </button>
          )}
        </article>

        <aside className="md-side">
          <article className="md-panel md-alert-panel">
            <div className="md-panel-title">
              <span>◫</span>
              <strong>Kitchen Status</strong>
            </div>
            <div className="md-alert-list">
              <p>{snapshot?.kpis.kitchenWaiting ?? 0} tickets waiting</p>
              <p>{snapshot?.kpis.kitchenPreparing ?? 0} tickets preparing</p>
              <p>{kitchenDelays} delayed tables</p>
            </div>
            <a className="md-panel-link" href="/manager/kitchen">
              Open kitchen
            </a>
          </article>

          <article className="md-panel">
            <div className="md-panel-title">
              <strong>Staff Status</strong>
              <a href="/manager/staff">Manage</a>
            </div>
            <div className="md-activity-list">
              <p>
                <span />
                {snapshot?.kpis.staffOnDuty ?? 0} staff currently on shift
                <small>Live coverage</small>
              </p>
              <p>
                <span />
                {waitingTables} tables need waiter attention
                <small>Floor workload</small>
              </p>
              {activityItems.slice(0, 2).map((item, index) => (
                <p key={`${item}-${index}`}>
                  <span />
                  {item}
                  <small>Recent activity</small>
                </p>
              ))}
            </div>
          </article>

          <article className="md-panel md-revenue-panel">
            <div className="md-panel-title">
              <strong>Revenue Snapshot</strong>
            </div>
            <dl>
              <div>
                <dt>Cash</dt>
                <dd>
                  {formatCurrency(liveMetrics?.cashCollected ?? 0, currency)}
                </dd>
              </div>
              <div>
                <dt>Digital</dt>
                <dd>{formatCurrency(digitalRevenue, currency)}</dd>
              </div>
              <div>
                <dt>Total today</dt>
                <dd>{formatCurrency(revenueToday, currency)}</dd>
              </div>
              <div>
                <dt>Average bill</dt>
                <dd>
                  {formatCurrency(liveMetrics?.averageOrder ?? 0, currency)}
                </dd>
              </div>
            </dl>
          </article>
        </aside>
      </section>

      <section className="manager-quick-actions" aria-label="Quick actions">
        <div>
          <strong>Quick Actions</strong>
          <span>Move directly to the operational workspace you need</span>
        </div>
        <div className="manager-action-row">
          <a href="/manager/tables">Manage floor</a>
          <a href="/manager/staff">Assign staff</a>
          <button type="button" onClick={() => void loadSnapshot()}>
            Refresh
          </button>
        </div>
      </section>

      <section className="md-copilot md-ai-panel">
        <div>
          <span>AI Operations Copilot</span>
          <h2>{suggestedAction}</h2>
          <p>
            {kitchenLoad} active kitchen tickets · {notifications.length} live
            alerts
          </p>
        </div>
        <a href="/manager/ai">Open Operations Copilot</a>
      </section>

      {selectedTable && (
        <div
          className="md-detail-layer"
          role="presentation"
          onClick={() => setSelectedTableId(null)}
        >
          <aside
            className="md-detail"
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedTable.label} details`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="md-detail-header">
              <div>
                <span>{tableStatusLabel(selectedTable)}</span>
                <h2>{selectedTable.label}</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTableId(null)}
                aria-label="Close table details"
              >
                Close
              </button>
            </div>
            <div className="md-detail-grid">
              <div>
                <span>Assigned waiter</span>
                <strong>
                  {selectedTable.assignedWaiterName || "Unassigned"}
                </strong>
              </div>
              <div>
                <span>Running bill</span>
                <strong>
                  {formatCurrency(selectedTable.runningBill, currency)}
                </strong>
              </div>
              <div>
                <span>Session duration</span>
                <strong>
                  {formatDuration(selectedTable.sessionDurationMinutes)}
                </strong>
              </div>
              <div>
                <span>Kitchen status</span>
                <strong>{statusText(selectedTable.kitchenStatus)}</strong>
              </div>
              <div>
                <span>Cashier status</span>
                <strong>{statusText(selectedTable.cashierStatus)}</strong>
              </div>
              <div>
                <span>Items ready</span>
                <strong>
                  {selectedTable.readyItemCount} / {selectedTable.itemCount}
                </strong>
              </div>
            </div>
            <section className="md-detail-section">
              <h3>Alerts</h3>
              {selectedTable.alerts.length > 0 ? (
                <div className="md-detail-alerts">
                  {selectedTable.alerts.map((alert) => (
                    <p key={alert.type}>
                      {alert.label}: {alert.minutes}m
                    </p>
                  ))}
                </div>
              ) : (
                <p>No active table alerts.</p>
              )}
            </section>
            <section className="md-detail-section">
              <h3>Session</h3>
              <p>
                {selectedTable.customerName || "No customer name"} ·{" "}
                {selectedTable.invoiceCount} bill batch
                {selectedTable.invoiceCount === 1 ? "" : "es"} ·{" "}
                {selectedTable.activeOrderSource
                  ? statusText(selectedTable.activeOrderSource)
                  : "No active source"}
              </p>
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}

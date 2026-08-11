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
  if (visualStatus === "cleaning") return "Inactive";
  return "Available";
}

function buildActivityItems(tables: ManagerFloorTable[]) {
  return tables
    .filter(
      (table) =>
        table.activeOrderId || table.runningBill > 0 || table.alerts.length > 0,
    )
    .sort(
      (left, right) =>
        (right.sessionDurationMinutes ?? 0) -
        (left.sessionDurationMinutes ?? 0),
    )
    .slice(0, 8)
    .map((table) => {
      if (table.alerts[0]) {
        return {
          id: `${table.id}-${table.alerts[0].type}`,
          text: `${table.label}: ${table.alerts[0].label}`,
          meta: `${table.alerts[0].minutes}m active`,
        };
      }
      if (table.status === "waiting_payment") {
        return {
          id: `${table.id}-payment`,
          text: `${table.label} requested payment`,
          meta: "Cashier review",
        };
      }
      if (table.readyItemCount > 0) {
        return {
          id: `${table.id}-ready`,
          text: `${table.readyItemCount} item${table.readyItemCount === 1 ? "" : "s"} ready for ${table.label}`,
          meta: "Kitchen ready",
        };
      }
      return {
        id: `${table.id}-active`,
        text: `${table.label} is in active service`,
        meta: table.assignedWaiterName
          ? `Waiter ${table.assignedWaiterName}`
          : "Unassigned",
      };
    });
}

export function ManagerDashboardPage({
  restaurantId,
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
  const [visibleTableCount, setVisibleTableCount] = useState(12);

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

  useTenantRealtime({
    channelName: "manager-dashboard",
    restaurantId,
    tables: [
      "orders",
      "order_items",
      "order_invoices",
      "restaurant_tables",
      "restaurant_table_waiter_assignments",
      "restaurant_staff",
      "cashier_shifts",
    ],
    refresh: loadSnapshot,
  });

  const floorTables = snapshot?.floorTables ?? [];
  const liveMetrics = snapshot?.liveMetrics;
  const filteredTables = floorTables.filter((table) => {
    const query = tableQuery.trim().toLowerCase();
    const matchesQuery =
      !query ||
      table.label.toLowerCase().includes(query) ||
      (table.assignedWaiterName || "").toLowerCase().includes(query);
    const visual = tableVisualStatus(table);
    return matchesQuery && (tableFilter === "all" || visual === tableFilter);
  });
  const visibleTables = filteredTables.slice(0, visibleTableCount);
  const activeServiceLocations = floorTables.filter((table) => table.active);
  const occupiedPercent = activeServiceLocations.length
    ? Math.round(
        ((snapshot?.kpis.occupiedTables ?? 0) / activeServiceLocations.length) *
          100,
      )
    : 0;
  const selectedTable =
    floorTables.find((table) => table.id === selectedTableId) ?? null;
  const activityItems = useMemo(
    () => buildActivityItems(floorTables),
    [floorTables],
  );
  const kitchenLoad =
    (snapshot?.kpis.kitchenWaiting ?? 0) +
    (snapshot?.kpis.kitchenPreparing ?? 0);
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
  const longestKitchenAlert = floorTables.reduce((longest, table) => {
    const tableLongest = table.alerts
      .filter((alert) => alert.type === "kitchen_delay")
      .reduce((maximum, alert) => Math.max(maximum, alert.minutes), 0);
    return Math.max(longest, tableLongest);
  }, 0);

  const overviewCards = [
    {
      label: "Sales Today",
      value: formatCurrency(liveMetrics?.revenueToday ?? 0, currency),
      tone: "green",
      status: `${liveMetrics?.ordersToday ?? 0} orders today`,
    },
    {
      label: "Active Orders",
      value: liveMetrics?.ordersPending ?? 0,
      tone: "blue",
      status: `${liveMetrics?.ordersPreparing ?? 0} preparing`,
    },
    {
      label: "Payment Due",
      value: formatCurrency(liveMetrics?.paymentDueAmount ?? 0, currency),
      tone: pendingPayments > 0 ? "amber" : "slate",
      status: `${pendingPayments} awaiting payment`,
    },
    {
      label: "Occupied Service Locations",
      value: `${snapshot?.kpis.occupiedTables ?? 0}/${activeServiceLocations.length}`,
      tone: "green",
      status: `${occupiedPercent}% occupied`,
    },
    {
      label: "Kitchen Load",
      value: kitchenLoad,
      tone: kitchenDelays > 0 ? "red" : "amber",
      status: `${kitchenDelays} delayed`,
    },
    {
      label: "Staff on Shift",
      value: snapshot?.kpis.staffOnDuty ?? 0,
      tone: "blue",
      status: `${waitingTables} need coverage`,
    },
  ];

  const attentionItems = floorTables
    .flatMap((table) => {
      const alertRows = table.alerts.map((alert) => ({
        id: `${table.id}-${alert.type}`,
        priority:
          alert.type === "kitchen_delay" || alert.type === "long_session"
            ? "critical"
            : "warning",
        issue: alert.label,
        location: table.label,
        detail: table.assignedWaiterName
          ? `Waiter ${table.assignedWaiterName}`
          : "Unassigned",
        age: `${alert.minutes}m`,
        href:
          alert.type === "kitchen_delay" || alert.type === "waiting_pickup"
            ? "/manager/kitchen"
            : "/manager/tables",
      }));
      if (
        table.status === "waiting_payment" &&
        !table.alerts.some((alert) => alert.type === "waiting_payment")
      ) {
        alertRows.push({
          id: `${table.id}-payment`,
          priority: "warning",
          issue: "Payment due",
          location: table.label,
          detail: formatCurrency(table.runningBill, currency),
          age: "Now",
          href: "/manager/tables",
        });
      }
      if (
        table.activeOrderId &&
        !table.assignedWaiterName &&
        !table.alerts.some((alert) => alert.type === "waiting")
      ) {
        alertRows.push({
          id: `${table.id}-coverage`,
          priority: "warning",
          issue: "Waiter coverage needed",
          location: table.label,
          detail: "Unassigned active service",
          age: "Now",
          href: "/manager/staff",
        });
      }
      return alertRows;
    })
    .sort((left, right) => {
      if (left.priority !== right.priority)
        return left.priority === "critical" ? -1 : 1;
      return Number.parseInt(right.age, 10) - Number.parseInt(left.age, 10);
    })
    .slice(0, 8);

  return (
    <main className="md-overview">
      {status === "error" && <p className="md-overview-error">{error}</p>}

      <section className="md-pulse" aria-labelledby="shift-pulse-title">
        <div className="md-block-heading">
          <div>
            <span>Live operations</span>
            <h2 id="shift-pulse-title">Shift Pulse</h2>
          </div>
          <small aria-live="polite">
            {status === "loading" ? "Syncing..." : "Realtime"}
          </small>
        </div>
        <div className="md-kpis" aria-label="Six live shift metrics">
          {overviewCards.map((kpi) => (
            <article className={`md-kpi md-kpi-${kpi.tone}`} key={kpi.label}>
              <span>{kpi.label}</span>
              <strong>{kpi.value}</strong>
              <small>{kpi.status}</small>
            </article>
          ))}
        </div>
      </section>

      <section
        className="md-attention"
        id="notifications"
        aria-labelledby="attention-title"
      >
        <div className="md-block-heading">
          <div>
            <span>Prioritized queue</span>
            <h2 id="attention-title">Needs Attention</h2>
          </div>
          <small>{attentionItems.length} active</small>
        </div>
        {attentionItems.length > 0 ? (
          <div className="md-attention-list">
            <div className="md-attention-head" aria-hidden="true">
              <span>Priority / Issue</span>
              <span>Service Location</span>
              <span>Context</span>
              <span>Waiting</span>
              <span>Action</span>
            </div>
            {attentionItems.map((item) => (
              <div className="md-attention-row" key={item.id}>
                <div>
                  <i className={`is-${item.priority}`} aria-hidden="true" />
                  <strong>{item.issue}</strong>
                </div>
                <span>{item.location}</span>
                <span>{item.detail}</span>
                <time>{item.age}</time>
                <a href={item.href}>Review</a>
              </div>
            ))}
          </div>
        ) : (
          <div className="md-attention-clear">
            <span aria-hidden="true">✓</span>
            <div>
              <strong>No active operational issues</strong>
              <p>New service, kitchen, or payment alerts will appear here.</p>
            </div>
          </div>
        )}
      </section>

      <section className="md-main-grid" aria-label="Live restaurant operations">
        <article className="md-floor">
          <div className="md-section-heading">
            <div>
              <h2>Live Service Locations</h2>
              <span>
                {occupiedPercent}% occupied · {activeServiceLocations.length}{" "}
                active locations
              </span>
            </div>
          </div>
          <div className="md-floor-controls">
            <label>
              <span className="sr-only">Search service locations</span>
              <input
                value={tableQuery}
                onChange={(event) => setTableQuery(event.target.value)}
                placeholder="Search location or waiter"
              />
            </label>
            <label>
              <span className="sr-only">Filter service locations</span>
              <select
                value={tableFilter}
                onChange={(event) => setTableFilter(event.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="available">Available</option>
                <option value="occupied">Occupied</option>
                <option value="cashier">Payment Due</option>
                <option value="attention">Needs Attention</option>
                <option value="cleaning">Inactive</option>
              </select>
            </label>
          </div>
          <div className="md-table-grid">
            {visibleTables.map((table) => {
              const visualStatus = tableVisualStatus(table);
              const isAvailable = visualStatus === "available";
              return (
                <button
                  className={`md-table md-table-${visualStatus}`}
                  key={table.id}
                  type="button"
                  onClick={() => setSelectedTableId(table.id)}
                  aria-label={`Open ${table.label} details, ${tableVisualLabel(table)}`}
                >
                  <div className="md-table-topline">
                    <strong>{table.label}</strong>
                    <span>{tableVisualLabel(table)}</span>
                  </div>
                  {!isAvailable && visualStatus !== "cleaning" && (
                    <>
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
                      {table.alerts[0] && (
                        <p>
                          {table.alerts[0].label} · {table.alerts[0].minutes}m
                        </p>
                      )}
                    </>
                  )}
                </button>
              );
            })}
            {filteredTables.length === 0 && (
              <p className="md-empty">
                No matching service locations. Clear the filters to see the
                floor.
              </p>
            )}
          </div>
          {visibleTableCount < filteredTables.length && (
            <button
              className="md-load-more"
              type="button"
              onClick={() => setVisibleTableCount((count) => count + 12)}
            >
              Show more service locations
            </button>
          )}
        </article>

        <aside className="md-side" aria-label="Operational health">
          <article className="md-panel">
            <div className="md-panel-title">
              <strong>Kitchen</strong>
              <a href="/manager/kitchen">Open</a>
            </div>
            <dl className="md-health-stats">
              <div>
                <dt>Waiting</dt>
                <dd>{snapshot?.kpis.kitchenWaiting ?? 0}</dd>
              </div>
              <div>
                <dt>Preparing</dt>
                <dd>{snapshot?.kpis.kitchenPreparing ?? 0}</dd>
              </div>
              <div>
                <dt>Ready</dt>
                <dd>{liveMetrics?.ordersReady ?? 0}</dd>
              </div>
              <div>
                <dt>Delayed</dt>
                <dd className={kitchenDelays ? "is-risk" : ""}>
                  {kitchenDelays}
                </dd>
              </div>
              <div className="is-wide">
                <dt>Longest active delay</dt>
                <dd>
                  {longestKitchenAlert ? `${longestKitchenAlert}m` : "None"}
                </dd>
              </div>
            </dl>
          </article>

          <article className="md-panel">
            <div className="md-panel-title">
              <strong>Staff / Shift</strong>
              <a href="/manager/staff">Manage</a>
            </div>
            <dl className="md-health-stats">
              <div>
                <dt>On shift</dt>
                <dd>{snapshot?.kpis.staffOnDuty ?? 0}</dd>
              </div>
              <div>
                <dt>Uncovered</dt>
                <dd className={waitingTables ? "is-risk" : ""}>
                  {waitingTables}
                </dd>
              </div>
              <div className="is-wide">
                <dt>Current shift</dt>
                <dd>{snapshot?.restaurant.currentShift ?? "Current Shift"}</dd>
              </div>
            </dl>
          </article>

          <article className="md-panel">
            <div className="md-panel-title">
              <strong>Payments / Collections</strong>
              <a href="/manager/tables">Review</a>
            </div>
            <dl className="md-health-stats md-health-money">
              <div className="is-wide">
                <dt>Total today</dt>
                <dd>
                  {formatCurrency(liveMetrics?.revenueToday ?? 0, currency)}
                </dd>
              </div>
              <div>
                <dt>Cash</dt>
                <dd>
                  {formatCurrency(liveMetrics?.cashCollected ?? 0, currency)}
                </dd>
              </div>
              <div>
                <dt>Digital</dt>
                <dd>
                  {formatCurrency(liveMetrics?.digitalCollected ?? 0, currency)}
                </dd>
              </div>
              <div className="is-wide">
                <dt>Outstanding</dt>
                <dd className={pendingPayments ? "is-risk" : ""}>
                  {formatCurrency(liveMetrics?.paymentDueAmount ?? 0, currency)}
                </dd>
              </div>
              <div className="is-wide">
                <dt>Pending verification</dt>
                <dd>{pendingPayments}</dd>
              </div>
            </dl>
          </article>
        </aside>
      </section>

      <section className="md-recent" aria-labelledby="recent-activity-title">
        <div className="md-block-heading">
          <div>
            <span>Live floor signals</span>
            <h2 id="recent-activity-title">Recent Activity</h2>
          </div>
        </div>
        {activityItems.length > 0 ? (
          <div className="md-recent-list">
            {activityItems.map((item) => (
              <div key={item.id}>
                <i aria-hidden="true" />
                <strong>{item.text}</strong>
                <span>{item.meta}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="md-recent-empty">
            No active service activity right now.
          </p>
        )}
      </section>

      <a
        className="md-ai-entry"
        href="/manager/ai"
        aria-label="Open ServeFlow AI assistant"
      >
        <span aria-hidden="true">AI</span>
        Ask ServeFlow
      </a>

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
                aria-label="Close service location details"
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
                <p>No active service location alerts.</p>
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

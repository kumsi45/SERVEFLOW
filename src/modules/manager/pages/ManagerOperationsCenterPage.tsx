import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../core/database";
import { formatCurrency, type CurrencyConfig } from "../../../core/format/currency";
import { fetchManagerDashboardSnapshot } from "../services/managerDashboardService";
import { assignWaiterTables, loadManagerStaffOperations, type ManagerStaffMember, type ManagerStaffOperationsSnapshot } from "../services/managerStaffOperationsService";
import type { ManagerDashboardSnapshot, ManagerFloorTable } from "../types";
import "../styles/managerOperationsCenter.css";

type Props = {
  restaurantId: string;
  currency?: CurrencyConfig;
};

function duration(minutes: number | null) {
  if (minutes == null) return "-";
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function tableStatus(table: ManagerFloorTable) {
  if (!table.active) return "Cleaning";
  if (table.cashierStatus === "waiting_payment" || table.status === "waiting_payment") return "Waiting Payment";
  if (table.status === "kitchen_delay" || table.alerts.length > 0) return "Needs Attention";
  if (table.status === "occupied" || table.activeOrderId) return "Occupied";
  return "Available";
}

export function ManagerOperationsCenterPage({ restaurantId, currency }: Props) {
  const [dashboard, setDashboard] = useState<ManagerDashboardSnapshot | null>(null);
  const [staffOps, setStaffOps] = useState<ManagerStaffOperationsSnapshot | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextDashboard, nextStaffOps] = await Promise.all([
        fetchManagerDashboardSnapshot(restaurantId),
        loadManagerStaffOperations(restaurantId),
      ]);
      setDashboard(nextDashboard);
      setStaffOps(nextStaffOps);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Operations Center unavailable.");
    }
  }, [restaurantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const channel = supabase
      .channel(`manager-operations-center:${restaurantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "order_invoices", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_tables", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_table_waiter_assignments", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_staff", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh, restaurantId]);

  const tables = dashboard?.floorTables ?? [];
  const waiters = useMemo(() => (staffOps?.staff ?? []).filter((member): member is ManagerStaffMember => member.role === "waiter" && member.active), [staffOps]);
  const selectedTable = tables.find((table) => table.id === selectedTableId) ?? tables[0] ?? null;
  const openOrders = tables.filter((table) => table.activeOrderId).length;
  const paymentQueue = tables.filter((table) => table.cashierStatus === "waiting_payment" || table.status === "waiting_payment").length;
  const kitchenDelays = tables.filter((table) => table.status === "kitchen_delay" || table.alerts.some((alert) => alert.type === "kitchen_delay")).length;
  const currentRevenue = tables.reduce((sum, table) => sum + table.runningBill, 0);
  const staffOnline = (staffOps?.staff ?? []).filter((member) => member.online).length;
  const complaints = dashboard?.notifications.filter((item) => item.toLowerCase().includes("complaint")).length ?? 0;
  const vipGuests = tables.filter((table) => (table.customerName || "").toLowerCase().includes("vip")).length;
  const unassignedTables = tables.filter((table) => table.activeOrderId && !table.assignedWaiterName).length;
  const staffMissing = (staffOps?.staff ?? []).filter((member) => member.active && !member.online).length;
  const taskItems = [
    { label: "Kitchen Delays", value: kitchenDelays, tone: kitchenDelays > 0 ? "critical" : "ok" },
    { label: "Pending Payments", value: paymentQueue, tone: paymentQueue > 0 ? "warning" : "ok" },
    { label: "Complaints", value: complaints, tone: complaints > 0 ? "critical" : "ok" },
    { label: "VIP Guests", value: vipGuests, tone: vipGuests > 0 ? "warning" : "ok" },
    { label: "Reservations", value: 0, tone: "ok" },
    { label: "Staff Missing", value: staffMissing, tone: staffMissing > 0 ? "warning" : "ok" },
    { label: "Tables Waiting", value: unassignedTables, tone: unassignedTables > 0 ? "warning" : "ok" },
    { label: "Shift Issues", value: dashboard?.notifications.some((item) => item.toLowerCase().includes("shift")) ? 1 : 0, tone: "warning" },
    { label: "Inventory Alerts", value: 0, tone: "ok" },
    { label: "System Alerts", value: dashboard?.notifications.length ?? 0, tone: (dashboard?.notifications.length ?? 0) > 0 ? "warning" : "ok" },
  ];

  async function assignWaiter(tableId: string, waiterId: string) {
    try {
      setNotice(null);
      setError(null);
      const waiter = waiters.find((member) => member.id === waiterId);
      const existingTableIds = waiter?.assignedTables.map((table) => table.id) ?? [];
      await assignWaiterTables(restaurantId, waiterId, Array.from(new Set([...existingTableIds, tableId])));
      setNotice("Waiter assignment updated.");
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not assign waiter.");
    }
  }

  return (
    <main className="moc-page">
      {(notice || error) && <div className={`moc-message ${error ? "error" : ""}`}>{error || notice}</div>}

      <section className="moc-kpis" aria-label="Operations Center summary">
        <article><span>Current Shift</span><strong>Active</strong></article>
        <article><span>Open Orders</span><strong>{openOrders}</strong></article>
        <article><span>Waiting Payment</span><strong>{paymentQueue}</strong></article>
        <article><span>Kitchen Delays</span><strong>{kitchenDelays}</strong></article>
        <article><span>Staff Online</span><strong>{staffOnline}</strong></article>
        <article><span>Current Revenue</span><strong>{formatCurrency(currentRevenue, currency)}</strong></article>
      </section>

      <section className="moc-task-board" aria-label="Attention queue">
        {taskItems.map((item) => (
          <article className={`moc-task ${item.tone}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </article>
        ))}
      </section>

      <section className="moc-grid">
        <article className="moc-card moc-floor">
          <div className="moc-card-head">
            <div><span>Dining Room</span><h2>Table Command Center</h2></div>
            <strong>{tables.length} tables</strong>
          </div>
          <div className="moc-table-list">
            {tables.map((table) => (
              <button key={table.id} type="button" className={selectedTable?.id === table.id ? "selected" : ""} onClick={() => setSelectedTableId(table.id)}>
                <strong>{table.label}</strong>
                <span>{tableStatus(table)}</span>
                <small>{table.assignedWaiterName || "No waiter"} · {formatCurrency(table.runningBill, currency)} · {duration(table.sessionDurationMinutes)}</small>
              </button>
            ))}
            {tables.length === 0 && <p className="moc-empty">No active tables. Seat guests or verify table setup.</p>}
          </div>
        </article>

        <article className="moc-card moc-assignment">
          <div className="moc-card-head">
            <div><span>Table Assignment</span><h2>{selectedTable?.label ?? "Select a table"}</h2></div>
          </div>
          {selectedTable ? (
            <>
              <dl>
                <div><dt>Status</dt><dd>{tableStatus(selectedTable)}</dd></div>
                <div><dt>Order</dt><dd>{selectedTable.activeOrderStatus ?? "No open order"}</dd></div>
                <div><dt>Guests</dt><dd>{selectedTable.seats ?? "-"}</dd></div>
                <div><dt>Payment</dt><dd>{selectedTable.cashierStatus.replace(/_/g, " ")}</dd></div>
                <div><dt>Current bill</dt><dd>{formatCurrency(selectedTable.runningBill, currency)}</dd></div>
                <div><dt>Duration</dt><dd>{duration(selectedTable.sessionDurationMinutes)}</dd></div>
              </dl>
              <label>
                Assign waiter
                <select defaultValue="" onChange={(event) => {
                  const waiterId = event.target.value;
                  if (!waiterId) return;
                  void assignWaiter(selectedTable.id, waiterId);
                  event.currentTarget.value = "";
                }}>
                  <option value="">Choose waiter</option>
                  {waiters.map((waiter) => <option key={waiter.id} value={waiter.id}>{waiter.fullName}</option>)}
                </select>
              </label>
            </>
          ) : <p className="moc-empty">Select a table to manage waiter assignment.</p>}
        </article>

        <article className="moc-card">
          <div className="moc-card-head"><div><span>Payment Queue</span><h2>Cashier Status</h2></div></div>
          <div className="moc-queue">
            {tables.filter((table) => table.cashierStatus === "waiting_payment" || table.cashierStatus === "billing").map((table) => (
              <p key={table.id}><strong>{table.label}</strong><span>{formatCurrency(table.runningBill, currency)}</span></p>
            ))}
            {paymentQueue === 0 && <p className="moc-empty">No tables waiting for payment.</p>}
          </div>
        </article>

        <article className="moc-card">
          <div className="moc-card-head"><div><span>Live Timeline</span><h2>Recent Operations</h2></div></div>
          <div className="moc-timeline">
            {(dashboard?.notifications ?? []).map((item) => <p key={item}><span />{item}</p>)}
            {(dashboard?.notifications.length ?? 0) === 0 && <p className="moc-empty">No incidents or operational alerts right now.</p>}
          </div>
        </article>
      </section>
    </main>
  );
}

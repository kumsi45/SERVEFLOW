import { useCallback, useEffect, useMemo, useState } from "react";
import { useTenantRealtime } from "../../../core/realtime/useTenantRealtime";
import { formatCurrency, type CurrencyConfig } from "../../../core/format/currency";
import {
  fetchManagerDashboardSnapshot,
  releaseManagerDiningSession,
} from "../services/managerDashboardService";
import { assignWaiterTables, loadManagerStaffOperations, type ManagerStaffMember, type ManagerStaffOperationsSnapshot } from "../services/managerStaffOperationsService";
import type { ManagerDashboardSnapshot, ManagerFloorTable } from "../types";
import { loadInventoryItems,loadInventoryRequests,type InventoryItem,type InventoryRequest } from "../../kitchen/services/inventoryRequestService";
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
  if (table.cashierStatus === "waiting_payment" || table.status === "waiting_payment") return "Payment Due";
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
  const [releasingOrderId, setReleasingOrderId] = useState<string | null>(null);
  const [inventoryRequests,setInventoryRequests]=useState<InventoryRequest[]>([]);
  const [inventoryItems,setInventoryItems]=useState<InventoryItem[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [nextDashboard, nextStaffOps, nextInventoryRequests, nextInventoryItems] = await Promise.all([
        fetchManagerDashboardSnapshot(restaurantId),
        loadManagerStaffOperations(restaurantId),
        loadInventoryRequests(restaurantId),
        loadInventoryItems(restaurantId),
      ]);
      setDashboard(nextDashboard);
      setStaffOps(nextStaffOps);
      setInventoryRequests(nextInventoryRequests);setInventoryItems(nextInventoryItems);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Operations Center unavailable.");
    }
  }, [restaurantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useTenantRealtime({ channelName: "manager-operations-center", restaurantId, tables: ["orders", "order_items", "order_invoices", "restaurant_tables", "restaurant_table_waiter_assignments", "restaurant_staff", "kitchen_inventory_requests", "inventory_items"], refresh });

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
  const pendingInventory=inventoryRequests.filter(request=>request.status==="pending");
  const delayedInventory=inventoryRequests.filter(request=>(request.status==="pending"||request.status==="accepted")&&Date.now()-new Date(request.requestedAt).getTime()>30*60_000);
  const criticalStock=inventoryItems.filter(item=>item.currentQuantity<=item.reorderLevel);
  const taskItems = [
    { label: "Kitchen Delays", value: kitchenDelays, tone: kitchenDelays > 0 ? "critical" : "ok" },
    { label: "Pending Payments", value: paymentQueue, tone: paymentQueue > 0 ? "warning" : "ok" },
    { label: "Complaints", value: complaints, tone: complaints > 0 ? "critical" : "ok" },
    { label: "VIP Guests", value: vipGuests, tone: vipGuests > 0 ? "warning" : "ok" },
    { label: "Reservations", value: 0, tone: "ok" },
    { label: "Staff Missing", value: staffMissing, tone: staffMissing > 0 ? "warning" : "ok" },
    { label: "Tables Waiting", value: unassignedTables, tone: unassignedTables > 0 ? "warning" : "ok" },
    { label: "Shift Issues", value: dashboard?.notifications.some((item) => item.toLowerCase().includes("shift")) ? 1 : 0, tone: "warning" },
    { label: "Inventory Alerts", value: pendingInventory.length+criticalStock.length, tone: pendingInventory.length+criticalStock.length>0?"warning":"ok" },
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

  async function releaseTable(orderId: string, tableLabel: string) {
    if (!window.confirm(`Release ${tableLabel}? Confirm payment is complete and the customer has left.`)) return;
    try {
      setReleasingOrderId(orderId);
      setNotice(null);
      setError(null);
      await releaseManagerDiningSession(orderId);
      setNotice(`${tableLabel} released successfully.`);
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not release table.");
    } finally {
      setReleasingOrderId(null);
    }
  }

  return (
    <main className="moc-page">
      <header className="manager-module-header"><div><span>Attention center</span><h1>Operations</h1></div><p>Live floor, service, kitchen, and payment exceptions</p></header>
      <section className="manager-quick-actions"><div><strong>Action queue</strong><span>Prioritized from live restaurant activity</span></div><div className="manager-action-row"><button type="button" onClick={() => void refresh()}>Refresh</button></div></section>
      {(notice || error) && <div className={`moc-message ${error ? "error" : ""}`}>{error || notice}</div>}

      <section className="moc-kpis" aria-label="Operations Center summary">
        <article><span>Current Shift</span><strong>Active</strong></article>
        <article><span>Open Orders</span><strong>{openOrders}</strong></article>
        <article><span>Payment Due</span><strong>{paymentQueue}</strong></article>
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
        <article className="moc-card moc-inventory-alerts"><div className="moc-card-head"><div><span>Inventory Workflow</span><h2>Requests & Critical Stock</h2></div><strong>{pendingInventory.length} pending</strong></div><div className="moc-queue">{pendingInventory.slice(0,5).map(request=><p key={request.id}><strong>{request.itemName} · {request.quantity} {request.unit}</strong><span>{request.urgency} · {request.stationName??"Kitchen"}</span></p>)}{criticalStock.slice(0,5).map(item=><p key={item.id}><strong>{item.name}</strong><span>Critical: {item.currentQuantity} {item.unit}</span></p>)}{pendingInventory.length===0&&criticalStock.length===0&&<p className="moc-empty">No inventory alerts.</p>}{delayedInventory.length>0&&<p><strong>{delayedInventory.length} delayed request(s)</strong><span>Waiting more than 30 minutes</span></p>}</div></article>
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
              {selectedTable.activeOrderId &&
                selectedTable.cashierStatus === "paid" &&
                selectedTable.kitchenStatus === "completed" && (
                  <button
                    type="button"
                    onClick={() =>
                      void releaseTable(
                        selectedTable.activeOrderId!,
                        selectedTable.label,
                      )
                    }
                    disabled={releasingOrderId === selectedTable.activeOrderId}
                  >
                    {releasingOrderId === selectedTable.activeOrderId
                      ? "Releasing..."
                      : "Release Table"}
                  </button>
                )}
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

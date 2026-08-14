import { useCallback, useEffect, useMemo, useState } from "react";
import { useTenantRealtime } from "../../../core/realtime/useTenantRealtime";
import { formatCurrency, type CurrencyConfig } from "../../../core/format/currency";
import { fetchManagerDashboardSnapshot, releaseManagerDiningSession } from "../services/managerDashboardService";
import { assignWaiterTables, loadManagerStaffOperations, type ManagerStaffMember, type ManagerStaffOperationsSnapshot } from "../services/managerStaffOperationsService";
import type { ManagerDashboardSnapshot, ManagerFloorTable } from "../types";
import { loadInventoryRequests, type InventoryRequest } from "../../kitchen/services/inventoryRequestService";
import { loadManagerCashierOperations, reviewManagerCashierExpense, type ManagerCashierExpense, type ManagerCashierOperationsSnapshot } from "../services/managerCashierOperationsService";
import "../styles/managerOperationsCenter.css";

type Props = { restaurantId: string; currency?: CurrencyConfig };
type ActionFilter = "all" | "urgent" | "approvals" | "service";
type LocationFilter = "all" | "active" | "free" | "attention";
type ActionPriority = "critical" | "attention" | "normal";
type ManagerAction = { id: string; title: string; detail: string; age: string; priority: ActionPriority; category: "approvals" | "service"; tableId?: string; destination?: string };
type RecentOperation = { id: string; at: string; label: string };
type OperationsView = "service" | "cashier";

function elapsed(minutes: number | null) {
  if (minutes == null) return "";
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function minutesSince(value: string) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 0;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function locationState(table: ManagerFloorTable) {
  if (!table.activeOrderId) return "free" as const;
  if (table.cashierStatus === "waiting_payment" || table.status === "waiting_payment") return "payment-due" as const;
  if (table.alerts.length > 0) return "attention" as const;
  if (table.kitchenStatus === "ready") return "ready" as const;
  if (table.kitchenStatus === "preparing" || table.kitchenStatus === "waiting") return "preparing" as const;
  return "active" as const;
}

function stateLabel(table: ManagerFloorTable) {
  const state = locationState(table);
  if (state === "payment-due") return "Payment due";
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function paymentStatusLabel(table: ManagerFloorTable) {
  if (table.cashierStatus === "waiting_payment") return "Payment due";
  if (table.cashierStatus === "billing") return "Billing in progress";
  if (table.cashierStatus === "paid") return "Paid";
  return "Open";
}

function actionPriority(minutes: number, urgent = false): ActionPriority {
  if (urgent || minutes >= 30) return "critical";
  if (minutes >= 15) return "attention";
  return "normal";
}

function navigateTo(href: string, restaurantId: string) {
  if (href.startsWith("/inventory/")) window.sessionStorage.setItem("serveflow.active-restaurant:inventory", restaurantId);
  window.history.pushState({}, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function buildManagerActions(tables: ManagerFloorTable[], inventoryRequests: InventoryRequest[]): ManagerAction[] {
  const inventoryActions = inventoryRequests.filter((request) => request.status === "pending").map((request) => {
    const minutes = minutesSince(request.requestedAt);
    const context = [request.stationName || "Kitchen", request.requesterName, `${request.quantity} ${request.unit}`].filter(Boolean).join(" · ");
    return { id: `inventory-${request.id}`, title: "Kitchen Material Request", detail: `${request.itemName} · ${context}`, age: elapsed(minutes), priority: actionPriority(minutes, request.urgency === "critical"), category: "approvals" as const, destination: "/inventory/dashboard" };
  });
  const serviceActions = tables.flatMap<ManagerAction>((table) => {
    if (!table.activeOrderId) return [];
    const alert = table.alerts[0];
    if (alert) {
      const title = alert.type === "waiting_payment" ? "Payment Exception" : alert.type === "kitchen_delay" ? "Service Delay" : alert.type === "waiting_pickup" ? "Ready Order Waiting" : alert.type === "long_session" ? "Long Service Session" : "Service Waiting";
      return [{ id: `service-${table.id}`, title, detail: [table.label, table.assignedWaiterName, stateLabel(table)].filter(Boolean).join(" · "), age: elapsed(alert.minutes), priority: actionPriority(alert.minutes, alert.type === "kitchen_delay"), category: "service", tableId: table.id }];
    }
    if (!table.assignedWaiterName) return [{ id: `coverage-${table.id}`, title: "Staff Coverage", detail: `${table.label} · Active service has no assigned staff`, age: elapsed(table.sessionDurationMinutes), priority: "normal", category: "service", tableId: table.id }];
    return [];
  });
  const rank: Record<ActionPriority, number> = { critical: 0, attention: 1, normal: 2 };
  return [...inventoryActions, ...serviceActions].sort((a, b) => rank[a.priority] - rank[b.priority]);
}

function buildRecentOperations(tables: ManagerFloorTable[], inventoryRequests: InventoryRequest[]): RecentOperation[] {
  const requests = inventoryRequests.slice(0, 8).map((request) => ({ id: `request-${request.id}`, at: request.requestedAt, label: `${request.stationName || "Kitchen"} submitted a material request for ${request.itemName}` }));
  const sessions = tables.flatMap((table) => table.activeOrderId && table.openedAt ? [{ id: `session-${table.activeOrderId}`, at: table.openedAt, label: `${table.label} service session started` }] : []);
  return [...requests, ...sessions].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 8);
}

function CashierOperationsView({ snapshot, currency, onRefresh, onError, onNotice }: {
  snapshot: ManagerCashierOperationsSnapshot | null;
  currency?: CurrencyConfig;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [workingExpenseId, setWorkingExpenseId] = useState<string | null>(null);
  const shifts = snapshot?.activeShifts ?? [];
  const expenses = snapshot?.expenses ?? [];
  const handovers = snapshot?.handovers ?? [];
  const reconciliations = snapshot?.reconciliations ?? [];
  const pendingExpenses = expenses.filter((expense) => expense.status === "pending");
  const pendingHandovers = handovers.filter((handover) => handover.status === "awaiting_confirmation");
  const discrepancies = [
    ...handovers.filter((handover) => handover.status === "discrepancy"),
    ...reconciliations.filter((reconciliation) => reconciliation.variance !== 0),
  ];
  const selectedShift = shifts.find((shift) => shift.id === selectedShiftId) ?? null;
  const selectedExpenses = expenses.filter((expense) => expense.shiftId === selectedShiftId);
  const actionCount = pendingExpenses.length + pendingHandovers.length + discrepancies.length;

  async function reviewExpense(expense: ManagerCashierExpense, decision: "approved" | "rejected") {
    const reason = decision === "rejected" ? window.prompt("Rejection reason (required):")?.trim() : undefined;
    if (decision === "rejected" && !reason) return;
    try {
      setWorkingExpenseId(expense.id);
      await reviewManagerCashierExpense(expense.id, decision, reason);
      onNotice(`Expense ${decision}.`);
      await onRefresh();
    } catch (reviewError) {
      onError(reviewError instanceof Error ? reviewError.message : "Expense review failed.");
    } finally { setWorkingExpenseId(null); }
  }

  return <div className="moc-cashier-workspace">
    <section className="moc-cashier-kpis" aria-label="Cashier operations summary">
      <article><span>Cashiers on shift</span><strong>{shifts.length}</strong></article>
      <article><span>Open drawers</span><strong>{shifts.length}</strong></article>
      <article><span>Cash collected today</span><strong>{formatCurrency(snapshot?.cashCollectedToday ?? 0, currency)}</strong></article>
      <article className={pendingExpenses.length ? "attention" : ""}><span>Expense approvals</span><strong>{pendingExpenses.length}</strong></article>
      <article className={discrepancies.length ? "critical" : ""}><span>Reconciliation issues</span><strong>{discrepancies.length}</strong></article>
    </section>

    <section className="moc-panel moc-cash-actions" aria-labelledby="cashier-actions-title">
      <div className="moc-section-head"><div><span>Exceptions first</span><h2 id="cashier-actions-title">Cashier Actions <b>{actionCount}</b></h2></div></div>
      <div className="moc-cash-action-list">
        {pendingExpenses.map((expense) => <article key={expense.id} className="moc-cash-action attention">
          <i /><div><strong>Expense approval required</strong><span>{expense.cashierName} · {formatCurrency(expense.amount, currency)} · {expense.reason}</span></div><time>{elapsed(minutesSince(expense.createdAt))}</time>
          <div className="moc-cash-action-buttons"><button type="button" disabled={workingExpenseId === expense.id} onClick={() => void reviewExpense(expense, "approved")}>Approve</button><button type="button" className="danger" disabled={workingExpenseId === expense.id} onClick={() => void reviewExpense(expense, "rejected")}>Reject</button></div>
        </article>)}
        {pendingHandovers.map((handover) => <article key={handover.id} className="moc-cash-action attention"><i /><div><strong>Handover awaiting confirmation</strong><span>{handover.outgoingName} → {handover.incomingName} · {formatCurrency(handover.expectedAmount, currency)}</span></div><time>{elapsed(minutesSince(handover.initiatedAt))}</time><span className="moc-status amber">Pending incoming count</span></article>)}
        {handovers.filter((handover) => handover.status === "discrepancy").map((handover) => <article key={handover.id} className="moc-cash-action critical"><i /><div><strong>Cash handover discrepancy</strong><span>{handover.outgoingName} → {handover.incomingName} · Difference {formatCurrency(handover.difference ?? 0, currency)}</span></div><time>{handover.confirmedAt ? elapsed(minutesSince(handover.confirmedAt)) : ""}</time><span className="moc-status red">Review</span></article>)}
        {reconciliations.filter((item) => item.variance !== 0).map((item) => <article key={item.id} className="moc-cash-action critical"><i /><div><strong>Shift cash difference</strong><span>{item.cashierName} · Expected {formatCurrency(item.expectedCash, currency)} · Actual {formatCurrency(item.actualCash, currency)}</span></div><time>{elapsed(minutesSince(item.closedAt))}</time><span className="moc-status red">{item.variance > 0 ? "Over" : "Short"} {formatCurrency(Math.abs(item.variance), currency)}</span></article>)}
        {actionCount === 0 && <div className="moc-empty"><strong>✓ Cashier operation is under control</strong><span>No approvals, handovers, or cash differences require manager action.</span></div>}
      </div>
    </section>

    <section className="moc-panel moc-active-cashiers" aria-labelledby="active-cashiers-title">
      <div className="moc-section-head"><div><span>Live drawers</span><h2 id="active-cashiers-title">Active Cashiers</h2></div></div>
      <div className="moc-cashier-table" role="table" aria-label="Active cashier shifts">
        <div className="moc-cashier-table-head" role="row"><span>Cashier</span><span>Shift start</span><span>Opening</span><span>Cash sales</span><span>Expenses</span><span>Expected drawer</span><span>Status</span></div>
        {shifts.map((shift) => <button type="button" role="row" key={shift.id} onClick={() => setSelectedShiftId(shift.id)}>
          <span data-label="Cashier"><strong>{shift.cashierName}</strong><small>{shift.employeeId || "Staff ID unavailable"}</small></span><span data-label="Shift start">{timeLabel(shift.openedAt)}</span><span data-label="Opening">{formatCurrency(shift.openingCash, currency)}</span><span data-label="Cash sales">{formatCurrency(shift.cashCollected, currency)}</span><span data-label="Expenses">{formatCurrency(shift.approvedExpenses, currency)}</span><span data-label="Expected drawer"><strong>{formatCurrency(shift.expectedCash, currency)}</strong></span><span data-label="Status"><em className="moc-status green">Active</em></span>
        </button>)}
        {shifts.length === 0 && <div className="moc-empty"><strong>No cashier currently has an open shift.</strong></div>}
      </div>
    </section>

    <div className="moc-cash-secondary">
      <section className="moc-panel"><div className="moc-section-head"><div><span>Two-party control</span><h2>Recent Handovers</h2></div></div><div className="moc-cash-compact-list">{handovers.slice(0, 6).map((handover) => <p key={handover.id}><span><strong>{handover.outgoingName} → {handover.incomingName}</strong><small>{formatCurrency(handover.expectedAmount, currency)} expected</small></span><em className={`moc-status ${handover.status === "confirmed" ? "green" : handover.status === "discrepancy" ? "red" : "amber"}`}>{handover.status.replace("_", " ")}</em></p>)}{handovers.length === 0 && <div className="moc-empty"><strong>No recent cash handovers.</strong></div>}</div></section>
      <section className="moc-panel"><div className="moc-section-head"><div><span>Operational history</span><h2>Recent Cashier Events</h2></div></div><div className="moc-cash-compact-list">{(snapshot?.recentEvents ?? []).slice(0, 8).map((event) => <p key={event.id}><span><strong>{event.message}</strong><small>{event.actorName || "ServeFlow"} · {timeLabel(event.createdAt)}</small></span>{event.amount != null && <b>{formatCurrency(event.amount, currency)}</b>}</p>)}{(snapshot?.recentEvents ?? []).length === 0 && <div className="moc-empty"><strong>No recent cashier activity.</strong></div>}</div></section>
    </div>

    {selectedShift && <div className="moc-inspector-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedShiftId(null); }}><aside className="moc-inspector moc-cashier-inspector" role="dialog" aria-modal="true" aria-labelledby="cashier-shift-title">
      <header><div><span>Cashier Shift</span><h2 id="cashier-shift-title">{selectedShift.cashierName}</h2><time>Started {timeLabel(selectedShift.openedAt)}</time></div><button type="button" aria-label="Close cashier shift details" onClick={() => setSelectedShiftId(null)}>×</button></header>
      <section><h3>Drawer</h3><dl><div><dt>Opening cash</dt><dd>{formatCurrency(selectedShift.openingCash, currency)}</dd></div><div><dt>Cash collected</dt><dd>{formatCurrency(selectedShift.cashCollected, currency)}</dd></div><div><dt>Non-cash collected</dt><dd>{formatCurrency(selectedShift.nonCashCollected, currency)}</dd></div><div><dt>Approved expenses</dt><dd>{formatCurrency(selectedShift.approvedExpenses, currency)}</dd></div><div><dt>Expected cash</dt><dd>{formatCurrency(selectedShift.expectedCash, currency)}</dd></div></dl></section>
      <section><h3>Shift Expenses</h3><div className="moc-cash-compact-list">{selectedExpenses.map((expense) => <p key={expense.id}><span><strong>{expense.reason}</strong><small>{formatCurrency(expense.amount, currency)} · {timeLabel(expense.createdAt)}</small></span><em className={`moc-status ${expense.status === "approved" ? "green" : expense.status === "rejected" ? "red" : "amber"}`}>{expense.status}</em></p>)}{selectedExpenses.length === 0 && <div className="moc-empty"><strong>No expenses recorded for this shift.</strong></div>}</div></section>
    </aside></div>}
  </div>;
}

export function ManagerOperationsCenterPage({ restaurantId, currency }: Props) {
  const [operationsView, setOperationsView] = useState<OperationsView>("service");
  const [dashboard, setDashboard] = useState<ManagerDashboardSnapshot | null>(null);
  const [staffOps, setStaffOps] = useState<ManagerStaffOperationsSnapshot | null>(null);
  const [inventoryRequests, setInventoryRequests] = useState<InventoryRequest[]>([]);
  const [cashierOps, setCashierOps] = useState<ManagerCashierOperationsSnapshot | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [locationFilter, setLocationFilter] = useState<LocationFilter>("all");
  const [search, setSearch] = useState("");
  const [showAllOrderItems, setShowAllOrderItems] = useState(false);
  const [assigningTableId, setAssigningTableId] = useState<string | null>(null);
  const [pendingWaiterId, setPendingWaiterId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [releasingOrderId, setReleasingOrderId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextDashboard, nextStaffOps, nextInventoryRequests, nextCashierOps] = await Promise.all([fetchManagerDashboardSnapshot(restaurantId), loadManagerStaffOperations(restaurantId), loadInventoryRequests(restaurantId), loadManagerCashierOperations(restaurantId)]);
      setDashboard(nextDashboard);
      setStaffOps(nextStaffOps);
      setInventoryRequests(nextInventoryRequests);
      setCashierOps(nextCashierOps);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Live Operations is unavailable.");
    }
  }, [restaurantId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setShowAllOrderItems(false); }, [selectedTableId]);
  useTenantRealtime({ channelName: "manager-live-operations", restaurantId, tables: ["orders", "order_items", "order_invoices", "restaurant_tables", "restaurant_table_waiter_assignments", "restaurant_staff", "kitchen_inventory_requests", "cashier_shifts", "cash_reconciliations", "shift_activity_logs", "cashier_shift_expenses", "cashier_cash_handovers"], refresh });

  const serviceLocations = useMemo(() => (dashboard?.floorTables ?? []).filter((table) => table.active), [dashboard]);
  const waiters = useMemo(() => (staffOps?.staff ?? []).filter((member): member is ManagerStaffMember => member.role === "waiter" && member.active), [staffOps]);
  const selectedTable = serviceLocations.find((table) => table.id === selectedTableId) ?? null;
  const assigningTable = serviceLocations.find((table) => table.id === assigningTableId) ?? null;
  const managerActions = useMemo(() => buildManagerActions(serviceLocations, inventoryRequests), [serviceLocations, inventoryRequests]);
  const actionCounts = useMemo(() => ({ all: managerActions.length, urgent: managerActions.filter((item) => item.priority === "critical").length, approvals: managerActions.filter((item) => item.category === "approvals").length, service: managerActions.filter((item) => item.category === "service").length }), [managerActions]);
  const visibleActions = managerActions.filter((item) => actionFilter === "all" || (actionFilter === "urgent" ? item.priority === "critical" : item.category === actionFilter));
  const normalizedSearch = search.trim().toLowerCase();
  const visibleLocations = serviceLocations.filter((table) => {
    const state = locationState(table);
    const matchesSearch = !normalizedSearch || table.label.toLowerCase().includes(normalizedSearch) || (table.assignedWaiterName || "").toLowerCase().includes(normalizedSearch);
    const matchesFilter = locationFilter === "all" || (locationFilter === "active" && Boolean(table.activeOrderId)) || (locationFilter === "free" && state === "free") || (locationFilter === "attention" && (state === "attention" || state === "payment-due"));
    return matchesSearch && matchesFilter;
  });
  const activeLocations = serviceLocations.filter((table) => table.activeOrderId).length;
  const freeLocations = serviceLocations.length - activeLocations;
  const kitchenDelayed = serviceLocations.filter((table) => table.alerts.some((alert) => alert.type === "kitchen_delay")).length;
  const paymentDue = serviceLocations.filter((table) => table.cashierStatus === "waiting_payment" || table.status === "waiting_payment").length;
  const staffIssues = serviceLocations.filter((table) => table.activeOrderId && !table.assignedWaiterName).length;
  const unassignedLocations = serviceLocations.filter((table) => table.activeOrderId && !table.assignedWaiterName);
  const recentOperations = useMemo(() => buildRecentOperations(serviceLocations, inventoryRequests), [serviceLocations, inventoryRequests]);

  function reviewAction(action: ManagerAction) {
    if (action.tableId) { setSelectedTableId(action.tableId); setNotice(null); }
    else if (action.destination) navigateTo(action.destination, restaurantId);
  }

  async function assignWaiter(tableId: string, waiterId: string) {
    try {
      setNotice(null); setError(null);
      const waiter = waiters.find((member) => member.id === waiterId);
      const existingTableIds = waiter?.assignedTables.map((table) => table.id) ?? [];
      await assignWaiterTables(restaurantId, waiterId, Array.from(new Set([...existingTableIds, tableId])));
      setNotice("Staff assignment updated.");
      setAssigningTableId(null);
      setPendingWaiterId(null);
      await refresh();
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Could not update the assignment."); }
  }

  function openWaiterAssignment(tableId: string) {
    setAssigningTableId(tableId);
    setPendingWaiterId(waiters.find((member) => member.assignedTables.some((table) => table.id === tableId))?.id ?? null);
  }

  function confirmWaiterAssignment() {
    if (!assigningTable || !pendingWaiterId) return;
    const nextWaiter = waiters.find((member) => member.id === pendingWaiterId);
    if (!nextWaiter) return;
    if (assigningTable.activeOrderId && assigningTable.assignedWaiterName && assigningTable.assignedWaiterName !== nextWaiter.fullName && !window.confirm(`Reassign ${assigningTable.label}?\n\nCurrent waiter: ${assigningTable.assignedWaiterName}\nNew waiter: ${nextWaiter.fullName}\n\nActive session and orders will remain unchanged.`)) return;
    void assignWaiter(assigningTable.id, nextWaiter.id);
  }

  async function releaseTable(orderId: string, locationLabel: string) {
    if (!window.confirm(`Release ${locationLabel}? Confirm payment is complete and the service session has ended.`)) return;
    const reason = window.prompt("Emergency release reason (required):")?.trim();
    if (!reason) { setError("An emergency release reason is required."); return; }
    try {
      setReleasingOrderId(orderId); setNotice(null); setError(null);
      await releaseManagerDiningSession(orderId, reason);
      setNotice(`${locationLabel} released successfully.`); setSelectedTableId(null); await refresh();
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Could not release the service location."); }
    finally { setReleasingOrderId(null); }
  }

  return <main className="moc-page">
    {(notice || error) && <div className={`moc-message ${error ? "error" : ""}`} role={error ? "alert" : "status"}>{error || notice}</div>}

    <nav className="moc-workspace-tabs" aria-label="Live Operations workspace">
      <button type="button" className={operationsView === "service" ? "is-active" : ""} aria-current={operationsView === "service" ? "page" : undefined} onClick={() => setOperationsView("service")}>Service</button>
      <button type="button" className={operationsView === "cashier" ? "is-active" : ""} aria-current={operationsView === "cashier" ? "page" : undefined} onClick={() => setOperationsView("cashier")}>Cashier <span>{(cashierOps?.expenses ?? []).filter((item) => item.status === "pending").length}</span></button>
    </nav>

    {operationsView === "cashier" ? <CashierOperationsView snapshot={cashierOps} currency={currency} onRefresh={refresh} onError={(message) => { setError(message); setNotice(null); }} onNotice={(message) => { setNotice(message); setError(null); }} /> : <>

    <section className="moc-panel moc-actions" aria-labelledby="manager-actions-title">
      <div className="moc-section-head"><div><span>Intervention queue</span><h2 id="manager-actions-title">Manager Actions <b>{managerActions.length}</b></h2></div><div className="moc-filter-row" aria-label="Filter manager actions">{(["all", "urgent", "approvals", "service"] as const).map((filter) => <button key={filter} type="button" className={actionFilter === filter ? "is-active" : ""} onClick={() => setActionFilter(filter)}>{filter.charAt(0).toUpperCase() + filter.slice(1)} <span>{actionCounts[filter]}</span></button>)}</div></div>
      <div className="moc-action-list">{visibleActions.map((action) => <article className={`moc-action-row ${action.priority}`} key={action.id}><span className="moc-priority-dot" aria-label={`${action.priority} priority`} /><div><strong>{action.title}</strong><span>{action.detail}</span></div>{action.age && <time>{action.age}</time>}<button type="button" onClick={() => reviewAction(action)}>{action.destination ? "Open Inventory" : "Review"}</button></article>)}{visibleActions.length === 0 && <div className="moc-empty"><strong>✓ No manager actions pending</strong><span>Current service is operating normally.</span></div>}</div>
    </section>

    <div className="moc-command-layout">
      <section className="moc-panel moc-service" aria-labelledby="live-service-title">
        <div className="moc-section-head moc-service-head"><div><span>Command center</span><h2 id="live-service-title">Live Service</h2><p>{serviceLocations.length} locations · {activeLocations} active · {freeLocations} available</p></div><label className="moc-search"><span className="sr-only">Search service location</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search service location..." /></label></div>
        <div className="moc-filter-row moc-location-filters" aria-label="Filter service locations">{(["all", "active", "free", "attention"] as const).map((filter) => <button key={filter} type="button" className={locationFilter === filter ? "is-active" : ""} onClick={() => setLocationFilter(filter)}>{filter.charAt(0).toUpperCase() + filter.slice(1)}</button>)}</div>
        <div className="moc-location-grid">{visibleLocations.map((table) => { const state = locationState(table); const hasSession = Boolean(table.activeOrderId); return <button key={table.id} type="button" className={`moc-location ${state}`} onClick={() => { setSelectedTableId(table.id); setNotice(null); }} aria-label={`Open ${table.label}, ${stateLabel(table)}`}><span className="moc-location-top"><strong>{table.label}</strong>{hasSession && table.sessionDurationMinutes != null && <time>{elapsed(table.sessionDurationMinutes)}</time>}</span><span className="moc-location-state"><i />{stateLabel(table)}</span>{hasSession && <span className="moc-location-session"><b>{table.assignedWaiterName || "Staff unassigned"}</b><em>{formatCurrency(table.runningBill, currency)}</em></span>}</button>; })}{visibleLocations.length === 0 && <div className="moc-empty"><strong>No service locations found.</strong><span>Try another search or filter.</span></div>}</div>
        <div className="moc-coverage-strip"><div><strong>Unassigned Locations</strong><span>{unassignedLocations.length ? `${unassignedLocations.length} active service location${unassignedLocations.length === 1 ? "" : "s"} need coverage.` : "✓ All active service locations have staff coverage."}</span></div>{unassignedLocations.length > 0 && <div className="moc-unassigned-list">{unassignedLocations.map((table) => <button type="button" key={table.id} onClick={() => openWaiterAssignment(table.id)}><span><strong>{table.label}</strong><small>Active session</small></span>Assign waiter</button>)}</div>}</div>
      </section>
      <aside className="moc-panel moc-shift" aria-labelledby="shift-health-title"><div className="moc-section-head"><div><span>Current workload</span><h2 id="shift-health-title">Shift Health</h2></div></div><dl><div><dt>Active service</dt><dd>{activeLocations}</dd></div><div><dt>Open orders</dt><dd>{dashboard?.kpis.activeDiningSessions ?? 0}</dd></div><div><dt>Kitchen delayed</dt><dd className={kitchenDelayed ? "needs-attention" : ""}>{kitchenDelayed}</dd></div><div><dt>Payment due</dt><dd className={paymentDue ? "needs-attention" : ""}>{paymentDue}</dd></div><div><dt>Manager actions</dt><dd className={managerActions.length ? "needs-attention" : ""}>{managerActions.length}</dd></div><div><dt>Staff issues</dt><dd className={staffIssues ? "needs-attention" : ""}>{staffIssues}</dd></div></dl>{managerActions.length === 0 && kitchenDelayed === 0 && staffIssues === 0 && <p className="moc-healthy"><i /> Shift operating normally</p>}</aside>
    </div>

    <section className="moc-panel moc-recent" aria-labelledby="recent-operations-title"><div className="moc-section-head"><div><span>Live context</span><h2 id="recent-operations-title">Recent Operations</h2></div></div><div className="moc-timeline">{recentOperations.map((operation) => <p key={operation.id}><time>{timeLabel(operation.at)}</time><span>{operation.label}</span></p>)}{recentOperations.length === 0 && <div className="moc-empty"><strong>No recent operational activity.</strong></div>}</div></section>

    {selectedTable && <div className="moc-inspector-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedTableId(null); }}><aside className="moc-inspector" role="dialog" aria-modal="true" aria-labelledby="location-inspector-title">
      <header><div><span>Service Location</span><h2 id="location-inspector-title">{selectedTable.label}</h2>{selectedTable.activeOrderId && selectedTable.sessionDurationMinutes != null && <time>{elapsed(selectedTable.sessionDurationMinutes)}</time>}</div><div className="moc-inspector-head-actions"><span className={`moc-location-state ${locationState(selectedTable)}`}><i />{stateLabel(selectedTable)}</span><button type="button" aria-label="Close service location inspector" onClick={() => setSelectedTableId(null)}>×</button></div></header>
      {selectedTable.activeOrderId ? <>
        <section><h3>Service</h3><dl><div><dt>Assigned Waiter</dt><dd className="moc-assigned-waiter"><span>{selectedTable.assignedWaiterName || "Unassigned"}</span><button type="button" onClick={() => openWaiterAssignment(selectedTable.id)}>{selectedTable.assignedWaiterName ? "Change" : "Assign"}</button></dd></div>{selectedTable.openedAt && <div><dt>Session started</dt><dd>{timeLabel(selectedTable.openedAt)}</dd></div>}</dl></section>
        <section><h3>Current Order</h3><div className="moc-order-items">{(showAllOrderItems ? selectedTable.orderItems : selectedTable.orderItems.slice(0, 3)).map((item) => <p key={item.id}><span>{item.name}</span><strong>×{item.quantity}</strong></p>)}{selectedTable.orderItems.length === 0 && <p className="moc-order-items-empty">No current items available.</p>}{selectedTable.orderItems.length > 3 && <button type="button" onClick={() => setShowAllOrderItems((visible) => !visible)}>{showAllOrderItems ? "Show fewer" : `+${selectedTable.orderItems.length - 3} more`}</button>}</div><dl className="moc-order-state"><div><dt>Kitchen</dt><dd>{selectedTable.kitchenStatus}</dd></div></dl></section>
        <section><h3>Payment</h3><dl className="moc-payment-state"><div><dt>Total</dt><dd>{formatCurrency(selectedTable.runningBill, currency)}</dd></div><div><dt>Paid</dt><dd>{formatCurrency(selectedTable.paidAmount, currency)}</dd></div><div><dt>Due</dt><dd>{formatCurrency(selectedTable.dueAmount, currency)}</dd></div><div><dt>Status</dt><dd>{paymentStatusLabel(selectedTable)}</dd></div></dl></section>
        {selectedTable.alerts.some((alert) => alert.type === "kitchen_delay") && <section className="moc-manager-attention"><h3>Manager Attention</h3><p>Kitchen delay requires intervention.</p><button type="button" onClick={() => navigateTo("/manager/kitchen", restaurantId)}>Open Kitchen</button></section>}
      </> : <><section><h3>Service</h3><dl><div><dt>Assigned Waiter</dt><dd className="moc-assigned-waiter"><span>{selectedTable.assignedWaiterName || "Unassigned"}</span><button type="button" onClick={() => openWaiterAssignment(selectedTable.id)}>{selectedTable.assignedWaiterName ? "Change" : "Assign"}</button></dd></div></dl></section><div className="moc-empty moc-inspector-empty"><strong>No active service session.</strong><span>This location is currently available.</span></div></>}
    </aside></div>}

    {assigningTable && <div className="moc-assignment-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAssigningTableId(null); }}><section className="moc-assignment-dialog" role="dialog" aria-modal="true" aria-labelledby="moc-assign-title">
      <header><div><span>Assign Waiter</span><h2 id="moc-assign-title">{assigningTable.label}</h2><p>Current waiter: {assigningTable.assignedWaiterName || "Unassigned"}</p></div><button type="button" aria-label="Close waiter assignment" onClick={() => setAssigningTableId(null)}>×</button></header>
      <div className="moc-waiter-list">{waiters.map((waiter) => { const status = waiter.breakStatus === "on_break" ? "On break" : waiter.online ? waiter.currentWorkload > 0 ? "Busy" : "Available" : "Offline"; return <label key={waiter.id} className={pendingWaiterId === waiter.id ? "selected" : ""}><input type="radio" name="waiter-assignment" checked={pendingWaiterId === waiter.id} onChange={() => setPendingWaiterId(waiter.id)} /><span><strong>{waiter.fullName}</strong><small>{waiter.assignedTables.length} table{waiter.assignedTables.length === 1 ? "" : "s"} · {waiter.activeOrders} active order{waiter.activeOrders === 1 ? "" : "s"}</small></span><em className={status.toLowerCase().replace(" ", "-")}>{status}</em></label>; })}{waiters.length === 0 && <div className="moc-empty"><strong>No eligible waiters available.</strong></div>}</div>
      <footer><button type="button" className="secondary" onClick={() => setAssigningTableId(null)}>Cancel</button><button type="button" disabled={!pendingWaiterId} onClick={confirmWaiterAssignment}>{assigningTable.assignedWaiterName ? "Reassign" : "Assign"}</button></footer>
    </section></div>}
    </>}
  </main>;
}

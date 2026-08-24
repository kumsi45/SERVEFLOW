import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTenantRealtime } from "../../../core/realtime/useTenantRealtime";
import { formatCurrency, type CurrencyConfig } from "../../../core/format/currency";
import { fetchManagerDashboardSnapshot, releaseManagerDiningSession } from "../services/managerDashboardService";
import { ManagerWaiterTableAssignments } from "../components/ManagerWaiterTableAssignments";
import { assignManagerWaiterTables, loadManagerWaiterTableAssignments, unassignManagerWaiterTables, type ManagerWaiterAssignmentContext } from "../services/managerWaiterTableAssignmentService";
import type { ManagerDashboardSnapshot, ManagerFloorTable } from "../types";
import { inventoryRequestStatusLabel, loadInventoryRequests, materialRequestTypeLabel, processInventoryRequest, type InventoryRequest } from "../../kitchen/services/inventoryRequestService";
import { loadInventoryCurrentStock } from "../../inventory/services/inventoryStockRepository";
import type { InventoryCurrentStockRow } from "../../inventory/types";
import { loadManagerCashierOperations, reviewManagerCashierExpense, type ManagerCashierExpense, type ManagerCashierOperationsSnapshot } from "../services/managerCashierOperationsService";
import "../styles/managerOperationsCenter.css";
import { managerFacingMessage } from "../managerPresentation";

type Props = { restaurantId: string; currency?: CurrencyConfig };
type ActionFilter = "all" | "urgent" | "approvals" | "service";
type LocationFilter = "all" | "active" | "free" | "attention";
type ActionPriority = "critical" | "attention" | "normal";
type ManagerAction = { id: string; title: string; detail: string; age: string; priority: ActionPriority; category: "approvals" | "service"; tableId?: string; requestId?: string };
type RecentOperation = { id: string; at: string; label: string };
type OperationsView = "service" | "cashier";
const OPERATIONS_LOAD_TIMEOUT_MS = 15_000;

function withOperationsTimeout<T>(request: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error("Manager operations request timed out.")), OPERATIONS_LOAD_TIMEOUT_MS);
    request.then(resolve, reject).finally(() => window.clearTimeout(timeoutId));
  });
}

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

function requestedLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  const today = new Date();
  const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  return `${sameDay ? "Today" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date)}, ${timeLabel(value)}`;
}

function requestStatusTone(status: InventoryRequest["status"]) {
  if (status === "pending" || status === "accepted") return "amber";
  if (status === "rejected" || status === "unable_to_fulfill") return "red";
  if (status === "issued") return "blue";
  return "green";
}

function quantity(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
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
  const uniqueRequests = Array.from(new Map(inventoryRequests.map((request) => [request.id, request])).values());
  const inventoryActions = uniqueRequests.filter((request) => request.status === "pending").map((request) => {
    const minutes = minutesSince(request.requestedAt);
    const context = [request.stationName || "Kitchen", request.requesterName, `${request.quantity} ${request.unit}`].filter(Boolean).join(" · ");
    const priority: ActionPriority = request.urgency === "critical" ? "critical" : request.urgency === "high" ? "attention" : "normal";
    return { id: `inventory-${request.id}`, title: "Kitchen Material Request", detail: `${request.itemName} · ${context}`, age: elapsed(minutes), priority, category: "approvals" as const, requestId: request.id };
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
  const [inventoryRequests, setInventoryRequests] = useState<InventoryRequest[]>([]);
  const [inventoryStock, setInventoryStock] = useState<InventoryCurrentStockRow[]>([]);
  const [cashierOps, setCashierOps] = useState<ManagerCashierOperationsSnapshot | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [operationsState, setOperationsState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [requestsUnavailable, setRequestsUnavailable] = useState(false);
  const [reviewingRequestId, setReviewingRequestId] = useState<string | null>(null);
  const [rejectingRequest, setRejectingRequest] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [requestActionError, setRequestActionError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [locationFilter, setLocationFilter] = useState<LocationFilter>("all");
  const [search, setSearch] = useState("");
  const [showAllOrderItems, setShowAllOrderItems] = useState(false);
  const [assignmentContext, setAssignmentContext] = useState<ManagerWaiterAssignmentContext | null>(null);
  const [assignmentState, setAssignmentState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [assignmentSyncNotice, setAssignmentSyncNotice] = useState<string | null>(null);
  const [requestedAssignmentTableId, setRequestedAssignmentTableId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondaryError, setSecondaryError] = useState<string | null>(null);
  const [releasingOrderId, setReleasingOrderId] = useState<string | null>(null);
  const localAssignmentAt = useRef(0);

  const refresh = useCallback(async () => {
    setRequestsLoading(true);
    setSecondaryError(null);
    const dashboardLoad = withOperationsTimeout(fetchManagerDashboardSnapshot(restaurantId)).then((nextDashboard) => {
      setDashboard(nextDashboard);
      setOperationsState("ready");
      setError(null);
    }).catch(() => {
      setOperationsState("unavailable");
      setError("Unable to load Live Operations.");
    });
    const secondaryLoad = Promise.allSettled([
      withOperationsTimeout(loadInventoryRequests(restaurantId)),
      withOperationsTimeout(loadInventoryCurrentStock(restaurantId)),
      withOperationsTimeout(loadManagerCashierOperations(restaurantId)),
    ]).then(([requestsResult, stockResult, cashierResult]) => {
      if (requestsResult.status === "fulfilled") {
        setInventoryRequests(requestsResult.value);
        setRequestsUnavailable(false);
      } else {
        setRequestsUnavailable(true);
      }
      if (stockResult.status === "fulfilled") setInventoryStock(stockResult.value);
      if (cashierResult.status === "fulfilled") setCashierOps(cashierResult.value);
      const failedAreas = [
        stockResult.status === "rejected" ? "inventory availability" : null,
        cashierResult.status === "rejected" ? "cashier supervision" : null,
      ].filter(Boolean);
      setSecondaryError(failedAreas.length ? `Some supporting data is temporarily unavailable: ${failedAreas.join(" and ")}.` : null);
    }).finally(() => { setRequestsLoading(false); });
    await Promise.all([dashboardLoad, secondaryLoad]);
  }, [restaurantId]);

  const refreshAssignments = useCallback(async () => {
    try {
      const nextContext = await withOperationsTimeout(loadManagerWaiterTableAssignments(restaurantId));
      setAssignmentContext(nextContext);
      setAssignmentState("ready");
    } catch {
      setAssignmentState("unavailable");
    }
  }, [restaurantId]);

  const refreshAssignmentsFromRealtime = useCallback(async () => {
    const followsLocalWrite = Date.now() - localAssignmentAt.current < 3000;
    if (!followsLocalWrite) setAssignmentSyncNotice("Assignment changed by another Manager. Refreshing...");
    await refreshAssignments();
    if (!followsLocalWrite) window.setTimeout(() => setAssignmentSyncNotice(null), 2400);
  }, [refreshAssignments]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void refreshAssignments(); }, [refreshAssignments]);
  useEffect(() => { setShowAllOrderItems(false); }, [selectedTableId]);
  useTenantRealtime({ channelName: "manager-live-operations", restaurantId, tables: ["orders", "order_items", "order_invoices", "restaurant_tables", "restaurant_staff", "kitchen_inventory_requests", "inventory_items", "cashier_shifts", "cash_reconciliations", "shift_activity_logs", "cashier_shift_expenses", "cashier_cash_handovers"], refresh, skipInitialConnectRefresh: true });
  useTenantRealtime({ channelName: "manager-waiter-table-assignments", restaurantId, tables: ["restaurant_table_waiter_assignments"], refresh: refreshAssignmentsFromRealtime, skipInitialConnectRefresh: true });

  const serviceLocations = useMemo(() => {
    const assignments = new Map((assignmentContext?.tables ?? []).map((table) => [table.tableId, table]));
    return (dashboard?.floorTables ?? []).filter((table) => table.active).map((table) => {
      const assignment = assignments.get(table.id);
      return assignment ? { ...table, assignedWaiterName: assignment.currentWaiterName } : table;
    });
  }, [assignmentContext, dashboard]);
  const selectedTable = serviceLocations.find((table) => table.id === selectedTableId) ?? null;
  const selectedRequest = inventoryRequests.find((request) => request.id === selectedRequestId) ?? null;
  const selectedRequestStock = selectedRequest?.inventoryItemId ? inventoryStock.filter((item) => item.inventoryItemId === selectedRequest.inventoryItemId) : [];
  const selectedRequestStockQuantity = selectedRequestStock.reduce((total,item)=>total+item.currentQuantity,0);
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
  const recentOperations = useMemo(() => buildRecentOperations(serviceLocations, inventoryRequests), [serviceLocations, inventoryRequests]);

  function reviewAction(action: ManagerAction) {
    if (action.tableId) { setSelectedTableId(action.tableId); setNotice(null); }
    else if (action.requestId) { setSelectedRequestId(action.requestId); setRejectingRequest(false); setRejectionReason(""); setRequestActionError(null); setNotice(null); }
  }

  function checkInventory() {
    navigateTo("/manager/inventory", restaurantId);
  }

  async function reviewInventoryRequest(request: InventoryRequest, action: "accept" | "reject") {
    const reason = rejectionReason.trim();
    if (action === "reject" && !reason) { setRequestActionError("Rejection reason is required."); return; }
    try {
      setReviewingRequestId(request.id); setRequestActionError(null); setError(null); setNotice(null);
      await processInventoryRequest(restaurantId, request.id, action, action === "reject" ? reason : undefined);
      setNotice(action === "accept" ? "Request approved. Awaiting Inventory." : "Request rejected.");
      setRejectingRequest(false); setRejectionReason("");
      await refresh();
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : "Request details unavailable.";
      if (message.toLowerCase().includes("already handled")) setRequestActionError("Request was already handled by another Manager.");
      else if (message.toLowerCase().includes("access denied") || message.toLowerCase().includes("permission")) setRequestActionError("You no longer have permission to review this request.");
      else if (message.toLowerCase().includes("not found")) setRequestActionError("Request details unavailable.");
      else setRequestActionError(message);
      await refresh();
    } finally { setReviewingRequestId(null); }
  }

  async function assignTables(waiterId: string, tableIds: string[]) {
    setNotice(null); setError(null);
    try {
      await assignManagerWaiterTables(restaurantId, waiterId, tableIds);
      localAssignmentAt.current = Date.now();
      setNotice(`${tableIds.length} table${tableIds.length === 1 ? "" : "s"} assigned.`);
    } catch (assignmentError) {
      await Promise.allSettled([refresh(), refreshAssignments()]);
      throw assignmentError;
    }
    await Promise.all([refresh(), refreshAssignments()]);
  }

  async function unassignTables(tableIds: string[]) {
    setNotice(null); setError(null);
    try {
      await unassignManagerWaiterTables(restaurantId, tableIds);
      localAssignmentAt.current = Date.now();
      setNotice(`${tableIds.length} table${tableIds.length === 1 ? "" : "s"} moved to Unassigned. Occupancy is unchanged.`);
    } catch (assignmentError) {
      await Promise.allSettled([refresh(), refreshAssignments()]);
      throw assignmentError;
    }
    await Promise.all([refresh(), refreshAssignments()]);
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

  if (operationsState === "loading" && !dashboard) return <main className="moc-page"><div className="moc-message" role="status">Loading Live Operations...</div></main>;
  if (operationsState === "unavailable") return <main className="moc-page"><div className="moc-message error" role="alert">Unable to load Live Operations.</div></main>;

  return <main className="moc-page">
    {(notice || error) && <div className={`moc-message ${error ? "error" : ""}`} role={error ? "alert" : "status"}>{error ? managerFacingMessage(error, "Unable to complete the Live Operations action. Try again.") : notice}</div>}
    {secondaryError && <div className="moc-message error" role="alert">{secondaryError}</div>}
    {requestsUnavailable && <div className="moc-message error" role="alert">Kitchen requests unavailable.</div>}

    <nav className="moc-workspace-tabs" aria-label="Live Operations workspace">
      <button type="button" className={operationsView === "service" ? "is-active" : ""} aria-current={operationsView === "service" ? "page" : undefined} onClick={() => setOperationsView("service")}>Service</button>
      <button type="button" className={operationsView === "cashier" ? "is-active" : ""} aria-current={operationsView === "cashier" ? "page" : undefined} onClick={() => setOperationsView("cashier")}>Cashier <span>{(cashierOps?.expenses ?? []).filter((item) => item.status === "pending").length}</span></button>
    </nav>

    {operationsView === "cashier" ? <CashierOperationsView snapshot={cashierOps} currency={currency} onRefresh={refresh} onError={(message) => { setError(message); setNotice(null); }} onNotice={(message) => { setNotice(message); setError(null); }} /> : <>

    <section className="moc-panel moc-actions" aria-labelledby="manager-actions-title">
      <div className="moc-section-head"><div><span>Intervention queue</span><h2 id="manager-actions-title">Manager Actions <b>{managerActions.length}</b></h2></div><div className="moc-filter-row" aria-label="Filter manager actions">{(["all", "urgent", "approvals", "service"] as const).map((filter) => <button key={filter} type="button" className={actionFilter === filter ? "is-active" : ""} onClick={() => setActionFilter(filter)}>{filter.charAt(0).toUpperCase() + filter.slice(1)} <span>{actionCounts[filter]}</span></button>)}</div></div>
      <div className="moc-action-list">
        {requestsLoading && inventoryRequests.length === 0 && <div className="moc-empty" role="status"><strong>Loading requests...</strong></div>}
        {visibleActions.map((action) => { const request=action.requestId ? inventoryRequests.find((item)=>item.id===action.requestId) : null; return request ? <article className={`moc-request-action ${action.priority}`} key={action.id}>
          <header><div><span>{materialRequestTypeLabel(request.requestType)}</span><h3>{request.itemName}</h3></div><span className={`moc-status ${request.urgency === "critical" ? "red" : request.urgency === "high" ? "amber" : ""}`}>{inventoryRequestStatusLabel(request.status)}</span></header>
          <dl><div><dt>Quantity</dt><dd>{quantity(request.quantity)} {request.unit}</dd></div><div><dt>Station</dt><dd>{request.stationName || "Station not recorded"}</dd></div><div><dt>Requested by</dt><dd>{request.requesterName || "Requester not recorded"}</dd></div><div className="is-wide"><dt>Reason</dt><dd>{request.comment || "Reason not recorded"}</dd></div><div><dt>Requested</dt><dd>{requestedLabel(request.requestedAt)}</dd></div><div><dt>Waiting</dt><dd>{action.age || "Just now"}</dd></div></dl>
          <footer><button type="button" onClick={() => reviewAction(action)}>Review Request</button><button type="button" className="secondary" onClick={checkInventory}>Check Inventory</button></footer>
        </article> : <article className={`moc-action-row ${action.priority}`} key={action.id}><span className="moc-priority-dot" aria-label={`${action.priority} priority`} /><div><strong>{action.title}</strong><span>{action.detail}</span></div>{action.age && <time>{action.age}</time>}<button type="button" onClick={() => reviewAction(action)}>Review</button></article>; })}
        {!requestsLoading && !requestsUnavailable && visibleActions.length === 0 && <div className="moc-empty"><strong>{actionFilter === "approvals" ? "No kitchen requests require attention." : "No manager actions require attention."}</strong><span>Current service is operating normally.</span></div>}
      </div>
    </section>

    <ManagerWaiterTableAssignments context={assignmentContext} state={assignmentState} syncNotice={assignmentSyncNotice} requestedTableId={requestedAssignmentTableId} onRequestHandled={() => setRequestedAssignmentTableId(null)} onAssign={assignTables} onUnassign={unassignTables} />

    <div className="moc-command-layout">
      <section className="moc-panel moc-service" aria-labelledby="live-service-title">
        <div className="moc-section-head moc-service-head"><div><span>Command center</span><h2 id="live-service-title">Live Service</h2><p>{serviceLocations.length} locations · {activeLocations} active · {freeLocations} available</p></div><label className="moc-search"><span className="sr-only">Search service location</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search service location..." /></label></div>
        <div className="moc-filter-row moc-location-filters" aria-label="Filter service locations">{(["all", "active", "free", "attention"] as const).map((filter) => <button key={filter} type="button" className={locationFilter === filter ? "is-active" : ""} onClick={() => setLocationFilter(filter)}>{filter.charAt(0).toUpperCase() + filter.slice(1)}</button>)}</div>
        <div className="moc-location-grid">{visibleLocations.map((table) => { const state = locationState(table); const hasSession = Boolean(table.activeOrderId); return <button key={table.id} type="button" className={`moc-location ${state}`} onClick={() => { setSelectedTableId(table.id); setNotice(null); }} aria-label={`Open ${table.label}, ${stateLabel(table)}, ${table.assignedWaiterName || "Unassigned"}`}><span className="moc-location-top"><strong>{table.label}</strong>{hasSession && table.sessionDurationMinutes != null && <time>{elapsed(table.sessionDurationMinutes)}</time>}</span><span className="moc-location-state"><i />{stateLabel(table)}</span><span className="moc-location-responsibility"><small>Waiter</small><b>{table.assignedWaiterName || "Unassigned"}</b></span>{hasSession && <span className="moc-location-session"><em>{formatCurrency(table.runningBill, currency)}</em></span>}</button>; })}{visibleLocations.length === 0 && <div className="moc-empty"><strong>No service locations found.</strong><span>Try another search or filter.</span></div>}</div>
      </section>
      <aside className="moc-panel moc-shift" aria-labelledby="shift-health-title"><div className="moc-section-head"><div><span>Current workload</span><h2 id="shift-health-title">Shift Health</h2></div></div><dl><div><dt>Active service</dt><dd>{activeLocations}</dd></div><div><dt>Open orders</dt><dd>{dashboard?.kpis.activeDiningSessions ?? 0}</dd></div><div><dt>Kitchen delayed</dt><dd className={kitchenDelayed ? "needs-attention" : ""}>{kitchenDelayed}</dd></div><div><dt>Payment due</dt><dd className={paymentDue ? "needs-attention" : ""}>{paymentDue}</dd></div><div><dt>Manager actions</dt><dd className={managerActions.length ? "needs-attention" : ""}>{managerActions.length}</dd></div><div><dt>Staff issues</dt><dd className={staffIssues ? "needs-attention" : ""}>{staffIssues}</dd></div></dl>{managerActions.length === 0 && kitchenDelayed === 0 && staffIssues === 0 && <p className="moc-healthy"><i /> Shift operating normally</p>}</aside>
    </div>

    <section className="moc-panel moc-recent" aria-labelledby="recent-operations-title"><div className="moc-section-head"><div><span>Live context</span><h2 id="recent-operations-title">Recent Operations</h2></div></div><div className="moc-timeline">{recentOperations.map((operation) => <p key={operation.id}><time>{timeLabel(operation.at)}</time><span>{operation.label}</span></p>)}{recentOperations.length === 0 && <div className="moc-empty"><strong>No recent operational activity.</strong></div>}</div></section>

    {selectedRequest && <div className="moc-inspector-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedRequestId(null); }}><aside className="moc-inspector moc-request-inspector" role="dialog" aria-modal="true" aria-labelledby="request-inspector-title">
      <header><div><span>Kitchen Material Request</span><h2 id="request-inspector-title">{selectedRequest.itemName}</h2><time>Waiting {elapsed(minutesSince(selectedRequest.requestedAt)) || "less than a minute"}</time></div><div className="moc-inspector-head-actions"><span className={`moc-status ${requestStatusTone(selectedRequest.status)}`}>{inventoryRequestStatusLabel(selectedRequest.status)}</span><button type="button" aria-label="Close request details" onClick={() => setSelectedRequestId(null)}>×</button></div></header>
      <section><h3>Request details</h3><dl><div><dt>Request type</dt><dd>{materialRequestTypeLabel(selectedRequest.requestType)}</dd></div><div><dt>Requested item</dt><dd>{selectedRequest.itemName}</dd></div><div><dt>Quantity</dt><dd>{quantity(selectedRequest.quantity)} {selectedRequest.unit}</dd></div><div><dt>Station</dt><dd>{selectedRequest.stationName || "Station not recorded"}</dd></div><div><dt>Requested by</dt><dd>{selectedRequest.requesterName || "Requester not recorded"}</dd></div><div><dt>Requested</dt><dd>{requestedLabel(selectedRequest.requestedAt)}</dd></div><div><dt>Urgency</dt><dd>{selectedRequest.urgency}</dd></div></dl></section>
      <section><h3>Reason</h3><p className="moc-request-reason">{selectedRequest.comment || "Reason not recorded"}</p></section>
      <section><h3>Inventory context</h3><dl><div><dt>Current stock</dt><dd>{selectedRequestStock.length ? `${quantity(selectedRequestStockQuantity)} ${selectedRequestStock[0].unitName}` : "Inventory link unavailable"}</dd></div><div><dt>Requested</dt><dd>{quantity(selectedRequest.quantity)} {selectedRequest.unit}</dd></div></dl><button type="button" className="moc-inventory-link" onClick={checkInventory}>Open Inventory</button></section>
      {selectedRequest.status === "accepted" && <section className="moc-request-outcome"><h3>Awaiting Inventory</h3><p>Inventory has not issued this request yet.</p></section>}
      {selectedRequest.status === "issued" && <section className="moc-request-outcome"><h3>Issued · Awaiting Kitchen Confirmation</h3><p>Waiting for Kitchen to confirm receipt.</p></section>}
      {selectedRequest.status === "delivered" && <section className="moc-request-outcome"><h3>Fulfilled</h3><p>Received by Kitchen.</p></section>}
      {selectedRequest.status === "unable_to_fulfill" && <section className="moc-request-outcome unable"><h3>Unable to Fulfill</h3><p>{selectedRequest.unableToFulfillReason || "Reason not recorded."}</p></section>}
      {(selectedRequest.reviewedAt || selectedRequest.reviewerName || selectedRequest.issuedAt || selectedRequest.issuerName || selectedRequest.confirmedAt || selectedRequest.confirmerName || selectedRequest.rejectedAt || selectedRequest.rejectionReason || selectedRequest.unableToFulfillAt || selectedRequest.unableToFulfillByName) && <section><h3>Request history</h3><dl>{selectedRequest.reviewerName && <div><dt>{selectedRequest.status === "rejected" ? "Rejected by" : "Approved by"}</dt><dd>{selectedRequest.reviewerName}</dd></div>}{selectedRequest.status === "accepted" && selectedRequest.acceptedAt && <div><dt>Approved at</dt><dd>{requestedLabel(selectedRequest.acceptedAt)}</dd></div>}{selectedRequest.status === "rejected" && selectedRequest.rejectedAt && <div><dt>Rejected at</dt><dd>{requestedLabel(selectedRequest.rejectedAt)}</dd></div>}{selectedRequest.issuedQuantity != null && <div><dt>Issued quantity</dt><dd>{quantity(selectedRequest.issuedQuantity)} {selectedRequest.unit}</dd></div>}{selectedRequest.issuerName && <div><dt>Issued by</dt><dd>{selectedRequest.issuerName}</dd></div>}{selectedRequest.issuedAt && <div><dt>Issued at</dt><dd>{requestedLabel(selectedRequest.issuedAt)}</dd></div>}{selectedRequest.confirmerName && <div><dt>Confirmed by</dt><dd>{selectedRequest.confirmerName}</dd></div>}{selectedRequest.confirmedAt && <div><dt>Confirmed at</dt><dd>{requestedLabel(selectedRequest.confirmedAt)}</dd></div>}{selectedRequest.unableToFulfillByName && <div><dt>Inventory Officer</dt><dd>{selectedRequest.unableToFulfillByName}</dd></div>}{selectedRequest.unableToFulfillAt && <div><dt>Recorded at</dt><dd>{requestedLabel(selectedRequest.unableToFulfillAt)}</dd></div>}</dl>{selectedRequest.rejectionReason && <div className="moc-request-rejection"><strong>Rejection reason</strong><p>{selectedRequest.rejectionReason}</p></div>}</section>}
      {selectedRequest.status === "pending" && <section className="moc-request-decision"><h3>Manager decision</h3>{requestActionError && <p className="moc-request-error" role="alert">{requestActionError}</p>}{rejectingRequest ? <><label>Rejection reason<textarea value={rejectionReason} maxLength={500} onChange={(event)=>setRejectionReason(event.target.value)} placeholder="Explain why this request is being rejected..." /></label><div><button type="button" className="secondary" disabled={reviewingRequestId===selectedRequest.id} onClick={()=>{setRejectingRequest(false);setRejectionReason("");setRequestActionError(null);}}>Cancel</button><button type="button" className="danger" disabled={reviewingRequestId===selectedRequest.id||!rejectionReason.trim()} onClick={()=>void reviewInventoryRequest(selectedRequest,"reject")}>Confirm rejection</button></div></> : <div><button type="button" disabled={reviewingRequestId===selectedRequest.id} onClick={()=>void reviewInventoryRequest(selectedRequest,"accept")}>{reviewingRequestId===selectedRequest.id?"Saving...":"Approve Request"}</button><button type="button" className="danger" disabled={reviewingRequestId===selectedRequest.id} onClick={()=>setRejectingRequest(true)}>Reject</button></div>}</section>}
    </aside></div>}
    {selectedRequestId && !selectedRequest && !requestsLoading && <div className="moc-inspector-layer" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setSelectedRequestId(null);}}><aside className="moc-inspector moc-request-inspector" role="dialog" aria-modal="true" aria-label="Request details unavailable"><header><div><span>Kitchen Material Request</span><h2>Request details unavailable.</h2></div><button type="button" aria-label="Close request details" onClick={()=>setSelectedRequestId(null)}>×</button></header></aside></div>}

    {selectedTable && <div className="moc-inspector-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedTableId(null); }}><aside className="moc-inspector" role="dialog" aria-modal="true" aria-labelledby="location-inspector-title">
      <header><div><span>Service Location</span><h2 id="location-inspector-title">{selectedTable.label}</h2>{selectedTable.activeOrderId && selectedTable.sessionDurationMinutes != null && <time>{elapsed(selectedTable.sessionDurationMinutes)}</time>}</div><div className="moc-inspector-head-actions"><span className={`moc-location-state ${locationState(selectedTable)}`}><i />{stateLabel(selectedTable)}</span><button type="button" aria-label="Close service location inspector" onClick={() => setSelectedTableId(null)}>×</button></div></header>
      {selectedTable.activeOrderId ? <>
        <section><h3>Service</h3><dl><div><dt>Assigned Waiter</dt><dd className="moc-assigned-waiter"><span>{selectedTable.assignedWaiterName || "Unassigned"}</span><button type="button" onClick={() => setRequestedAssignmentTableId(selectedTable.id)}>{selectedTable.assignedWaiterName ? "Change" : "Assign"}</button></dd></div>{selectedTable.openedAt && <div><dt>Session started</dt><dd>{timeLabel(selectedTable.openedAt)}</dd></div>}</dl></section>
        <section><h3>Current Order</h3><div className="moc-order-items">{(showAllOrderItems ? selectedTable.orderItems : selectedTable.orderItems.slice(0, 3)).map((item) => <p key={item.id}><span>{item.name}</span><strong>×{item.quantity}</strong></p>)}{selectedTable.orderItems.length === 0 && <p className="moc-order-items-empty">No current items available.</p>}{selectedTable.orderItems.length > 3 && <button type="button" onClick={() => setShowAllOrderItems((visible) => !visible)}>{showAllOrderItems ? "Show fewer" : `+${selectedTable.orderItems.length - 3} more`}</button>}</div><dl className="moc-order-state"><div><dt>Kitchen</dt><dd>{selectedTable.kitchenStatus}</dd></div></dl></section>
        <section><h3>Payment</h3><dl className="moc-payment-state"><div><dt>Total</dt><dd>{formatCurrency(selectedTable.runningBill, currency)}</dd></div><div><dt>Paid</dt><dd>{formatCurrency(selectedTable.paidAmount, currency)}</dd></div><div><dt>Due</dt><dd>{formatCurrency(selectedTable.dueAmount, currency)}</dd></div><div><dt>Status</dt><dd>{paymentStatusLabel(selectedTable)}</dd></div></dl></section>
        {selectedTable.alerts.some((alert) => alert.type === "kitchen_delay") && <section className="moc-manager-attention"><h3>Manager Attention</h3><p>Kitchen delay requires intervention.</p><button type="button" onClick={() => navigateTo("/manager/kitchen", restaurantId)}>Open Kitchen</button></section>}
      </> : <><section><h3>Service</h3><dl><div><dt>Assigned Waiter</dt><dd className="moc-assigned-waiter"><span>{selectedTable.assignedWaiterName || "Unassigned"}</span><button type="button" onClick={() => setRequestedAssignmentTableId(selectedTable.id)}>{selectedTable.assignedWaiterName ? "Change" : "Assign"}</button></dd></div></dl></section><div className="moc-empty moc-inspector-empty"><strong>No active service session.</strong><span>This location is currently available.</span></div></>}
    </aside></div>}
    </>}
  </main>;
}

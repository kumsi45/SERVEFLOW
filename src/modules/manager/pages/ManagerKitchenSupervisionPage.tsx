import { useCallback, useEffect, useMemo, useState } from "react";
import { useTenantRealtime } from "../../../core/realtime/useTenantRealtime";
import {
  loadInventoryItems,
  loadInventoryRequests,
  inventoryRequestStatusLabel,
  materialRequestTypeLabel,
  processInventoryRequest,
  type InventoryItem,
  type InventoryRequest,
} from "../../kitchen/services/inventoryRequestService";
import { updateManagerStaff } from "../services/managerStaffOperationsService";
import {
  callAdditionalKitchenStaff,
  loadManagerKitchenSupervision,
  prioritizeManagerKitchenOrder,
  reassignManagerKitchenBatch,
  sendManagerKitchenMessage,
  setManagerKitchenStationPaused,
  type ManagerKitchenBatch,
  type ManagerKitchenStationSummary,
  type ManagerKitchenSupervisionSnapshot,
} from "../services/managerKitchenSupervisionService";
import { loadRestaurantAnalyticsTimezone } from "../services/managerOperationalReportsService";
import "../styles/managerKitchenSupervision.css";
import { managerFacingMessage } from "../managerPresentation";
import { withManagerDataTimeout } from "../services/managerDataCache";

type Props = { restaurantId: string; restaurantName: string; managerName: string };
type KitchenView = "overview" | "orders" | "performance";
type OrderFilter = "all" | "waiting" | "preparing" | "ready" | "delayed";

const DELAYED_WAITING_MINUTES = 20;
const DELAYED_PREPARING_MINUTES = 25;

function fmtMinutes(minutes: number | null) {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function minutesSince(value: string) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 0;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
}

function isDelayed(batch: ManagerKitchenBatch) {
  return batch.waitingMinutes >= DELAYED_WAITING_MINUTES || (batch.preparingMinutes ?? 0) >= DELAYED_PREPARING_MINUTES;
}

function batchAge(batch: ManagerKitchenBatch) {
  return batch.status === "preparing" ? batch.preparingMinutes ?? batch.waitingMinutes : batch.waitingMinutes;
}

function stationTone(station: ManagerKitchenStationSummary) {
  if (station.paused) return "paused" as const;
  if (station.queueLength > 0 && station.activeStaff === 0) return "critical" as const;
  if (station.delayed > 0) return "delayed" as const;
  if (station.currentWorkload === "overloaded" || station.currentWorkload === "busy") return "busy" as const;
  if (station.queueLength === 0) return "idle" as const;
  return "normal" as const;
}

function stationStatus(station: ManagerKitchenStationSummary) {
  const tone = stationTone(station);
  if (tone === "critical") return "Critical";
  if (tone === "delayed") return "Delayed";
  return tone.charAt(0).toUpperCase() + tone.slice(1);
}

function stationWorkloadLabel(station: ManagerKitchenStationSummary) {
  if (station.queueLength === 0) return "No active orders";
  return [
    station.waiting > 0 ? `${station.waiting} waiting` : null,
    station.preparing > 0 ? `${station.preparing} preparing` : null,
    station.ready > 0 ? `${station.ready} ready` : null,
    station.delayed > 0 ? `${station.delayed} delayed` : null,
  ].filter(Boolean).join(" · ");
}

function stationChefLabel(station: ManagerKitchenStationSummary) {
  const assigned = station.assignedStaffNames.length;
  if (assigned === 0) return "No Chefs assigned";
  return `${assigned} ${assigned === 1 ? "Chef" : "Chefs"}`;
}

function requestDateTime(value: string, timezone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  const dateLabel = new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", year: "numeric" }).format(date);
  const timeLabel = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(date);
  return `${dateLabel} · ${timeLabel}`;
}

function requestWaitingDuration(value: string) {
  const minutes = minutesSince(value);
  if (minutes < 1) return "Less than a minute";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function normalizeUnit(unit: string) {
  return unit.trim().toLocaleLowerCase();
}

function formatQuantity(quantity: number, unit: string) {
  const value = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(quantity);
  return `${value} ${normalizeUnit(unit)}`;
}

function inventoryDecision(request: InventoryRequest, item: InventoryItem) {
  const compatible = normalizeUnit(request.unit) === normalizeUnit(item.unit)
    && Number.isFinite(request.quantity)
    && Number.isFinite(item.currentQuantity);
  if (!compatible) return { afterFulfillment: null, shortBy: null };
  const difference = item.currentQuantity - request.quantity;
  return difference >= 0
    ? { afterFulfillment: difference, shortBy: null }
    : { afterFulfillment: null, shortBy: Math.abs(difference) };
}

function batchItems(batch: ManagerKitchenBatch, limit = 3) {
  const visible = batch.items.slice(0, limit).map((item) => `${item.name} ×${item.quantity}`);
  const remaining = batch.items.length - visible.length;
  return `${visible.join(" · ")}${remaining > 0 ? ` · +${remaining} more` : ""}`;
}

function serviceLocation(batch: ManagerKitchenBatch) {
  return batch.tableNumber ? `Table ${batch.tableNumber}` : batch.displayNumber;
}

function navigateToInventory(restaurantId: string) {
  window.sessionStorage.setItem("serveflow.active-restaurant:inventory", restaurantId);
  window.history.pushState({}, "", "/inventory/dashboard");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function ManagerKitchenSupervisionPage({ restaurantId }: Props) {
  const [snapshot, setSnapshot] = useState<ManagerKitchenSupervisionSnapshot | null>(null);
  const [requests, setRequests] = useState<InventoryRequest[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [operationsState, setOperationsState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [requestsState, setRequestsState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [inventoryState, setInventoryState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [restaurantTimezone, setRestaurantTimezone] = useState("Africa/Nairobi");
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<KitchenView>("overview");
  const [orderFilter, setOrderFilter] = useState<OrderFilter>("all");
  const [messageOpen, setMessageOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [staffingStationId, setStaffingStationId] = useState<string | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [reviewingRequestId, setReviewingRequestId] = useState<string | null>(null);
  const [rejectingRequest, setRejectingRequest] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextSnapshot, nextRequestsResult, nextInventoryResult, nextTimezone] = await withManagerDataTimeout(Promise.all([
        loadManagerKitchenSupervision(restaurantId),
        loadInventoryRequests(restaurantId)
          .then((items) => ({ items, available: true as const }))
          .catch(() => ({ items: [] as InventoryRequest[], available: false as const })),
        loadInventoryItems(restaurantId)
          .then((items) => ({ items, available: true as const }))
          .catch(() => ({ items: [] as InventoryItem[], available: false as const })),
        loadRestaurantAnalyticsTimezone(restaurantId).catch(() => "Africa/Nairobi"),
      ]));
      setSnapshot(nextSnapshot);
      setOperationsState("ready");
      setRequests(nextRequestsResult.items);
      setRequestsState(nextRequestsResult.available ? "ready" : "unavailable");
      setInventoryItems(nextInventoryResult.items);
      setInventoryState(nextInventoryResult.available ? "ready" : "unavailable");
      setRestaurantTimezone(nextTimezone);
      setError(null);
    } catch (loadError) {
      setOperationsState("unavailable");
      setError("Unable to load Kitchen operations.");
    }
  }, [restaurantId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setMessageOpen(false); setMessage(""); }, [selectedStationId]);

  useTenantRealtime({
    channelName: "manager-kitchen-supervision",
    restaurantId,
    tables: ["kitchen_stations", "orders", "order_items", "restaurant_staff", "staff_activity_log", "kitchen_inventory_requests", "inventory_items"],
    refresh,
    skipInitialConnectRefresh: true,
  });

  const stations = snapshot?.stations ?? [];
  const selectedStation = stations.find((station) => station.id === selectedStationId) ?? null;
  const staffingStation = stations.find((station) => station.id === staffingStationId) ?? null;
  const selectedRequest = requests.find((request) => request.id === selectedRequestId) ?? null;
  const selectedInventoryItem = selectedRequest?.inventoryItemId
    ? inventoryItems.find((item) => item.id === selectedRequest.inventoryItemId) ?? null
    : null;
  const selectedInventoryDecision = selectedRequest && selectedInventoryItem
    ? inventoryDecision(selectedRequest, selectedInventoryItem)
    : null;
  const kitchenStaff = snapshot?.kitchenStaff ?? [];
  const allBatches = useMemo(
    () => stations.flatMap((station) => station.activeBatches.map((batch) => ({ ...batch, stationName: station.name }))),
    [stations],
  );
  const sortedBatches = useMemo(
    () => [...allBatches].sort((left, right) => Number(isDelayed(right)) - Number(isDelayed(left)) || batchAge(right) - batchAge(left)),
    [allBatches],
  );
  const visibleOrders = sortedBatches.filter((batch) => orderFilter === "all" || (orderFilter === "delayed" ? isDelayed(batch) : batch.status === orderFilter));
  const pendingRequests = requests.filter((request) => request.status === "pending");
  const waiting = stations.reduce((sum, station) => sum + station.waiting, 0);
  const preparing = stations.reduce((sum, station) => sum + station.preparing, 0);
  const ready = stations.reduce((sum, station) => sum + station.ready, 0);
  const activeStaff = stations.reduce((sum, station) => sum + station.activeStaff, 0);
  const activeStations = stations.filter((station) => station.active && !station.paused).length;
  const staffedStations = stations.filter((station) => station.active && !station.paused && station.activeStaff > 0).length;

  const attentionStations = useMemo(() => {
    const priority = { no_cook: 0, overdue: 1, inactive: 2, overloaded: 3, queue: 4 } as const;
    const byStation = new Map<string, (ManagerKitchenSupervisionSnapshot["alerts"])[number]>();
    for (const alert of snapshot?.alerts ?? []) {
      const current = byStation.get(alert.stationId);
      if (!current || priority[alert.type] < priority[current.type]) byStation.set(alert.stationId, alert);
    }
    return Array.from(byStation.values());
  }, [snapshot]);
  const urgentRequests = pendingRequests.filter((request) => request.urgency === "critical" || request.urgency === "high");
  const regularPendingRequests = pendingRequests.filter((request) => request.urgency !== "critical" && request.urgency !== "high");
  const attentionCount = attentionStations.length + urgentRequests.length;

  async function runAction(action: () => Promise<void>, success: string) {
    try {
      setError(null); setNotice(null);
      await action();
      setNotice(success);
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Kitchen supervision action failed.");
    }
  }

  function openStation(stationId: string) {
    setSelectedStationId(stationId);
    setMessageOpen(false);
  }

  function openRequest(requestId: string) {
    setSelectedStationId(null);
    setStaffingStationId(null);
    setSelectedRequestId(requestId);
    setRejectingRequest(false);
    setRejectionReason("");
  }

  async function reviewRequest(request: InventoryRequest, action: "accept" | "reject") {
    const reason = rejectionReason.trim();
    if (action === "reject" && !reason) {
      setError("Rejection reason is required.");
      return;
    }
    try {
      setError(null);
      setNotice(null);
      setReviewingRequestId(request.id);
      await processInventoryRequest(restaurantId, request.id, action, action === "reject" ? reason : undefined);
      setNotice(action === "accept" ? "Request approved. Awaiting Inventory." : "Kitchen request rejected.");
      setRejectingRequest(false);
      setRejectionReason("");
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Kitchen request review failed.");
      await refresh();
    } finally {
      setReviewingRequestId(null);
    }
  }

  function pauseStation(station: ManagerKitchenStationSummary) {
    if (!window.confirm(`Pause ${station.name}? This records an operational pause and prevents manager reassignment to this station until it is resumed.`)) return;
    void runAction(() => setManagerKitchenStationPaused(restaurantId, station.id, true, "Manager pause"), "Station paused.");
  }

  function assignKitchenStaff(staffId: string) {
    if (!staffingStation) return;
    const member = kitchenStaff.find((candidate) => candidate.id === staffId);
    if (!member) return;
    const currentStation = stations.find((station) => station.id === member.assignedStationId);
    if (member.assignedStationId && member.assignedStationId !== staffingStation.id && !window.confirm(`Move ${member.name} to ${staffingStation.name}?\n\nCurrent station: ${currentStation?.name || "Another station"}\nNew station: ${staffingStation.name}\n\nExisting kitchen tickets and order state will remain unchanged.`)) return;
    void runAction(async () => {
      await updateManagerStaff(restaurantId, member.id, { assignedKitchenStationId: staffingStation.id });
      setStaffingStationId(null);
    }, member.assignedStationId ? "Chef moved to station." : "Chef assigned to station.");
  }

  function renderOrderRow(batch: ManagerKitchenBatch & { stationName: string }, compact = false) {
    return <button className={`mks-order-row ${isDelayed(batch) ? "delayed" : ""}`} key={`${batch.stationId}:${batch.orderId}`} type="button" onClick={() => openStation(batch.stationId)}>
      <span className="mks-order-location"><strong>{serviceLocation(batch)}</strong><small>{batch.displayNumber}</small></span>
      <span className="mks-order-items"><strong>{batch.itemCount} item{batch.itemCount === 1 ? "" : "s"}</strong>{!compact && <small>{batchItems(batch)}</small>}</span>
      <span><strong>{batch.stationName}</strong><small>Station</small></span>
      <span className={`mks-order-status ${batch.status}`}><strong>{batch.status}</strong><small>{fmtMinutes(batchAge(batch))}</small></span>
      <b aria-hidden="true">›</b>
    </button>;
  }

  if (operationsState === "loading" && !snapshot) return <main className="mks-page"><div className="mks-message" role="status">Loading Kitchen operations...</div></main>;
  if (operationsState === "unavailable") return <main className="mks-page"><div className="mks-message error" role="alert">Unable to load Kitchen operations.</div></main>;

  return <main className="mks-page">
    <nav className="mks-nav" aria-label="Manager Kitchen sections">
      {(["overview", "orders", "performance"] as const).map((view) => <button key={view} type="button" className={activeView === view ? "active" : ""} onClick={() => setActiveView(view)}>{view.charAt(0).toUpperCase() + view.slice(1)}</button>)}
    </nav>

    {(notice || error) && <div className={`mks-message ${error ? "error" : ""}`} role={error ? "alert" : "status"}>{error ? managerFacingMessage(error, "Unable to complete the Kitchen action. Try again.") : notice}</div>}
    {requestsState === "unavailable" && <div className="mks-message error" role="alert">Kitchen requests unavailable.</div>}

    {activeView === "overview" && <>
      <section className="mks-summary" aria-label="Kitchen command summary">
        <article><span>Waiting</span><strong>{waiting}</strong></article>
        <article><span>Preparing</span><strong>{preparing}</strong></article>
        <article className={snapshot?.delayedOrders ? "attention" : ""}><span>Delayed</span><strong>{snapshot?.delayedOrders ?? 0}</strong></article>
        <article><span>Ready</span><strong>{ready}</strong></article>
        <article><span>Avg prep</span><strong>{fmtMinutes(snapshot?.performance.averageTicketMinutes ?? 0)}</strong></article>
        <article><span>Active chefs</span><strong>{activeStaff}</strong></article>
        <article><span>Station coverage</span><strong>{staffedStations}/{activeStations} with chefs</strong></article>
      </section>

      <section className="mks-panel mks-attention" aria-labelledby="mks-attention-title">
        <header><div><h2 id="mks-attention-title">Needs Attention <b>{attentionCount}</b></h2></div></header>
        <div className="mks-attention-list">
          {attentionStations.map((alert) => {
            const station = stations.find((candidate) => candidate.id === alert.stationId);
            const oldest = station?.activeBatches.reduce((age, batch) => Math.max(age, batchAge(batch)), 0) ?? 0;
            return <button key={alert.id} type="button" className={alert.severity} onClick={() => openStation(alert.stationId)}><i /><span><strong>{alert.stationName}</strong><small>{alert.message}{oldest > 0 ? ` · oldest ${fmtMinutes(oldest)}` : ""}{station ? ` · chefs ${station.activeStaff}` : ""}</small></span><b>View ›</b></button>;
          })}
          {urgentRequests.map((request) => <button key={request.id} type="button" className={request.urgency === "critical" ? "critical" : "warning"} onClick={() => openRequest(request.id)}><i /><span><strong>{request.stationName || "Kitchen"}</strong><small>{materialRequestTypeLabel(request.requestType)} · {request.itemName} · {fmtMinutes(minutesSince(request.requestedAt))}</small></span><b>Review ›</b></button>)}
          {attentionCount === 0 && <p className="mks-calm">✓ Kitchen operating normally — no manager intervention required.</p>}
        </div>
      </section>

      <section className="mks-panel" aria-labelledby="mks-stations-title">
        <header><div><h2 id="mks-stations-title">Stations</h2></div></header>
        <div className="mks-station-list">
          {stations.map((station) => <button key={station.id} type="button" className={`mks-station-row ${stationTone(station)}`} onClick={() => openStation(station.id)}>
            <span className="mks-station-name"><strong>{station.name}</strong>{stationTone(station) !== "idle" && <em>{stationStatus(station)}</em>}</span>
            <span className="mks-station-load">{stationWorkloadLabel(station)}</span>
            <span className="mks-station-meta">{stationChefLabel(station)}</span>
            <b aria-hidden="true">›</b>
          </button>)}
          {stations.length === 0 && <p className="mks-empty">No kitchen stations configured.</p>}
        </div>
      </section>

      {regularPendingRequests.length > 0 && <section className="mks-panel" aria-labelledby="mks-requests-title">
        <header><div><span>Inventory handoff</span><h2 id="mks-requests-title">Kitchen Requests <b>{regularPendingRequests.length}</b></h2></div></header>
        <div className="mks-request-list">{regularPendingRequests.slice(0, 6).map((request) => <button key={request.id} type="button" onClick={() => openRequest(request.id)}><span><strong>{request.itemName}</strong><small>{request.stationName || "Kitchen"} · {inventoryRequestStatusLabel(request.status)}</small></span><em className={request.urgency}>{request.urgency}</em><time>{fmtMinutes(minutesSince(request.requestedAt))}</time><b>Review ›</b></button>)}</div>
      </section>}

      <section className="mks-panel" aria-labelledby="mks-current-orders-title">
        <header><div><h2 id="mks-current-orders-title">Current Orders</h2></div>{allBatches.length > 5 && <button type="button" onClick={() => setActiveView("orders")}>View all →</button>}</header>
        <div className="mks-order-list">{sortedBatches.slice(0, 5).map((batch) => renderOrderRow(batch, true))}{sortedBatches.length === 0 && <p className="mks-empty">✓ No active tickets</p>}</div>
      </section>
    </>}

    {activeView === "orders" && <section className="mks-panel mks-orders-view" aria-labelledby="mks-orders-title">
      <header><div><h2 id="mks-orders-title">Current Orders <b>{visibleOrders.length}</b></h2></div></header>
      <div className="mks-order-filters" aria-label="Filter kitchen orders">{(["all", "waiting", "preparing", "ready", "delayed"] as const).map((filter) => <button key={filter} type="button" className={orderFilter === filter ? "active" : ""} onClick={() => setOrderFilter(filter)}>{filter.charAt(0).toUpperCase() + filter.slice(1)}</button>)}</div>
      <div className="mks-order-list">{visibleOrders.map((batch) => renderOrderRow(batch))}{visibleOrders.length === 0 && <p className="mks-empty">✓ No active tickets in this filter</p>}</div>
    </section>}

    {activeView === "performance" && <>
      <section className="mks-summary mks-performance-summary" aria-label="Current kitchen performance">
        <article><span>Current workload</span><strong>{snapshot?.performance.currentWorkload ?? "idle"}</strong></article>
        <article><span>Avg prep</span><strong>{fmtMinutes(snapshot?.performance.averageTicketMinutes ?? 0)}</strong></article>
        <article className={snapshot?.performance.delayedTickets ? "attention" : ""}><span>Delayed</span><strong>{snapshot?.performance.delayedTickets ?? 0}</strong></article>
        <article><span>Rush</span><strong>{snapshot?.performance.rushIndicator ? "Yes" : "No"}</strong></article>
        <article><span>Bottleneck</span><strong>{snapshot?.performance.bottleneckIndicator ? "Yes" : "No"}</strong></article>
      </section>
      <section className="mks-panel" aria-labelledby="mks-station-performance-title"><header><div><h2 id="mks-station-performance-title">Station Performance</h2></div></header><div className="mks-performance-list">{stations.map((station) => <button type="button" key={station.id} onClick={() => openStation(station.id)}><span><strong>{station.name}</strong><small>{stationStatus(station)}</small></span><span><small>Active load</small><strong>{station.queueLength}</strong></span><span><small>Avg prep</small><strong>{fmtMinutes(station.averagePreparationMinutes)}</strong></span><span><small>Delayed</small><strong>{station.delayed}</strong></span><b>›</b></button>)}</div></section>
    </>}

    {selectedRequest && <div className="mks-inspector-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedRequestId(null); }}><aside className="mks-inspector mks-request-inspector" role="dialog" aria-modal="true" aria-labelledby="mks-request-title">
      <header><div><span>Kitchen Material Request</span><h2 id="mks-request-title">{selectedRequest.itemName}</h2></div><div><em className={`mks-request-status ${selectedRequest.status}`}>{inventoryRequestStatusLabel(selectedRequest.status)}</em><button type="button" aria-label="Close kitchen request" onClick={() => setSelectedRequestId(null)}>×</button></div></header>
      <section><h3>Request details</h3><dl>
        <div><dt>Request type</dt><dd>{materialRequestTypeLabel(selectedRequest.requestType)}</dd></div>
        <div><dt>Requested item</dt><dd>{selectedRequest.itemName}</dd></div>
        <div><dt>Quantity</dt><dd>{formatQuantity(selectedRequest.quantity, selectedRequest.unit)}</dd></div>
        <div><dt>Station</dt><dd>{selectedRequest.stationName || "Kitchen — station not recorded"}</dd></div>
        <div><dt>Requested by</dt><dd>{selectedRequest.requesterName || "Chef not recorded"}</dd></div>
        <div><dt>Priority</dt><dd>{selectedRequest.urgency}</dd></div>
        <div><dt>Requested</dt><dd>{requestDateTime(selectedRequest.requestedAt, restaurantTimezone)}</dd></div>
        <div><dt>Waiting</dt><dd>{requestWaitingDuration(selectedRequest.requestedAt)}</dd></div>
      </dl></section>
      <section className="mks-request-reason-section"><h3>Request reason</h3><p className={`mks-request-reason ${selectedRequest.comment ? "" : "empty"}`}>{selectedRequest.comment || "Not provided"}</p></section>
      <section className="mks-request-inventory"><h3>Inventory</h3>
        {inventoryState === "loading" && <p className="mks-inventory-unavailable">Checking current inventory…</p>}
        {inventoryState === "unavailable" && <p className="mks-inventory-unavailable">Current inventory is unavailable.</p>}
        {inventoryState === "ready" && !selectedRequest.inventoryItemId && <p className="mks-inventory-unavailable">No inventory item is linked to this request.</p>}
        {inventoryState === "ready" && selectedRequest.inventoryItemId && !selectedInventoryItem && <p className="mks-inventory-unavailable">The linked inventory item is unavailable.</p>}
        {selectedInventoryItem && <dl>
          <div><dt>Available</dt><dd>{formatQuantity(selectedInventoryItem.currentQuantity, selectedInventoryItem.unit)}</dd></div>
          <div><dt>Requested</dt><dd>{formatQuantity(selectedRequest.quantity, selectedRequest.unit)}</dd></div>
          {selectedInventoryDecision?.afterFulfillment != null && <div className="positive"><dt>After fulfillment</dt><dd>{formatQuantity(selectedInventoryDecision.afterFulfillment, selectedInventoryItem.unit)}</dd></div>}
          {selectedInventoryDecision?.shortBy != null && <div className="short"><dt>Short by</dt><dd>{formatQuantity(selectedInventoryDecision.shortBy, selectedInventoryItem.unit)}</dd></div>}
          {selectedInventoryDecision?.afterFulfillment == null && selectedInventoryDecision?.shortBy == null && <div className="incompatible"><dt>Availability check</dt><dd>Units differ</dd></div>}
          <div><dt>Reorder level</dt><dd>{formatQuantity(selectedInventoryItem.reorderLevel, selectedInventoryItem.unit)}</dd></div>
        </dl>}
      </section>
      {selectedRequest.status === "accepted" && <section className="mks-request-outcome"><h3>Awaiting Inventory</h3><p>Inventory has not issued this request yet.</p><dl>{selectedRequest.reviewerName && <div><dt>Approved by</dt><dd>{selectedRequest.reviewerName}</dd></div>}{selectedRequest.acceptedAt && <div><dt>Approved at</dt><dd>{requestDateTime(selectedRequest.acceptedAt, restaurantTimezone)}</dd></div>}</dl></section>}
      {selectedRequest.status === "issued" && <section className="mks-request-outcome issued"><h3>Issued · Awaiting Kitchen Confirmation</h3><p>Waiting for Kitchen to confirm receipt.</p><dl>{selectedRequest.issuedQuantity != null && <div><dt>Issued quantity</dt><dd>{formatQuantity(selectedRequest.issuedQuantity, selectedRequest.unit)}</dd></div>}{selectedRequest.issuerName && <div><dt>Issued by</dt><dd>{selectedRequest.issuerName}</dd></div>}{selectedRequest.issuedAt && <div><dt>Issued at</dt><dd>{requestDateTime(selectedRequest.issuedAt, restaurantTimezone)}</dd></div>}</dl></section>}
      {selectedRequest.status === "delivered" && <section className="mks-request-outcome"><h3>Fulfilled</h3><p>Received by Kitchen.</p><dl>{selectedRequest.confirmerName && <div><dt>Confirmed by</dt><dd>{selectedRequest.confirmerName}</dd></div>}{selectedRequest.confirmedAt && <div><dt>Confirmed at</dt><dd>{requestDateTime(selectedRequest.confirmedAt, restaurantTimezone)}</dd></div>}</dl></section>}
      {selectedRequest.status === "unable_to_fulfill" && <section className="mks-request-outcome unable"><h3>Unable to Fulfill</h3><p>{selectedRequest.unableToFulfillReason || "Reason not recorded."}</p><dl>{selectedRequest.unableToFulfillByName && <div><dt>Inventory Officer</dt><dd>{selectedRequest.unableToFulfillByName}</dd></div>}{selectedRequest.unableToFulfillAt && <div><dt>Recorded at</dt><dd>{requestDateTime(selectedRequest.unableToFulfillAt, restaurantTimezone)}</dd></div>}</dl></section>}
      {selectedRequest.status === "rejected" && <section className="mks-request-outcome rejected"><h3>Rejected</h3><p>{selectedRequest.rejectionReason || "Rejection reason not recorded."}</p><dl>{selectedRequest.reviewerName && <div><dt>Rejected by</dt><dd>{selectedRequest.reviewerName}</dd></div>}{selectedRequest.rejectedAt && <div><dt>Rejected at</dt><dd>{requestDateTime(selectedRequest.rejectedAt, restaurantTimezone)}</dd></div>}</dl></section>}
      {selectedRequest.status === "pending" ? <section className="mks-request-decision"><h3>Manager decision</h3>{rejectingRequest ? <><label>Rejection reason<textarea value={rejectionReason} maxLength={500} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Explain why this request is being rejected..." /></label><div className="mks-request-actions"><button type="button" className="secondary" onClick={() => navigateToInventory(restaurantId)}>Open Inventory</button><button type="button" className="secondary" disabled={reviewingRequestId === selectedRequest.id} onClick={() => { setRejectingRequest(false); setRejectionReason(""); }}>Cancel</button><button type="button" className="danger" disabled={reviewingRequestId === selectedRequest.id || !rejectionReason.trim()} onClick={() => void reviewRequest(selectedRequest, "reject")}>{reviewingRequestId === selectedRequest.id ? "Saving..." : "Confirm rejection"}</button></div></> : <div className="mks-request-actions"><button type="button" className="secondary" onClick={() => navigateToInventory(restaurantId)}>Open Inventory</button><button type="button" className="danger" disabled={reviewingRequestId === selectedRequest.id} onClick={() => setRejectingRequest(true)}>Reject</button><button type="button" className="primary" disabled={reviewingRequestId === selectedRequest.id} onClick={() => void reviewRequest(selectedRequest, "accept")}>{reviewingRequestId === selectedRequest.id ? "Saving..." : "Approve Request"}</button></div>}</section> : <section className="mks-request-navigation"><button type="button" className="secondary" onClick={() => navigateToInventory(restaurantId)}>Open Inventory</button></section>}
    </aside></div>}

    {selectedStation && <div className="mks-inspector-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedStationId(null); }}><aside className="mks-inspector" role="dialog" aria-modal="true" aria-labelledby="mks-inspector-title">
      <header><div><span>Kitchen Station</span><h2 id="mks-inspector-title">{selectedStation.name}</h2></div><div><em className={stationTone(selectedStation)}>{stationStatus(selectedStation)}</em><button type="button" aria-label="Close station inspector" onClick={() => setSelectedStationId(null)}>×</button></div></header>
      <section><h3>Current Load</h3><dl><div><dt>Waiting</dt><dd>{selectedStation.waiting}</dd></div><div><dt>Preparing</dt><dd>{selectedStation.preparing}</dd></div><div><dt>Ready</dt><dd>{selectedStation.ready}</dd></div><div><dt>Delayed</dt><dd>{selectedStation.delayed}</dd></div><div><dt>Average prep</dt><dd>{fmtMinutes(selectedStation.averagePreparationMinutes)}</dd></div><div><dt>Active chefs</dt><dd>{selectedStation.activeStaff}</dd></div></dl></section>
      {selectedStation.delayed > 0 && <section><h3>Delayed Orders</h3><div className="mks-inspector-orders">{selectedStation.activeBatches.filter(isDelayed).map((batch) => <article key={batch.orderId}><div><strong>{serviceLocation(batch)}</strong><span>{batchItems(batch)}</span></div><dl><div><dt>Current stage</dt><dd>{batch.status}</dd></div><div><dt>Elapsed</dt><dd>{fmtMinutes(batchAge(batch))}</dd></div></dl>{batch.canManage && <div className="mks-ticket-actions"><button type="button" onClick={() => void runAction(() => prioritizeManagerKitchenOrder(restaurantId, batch.orderId), "Ticket prioritized.")}>Prioritize</button><select defaultValue="" aria-label={`Reassign ${batch.displayNumber}`} onChange={(event) => { const destinationId = event.target.value; if (destinationId) void runAction(() => reassignManagerKitchenBatch(restaurantId, batch.orderId, batch.stationId, destinationId), "Ticket reassigned."); event.currentTarget.value = ""; }}><option value="">Reassign…</option>{stations.filter((station) => station.id !== batch.stationId && station.active && !station.paused).map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}</select></div>}</article>)}</div></section>}
      <section><div className="mks-staff-heading"><h3>Chefs</h3><button type="button" onClick={() => setStaffingStationId(selectedStation.id)}>Manage Chefs</button></div>{selectedStation.assignedStaffNames.length > 0 ? <><p className="mks-inspector-note">Assigned</p><ul>{selectedStation.assignedStaffNames.map((name) => <li key={name}>{name}</li>)}</ul>{selectedStation.activeStaff === 0 && <p className="mks-inspector-note">No assigned chefs are currently active at this station.</p>}</> : <p className="mks-inspector-note">No chefs assigned to this station.</p>}</section>
      {(selectedStation.delayed > 0 || (selectedStation.queueLength > 0 && selectedStation.activeStaff === 0) || selectedStation.paused) && <section className="mks-manager-attention"><h3>Manager Attention</h3><p>{selectedStation.paused ? "Station is paused." : selectedStation.queueLength > 0 && selectedStation.activeStaff === 0 ? "Active workload has no chef on session." : "Preparation time exceeds the delay threshold."}</p>{selectedStation.queueLength > 0 && selectedStation.activeStaff === 0 && <button type="button" onClick={() => void runAction(() => callAdditionalKitchenStaff(restaurantId, selectedStation.id, `Additional chef requested for ${selectedStation.name}`), "Additional chef called.")}>Call Chef</button>}{selectedStation.paused && <button type="button" onClick={() => void runAction(() => setManagerKitchenStationPaused(restaurantId, selectedStation.id, false), "Station resumed.")}>Resume Station</button>}</section>}
      <details className="mks-station-actions"><summary>••• Station Actions</summary><div>{!selectedStation.paused && <button type="button" onClick={() => pauseStation(selectedStation)}>Pause Station</button>}<button type="button" onClick={() => setMessageOpen((open) => !open)}>Send Message</button></div></details>
      {messageOpen && <form className="mks-context-message" onSubmit={(event) => { event.preventDefault(); const trimmed = message.trim(); if (!trimmed) return; void runAction(async () => { await sendManagerKitchenMessage(restaurantId, selectedStation.id, trimmed); setMessage(""); setMessageOpen(false); }, "Message sent to kitchen."); }}><label>Message {selectedStation.name}<textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={3} /></label><button type="submit">Send Message</button></form>}
    </aside></div>}

    {staffingStation && <div className="mks-staffing-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setStaffingStationId(null); }}><section className="mks-staffing-dialog" role="dialog" aria-modal="true" aria-labelledby="mks-staffing-title">
      <header><div><span>Station Chefs</span><h2 id="mks-staffing-title">{staffingStation.name}</h2><p>Current chefs: {staffingStation.assignedStaffNames.join(" · ") || "None"}</p></div><button type="button" aria-label="Close station chefs" onClick={() => setStaffingStationId(null)}>×</button></header>
      <div className="mks-kitchen-staff-list">{kitchenStaff.map((member) => { const currentStation = stations.find((station) => station.id === member.assignedStationId); const assignedHere = member.assignedStationId === staffingStation.id; const status = member.breakStatus === "on_break" ? "On break" : member.online ? "On shift" : "Offline"; return <article key={member.id}><span><strong>{member.name}</strong><small>Chef · {member.employeeId} · {currentStation?.name || "No station"}</small></span><em className={status.toLowerCase().replace(" ", "-")}>{status}</em><button type="button" disabled={assignedHere} onClick={() => assignKitchenStaff(member.id)}>{assignedHere ? "Assigned" : currentStation ? "Move here" : "Assign"}</button></article>; })}{kitchenStaff.length === 0 && <p className="mks-empty">No eligible chefs available.</p>}</div>
      <footer><button type="button" onClick={() => setStaffingStationId(null)}>Close</button></footer>
    </section></div>}
  </main>;
}

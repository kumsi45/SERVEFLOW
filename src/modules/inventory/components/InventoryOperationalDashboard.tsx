import { useMemo, useState } from "react";
import {
  partitionInventoryKitchenRequests,
  type InventoryKitchenQueueRequest,
} from "../services/inventoryKitchenRequestService";
import type { InventoryCurrentStockRow, InventoryLedgerEntry, InventorySection } from "../types";

type RequestTab = "accepted" | "issued" | "history";
type RequestAction = { kind: "issue" | "unable"; request: InventoryKitchenQueueRequest } | null;

type Props = {
  requests: InventoryKitchenQueueRequest[];
  requestsLoading: boolean;
  requestsError: string | null;
  insightsError: string | null;
  canProcessRequests: boolean;
  outOfStockCount: number;
  lowStockCount: number;
  pendingPurchaseCount: number;
  totalActiveIngredients: number;
  inventoryValue: number;
  currentStock: InventoryCurrentStockRow[];
  requestStorageLocations: Record<string, string>;
  recentLedger: InventoryLedgerEntry[];
  staffRoles: Record<string, string>;
  working: boolean;
  onNavigate: (section: InventorySection) => void;
  onIssue: (request: InventoryKitchenQueueRequest) => Promise<boolean>;
  onUnable: (request: InventoryKitchenQueueRequest, reason: string) => Promise<boolean>;
};

export const formatInventoryQuantity = (value: number, unit: string) => {
  if (!Number.isFinite(value)) return "Not available";
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
  const normalizedUnit = unit.trim();
  return normalizedUnit ? `${formatted} ${normalizedUnit}` : formatted;
};
const quantityLabel = formatInventoryQuantity;
const moneyLabel = (value: number) => new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const dateTimeLabel = (value: string | null) => value ? new Intl.DateTimeFormat(undefined, {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
}).format(new Date(value)) : "Not recorded";
const movementLabel = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (character: string) => character.toUpperCase());

export function InventoryOperationalDashboard({
  requests,
  requestsLoading,
  requestsError,
  insightsError,
  canProcessRequests,
  outOfStockCount,
  lowStockCount,
  pendingPurchaseCount,
  totalActiveIngredients,
  inventoryValue,
  currentStock,
  requestStorageLocations,
  recentLedger,
  staffRoles,
  working,
  onNavigate,
  onIssue,
  onUnable,
}: Props) {
  const [tab, setTab] = useState<RequestTab>("accepted");
  const [action, setAction] = useState<RequestAction>(null);
  const [unableReason, setUnableReason] = useState("");
  const groupedRequests = useMemo(() => partitionInventoryKitchenRequests(requests), [requests]);
  const accepted = groupedRequests.awaitingInventory;
  const issued = groupedRequests.awaitingKitchen;
  const history = groupedRequests.history.slice(0, 10);
  const visibleRequests = tab === "accepted" ? accepted : tab === "issued" ? issued : history;
  const actionableCount = accepted.length + issued.length + outOfStockCount + lowStockCount + pendingPurchaseCount;
  const issueAvailable = action?.kind === "issue" ? action.request.currentQuantity : null;
  const issueHasUnit = action?.kind === "issue" && Boolean(action.request.unit.trim());
  const issueCanProceed = action?.kind === "issue"
    && issueAvailable !== null
    && Number.isFinite(issueAvailable)
    && Number.isFinite(action.request.quantity)
    && issueAvailable >= action.request.quantity
    && issueHasUnit;
  const remainingAfterIssue = issueCanProceed ? issueAvailable - action.request.quantity : null;

  const stockFor = (request: InventoryKitchenQueueRequest) => currentStock.find((row) => (
    row.inventoryItemId === request.inventoryItemId
  ));

  async function confirmAction() {
    if (!action) return;
    if (action.kind === "issue" && !issueCanProceed) return;
    const succeeded = action.kind === "issue"
      ? await onIssue(action.request)
      : await onUnable(action.request, unableReason);
    if (succeeded) {
      setAction(null);
      setUnableReason("");
      if (action.kind === "issue") setTab("issued");
      else setTab("history");
    }
  }

  return (
    <div className="ia-stack ia-i1-dashboard">
      <section className="ia-i1-section" aria-labelledby="i1-attention-title">
        <div className="ia-i1-title"><div><span>OPERATIONS</span><h2 id="i1-attention-title">Needs Attention</h2></div></div>
        {actionableCount === 0 && !requestsLoading && !requestsError && !insightsError ? (
          <div className="ia-i1-zero"><strong>Everything is under control</strong><span>No inventory actions currently require attention.</span></div>
        ) : actionableCount === 0 ? (
          <div className="ia-i1-partial" role="status"><strong>Some operational checks are unavailable</strong><span>{requestsLoading ? "Kitchen requests are loading." : requestsError ? "Kitchen request status could not be confirmed." : "Purchasing activity could not be confirmed."}</span></div>
        ) : (
          <div className="ia-i1-attention-grid">
            {accepted.length > 0 && <button type="button" onClick={() => setTab("accepted")}><strong>{accepted.length}</strong><span>Kitchen Requests</span><small>Awaiting Inventory action</small></button>}
            {issued.length > 0 && <button type="button" onClick={() => setTab("issued")}><strong>{issued.length}</strong><span>Awaiting Kitchen Confirmation</span><small>Already deducted from stock</small></button>}
            {outOfStockCount > 0 && <button className="critical" type="button" onClick={() => onNavigate("low-stock-assistant")}><strong>{outOfStockCount}</strong><span>Out of Stock</span><small>Review critical items</small></button>}
            {lowStockCount > 0 && <button className="warning" type="button" onClick={() => onNavigate("low-stock-assistant")}><strong>{lowStockCount}</strong><span>Low Stock</span><small>Review replenishment</small></button>}
            {pendingPurchaseCount > 0 && <button type="button" onClick={() => onNavigate("purchase-orders")}><strong>{pendingPurchaseCount}</strong><span>Pending Purchases</span><small>Open purchase workflow</small></button>}
          </div>
        )}
      </section>

      <section className="ia-i1-section ia-i1-requests" aria-labelledby="i1-requests-title">
        <div className="ia-i1-title"><div><span>KITCHEN HANDOFF</span><h2 id="i1-requests-title">Kitchen Requests</h2></div></div>
        <div className="ia-i1-tabs" role="tablist" aria-label="Kitchen request status">
          <button type="button" role="tab" aria-selected={tab === "accepted"} onClick={() => setTab("accepted")}>Awaiting Inventory <span>{accepted.length}</span></button>
          <button type="button" role="tab" aria-selected={tab === "issued"} onClick={() => setTab("issued")}>Awaiting Kitchen <span>{issued.length}</span></button>
          <button type="button" role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>History</button>
        </div>
        {requestsError && <div className="ia-i1-request-error" role="alert"><strong>Kitchen requests unavailable.</strong><span>{requestsError}</span></div>}
        {!requestsError && requestsLoading && <p className="ia-i1-empty">Loading Kitchen requests...</p>}
        {!requestsError && !requestsLoading && visibleRequests.length === 0 && <p className="ia-i1-empty">{tab === "accepted" ? "No approved Kitchen requests are waiting for Inventory." : tab === "issued" ? "No issued requests are waiting for Kitchen confirmation." : "No recent Kitchen request history."}</p>}
        {!requestsError && !requestsLoading && visibleRequests.length > 0 && (
          <div className="ia-i1-request-list">
            {visibleRequests.map((request) => {
              const stock = stockFor(request);
              const available = request.currentQuantity ?? stock?.currentQuantity ?? null;
              const hasUsableUnit = Boolean(request.unit.trim());
              const insufficient = request.status === "accepted" && available !== null && available < request.quantity;
              const unavailable = request.status === "accepted" && (available === null || !hasUsableUnit);
              const canIssue = canProcessRequests && request.status === "accepted" && !insufficient && !unavailable;
              const cardState = insufficient ? "insufficient" : unavailable ? "unavailable" : request.urgency === "high" || request.urgency === "critical" ? "priority" : "normal";
              const showHistoryStatus = request.status === "delivered" || request.status === "unable_to_fulfill" || request.status === "rejected";
              return <article key={request.id} className={`ia-i1-request-card ${cardState}`}>
                <header><div className="ia-i1-request-primary"><strong>{request.itemName || "Unnamed inventory item"}</strong><b>{quantityLabel(request.quantity, request.unit)}</b></div>{showHistoryStatus && <span className={`ia-i1-status ${request.status}`}>{request.status === "delivered" ? "Received by Kitchen" : request.status === "unable_to_fulfill" ? "Unable to Fulfill" : "Rejected"}</span>}{!showHistoryStatus && cardState === "priority" && <span className="ia-i1-priority">{request.urgency === "critical" ? "Critical" : "High"} priority</span>}</header>
                <strong className="ia-i1-station">{request.stationName ?? "Kitchen"}</strong>
                <div className="ia-i1-request-meta"><span>Requested by {request.requesterName ?? "Chef"}</span><time dateTime={request.requestedAt}>{dateTimeLabel(request.requestedAt)}</time></div>
                {request.status === "accepted" && <div className="ia-i1-request-meta"><span>Approved by {request.reviewerName ?? "Manager"}</span><time dateTime={request.acceptedAt ?? undefined}>{dateTimeLabel(request.acceptedAt)}</time></div>}
                {request.status === "issued" && <div className="ia-i1-request-meta"><span>Issued by {request.issuerName ?? request.fulfillerName ?? "Inventory"}</span><time dateTime={request.issuedAt ?? undefined}>{dateTimeLabel(request.issuedAt)}</time></div>}
                {request.status === "accepted" && <div className={`ia-i1-availability ${insufficient ? "insufficient" : unavailable ? "unavailable" : "available"}`}><span>Available</span><strong>{available === null || !hasUsableUnit ? "Not available" : quantityLabel(available, request.unit)}</strong>{insufficient && <small>Insufficient stock</small>}</div>}
                {request.status === "issued" && <div className="ia-i1-availability issued"><span>Issued</span><strong>{quantityLabel(request.issuedQuantity ?? request.quantity, request.unit)}</strong></div>}
                {(request.comment || request.unableToFulfillReason) && <details className="ia-i1-card-details"><summary>Details</summary><p>{request.unableToFulfillReason ?? request.comment}</p></details>}
                {request.status === "issued" && <p className="ia-i1-waiting">Waiting for Kitchen confirmation. Inventory stock was already deducted.</p>}
                {request.status === "accepted" && canProcessRequests && <footer><button type="button" disabled={!canIssue} title={!canIssue ? insufficient ? "There is not enough stock to issue this request." : "Available stock could not be confirmed." : undefined} onClick={() => canIssue && setAction({ kind: "issue", request })}>Issue</button><button className="secondary" type="button" onClick={() => { setUnableReason(""); setAction({ kind: "unable", request }); }}>Cannot Fulfill</button></footer>}
              </article>;
            })}
          </div>
        )}
      </section>

      <section className="ia-i1-section" aria-labelledby="i1-operations-title">
        <div className="ia-i1-title"><div><span>SHIFT WORK</span><h2 id="i1-operations-title">Quick Operations</h2></div></div>
        <div className="ia-i1-quick-grid">
          <button type="button" onClick={() => onNavigate("stock-in")}><span>+</span><strong>Receive Stock</strong></button>
          <button type="button" onClick={() => onNavigate("stock-out")}><span>−</span><strong>Stock Out / Issue Stock</strong></button>
          <button type="button" onClick={() => onNavigate("adjustments")}><span>±</span><strong>Adjustment</strong></button>
          <button type="button" onClick={() => onNavigate("transfers")}><span>⇄</span><strong>Transfer</strong></button>
          <button type="button" onClick={() => onNavigate("waste")}><span>!</span><strong>Waste</strong></button>
          <button type="button" onClick={() => onNavigate("purchase-orders")}><span>PO</span><strong>Purchase Order</strong></button>
        </div>
      </section>

      <section className="ia-i1-section" aria-labelledby="i1-snapshot-title">
        <div className="ia-i1-title"><div><span>STOCK POSITION</span><h2 id="i1-snapshot-title">Stock Snapshot</h2></div><button type="button" onClick={() => onNavigate("current-stock")}>View Current Stock</button></div>
        <div className="ia-i1-snapshot-grid">
          <button type="button" onClick={() => onNavigate("low-stock-assistant")}><small>Out of Stock</small><strong>{outOfStockCount}</strong></button>
          <button type="button" onClick={() => onNavigate("low-stock-assistant")}><small>Low Stock</small><strong>{lowStockCount}</strong></button>
          <button type="button" onClick={() => onNavigate("items")}><small>Active Ingredients</small><strong>{totalActiveIngredients}</strong></button>
          <button type="button" onClick={() => onNavigate("inventory-value")}><small>Current Inventory Value</small><strong>{moneyLabel(inventoryValue)}</strong></button>
        </div>
      </section>

      <section className="ia-i1-section" aria-labelledby="i1-activity-title">
        <div className="ia-i1-title"><div><span>LEDGER</span><h2 id="i1-activity-title">Recent Activity</h2></div><button type="button" onClick={() => onNavigate("ledger")}>Open Ledger</button></div>
        <div className="ia-i1-activity-list">
          {recentLedger.slice(0, 10).map((entry) => <button type="button" key={entry.id} onClick={() => onNavigate("ledger")}>
            <span className={entry.quantityEffect === "in" ? "in" : "out"}>{entry.quantityEffect === "in" ? "+" : "−"}</span>
            <span><strong>{entry.itemName}</strong><small>{movementLabel(entry.movementType)}</small></span>
            <strong>{entry.quantityEffect === "in" ? "+" : "−"}{quantityLabel(entry.quantity, entry.unitName)}</strong>
            <time dateTime={entry.movementDate}>{dateTimeLabel(entry.movementDate)}</time>
            <span><strong>{entry.staffName ?? "System"}</strong><small>{entry.createdByStaffId ? (staffRoles[entry.createdByStaffId] ?? "Staff").replace(/_/g, " ") : "System"}</small></span>
          </button>)}
          {recentLedger.length === 0 && <p className="ia-i1-empty">No recent inventory activity.</p>}
        </div>
      </section>

      {action && <div className="ia-i1-dialog-backdrop" role="presentation" onClick={() => !working && setAction(null)}><section className="ia-i1-dialog" role="dialog" aria-modal="true" aria-labelledby="i1-dialog-title" onClick={(event) => event.stopPropagation()}>
        <header><div><span>KITCHEN REQUEST</span><h2 id="i1-dialog-title">{action.kind === "issue" ? "Issue Stock" : "Cannot Fulfill Request"}</h2><p>{action.request.itemName || "Inventory item"} → {action.request.stationName ?? "Kitchen"}</p></div><button type="button" disabled={working} onClick={() => setAction(null)} aria-label="Close request dialog">×</button></header>
        <dl className="ia-i1-dialog-summary"><div><dt>Requested</dt><dd>{quantityLabel(action.request.quantity, action.request.unit)}</dd></div>{action.kind === "issue" && <><div><dt>Available</dt><dd>{issueAvailable === null ? "Not available" : quantityLabel(issueAvailable, action.request.unit)}</dd></div><div><dt>Storage</dt><dd>{action.request.inventoryItemId ? requestStorageLocations[action.request.inventoryItemId] ?? "Not available" : "Not available"}</dd></div><div><dt>After issue</dt><dd>{remainingAfterIssue === null ? "Not available" : quantityLabel(remainingAfterIssue, action.request.unit)}</dd></div></>}</dl>
        {action.kind === "issue" ? <p className="ia-i1-deduction-warning">You are issuing {quantityLabel(action.request.quantity, action.request.unit)} of {action.request.itemName || "this item"} to {action.request.stationName ?? "Kitchen"}. Stock will decrease from {issueAvailable === null ? "an unconfirmed amount" : quantityLabel(issueAvailable, action.request.unit)} to {remainingAfterIssue === null ? "an unconfirmed amount" : quantityLabel(remainingAfterIssue, action.request.unit)}.</p> : <label>Reason <span>*</span><textarea maxLength={500} required value={unableReason} onChange={(event) => setUnableReason(event.target.value)} placeholder="For example: insufficient stock or item unavailable" /></label>}
        <footer><button className="secondary" type="button" disabled={working} onClick={() => setAction(null)}>Cancel</button><button type="button" disabled={working || (action.kind === "issue" ? !issueCanProceed : !unableReason.trim())} onClick={() => void confirmAction()}>{working ? "Saving..." : action.kind === "issue" ? `Issue ${quantityLabel(action.request.quantity, action.request.unit)}` : "Confirm Cannot Fulfill"}</button></footer>
      </section></div>}
    </div>
  );
}

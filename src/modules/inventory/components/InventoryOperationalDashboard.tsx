import { useMemo, useState } from "react";
import { partitionInventoryKitchenRequests, type InventoryKitchenQueueRequest } from "../services/inventoryKitchenRequestService";

type RequestTab = "accepted" | "issued" | "history";
type RequestAction = { kind: "issue" | "unable"; request: InventoryKitchenQueueRequest } | null;
type AvailabilityState = "available" | "insufficient" | "out" | "unavailable";
type Props = {
  requests: InventoryKitchenQueueRequest[];
  requestsLoading: boolean;
  requestsError: string | null;
  canProcessRequests: boolean;
  requestStorageLocations: Record<string, string>;
  working: boolean;
  onIssue: (request: InventoryKitchenQueueRequest) => Promise<boolean>;
  onUnable: (request: InventoryKitchenQueueRequest, reason: string) => Promise<boolean>;
};

const HISTORY_PAGE_SIZE = 20;
export const formatInventoryQuantity = (value: number, unit: string) => {
  if (!Number.isFinite(value)) return "Not available";
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
  return unit.trim() ? `${formatted} ${unit.trim()}` : formatted;
};
const dateTimeLabel = (value: string | null) => value ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "Time not recorded";
const completedAt = (request: InventoryKitchenQueueRequest) => request.deliveredAt ?? request.unableToFulfillAt ?? request.rejectedAt ?? request.issuedAt ?? request.requestedAt;

export function sortInventoryRequestHistory(requests: InventoryKitchenQueueRequest[]) {
  return [...requests].sort((left, right) => new Date(completedAt(right)).getTime() - new Date(completedAt(left)).getTime() || right.id.localeCompare(left.id));
}

export function inventoryRequestAvailability(request: InventoryKitchenQueueRequest): AvailabilityState {
  if (!request.inventoryItemId || request.currentQuantity === null || !Number.isFinite(request.currentQuantity) || !request.unit.trim()) return "unavailable";
  if (request.currentQuantity <= 0) return "out";
  if (request.currentQuantity < request.quantity) return "insufficient";
  return "available";
}

function outcomeLabel(request: InventoryKitchenQueueRequest) {
  if (request.status === "delivered") return "Received by Kitchen";
  if (request.status === "unable_to_fulfill") return "Unable to Fulfill";
  return "Rejected";
}
function storageName(request: InventoryKitchenQueueRequest, locations: Record<string, string>) {
  return request.inventoryItemId ? locations[request.inventoryItemId] ?? "Storage not configured" : "Storage not available";
}

export function InventoryOperationalDashboard({ requests, requestsLoading, requestsError, canProcessRequests, requestStorageLocations, working, onIssue, onUnable }: Props) {
  const [tab, setTab] = useState<RequestTab>("accepted");
  const [action, setAction] = useState<RequestAction>(null);
  const [unableReason, setUnableReason] = useState("");
  const [unableDetail, setUnableDetail] = useState("");
  const [historyCount, setHistoryCount] = useState(HISTORY_PAGE_SIZE);
  const grouped = useMemo(() => partitionInventoryKitchenRequests(requests), [requests]);
  const accepted = grouped.awaitingInventory;
  const issued = useMemo(() => [...grouped.awaitingKitchen].sort((left, right) => new Date(right.issuedAt ?? right.requestedAt).getTime() - new Date(left.issuedAt ?? left.requestedAt).getTime()), [grouped.awaitingKitchen]);
  const allHistory = useMemo(() => sortInventoryRequestHistory(grouped.history), [grouped.history]);
  const history = allHistory.slice(0, historyCount);
  const visibleRequests = tab === "accepted" ? accepted : tab === "issued" ? issued : history;
  const issueRequest = action?.kind === "issue" ? action.request : null;
  const issueState = issueRequest ? inventoryRequestAvailability(issueRequest) : "unavailable";
  const issueAvailable = issueRequest?.currentQuantity ?? null;
  const remaining = issueRequest && issueAvailable !== null && issueState === "available" ? issueAvailable - issueRequest.quantity : null;
  const unableExplanation = unableReason === "Other" ? unableDetail.trim() : [unableReason, unableDetail.trim()].filter(Boolean).join(": ");

  function selectTab(next: RequestTab) { setTab(next); if (next === "history") setHistoryCount(HISTORY_PAGE_SIZE); }
  function closeAction() { if (working) return; setAction(null); setUnableReason(""); setUnableDetail(""); }
  async function confirmAction() {
    if (!action || (action.kind === "issue" && inventoryRequestAvailability(action.request) !== "available") || (action.kind === "unable" && !unableExplanation)) return;
    const succeeded = action.kind === "issue" ? await onIssue(action.request) : await onUnable(action.request, unableExplanation);
    if (succeeded) { setAction(null); setUnableReason(""); setUnableDetail(""); setTab(action.kind === "issue" ? "issued" : "history"); }
  }

  return <div className="ia-kr-page">
    <header className="ia-kr-heading"><div><h2>Kitchen Requests</h2></div></header>
    <div className="ia-kr-tabs" role="tablist" aria-label="Kitchen request workflow">
      <button type="button" role="tab" aria-selected={tab === "accepted"} onClick={() => selectTab("accepted")}>Awaiting Inventory{accepted.length > 0 && <span>{accepted.length}</span>}</button>
      <button type="button" role="tab" aria-selected={tab === "issued"} onClick={() => selectTab("issued")}>Awaiting Kitchen{issued.length > 0 && <span>{issued.length}</span>}</button>
      <button type="button" role="tab" aria-selected={tab === "history"} onClick={() => selectTab("history")}>History</button>
    </div>

    {requestsError ? <div className="ia-kr-error" role="alert"><strong>Kitchen requests couldn&apos;t be loaded.</strong><span>Check your connection and try again.</span></div>
      : requestsLoading ? <div className="ia-kr-state" role="status">Loading Kitchen requests...</div>
        : visibleRequests.length === 0 ? <div className="ia-kr-state"><strong>{tab === "accepted" ? "No requests are awaiting Inventory." : tab === "issued" ? "No requests are awaiting Kitchen." : "No Kitchen request history yet."}</strong></div>
          : <div className="ia-kr-list">{visibleRequests.map((request) => {
            const availability = inventoryRequestAvailability(request);
            const location = storageName(request, requestStorageLocations);
            const available = request.currentQuantity;
            const active = request.status === "accepted";
            const awaitingKitchen = request.status === "issued";
            return <article key={request.id} className={`ia-kr-card ${active ? availability : request.status}`}>
              <header><div><strong>{request.itemName || "Unnamed material"}</strong><span>{request.stationName ?? "Kitchen / station not recorded"}</span></div>{!active && !awaitingKitchen && <b className={`ia-kr-outcome ${request.status}`}>{outcomeLabel(request)}</b>}</header>
              {active && <>
                <div className="ia-kr-requested"><span className="sr-only">Requested</span><strong>{formatInventoryQuantity(request.quantity, request.unit)}</strong></div>
                <div className={`ia-kr-availability ${availability}`}><div><span>Available in {location}</span><strong>{available === null || !request.unit.trim() ? "Not available" : formatInventoryQuantity(available, request.unit)}</strong></div>{availability === "out" && <b>OUT OF STOCK</b>}{availability === "insufficient" && <b>Insufficient stock · short by {formatInventoryQuantity(request.quantity - (available ?? 0), request.unit)}</b>}{availability === "unavailable" && <b>Stock availability unavailable</b>}</div>
                <div className="ia-kr-meta">{request.requesterName && <span>Requested by {request.requesterName}</span>}<time dateTime={request.requestedAt}>{dateTimeLabel(request.requestedAt)}</time></div>
                {(request.comment || request.reviewerName) && <details><summary>Request details</summary>{request.comment && <p>{request.comment}</p>}{request.reviewerName && <p>Approved by {request.reviewerName}{request.acceptedAt ? ` · ${dateTimeLabel(request.acceptedAt)}` : ""}</p>}</details>}
                {canProcessRequests && <footer>{availability === "available" && <button type="button" onClick={() => setAction({ kind: "issue", request })}>Issue</button>}<button type="button" className="secondary" onClick={() => { setUnableReason(""); setUnableDetail(""); setAction({ kind: "unable", request }); }}>Cannot Fulfill</button></footer>}
              </>}
              {awaitingKitchen && <><div className="ia-kr-issued"><strong>{formatInventoryQuantity(request.issuedQuantity ?? request.quantity, request.unit)} issued</strong><span>{location} → {request.stationName ?? "Kitchen / station"}</span></div><div className="ia-kr-meta"><span>Issued by {request.issuerName ?? request.fulfillerName ?? "Inventory"}</span><time dateTime={request.issuedAt ?? undefined}>{dateTimeLabel(request.issuedAt)}</time></div><p className="ia-kr-waiting">Waiting for Kitchen</p></>}
              {!active && !awaitingKitchen && <><div className="ia-kr-issued"><strong>{formatInventoryQuantity(request.issuedQuantity ?? request.quantity, request.unit)}</strong><span>{request.stationName ?? "Kitchen / station not recorded"}</span></div><div className="ia-kr-meta"><span>{request.status === "delivered" ? `Issued by ${request.issuerName ?? request.fulfillerName ?? "Inventory"}` : request.status === "unable_to_fulfill" ? `Handled by ${request.unableToFulfillByName ?? "Inventory"}` : `Reviewed by ${request.reviewerName ?? "Manager"}`}</span><time dateTime={completedAt(request)}>{dateTimeLabel(completedAt(request))}</time></div>{(request.unableToFulfillReason || request.rejectionReason || request.requesterName) && <details><summary>Details</summary>{request.requesterName && <p>Requested by {request.requesterName}</p>}{(request.unableToFulfillReason || request.rejectionReason) && <p>{request.unableToFulfillReason ?? request.rejectionReason}</p>}</details>}</>}
            </article>;
          })}</div>}
    {!requestsLoading && !requestsError && tab === "history" && historyCount < allHistory.length && <div className="ia-kr-load-more"><span>Showing {history.length} of {allHistory.length}</span><button type="button" onClick={() => setHistoryCount((count) => count + HISTORY_PAGE_SIZE)}>Load More</button></div>}

    {action && <div className="ia-kr-backdrop" role="presentation" onClick={closeAction}><section className="ia-kr-dialog" role="dialog" aria-modal="true" aria-labelledby="ia-kr-dialog-title" onClick={(event) => event.stopPropagation()}><header><div><h2 id="ia-kr-dialog-title">{action.kind === "issue" ? `Issue ${action.request.itemName}` : "Cannot Fulfill"}</h2><p>{action.request.stationName ?? "Kitchen / station not recorded"}</p></div><button type="button" aria-label="Close request dialog" disabled={working} onClick={closeAction}>×</button></header>
      {action.kind === "issue" ? <><dl><div><dt>Requested</dt><dd>{formatInventoryQuantity(action.request.quantity, action.request.unit)}</dd></div><div><dt>From</dt><dd>{storageName(action.request, requestStorageLocations)}</dd></div><div><dt>Available</dt><dd>{issueAvailable === null ? "Not available" : formatInventoryQuantity(issueAvailable, action.request.unit)}</dd></div><div><dt>After issue</dt><dd>{remaining === null ? "Not available" : formatInventoryQuantity(remaining, action.request.unit)}</dd></div></dl><label>Quantity to issue<div className="ia-kr-quantity-input"><input type="number" readOnly value={action.request.quantity} /><span>{action.request.unit}</span></div></label><p className="ia-kr-integrity-note">This issues the full approved quantity and records one stock movement.</p></> : <div className="ia-kr-unable-form"><label>Reason<select required value={unableReason} onChange={(event) => setUnableReason(event.target.value)}><option value="">Select a reason</option><option value="Insufficient stock">Insufficient stock</option><option value="Out of stock">Out of stock</option><option value="Material unavailable">Material unavailable</option><option value="Other">Other</option></select></label><label>{unableReason === "Other" ? "Short explanation" : "Additional explanation (optional)"}<textarea rows={2} maxLength={300} value={unableDetail} onChange={(event) => setUnableDetail(event.target.value)} placeholder="Add a short operational explanation" /></label></div>}
      <footer><button type="button" className="secondary" disabled={working} onClick={closeAction}>Cancel</button><button type="button" disabled={working || (action.kind === "issue" ? issueState !== "available" : !unableExplanation)} onClick={() => void confirmAction()}>{working ? "Saving..." : action.kind === "issue" ? "Confirm Issue" : "Confirm Cannot Fulfill"}</button></footer>
    </section></div>}
  </div>;
}

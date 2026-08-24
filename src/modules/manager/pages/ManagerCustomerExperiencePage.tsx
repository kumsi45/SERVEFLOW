import { useCallback, useEffect, useMemo, useState } from "react";
import type { CurrencyConfig } from "../../../core/format/currency";
import { useTenantRealtime } from "../../../core/realtime/useTenantRealtime";
import {
  escalateManagerComplaint,
  loadManagerCustomerExperience,
  resolveManagerComplaint,
  type CustomerExperienceAlert,
  type ManagerComplaint,
  type ManagerCustomerExperienceSnapshot,
  type ManagerCustomerSession,
} from "../services/managerCustomerExperienceService";
import "../styles/managerCustomerExperience.css";
import { managerFacingMessage } from "../managerPresentation";

type Props = {
  restaurantId: string;
  restaurantName: string;
  managerName: string;
  currency?: CurrencyConfig;
};

type GuestTab = "attention" | "complaints" | "requests" | "lookup";
type GuestAttentionItem =
  | { id: string; kind: "session"; severity: "warning" | "critical"; alert: CustomerExperienceAlert }
  | { id: string; kind: "complaint"; severity: "warning" | "critical"; complaint: ManagerComplaint };

const TABS: Array<{ id: GuestTab; label: string }> = [
  { id: "attention", label: "Needs Attention" },
  { id: "complaints", label: "Complaints" },
  { id: "requests", label: "Special Requests" },
  { id: "lookup", label: "Guest Lookup" },
];

function formatMinutes(minutes: number | null) {
  if (minutes == null) return "Not recorded";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function ageFrom(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  return formatMinutes(Math.floor(elapsed / 60_000));
}

function serviceReference(session: ManagerCustomerSession | null | undefined) {
  if (!session) return "Service session";
  return session.tableNumber
    ? `Table ${session.tableNumber}`
    : `Order ${session.displayNumber}`;
}

function complaintReference(complaint: ManagerComplaint, session?: ManagerCustomerSession) {
  if (session) return serviceReference(session);
  if (complaint.tableNumber) return `Table ${complaint.tableNumber}`;
  return complaint.orderId ? "Order session" : "Service location not recorded";
}

function issueLabel(alert: CustomerExperienceAlert) {
  if (alert.type === "long_wait") return "Excessive service wait";
  if (alert.type === "bill_wait") return "Delayed bill assistance";
  if (alert.type === "complaint") return "Unresolved complaint";
  if (alert.type === "special_request") return "Special request needs attention";
  return "Service attention needed";
}

function priorityLabel(severity: CustomerExperienceAlert["severity"]) {
  return severity === "critical" ? "Urgent" : "Attention";
}

export function ManagerCustomerExperiencePage({ restaurantId }: Props) {
  const [snapshot, setSnapshot] = useState<ManagerCustomerExperienceSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<GuestTab>("attention");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedComplaintId, setSelectedComplaintId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await loadManagerCustomerExperience(restaurantId));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load guest attention data.");
    }
  }, [restaurantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useTenantRealtime({
    channelName: "manager-customer-experience",
    restaurantId,
    tables: ["orders", "order_items", "order_invoices", "restaurant_table_waiter_assignments", "manager_customer_complaints", "staff_activity_log"],
    refresh,
  });

  const sessionsById = useMemo(
    () => new Map((snapshot?.sessions ?? []).map((session) => [session.orderId, session])),
    [snapshot],
  );
  const selectedComplaint = snapshot?.complaints.find((complaint) => complaint.id === selectedComplaintId) ?? null;
  const selectedSession = selectedOrderId
    ? sessionsById.get(selectedOrderId) ?? null
    : selectedComplaint?.orderId
      ? sessionsById.get(selectedComplaint.orderId) ?? null
      : null;
  const sessionComplaints = snapshot?.complaints.filter((complaint) => complaint.orderId === selectedSession?.orderId) ?? [];

  const attentionRows = useMemo(() => {
    const alerts = (snapshot?.alerts ?? []).filter((alert) => alert.type !== "vip_wait");
    const coveredOrders = new Set(alerts.map((alert) => alert.orderId));
    for (const session of snapshot?.sessions ?? []) {
      const normalized = session.status.toLowerCase();
      if ((normalized.includes("delay") || normalized.includes("attention")) && !coveredOrders.has(session.orderId)) {
        alerts.push({
          id: `${session.orderId}:service-delay`,
          type: "long_wait",
          severity: "critical",
          orderId: session.orderId,
          tableNumber: session.tableNumber,
          message: "The current service state requires manager attention.",
        });
      }
    }
    const items: GuestAttentionItem[] = alerts.map((alert) => ({ id: alert.id, kind: "session", severity: alert.severity, alert }));
    const complaintOrdersCovered = new Set(alerts.filter((alert) => alert.type === "complaint").map((alert) => alert.orderId));
    for (const complaint of snapshot?.complaints ?? []) {
      if (complaint.status === "resolved" || (complaint.orderId && complaintOrdersCovered.has(complaint.orderId))) continue;
      items.push({ id: `complaint:${complaint.id}`, kind: "complaint", severity: complaint.severity === "high" ? "critical" : "warning", complaint });
    }
    return items.sort((left, right) => Number(right.severity === "critical") - Number(left.severity === "critical"));
  }, [snapshot]);

  const specialRequests = useMemo(
    () => (snapshot?.sessions ?? []).flatMap((session) => {
      const served = session.timeline.some((event) => event.label === "Served");
      return served ? [] : session.specialRequests.map((request, index) => ({ id: `${session.orderId}:${index}`, request, session }));
    }),
    [snapshot],
  );

  const lookupResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return (snapshot?.sessions ?? []).filter((session) => [
      session.customerName,
      session.customerPhone,
      session.displayNumber,
      session.tableNumber,
    ].some((value) => value?.toLowerCase().includes(normalized)));
  }, [query, snapshot]);

  function openSession(orderId: string) {
    setSelectedComplaintId(null);
    setSelectedOrderId(orderId);
  }

  function openComplaint(complaint: ManagerComplaint) {
    setSelectedOrderId(complaint.orderId);
    setSelectedComplaintId(complaint.id);
  }

  function closeInspector() {
    setSelectedOrderId(null);
    setSelectedComplaintId(null);
  }

  async function runAction(action: () => Promise<void>, success: string) {
    try {
      setError(null);
      setNotice(null);
      await action();
      setNotice(success);
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Guest service action failed.");
    }
  }

  return (
    <main className="mcx-page">
      <nav className="mcx-tabs" aria-label="Guest workspace sections">
        {TABS.map((tab) => (
          <button key={tab.id} type="button" className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
            {tab.id === "attention" && attentionRows.length > 0 && <span>{attentionRows.length}</span>}
          </button>
        ))}
      </nav>

      {(notice || error) && <div className={`mcx-message ${error ? "error" : ""}`} role={error ? "alert" : "status"}>{error ? managerFacingMessage(error, "Unable to complete the guest action. Try again.") : notice}</div>}

      {activeTab === "attention" && (
        <section className="mcx-workspace" aria-label="Needs Attention">
          {attentionRows.length > 0 ? (
            <div className="mcx-row-list mcx-attention-list">
              <div className="mcx-row mcx-row-head" aria-hidden="true"><span>Location / Order</span><span>Issue</span><span>Waiting Time</span><span>Priority</span><span>Assigned Staff</span><span /></div>
              {attentionRows.map((item) => {
                const alert = item.kind === "session" ? item.alert : null;
                const complaint = item.kind === "complaint" ? item.complaint : null;
                const session = alert ? sessionsById.get(alert.orderId) : complaint?.orderId ? sessionsById.get(complaint.orderId) : undefined;
                const wait = complaint ? ageFrom(complaint.createdAt) : formatMinutes(alert?.type === "bill_wait" ? session?.billWaitingMinutes ?? null : session?.waitingMinutes ?? null);
                return (
                  <article key={item.id} className={`mcx-row mcx-attention-row ${item.severity}`}>
                    <div data-label="Location / Order"><strong>{complaint ? complaintReference(complaint, session) : serviceReference(session)}</strong><small>{session?.displayNumber ?? (complaint?.customerName || "Order not recorded")}</small></div>
                    <div data-label="Issue"><strong>{complaint ? "Unresolved complaint" : issueLabel(alert!)}</strong><small>{complaint?.description ?? alert?.message}</small></div>
                    <span data-label="Waiting Time">{wait}</span>
                    <span data-label="Priority" className={`mcx-priority ${item.severity}`}><i />{priorityLabel(item.severity)}</span>
                    <span data-label="Assigned Staff">{session?.assignedWaiter || "Not assigned"}</span>
                    <button type="button" onClick={() => complaint ? openComplaint(complaint) : openSession(alert!.orderId)}>View</button>
                  </article>
                );
              })}
            </div>
          ) : <div className="mcx-empty"><strong>No guest attention needed</strong><span>Current service sessions have no manager exceptions.</span></div>}
        </section>
      )}

      {activeTab === "complaints" && (
        <section className="mcx-workspace" aria-label="Complaints">
          {(snapshot?.complaints.length ?? 0) > 0 ? (
            <div className="mcx-row-list mcx-complaints-list">
              <div className="mcx-row mcx-row-head" aria-hidden="true"><span>Location / Customer</span><span>Complaint</span><span>Age</span><span>Priority</span><span>Status</span><span /></div>
              {snapshot?.complaints.map((complaint) => {
                const session = complaint.orderId ? sessionsById.get(complaint.orderId) : undefined;
                return (
                  <article key={complaint.id} className="mcx-row mcx-complaint-row">
                    <div data-label="Location / Customer"><strong>{complaintReference(complaint, session)}</strong><small>{complaint.customerName || session?.customerName || "Customer not recorded"}</small></div>
                    <div data-label="Complaint"><strong>{complaint.category}</strong><small>{complaint.description}</small></div>
                    <span data-label="Age">{ageFrom(complaint.createdAt)}</span>
                    <span data-label="Priority" className={`mcx-severity ${complaint.severity}`}>{complaint.severity}</span>
                    <span data-label="Status" className={`mcx-status ${complaint.status}`}>{complaint.status}</span>
                    <button type="button" onClick={() => openComplaint(complaint)}>Review</button>
                  </article>
                );
              })}
            </div>
          ) : <div className="mcx-empty"><strong>No complaints recorded</strong><span>New complaints will appear here.</span></div>}
        </section>
      )}

      {activeTab === "requests" && (
        <section className="mcx-workspace" aria-label="Special Requests">
          {specialRequests.length > 0 ? (
            <div className="mcx-row-list mcx-request-list">
              <div className="mcx-row mcx-row-head" aria-hidden="true"><span>Location / Order</span><span>Request</span><span>Age</span><span>Status</span><span>Assigned Staff</span><span /></div>
              {specialRequests.map(({ id, request, session }) => (
                <article key={id} className="mcx-row mcx-request-row">
                  <div data-label="Location / Order"><strong>{serviceReference(session)}</strong><small>{session.displayNumber}</small></div>
                  <div data-label="Request"><strong>{request}</strong></div>
                  <span data-label="Age">{formatMinutes(session.waitingMinutes)}</span>
                  <span data-label="Status" className="mcx-status open">Needs attention</span>
                  <span data-label="Assigned Staff">{session.assignedWaiter || "Not assigned"}</span>
                  <button type="button" onClick={() => openSession(session.orderId)}>View</button>
                </article>
              ))}
            </div>
          ) : <div className="mcx-empty"><strong>No special requests need attention</strong><span>Unserved requests from current order notes appear here.</span></div>}
        </section>
      )}

      {activeTab === "lookup" && (
        <section className="mcx-workspace" aria-label="Guest Lookup">
          <label className="mcx-search"><span>Search guests</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer, phone, order or service location..." /></label>
          {!query.trim() ? <div className="mcx-empty"><strong>Search current service sessions</strong><span>Search by customer name, phone, order number, or service location.</span></div> : lookupResults.length > 0 ? (
            <div className="mcx-row-list mcx-lookup-list">
              <div className="mcx-row mcx-row-head" aria-hidden="true"><span>Customer</span><span>Location / Order</span><span>Phone</span><span>Status</span><span /></div>
              {lookupResults.map((session) => (
                <article key={session.orderId} className="mcx-row mcx-lookup-row">
                  <div data-label="Customer"><strong>{session.customerName || "Customer not recorded"}</strong></div>
                  <div data-label="Location / Order"><strong>{serviceReference(session)}</strong><small>{session.displayNumber}</small></div>
                  <span data-label="Phone">{session.customerPhone || "Not recorded"}</span>
                  <span data-label="Status" className="mcx-status neutral">{session.status}</span>
                  <button type="button" onClick={() => openSession(session.orderId)}>View</button>
                </article>
              ))}
            </div>
          ) : <div className="mcx-empty"><strong>No matching guest or service session</strong><span>Try a different name, phone, order, or service location.</span></div>}
        </section>
      )}

      {(selectedSession || selectedComplaint) && <button type="button" className="mcx-scrim" aria-label="Close guest details" onClick={closeInspector} />}
      {(selectedSession || selectedComplaint) && (
        <aside className="mcx-inspector" role="dialog" aria-modal="true" aria-labelledby="guest-inspector-title">
          <header>
            <div><span>Guest context</span><h2 id="guest-inspector-title">{selectedComplaint ? "Complaint Review" : serviceReference(selectedSession)}</h2></div>
            <button type="button" className="mcx-close" onClick={closeInspector} aria-label="Close guest details">×</button>
          </header>

          {selectedComplaint && (
            <section>
              <div className="mcx-inspector-title"><h3>{selectedComplaint.category}</h3><span className={`mcx-status ${selectedComplaint.status}`}>{selectedComplaint.status}</span></div>
              <p>{selectedComplaint.description}</p>
              <dl>
                <div><dt>Location</dt><dd>{complaintReference(selectedComplaint, selectedSession ?? undefined)}</dd></div>
                <div><dt>Customer</dt><dd>{selectedComplaint.customerName || selectedSession?.customerName || "Not recorded"}</dd></div>
                <div><dt>Age</dt><dd>{ageFrom(selectedComplaint.createdAt)}</dd></div>
                <div><dt>Priority</dt><dd className="mcx-capitalize">{selectedComplaint.severity}</dd></div>
              </dl>
              {selectedComplaint.status !== "resolved" && <div className="mcx-inspector-actions">
                {selectedComplaint.status !== "escalated" && <button type="button" className="secondary" onClick={() => void runAction(() => escalateManagerComplaint(restaurantId, selectedComplaint.id), "Complaint escalated for follow-up.")}>Escalate</button>}
                <button type="button" onClick={() => void runAction(() => resolveManagerComplaint(restaurantId, selectedComplaint.id), "Complaint resolved.")}>Resolve complaint</button>
              </div>}
            </section>
          )}

          {selectedSession && (
            <>
              <section>
                <div className="mcx-inspector-title"><h3>Current Service</h3><span className="mcx-status neutral">{selectedSession.status}</span></div>
                <dl>
                  <div><dt>Location / Order</dt><dd>{serviceReference(selectedSession)}</dd></div>
                  <div><dt>Order</dt><dd>{selectedSession.displayNumber}</dd></div>
                  <div><dt>Customer</dt><dd>{selectedSession.customerName || "Not recorded"}</dd></div>
                  <div><dt>Phone</dt><dd>{selectedSession.customerPhone || "Not recorded"}</dd></div>
                  <div><dt>Waiting</dt><dd>{formatMinutes(selectedSession.waitingMinutes)}</dd></div>
                  <div><dt>Assigned Staff</dt><dd>{selectedSession.assignedWaiter || "Not assigned"}</dd></div>
                </dl>
              </section>
              {selectedSession.specialRequests.length > 0 && <section><h3>Special Requests</h3><ul>{selectedSession.specialRequests.map((request, index) => <li key={`${request}:${index}`}>{request}</li>)}</ul></section>}
              {!selectedComplaint && sessionComplaints.length > 0 && <section><h3>Complaints</h3>{sessionComplaints.map((complaint) => <button type="button" className="mcx-linked-complaint" key={complaint.id} onClick={() => openComplaint(complaint)}><span><strong>{complaint.category}</strong><small>{complaint.description}</small></span><b>{complaint.status}</b></button>)}</section>}
              {selectedSession.timeline.length > 0 && <section><h3>Recent Session Context</h3><ol className="mcx-timeline">{selectedSession.timeline.slice(-5).reverse().map((event) => <li key={event.id}><time>{new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><span>{event.label}</span></li>)}</ol></section>}
            </>
          )}
        </aside>
      )}
    </main>
  );
}

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../core/database";
import { formatCurrency, type CurrencyConfig } from "../../../core/format/currency";
import {
  assignManagerCustomerWaiter,
  escalateManagerComplaint,
  loadManagerCustomerExperience,
  notifyManagerCustomerCashier,
  notifyManagerCustomerKitchen,
  resolveManagerComplaint,
  type ManagerCustomerExperienceSnapshot,
  type ManagerCustomerSession,
} from "../services/managerCustomerExperienceService";
import "../styles/managerCustomerExperience.css";

type Props = {
  restaurantId: string;
  restaurantName: string;
  managerName: string;
  currency?: CurrencyConfig;
};

type CustomerTab = "waiting" | "vip" | "complaints" | "bill" | "timeline" | "reservations";

function fmtMinutes(minutes: number | null) {
  if (minutes == null) return "-";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function ManagerCustomerExperiencePage({ restaurantId, restaurantName, managerName, currency }: Props) {
  const [snapshot, setSnapshot] = useState<ManagerCustomerExperienceSnapshot | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [historySession, setHistorySession] = useState<ManagerCustomerSession | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CustomerTab>("waiting");

  const refresh = useCallback(async () => {
    try {
      const next = await loadManagerCustomerExperience(restaurantId);
      setSnapshot(next);
      setSelectedOrderId((current) => current ?? next.sessions[0]?.orderId ?? null);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load customer experience.");
    }
  }, [restaurantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const channel = supabase
      .channel(`manager-customer-experience:${restaurantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "order_invoices", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_table_waiter_assignments", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "manager_customer_complaints", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "staff_activity_log", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh, restaurantId]);

  const selectedSession = snapshot?.sessions.find((session) => session.orderId === selectedOrderId) ?? snapshot?.sessions[0] ?? null;
  const selectedComplaints = snapshot?.complaints.filter((complaint) => complaint.orderId === selectedSession?.orderId) ?? [];
  const visibleSessions = (snapshot?.sessions ?? []).filter((session) => {
    if (activeTab === "vip") return session.vip;
    if (activeTab === "complaints") return session.unresolvedComplaintCount > 0;
    if (activeTab === "bill") return (session.billWaitingMinutes ?? 0) > 0;
    return true;
  });

  async function runAction(action: () => Promise<void>, success: string) {
    try {
      setError(null);
      setNotice(null);
      await action();
      setNotice(success);
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Customer action failed.");
    }
  }

  return (
    <main className="mcx-page">
      <header className="manager-module-header mcx-header">
        <div>
          <span>Customer Experience</span>
          <h1>Customers</h1>
        </div>
        <p>{restaurantName} - {managerName} monitors service quality in real time</p>
      </header>

      <nav className="manager-tabs" aria-label="Customer module sections">
        {[
          ["waiting", "Waiting"],
          ["vip", "VIP"],
          ["complaints", "Complaints"],
          ["bill", "Bill Requests"],
          ["timeline", "Timeline"],
          ["reservations", "Reservations"],
        ].map(([key, label]) => <button key={key} type="button" className={activeTab === key ? "active" : ""} onClick={() => setActiveTab(key as CustomerTab)}>{label}</button>)}
      </nav>

      {(notice || error) && <div className={`mcx-message ${error ? "error" : ""}`}>{error || notice}</div>}

      {activeTab !== "timeline" && <section className="mcx-kpis" aria-label="Customer experience metrics">
        <article><span>Waiting Customers</span><strong>{snapshot?.waitingCustomers ?? 0}</strong></article>
        <article><span>Tables Requesting Bill</span><strong>{snapshot?.tablesRequestingBill ?? 0}</strong></article>
        <article><span>Special Requests</span><strong>{snapshot?.specialRequests ?? 0}</strong></article>
        <article><span>VIP Guests</span><strong>{snapshot?.vipGuests ?? 0}</strong></article>
        <article><span>Complaints</span><strong>{snapshot?.customerComplaints ?? 0}</strong></article>
        <article><span>Reservation Queue</span><strong>{snapshot?.reservationQueue ?? 0}</strong><small>future</small></article>
      </section>}

      {activeTab !== "timeline" && (snapshot?.alerts.length ?? 0) > 0 && (
        <section className="mcx-alerts" aria-label="Customer alerts">
          {(snapshot?.alerts ?? []).map((alert) => (
            <button key={alert.id} type="button" className={`mcx-alert ${alert.severity}`} onClick={() => setSelectedOrderId(alert.orderId)}>
              <strong>Table {alert.tableNumber ?? "-"}</strong>
              <span>{alert.message}</span>
            </button>
          ))}
        </section>
      )}

      {activeTab === "reservations" ? (
        <section className="mcx-panel"><h3>Reservations</h3><p className="mcx-empty">Reservation queue is prepared for future activation.</p></section>
      ) : activeTab === "timeline" ? (
        <section className="mcx-panel">
          <h3>Customer Timeline</h3>
          <div className="mcx-timeline">
            {(selectedSession?.timeline ?? []).map((event) => <article key={event.id}><strong>{event.label}</strong><small>{new Date(event.at).toLocaleString()}</small></article>)}
            {!selectedSession?.timeline?.length && <p className="mcx-empty">No timeline events for the selected customer session.</p>}
          </div>
        </section>
      ) : (
      <section className="mcx-layout">
        <div className="mcx-sessions">
          {visibleSessions.map((session) => (
            <button key={session.orderId} type="button" className={`mcx-session ${selectedSession?.orderId === session.orderId ? "selected" : ""} ${session.vip ? "vip" : ""} ${session.unresolvedComplaintCount > 0 ? "complaint" : ""}`} onClick={() => setSelectedOrderId(session.orderId)}>
              <div>
                <strong>Table {session.tableNumber ?? "-"}</strong>
                <span>{session.vip ? "VIP" : session.status}</span>
              </div>
              <p>{session.customerName || "Guest"} · {session.assignedWaiter || "No waiter assigned"}</p>
              <dl>
                <div><dt>Waiting</dt><dd>{fmtMinutes(session.waitingMinutes)}</dd></div>
                <div><dt>Bill wait</dt><dd>{fmtMinutes(session.billWaitingMinutes)}</dd></div>
                <div><dt>Total</dt><dd>{formatCurrency(session.totalPrice, currency)}</dd></div>
              </dl>
            </button>
          ))}
          {visibleSessions.length === 0 && <p className="mcx-empty">No customer sessions in this tab.</p>}
        </div>

        <section className="mcx-detail">
          <div className="mcx-detail-head">
            <div>
              <span>Customer Session</span>
              <h2>{selectedSession ? `Table ${selectedSession.tableNumber ?? "-"}` : "No active session"}</h2>
              {selectedSession && <p>{selectedSession.customerName || "Guest"} · {selectedSession.displayNumber}</p>}
            </div>
            {selectedSession && <button type="button" onClick={() => setHistorySession(selectedSession)}>View Customer History</button>}
          </div>

          {selectedSession && (
            <>
              <div className="mcx-actions">
                <select defaultValue="" onChange={(event) => {
                  const waiterId = event.target.value;
                  if (!waiterId) return;
                  void runAction(() => assignManagerCustomerWaiter(restaurantId, selectedSession.orderId, waiterId), "Waiter assigned.");
                  event.currentTarget.value = "";
                }}>
                  <option value="">Assign waiter</option>
                  {(snapshot?.waiters ?? []).map((waiter) => <option key={waiter.id} value={waiter.id}>{waiter.displayName}</option>)}
                </select>
                <button type="button" onClick={() => void runAction(() => notifyManagerCustomerKitchen(restaurantId, selectedSession.orderId, `Customer service attention requested for table ${selectedSession.tableNumber ?? "-"}.`), "Kitchen notified.")}>Notify Kitchen</button>
                <button type="button" onClick={() => void runAction(() => notifyManagerCustomerCashier(restaurantId, selectedSession.orderId, `Customer billing attention requested for table ${selectedSession.tableNumber ?? "-"}.`), "Cashier notified.")}>Notify Cashier</button>
              </div>

              {selectedSession.specialRequests.length > 0 && (
                <section className="mcx-panel">
                  <h3>Special Requests</h3>
                  {selectedSession.specialRequests.map((request, index) => <p key={`${request}:${index}`}>{request}</p>)}
                </section>
              )}

              <section className="mcx-panel">
                <h3>Customer Complaints</h3>
                {selectedComplaints.map((complaint) => (
                  <article key={complaint.id} className={`mcx-complaint ${complaint.status}`}>
                    <div>
                      <strong>{complaint.category}</strong>
                      <span>{complaint.status}</span>
                    </div>
                    <p>{complaint.description}</p>
                    <div className="mcx-complaint-actions">
                      {complaint.status !== "resolved" && <button type="button" onClick={() => void runAction(() => escalateManagerComplaint(restaurantId, complaint.id), "Complaint escalated.")}>Escalate Complaint</button>}
                      {complaint.status !== "resolved" && <button type="button" onClick={() => void runAction(() => resolveManagerComplaint(restaurantId, complaint.id), "Complaint resolved.")}>Mark Resolved</button>}
                    </div>
                  </article>
                ))}
                {selectedComplaints.length === 0 && <p className="mcx-empty">No complaints for this session.</p>}
              </section>

              <section className="mcx-panel">
                <h3>Customer Timeline</h3>
                <ol className="mcx-timeline">
                  {selectedSession.timeline.map((event) => (
                    <li key={event.id}>
                      <time>{new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                      <span>{event.label}</span>
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
        </section>
      </section>)}

      {historySession && (
        <div className="mcx-modal" role="dialog" aria-modal="true">
          <section>
            <header>
              <div>
                <span>Customer History</span>
                <h2>{historySession.customerName || "Guest"}</h2>
              </div>
              <button type="button" onClick={() => setHistorySession(null)}>Close</button>
            </header>
            <dl>
              <div><dt>Phone</dt><dd>{historySession.customerPhone || "-"}</dd></div>
              <div><dt>Current table</dt><dd>{historySession.tableNumber || "-"}</dd></div>
              <div><dt>Current bill</dt><dd>{formatCurrency(historySession.totalPrice, currency)}</dd></div>
              <div><dt>Complaints</dt><dd>{historySession.complaintCount}</dd></div>
            </dl>
            <ol className="mcx-timeline">
              {historySession.timeline.map((event) => <li key={event.id}><time>{new Date(event.at).toLocaleString()}</time><span>{event.label}</span></li>)}
            </ol>
          </section>
        </div>
      )}
    </main>
  );
}

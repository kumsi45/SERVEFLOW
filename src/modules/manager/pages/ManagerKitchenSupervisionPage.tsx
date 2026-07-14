import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../core/database";
import {
  callAdditionalKitchenStaff,
  loadManagerKitchenSupervision,
  prioritizeManagerKitchenOrder,
  reassignManagerKitchenBatch,
  sendManagerKitchenMessage,
  setManagerKitchenStationPaused,
  type ManagerKitchenSupervisionSnapshot,
} from "../services/managerKitchenSupervisionService";
import "../styles/managerKitchenSupervision.css";

type Props = {
  restaurantId: string;
  restaurantName: string;
  managerName: string;
};

type KitchenTab = "stations" | "queue" | "preparing" | "ready" | "delayed" | "performance";

const KITCHEN_TABS: Array<[KitchenTab, string]> = [
  ["stations", "Stations"],
  ["queue", "Queue"],
  ["preparing", "Preparing"],
  ["ready", "Ready"],
  ["delayed", "Delayed"],
  ["performance", "Performance"],
];

function fmtMinutes(minutes: number | null) {
  if (minutes == null) return "-";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function ManagerKitchenSupervisionPage({ restaurantId, restaurantName, managerName }: Props) {
  const [snapshot, setSnapshot] = useState<ManagerKitchenSupervisionSnapshot | null>(null);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<KitchenTab>("stations");

  const refresh = useCallback(async () => {
    try {
      const next = await loadManagerKitchenSupervision(restaurantId);
      setSnapshot(next);
      setError(null);
      setSelectedStationId((current) => current ?? next.stations[0]?.id ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load kitchen supervision.");
    }
  }, [restaurantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const channel = supabase
      .channel(`manager-kitchen-supervision:${restaurantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "kitchen_stations", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_staff", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "staff_activity_log", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh, restaurantId]);

  const selectedStation = snapshot?.stations.find((station) => station.id === selectedStationId) ?? snapshot?.stations[0] ?? null;
  const displayedBatches = (selectedStation?.activeBatches ?? []).filter((batch) => {
    if (activeTab === "queue") return batch.status === "waiting";
    if (activeTab === "preparing") return batch.status === "preparing";
    if (activeTab === "ready") return batch.status === "ready";
    if (activeTab === "delayed") return batch.waitingMinutes >= 20 || (batch.preparingMinutes ?? 0) >= 25;
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
      setError(actionError instanceof Error ? actionError.message : "Kitchen supervision action failed.");
    }
  }

  return (
    <main className="mks-page">
      <header className="manager-module-header mks-header">
        <div>
          <span>Kitchen Supervision</span>
          <h1>Kitchen</h1>
        </div>
        <p>{restaurantName} - {managerName} supervises kitchen flow only</p>
      </header>

      <nav className="manager-tabs" aria-label="Kitchen module sections">
        {KITCHEN_TABS.map(([key, label]) => <button key={key} type="button" className={activeTab === key ? "active" : ""} onClick={() => setActiveTab(key)}>{label}</button>)}
      </nav>
      <label className="manager-tab-select">
        <span>Kitchen section</span>
        <select value={activeTab} onChange={(event) => setActiveTab(event.target.value as KitchenTab)}>
          {KITCHEN_TABS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>

      {(notice || error) && <div className={`mks-message ${error ? "error" : ""}`}>{error || notice}</div>}

      {activeTab === "performance" && <section className="mks-kpis" aria-label="Kitchen performance">
        <article><span>Current Workload</span><strong>{snapshot?.performance.currentWorkload ?? "idle"}</strong></article>
        <article><span>Average Ticket Time</span><strong>{fmtMinutes(snapshot?.performance.averageTicketMinutes ?? 0)}</strong></article>
        <article><span>Delayed Tickets</span><strong>{snapshot?.performance.delayedTickets ?? 0}</strong></article>
        <article><span>Rush Indicator</span><strong>{snapshot?.performance.rushIndicator ? "Yes" : "No"}</strong></article>
        <article><span>Bottleneck</span><strong>{snapshot?.performance.bottleneckIndicator ? "Yes" : "No"}</strong></article>
      </section>}

      {activeTab === "delayed" && (snapshot?.alerts.length ?? 0) > 0 && (
        <section className="mks-alerts" aria-label="Kitchen alerts">
          {(snapshot?.alerts ?? []).map((alert) => (
            <button key={alert.id} type="button" className={`mks-alert ${alert.severity}`} onClick={() => setSelectedStationId(alert.stationId)}>
              <strong>{alert.stationName}</strong>
              <span>{alert.message}</span>
            </button>
          ))}
        </section>
      )}

      {["stations", "queue", "preparing", "ready", "delayed"].includes(activeTab) && <section className="mks-layout">
        <div className="mks-stations">
          {(snapshot?.stations ?? []).map((station) => (
            <button className={`mks-station ${selectedStation?.id === station.id ? "selected" : ""} ${station.rush ? "rush" : ""} ${station.paused ? "paused" : ""}`} key={station.id} type="button" onClick={() => setSelectedStationId(station.id)} style={{ borderTopColor: station.color }}>
              <div><strong>{station.name}</strong><span>{station.currentWorkload}</span></div>
              <dl>
                <div><dt>Queue</dt><dd>{station.queueLength}</dd></div>
                <div><dt>Preparing</dt><dd>{station.preparing}</dd></div>
                <div><dt>Ready</dt><dd>{station.ready}</dd></div>
                <div><dt>Delayed</dt><dd>{station.delayed}</dd></div>
                <div><dt>Avg prep</dt><dd>{fmtMinutes(station.averagePreparationMinutes)}</dd></div>
                <div><dt>Active staff</dt><dd>{station.activeStaff}</dd></div>
              </dl>
            </button>
          ))}
        </div>

        <section className="mks-board">
          <div className="mks-board-head">
            <div>
              <span>Station Dashboard</span>
              <h2>{selectedStation?.name ?? "No station"}</h2>
              {selectedStation && <p>{selectedStation.activeStaffNames.length ? selectedStation.activeStaffNames.join(", ") : "No active cook assigned"}</p>}
            </div>
            {selectedStation && <div className="mks-head-actions">
              {selectedStation.paused ? (
                <button type="button" onClick={() => void runAction(() => setManagerKitchenStationPaused(restaurantId, selectedStation.id, false), "Station resumed.")}>Resume station</button>
              ) : (
                <button type="button" onClick={() => void runAction(() => setManagerKitchenStationPaused(restaurantId, selectedStation.id, true, "Manager pause"), "Station paused.")}>Pause station</button>
              )}
              <button type="button" onClick={() => void runAction(() => callAdditionalKitchenStaff(restaurantId, selectedStation.id, `Additional staff requested for ${selectedStation.name}`), "Additional kitchen staff called.")}>Call staff</button>
            </div>}
          </div>

          {selectedStation && (
            <form className="mks-message-form" onSubmit={(event) => {
              event.preventDefault();
              const trimmed = message.trim();
              if (!trimmed) return;
              void runAction(async () => {
                await sendManagerKitchenMessage(restaurantId, selectedStation.id, trimmed);
                setMessage("");
              }, "Message sent to kitchen.");
            }}>
              <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder={`Message ${selectedStation.name}`} />
              <button type="submit">Send message</button>
            </form>
          )}

          <div className="mks-batches">
            {displayedBatches.map((batch) => (
              <article className={`mks-batch ${batch.priority > 0 ? "priority" : ""} ${batch.waitingMinutes >= 20 || (batch.preparingMinutes ?? 0) >= 25 ? "delayed" : ""}`} key={`${batch.stationId}:${batch.orderId}`}>
                <div className="mks-batch-main">
                  <div>
                    <strong>{batch.displayNumber}</strong>
                    <span>Table {batch.tableNumber ?? "-"} · {batch.customerName || "Guest"}</span>
                  </div>
                  <em>{batch.status}</em>
                </div>
                <dl>
                  <div><dt>Items</dt><dd>{batch.itemCount}</dd></div>
                  <div><dt>Waiting</dt><dd>{fmtMinutes(batch.waitingMinutes)}</dd></div>
                  <div><dt>Preparing</dt><dd>{fmtMinutes(batch.preparingMinutes)}</dd></div>
                  <div><dt>Priority</dt><dd>{batch.priority}</dd></div>
                </dl>
                {batch.canManage && <div className="mks-batch-actions">
                  <button type="button" onClick={() => void runAction(() => prioritizeManagerKitchenOrder(restaurantId, batch.orderId), "Ticket prioritized.")}>Prioritize ticket</button>
                  <select defaultValue="" onChange={(event) => {
                    const destinationStationId = event.target.value;
                    if (!destinationStationId) return;
                    void runAction(() => reassignManagerKitchenBatch(restaurantId, batch.orderId, batch.stationId, destinationStationId), "Ticket reassigned.");
                    event.currentTarget.value = "";
                  }}>
                    <option value="">Reassign ticket</option>
                    {(snapshot?.stations ?? []).filter((station) => station.id !== batch.stationId && station.active && !station.paused).map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
                  </select>
                </div>}
              </article>
            ))}
            {displayedBatches.length === 0 && <p className="mks-empty">No tickets in this tab for this station.</p>}
          </div>
        </section>
      </section>}
    </main>
  );
}

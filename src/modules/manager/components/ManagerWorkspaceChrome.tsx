import { type ReactNode, useEffect, useState } from "react";
import { supabase } from "../../../core/database";
import "../styles/managerWorkspaceChrome.css";

type Props = {
  restaurantId: string;
  section: string;
  children: ReactNode;
};

export function ManagerWorkspaceChrome({ restaurantId, section, children }: Props) {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [realtimeState, setRealtimeState] = useState<"connecting" | "connected" | "reconnecting">("connecting");
  const [criticalCount, setCriticalCount] = useState(0);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => typeof Notification !== "undefined" && Notification.permission === "granted");
  const [connectionOpen, setConnectionOpen] = useState(false);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    let changeCount = 0;
    const notify = (message: string) => {
      changeCount += 1;
      setCriticalCount((count) => Math.min(99, count + 1));
      if (notificationsEnabled && typeof Notification !== "undefined" && document.hidden) {
        new Notification("ServeFlow Manager Alert", { body: message, tag: `serveflow-manager-${restaurantId}-${changeCount}` });
      }
    };

    const channel = supabase
      .channel(`manager-workspace-chrome:${restaurantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` }, () => notify("Dining sessions changed. Review live alerts."))
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items", filter: `restaurant_id=eq.${restaurantId}` }, () => notify("Kitchen queue changed."))
      .on("postgres_changes", { event: "*", schema: "public", table: "manager_customer_complaints", filter: `restaurant_id=eq.${restaurantId}` }, () => notify("Customer complaint status changed."))
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_staff", filter: `restaurant_id=eq.${restaurantId}` }, () => notify("Staff status changed."))
      .subscribe((status) => setRealtimeState(status === "SUBSCRIBED" ? "connected" : status === "CHANNEL_ERROR" || status === "TIMED_OUT" ? "reconnecting" : "connecting"));

    return () => { void supabase.removeChannel(channel); };
  }, [notificationsEnabled, restaurantId]);

  async function enableNotifications() {
    if (typeof Notification === "undefined") return;
    const permission = await Notification.requestPermission();
    setNotificationsEnabled(permission === "granted");
  }

  return (
    <div className={`mwc-shell ${section === "dashboard" ? "mwc-shell-overview" : ""}`}>
      <button className={`mwc-status-dot ${online ? realtimeState : "offline"}`} type="button" aria-label="Realtime status" onClick={() => setConnectionOpen((open) => !open)} />
      {connectionOpen && <div className={`mwc-status ${online ? realtimeState : "offline"}`}>
        <span>{online ? realtimeState === "connected" ? "Realtime connected" : "Realtime reconnecting" : "Offline mode"}</span>
        <button type="button" onClick={() => window.location.reload()}>Reconnect</button>
        {!notificationsEnabled && typeof Notification !== "undefined" && <button type="button" onClick={() => void enableNotifications()}>Enable notifications</button>}
      </div>}
      {criticalCount > 0 && <a className="mwc-critical" href="/manager/ai" onClick={() => setCriticalCount(0)}>{criticalCount} live update{criticalCount === 1 ? "" : "s"} need review</a>}
      {children}
    </div>
  );
}

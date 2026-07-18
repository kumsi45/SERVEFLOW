import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useRestaurantEvents } from "../../../core/realtime/useRestaurantEvents";
import "../styles/managerWorkspaceChrome.css";

type Props = {
  restaurantId: string;
  section: string;
  children: ReactNode;
};

export function ManagerWorkspaceChrome({
  restaurantId,
  section,
  children,
}: Props) {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [realtimeState, setRealtimeState] = useState<
    "connecting" | "connected" | "reconnecting"
  >("connecting");
  const [criticalCount, setCriticalCount] = useState(0);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () =>
      typeof Notification !== "undefined" &&
      Notification.permission === "granted",
  );
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

  const onRestaurantEvent = useCallback((event: { table: string }) => {
    if (!["orders", "order_items", "manager_customer_complaints", "restaurant_staff"].includes(event.table)) return;
      setCriticalCount((count) => Math.min(99, count + 1));
      if (
        notificationsEnabled &&
        typeof Notification !== "undefined" &&
        document.hidden
      ) {
        new Notification("ServeFlow Manager Alert", {
          body: "Restaurant operations changed. Review live alerts.",
          tag: `serveflow-manager-${restaurantId}`,
        });
      }
  }, [notificationsEnabled, restaurantId]);
  const centralRealtimeState = useRestaurantEvents({ restaurantId, onEvent: onRestaurantEvent });
  useEffect(() => setRealtimeState(centralRealtimeState), [centralRealtimeState]);

  async function enableNotifications() {
    if (typeof Notification === "undefined") return;
    const permission = await Notification.requestPermission();
    setNotificationsEnabled(permission === "granted");
  }

  return (
    <div
      className={`mwc-shell ${section === "dashboard" ? "mwc-shell-overview" : ""}`}
    >
      <button
        className={`mwc-status-dot ${online ? realtimeState : "offline"}`}
        type="button"
        aria-label="Realtime status"
        onClick={() => setConnectionOpen((open) => !open)}
      />
      {connectionOpen && (
        <div className={`mwc-status ${online ? realtimeState : "offline"}`}>
          <span>
            {online
              ? realtimeState === "connected"
                ? "Realtime connected"
                : "Realtime reconnecting"
              : "Offline mode"}
          </span>
          {!notificationsEnabled && typeof Notification !== "undefined" && (
            <button type="button" onClick={() => void enableNotifications()}>
              Enable notifications
            </button>
          )}
        </div>
      )}
      {criticalCount > 0 && (
        <a
          className="mwc-critical"
          href="/manager/ai"
          onClick={() => setCriticalCount(0)}
        >
          {criticalCount} live update{criticalCount === 1 ? "" : "s"} need
          review
        </a>
      )}
      {children}
    </div>
  );
}

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Bell, ChevronRight, X } from "lucide-react";
import { useRestaurantEvents } from "../../../core/realtime/useRestaurantEvents";
import type { RestaurantEvent } from "../../../core/realtime/restaurantEventService";
import {
  openManagerCopilot,
  presentManagerLiveUpdate,
  type ManagerLiveUpdate,
} from "../managerLiveUpdates";
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
  const [pendingUpdates, setPendingUpdates] = useState<ManagerLiveUpdate[]>([]);
  const [banner, setBanner] = useState<ManagerLiveUpdate | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () =>
      typeof Notification !== "undefined" &&
      Notification.permission === "granted",
  );
  const [connectionOpen, setConnectionOpen] = useState(false);
  const seenEventIds = useRef(new Set<string>());

  useEffect(() => {
    seenEventIds.current.clear();
    setPendingUpdates([]);
    setBanner(null);
  }, [restaurantId]);

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

  const onRestaurantEvent = useCallback(
    (event: RestaurantEvent) => {
      if (seenEventIds.current.has(event.id)) return;
      seenEventIds.current.add(event.id);
      if (seenEventIds.current.size > 200) {
        const oldest = seenEventIds.current.values().next().value;
        if (oldest) seenEventIds.current.delete(oldest);
      }
      window.dispatchEvent(
        new CustomEvent("serveflow:manager-data-changed", {
          detail: { table: event.table },
        }),
      );
      const update = presentManagerLiveUpdate(event);
      if (!update) return;
      setBanner(update);
      if (update.kind === "actionable") {
        setPendingUpdates((current) =>
          current.some((item) => item.id === update.id)
            ? current
            : [...current.slice(-19), update],
        );
      }
      if (
        update.kind === "actionable" &&
        notificationsEnabled &&
        typeof Notification !== "undefined" &&
        document.hidden
      ) {
        new Notification("ServeFlow Manager Alert", {
          body: update.title,
          tag: `serveflow-manager-${restaurantId}`,
        });
      }
    },
    [notificationsEnabled, restaurantId],
  );

  useEffect(() => {
    if (!banner) return;
    const timer = window.setTimeout(
      () => setBanner((current) => (current?.id === banner.id ? null : current)),
      banner.kind === "informational" ? 4000 : 7000,
    );
    return () => window.clearTimeout(timer);
  }, [banner]);

  function reviewUpdate(update: ManagerLiveUpdate) {
    setPendingUpdates((current) =>
      current.filter((item) => item.id !== update.id),
    );
    setBanner((current) => (current?.id === update.id ? null : current));
    openManagerCopilot({
      context: update.context,
      prompt: update.copilotPrompt,
      updateId: update.id,
    });
  }
  const centralRealtimeState = useRestaurantEvents({
    restaurantId,
    onEvent: onRestaurantEvent,
  });
  useEffect(
    () => setRealtimeState(centralRealtimeState),
    [centralRealtimeState],
  );

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
      {banner && (
        <div
          className={`mwc-live-banner ${banner.kind}`}
          role={banner.kind === "actionable" ? "alert" : "status"}
          aria-live={banner.kind === "actionable" ? "assertive" : "polite"}
        >
          <button type="button" onClick={() => reviewUpdate(banner)}>
            <Bell aria-hidden="true" />
            <span>{banner.title}</span>
            <ChevronRight aria-hidden="true" />
          </button>
          <button
            className="mwc-banner-dismiss"
            type="button"
            aria-label="Dismiss live update banner"
            onClick={() => setBanner(null)}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      )}
      {!banner && pendingUpdates.length > 0 && (
        <button
          className="mwc-review-badge"
          type="button"
          aria-label={`${pendingUpdates.length} live update${pendingUpdates.length === 1 ? "" : "s"} need review`}
          onClick={() => reviewUpdate(pendingUpdates[pendingUpdates.length - 1])}
        >
          <Bell aria-hidden="true" />
          <span>{Math.min(99, pendingUpdates.length)}</span>
        </button>
      )}
      {children}
    </div>
  );
}

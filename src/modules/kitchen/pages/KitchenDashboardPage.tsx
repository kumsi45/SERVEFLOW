import { useEffect, useMemo, useRef, useState } from "react";
import { getRestaurantEventStream } from "../../../core/realtime/restaurantEventService";
import { formatCurrency } from "../../../core/format/currency";
import {
  playNotificationTone,
  type RealtimeConnectionState,
} from "../../../core/realtime/realtimeNotifications";
import { signOutStaff } from "../../staff-auth/services/staffAuthService";
import {
  fetchKitchenDashboardContext,
  fetchStationKitchenOrders,
  markOrderCompleted,
  markOrderReady,
  startOrderPreparation,
} from "../services/kitchenOrderService";
import {
  createInventoryRequest,
  loadInventoryItems,
  type InventoryItem,
} from "../services/inventoryRequestService";
import type {
  KitchenDashboardContext,
  KitchenOrder,
  KitchenOrderItem,
  KitchenRestaurant,
} from "../types";
import "../styles/kitchenDashboard.css";

let activeKitchenCurrency: KitchenRestaurant | null = null;
function fmtMoney(v: number) {
  return formatCurrency(v, activeKitchenCurrency);
}
// ─── helpers ─────────────────────────────────────────────────────────────────
function fmtTicket(order: KitchenOrder) {
  return order.kitchenTicketNumber ?? order.displayNumber ?? "Kitchen ticket";
}
function fmtTime(iso: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
function elapsedMin(iso: string | null) {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}
function fmtElapsed(min: number) {
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${min % 60}m`;
}
function timeValue(iso: string | null) {
  return iso ? new Date(iso).getTime() : 0;
}
function useNow() {
  const [t, setT] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  return t;
}

// ─── types ───────────────────────────────────────────────────────────────────
type OrderRow = {
  id: string;
  display_number?: string | null;
  kitchen_ticket_number?: string | null;
  kitchen_batch_key?: string | null;
  status: string;
  customer_name: string | null;
  table_number: string | null;
  total_price: number | string;
  created_at: string;
  preparation_started_at: string | null;
  ready_marked_at: string | null;
};
type ItemRow = {
  id: string;
  order_id: string;
  quantity: number;
  price: number | string;
  notes?: string | null;
  appended_at?: string | null;
  menu_items?: { name?: string | null } | { name?: string | null }[] | null;
};

function normalizeOrder(
  row: OrderRow,
  items: KitchenOrderItem[] = [],
): KitchenOrder {
  return {
    id: row.id,
    displayNumber: row.display_number ?? null,
    kitchenTicketNumber: row.kitchen_ticket_number ?? null,
    kitchenBatchKey: row.kitchen_batch_key ?? null,
    status: row.status as KitchenOrder["status"],
    customerName: row.customer_name,
    tableNumber: row.table_number,
    totalPrice: Number(row.total_price),
    createdAt: row.created_at,
    preparationStartedAt: row.preparation_started_at,
    readyMarkedAt: row.ready_marked_at,
    items,
    stationProgress: [],
  };
}
function normalizeItem(row: ItemRow): KitchenOrderItem {
  const mi = row.menu_items;
  const name = Array.isArray(mi)
    ? (mi[0]?.name ?? "Item")
    : (mi?.name ?? "Item");
  return {
    id: row.id,
    orderId: row.order_id,
    name,
    quantity: row.quantity,
    price: Number(row.price),
    notes: row.notes ?? null,
    appendedAt: row.appended_at ?? null,
  };
}

// ─── Timer label ─────────────────────────────────────────────────────────────
function TimerLabel({ iso, _now }: { iso: string | null; _now: Date }) {
  if (!iso) return null;
  const min = elapsedMin(iso);
  const cls =
    min >= 25
      ? "kd-timer-urgent"
      : min >= 15
        ? "kd-timer-warning"
        : "kd-timer-normal";
  return <span className={`kd-ticket-timer ${cls}`}>⏱ {fmtElapsed(min)}</span>;
}

// ─── Order Ticket ─────────────────────────────────────────────────────────────
function kitchenTicketKey(order: KitchenOrder) {
  return `${order.id}:${order.kitchenBatchKey ?? "initial"}`;
}

function OrderTicket({
  order,
  actionId,
  onStart,
  onReady,
  onComplete,
  now,
}: {
  order: KitchenOrder;
  actionId: string | null;
  onStart?: () => void;
  onReady?: () => void;
  onComplete?: () => void;
  now: Date;
}) {
  const elapsed = elapsedMin(order.preparationStartedAt ?? order.createdAt);
  const isUrgent = elapsed >= 25;
  const isWarning = elapsed >= 15 && !isUrgent;
  const isBusy = actionId === kitchenTicketKey(order);
  const originalItems = order.items.filter((item) => !item.appendedAt);
  const appendedItems = order.items.filter((item) => item.appendedAt);
  const latestAppendTime = appendedItems.reduce<string | null>(
    (latest, item) => {
      if (!item.appendedAt) return latest;
      if (!latest || item.appendedAt > latest) return item.appendedAt;
      return latest;
    },
    null,
  );

  return (
    <div
      className={`kd-ticket${isUrgent ? " urgent" : isWarning ? " warning-age" : ""}`}
    >
      <div className="kd-ticket-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="kd-ticket-id">{fmtTicket(order)}</span>
          {isUrgent && <span className="kd-priority urgent">🔴 Urgent</span>}
        </div>
        <span className="kd-ticket-type kd-type-dine">🍽 Dine-in</span>
      </div>

      <div className="kd-ticket-meta">
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "3px 10px",
                borderRadius: 6,
                background: "var(--kd-new)",
                color: "#fff",
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase" as const,
              }}
            >
              TABLE {order.tableNumber || "—"}
            </span>
          </div>
          {order.customerName && (
            <div style={{ fontSize: 12, color: "var(--kd-muted)" }}>
              {order.customerName}
            </div>
          )}
          <div className="kd-ticket-table" style={{ marginTop: 2 }}>
            {fmtTime(order.createdAt)}
          </div>
        </div>
        <TimerLabel
          iso={order.preparationStartedAt ?? order.createdAt}
          _now={now}
        />
      </div>

      <div className="kd-ticket-items">
        {order.items.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--kd-muted)" }}>
            No item data
          </div>
        ) : (
          originalItems.map((item) => (
            <div key={item.id} className="kd-item-row">
              <div
                className={`kd-item-qty${isUrgent ? " kd-item-urgent-qty" : ""}`}
              >
                {item.quantity}
              </div>
              <div className="kd-item-name">{item.name}</div>
              <div className="kd-item-price">
                {fmtMoney(item.price * item.quantity)}
              </div>
            </div>
          ))
        )}
        {appendedItems.length > 0 && (
          <div className="kd-added-items">
            <div className="kd-added-header">
              <strong>NEW ITEMS RECEIVED</strong>
              {latestAppendTime && (
                <span>Received {fmtTime(latestAppendTime)}</span>
              )}
            </div>
            {appendedItems.map((item) => (
              <div key={item.id} className="kd-item-row kd-item-added">
                <div
                  className={`kd-item-qty${isUrgent ? " kd-item-urgent-qty" : ""}`}
                >
                  {item.quantity}
                </div>
                <div className="kd-item-name">{item.name}</div>
                <div className="kd-item-price">
                  {fmtMoney(item.price * item.quantity)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="kd-ticket-footer">
        <span className="kd-ticket-total">{fmtMoney(order.totalPrice)}</span>
      </div>

      {(onStart || onReady || onComplete) && (
        <div className="kd-ticket-actions">
          {onStart && (
            <button
              className="kd-action-primary start"
              onClick={onStart}
              disabled={isBusy}
            >
              {isBusy ? "Starting..." : "▶ Start Preparing"}
            </button>
          )}
          {onReady && (
            <button
              className="kd-action-primary ready"
              onClick={onReady}
              disabled={isBusy}
            >
              {isBusy ? "Marking..." : "✓ Mark Ready"}
            </button>
          )}
          {onComplete && (
            <button
              className="kd-action-primary ready"
              onClick={onComplete}
              disabled={isBusy}
            >
              {isBusy ? "Completing..." : "Complete Station"}
            </button>
          )}
          <button className="kd-action-secondary" title="Details">
            👁
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Kanban Column ─────────────────────────────────────────────────────────────
function KanbanCol({
  colKey,
  title,
  orders,
  actionId,
  onStart,
  onReady,
  onComplete,
  now,
}: {
  colKey: "new" | "preparing" | "ready";
  title: string;
  orders: KitchenOrder[];
  actionId: string | null;
  onStart?: (order: KitchenOrder) => void;
  onReady?: (order: KitchenOrder) => void;
  onComplete?: (order: KitchenOrder) => void;
  now: Date;
}) {
  const sorted = [...orders].sort((a, b) => {
    if (colKey === "new") {
      return timeValue(b.createdAt) - timeValue(a.createdAt);
    }

    if (colKey === "preparing") {
      return (
        timeValue(a.preparationStartedAt ?? a.createdAt) -
        timeValue(b.preparationStartedAt ?? b.createdAt)
      );
    }

    return (
      timeValue(a.readyMarkedAt ?? a.createdAt) -
      timeValue(b.readyMarkedAt ?? b.createdAt)
    );
  });

  return (
    <div className="kd-kanban-col">
      <div className={`kd-col-header ${colKey}`}>
        <div className="kd-col-title">
          {colKey === "new" && "🔵"} {colKey === "preparing" && "🟠"}{" "}
          {colKey === "ready" && "🟢"}
          {title}
        </div>
        <span className="kd-col-count">{orders.length}</span>
      </div>
      <div className="kd-col-body">
        {sorted.length === 0 ? (
          <div className="kd-empty">
            <div className="kd-empty-icon">
              {colKey === "new" ? "📭" : colKey === "preparing" ? "🍳" : "✅"}
            </div>
            <div className="kd-empty-msg">No orders here</div>
          </div>
        ) : (
          sorted.map((o) => (
            <OrderTicket
              key={kitchenTicketKey(o)}
              order={o}
              actionId={actionId}
              now={now}
              onStart={onStart ? () => onStart(o) : undefined}
              onReady={onReady ? () => onReady(o) : undefined}
              onComplete={onComplete ? () => onComplete(o) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
type KitchenDashboardPageProps = {
  restaurantId: string;
  restaurant: KitchenRestaurant;
};

export function KitchenDashboardPage({
  restaurantId,
  restaurant: initialRestaurant,
}: KitchenDashboardPageProps) {
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestForm, setRequestForm] = useState({
    inventoryItemId: "",
    itemName: "",
    quantity: "",
    unit: "",
    urgency: "normal",
    comment: "",
  });
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [requestNotice, setRequestNotice] = useState<string | null>(null);
  useEffect(() => {
    void loadInventoryItems(restaurantId)
      .then(setInventoryItems)
      .catch(() => setInventoryItems([]));
  }, [restaurantId]);
  const now = useNow();
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [restaurant, setRestaurant] =
    useState<KitchenRestaurant>(initialRestaurant);
  activeKitchenCurrency = restaurant;
  const [dashboardContext, setDashboardContext] =
    useState<KitchenDashboardContext | null>(null);
  const [selectedStationId, setSelectedStationId] = useState<"all" | string>(
    "all",
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [realtimeNotice, setRealtimeNotice] = useState<string | null>(null);
  const [realtimeState, setRealtimeState] =
    useState<RealtimeConnectionState>("connecting");
  const contextRef = useRef<KitchenDashboardContext | null>(null);
  const selectedStationRef = useRef<"all" | string>("all");
  const skipNextStationLoadRef = useRef(true);
  const knownKitchenTicketKeysRef = useRef<Set<string>>(new Set());
  const kitchenRealtimeReadyRef = useRef(false);
  const realtimeRefreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    contextRef.current = dashboardContext;
  }, [dashboardContext]);

  useEffect(() => {
    selectedStationRef.current = selectedStationId;
  }, [selectedStationId]);

  function applyKitchenOrders(rows: KitchenOrder[], notifyNewTickets: boolean) {
    const nextTicketKeys = new Set(rows.map(kitchenTicketKey));
    const newTicketCount = rows.filter(
      (order) =>
        !knownKitchenTicketKeysRef.current.has(kitchenTicketKey(order)),
    ).length;

    if (
      notifyNewTickets &&
      kitchenRealtimeReadyRef.current &&
      newTicketCount > 0
    ) {
      setRealtimeNotice(
        `${newTicketCount} new kitchen order${newTicketCount === 1 ? "" : "s"} received.`,
      );
      playNotificationTone("kitchen");
    }

    knownKitchenTicketKeysRef.current = nextTicketKeys;
    kitchenRealtimeReadyRef.current = true;
    setOrders(rows);
  }

  async function refreshStationOrders(
    logQueueView = false,
    notifyNewTickets = false,
  ) {
    const context = contextRef.current;
    if (!context) return;

    const selection = selectedStationRef.current;
    const includeAllStations = context.role === "owner" && selection === "all";
    const stationId = includeAllStations ? null : selection;
    const rows = await fetchStationKitchenOrders(
      restaurantId,
      stationId,
      includeAllStations,
      logQueueView,
    );
    applyKitchenOrders(rows, notifyNewTickets);
  }

  // ── load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const context = await fetchKitchenDashboardContext(restaurantId);
        if (!mounted) return;
        const nextSelection =
          context.role === "owner"
            ? selectedStationRef.current
            : (context.assignedStation?.id ?? "all");
        setRestaurant(context.restaurant);
        setDashboardContext(context);
        setSelectedStationId(nextSelection);
        contextRef.current = context;
        selectedStationRef.current = nextSelection;
        skipNextStationLoadRef.current = true;
        const includeAllStations =
          context.role === "owner" && nextSelection === "all";
        const stationId = includeAllStations ? null : nextSelection;
        const rows = await fetchStationKitchenOrders(
          restaurantId,
          stationId,
          includeAllStations,
          true,
        );
        if (mounted) applyKitchenOrders(rows, false);
      } catch (e) {
        if (mounted)
          setError(e instanceof Error ? e.message : "Could not load orders.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [restaurantId]);

  useEffect(() => {
    if (!dashboardContext) return;
    if (skipNextStationLoadRef.current) {
      skipNextStationLoadRef.current = false;
      return;
    }

    let mounted = true;
    const context = dashboardContext;
    async function loadOrdersForStation() {
      try {
        setError(null);
        const includeAllStations =
          context.role === "owner" && selectedStationId === "all";
        const stationId = includeAllStations ? null : selectedStationId;
        const rows = await fetchStationKitchenOrders(
          restaurantId,
          stationId,
          includeAllStations,
          true,
        );
        if (mounted) applyKitchenOrders(rows, false);
      } catch (e) {
        if (mounted)
          setError(e instanceof Error ? e.message : "Could not load orders.");
      }
    }

    void loadOrdersForStation();
    return () => {
      mounted = false;
    };
  }, [dashboardContext, restaurantId, selectedStationId]);

  // ── realtime ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!dashboardContext) return;

    const refresh = () => {
      if (realtimeRefreshTimerRef.current !== null)
        window.clearTimeout(realtimeRefreshTimerRef.current);
      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        realtimeRefreshTimerRef.current = null;
        void refreshStationOrders(false, true);
      }, 120);
    };
    const unsubscribe = getRestaurantEventStream(restaurantId).subscribe((event) => {
      if (!["orders", "order_items", "restaurant_tables"].includes(event.table)) return;
      if (event.table === "order_items") setRealtimeNotice("Kitchen queue updated.");
      refresh();
    }, (status) => {
      setRealtimeState(status);
      if (status === "connected" && kitchenRealtimeReadyRef.current) refresh();
    });
    return () => {
      if (realtimeRefreshTimerRef.current !== null)
        window.clearTimeout(realtimeRefreshTimerRef.current);
      realtimeRefreshTimerRef.current = null;
      unsubscribe();
    };
  }, [dashboardContext, restaurantId, selectedStationId]);

  // ── actions ────────────────────────────────────────────────────────────────
  async function handleStart(order: KitchenOrder) {
    try {
      const ticketKey = kitchenTicketKey(order);
      setActionId(ticketKey);
      const targetStationId =
        dashboardContext?.role === "owner" && selectedStationId !== "all"
          ? selectedStationId
          : null;
    console.log("START PREPARING");
       console.table({
    orderId: order.id,
    stationId: targetStationId,
    batchKey: order.kitchenBatchKey,
    status: order.status,
   });
      const updated = await startOrderPreparation(
        order.id,
        targetStationId,
        order.kitchenBatchKey,
      );
      setOrders((p) =>
        p.map((o) =>
          kitchenTicketKey(o) === ticketKey
            ? {
                ...o,
                ...updated,
                kitchenBatchKey: o.kitchenBatchKey,
                items: o.items,
              }
            : o,
        ),
      );
      await refreshStationOrders(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setActionId(null);
    }
  }
  async function handleReady(order: KitchenOrder) {
    try {
      const ticketKey = kitchenTicketKey(order);
      setActionId(ticketKey);
      const targetStationId =
        dashboardContext?.role === "owner" && selectedStationId !== "all"
          ? selectedStationId
          : null;
      const updated = await markOrderReady(
        order.id,
        targetStationId,
        order.kitchenBatchKey,
      );
      setOrders((p) =>
        p.map((o) =>
          kitchenTicketKey(o) === ticketKey
            ? {
                ...o,
                ...updated,
                kitchenBatchKey: o.kitchenBatchKey,
                items: o.items,
              }
            : o,
        ),
      );
      await refreshStationOrders(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setActionId(null);
    }
  }
  async function handleComplete(order: KitchenOrder) {
    try {
      const ticketKey = kitchenTicketKey(order);
      setActionId(ticketKey);
      const targetStationId =
        dashboardContext?.role === "owner" && selectedStationId !== "all"
          ? selectedStationId
          : null;
      await markOrderCompleted(
        order.id,
        targetStationId,
        order.kitchenBatchKey,
      );
      setOrders((p) => p.filter((o) => kitchenTicketKey(o) !== ticketKey));
      await refreshStationOrders(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setActionId(null);
    }
  }
  async function handleSignOut() {
    try {
      await signOutStaff();
    } finally {
      window.location.replace("/staff-login");
    }
  }

  // ── derived ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!search.trim()) return orders;
    const q = search.toLowerCase();
    return orders.filter(
      (o) =>
        o.id.toLowerCase().includes(q) ||
        (o.customerName ?? "").toLowerCase().includes(q) ||
        (o.tableNumber ?? "").toLowerCase().includes(q),
    );
  }, [orders, search]);

  const byStatus = useMemo(
    () => ({
      accepted: filtered.filter((o) => o.status === "accepted"),
      preparing: filtered.filter((o) => o.status === "preparing"),
      ready: filtered.filter((o) => o.status === "ready"),
    }),
    [filtered],
  );
  const canActOnStation =
    dashboardContext?.role === "kitchen" || selectedStationId !== "all";

  const totalActive = orders.length;
  const avgPrep = useMemo(() => {
    const done = orders.filter(
      (o) => o.preparationStartedAt && o.readyMarkedAt,
    );
    if (!done.length) return 0;
    return Math.round(
      done.reduce((s, o) => s + elapsedMin(o.preparationStartedAt!), 0) /
        done.length,
    );
  }, [orders]);

  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const stationLabel =
    dashboardContext?.role === "kitchen"
      ? (dashboardContext.assignedStation?.name ?? "Main Kitchen")
      : selectedStationId === "all"
        ? "All Stations"
        : (dashboardContext?.stations.find(
            (station) => station.id === selectedStationId,
          )?.name ?? "Station");

  return (
    <div className="kd-root">
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <header className="kd-header">
        {realtimeState !== "connected" ? (
          <div role="status" className="kd-realtime-state">
            Realtime reconnecting…
          </div>
        ) : null}
        <div className="kd-header-logo-area">
          <div className="kd-logo-mark">{restaurant.name.charAt(0)}</div>
          <div>
            <div className="kd-restaurant-name">{restaurant.name}</div>
            <div className="kd-kitchen-label">Kitchen Dashboard</div>
          </div>
        </div>
        <div className="kd-divider" />
        <div className="kd-status-pill">
          <span className="kd-status-dot" />
          ONLINE
        </div>
        <div className="kd-header-datetime">
          {dateStr} · {timeStr}
        </div>
        <div className="kd-header-search">
          <span className="kd-search-icon">🔍</span>
          <input
            placeholder="Search orders, tables..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search orders"
          />
        </div>
        <div className="kd-active-badge">🍽 {totalActive} ACTIVE</div>
        <div className="kd-header-actions">
          <button
            className="kd-signout-btn"
            onClick={() => setRequestOpen(true)}
          >
            Create Request
          </button>
          <button
            className="kd-icon-btn"
            aria-label="Notifications"
            onClick={() => setRealtimeNotice(null)}
          >
            🔔
            {realtimeNotice ? <span className="kd-notif-dot" /> : null}
          </button>
          <button
            className="kd-icon-btn"
            aria-label="Realtime reconnects automatically"
            disabled
          >
            ↻
          </button>
          <button className="kd-signout-btn" onClick={handleSignOut}>
            ⎋ Sign Out
          </button>
        </div>
      </header>

      {/* ── FILTER BAR ─────────────────────────────────────────────────── */}
      <div className="kd-filter-bar">
        <button className="kd-filter-btn active">All Types</button>
        <button className="kd-filter-btn">🍽 Dine-in</button>
        <button className="kd-filter-btn">🥡 Takeaway</button>
        <button className="kd-filter-btn">🛵 Delivery</button>
        <div className="kd-filter-sep" />
        <button className="kd-sort-btn">↕ Newest First</button>
      </div>

      {error && <div className="kd-error-banner">⚠️ {error}</div>}
      {realtimeNotice ? (
        <div className="kd-realtime-notice" role="status">
          <strong>{realtimeNotice}</strong>
          <button type="button" onClick={() => setRealtimeNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {/* ── BODY ───────────────────────────────────────────────────────── */}
      <div className="kd-station-bar">
        {dashboardContext?.role === "owner" ? (
          <label className="kd-station-picker">
            <span>Station</span>
            <select
              value={selectedStationId}
              onChange={(event) => setSelectedStationId(event.target.value)}
            >
              <option value="all">All Stations</option>
              {dashboardContext.stations.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="kd-station-lock">Station: {stationLabel}</div>
        )}
      </div>

      {loading ? (
        <div className="kd-loading">
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🍳</div>
            <div>Loading kitchen orders...</div>
          </div>
        </div>
      ) : (
        <div className="kd-body">
          {/* ── KANBAN ─────────────────────────────────────────────────── */}
          <div className="kd-kanban">
            <KanbanCol
              colKey="new"
              title="Accepted"
              orders={byStatus.accepted}
              actionId={actionId}
              onStart={canActOnStation ? handleStart : undefined}
              now={now}
            />
            <KanbanCol
              colKey="preparing"
              title="Preparing"
              orders={byStatus.preparing}
              actionId={actionId}
              onReady={canActOnStation ? handleReady : undefined}
              now={now}
            />
            <KanbanCol
              colKey="ready"
              title="Ready for Pickup"
              orders={byStatus.ready}
              actionId={actionId}
              onComplete={canActOnStation ? handleComplete : undefined}
              now={now}
            />
          </div>

          {/* ── SIDEBAR ────────────────────────────────────────────────── */}
          <aside className="kd-sidebar">
            <div className="kd-sidebar-header">📊 Live Stats</div>

            <div className="kd-sidebar-section">
              <div className="kd-sidebar-label">Kitchen Performance</div>
              <div className="kd-stat-row">
                <span className="kd-stat-label">Accepted</span>
                <span className="kd-stat-value blue">
                  {byStatus.accepted.length}
                </span>
              </div>
              <div className="kd-stat-row">
                <span className="kd-stat-label">Preparing</span>
                <span className="kd-stat-value orange">
                  {byStatus.preparing.length}
                </span>
              </div>
              <div className="kd-stat-row">
                <span className="kd-stat-label">Ready</span>
                <span className="kd-stat-value green">
                  {byStatus.ready.length}
                </span>
              </div>
              <div className="kd-stat-row">
                <span className="kd-stat-label">Avg Prep Time</span>
                <span className="kd-stat-value">
                  {avgPrep > 0 ? `${avgPrep}m` : "—"}
                </span>
              </div>
            </div>

            <div className="kd-sidebar-section">
              <div className="kd-sidebar-label">Active Staff</div>
              <div className="kd-staff-avatars">
                {["K", "C", "O"].map((l) => (
                  <div key={l} className="kd-staff-avatar">
                    {l}
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}
      {requestOpen && (
        <div className="kd-request-layer" onClick={() => setRequestOpen(false)}>
          <form
            className="kd-request-form"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void createInventoryRequest(restaurantId, {
                inventoryItemId: requestForm.inventoryItemId || null,
                itemName: requestForm.itemName,
                quantity: Number(requestForm.quantity),
                unit: requestForm.unit,
                urgency: requestForm.urgency as "normal" | "high" | "critical",
                stationId:
                  dashboardContext?.assignedStation?.id ??
                  (selectedStationId !== "all" ? selectedStationId : null),
                comment: requestForm.comment,
              })
                .then(() => {
                  setRequestNotice("Inventory request created.");
                  setRequestOpen(false);
                  setRequestForm({
                    inventoryItemId: "",
                    itemName: "",
                    quantity: "",
                    unit: "",
                    urgency: "normal",
                    comment: "",
                  });
                })
                .catch((e) =>
                  setError(e instanceof Error ? e.message : "Request failed."),
                );
            }}
          >
            <header>
              <div>
                <span>Kitchen Inventory</span>
                <h2>Create Request</h2>
              </div>
              <button type="button" onClick={() => setRequestOpen(false)}>
                Close
              </button>
            </header>
            {inventoryItems.length > 0 && (
              <label>
                Catalog Item
                <select
                  value={requestForm.inventoryItemId}
                  onChange={(e) => {
                    const item = inventoryItems.find(
                      (i) => i.id === e.target.value,
                    );
                    setRequestForm({
                      ...requestForm,
                      inventoryItemId: e.target.value,
                      itemName: item?.name ?? "",
                      unit: item?.unit ?? "",
                    });
                  }}
                >
                  <option value="">Choose catalog item</option>
                  {inventoryItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.currentQuantity} {item.unit}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Need
              <input
                required
                value={requestForm.itemName}
                onChange={(e) =>
                  setRequestForm({
                    ...requestForm,
                    itemName: e.target.value,
                    inventoryItemId: "",
                  })
                }
                placeholder="Milk"
              />
            </label>
            <div>
              <label>
                Quantity
                <input
                  required
                  min="0.001"
                  step="0.001"
                  type="number"
                  value={requestForm.quantity}
                  onChange={(e) =>
                    setRequestForm({ ...requestForm, quantity: e.target.value })
                  }
                />
              </label>
              <label>
                Unit
                <input
                  required
                  value={requestForm.unit}
                  onChange={(e) =>
                    setRequestForm({
                      ...requestForm,
                      unit: e.target.value,
                      inventoryItemId: "",
                    })
                  }
                  placeholder="L"
                />
              </label>
            </div>
            <label>
              Urgency
              <select
                value={requestForm.urgency}
                onChange={(e) =>
                  setRequestForm({ ...requestForm, urgency: e.target.value })
                }
              >
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <label>
              Station
              <input disabled value={stationLabel} />
            </label>
            <label>
              Comment
              <textarea
                maxLength={500}
                value={requestForm.comment}
                onChange={(e) =>
                  setRequestForm({ ...requestForm, comment: e.target.value })
                }
              />
            </label>
            <button type="submit">Submit Request</button>
          </form>
        </div>
      )}
      {requestNotice && (
        <div
          className="kd-request-notice"
          onClick={() => setRequestNotice(null)}
        >
          {requestNotice}
        </div>
      )}
    </div>
  );
}

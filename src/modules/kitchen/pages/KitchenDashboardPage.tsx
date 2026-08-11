import { useEffect, useMemo, useRef, useState } from "react";
import { getRestaurantEventStream } from "../../../core/realtime/restaurantEventService";
import { formatCurrency } from "../../../core/format/currency";
import { ServeFlowBrand } from "../../../core/presentation/ServeFlowBrand";
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
import {
  filterKitchenWorkspaceOrders,
  getKitchenOrderStationNames,
  getKitchenTicketIdentity,
  getKitchenTicketReceivedAt,
  sortKitchenWorkspaceOrders,
  trackNewKitchenTicketIdentities,
  type KitchenSortDirection,
} from "../kitchenWorkspace";
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
const kitchenQueueRealtimeTables = new Set([
  "orders",
  "order_items",
  "restaurant_tables",
]);

function isTerminalKitchenError(error: unknown) {
  return (
    error instanceof Error &&
    /^(Order closed\.|Batch completed\.)$/.test(error.message)
  );
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
  return getKitchenTicketIdentity(order);
}

type KitchenServiceType = "dine-in" | "takeaway" | "delivery";
type KitchenServiceFilter = "all" | KitchenServiceType;
type KitchenStateFilter = "all" | "accepted" | "preparing" | "ready";

function kitchenServiceType(order: KitchenOrder): KitchenServiceType {
  if (order.serviceType) return order.serviceType;
  return order.tableNumber ? "dine-in" : "takeaway";
}

function kitchenServiceLabel(serviceType: KitchenServiceType) {
  if (serviceType === "dine-in") return "Dine-in";
  if (serviceType === "delivery") return "Delivery";
  return "Takeaway";
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
  const receivedAt = getKitchenTicketReceivedAt(order);
  const elapsed = elapsedMin(receivedAt);
  const isUrgent = elapsed >= 25;
  const isWarning = elapsed >= 15 && !isUrgent;
  const isBusy = actionId === kitchenTicketKey(order);

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
            {fmtTime(receivedAt)}
          </div>
        </div>
        <TimerLabel
          iso={receivedAt}
          _now={now}
        />
      </div>

      <div className="kd-ticket-items">
        {order.items.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--kd-muted)" }}>
            No item data
          </div>
        ) : (
          order.items.map((item) => (
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
function KitchenOrderCard({
  order,
  actionId,
  canAct,
  onStart,
  onReady,
  onComplete,
}: {
  order: KitchenOrder;
  actionId: string | null;
  canAct: boolean;
  onStart: (order: KitchenOrder) => void;
  onReady: (order: KitchenOrder) => void;
  onComplete: (order: KitchenOrder) => void;
}) {
  const ticketKey = kitchenTicketKey(order);
  const isBusy = actionId === ticketKey;
  const receivedAt = getKitchenTicketReceivedAt(order);
  const elapsed = elapsedMin(receivedAt);
  const ageClass = elapsed >= 25 ? "urgent" : elapsed >= 15 ? "warning-age" : "";
  const timerClass =
    elapsed >= 25
      ? "kd-timer-urgent"
      : elapsed >= 15
        ? "kd-timer-warning"
        : "kd-timer-normal";
  const serviceType = kitchenServiceType(order);
  const stateLabel =
    order.status === "accepted"
      ? "New"
      : order.status === "preparing"
        ? "Preparing"
        : "Ready";
  const identifier = order.tableNumber
    ? `Table ${order.tableNumber}`
    : fmtTicket(order);
  const renderItem = (item: KitchenOrderItem) => (
    <div key={item.id} className="kd-card-item">
      <div className="kd-card-item-main">
        <strong>{item.quantity}x</strong>
        <span>{item.name}</span>
      </div>
      {item.notes ? (
        <div className="kd-card-instruction">
          <strong>Instruction:</strong> {item.notes}
        </div>
      ) : null}
    </div>
  );

  const action =
    order.status === "accepted"
      ? {
          label: isBusy ? "Starting..." : "Start Preparing",
          run: () => onStart(order),
        }
      : order.status === "preparing"
        ? {
            label: isBusy ? "Marking..." : "Mark Ready",
            run: () => onReady(order),
          }
        : {
            label: isBusy ? "Completing..." : "Complete Station",
            run: () => onComplete(order),
          };

  return (
    <article className={`kd-order-card status-${order.status} ${ageClass}`.trim()}>
      <header className="kd-card-header">
        <div className="kd-card-title">
          <h2>{identifier}</h2>
          <span className={`kd-state-badge ${order.status}`}>{stateLabel}</span>
        </div>
        <span className={`kd-card-timer ${timerClass}`}>
          {fmtElapsed(elapsed)}
        </span>
      </header>

      <div className="kd-card-context">
        <span className={`kd-service-badge ${serviceType}`}>
          {kitchenServiceLabel(serviceType)}
        </span>
        <time dateTime={receivedAt}>{fmtTime(receivedAt)}</time>
      </div>

      <div className="kd-card-items">
        {order.items.length === 0 ? (
          <div className="kd-card-item-empty">No item data</div>
        ) : (
          order.items.map((item) => renderItem(item))
        )}
      </div>

      <footer className="kd-card-action">
        <button
          type="button"
          className={`kd-context-action ${order.status}`}
          onClick={action.run}
          disabled={!canAct || isBusy}
          title={canAct ? undefined : "Select a station to update this order"}
        >
          {canAct ? action.label : "Select a station to continue"}
        </button>
      </footer>
    </article>
  );
}

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
  const [serviceFilter, setServiceFilter] =
    useState<KitchenServiceFilter>("all");
  const [stateFilter, setStateFilter] =
    useState<KitchenStateFilter>("all");
  const [sortDirection, setSortDirection] =
    useState<KitchenSortDirection>("oldest");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [realtimeNotice, setRealtimeNotice] = useState<string | null>(null);
  const [realtimeState, setRealtimeState] =
    useState<RealtimeConnectionState>("connecting");
  const contextRef = useRef<KitchenDashboardContext | null>(null);
  const selectedStationRef = useRef<"all" | string>("all");
  const skipNextStationLoadRef = useRef(true);
  const seenKitchenTicketKeysRef = useRef<Set<string>>(new Set());
  const kitchenRealtimeReadyRef = useRef(false);
  const realtimeRefreshTimerRef = useRef<number | null>(null);
  const actionLocksRef = useRef<Set<string>>(new Set());
  const sortControlRef = useRef<HTMLDivElement | null>(null);
  const sortTriggerRef = useRef<HTMLButtonElement | null>(null);
  const sortOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!sortMenuOpen) return;

    function closeWhenOutside(event: PointerEvent) {
      if (!sortControlRef.current?.contains(event.target as Node)) {
        setSortMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setSortMenuOpen(false);
      sortTriggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [sortMenuOpen]);

  useEffect(() => {
    contextRef.current = dashboardContext;
  }, [dashboardContext]);

  useEffect(() => {
    selectedStationRef.current = selectedStationId;
  }, [selectedStationId]);

  function applyKitchenOrders(rows: KitchenOrder[], notifyNewTickets: boolean) {
    const newTicketCount = trackNewKitchenTicketIdentities(
      rows,
      seenKitchenTicketKeysRef.current,
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
    const stationId = selection === "all" ? null : selection;
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
        const stationId = nextSelection === "all" ? null : nextSelection;
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
        const stationId = selectedStationId === "all" ? null : selectedStationId;
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
      const paymentEvent = event.type.startsWith("PAYMENT_");
      if (!kitchenQueueRealtimeTables.has(event.table) && !paymentEvent) return;
      if (event.table === "order_items" || paymentEvent)
        setRealtimeNotice("Kitchen queue updated.");
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
  function resolveActionStationId(order: KitchenOrder): string | null {
    if (dashboardContext?.role !== "owner") return null;
    if (selectedStationId !== "all") return selectedStationId;
    return (
      order.stationProgress[0]?.stationId ??
      order.items.find((item) => item.kitchenStationId)?.kitchenStationId ??
      null
    );
  }

  async function handleStart(order: KitchenOrder) {
    const ticketKey = kitchenTicketKey(order);
    if (actionLocksRef.current.has(ticketKey)) return;
    actionLocksRef.current.add(ticketKey);
    try {
      setActionId(ticketKey);
      const targetStationId = resolveActionStationId(order);
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
                stationProgress: o.stationProgress,
              }
            : o,
        ),
      );
      await refreshStationOrders(false);
    } catch (e) {
      if (isTerminalKitchenError(e)) {
        setOrders((p) => p.filter((o) => kitchenTicketKey(o) !== ticketKey));
        setError(null);
        await refreshStationOrders(false);
      } else {
        setError(e instanceof Error ? e.message : "Failed.");
      }
    } finally {
      actionLocksRef.current.delete(ticketKey);
      setActionId(null);
    }
  }
  async function handleReady(order: KitchenOrder) {
    const ticketKey = kitchenTicketKey(order);
    if (actionLocksRef.current.has(ticketKey)) return;
    actionLocksRef.current.add(ticketKey);
    try {
      setActionId(ticketKey);
      const targetStationId = resolveActionStationId(order);
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
                stationProgress: o.stationProgress,
              }
            : o,
        ),
      );
      await refreshStationOrders(false);
    } catch (e) {
      if (isTerminalKitchenError(e)) {
        setOrders((p) => p.filter((o) => kitchenTicketKey(o) !== ticketKey));
        setError(null);
        await refreshStationOrders(false);
      } else {
        setError(e instanceof Error ? e.message : "Failed.");
      }
    } finally {
      actionLocksRef.current.delete(ticketKey);
      setActionId(null);
    }
  }
  async function handleComplete(order: KitchenOrder) {
    const ticketKey = kitchenTicketKey(order);
    if (actionLocksRef.current.has(ticketKey)) return;
    actionLocksRef.current.add(ticketKey);
    try {
      setActionId(ticketKey);
      const targetStationId = resolveActionStationId(order);
      await markOrderCompleted(
        order.id,
        targetStationId,
        order.kitchenBatchKey,
      );
      setOrders((p) => p.filter((o) => kitchenTicketKey(o) !== ticketKey));
      await refreshStationOrders(false);
    } catch (e) {
      if (isTerminalKitchenError(e)) {
        setOrders((p) => p.filter((o) => kitchenTicketKey(o) !== ticketKey));
        setError(null);
        await refreshStationOrders(false);
      } else {
        setError(e instanceof Error ? e.message : "Failed.");
      }
    } finally {
      actionLocksRef.current.delete(ticketKey);
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
  const filteredByContext = useMemo(
    () =>
      filterKitchenWorkspaceOrders(orders, {
        stationId: selectedStationId,
        service: serviceFilter,
        state: "all",
        search,
      }),
    [orders, search, selectedStationId, serviceFilter],
  );

  const byStatus = useMemo(
    () => ({
      accepted: filteredByContext.filter((o) => o.status === "accepted"),
      preparing: filteredByContext.filter((o) => o.status === "preparing"),
      ready: filteredByContext.filter((o) => o.status === "ready"),
    }),
    [filteredByContext],
  );
  const visibleOrders = useMemo(() => {
    const filteredOrders = filterKitchenWorkspaceOrders(filteredByContext, {
      stationId: selectedStationId,
      service: serviceFilter,
      state: stateFilter,
      search,
    });

    return sortKitchenWorkspaceOrders(filteredOrders, sortDirection);
  }, [
    filteredByContext,
    search,
    selectedStationId,
    serviceFilter,
    sortDirection,
    stateFilter,
  ]);
  const totalActive = visibleOrders.length;

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
      ? (dashboardContext.assignedStation?.name ?? "Station not assigned")
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
          <ServeFlowBrand variant="compact" />
          <span className="kd-header-kitchen-context">
            Kitchen: {stationLabel}
          </span>
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
        <div className="kd-active-badge">
          <span /> {totalActive} Active
        </div>
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
      <div className="kd-filter-bar" aria-label="Kitchen queue filters">
        <div className="kd-filter-group">
          <span className="kd-filter-label">Service</span>
          {([
            ["all", "All"],
            ["dine-in", "Dine-in"],
            ["takeaway", "Takeaway"],
            ["delivery", "Delivery"],
          ] as const).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={`kd-filter-btn${serviceFilter === value ? " active" : ""}`}
              aria-pressed={serviceFilter === value}
              onClick={() => setServiceFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="kd-filter-group kd-state-filters">
          <span className="kd-filter-label">State</span>
          {([
            ["all", "All", filteredByContext.length],
            ["accepted", "New", byStatus.accepted.length],
            ["preparing", "Preparing", byStatus.preparing.length],
            ["ready", "Ready", byStatus.ready.length],
          ] as const).map(([value, label, count]) => (
            <button
              type="button"
              key={value}
              className={`kd-filter-btn state-${value}${stateFilter === value ? " active" : ""}`}
              aria-pressed={stateFilter === value}
              onClick={() => setStateFilter(value)}
            >
              {label} <strong>{count}</strong>
            </button>
          ))}
        </div>

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
          <div className="kd-station-context">Station: {stationLabel}</div>
        )}

        <div className="kd-sort-control" ref={sortControlRef}>
          <button
            type="button"
            ref={sortTriggerRef}
            className="kd-sort-trigger"
            aria-haspopup="menu"
            aria-expanded={sortMenuOpen}
            aria-controls="kitchen-sort-menu"
            onClick={() => setSortMenuOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              setSortMenuOpen(true);
              window.requestAnimationFrame(() => {
                const optionIndex = event.key === "ArrowUp" ? 1 : 0;
                sortOptionRefs.current[optionIndex]?.focus();
              });
            }}
          >
            <span>
              Sort: {sortDirection === "oldest" ? "Oldest First" : "Newest First"}
            </span>
            <span className="kd-sort-chevron" aria-hidden="true" />
          </button>
          {sortMenuOpen ? (
            <div
              id="kitchen-sort-menu"
              className="kd-sort-menu"
              role="menu"
              aria-label="Sort kitchen tickets"
            >
              {(["oldest", "newest"] as const).map((direction, index) => {
                const selected = sortDirection === direction;
                return (
                  <button
                    key={direction}
                    type="button"
                    ref={(element) => {
                      sortOptionRefs.current[index] = element;
                    }}
                    className={`kd-sort-option${selected ? " selected" : ""}`}
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => {
                      setSortDirection(direction);
                      setSortMenuOpen(false);
                      sortTriggerRef.current?.focus();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        const offset = event.key === "ArrowDown" ? 1 : -1;
                        sortOptionRefs.current[(index + offset + 2) % 2]?.focus();
                      } else if (event.key === "Home" || event.key === "End") {
                        event.preventDefault();
                        sortOptionRefs.current[event.key === "Home" ? 0 : 1]?.focus();
                      }
                    }}
                  >
                    <span className="kd-sort-check" aria-hidden="true">
                      {selected ? "✓" : ""}
                    </span>
                    {direction === "oldest" ? "Oldest First" : "Newest First"}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
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

      {loading ? (
        <div className="kd-loading">
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🍳</div>
            <div>Loading kitchen orders...</div>
          </div>
        </div>
      ) : (
        <main className="kd-order-workspace">
          <div className="kd-queue-summary">
            <div>
              <strong>{visibleOrders.length}</strong>
              <span>visible orders</span>
            </div>
            <p>
              {sortDirection === "oldest"
                ? "Oldest tickets appear first."
                : "Newest tickets appear first."}{" "}
              Select a state to focus the queue.
            </p>
          </div>
          {visibleOrders.length > 0 ? (
            <div className="kd-order-grid">
              {visibleOrders.map((order) => (
                <KitchenOrderCard
                  key={kitchenTicketKey(order)}
                  order={order}
                  actionId={actionId}
                  canAct={
                    dashboardContext?.role === "kitchen" ||
                    resolveActionStationId(order) !== null
                  }
                  onStart={handleStart}
                  onReady={handleReady}
                  onComplete={handleComplete}
                />
              ))}
            </div>
          ) : (
            <div className="kd-queue-empty">
              <strong>
                {selectedStationId === "all"
                  ? "Kitchen is clear"
                  : `No active orders for ${stationLabel}`}
              </strong>
              <span>
                {selectedStationId === "all"
                  ? "No active kitchen orders."
                  : "Try another service or state filter."}
              </span>
            </div>
          )}
        </main>
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

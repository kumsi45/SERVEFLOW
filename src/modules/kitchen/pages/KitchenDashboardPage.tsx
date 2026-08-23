import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { getRestaurantEventStream } from "../../../core/realtime/restaurantEventService";
import { formatCurrency } from "../../../core/format/currency";
import { ServeFlowBrand } from "../../../core/presentation/ServeFlowBrand";
import { useOperationalNotice } from "../../../core/presentation/useOperationalNotice";
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
  confirmKitchenStockReceipt,
  createInventoryRequest,
  kitchenReceiptErrorMessage,
  loadKitchenStockReceipts,
  materialRequestErrorMessage,
  searchInventoryItems,
  type InventoryItem,
  type KitchenStockReceipt,
  type MaterialRequestType,
} from "../services/inventoryRequestService";
import { KitchenStockRequestsPanel } from "../components/KitchenStockRequestsPanel";
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

const materialRequestTypes: { value: MaterialRequestType; label: string }[] = [
  { value: "ingredient", label: "Ingredient / Food Material" },
  { value: "supply", label: "Kitchen Supply" },
  { value: "tool", label: "Tool / Equipment" },
  { value: "cleaning", label: "Cleaning / Consumable" },
  { value: "other", label: "Other" },
];

const emptyMaterialRequest = () => ({
  requestType: "ingredient" as MaterialRequestType,
  inventoryItemId: "",
  itemName: "",
  quantity: "",
  unit: "",
  urgency: "normal" as "normal" | "high" | "critical",
  comment: "",
});

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
  const [requestForm, setRequestForm] = useState(emptyMaterialRequest);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [inventorySearch, setInventorySearch] = useState("");
  const [selectedInventoryItem, setSelectedInventoryItem] = useState<InventoryItem | null>(null);
  const [linkExistingItem, setLinkExistingItem] = useState(false);
  const [inventorySearchLoading, setInventorySearchLoading] = useState(false);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestNotice, setRequestNotice] = useState<string | null>(null);
  const [stockRequestsOpen, setStockRequestsOpen] = useState(false);
  const [stockReceipts, setStockReceipts] = useState<KitchenStockReceipt[]>([]);
  const [stockReceiptsLoading, setStockReceiptsLoading] = useState(true);
  const [stockReceiptsError, setStockReceiptsError] = useState<string | null>(null);
  const [confirmingReceiptId, setConfirmingReceiptId] = useState<string | null>(null);
  const usesInventorySelector=requestForm.requestType === "ingredient" || linkExistingItem;
  useEffect(() => {
    if (!requestOpen || !usesInventorySelector) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setInventorySearchLoading(true);
      void searchInventoryItems(restaurantId, inventorySearch)
        .then((items) => { if (active) setInventoryItems(items); })
        .catch(() => { if (active) setInventoryItems([]); })
        .finally(() => { if (active) setInventorySearchLoading(false); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [inventorySearch, requestOpen, restaurantId, usesInventorySelector]);
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
  const receiptActionLocksRef = useRef<Set<string>>(new Set());
  const sortControlRef = useRef<HTMLDivElement | null>(null);
  const sortTriggerRef = useRef<HTMLButtonElement | null>(null);
  const sortOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useOperationalNotice(requestNotice, setRequestNotice);
  useOperationalNotice(realtimeNotice, setRealtimeNotice);

  const refreshStockReceipts = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setStockReceiptsLoading(true);
      setStockReceiptsError(null);
      setStockReceipts(await loadKitchenStockReceipts(restaurantId));
    } catch {
      setStockReceiptsError("Unable to load stock requests. Try again.");
    } finally {
      setStockReceiptsLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    void refreshStockReceipts(true);
  }, [refreshStockReceipts]);

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
    if (context.role === "kitchen" && !context.assignedStation) {
      applyKitchenOrders([], notifyNewTickets);
      return;
    }

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
        if (context.role === "kitchen" && !context.assignedStation) {
          applyKitchenOrders([], false);
          return;
        }
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
        if (context.role === "kitchen" && !context.assignedStation) {
          if (mounted) applyKitchenOrders([], false);
          return;
        }
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
      if (event.table === "kitchen_inventory_requests") {
        setRealtimeNotice("Stock requests updated.");
        void refreshStockReceipts(false);
        return;
      }
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
  }, [dashboardContext, refreshStockReceipts, restaurantId, selectedStationId]);

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

  async function handleConfirmStockReceipt(receipt: KitchenStockReceipt) {
    if (receiptActionLocksRef.current.has(receipt.id)) return false;
    receiptActionLocksRef.current.add(receipt.id);
    setConfirmingReceiptId(receipt.id);
    setStockReceiptsError(null);
    try {
      await confirmKitchenStockReceipt(restaurantId, receipt.id);
      setRequestNotice(`${receipt.itemName} marked as received.`);
      await refreshStockReceipts(false);
      return true;
    } catch (cause) {
      const message = kitchenReceiptErrorMessage(cause);
      setStockReceiptsError(message);
      await refreshStockReceipts(false);
      if (message === "This request was already confirmed.") {
        setStockReceiptsError(message);
        return true;
      }
      setStockReceiptsError(message);
      return false;
    } finally {
      receiptActionLocksRef.current.delete(receipt.id);
      setConfirmingReceiptId(null);
    }
  }

  function resetMaterialRequest() {
    setRequestForm(emptyMaterialRequest());
    setInventorySearch("");
    setInventoryItems([]);
    setSelectedInventoryItem(null);
    setLinkExistingItem(false);
    setRequestError(null);
  }

  function closeMaterialRequest() {
    if (requestSubmitting) return;
    setRequestOpen(false);
    resetMaterialRequest();
  }

  function chooseInventoryItem(item: InventoryItem) {
    setSelectedInventoryItem(item);
    setInventorySearch(item.name);
    setRequestForm((current) => ({
      ...current,
      inventoryItemId: item.id,
      itemName: item.name,
      unit: item.unit,
    }));
    setRequestError(null);
  }

  async function handleCreateRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestError(null);
    const inventoryBacked = requestForm.requestType === "ingredient" || linkExistingItem;
    const quantity = Number(requestForm.quantity);
    if (inventoryBacked && !selectedInventoryItem) {
      setRequestError("Select an item.");
      return;
    }
    if (!inventoryBacked && !requestForm.itemName.trim()) {
      setRequestError("Enter a material name.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setRequestError("Enter a quantity greater than 0.");
      return;
    }
    if (!requestForm.unit.trim()) {
      setRequestError("Select a unit.");
      return;
    }
    if (dashboardContext?.role === "kitchen" && !dashboardContext.assignedStation) {
      setRequestError("Your Kitchen station is unavailable.");
      return;
    }

    setRequestSubmitting(true);
    try {
      await createInventoryRequest(restaurantId, {
        requestType: requestForm.requestType,
        inventoryItemId: selectedInventoryItem?.id ?? null,
        itemName: selectedInventoryItem?.name ?? requestForm.itemName.trim(),
        quantity,
        unit: selectedInventoryItem?.unit ?? requestForm.unit.trim(),
        urgency: requestForm.urgency,
        stationId:
          dashboardContext?.assignedStation?.id ??
          (selectedStationId !== "all" ? selectedStationId : null),
        comment: requestForm.comment.trim(),
      });
      setRequestNotice("Request submitted.");
      setRequestOpen(false);
      resetMaterialRequest();
    } catch (cause) {
      setRequestError(materialRequestErrorMessage(cause));
    } finally {
      setRequestSubmitting(false);
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
          <div className="kd-material-actions" aria-label="Kitchen material requests">
            <div className="kd-stock-requests-control">
            <button
              type="button"
              className="kd-stock-requests-trigger"
              aria-label={`${stockReceipts.filter((receipt) => receipt.status === "issued").length} stock requests waiting for confirmation`}
              aria-expanded={stockRequestsOpen}
              aria-controls="kitchen-stock-requests-panel"
              onClick={() => setStockRequestsOpen((open) => !open)}
            >
              Requests
              {stockReceipts.some((receipt) => receipt.status === "issued") ? (
                <span>{stockReceipts.filter((receipt) => receipt.status === "issued").length}</span>
              ) : null}
              <i aria-hidden="true">⌄</i>
            </button>
            <KitchenStockRequestsPanel
              open={stockRequestsOpen}
              receipts={stockReceipts}
              loading={stockReceiptsLoading}
              error={stockReceiptsError}
              confirmingId={confirmingReceiptId}
              onClose={() => setStockRequestsOpen(false)}
              onConfirm={handleConfirmStockReceipt}
            />
            </div>
            <button
              className="kd-signout-btn"
              onClick={() => setRequestOpen(true)}
            >
              Create Request
            </button>
          </div>
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
        <div className="kd-request-layer" onClick={closeMaterialRequest}>
          <form
            className="kd-request-form"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kitchen-create-request-title"
            onClick={(event) => event.stopPropagation()}
            onSubmit={handleCreateRequest}
          >
            <header className="kd-request-header">
              <div>
                <h2 id="kitchen-create-request-title">Create Request</h2>
                <p>Request a material for {stationLabel}.</p>
              </div>
              <button type="button" aria-label="Close Create Request" onClick={closeMaterialRequest}>
                ×
              </button>
            </header>

            <div className="kd-request-scroll">
              <label className="kd-request-field kd-request-wide">
                <span>Request Type</span>
                <select
                  value={requestForm.requestType}
                  onChange={(event) => {
                    const requestType=event.target.value as MaterialRequestType;
                    setRequestForm({ ...emptyMaterialRequest(), requestType });
                    setSelectedInventoryItem(null);
                    setInventorySearch("");
                    setLinkExistingItem(false);
                    setRequestError(null);
                  }}
                >
                  {materialRequestTypes.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </label>

              {requestForm.requestType !== "ingredient" ? (
                <label className="kd-request-link-toggle kd-request-wide">
                  <input
                    type="checkbox"
                    checked={linkExistingItem}
                    onChange={(event) => {
                      const checked=event.target.checked;
                      setLinkExistingItem(checked);
                      setSelectedInventoryItem(null);
                      setInventorySearch("");
                      setRequestForm((current) => ({ ...current, inventoryItemId: "", itemName: "", unit: "" }));
                    }}
                  />
                  <span>Use an existing inventory item <small>Optional</small></span>
                </label>
              ) : null}

              {usesInventorySelector ? (
                <div className="kd-request-field kd-request-wide">
                  <span>Item</span>
                  {selectedInventoryItem ? (
                    <div className="kd-request-selected-item">
                      <div><strong>{selectedInventoryItem.name}</strong><small>{selectedInventoryItem.unit}</small></div>
                      <button type="button" onClick={() => {
                        setSelectedInventoryItem(null);
                        setInventorySearch("");
                        setRequestForm((current) => ({ ...current, inventoryItemId: "", itemName: "", unit: "" }));
                      }}>Change</button>
                    </div>
                  ) : (
                    <div className="kd-request-item-search">
                      <input
                        type="search"
                        value={inventorySearch}
                        onChange={(event) => setInventorySearch(event.target.value)}
                        placeholder="Search inventory..."
                        aria-label="Search inventory items"
                        autoComplete="off"
                      />
                      <div className="kd-request-item-results" role="listbox" aria-label="Inventory items">
                        {inventorySearchLoading ? <span>Searching…</span> : inventoryItems.length ? inventoryItems.map((item) => (
                          <button type="button" role="option" aria-selected="false" key={item.id} onClick={() => chooseInventoryItem(item)}>
                            <strong>{item.name}</strong><small>{item.currentQuantity} {item.unit} available</small>
                          </button>
                        )) : <span>No matching items.</span>}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <label className="kd-request-field kd-request-wide">
                  <span>Material name</span>
                  <input
                    value={requestForm.itemName}
                    onChange={(event) => setRequestForm({ ...requestForm, itemName: event.target.value })}
                    placeholder="e.g. metal tray, gloves, detergent"
                    maxLength={120}
                  />
                </label>
              )}

              <label className="kd-request-field">
                <span>Quantity</span>
                <input
                  min="0.001"
                  step="0.001"
                  inputMode="decimal"
                  type="number"
                  value={requestForm.quantity}
                  onChange={(event) => setRequestForm({ ...requestForm, quantity: event.target.value })}
                  placeholder="2"
                />
              </label>
              <label className="kd-request-field">
                <span>Unit</span>
                {selectedInventoryItem ? (
                  <div className="kd-request-readonly">{selectedInventoryItem.unit}</div>
                ) : (
                  <>
                    <input
                      list="kitchen-material-units"
                      value={requestForm.unit}
                      onChange={(event) => setRequestForm({ ...requestForm, unit: event.target.value })}
                      placeholder="Select or enter unit"
                      maxLength={24}
                    />
                    <datalist id="kitchen-material-units">
                      {["piece", "pcs", "box", "pack", "roll", "bottle", "kg", "g", "L", "ml"].map((unit) => <option key={unit} value={unit} />)}
                    </datalist>
                  </>
                )}
              </label>

              <label className="kd-request-field">
                <span>Urgency</span>
                <select
                  value={requestForm.urgency}
                  onChange={(event) => setRequestForm({ ...requestForm, urgency: event.target.value as "normal" | "high" | "critical" })}
                >
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </label>
              <div className="kd-request-field">
                <span>Station</span>
                <div className="kd-request-readonly">{stationLabel}</div>
              </div>

              <label className="kd-request-field kd-request-wide">
                <span>Reason / Note <small>Optional</small></span>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={requestForm.comment}
                  onChange={(event) => setRequestForm({ ...requestForm, comment: event.target.value })}
                  placeholder="Add a short note..."
                />
              </label>
              {requestError ? <div className="kd-request-error kd-request-wide" role="alert">{requestError}</div> : null}
            </div>

            <footer className="kd-request-actions">
              <button type="button" onClick={closeMaterialRequest} disabled={requestSubmitting}>Cancel</button>
              <button type="submit" disabled={requestSubmitting}>
                {requestSubmitting ? "Submitting…" : "Submit Request"}
              </button>
            </footer>
          </form>
        </div>
      )}
      {(realtimeNotice || requestNotice) ? (
        <div className="kd-toast-stack" aria-live="polite" aria-atomic="true">
          {realtimeNotice ? <div className="kd-operation-toast" role="status"><span>{realtimeNotice}</span><button type="button" aria-label="Dismiss update" onClick={() => setRealtimeNotice(null)}>×</button></div> : null}
          {requestNotice ? <div className="kd-operation-toast success" role="status"><span>{requestNotice}</span><button type="button" aria-label="Dismiss success message" onClick={() => setRequestNotice(null)}>×</button></div> : null}
        </div>
      ) : null}
    </div>
  );
}

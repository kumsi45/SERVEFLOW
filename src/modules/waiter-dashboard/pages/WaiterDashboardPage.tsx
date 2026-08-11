import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getStoredWaiterSession,
  signInWaiter,
  signOutWaiter,
  switchWaiter,
  waiterSupabase,
} from "../../waiter-auth/services/waiterAuthService";
import { formatCurrency } from "../../../core/format/currency";
import { ServeFlowBrand } from "../../../core/presentation/ServeFlowBrand";
import { useTenantRealtime } from "../../../core/realtime/useTenantRealtime";
import {
  canonicalPaymentStatus,
  paymentLabel,
} from "../../../core/payment/lifecycle";
import {
  loadWaiterDashboardTables,
  loadWaiterSessionDetail,
  loadWaiterAssistanceRequests,
  loadWaiterTableMetrics,
  moveWaiterDiningSession,
  requestWaiterCancellation,
  requestWaiterFinalBill,
  resolveWaiterAssistanceRequest,
  splitWaiterBill,
  updateWaiterPendingItemNote,
} from "../services/waiterDashboardService";
import {
  activeWaiterAssistanceRequests,
  WAITER_ASSISTANCE_STALE_MS,
} from "../services/waiterAssistance";
import {
  buildWaiterTableCards,
  filterWaiterTableCards,
  waiterTableCounts,
  type WaiterTableFilter,
} from "../services/waiterTablesPresentation";
import type {
  WaiterDashboardSummary,
  WaiterDashboardTable,
  WaiterAssistanceRequest,
  WaiterSessionInvoice,
  WaiterSessionDetail,
  WaiterTableMetric,
} from "../types";
import "../styles/waiterDashboard.css";
import { syncWaiterOrderQueue } from "../../waiter-order/services/waiterOrderService";

type Props = { restaurantSlug: string };
type Connection = "connecting" | "connected" | "reconnecting";
type ProductivityView = "tables" | "orders";
type CancellationTarget =
  | { scope: "order"; detail: WaiterSessionDetail }
  | {
      scope: "item";
      detail: WaiterSessionDetail;
      item: WaiterSessionInvoice["items"][number];
    };
const IDLE_LOCK_MS = 5 * 60 * 1000;
const CANCELLATION_REASONS = [
  "Customer changed mind",
  "Wrong item entered",
  "Duplicate item",
  "Wrong table",
  "Customer requested different item",
  "Other",
] as const;

function summaryFrom(
  tables: WaiterDashboardTable[],
  slug: string,
): WaiterDashboardSummary | null {
  const first = tables[0];
  const stored = getStoredWaiterSession(slug);
  const currency = stored?.restaurant;
  if (first)
    return {
      restaurantId: first.restaurantId,
      restaurantSlug: first.restaurantSlug,
      restaurantName: first.restaurantName,
      restaurantLogoUrl: first.restaurantLogoUrl,
      waiterStaffId: first.waiterStaffId,
      waiterDisplayName: first.waiterDisplayName,
      currentShift: first.currentShift,
      assignmentMode: first.assignmentMode,
      currencyCode: currency?.currencyCode,
      currencySymbol: currency?.currencySymbol,
      locale: currency?.locale,
    };
  return stored
    ? {
        restaurantId: stored.restaurant.id,
        restaurantSlug: stored.restaurant.slug,
        restaurantName: stored.restaurant.name,
        restaurantLogoUrl: stored.restaurant.logoUrl,
        waiterStaffId: stored.staffId,
        waiterDisplayName: stored.displayName,
        currentShift: "Current Shift",
        assignmentMode: "assigned_tables",
        currencyCode: stored.restaurant.currencyCode,
        currencySymbol: stored.restaurant.currencySymbol,
        locale: stored.restaurant.locale,
      }
    : null;
}
function elapsed(iso: string | null, now: Date) {
  if (!iso) return "—";
  const mins = Math.max(
    0,
    Math.floor((now.getTime() - new Date(iso).getTime()) / 60000),
  );
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
function paymentReady(table: WaiterDashboardTable) {
  return table.activeOrderStatus === "pending_payment";
}
function visualStatus(table: WaiterDashboardTable) {
  if (table.tableStatus === "needs_attention") return "attention";
  if (table.tableStatus === "reserved") return "reserved";
  if (!table.activeOrderId) return "available";
  if (paymentReady(table)) return "payment";
  if (table.activeOrderSource === "public_qr" && table.assignedWaiterStaffId)
    return "mixed";
  if (table.activeOrderSource === "public_qr") return "qr";
  return "waiter";
}
function statusName(table: WaiterDashboardTable) {
  return (
    {
      available: "Available",
      qr: "QR Active",
      waiter: "Waiter Serving",
      mixed: "QR + Waiter",
      payment: "Ready for Payment",
      attention: "Needs Attention",
      reserved: "Reserved",
    } as const
  )[visualStatus(table)];
}
function sourceName(source: string) {
  return source === "public_qr"
    ? "Customer QR"
    : source === "waiter"
      ? "Waiter"
      : source === "cashier"
        ? "Cashier POS"
        : "Restaurant Order";
}
function paymentName(status: string) {
  return paymentLabel(status);
}
function sessionKitchenStatus(detail: WaiterSessionDetail) {
  const statuses = new Set(
    detail.invoices.map((invoice) => invoice.kitchenStatus),
  );
  if (statuses.size > 1) return "Mixed";
  const status = [...statuses][0];
  return status === "served"
    ? "Served"
    : status === "preparing"
      ? "Preparing"
      : status === "ready"
        ? "Ready"
        : status === "accepted"
          ? "Sent"
          : "Not released";
}
function sessionAllowsItems(detail: WaiterSessionDetail) {
  return (
    detail.diningSessionStatus === "open" &&
    detail.orderStatus !== "cancelled" &&
    detail.orderingAllowed
  );
}
function sessionServiceStatus(detail: WaiterSessionDetail) {
  if (!detail.orderingAllowed)
    return detail.orderingReason ?? "Ordering Locked";
  if (detail.billingStartedAt) return "Waiting Cashier · Ordering Available";
  if (detail.billRequestedAt) return "Bill Requested · Ordering Available";
  return "Ordering Available";
}
function sessionBatches(detail: WaiterSessionDetail) {
  const groups = new Map<
    string,
    WaiterSessionDetail["invoices"][number]["items"]
  >();
  for (const invoice of detail.invoices)
    for (const item of invoice.items) {
      const key = item.appendedAt ?? item.createdAt ?? invoice.createdAt;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
  return [...groups.entries()]
    .sort(
      ([left], [right]) => new Date(left).getTime() - new Date(right).getTime(),
    )
    .map(([createdAt, items], index) => {
      const statuses = items.map((item) => item.kitchenStatus);
      const paymentStatus = canonicalPaymentStatus(items[0]?.invoiceStatus);
      const status =
        paymentStatus === "pending" || paymentStatus === "held"
          ? paymentStatus
          : statuses.every((value) => value === "completed")
            ? "served"
            : statuses.some((value) => value === "preparing")
              ? "preparing"
              : statuses.every(
                    (value) => value === "ready" || value === "completed",
                  )
                ? "ready"
                : statuses.some((value) => value === "accepted")
                  ? "waiting"
                  : "accepted";
      return { number: index + 1, createdAt, items, status };
    });
}
function itemIcon(name: string) {
  const value = name.toLowerCase();
  if (value.includes("burger")) return "🍔";
  if (value.includes("coffee")) return "☕";
  if (value.includes("tea")) return "🍵";
  if (value.includes("water")) return "💧";
  if (value.includes("cake") || value.includes("dessert")) return "🍰";
  return "•";
}
function sessionOrderItems(detail: WaiterSessionDetail) {
  const grouped = new Map<
    string,
    {
      name: string;
      quantity: number;
      notes: string | null;
      total: number;
      cancellationRequested: boolean;
    }
  >();
  for (const item of detail.invoices.flatMap((invoice) => invoice.items)) {
    const key = `${item.name}:${item.notes ?? ""}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += item.quantity;
      existing.total += item.quantity * item.price;
      existing.cancellationRequested ||= Boolean(item.cancellationRequest);
    } else {
      grouped.set(key, {
        name: item.name,
        quantity: item.quantity,
        notes: item.notes,
        total: item.quantity * item.price,
        cancellationRequested: Boolean(item.cancellationRequest),
      });
    }
  }
  return [...grouped.values()];
}
function sessionKitchenItems(detail: WaiterSessionDetail) {
  return detail.invoices.flatMap((invoice) => invoice.items);
}
function readyKitchenItems(detail: WaiterSessionDetail) {
  return sessionKitchenItems(detail).filter(
    (item) => item.kitchenStatus === "ready",
  );
}
function canRequestItemCancellation(item: WaiterSessionInvoice["items"][number]) {
  return (
    !item.cancellationRequest &&
    !["completed", "served", "delivered", "cancelled", "voided"].includes(
      item.kitchenStatus,
    )
  );
}
function kitchenStatusName(status: string) {
  return status === "held"
    ? "Not released"
    : status === "paid" || status === "accepted"
      ? "Sent"
      : status === "preparing"
        ? "Preparing"
        : status === "ready"
          ? "Ready"
          : status === "completed"
            ? "Served"
            : status === "cancelled"
              ? "Cancelled"
              : status;
}
function playReadySound() {
  const AudioContextClass =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const gain = context.createGain();
  gain.connect(context.destination);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42);
  [740, 980].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    oscillator.start(context.currentTime + index * 0.14);
    oscillator.stop(context.currentTime + index * 0.14 + 0.18);
  });
  window.setTimeout(() => void context.close(), 700);
}
function navigateWaiter(path: string, replace = false) {
  replace
    ? window.history.replaceState({}, "", path)
    : window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function WaiterDashboardPage({ restaurantSlug }: Props) {
  const [tables, setTables] = useState<WaiterDashboardTable[]>([]);
  const [summary, setSummary] = useState<WaiterDashboardSummary | null>(() =>
    summaryFrom([], restaurantSlug),
  );
  const money = (value: number) => formatCurrency(value, summary);
  const [filter, setFilter] = useState<WaiterTableFilter>("all");
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionTable, setSessionTable] = useState<WaiterDashboardTable | null>(
    null,
  );
  const [sessionDetail, setSessionDetail] =
    useState<WaiterSessionDetail | null>(null);
  const [sessionDetailError, setSessionDetailError] = useState<string | null>(
    null,
  );
  const [metrics, setMetrics] = useState<Map<string, WaiterTableMetric>>(
    new Map(),
  );
  const [metricsHydrated, setMetricsHydrated] = useState(false);
  const [switchMode, setSwitchMode] = useState<"switch" | "unlock" | null>(null);
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [authWorking, setAuthWorking] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [assistanceRequests, setAssistanceRequests] = useState<WaiterAssistanceRequest[]>([]);
  const [resolvingAssistanceIds, setResolvingAssistanceIds] = useState<Set<string>>(new Set());
  const [readyAlerts, setReadyAlerts] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTargetId, setMoveTargetId] = useState("");
  const [moving, setMoving] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitQuantities, setSplitQuantities] = useState<Map<string, number>>(
    new Map(),
  );
  const [splitting, setSplitting] = useState(false);
  const [cancellationTarget, setCancellationTarget] =
    useState<CancellationTarget | null>(null);
  const [cancellationReason, setCancellationReason] =
    useState<(typeof CANCELLATION_REASONS)[number]>("Customer changed mind");
  const [cancellationNote, setCancellationNote] = useState("");
  const [requestingCancellation, setRequestingCancellation] = useState(false);
  const [requestingBill, setRequestingBill] = useState(false);
  const [billConfirmOpen, setBillConfirmOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [view, setView] = useState<ProductivityView>("tables");
  const [orderSearch, setOrderSearch] = useState("");
  const idleTimer = useRef<number | null>(null);
  const knownReadyRef = useRef<Set<string>>(new Set());
  const readyHydratedRef = useRef(false);
  const autoOpenedRef = useRef(false);
  const initialLoadStartedRef = useRef(false);

  const loadTables = useCallback(async () => {
    const rows = await loadWaiterDashboardTables(restaurantSlug);
    setTables(rows);
    setSummary(summaryFrom(rows, restaurantSlug));

    const restaurantId = rows[0]?.restaurantId;
    if (!restaurantId) {
      setAssistanceRequests([]);
      setMetrics(new Map());
      setMetricsHydrated(true);
      return;
    }

    void Promise.all([
      loadWaiterAssistanceRequests(restaurantId, rows.map((row) => row.tableId)),
      loadWaiterTableMetrics(
        rows.flatMap((row) => (row.activeOrderId ? [row.activeOrderId] : [])),
      ),
    ]).then(([requests, nextMetrics]) => {
      setAssistanceRequests(activeWaiterAssistanceRequests(
        requests,
        new Set(rows.map((row) => row.tableId)),
      ));
      const readyIds = new Set(
        rows
          .filter(
            (row) =>
              row.activeOrderId &&
              (nextMetrics.get(row.activeOrderId)?.readyItemCount ?? 0) > 0,
          )
          .map((row) => row.tableId),
      );
      const newlyReady = [...readyIds].filter(
        (id) => !knownReadyRef.current.has(id),
      );
      if (readyHydratedRef.current && newlyReady.length) {
        playReadySound();
        const readyTables = rows
          .filter((row) => newlyReady.includes(row.tableId))
          .map((row) => `Table ${row.tableNumber}`)
          .join(", ");
        setSessionNotice(`${readyTables} ready for service.`);
      }
      knownReadyRef.current = readyIds;
      readyHydratedRef.current = true;
      setReadyAlerts(readyIds);
      setMetrics(nextMetrics);
      setMetricsHydrated(true);
    }).catch(() => {
      setAssistanceRequests([]);
      setMetricsHydrated(true);
    });
  }, [restaurantSlug]);
  const exitWaiterSession = useCallback((reason?: "expired") => {
    const logout = signOutWaiter();
    setTables([]);
    setSummary(null);
    setAssistanceRequests([]);
    setSessionTable(null);
    setSessionDetail(null);
    setMetrics(new Map());
    setMetricsHydrated(false);
    setReadyAlerts(new Set());
    setSearch("");
    setOrderSearch("");
    setPin("");
    setUsername("");
    setAuthError(null);
    const suffix = reason === "expired" ? "?reason=expired" : "";
    navigateWaiter(`/waiter/${encodeURIComponent(restaurantSlug)}${suffix}`, true);
    void logout.catch(() => undefined);
  }, [restaurantSlug]);
  const connection: Connection = useTenantRealtime({
    channelName: "waiter-shared-tablet",
    restaurantId: summary?.restaurantId ?? "",
    tables: ["restaurant_tables", "restaurant_table_waiter_assignments", "orders", "order_items", "order_invoices", "order_cancellation_requests", "waiter_assistance_requests"],
    client: waiterSupabase,
    refreshOnConnect: false,
    refresh: () => loadTables().catch((e) => setError(e instanceof Error ? e.message : "Realtime update failed.")),
  });

  useEffect(() => {
    if (initialLoadStartedRef.current) return;
    initialLoadStartedRef.current = true;
    void loadTables()
      .catch((e) => {
        setError(
          e instanceof Error ? e.message : "Waiter dashboard unavailable.",
        );
      })
      .finally(() => setLoading(false));
  }, [loadTables]);
  useEffect(() => {
    if (!assistanceRequests.length) return;
    const nextExpiry = Math.min(
      ...assistanceRequests.map(
        (request) => Date.parse(request.requestedAt) + WAITER_ASSISTANCE_STALE_MS,
      ),
    );
    if (!Number.isFinite(nextExpiry)) return;
    const timer = window.setTimeout(() => {
      setAssistanceRequests((current) => activeWaiterAssistanceRequests(
        current,
        new Set(tables.map((table) => table.tableId)),
      ));
    }, Math.max(0, nextExpiry - Date.now() + 25));
    return () => window.clearTimeout(timer);
  }, [assistanceRequests, tables]);
  useEffect(() => {
    if (
      !loading &&
      sessionTable?.activeOrderId &&
      !tables.some(
        (table) => table.activeOrderId === sessionTable.activeOrderId,
      )
    ) {
      setSessionTable(null);
      setSessionNotice(
        "Payment complete. The table is ready for the next guest.",
      );
    }
  }, [loading, sessionTable, tables]);
  useEffect(() => {
    if (autoOpenedRef.current || !tables.length) return;
    const requested = new URLSearchParams(window.location.search).get("table");
    if (!requested) return;
    autoOpenedRef.current = true;
    const table = tables.find((row) => String(row.tableNumber) === requested);
    if (table?.activeOrderId) setSessionTable(table);
    window.history.replaceState({}, "", window.location.pathname);
  }, [tables]);
  useEffect(() => {
    const sync = () =>
      void syncWaiterOrderQueue(restaurantSlug)
        .then(() => loadTables())
        .catch(() => undefined);
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [loadTables, restaurantSlug]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const reset = () => {
      if (idleTimer.current !== null) clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => {
        exitWaiterSession("expired");
      }, IDLE_LOCK_MS);
    };
    for (const event of ["pointerdown", "keydown", "touchstart"] as const)
      window.addEventListener(event, reset, { passive: true });
    reset();
    return () => {
      for (const event of ["pointerdown", "keydown", "touchstart"] as const)
        window.removeEventListener(event, reset);
      if (idleTimer.current !== null) clearTimeout(idleTimer.current);
    };
  }, [exitWaiterSession]);
  useEffect(() => {
    if (!sessionTable?.activeOrderId) {
      setSessionDetail(null);
      setSessionDetailError(null);
      return;
    }
    setSessionDetail(null);
    setSessionDetailError(null);
    void loadWaiterSessionDetail(
      sessionTable.activeOrderId,
      sessionTable.restaurantId,
    )
      .then(setSessionDetail)
      .catch((e) =>
        setSessionDetailError(
          e instanceof Error ? e.message : "Session unavailable.",
        ),
      );
  }, [sessionTable?.activeOrderId, tables]);

  const enriched = useMemo(
    () =>
      tables.map((table) => {
        const metric = table.activeOrderId
          ? metrics.get(table.activeOrderId)
          : null;
        return {
          table,
          total: metric?.total ?? 0,
          invoices: metric?.invoiceCount ?? 0,
          itemCount: metric?.itemCount ?? 0,
          readyItems: metric?.readyItemCount ?? 0,
          lifecycleStatus: metric?.lifecycleStatus ?? "serving",
          sessionNumber: metric?.sessionNumber ?? null,
          invoiceNumbers: metric?.invoiceNumbers ?? [],
        };
      }),
    [metrics, tables],
  );
  const tableCards = useMemo(
    () => buildWaiterTableCards(tables, metrics),
    [metrics, tables],
  );
  const filtered = useMemo(
    () => filterWaiterTableCards(tableCards, filter, search),
    [filter, search, tableCards],
  );
  const tableCounts = useMemo(() => waiterTableCounts(tableCards), [tableCards]);
  const activeOrderCards = useMemo(
    () =>
      enriched.filter(
        ({ table, sessionNumber, invoiceNumbers }) =>
          table.activeOrderId &&
          (!orderSearch.trim() ||
            String(table.tableNumber).includes(orderSearch.trim()) ||
            (table.qrCustomerName ?? "")
              .toLowerCase()
              .includes(orderSearch.trim().toLowerCase()) ||
            (sessionNumber ?? "")
              .toLowerCase()
              .includes(orderSearch.trim().toLowerCase()) ||
            invoiceNumbers.some((number) =>
              number.toLowerCase().includes(orderSearch.trim().toLowerCase()),
            )),
      ),
    [enriched, orderSearch],
  );

  function openTable(table: WaiterDashboardTable) {
    if (table.activeOrderId) setSessionTable(table);
    else
      navigateWaiter(
        `/waiter/${encodeURIComponent(restaurantSlug)}/order/${table.tableNumber}`,
      );
  }
  function openAddItems(table: WaiterDashboardTable) {
    navigateWaiter(
      `/waiter/${encodeURIComponent(restaurantSlug)}/order/${encodeURIComponent(String(table.tableNumber))}`,
    );
  }
  async function authenticate() {
    try {
      setAuthWorking(true);
      setAuthError(null);
      const targetUsername = switchMode === "unlock"
        ? (getStoredWaiterSession(restaurantSlug)?.username ?? username)
        : username;
      const session = switchMode === "switch"
        ? await switchWaiter(restaurantSlug, targetUsername, pin)
        : await signInWaiter(restaurantSlug, targetUsername, pin);
      setSummary((old) => old ? { ...old, waiterStaffId: session.staffId, waiterDisplayName: session.displayName } : old);
      setSwitchMode(null);
      setPin("");
      setUsername("");
      await loadTables();
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "PIN was not accepted.");
    } finally {
      setAuthWorking(false);
    }
  }
  async function moveSession() {
    if (!sessionTable?.activeOrderId || !moveTargetId) return;
    const destination = tables.find((table) => table.tableId === moveTargetId);
    if (!destination) return;
    try {
      setMoving(true);
      setError(null);
      await moveWaiterDiningSession(sessionTable.activeOrderId, moveTargetId);
      setSessionNotice(
        `Dining session moved from Table ${sessionTable.tableNumber} to Table ${destination.tableNumber}.`,
      );
      setMoveOpen(false);
      setMoveTargetId("");
      setSessionTable(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not move this dining session.",
      );
    } finally {
      setMoving(false);
    }
  }
  async function splitBill() {
    if (
      !sessionTable?.activeOrderId ||
      ![...splitQuantities.values()].some(Boolean)
    )
      return;
    try {
      setSplitting(true);
      setError(null);
      await splitWaiterBill(
        sessionTable.activeOrderId,
        [...splitQuantities]
          .filter(([, quantity]) => quantity > 0)
          .map(([itemId, quantity]) => ({ itemId, quantity })),
      );
      setSessionNotice(
        "The selected quantities are now on a separate payment bill.",
      );
      setSplitOpen(false);
      setSplitQuantities(new Map());
      setSessionDetail(
        await loadWaiterSessionDetail(
          sessionTable.activeOrderId,
          sessionTable.restaurantId,
        ),
      );
      await loadTables();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not split this bill.");
    } finally {
      setSplitting(false);
    }
  }
  async function requestBill() {
    if (!sessionTable?.activeOrderId) return;
    try {
      setRequestingBill(true);
      setError(null);
      await requestWaiterFinalBill(sessionTable.activeOrderId);
      setBillConfirmOpen(false);
      setSessionNotice("BILL REQUESTED");
      setSessionDetail(
        await loadWaiterSessionDetail(
          sessionTable.activeOrderId,
          sessionTable.restaurantId,
        ),
      );
      await loadTables();
    } catch (e) {
      console.error(e);
      setError("Could not update. Try again.");
    } finally {
      setRequestingBill(false);
    }
  }
  async function editPendingItemNote(id: string, current: string | null) {
    const next = window.prompt("Item note", current ?? "");
    if (next === null) return;
    try {
      setError(null);
      await updateWaiterPendingItemNote(id, next);
      if (sessionTable?.activeOrderId)
        setSessionDetail(
          await loadWaiterSessionDetail(
            sessionTable.activeOrderId,
            sessionTable.restaurantId,
          ),
        );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not update the item note.",
      );
    }
  }
  async function resolveAssistance(request: WaiterAssistanceRequest) {
    if (resolvingAssistanceIds.has(request.id)) return;
    setResolvingAssistanceIds((current) => new Set(current).add(request.id));
    setAssistanceRequests((current) => current.filter((item) => item.id !== request.id));
    try {
      await resolveWaiterAssistanceRequest(request.id);
      void loadTables().catch(() => undefined);
    } catch {
      setAssistanceRequests((current) =>
        current.some((item) => item.id === request.id)
          ? current
          : [request, ...current],
      );
      setError("Could not update. Try again.");
    } finally {
      setResolvingAssistanceIds((current) => {
        const next = new Set(current);
        next.delete(request.id);
        return next;
      });
    }
  }
  function openCancellation(target: CancellationTarget) {
    setCancellationReason("Customer changed mind");
    setCancellationNote("");
    setMoreOpen(false);
    setCancellationTarget(target);
  }
  async function submitCancellationRequest() {
    if (!sessionTable?.activeOrderId || !cancellationTarget) return;
    if (cancellationReason === "Other" && !cancellationNote.trim()) {
      setError("Add a short explanation for Other.");
      return;
    }
    try {
      setRequestingCancellation(true);
      setError(null);
      await requestWaiterCancellation({
        orderId: sessionTable.activeOrderId,
        orderItemId:
          cancellationTarget.scope === "item"
            ? cancellationTarget.item.id
            : null,
        reason: cancellationReason,
        note: cancellationNote,
      });
      setCancellationTarget(null);
      setSessionNotice("Cancellation Requested. Waiting for review.");
      setSessionDetail(
        await loadWaiterSessionDetail(
          sessionTable.activeOrderId,
          sessionTable.restaurantId,
        ),
      );
      await loadTables();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not request cancellation review.",
      );
    } finally {
      setRequestingCancellation(false);
    }
  }

  const restaurant = summary?.restaurantName ?? "Restaurant";
  const waiter = summary?.waiterDisplayName ?? "Waiter";
  const waiterNameParts = waiter.trim().split(/\s+/);
  const waiterFirstName = waiterNameParts[waiterNameParts.length - 1] || waiter;
  const unpaidItems =
    sessionDetail?.invoices
      .filter(
        (invoice) =>
          canonicalPaymentStatus(invoice.status) === "pending" ||
          canonicalPaymentStatus(invoice.status) === "held",
      )
      .flatMap((invoice) => invoice.items) ?? [];
  const unpaidUnits = unpaidItems.reduce((sum, item) => sum + item.quantity, 0);
  const splitUnits = [...splitQuantities.values()].reduce(
    (sum, quantity) => sum + quantity,
    0,
  );
  const paidTotal =
    sessionDetail?.invoices
      .filter((invoice) => canonicalPaymentStatus(invoice.status) === "paid")
      .reduce((sum, invoice) => sum + invoice.total, 0) ?? 0;
  const pendingTotal =
    sessionDetail?.invoices
      .filter(
        (invoice) =>
          canonicalPaymentStatus(invoice.status) === "pending" ||
          canonicalPaymentStatus(invoice.status) === "held",
      )
      .reduce((sum, invoice) => sum + invoice.total, 0) ?? 0;
  const orderItems = sessionDetail ? sessionOrderItems(sessionDetail) : [];
  const kitchenItems = sessionDetail ? sessionKitchenItems(sessionDetail) : [];
  const readyItems = sessionDetail ? readyKitchenItems(sessionDetail) : [];
  const cancellableItems = kitchenItems.filter(canRequestItemCancellation);
  const orderCancellationRequested = Boolean(sessionDetail?.cancellationRequest);
  const orderCancellationAllowed = Boolean(
    sessionDetail &&
      !orderCancellationRequested &&
      sessionDetail.diningSessionStatus === "open" &&
      sessionDetail.orderStatus !== "closed" &&
      cancellableItems.length > 0,
  );
  const hasReadyItems = readyItems.length > 0;
  const billAlreadyRequested = Boolean(
    sessionDetail?.billRequestedAt || sessionDetail?.billingStartedAt,
  );
  return (
    <main className={`w2-page${sessionTable ? " session-open" : ""}`}>
      {!sessionTable ? (
        <header className="a2-header">
          <div className="a2-brand">
            <ServeFlowBrand variant="full" />
            <span aria-hidden="true" />
            <strong>{waiterFirstName}</strong>
          </div>
          <div className="a2-heading">
            <h1>My Tables</h1>
            <span>{tableCounts.all}</span>
          </div>
          <div className="a2-header-actions">
            <span className={`a2-connection ${connection}`}>
              <i aria-hidden="true" />
              {connection === "connected" ? "Online" : "Connecting"}
            </span>
            <button type="button" onClick={() => exitWaiterSession()}>
              Logout
            </button>
          </div>
        </header>
      ) : (
      <header className="w10-header">
        <div className="w2-brand">
          {summary?.restaurantLogoUrl ? (
            <img src={summary.restaurantLogoUrl} alt="" />
          ) : (
            <span>{restaurant[0]}</span>
          )}
          <div>
            <strong>Waiter Dashboard</strong>
            <small>
              {restaurant} · {waiter}
            </small>
          </div>
        </div>
        <time>
          {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </time>
      </header>
      )}
      {assistanceRequests.length ? (
        <section className="a2-assistance-alerts" aria-label="Active assistance requests">
          {assistanceRequests.map((request) => {
            const requestTable = tables.find((table) => table.tableId === request.tableId);
            if (!requestTable) return null;
            return (
              <div className="a2-assistance-alert" role="alert" key={request.id}>
                <span aria-hidden="true">🔔</span>
                <strong>TABLE {requestTable.tableNumber} NEEDS HELP</strong>
                <button
                  type="button"
                  disabled={resolvingAssistanceIds.has(request.id)}
                  onClick={() => void resolveAssistance(request)}
                  aria-label={`Resolve assistance request for Table ${requestTable.tableNumber}`}
                >
                  {resolvingAssistanceIds.has(request.id) ? "UPDATING" : "DONE"}
                </button>
              </div>
            );
          })}
        </section>
      ) : null}
      {sessionNotice && !sessionTable ? (
        <div className="a2-notice" role="alert">
          <span>🔔</span>
          <strong>{sessionNotice}</strong>
          <button onClick={() => setSessionNotice(null)} aria-label="Dismiss notification">×</button>
        </div>
      ) : null}
      {error && <div className="w2-error">{error}</div>}
      {view === "tables" ? (
        <>
          <section className="a2-tools" aria-label="Table filters">
            <div className="a2-filters">
              {([["all", "All"], ["free", "Free"], ["active", "Active"], ["ready", "Ready"], ["bill", "Bill"]] as Array<[WaiterTableFilter, string]>).map(([value, label]) => (
                <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)} aria-pressed={filter === value}>
                  <span>{label}</span>
                  {value === "all" || tableCounts[value] > 0 ? <b>{tableCounts[value]}</b> : null}
                </button>
              ))}
            </div>
            {tableCards.length > 10 ? (
              <label className="a2-search"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find table" aria-label="Find assigned table" /></label>
            ) : null}
          </section>
          {loading ? (
            <section className="a2-grid" aria-label="Loading assigned tables">{Array.from({ length: 8 }, (_, index) => <div className="a2-skeleton" key={index} />)}</section>
          ) : (
            <section className="a2-grid" aria-label="My assigned tables">
              {filtered.map(({ table, metric, state }) => {
                const label = ({ free: "Free", active: "Active", ready: "Ready", bill: "Bill" } as const)[state];
                return (
                  <button type="button" key={table.tableId} className={`a2-table ${state}`} onClick={() => openTable(table)} aria-label={`Table ${table.tableNumber}, ${label}`}>
                    <header><strong>{table.tableLabel || `Table ${table.tableNumber}`}</strong><span><i aria-hidden="true" />{label}</span></header>
                    {state === "free" ? (
                      <><strong className="a2-table-number">{table.tableNumber}</strong><span className="a2-table-action">＋ Order</span></>
                    ) : (
                      <div className="a2-table-detail">
                        <strong>{metricsHydrated && metric ? `${metric.itemCount} item${metric.itemCount === 1 ? "" : "s"}` : "Active order"}</strong>
                        {metricsHydrated && metric ? <b>{money(metric.total)}</b> : null}
                        {state === "ready" && metric?.readyItemCount ? <em>{metric.readyItemCount} ready</em> : null}
                        <time>{elapsed(table.activeOrderCreatedAt, now)}</time>
                      </div>
                    )}
                  </button>
                );
              })}
            </section>
          )}
          {!loading && !tableCards.length ? (
            <div className="a2-empty"><span aria-hidden="true">▦</span><strong>No tables assigned</strong><p>Ask your manager for a table assignment.</p></div>
          ) : !loading && !filtered.length ? (
            <div className="a2-empty compact"><strong>No tables match</strong></div>
          ) : null}
        </>
      ) : null}
      {view === "orders" ? (
        <section className="w10-orders">
          <label>
            <span>⌕</span>
            <input
              value={orderSearch}
              onChange={(event) => setOrderSearch(event.target.value)}
              placeholder="Search table, customer, invoice or order"
            />
          </label>
          <div>
            {activeOrderCards.map(
              ({ table, total, invoices, sessionNumber }) => (
                <button key={table.tableId} onClick={() => openTable(table)}>
                  <span>
                    <strong>Table {table.tableNumber}</strong>
                    <small>
                      {table.qrCustomerName ||
                        table.assignedWaiterName ||
                        "Guest"}
                    </small>
                  </span>
                  <span>
                    <strong>{sessionNumber || "Current Order"}</strong>
                    <small>
                      {invoices} order{invoices === 1 ? "" : "s"}
                    </small>
                  </span>
                  <b>{money(total)}</b>
                </button>
              ),
            )}
          </div>
          {!activeOrderCards.length ? (
            <div className="w2-state">No active orders match.</div>
          ) : null}
        </section>
      ) : null}
      {sessionTable && (
        <div className="w2-session w92-session a4-session">
          <header className="a4-session-header">
            <button type="button" onClick={() => setSessionTable(null)}>
              TABLES
            </button>
            <div>
              <strong>TABLE {sessionTable.tableNumber}</strong>
              <span>
                {hasReadyItems
                  ? "READY"
                  : sessionDetail?.billRequestedAt
                    ? "BILL"
                    : "ACTIVE"}
              </span>
            </div>
          </header>
          {!sessionDetail ? (
            <div className={`w2-state${sessionDetailError ? " error" : ""}`}>
              {sessionDetailError ? (
                <>
                  <strong>Could not update.</strong>
                  <span>Try again.</span>
                  <button
                    onClick={() =>
                      navigateWaiter(
                        `/waiter/${encodeURIComponent(restaurantSlug)}/order/${sessionTable.tableNumber}`,
                      )
                    }
                  >
                    + ADD ITEMS
                  </button>
                </>
              ) : (
                "Loading table..."
              )}
            </div>
          ) : (
            <div className="a4-body">
              <section className={`a4-table-hero${hasReadyItems ? " ready" : ""}`}>
                <div>
                  <span>TABLE {sessionTable.tableNumber}</span>
                  <strong>
                    {hasReadyItems
                      ? "READY"
                      : sessionDetail.billRequestedAt
                        ? "BILL REQUESTED"
                        : "ACTIVE"}
                  </strong>
                </div>
                <div className="a4-total">
                  <span>TOTAL</span>
                  <strong>{money(sessionDetail.total)}</strong>
                </div>
              </section>
              {sessionNotice ? (
                <div className="w92-notice" role="status">
                  {sessionNotice}
                  <button onClick={() => setSessionNotice(null)}>x</button>
                </div>
              ) : null}
              <div className="a4-columns">
                <section className="a4-panel a4-order-panel" aria-label="Order">
                  <h2>ORDER</h2>
                  <div className="a4-order-list">
                    {orderItems.map((item) => (
                      <article key={`${item.name}:${item.notes ?? ""}`}>
                        <span>
                          {item.quantity} x {item.name}
                          {item.cancellationRequested ? (
                            <small className="a4-cancel-state">
                              Cancellation Requested
                              <b>Waiting for review</b>
                            </small>
                          ) : null}
                        </span>
                        {item.notes ? <small>{item.notes}</small> : null}
                      </article>
                    ))}
                  </div>
                  {hasReadyItems ? (
                    <div className="a4-ready-box" role="status">
                      <strong>READY</strong>
                      <span>
                        {readyItems
                          .map((item) => `${item.name} x${item.quantity}`)
                          .join(", ")}
                      </span>
                    </div>
                  ) : null}
                </section>
              </div>
            </div>
          )}
          <footer className="a4-actions">
            <button
              type="button"
              className="primary"
              disabled={!sessionDetail || !sessionAllowsItems(sessionDetail)}
              onClick={() => openAddItems(sessionTable)}
            >
              + ADD ITEMS
            </button>
            <button
              type="button"
              className="bill"
              disabled={!sessionDetail || billAlreadyRequested || requestingBill}
              onClick={() => setBillConfirmOpen(true)}
            >
              {requestingBill
                ? "REQUESTING..."
                : billAlreadyRequested
                  ? "BILL REQUESTED"
                  : "REQUEST BILL"}
            </button>
            <button type="button" onClick={() => setMoreOpen((current) => !current)}>
              MORE
            </button>
          </footer>
          {moreOpen && sessionDetail ? (
            <aside className="a4-more" aria-label="More actions">
              <button
                type="button"
                disabled={unpaidUnits < 2}
                onClick={() => {
                  setSplitQuantities(new Map());
                  setMoreOpen(false);
                  setSplitOpen(true);
                }}
              >
                Split Bill
              </button>
              <button
                type="button"
                disabled={!sessionDetail.transferAllowed}
                title={sessionDetail.transferReason ?? "Transfer table"}
                onClick={() => {
                  setMoveTargetId("");
                  setMoreOpen(false);
                  setMoveOpen(true);
                }}
              >
                Transfer Table
              </button>
              <button
                type="button"
                disabled={!orderCancellationAllowed || !sessionDetail}
                onClick={() =>
                  sessionDetail
                    ? openCancellation({ scope: "order", detail: sessionDetail })
                    : undefined
                }
              >
                {orderCancellationRequested
                  ? "Cancellation Requested"
                  : "Request Order Cancellation"}
              </button>
              {kitchenItems.length ? (
                <div className="a4-more-items">
                  {kitchenItems
                    .map((item) => (
                      <article key={item.id}>
                        <span>
                          {item.name} x{item.quantity}
                          <small>
                            Kitchen: {kitchenStatusName(item.kitchenStatus)}
                          </small>
                          {item.cancellationRequest ? (
                            <small className="a4-cancel-state compact">
                              Cancellation Requested
                            </small>
                          ) : null}
                        </span>
                        {item.kitchenStatus === "held" ||
                        item.kitchenStatus === "accepted" ? (
                          <button
                            type="button"
                            onClick={() =>
                              void editPendingItemNote(item.id, item.notes)
                            }
                          >
                            Add Note
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={!sessionDetail || !canRequestItemCancellation(item)}
                          onClick={() =>
                            sessionDetail
                              ? openCancellation({
                                  scope: "item",
                                  detail: sessionDetail,
                                  item,
                                })
                              : undefined
                          }
                        >
                          {item.cancellationRequest
                            ? "Requested"
                            : "Request Cancellation"}
                        </button>
                      </article>
                    ))}
                </div>
              ) : null}
            </aside>
          ) : null}
        </div>
      )}
      {moveOpen && sessionTable ? (
        <div className="w2-overlay" onClick={() => setMoveOpen(false)}>
          <section
            className="w95-move"
            role="dialog"
            aria-modal="true"
            aria-label="Move dining session"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <small>Move entire dining session</small>
                <h2>Table {sessionTable.tableNumber} →</h2>
              </div>
              <button onClick={() => setMoveOpen(false)}>×</button>
            </header>
            <p>
              Invoices, item progress, and customer history stay
              attached to this session. No records will be copied.
            </p>
            <label>
              <span>Available destination table</span>
              <select
                value={moveTargetId}
                onChange={(event) => setMoveTargetId(event.target.value)}
              >
                <option value="">Select a table</option>
                {tables
                  .filter(
                    (table) =>
                      !table.activeOrderId &&
                      table.tableActive &&
                      table.tableId !== sessionTable.tableId,
                  )
                  .map((table) => (
                    <option key={table.tableId} value={table.tableId}>
                      Table {table.tableNumber}
                      {table.tableLabel ? ` · ${table.tableLabel}` : ""}
                    </option>
                  ))}
              </select>
            </label>
            <div className="w95-move-warning">
              The original table becomes available immediately after the move.
            </div>
            <div className="w95-move-actions">
              <button onClick={() => setMoveOpen(false)}>Cancel</button>
              <button
                className="primary"
                disabled={!moveTargetId || moving}
                onClick={() => void moveSession()}
              >
                {moving ? "Moving…" : "Confirm Move"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {billConfirmOpen && sessionTable && sessionDetail ? (
        <div className="w2-overlay" onClick={() => setBillConfirmOpen(false)}>
          <section
            className="a4-bill-confirm"
            role="dialog"
            aria-modal="true"
            aria-label="Request bill"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <span>TABLE {sessionTable.tableNumber}</span>
              <strong>{money(sessionDetail.total)}</strong>
            </header>
            <h2>Request bill?</h2>
            <div>
              <button type="button" onClick={() => setBillConfirmOpen(false)}>
                BACK
              </button>
              <button
                type="button"
                className="primary"
                disabled={requestingBill || billAlreadyRequested}
                onClick={() => void requestBill()}
              >
                {requestingBill ? "REQUESTING..." : "REQUEST"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {cancellationTarget && sessionTable ? (
        <div
          className="w2-overlay"
          onClick={() =>
            requestingCancellation ? undefined : setCancellationTarget(null)
          }
        >
          <section
            className="a4-cancel-modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              cancellationTarget.scope === "item"
                ? "Cancel order item"
                : "Cancel order"
            }
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <small>
                  {cancellationTarget.scope === "item"
                    ? "Cancel Order Item"
                    : "Cancel Order"}
                </small>
                <h2>Request Cancellation</h2>
              </div>
              <button
                type="button"
                disabled={requestingCancellation}
                onClick={() => setCancellationTarget(null)}
              >
                x
              </button>
            </header>
            <dl>
              <div>
                <dt>Table</dt>
                <dd>Table {sessionTable.tableNumber}</dd>
              </div>
              <div>
                <dt>Order</dt>
                <dd>#{cancellationTarget.detail.sessionNumber}</dd>
              </div>
              {cancellationTarget.scope === "item" ? (
                <div>
                  <dt>Item</dt>
                  <dd>
                    {cancellationTarget.item.quantity} x{" "}
                    {cancellationTarget.item.name}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>Current status</dt>
                <dd>
                  {cancellationTarget.scope === "item"
                    ? kitchenStatusName(cancellationTarget.item.kitchenStatus)
                    : kitchenStatusName(
                        cancellationTarget.detail.invoices[0]?.kitchenStatus ??
                          "mixed",
                      )}
                </dd>
              </div>
              <div>
                <dt>Payment</dt>
                <dd>
                  {cancellationTarget.scope === "item"
                    ? paymentName(cancellationTarget.item.invoiceStatus)
                    : cancellationTarget.detail.invoices
                        .map((invoice) => paymentName(invoice.status))
                        .filter((value, index, values) => values.indexOf(value) === index)
                        .join(", ")}
                </dd>
              </div>
            </dl>
            <label>
              <span>Cancellation Reason</span>
              <select
                value={cancellationReason}
                onChange={(event) =>
                  setCancellationReason(
                    event.target.value as (typeof CANCELLATION_REASONS)[number],
                  )
                }
              >
                {CANCELLATION_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>
                Note{" "}
                {cancellationReason === "Other" ? "(Required)" : "(Optional)"}
              </span>
              <textarea
                value={cancellationNote}
                maxLength={300}
                rows={3}
                onChange={(event) => setCancellationNote(event.target.value)}
                placeholder={
                  cancellationReason === "Other"
                    ? "Add a short explanation"
                    : "Add a short note"
                }
              />
            </label>
            <p>
              This sends a review request only. Payment, kitchen progress, and
              the service location remain unchanged.
            </p>
            <div>
              <button
                type="button"
                disabled={requestingCancellation}
                onClick={() => setCancellationTarget(null)}
              >
                Back
              </button>
              <button
                type="button"
                className="primary"
                disabled={
                  requestingCancellation ||
                  (cancellationReason === "Other" && !cancellationNote.trim())
                }
                onClick={() => void submitCancellationRequest()}
              >
                {requestingCancellation
                  ? "Requesting..."
                  : "Request Cancellation"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {splitOpen && sessionTable && sessionDetail ? (
        <div className="w2-overlay" onClick={() => setSplitOpen(false)}>
          <section
            className="w95-move w106-split"
            role="dialog"
            aria-modal="true"
            aria-label="Split bill"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <small>Split Bill</small>
                <h2>Table {sessionTable.tableNumber}</h2>
              </div>
              <button onClick={() => setSplitOpen(false)}>×</button>
            </header>
            <p>
              Choose how many of each item should move to the second bill. The
              table record and item progress remain unchanged.
            </p>
            <div className="w106-split-items">
              {unpaidItems.map((item) => {
                const selected = splitQuantities.get(item.id) ?? 0;
                return (
                  <article key={item.id}>
                    <span>
                      <strong>{item.name}</strong>
                      <small>
                        {item.quantity} ordered · {money(item.price)} each
                      </small>
                    </span>
                    <div>
                      <button
                        onClick={() =>
                          setSplitQuantities((current) => {
                            const next = new Map(current);
                            next.set(item.id, Math.max(0, selected - 1));
                            return next;
                          })
                        }
                      >
                        −
                      </button>
                      <b>{selected}</b>
                      <button
                        onClick={() =>
                          setSplitQuantities((current) => {
                            const next = new Map(current);
                            next.set(
                              item.id,
                              Math.min(item.quantity, selected + 1),
                            );
                            return next;
                          })
                        }
                      >
                        +
                      </button>
                    </div>
                    <strong>{money(selected * item.price)}</strong>
                  </article>
                );
              })}
            </div>
            <div className="w95-move-warning">
              Moving {splitUnits} of {unpaidUnits} item(s). At least one item
              must remain on the original bill.
            </div>
            <div className="w95-move-actions">
              <button onClick={() => setSplitOpen(false)}>Cancel</button>
              <button
                className="primary"
                disabled={
                  splitUnits < 1 || splitUnits >= unpaidUnits || splitting
                }
                onClick={() => void splitBill()}
              >
                {splitting ? "Splitting…" : "Confirm Split"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {switchMode && (
        <div className="w2-lock">
          <section>
            <span className="w2-lock-icon">▣</span>
            <small>
              {switchMode === "unlock"
                ? "TABLET LOCKED"
                : "SECURE WAITER HAND-OFF"}
            </small>
            <h1>
              {switchMode === "unlock"
                ? `Welcome back, ${waiter}`
                : "Switch Waiter"}
            </h1>
            <p>
              {switchMode === "unlock"
                ? "Enter your PIN to continue. Active tables remain open."
                : "Enter the next waiter’s username and PIN."}
            </p>
            {switchMode === "switch" && (
              <input
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Waiter username"
                autoComplete="username"
              />
            )}
            <div className="w2-pin-dots">
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <i key={n} className={pin.length > n ? "filled" : ""} />
              ))}
            </div>
            <div className="w2-keypad">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <button
                  key={n}
                  onClick={() => setPin((p) => (p + n).slice(0, 6))}
                >
                  {n}
                </button>
              ))}
              <button className="clear" onClick={() => setPin("")}>
                Clear
              </button>
              <button onClick={() => setPin((p) => (p + "0").slice(0, 6))}>
                0
              </button>
              <button
                className="submit"
                disabled={
                  authWorking ||
                  pin.length < 4 ||
                  (switchMode === "switch" && !username.trim())
                }
                onClick={() => void authenticate()}
              >
                ✓
              </button>
            </div>
            {authError && <div className="w2-error">{authError}</div>}
            {switchMode === "switch" && (
              <button className="w2-cancel" onClick={() => setSwitchMode(null)}>
                Cancel and return to Tables
              </button>
            )}
          </section>
        </div>
      )}
      {sessionTable ? (
      <button
        className="w106-logout"
        onClick={() => exitWaiterSession()}
      >
        ↪ <span>Logout</span>
      </button>
      ) : null}
    </main>
  );
}

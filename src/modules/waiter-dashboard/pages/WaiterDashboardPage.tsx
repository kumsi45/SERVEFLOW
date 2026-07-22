import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getStoredWaiterSession,
  signInWaiter,
  signOutWaiter,
  switchWaiter,
  waiterSupabase,
} from "../../waiter-auth/services/waiterAuthService";
import { formatCurrency } from "../../../core/format/currency";
import { useTenantRealtime } from "../../../core/realtime/useTenantRealtime";
import {
  canonicalPaymentStatus,
  paymentLabel,
} from "../../../core/payment/lifecycle";
import {
  loadWaiterDashboardTables,
  loadWaiterSessionDetail,
  loadWaiterTableMetrics,
  markWaiterOrderServed,
  moveWaiterDiningSession,
  requestWaiterFinalBill,
  splitWaiterBill,
  updateWaiterPendingItem,
  updateWaiterPendingItemNote,
} from "../services/waiterDashboardService";
import type {
  WaiterDashboardSummary,
  WaiterDashboardTable,
  WaiterSessionDetail,
  WaiterTableMetric,
} from "../types";
import "../styles/waiterDashboard.css";
import { syncWaiterOrderQueue } from "../../waiter-order/services/waiterOrderService";

type Props = { restaurantSlug: string };
type Filter =
  | "all"
  | "available"
  | "occupied"
  | "qr"
  | "waiter"
  | "payment"
  | "attention"
  | "reserved";
type Connection = "connecting" | "connected" | "reconnecting";
type ProductivityView = "tables" | "orders";
const IDLE_LOCK_MS = 5 * 60 * 1000;

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
        assignmentMode: "all_tables",
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
          ? "Waiting Kitchen"
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
  const [filter, setFilter] = useState<Filter>("all");
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
  const [switchMode, setSwitchMode] = useState<"switch" | "unlock" | null>(null);
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [authWorking, setAuthWorking] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [readyAlerts, setReadyAlerts] = useState<Set<string>>(new Set());
  const [serving, setServing] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTargetId, setMoveTargetId] = useState("");
  const [moving, setMoving] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitQuantities, setSplitQuantities] = useState<Map<string, number>>(
    new Map(),
  );
  const [splitting, setSplitting] = useState(false);
  const [requestingBill, setRequestingBill] = useState(false);
  const [view, setView] = useState<ProductivityView>("tables");
  const [orderSearch, setOrderSearch] = useState("");
  const idleTimer = useRef<number | null>(null);
  const knownReadyRef = useRef<Set<string>>(new Set());
  const readyHydratedRef = useRef(false);
  const autoOpenedRef = useRef(false);

  const loadTables = useCallback(async () => {
    const rows = await loadWaiterDashboardTables(restaurantSlug);
    const nextMetrics = await loadWaiterTableMetrics(
      rows.flatMap((row) => (row.activeOrderId ? [row.activeOrderId] : [])),
    );
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
    setTables(rows);
    setMetrics(nextMetrics);
    setSummary(summaryFrom(rows, restaurantSlug));
  }, [restaurantSlug]);
  const connection: Connection = useTenantRealtime({
    channelName: "waiter-shared-tablet",
    restaurantId: summary?.restaurantId ?? "",
    tables: ["restaurant_tables", "restaurant_table_waiter_assignments", "orders", "order_items", "order_invoices"],
    client: waiterSupabase,
    refresh: () => loadTables().catch((e) => setError(e instanceof Error ? e.message : "Realtime update failed.")),
  });

  useEffect(() => {
    void loadTables()
      .catch((e) => {
        setError(
          e instanceof Error ? e.message : "Waiter dashboard unavailable.",
        );
      })
      .finally(() => setLoading(false));
  }, [loadTables]);
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
    if (navigator.onLine) sync();
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
        void signOutWaiter().finally(() =>
          navigateWaiter(
            `/waiter/${encodeURIComponent(restaurantSlug)}?reason=expired`,
            true,
          ),
        );
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
  }, [restaurantSlug]);
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
  const filtered = useMemo(
    () =>
      enriched.filter(({ table, sessionNumber, invoiceNumbers }) => {
        const state = visualStatus(table);
        const q = search.trim().toLowerCase();
        const filterMatch =
          filter === "all" ||
          (filter === "occupied"
            ? state !== "available" && state !== "reserved"
            : filter === "attention"
              ? readyAlerts.has(table.tableId)
              : filter === "payment"
                ? state === "payment"
                : state === filter);
        const searchMatch =
          !q ||
          String(table.tableNumber).includes(q) ||
          (sessionNumber ?? table.activeOrderId ?? "")
            .toLowerCase()
            .includes(q) ||
          invoiceNumbers.some((number) => number.toLowerCase().includes(q)) ||
          (table.qrCustomerName ?? "").toLowerCase().includes(q) ||
          (table.tableLabel ?? "").toLowerCase().includes(q);
        return filterMatch && searchMatch;
      }),
    [enriched, filter, readyAlerts, search],
  );
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
  async function markServed() {
    if (!sessionTable?.activeOrderId) return;
    try {
      setServing(true);
      setError(null);
      await markWaiterOrderServed(sessionTable.activeOrderId);
      setSessionNotice(`Table ${sessionTable.tableNumber} marked served.`);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not mark this order served.",
      );
    } finally {
      setServing(false);
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
      await requestWaiterFinalBill(sessionTable.activeOrderId);
      setSessionNotice(`Table ${sessionTable.tableNumber} is ready to bill.`);
      await loadTables();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not request the final bill.",
      );
    } finally {
      setRequestingBill(false);
    }
  }
  async function editPendingItem(id: string, quantity: number) {
    try {
      setError(null);
      await updateWaiterPendingItem(id, quantity);
      if (sessionTable?.activeOrderId)
        setSessionDetail(
          await loadWaiterSessionDetail(
            sessionTable.activeOrderId,
            sessionTable.restaurantId,
          ),
        );
      await loadTables();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not update pending item.",
      );
    }
  }
  async function editPendingItemNote(id: string, current: string | null) {
    const next = window.prompt("Kitchen note", current ?? "");
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

  const restaurant = summary?.restaurantName ?? "Restaurant";
  const waiter = summary?.waiterDisplayName ?? "Waiter";
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
  return (
    <main className={`w2-page${sessionTable ? " session-open" : ""}`}>
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
      {sessionNotice && !sessionTable ? (
        <div className="w94-ready-notice" role="alert">
          <span>🔔</span>
          <strong>{sessionNotice}</strong>
          <button onClick={() => setSessionNotice(null)}>Dismiss</button>
        </div>
      ) : null}
      {error && <div className="w2-error">{error}</div>}
      {view === "tables" ? (
        <>
          <section className="w10-tools">
            <div>
              {(
                [
                  ["all", "All"],
                  ["available", "Available"],
                  ["occupied", "Occupied"],
                  ["payment", "Needs Bill"],
                ] as Array<[Filter, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  className={filter === value ? "active" : ""}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
              <button
                className={filter === "attention" ? "active" : ""}
                onClick={() => setFilter("attention")}
              >
                Kitchen Ready
              </button>
            </div>
            <label>
              <span>⌕</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search table or customer"
              />
            </label>
          </section>
          {loading ? (
            <div className="w2-state">Loading tables…</div>
          ) : (
            <section className="w10-grid">
              {filtered.map(
                ({
                  table,
                  total,
                  invoices,
                  itemCount,
                  readyItems,
                  lifecycleStatus,
                }) => {
                  const state = !table.activeOrderId
                    ? "available"
                    : lifecycleStatus === "ready_to_serve"
                      ? "ready"
                      : lifecycleStatus === "needs_bill" ||
                          lifecycleStatus === "billing"
                        ? "bill"
                        : table.activeOrderSource === "public_qr"
                          ? "qr"
                          : "waiter";
                  const label = !table.activeOrderId
                    ? "Available"
                    : (
                        {
                          serving: "Serving",
                          kitchen_waiting: "Kitchen Waiting",
                          ready_to_serve: "Ready to Serve",
                          needs_bill: "Needs Bill",
                          billing: "Waiting Cashier",
                          paid: "Paid",
                        } as const
                      )[lifecycleStatus];
                  return (
                    <button
                      type="button"
                      key={table.tableId}
                      className={`w10-table ${state}`}
                      onClick={() => openTable(table)}
                      aria-label={`Table ${table.tableNumber}, ${label}`}
                    >
                      <header>
                        <strong>Table {table.tableNumber}</strong>
                        <span>{label}</span>
                      </header>
                      <div className="w10-table-total">{money(total)}</div>
                      <small>
                        {table.qrCustomerName
                          ? `${table.qrCustomerName.split(" + ").length} guest(s) · `
                          : ""}
                        {table.assignedWaiterName || waiter}
                      </small>
                      <small>
                        {table.activeOrderId
                          ? `Open ${elapsed(table.activeOrderCreatedAt, now)} · ${itemCount} items · ${invoices} bill${invoices === 1 ? "" : "s"}`
                          : "Tap to order"}
                      </small>
                      <small>
                        {readyItems
                          ? `${readyItems} ready to serve`
                          : table.activeOrderId
                            ? "Kitchen active"
                            : "Menu opens automatically"}
                      </small>
                      <span className="w10-table-tap">Tap table</span>
                    </button>
                  );
                },
              )}
            </section>
          )}
          {!loading && !filtered.length ? (
            <div className="w2-state">No tables match.</div>
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
        <div className="w2-session w92-session">
          <header className="w10-session-header">
            <button onClick={() => setSessionTable(null)}>← Tables</button>
            <div>
              <small>
                Open{" "}
                {elapsed(
                  sessionDetail?.openedAt ?? sessionTable.activeOrderCreatedAt,
                  now,
                )}
              </small>
              <strong>Table {sessionTable.tableNumber}</strong>
            </div>
            {!sessionDetail || sessionAllowsItems(sessionDetail) ? (
              <a
                className="w103-add-top"
                href={`/waiter/${encodeURIComponent(restaurantSlug)}/order/${encodeURIComponent(String(sessionTable.tableNumber))}`}
                onClick={(event) => {
                  event.preventDefault();
                  openAddItems(sessionTable);
                }}
              >
                + Add Items
              </a>
            ) : (
              <span className="w103-session-locked">
                {sessionDetail?.orderingReason ?? "Loading"}
              </span>
            )}
          </header>
          {!sessionDetail ? (
            <div className={`w2-state${sessionDetailError ? " error" : ""}`}>
              {sessionDetailError ? (
                <>
                  <strong>Table details unavailable</strong>
                  <span>{sessionDetailError}</span>
                  <button
                    onClick={() =>
                      navigateWaiter(
                        `/waiter/${encodeURIComponent(restaurantSlug)}/order/${sessionTable.tableNumber}`,
                      )
                    }
                  >
                    Open Restaurant Menu
                  </button>
                </>
              ) : (
                "Loading table…"
              )}
            </div>
          ) : (
            <div className="w10-session-body">
              <section className="w10-current-bill">
                <small>
                  Dining Session:{" "}
                  {sessionDetail.diningSessionStatus.toUpperCase()} ·{" "}
                  {sessionDetail.sessionNumber}
                </small>
                <strong>Table {sessionTable.tableNumber}</strong>
                <span
                  className={
                    sessionDetail.orderingAllowed
                      ? "w109-ordering-open"
                      : "w109-ordering-locked"
                  }
                >
                  {sessionServiceStatus(sessionDetail)}
                </span>
                <div className="w10-session-facts">
                  <span>
                    <small>Guests</small>
                    <b>
                      {(sessionDetail.customerName ?? "")
                        .split(" + ")
                        .filter(Boolean).length || 1}
                    </b>
                  </span>
                  <span>
                    <small>Elapsed</small>
                    <b>{elapsed(sessionDetail.openedAt, now)}</b>
                  </span>
                  <span>
                    <small>Waiter</small>
                    <b>
                      {sessionDetail.waiterName ||
                        sessionTable.assignedWaiterName ||
                        waiter}
                    </b>
                  </span>
                  <span>
                    <small>Paid</small>
                    <b>{money(paidTotal)}</b>
                  </span>
                  <span>
                    <small>Pending</small>
                    <b>{money(pendingTotal)}</b>
                  </span>
                  <span>
                    <small>Running Total</small>
                    <b>{money(sessionDetail.total)}</b>
                  </span>
                  <span>
                    <small>Kitchen</small>
                    <b>{sessionKitchenStatus(sessionDetail)}</b>
                  </span>
                </div>
              </section>
              {sessionNotice ? (
                <div className="w92-notice" role="status">
                  {sessionNotice}
                  <button onClick={() => setSessionNotice(null)}>×</button>
                </div>
              ) : null}
              <section className="w10-kitchen">
                <h2>Kitchen Batches</h2>
                {sessionBatches(sessionDetail).map((batch) => (
                  <article key={batch.createdAt}>
                    <span>
                      <strong>Batch {batch.number}</strong>
                      <small>
                        {batch.items
                          .map((item) => `${item.quantity}× ${item.name}`)
                          .join(", ")}
                      </small>
                      <small>
                        {money(
                          batch.items.reduce(
                            (sum, item) => sum + item.quantity * item.price,
                            0,
                          ),
                        )}
                      </small>
                    </span>
                    <b className={batch.status}>
                      {batch.status === "pending" || batch.status === "held"
                        ? paymentLabel(batch.status)
                        : batch.status === "ready"
                          ? "Ready"
                          : batch.status === "served"
                            ? "Served"
                            : batch.status === "preparing"
                              ? "Preparing"
                              : batch.status === "accepted"
                                ? "Waiting Kitchen"
                                : "Waiting Kitchen"}
                    </b>
                  </article>
                ))}
                {sessionKitchenStatus(sessionDetail) === "Ready" ? (
                  <button
                    className="w10-secondary-action"
                    disabled={serving}
                    onClick={() => void markServed()}
                  >
                    {serving ? "Marking…" : "Mark Ready Items Served"}
                  </button>
                ) : null}
              </section>
              <section className="w10-current-orders" id="current-orders">
                <h2>
                  Current Order · Running Total {money(sessionDetail.total)}
                </h2>
                {sessionBatches(sessionDetail).map((batch) => (
                  <article key={batch.createdAt}>
                    <strong>
                      Batch {batch.number} ·{" "}
                      {money(
                        batch.items.reduce(
                          (sum, item) => sum + item.quantity * item.price,
                          0,
                        ),
                      )}
                    </strong>
                    {batch.items.map((item) => {
                      const editable =
                        item.kitchenStatus === "held" ||
                        item.kitchenStatus === "accepted";
                      return (
                        <div key={item.id}>
                          <span>
                            <strong>{item.name}</strong>
                            <small>
                              Quantity {item.quantity}
                              {item.notes ? ` · ${item.notes}` : ""}
                            </small>
                          </span>
                          <b>{money(item.quantity * item.price)}</b>
                          {editable ? (
                            <span className="w10-item-actions">
                              <button
                                onClick={() =>
                                  void editPendingItem(
                                    item.id,
                                    Math.max(1, item.quantity - 1),
                                  )
                                }
                              >
                                −
                              </button>
                              <button
                                onClick={() =>
                                  void editPendingItem(
                                    item.id,
                                    item.quantity + 1,
                                  )
                                }
                              >
                                +
                              </button>
                              <button
                                onClick={() =>
                                  void editPendingItemNote(item.id, item.notes)
                                }
                              >
                                Add Note
                              </button>
                              <button
                                onClick={() => void editPendingItem(item.id, 0)}
                              >
                                Cancel Item
                              </button>
                            </span>
                          ) : (
                            <small className="w103-edit-locked">
                              Already sent to kitchen.
                              <br />
                              Cannot modify.
                            </small>
                          )}
                        </div>
                      );
                    })}
                  </article>
                ))}
              </section>
            </div>
          )}
          <footer className="w10-session-actions">
            <button
              className="bill"
              disabled={
                !sessionDetail ||
                Boolean(sessionDetail.billRequestedAt) ||
                requestingBill
              }
              onClick={() => void requestBill()}
            >
              {requestingBill ? (
                "Requesting…"
              ) : sessionDetail?.billingStartedAt ? (
                <>
                  Waiting Cashier<span>Bill request received</span>
                </>
              ) : sessionDetail?.billRequestedAt ? (
                <>
                  Bill Requested<span>Waiting Cashier</span>
                </>
              ) : (
                "Request Bill"
              )}
            </button>
            <button
              disabled={!sessionDetail || unpaidUnits < 2}
              onClick={() => {
                setSplitQuantities(new Map());
                setSplitOpen(true);
              }}
            >
              Split Bill<span>Choose pending items or quantities</span>
            </button>
            <button
              disabled={!sessionDetail || !sessionDetail.transferAllowed}
              title={
                sessionDetail?.transferReason ?? "Transfer this dining session"
              }
              onClick={() => {
                setMoveTargetId("");
                setMoveOpen(true);
              }}
            >
              Transfer Table
              {sessionDetail && !sessionDetail.transferAllowed ? (
                <span>{sessionDetail.transferReason}</span>
              ) : null}
            </button>
          </footer>
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
              Invoices, payments, kitchen tickets, and customer history stay
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
              dining session and kitchen batches remain unchanged.
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
      <button
        className="w106-logout"
        onClick={() =>
          void signOutWaiter().finally(() =>
            navigateWaiter(
              `/waiter/${encodeURIComponent(restaurantSlug)}`,
              true,
            ),
          )
        }
      >
        ↪ <span>Logout</span>
      </button>
    </main>
  );
}

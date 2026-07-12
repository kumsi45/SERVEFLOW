import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getStoredWaiterSession, signInWaiter, signOutWaiter, switchWaiter, waiterSupabase } from "../../waiter-auth/services/waiterAuthService";
import { loadWaiterDashboardTables, loadWaiterSessionDetail, loadWaiterTableMetrics } from "../services/waiterDashboardService";
import type { WaiterDashboardSummary, WaiterDashboardTable, WaiterSessionDetail, WaiterTableMetric } from "../types";
import "../styles/waiterDashboard.css";

type Props = { restaurantSlug: string };
type Filter = "all" | "available" | "occupied" | "qr" | "waiter" | "payment" | "attention" | "reserved";
type Connection = "connecting" | "connected" | "reconnecting";
const IDLE_LOCK_MS = 5 * 60 * 1000;

function summaryFrom(tables: WaiterDashboardTable[], slug: string): WaiterDashboardSummary | null {
  const first = tables[0];
  if (first) return { restaurantId: first.restaurantId, restaurantSlug: first.restaurantSlug, restaurantName: first.restaurantName, restaurantLogoUrl: first.restaurantLogoUrl, waiterStaffId: first.waiterStaffId, waiterDisplayName: first.waiterDisplayName, currentShift: first.currentShift, assignmentMode: first.assignmentMode };
  const stored = getStoredWaiterSession(slug);
  return stored ? { restaurantId: stored.restaurant.id, restaurantSlug: stored.restaurant.slug, restaurantName: stored.restaurant.name, restaurantLogoUrl: stored.restaurant.logoUrl, waiterStaffId: stored.staffId, waiterDisplayName: stored.displayName, currentShift: "Current Shift", assignmentMode: "all_tables" } : null;
}
function elapsed(iso: string | null, now: Date) { if (!iso) return "—"; const mins = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60000)); return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`; }
function money(value: number) { return `ETB ${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`; }
function paymentReady(table: WaiterDashboardTable) { return table.activeOrderStatus === "pending_payment"; }
function visualStatus(table: WaiterDashboardTable) {
  if (table.tableStatus === "needs_attention") return "attention";
  if (table.tableStatus === "reserved") return "reserved";
  if (!table.activeOrderId) return "available";
  if (paymentReady(table)) return "payment";
  if (table.activeOrderSource === "public_qr" && table.assignedWaiterStaffId) return "mixed";
  if (table.activeOrderSource === "public_qr") return "qr";
  return "waiter";
}
function statusName(table: WaiterDashboardTable) { return ({ available: "Available", qr: "QR Active", waiter: "Waiter Serving", mixed: "QR + Waiter", payment: "Ready for Payment", attention: "Needs Attention", reserved: "Reserved" } as const)[visualStatus(table)]; }

export function WaiterDashboardPage({ restaurantSlug }: Props) {
  const [tables, setTables] = useState<WaiterDashboardTable[]>([]);
  const [summary, setSummary] = useState<WaiterDashboardSummary | null>(() => summaryFrom([], restaurantSlug));
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [menuTable, setMenuTable] = useState<WaiterDashboardTable | null>(null);
  const [sessionTable, setSessionTable] = useState<WaiterDashboardTable | null>(null);
  const [sessionDetail, setSessionDetail] = useState<WaiterSessionDetail | null>(null);
  const [metrics, setMetrics] = useState<Map<string, WaiterTableMetric>>(new Map());
  const [switchMode, setSwitchMode] = useState<"switch" | "unlock" | null>(null);
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [authWorking, setAuthWorking] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const pressTimer = useRef<number | null>(null);
  const refreshTimer = useRef<number | null>(null);
  const idleTimer = useRef<number | null>(null);

  const loadTables = useCallback(async () => { const rows = await loadWaiterDashboardTables(restaurantSlug); const nextMetrics = await loadWaiterTableMetrics(rows.flatMap((row) => row.activeOrderId ? [row.activeOrderId] : [])); setTables(rows); setMetrics(nextMetrics); setSummary(summaryFrom(rows, restaurantSlug)); }, [restaurantSlug]);
  const scheduleRefresh = useCallback(() => { if (refreshTimer.current !== null) clearTimeout(refreshTimer.current); refreshTimer.current = window.setTimeout(() => void loadTables().catch((e) => setError(e instanceof Error ? e.message : "Realtime update failed.")), 100); }, [loadTables]);

  useEffect(() => { void loadTables().catch((e) => { setError(e instanceof Error ? e.message : "Waiter dashboard unavailable."); }).finally(() => setLoading(false)); }, [loadTables]);
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!summary?.restaurantId) return;
    const channel = waiterSupabase.channel(`waiter-shared-tablet:${summary.restaurantId}`);
    for (const table of ["restaurant_tables", "restaurant_table_waiter_assignments", "orders", "order_items", "order_invoices", "dining_sessions"]) channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `restaurant_id=eq.${summary.restaurantId}` }, scheduleRefresh);
    channel.subscribe((status) => { setConnection(status === "SUBSCRIBED" ? "connected" : status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED" ? "reconnecting" : "connecting"); if (status === "SUBSCRIBED") scheduleRefresh(); });
    return () => { if (refreshTimer.current !== null) clearTimeout(refreshTimer.current); void waiterSupabase.removeChannel(channel); };
  }, [scheduleRefresh, summary?.restaurantId]);
  useEffect(() => {
    const reset = () => { if (switchMode === "unlock") return; if (idleTimer.current !== null) clearTimeout(idleTimer.current); idleTimer.current = window.setTimeout(() => { setUsername(getStoredWaiterSession(restaurantSlug)?.username ?? ""); setPin(""); setSwitchMode("unlock"); }, IDLE_LOCK_MS); };
    for (const event of ["pointerdown", "keydown", "touchstart"] as const) window.addEventListener(event, reset, { passive: true }); reset();
    return () => { for (const event of ["pointerdown", "keydown", "touchstart"] as const) window.removeEventListener(event, reset); if (idleTimer.current !== null) clearTimeout(idleTimer.current); };
  }, [restaurantSlug, switchMode]);
  useEffect(() => { if (!sessionTable?.activeOrderId) { setSessionDetail(null); return; } void loadWaiterSessionDetail(sessionTable.activeOrderId).then(setSessionDetail).catch((e) => setError(e instanceof Error ? e.message : "Session unavailable.")); }, [sessionTable?.activeOrderId, tables]);

  const enriched = useMemo(() => tables.map((table) => { const metric = table.activeOrderId ? metrics.get(table.activeOrderId) : null; return { table, total: metric?.total ?? 0, invoices: metric?.invoiceCount ?? 0, sessionNumber: metric?.sessionNumber ?? null, invoiceNumbers: metric?.invoiceNumbers ?? [] }; }), [metrics, tables]);
  const filtered = useMemo(() => enriched.filter(({ table,sessionNumber,invoiceNumbers }) => {
    const state = visualStatus(table); const q = search.trim().toLowerCase();
    const filterMatch = filter === "all" || (filter === "occupied" ? state !== "available" && state !== "reserved" : filter === "attention" ? state === "attention" : filter === "payment" ? state === "payment" : state === filter);
    const searchMatch = !q || String(table.tableNumber).includes(q) || (sessionNumber ?? table.activeOrderId ?? "").toLowerCase().includes(q) || invoiceNumbers.some((number) => number.toLowerCase().includes(q)) || (table.qrCustomerName ?? "").toLowerCase().includes(q) || (table.tableLabel ?? "").toLowerCase().includes(q);
    return filterMatch && searchMatch;
  }), [enriched, filter, search]);
  const counts = useMemo(() => ({ available: tables.filter((t) => visualStatus(t) === "available").length, occupied: tables.filter((t) => Boolean(t.activeOrderId)).length, payment: tables.filter(paymentReady).length, ready: tables.filter((t) => t.activeOrderStatus === "ready").length }), [tables]);

  function openTable(table: WaiterDashboardTable) { if (table.activeOrderId) setSessionTable(table); else window.location.assign(`/waiter/${encodeURIComponent(restaurantSlug)}/order/${table.tableNumber}`); }
  function startPress(table: WaiterDashboardTable) { pressTimer.current = window.setTimeout(() => setMenuTable(table), 520); }
  function cancelPress() { if (pressTimer.current !== null) clearTimeout(pressTimer.current); pressTimer.current = null; }
  async function authenticate() {
    try { setAuthWorking(true); setAuthError(null); const targetUsername = switchMode === "unlock" ? getStoredWaiterSession(restaurantSlug)?.username ?? username : username; const session = switchMode === "switch" ? await switchWaiter(restaurantSlug, targetUsername, pin) : await signInWaiter(restaurantSlug, targetUsername, pin); setSummary((old) => old ? { ...old, waiterStaffId: session.staffId, waiterDisplayName: session.displayName } : old); setSwitchMode(null); setPin(""); setUsername(""); await loadTables(); }
    catch (e) { setAuthError(e instanceof Error ? e.message : "PIN was not accepted."); } finally { setAuthWorking(false); }
  }

  const restaurant = summary?.restaurantName ?? "Restaurant"; const waiter = summary?.waiterDisplayName ?? "Waiter";
  return <main className="w2-page">
    <header className="w2-header"><div className="w2-brand">{summary?.restaurantLogoUrl ? <img src={summary.restaurantLogoUrl} alt="" /> : <span>{restaurant[0]}</span>}<div><strong>{restaurant}</strong><small>{summary?.currentShift ?? "Current Shift"}</small></div></div><div className="w2-header-meta"><span className={`w2-connection ${connection}`}>● {connection === "connected" ? "Connected" : "Reconnecting"}</span><time>{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div></header>
    <section className="w2-operator"><div><small>👤 Serving as</small><strong>{waiter}</strong></div><button onClick={() => { setUsername(""); setPin(""); setSwitchMode("switch"); }}>Switch Waiter</button></section>
    <section className="w2-counters"><article><small>Available Tables</small><strong>{counts.available}</strong></article><article><small>Occupied Tables</small><strong>{counts.occupied}</strong></article><article><small>Waiting Payment</small><strong>{counts.payment}</strong></article><article><small>Ready for Pickup</small><strong>{counts.ready}</strong></article></section>
    <section className="w2-tools"><div className="w2-filters">{([['all','All'],['available','Available'],['occupied','Occupied'],['qr','QR'],['waiter','Waiter'],['payment','Ready for Payment'],['attention','Needs Cashier'],['reserved','Reserved']] as Array<[Filter,string]>).map(([value,label]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div><label className="w2-search"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Table, session, invoice or customer" /></label></section>
    {error && <div className="w2-error">{error}</div>}
    {loading ? <div className="w2-state">Loading dining room…</div> : <section className="w2-grid">{filtered.map(({ table,total,invoices,sessionNumber }) => <button key={table.tableId} className={`w2-table status-${visualStatus(table)}`} onClick={() => openTable(table)} onPointerDown={() => startPress(table)} onPointerUp={cancelPress} onPointerLeave={cancelPress} onContextMenu={(e) => { e.preventDefault(); setMenuTable(table); }}><span className="w2-table-top"><strong>T-{table.tableNumber}</strong><i>{statusName(table)}</i></span><span className="w2-table-session">{sessionNumber ?? "No active session"}</span><span className="w2-table-facts"><span>{invoices} invoice{invoices === 1 ? "" : "s"}</span><span>{elapsed(table.activeOrderCreatedAt, now)}</span></span><span className="w2-table-total">{money(total)}</span></button>)}</section>}
    {!loading && filtered.length === 0 && <div className="w2-state">No tables match this view.</div>}

    {menuTable && <div className="w2-overlay" onClick={() => setMenuTable(null)}><section className="w2-quick" onClick={(e) => e.stopPropagation()}><header><div><small>Quick actions</small><h2>Table {menuTable.tableNumber}</h2></div><button onClick={() => setMenuTable(null)}>×</button></header><div>{<button className="primary" onClick={() => openTable(menuTable)}>{menuTable.activeOrderId ? "Add Items" : "Take Order"}</button>}<button onClick={() => { setSessionTable(menuTable); setMenuTable(null); }}>View Session</button><button>Request Bill</button><button>Call Cashier</button><button>Release Table</button><button disabled>Transfer Table · Future</button><button disabled>Merge Tables · Future</button></div></section></div>}
    {sessionTable && <div className="w2-session"><header><button onClick={() => setSessionTable(null)}>← Tables</button><div><small>Current waiter · {waiter}</small><strong>Table T-{sessionTable.tableNumber}</strong></div><button onClick={() => window.location.assign(`/waiter/${encodeURIComponent(restaurantSlug)}/order/${sessionTable.tableNumber}`)}>+ Add Items</button></header>{!sessionDetail ? <div className="w2-state">Loading session…</div> : <div className="w2-session-body"><section className="w2-session-hero"><div><small>Session ID</small><strong>{sessionDetail.sessionNumber}</strong><span>Opened {new Date(sessionDetail.openedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {elapsed(sessionDetail.openedAt, now)}</span></div><div><small>Current Total</small><strong>{money(sessionDetail.total)}</strong><span>{sessionDetail.source === "public_qr" && sessionDetail.invoices.some((i) => i.creatorName) ? "Mixed" : sessionDetail.source === "public_qr" ? "QR Customer" : "Waiter / Walk-in"}</span></div><div><small>Session Creator</small><strong>{sessionDetail.creatorName ?? "Customer QR"}</strong><span>Serving now: {waiter}</span></div></section><h2 className="w2-timeline-title">Order Timeline</h2><section className="w2-timeline">{sessionDetail.invoices.map((invoice,index) => <article key={invoice.id}><span className="w2-dot"/><div className="w2-invoice-head"><div><strong>{invoice.displayNumber}</strong><span className={`invoice-${invoice.status}`}>{invoice.status.replace('_',' ')}</span><span className={`kitchen-${invoice.kitchenStatus}`}>{invoice.kitchenStatus.replace('_',' ')}</span></div><time>{new Date(invoice.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div><div className="w2-items">{invoice.items.map((item) => <div key={item.id}><span><strong>{item.name}</strong><small>Quantity: {item.quantity} · {item.kitchenStatus.replace('_',' ')}</small></span><b>{money(item.quantity * item.price)}</b></div>)}</div><footer><span>Invoice {index + 1} of {sessionDetail.invoices.length}</span><strong>{money(invoice.total)}</strong></footer></article>)}</section></div>}</div>}
    {switchMode && <div className="w2-lock"><section><span className="w2-lock-icon">▣</span><small>{switchMode === "unlock" ? "TABLET LOCKED" : "SECURE WAITER HAND-OFF"}</small><h1>{switchMode === "unlock" ? `Welcome back, ${waiter}` : "Switch Waiter"}</h1><p>{switchMode === "unlock" ? "Enter your PIN to continue. Active tables remain open." : "Enter the next waiter’s username and PIN."}</p>{switchMode === "switch" && <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Waiter username" autoComplete="username" />}<div className="w2-pin-dots">{[0,1,2,3,4,5].map((n) => <i key={n} className={pin.length > n ? "filled" : ""}/>)}</div><div className="w2-keypad">{[1,2,3,4,5,6,7,8,9].map((n) => <button key={n} onClick={() => setPin((p) => (p + n).slice(0,6))}>{n}</button>)}<button className="clear" onClick={() => setPin("")}>Clear</button><button onClick={() => setPin((p) => (p + '0').slice(0,6))}>0</button><button className="submit" disabled={authWorking || pin.length < 4 || (switchMode === "switch" && !username.trim())} onClick={() => void authenticate()}>✓</button></div>{authError && <div className="w2-error">{authError}</div>}{switchMode === "switch" && <button className="w2-cancel" onClick={() => setSwitchMode(null)}>Cancel and return to Tables</button>}</section></div>}
    <nav className="w2-nav"><button className={!sessionTable ? "active" : ""} onClick={() => setSessionTable(null)}>▦<span>Tables</span></button><button onClick={() => setSwitchMode("switch")}>♙<span>Switch Waiter</span></button><button onClick={() => document.querySelector<HTMLInputElement>('.w2-search input')?.focus()}>⌕<span>Search</span></button><button onClick={() => void signOutWaiter().finally(() => window.location.replace(`/waiter/${encodeURIComponent(restaurantSlug)}`))}>↪<span>Logout</span></button></nav>
  </main>;
}

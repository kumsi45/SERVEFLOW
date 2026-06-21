import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../../core/database";
import { signOutStaff } from "../../staff-auth/services/staffAuthService";
import type { KitchenOrder, KitchenOrderItem, KitchenRestaurant } from "../types";
import "../styles/kitchenDashboard.css";

// ─── helpers ─────────────────────────────────────────────────────────────────
function fmtMoney(v: number) { return `ETB ${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`; }
function fmtId(id: string) { return `#${id.slice(0, 6).toUpperCase()}`; }
function fmtTime(iso: string) { return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); }
function elapsedMin(iso: string | null) {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}
function fmtElapsed(min: number) { return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${min % 60}m`; }

function useNow() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 30000); return () => clearInterval(id); }, []);
  return t;
}

// ─── types ───────────────────────────────────────────────────────────────────
type OrderRow = {
  id: string; status: string; customer_name: string | null; table_number: string | null;
  payment_method: string | null; total_price: number | string; created_at: string;
  payment_verified_at: string | null; preparation_started_at: string | null; ready_marked_at: string | null;
};
type ItemRow = { id: string; order_id: string; quantity: number; price: number | string; menu_items?: {name?: string|null}|{name?: string|null}[]|null; };

function normalizeOrder(row: OrderRow, items: KitchenOrderItem[] = []): KitchenOrder {
  return { id: row.id, status: row.status as KitchenOrder["status"], customerName: row.customer_name, tableNumber: row.table_number, paymentMethod: row.payment_method, totalPrice: Number(row.total_price), createdAt: row.created_at, paymentVerifiedAt: row.payment_verified_at, preparationStartedAt: row.preparation_started_at, readyMarkedAt: row.ready_marked_at, items };
}
function normalizeItem(row: ItemRow): KitchenOrderItem {
  const mi = row.menu_items; const name = Array.isArray(mi) ? (mi[0]?.name ?? "Item") : (mi?.name ?? "Item");
  return { id: row.id, orderId: row.order_id, name, quantity: row.quantity, price: Number(row.price) };
}

// ─── Timer label ─────────────────────────────────────────────────────────────
function TimerLabel({ iso, _now }: { iso: string | null; _now: Date }) {
  if (!iso) return null;
  const min = elapsedMin(iso);
  const cls = min >= 25 ? "kd-timer-urgent" : min >= 15 ? "kd-timer-warning" : "kd-timer-normal";
  return <span className={`kd-ticket-timer ${cls}`}>⏱ {fmtElapsed(min)}</span>;
}

// ─── Order Ticket ─────────────────────────────────────────────────────────────
function OrderTicket({ order, actionId, onStart, onReady, now }: {
  order: KitchenOrder; actionId: string | null;
  onStart?: () => void; onReady?: () => void; now: Date;
}) {
  const elapsed = elapsedMin(order.preparationStartedAt ?? order.paymentVerifiedAt ?? order.createdAt);
  const isUrgent = elapsed >= 25;
  const isWarning = elapsed >= 15 && !isUrgent;
  const isBusy = actionId === order.id;

  return (
    <div className={`kd-ticket${isUrgent ? " urgent" : isWarning ? " warning-age" : ""}`}>
      <div className="kd-ticket-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="kd-ticket-id">{fmtId(order.id)}</span>
          {isUrgent && <span className="kd-priority urgent">🔴 Urgent</span>}
        </div>
        <span className="kd-ticket-type kd-type-dine">🍽 Dine-in</span>
      </div>

      <div className="kd-ticket-meta">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{
              display: "inline-flex", alignItems: "center",
              padding: "3px 10px", borderRadius: 6,
              background: "var(--kd-new)", color: "#fff",
              fontSize: 12, fontWeight: 800, letterSpacing: "0.08em",
              textTransform: "uppercase" as const,
            }}>
              TABLE {order.tableNumber || "—"}
            </span>
          </div>
          {order.customerName && (
            <div style={{ fontSize: 12, color: "var(--kd-muted)" }}>{order.customerName}</div>
          )}
          <div className="kd-ticket-table" style={{ marginTop: 2 }}>{fmtTime(order.createdAt)}</div>
        </div>
        <TimerLabel iso={order.preparationStartedAt ?? order.paymentVerifiedAt ?? order.createdAt} _now={now} />
      </div>

      <div className="kd-ticket-items">
        {order.items.length === 0
          ? <div style={{ fontSize: 12, color: "var(--kd-muted)" }}>No item data</div>
          : order.items.map((item) => (
              <div key={item.id} className="kd-item-row">
                <div className={`kd-item-qty${isUrgent ? " kd-item-urgent-qty" : ""}`}>{item.quantity}</div>
                <div className="kd-item-name">{item.name}</div>
                <div className="kd-item-price">{fmtMoney(item.price * item.quantity)}</div>
              </div>
            ))
        }
      </div>

      <div className="kd-ticket-footer">
        <span className="kd-ticket-total">{fmtMoney(order.totalPrice)}</span>
        <span className="kd-ticket-payment">{order.paymentMethod || "—"}</span>
      </div>

      {(onStart || onReady) && (
        <div className="kd-ticket-actions">
          {onStart && (
            <button className="kd-action-primary start" onClick={onStart} disabled={isBusy}>
              {isBusy ? "Starting..." : "▶ Start Preparing"}
            </button>
          )}
          {onReady && (
            <button className="kd-action-primary ready" onClick={onReady} disabled={isBusy}>
              {isBusy ? "Marking..." : "✓ Mark Ready"}
            </button>
          )}
          <button className="kd-action-secondary" title="Details">👁</button>
        </div>
      )}
    </div>
  );
}

// ─── Kanban Column ─────────────────────────────────────────────────────────────
function KanbanCol({ colKey, title, orders, actionId, onStart, onReady, now }: {
  colKey: "new" | "preparing" | "ready";
  title: string; orders: KitchenOrder[]; actionId: string | null;
  onStart?: (id: string) => void; onReady?: (id: string) => void; now: Date;
}) {
  // urgent orders first
  const sorted = [...orders].sort((a, b) => {
    const ae = elapsedMin(a.preparationStartedAt ?? a.paymentVerifiedAt ?? a.createdAt);
    const be = elapsedMin(b.preparationStartedAt ?? b.paymentVerifiedAt ?? b.createdAt);
    return be - ae;
  });

  return (
    <div className="kd-kanban-col">
      <div className={`kd-col-header ${colKey}`}>
        <div className="kd-col-title">
          {colKey === "new" && "🔵"} {colKey === "preparing" && "🟠"} {colKey === "ready" && "🟢"}
          {title}
        </div>
        <span className="kd-col-count">{orders.length}</span>
      </div>
      <div className="kd-col-body">
        {sorted.length === 0
          ? <div className="kd-empty"><div className="kd-empty-icon">{colKey === "new" ? "📭" : colKey === "preparing" ? "🍳" : "✅"}</div><div className="kd-empty-msg">No orders here</div></div>
          : sorted.map((o) => (
              <OrderTicket
                key={o.id} order={o} actionId={actionId} now={now}
                onStart={onStart ? () => onStart(o.id) : undefined}
                onReady={onReady ? () => onReady(o.id) : undefined}
              />
            ))
        }
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
type KitchenDashboardPageProps = { restaurantId: string; restaurant: KitchenRestaurant; };

export function KitchenDashboardPage({ restaurantId, restaurant: initialRestaurant }: KitchenDashboardPageProps) {
  const now = useNow();
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [restaurant, setRestaurant] = useState<KitchenRestaurant>(initialRestaurant);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true); setError(null);
        const [{ data: sd }, { data: rows, error: re }] = await Promise.all([
          supabase.from("restaurant_staff").select("restaurants(id,name)").eq("restaurant_id", restaurantId).eq("active", true).limit(1).maybeSingle(),
          supabase.from("orders").select("id,status,customer_name,table_number,payment_method,total_price,created_at,payment_verified_at,preparation_started_at,ready_marked_at")
            .eq("restaurant_id", restaurantId).in("status", ["paid","preparing","ready"])
            .order("created_at", { ascending: true }),
        ]);
        if (!mounted) return;
        if (re) throw new Error(re.message);
        const rest = Array.isArray(sd?.restaurants) ? sd.restaurants[0] : sd?.restaurants;
        if (rest?.name) setRestaurant({ id: rest.id, name: rest.name });
        const orderRows = (rows ?? []) as OrderRow[];
        const ids = orderRows.map((r) => r.id);
        const itemMap = new Map<string, KitchenOrderItem[]>();
        if (ids.length > 0) {
          const { data: ir } = await supabase.from("order_items")
            .select("id,order_id,quantity,price,menu_items!order_items_menu_item_same_restaurant(name)")
            .eq("restaurant_id", restaurantId).in("order_id", ids);
          for (const row of (ir ?? []) as ItemRow[]) {
            const item = normalizeItem(row);
            const arr = itemMap.get(item.orderId) ?? []; arr.push(item); itemMap.set(item.orderId, arr);
          }
        }
        if (mounted) setOrders(orderRows.map((r) => normalizeOrder(r, itemMap.get(r.id))));
      } catch (e) { if (mounted) setError(e instanceof Error ? e.message : "Could not load orders."); }
      finally { if (mounted) setLoading(false); }
    }
    void load();
    return () => { mounted = false; };
  }, [restaurantId]);

  // ── realtime ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase.channel(`kitchen-${restaurantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
        async (payload) => {
          const row = payload.new as OrderRow;
          if (!["paid","preparing","ready"].includes(row.status)) { setOrders((p) => p.filter((o) => o.id !== row.id)); return; }
          const { data: ir } = await supabase.from("order_items")
            .select("id,order_id,quantity,price,menu_items!order_items_menu_item_same_restaurant(name)")
            .eq("restaurant_id", restaurantId).eq("order_id", row.id);
          const items = (ir ?? []).map((r) => normalizeItem(r as ItemRow));
          const updated = normalizeOrder(row, items);
          setOrders((p) => { const i = p.findIndex((o) => o.id === updated.id); if (i >= 0) { const n = [...p]; n[i] = updated; return n; } return [...p, updated]; });
        }).subscribe();
    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
  }, [restaurantId]);

  // ── actions ────────────────────────────────────────────────────────────────
  async function handleStart(orderId: string) {
    try {
      setActionId(orderId);
      const { data, error: e } = await supabase.rpc("start_order_preparation", { target_order_id: orderId });
      if (e) throw new Error(e.message);
      const updated = normalizeOrder(data as OrderRow);
      setOrders((p) => p.map((o) => o.id === orderId ? { ...o, ...updated, items: o.items } : o));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed."); }
    finally { setActionId(null); }
  }
  async function handleReady(orderId: string) {
    try {
      setActionId(orderId);
      const { data, error: e } = await supabase.rpc("mark_order_ready", { target_order_id: orderId });
      if (e) throw new Error(e.message);
      const updated = normalizeOrder(data as OrderRow);
      setOrders((p) => p.map((o) => o.id === orderId ? { ...o, ...updated, items: o.items } : o));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed."); }
    finally { setActionId(null); }
  }
  async function handleSignOut() { try { await signOutStaff(); } finally { window.location.replace("/staff-login"); } }

  // ── derived ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!search.trim()) return orders;
    const q = search.toLowerCase();
    return orders.filter((o) => o.id.toLowerCase().includes(q) || (o.customerName ?? "").toLowerCase().includes(q) || (o.tableNumber ?? "").toLowerCase().includes(q));
  }, [orders, search]);

  const byStatus = useMemo(() => ({
    paid: filtered.filter((o) => o.status === "paid"),
    preparing: filtered.filter((o) => o.status === "preparing"),
    ready: filtered.filter((o) => o.status === "ready"),
  }), [filtered]);

  const totalActive = orders.length;
  const avgPrep = useMemo(() => {
    const done = orders.filter((o) => o.preparationStartedAt && o.readyMarkedAt);
    if (!done.length) return 0;
    return Math.round(done.reduce((s, o) => s + elapsedMin(o.preparationStartedAt!), 0) / done.length);
  }, [orders]);

  const dateStr = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="kd-root">
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <header className="kd-header">
        <div className="kd-header-logo-area">
          <div className="kd-logo-mark">{restaurant.name.charAt(0)}</div>
          <div>
            <div className="kd-restaurant-name">{restaurant.name}</div>
            <div className="kd-kitchen-label">Kitchen Dashboard</div>
          </div>
        </div>
        <div className="kd-divider" />
        <div className="kd-status-pill"><span className="kd-status-dot" />ONLINE</div>
        <div className="kd-header-datetime">{dateStr} · {timeStr}</div>
        <div className="kd-header-search">
          <span className="kd-search-icon">🔍</span>
          <input placeholder="Search orders, tables..." value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search orders" />
        </div>
        <div className="kd-active-badge">🍽 {totalActive} ACTIVE</div>
        <div className="kd-header-actions">
          <button className="kd-icon-btn" aria-label="Notifications">🔔</button>
          <button className="kd-icon-btn" aria-label="Refresh" onClick={() => window.location.reload()}>↻</button>
          <button className="kd-signout-btn" onClick={handleSignOut}>⎋ Sign Out</button>
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

      {/* ── BODY ───────────────────────────────────────────────────────── */}
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
            <KanbanCol colKey="new" title="New Orders" orders={byStatus.paid} actionId={actionId} onStart={handleStart} now={now} />
            <KanbanCol colKey="preparing" title="Preparing" orders={byStatus.preparing} actionId={actionId} onReady={handleReady} now={now} />
            <KanbanCol colKey="ready" title="Ready for Pickup" orders={byStatus.ready} actionId={actionId} now={now} />
          </div>

          {/* ── SIDEBAR ────────────────────────────────────────────────── */}
          <aside className="kd-sidebar">
            <div className="kd-sidebar-header">📊 Live Stats</div>

            <div className="kd-sidebar-section">
              <div className="kd-sidebar-label">Kitchen Performance</div>
              <div className="kd-stat-row"><span className="kd-stat-label">New Orders</span><span className="kd-stat-value blue">{byStatus.paid.length}</span></div>
              <div className="kd-stat-row"><span className="kd-stat-label">Preparing</span><span className="kd-stat-value orange">{byStatus.preparing.length}</span></div>
              <div className="kd-stat-row"><span className="kd-stat-label">Ready</span><span className="kd-stat-value green">{byStatus.ready.length}</span></div>
              <div className="kd-stat-row"><span className="kd-stat-label">Avg Prep Time</span><span className="kd-stat-value">{avgPrep > 0 ? `${avgPrep}m` : "—"}</span></div>
            </div>

            <div className="kd-sidebar-section">
              <div className="kd-sidebar-label">Active Staff</div>
              <div className="kd-staff-avatars">
                {["K", "C", "O"].map((l) => (
                  <div key={l} className="kd-staff-avatar">{l}</div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../../core/database";
import { signOutStaff } from "../../staff-auth/services/staffAuthService";
import type { CashierOrder, CashierOrderItem, CashierRestaurant } from "../types";
import "../styles/cashierDashboard.css";

// ─── helpers ────────────────────────────────────────────────────────────────
function fmtMoney(v: number) {
  return `ETB ${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
function fmtOrderId(id: string) { return `#${id.slice(0, 6).toUpperCase()}`; }
function fmtDateTime(iso: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff}m ago`;
  return `${Math.floor(diff / 60)}h ago`;
}
function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  return now;
}

// ─── types ───────────────────────────────────────────────────────────────────
type CashierDashboardPageProps = {
  restaurantId: string;
  restaurant: CashierRestaurant;
  cashierName?: string;
};

type OrderRow = {
  id: string; status: string; customer_name: string | null;
  table_number: string | null; payment_method: string | null;
  total_price: number | string; created_at: string; payment_verified_at: string | null;
};
type ItemRow = {
  id: string; order_id: string; quantity: number; price: number | string;
  menu_items?: { name?: string | null } | { name?: string | null }[] | null;
};

function normalizeOrder(row: OrderRow, items: CashierOrderItem[] = []): CashierOrder {
  return {
    id: row.id,
    status: row.status as CashierOrder["status"],
    customerName: row.customer_name,
    tableNumber: row.table_number,
    paymentMethod: row.payment_method,
    totalPrice: Number(row.total_price),
    createdAt: row.created_at,
    paymentVerifiedAt: row.payment_verified_at,
    items,
  };
}
function normalizeItem(row: ItemRow): CashierOrderItem {
  const mi = row.menu_items;
  const name = Array.isArray(mi) ? (mi[0]?.name ?? "Item") : (mi?.name ?? "Item");
  return { id: row.id, orderId: row.order_id, name, quantity: row.quantity, price: Number(row.price) };
}

// ─── KPI card ────────────────────────────────────────────────────────────────
function KpiCard({ label, value, icon, iconClass, change, warning }: {
  label: string; value: string; icon: string; iconClass: string;
  change?: string; warning?: boolean;
}) {
  return (
    <div className={`cd-kpi-card${warning ? " warning" : ""}`}>
      <div className="cd-kpi-header">
        <div className="cd-kpi-label">{label}</div>
        <div className={`cd-kpi-icon ${iconClass}`}>{icon}</div>
      </div>
      <div className={`cd-kpi-value${warning ? " warning-text" : ""}`}>{value}</div>
      {change && <div className={`cd-kpi-change ${warning ? "neutral" : "up"}`}>{change}</div>}
    </div>
  );
}

// ─── Bar chart ───────────────────────────────────────────────────────────────
function RevenueChart({ orders }: { orders: CashierOrder[] }) {
  const labels = ["6AM","8AM","10AM","12PM","2PM","4PM","6PM","8PM","10PM"];
  const hours =  [6,    8,    10,    12,    14,   16,   18,   20,   22  ];
  const buckets = hours.map((h) => {
    // Revenue is status-independent — use payment_verified_at timestamp
    const total = orders
      .filter((o) => o.paymentVerifiedAt !== null && new Date(o.paymentVerifiedAt).getHours() === h)
      .reduce((s, o) => s + o.totalPrice, 0);
    return total;
  });
  const max = Math.max(...buckets, 1);
  return (
    <div className="cd-chart-wrap">
      <div className="cd-bar-chart">
        {buckets.map((v, i) => (
          <div key={i} className="cd-bar-col">
            {v > 0 && <div className="cd-bar-value">{v > 999 ? `${(v/1000).toFixed(1)}k` : v}</div>}
            <div className="cd-bar" style={{ height: `${Math.max(4, (v / max) * 140)}px` }} title={`${labels[i]}: ETB ${v}`} />
            <div className="cd-bar-label">{labels[i]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Donut chart ─────────────────────────────────────────────────────────────
function PaymentDonut({ orders }: { orders: CashierOrder[] }) {
  // Use all verified orders (status-independent revenue)
  const paid = orders.filter((o) => o.paymentVerifiedAt !== null);
  const methods = ["Cash","Telebirr","CBE Birr","Mobile Banking","Chapa","Credit/Debit Card"];
  const colors = ["#2563eb","#7c3aed","#f59e0b","#10b981","#ef4444","#0ea5e9"];
  const counts = methods.map((m) => paid.filter((o) => o.paymentMethod === m).length);
  const total = counts.reduce((s, c) => s + c, 1);
  const data = methods.map((m, i) => ({ label: m, count: counts[i], pct: Math.round((counts[i] / total) * 100), color: colors[i] })).filter((d) => d.count > 0);
  if (data.length === 0) data.push({ label: "No data", count: 1, pct: 100, color: "#e2e8f0" });

  let offset = 0;
  const r = 54; const cx = 70; const cy = 70; const circ = 2 * Math.PI * r;
  const slices = data.map((d) => {
    const dash = (d.pct / 100) * circ;
    const gap = circ - dash;
    const slice = { ...d, dash, gap, offset };
    offset += dash;
    return slice;
  });

  return (
    <div className="cd-donut-wrap">
      <svg width="140" height="140" viewBox="0 0 140 140" className="cd-donut-svg">
        {slices.map((s, i) => (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth="20"
            strokeDasharray={`${s.dash} ${s.gap}`} strokeDashoffset={-s.offset}
            style={{ transition: "stroke-dashoffset 0.4s" }} transform={`rotate(-90 ${cx} ${cy})`} />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="11" fill="#64748b" fontWeight="600">TOTAL</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="18" fill="#0f172a" fontWeight="800">{paid.length}</text>
      </svg>
      <div className="cd-donut-legend">
        {data.map((d) => (
          <div key={d.label} className="cd-legend-row">
            <div className="cd-legend-dot-label">
              <div className="cd-legend-dot" style={{ background: d.color }} />
              <span className="cd-legend-name">{d.label}</span>
            </div>
            <span className="cd-legend-pct">{d.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Order drawer ─────────────────────────────────────────────────────────────
function OrderDrawer({ order, onClose, onApprove, approving }: {
  order: CashierOrder; onClose: () => void;
  onApprove?: () => void; approving: boolean;
}) {
  return (
    <>
      <div className="cd-drawer-overlay" onClick={onClose} />
      <aside className="cd-drawer" role="dialog" aria-modal="true" aria-label="Order details">
        <div className="cd-drawer-header">
          <div className="cd-drawer-title">{fmtOrderId(order.id)}</div>
          <button className="cd-drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="cd-drawer-body">
          <div>
            <div className="cd-drawer-section-title">Order Info</div>
            <div className="cd-drawer-detail-grid">
              <div className="cd-drawer-detail"><div className="cd-drawer-detail-label">Table</div><div className="cd-drawer-detail-value" style={{ fontWeight: 800, fontSize: 18, color: "var(--cd-accent)" }}>{order.tableNumber || "—"}</div></div>
              <div className="cd-drawer-detail"><div className="cd-drawer-detail-label">Customer</div><div className="cd-drawer-detail-value">{order.customerName || "Guest"}</div></div>
              <div className="cd-drawer-detail"><div className="cd-drawer-detail-label">Payment</div><div className="cd-drawer-detail-value">{order.paymentMethod || "—"}</div></div>
              <div className="cd-drawer-detail"><div className="cd-drawer-detail-label">Created</div><div className="cd-drawer-detail-value">{fmtDateTime(order.createdAt)}</div></div>
            </div>
          </div>
          <div>
            <div className="cd-drawer-section-title">Items ({order.items.length})</div>
            {order.items.length === 0
              ? <p style={{ fontSize: 13, color: "var(--cd-muted)" }}>No item data available.</p>
              : <div className="cd-drawer-items">
                  {order.items.map((item) => (
                    <div key={item.id} className="cd-drawer-item">
                      <div><div className="cd-drawer-item-name">{item.name}</div><div className="cd-drawer-item-qty">Qty {item.quantity}</div></div>
                      <div className="cd-drawer-item-price">{fmtMoney(item.price * item.quantity)}</div>
                    </div>
                  ))}
                </div>
            }
          </div>
          <div className="cd-drawer-total">
            <span className="cd-drawer-total-label">Total</span>
            <span className="cd-drawer-total-value">{fmtMoney(order.totalPrice)}</span>
          </div>
        </div>
        {order.status === "pending_payment" && onApprove && (
          <div className="cd-drawer-footer">
            <button className="cd-drawer-approve-btn" onClick={onApprove} disabled={approving}>
              {approving ? "Approving..." : "Confirm Payment"}
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────
export function CashierDashboardPage({ restaurantId, restaurant: initialRestaurant, cashierName }: CashierDashboardPageProps) {
  const now = useNow();
  const [orders, setOrders] = useState<CashierOrder[]>([]);
  const [restaurant, setRestaurant] = useState<CashierRestaurant>(initialRestaurant);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"pending" | "paid">("pending");
  const [drawerOrder, setDrawerOrder] = useState<CashierOrder | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [shiftStart] = useState(() => new Date());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [{ data: staffData }, { data: orderRows, error: oErr }, ] = await Promise.all([
          supabase.from("restaurant_staff").select("restaurants(id,name)").eq("restaurant_id", restaurantId).eq("active", true).limit(1).maybeSingle(),
          supabase.from("orders").select("id,status,customer_name,table_number,payment_method,total_price,created_at,payment_verified_at")
            .eq("restaurant_id", restaurantId)
            .in("status", ["pending_payment","paid","preparing","ready","completed","cancelled"])
            .gte("created_at", new Date(new Date().setHours(0,0,0,0)).toISOString())
            .order("created_at", { ascending: false }),
        ]);
        if (!mounted) return;
        if (oErr) throw new Error(oErr.message);
        const rest = Array.isArray(staffData?.restaurants) ? staffData.restaurants[0] : staffData?.restaurants;
        if (rest?.name) setRestaurant({ id: rest.id, name: rest.name, logoUrl: null });
        const rows = (orderRows ?? []) as OrderRow[];
        const ids = rows.map((r) => r.id);
        let itemMap = new Map<string, CashierOrderItem[]>();
        if (ids.length > 0) {
          const { data: itemRows } = await supabase.from("order_items")
            .select("id,order_id,quantity,price,menu_items!order_items_menu_item_same_restaurant(name)")
            .eq("restaurant_id", restaurantId).in("order_id", ids);
          for (const row of (itemRows ?? []) as ItemRow[]) {
            const item = normalizeItem(row);
            const arr = itemMap.get(item.orderId) ?? [];
            arr.push(item); itemMap.set(item.orderId, arr);
          }
        }
        if (mounted) setOrders(rows.map((r) => normalizeOrder(r, itemMap.get(r.id))));
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : "Could not load orders.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => { mounted = false; };
  }, [restaurantId]);

  // ── real-time subscription ─────────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase.channel(`cashier-orders-${restaurantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
        async (payload) => {
          const row = payload.new as OrderRow;
          // Never remove orders from cashier view — update status in place.
          // This keeps revenue and history accurate regardless of workflow stage.
          if (!row?.id) return;
          const { data: itemRows } = await supabase.from("order_items")
            .select("id,order_id,quantity,price,menu_items!order_items_menu_item_same_restaurant(name)")
            .eq("restaurant_id", restaurantId).eq("order_id", row.id);
          const items = (itemRows ?? []).map(normalizeItem as (r: unknown) => CashierOrderItem);
          const updated = normalizeOrder(row, items);
          setOrders((prev) => {
            const idx = prev.findIndex((o) => o.id === updated.id);
            if (idx >= 0) { const next = [...prev]; next[idx] = { ...next[idx], ...updated, items: next[idx].items.length > 0 ? next[idx].items : items }; return next; }
            // New order — add it if it's from today
            const todayStart = new Date(); todayStart.setHours(0,0,0,0);
            if (new Date(row.created_at) >= todayStart) return [updated, ...prev];
            return prev;
          });
        })
      .subscribe();
    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
  }, [restaurantId]);

  // ── approve payment ────────────────────────────────────────────────────────
  async function handleApprove(orderId: string) {
    try {
      setApprovingId(orderId);
      const { data, error: rpcErr } = await supabase.rpc("approve_order_payment", { target_order_id: orderId });
      if (rpcErr) throw new Error(rpcErr.message);
      const updated = normalizeOrder(data as OrderRow);
      setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, ...updated, items: o.items } : o));
      if (drawerOrder?.id === orderId) setDrawerOrder((d) => d ? { ...d, ...updated, items: d.items } : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed.");
    } finally {
      setApprovingId(null);
    }
  }

  // ── sign out ───────────────────────────────────────────────────────────────
  async function handleSignOut() {
    try { await signOutStaff(); } finally { window.location.replace("/staff-login"); }
  }

  // ── derived ────────────────────────────────────────────────────────────────
  // Revenue = any order with payment_verified_at set (status-independent)
  const verifiedOrders = useMemo(() => orders.filter((o) => o.paymentVerifiedAt !== null), [orders]);
  const pending = useMemo(() => orders.filter((o) => o.status === "pending_payment"), [orders]);
  // "paid" for all metrics and history = all verified orders regardless of current workflow status
  const paid = verifiedOrders;
  const completedOrders = useMemo(() => orders.filter((o) => o.status === "completed"), [orders]);
  const todayRevenue = useMemo(() => verifiedOrders.reduce((s, o) => s + o.totalPrice, 0), [verifiedOrders]);
  const avgOrder = verifiedOrders.length > 0 ? todayRevenue / verifiedOrders.length : 0;
  const cashCollected = useMemo(() => verifiedOrders.filter((o) => o.paymentMethod === "Cash").reduce((s, o) => s + o.totalPrice, 0), [verifiedOrders]);
  const digitalPayments = useMemo(() => verifiedOrders.filter((o) => o.paymentMethod !== "Cash").reduce((s, o) => s + o.totalPrice, 0), [verifiedOrders]);
  const preparingOrders = useMemo(() => orders.filter((o) => o.status === "preparing"), [orders]);
  const readyOrders = useMemo(() => orders.filter((o) => o.status === "ready"), [orders]);
  const shiftDuration = Math.floor((now.getTime() - shiftStart.getTime()) / 60000);
  const shiftStr = shiftDuration < 60 ? `${shiftDuration}m` : `${Math.floor(shiftDuration / 60)}h ${shiftDuration % 60}m`;

  const dateStr = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="cd-root">
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <header className="cd-header">
        <div className="cd-header-left">
          <div className="cd-logo" aria-hidden="true">
            {restaurant.name.charAt(0).toUpperCase()}
          </div>
          <div className="cd-header-info">
            <div className="cd-restaurant-name">{restaurant.name}</div>
            <div className="cd-shift-badge">
              <span className="cd-shift-dot" />
              Cashier · Active Shift
            </div>
          </div>
        </div>
        <div className="cd-header-right">
          <div className="cd-header-datetime">
            <div className="cd-header-date">{dateStr}</div>
            <div className="cd-header-time">{timeStr}</div>
          </div>
          <button className="cd-icon-btn" aria-label="Notifications">
            🔔<span className="cd-notif-dot" aria-hidden="true" />
          </button>
          <button className="cd-signout-btn" onClick={handleSignOut}>
            ⎋ Sign Out
          </button>
        </div>
      </header>

      <div className="cd-body">
        {error && <div className="cd-error-banner">⚠️ {error}</div>}

        {/* ── KPI CARDS ──────────────────────────────────────────────────── */}
        {loading
          ? <div className="cd-kpi-grid">{Array.from({ length: 9 }).map((_, i) => <div key={i} className="cd-skeleton cd-skeleton-kpi" />)}</div>
          : <div className="cd-kpi-grid">
              <KpiCard label="Today's Revenue" value={fmtMoney(todayRevenue)} icon="💰" iconClass="blue" change="Live data" />
              <KpiCard label="Orders Today" value={`${orders.length}`} icon="📋" iconClass="green" change={`${verifiedOrders.length} verified`} />
              <KpiCard label="Pending Payments" value={`${pending.length}`} icon="⏳" iconClass="yellow" change="Needs action" warning={pending.length > 0} />
              <KpiCard label="Avg Order Value" value={fmtMoney(Math.round(avgOrder))} icon="📊" iconClass="purple" />
              <KpiCard label="Completed Today" value={`${completedOrders.length}`} icon="✅" iconClass="green" change={`${verifiedOrders.length} paid`} />
              <KpiCard label="Cash Collected" value={fmtMoney(cashCollected)} icon="💵" iconClass="blue" />
              <KpiCard label="Digital Payments" value={fmtMoney(digitalPayments)} icon="D" iconClass="purple" />
              <KpiCard label="Preparing Orders" value={`${preparingOrders.length}`} icon="P" iconClass="yellow" />
              <KpiCard label="Ready Orders" value={`${readyOrders.length}`} icon="R" iconClass="green" />
            </div>
        }

        {/* ── ANALYTICS ROW ──────────────────────────────────────────────── */}
        {!loading && (
          <div className="cd-analytics-row">
            <div className="cd-card">
              <div className="cd-card-header">
                <div><div className="cd-card-title">Revenue Analytics</div><div className="cd-card-subtitle">Today's hourly revenue</div></div>
                <span style={{ fontSize: 12, color: "var(--cd-muted)" }}>6AM – 10PM</span>
              </div>
              <RevenueChart orders={orders} />
            </div>
            <div className="cd-card">
              <div className="cd-card-header">
                <div><div className="cd-card-title">Payment Methods</div><div className="cd-card-subtitle">Today's breakdown</div></div>
              </div>
              <PaymentDonut orders={orders} />
            </div>
          </div>
        )}

        {/* ── LIVE ACTIVITY + SHIFT PANEL ────────────────────────────────── */}
        {!loading && (
          <div className="cd-analytics-row">
            <div className="cd-card">
              <div className="cd-card-header">
                <div className="cd-card-title">Live Order Activity</div>
              </div>
              <div className="cd-activity-list">
                {verifiedOrders.slice(0, 6).length === 0
                  ? <div className="cd-empty"><div className="cd-empty-icon">💳</div><div className="cd-empty-title">No approved payments yet</div></div>
                  : verifiedOrders.slice(0, 6).map((o) => (
                      <div key={o.id} className="cd-activity-item">
                        <div className="cd-activity-dot" />
                        <div className="cd-activity-content">
                          <div className="cd-activity-main">
                            Table {o.tableNumber || "—"} · {fmtOrderId(o.id)} approved
                          </div>
                          <div className="cd-activity-sub">
                            {o.customerName || "Guest"} · {o.paymentMethod || "—"} · <span style={{textTransform:"capitalize"}}>{o.status}</span>
                          </div>
                        </div>
                        <div>
                          <div className="cd-activity-amount">{fmtMoney(o.totalPrice)}</div>
                          <div className="cd-activity-time">{timeAgo(o.paymentVerifiedAt ?? o.createdAt)}</div>
                        </div>
                      </div>
                    ))
                }
              </div>
            </div>
            <div className="cd-card">
              <div className="cd-card-header">
                <div className="cd-card-title">Shift Performance</div>
                <div className="cd-card-subtitle">{cashierName || "Cashier"}</div>
              </div>
              <div className="cd-shift-grid">
                <div className="cd-shift-stat"><div className="cd-shift-stat-label">Approved Today</div><div className="cd-shift-stat-value">{verifiedOrders.length}</div></div>
                <div className="cd-shift-stat"><div className="cd-shift-stat-label">Revenue Processed</div><div className="cd-shift-stat-value">{fmtMoney(todayRevenue)}</div></div>
                <div className="cd-shift-stat"><div className="cd-shift-stat-label">Pending</div><div className="cd-shift-stat-value" style={{ color: pending.length > 0 ? "var(--cd-warning)" : "inherit" }}>{pending.length}</div></div>
                <div className="cd-shift-stat"><div className="cd-shift-stat-label">Shift Duration</div><div className="cd-shift-stat-value">{shiftStr}</div></div>
              </div>
            </div>
          </div>
        )}

        {/* ── ORDERS TABS ────────────────────────────────────────────────── */}
        {!loading && (
          <div className="cd-card">
            <div className="cd-card-header">
              <div className="cd-tabs">
                <button className={`cd-tab${tab === "pending" ? " active" : ""}`} onClick={() => setTab("pending")}>
                  Pending <span className="cd-tab-badge">{pending.length}</span>
                </button>
                <button className={`cd-tab${tab === "paid" ? " active" : ""}`} onClick={() => setTab("paid")}>
                  Paid <span className="cd-tab-badge" style={{ background: tab === "paid" ? "var(--cd-success)" : "var(--cd-muted)" }}>{paid.length}</span>
                </button>
              </div>
            </div>

            {tab === "pending" && (
              pending.length === 0
                ? <div className="cd-empty"><div className="cd-empty-icon">🎉</div><div className="cd-empty-title">No pending payments</div><div className="cd-empty-sub">All orders are up to date.</div></div>
                : <div className="cd-table-wrap">
                    <table className="cd-table">
                      <thead>
                        <tr>
                          <th>Order</th><th>Customer</th><th>Table</th><th>Items</th>
                          <th>Payment</th><th>Total</th><th>Created</th><th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pending.map((o) => (
                          <tr key={o.id} onClick={() => setDrawerOrder(o)}>
                            <td>
                              <span className="cd-order-id">{fmtOrderId(o.id)}</span>
                              <span className="cd-table-badge">TABLE {o.tableNumber || "—"}</span>
                            </td>
                            <td>
                              <span className="cd-table-name">{o.customerName || "Guest"}</span>
                            </td>
                            <td>{o.tableNumber || "—"}</td>
                            <td>{o.items.length}</td>
                            <td><span className={`cd-badge ${(o.paymentMethod ?? "").toLowerCase().replace(/\s+/g,"") === "cash" ? "cash" : (o.paymentMethod ?? "").toLowerCase().includes("telebirr") ? "telebirr" : "cbe"}`}>{o.paymentMethod || "—"}</span></td>
                            <td><strong>{fmtMoney(o.totalPrice)}</strong></td>
                            <td><span className="cd-table-muted">{fmtDateTime(o.createdAt)}</span></td>
                            <td onClick={(e) => e.stopPropagation()}>
                              <div className="cd-action-group">
                                <button className="cd-approve-btn" disabled={approvingId === o.id} onClick={() => handleApprove(o.id)}>
                                  {approvingId === o.id ? "..." : "Approve"}
                                </button>
                                <button className="cd-view-btn" onClick={() => setDrawerOrder(o)}>Details</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
            )}

            {tab === "paid" && (
              paid.length === 0
                ? <div className="cd-empty"><div className="cd-empty-icon">📭</div><div className="cd-empty-title">No paid orders yet</div><div className="cd-empty-sub">Approved orders will appear here.</div></div>
                : <div className="cd-table-wrap">
                    <table className="cd-table">
                      <thead>
                        <tr>
                          <th>Order</th><th>Customer</th><th>Table</th>
                          <th>Payment</th><th>Amount</th><th>Approved</th><th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paid.map((o) => (
                          <tr key={o.id} onClick={() => setDrawerOrder(o)}>
                            <td>
                              <span className="cd-order-id">{fmtOrderId(o.id)}</span>
                              <span className="cd-table-badge">TABLE {o.tableNumber || "—"}</span>
                            </td>
                            <td><span className="cd-table-name">{o.customerName || "Guest"}</span></td>
                            <td>{o.tableNumber || "—"}</td>
                            <td><span className="cd-badge paid">{o.paymentMethod || "—"}</span></td>
                            <td><strong>{fmtMoney(o.totalPrice)}</strong></td>
                            <td><span className="cd-table-muted">{o.paymentVerifiedAt ? fmtDateTime(o.paymentVerifiedAt) : "—"}</span></td>
                            <td><span className={`cd-badge ${o.status === "completed" ? "paid" : o.status === "ready" ? "telebirr" : o.status === "preparing" ? "cbe" : "paid"}`}>{o.status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
            )}
          </div>
        )}
      </div>

      {/* ── DRAWER ─────────────────────────────────────────────────────────── */}
      {drawerOrder && (
        <OrderDrawer
          order={drawerOrder}
          onClose={() => setDrawerOrder(null)}
          onApprove={drawerOrder.status === "pending_payment" ? () => handleApprove(drawerOrder.id) : undefined}
          approving={approvingId === drawerOrder.id}
        />
      )}
    </div>
  );
}

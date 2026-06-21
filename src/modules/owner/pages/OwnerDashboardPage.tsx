import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../../core/database";
import { signOutStaff } from "../../staff-auth/services/staffAuthService";
import "../styles/ownerDashboard.css";

// ─── helpers ─────────────────────────────────────────────────────────────────
function fmtMoney(v: number) { return `ETB ${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`; }
function fmtMoneyK(v: number) { return v >= 1000 ? `ETB ${(v/1000).toFixed(1)}k` : fmtMoney(v); }
function fmtOrderId(id: string) { return `#SF-${id.slice(0,4).toUpperCase()}`; }
function fmtDateTime(iso: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
function useNow() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 30000); return () => clearInterval(id); }, []);
  return t;
}

// ─── types ───────────────────────────────────────────────────────────────────
type OdOrder = {
  id: string; status: string; customer_name: string | null; table_number: string | null;
  payment_method: string | null; total_price: number; created_at: string;
  payment_verified_at: string | null; item_count?: number;
};
type OdStaff = {
  id: string; user_id: string; display_name: string; role: string; active: boolean;
  email?: string; created_at: string;
};
type OdMenuItem = { id: string; name: string; price: number; available: boolean; category_id: string; };

type NavId = "overview" | "orders" | "analytics" | "menu" | "staff" | "qr" | "customers" | "reports" | "settings";

const NAV_ITEMS: { id: NavId; icon: string; label: string }[] = [
  { id: "overview",   icon: "⊞",  label: "Overview" },
  { id: "orders",     icon: "📋", label: "Orders" },
  { id: "analytics",  icon: "📈", label: "Revenue & Analytics" },
  { id: "menu",       icon: "🍽", label: "Menu" },
  { id: "staff",      icon: "👥", label: "Staff" },
  { id: "qr",         icon: "⊡",  label: "QR & Tables" },
  { id: "customers",  icon: "🧑", label: "Customers" },
  { id: "reports",    icon: "📊", label: "Reports" },
  { id: "settings",   icon: "⚙",  label: "Settings" },
];

type OwnerDashboardPageProps = { restaurantId: string; restaurantName: string; ownerName?: string; };

export function OwnerDashboardPage({ restaurantId, restaurantName, ownerName }: OwnerDashboardPageProps) {
  const now = useNow();
  const [nav, setNav] = useState<NavId>("overview");
  const [orders, setOrders] = useState<OdOrder[]>([]);
  const [staff, setStaff] = useState<OdStaff[]>([]);
  const [menuItems, setMenuItems] = useState<OdMenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        const todayStart = new Date(); todayStart.setHours(0,0,0,0);
        const [{ data: orderData }, { data: staffData }, { data: menuData }] = await Promise.all([
          supabase.from("orders")
            .select("id,status,customer_name,table_number,payment_method,total_price,created_at,payment_verified_at")
            .eq("restaurant_id", restaurantId)
            .gte("created_at", todayStart.toISOString())
            .order("created_at", { ascending: false })
            .limit(100),
          supabase.from("restaurant_staff")
            .select("id,user_id,display_name,role,active,created_at")
            .eq("restaurant_id", restaurantId),
          supabase.from("menu_items")
            .select("id,name,price,available,category_id")
            .eq("restaurant_id", restaurantId),
        ]);
        if (!mounted) return;
        setOrders((orderData ?? []).map(r => ({ ...r, total_price: Number(r.total_price) })));
        setStaff(staffData ?? []);
        setMenuItems(menuData ?? []);
      } catch (e) { if (mounted) setError(e instanceof Error ? e.message : "Failed to load data."); }
      finally { if (mounted) setLoading(false); }
    }
    void load();
    return () => { mounted = false; };
  }, [restaurantId]);

  // ── realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase.channel(`owner-${restaurantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
        (payload) => {
          const row = payload.new as OdOrder;
          if (!row?.id) return;
          const order = { ...row, total_price: Number(row.total_price) };
          setOrders(p => { const i = p.findIndex(o => o.id === order.id); if (i >= 0) { const n = [...p]; n[i] = order; return n; } return [order, ...p]; });
        }).subscribe();
    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
  }, [restaurantId]);

  // ── derived ───────────────────────────────────────────────────────────────
  const todayRevenue = useMemo(() => orders.filter(o => o.status === "paid").reduce((s,o) => s + o.total_price, 0), [orders]);
  const totalOrders = orders.length;
  const avgOrderValue = totalOrders > 0 ? Math.round(todayRevenue / Math.max(orders.filter(o => o.status === "paid").length, 1)) : 0;
  const activeStaff = staff.filter(s => s.active).length;
  const pendingOrders = orders.filter(o => o.status === "pending_payment");
  const paidOrders = orders.filter(o => o.status === "paid");

  // sparkline data (last 7 hours)
  const sparkData = Array.from({ length: 7 }, (_, i) => {
    const h = new Date(); h.setHours(h.getHours() - (6 - i), 0, 0, 0);
    return orders.filter(o => o.status === "paid" && new Date(o.created_at).getHours() === h.getHours()).reduce((s,o) => s + o.total_price, 0);
  });
  const sparkMax = Math.max(...sparkData, 1);

  // bar chart (hourly)
  const barHours = [8,9,10,11,12,13,14,15,16,17,18,19,20];
  const barData = barHours.map(h => orders.filter(o => o.status === "paid" && new Date(o.created_at).getHours() === h).reduce((s,o) => s + o.total_price, 0));
  const barMax = Math.max(...barData, 1);

  // payment method donut
  const methods = ["Cash","Telebirr","CBE Birr","Mobile Banking","Chapa","Credit/Debit Card"];
  const colors = ["#0f766e","#f59e0b","#1e3a5f","#7c3aed","#ef4444","#0891b2"];
  const methodCounts = methods.map(m => paidOrders.filter(o => o.payment_method === m).length);
  const methodTotal = methodCounts.reduce((s,c) => s + c, 1);
  const donutData = methods.map((m,i) => ({ label: m, pct: Math.round((methodCounts[i] / methodTotal) * 100), color: colors[i] })).filter(d => d.pct > 0);
  if (donutData.length === 0) donutData.push({ label: "No data", pct: 100, color: "#e2e8f0" });
  let donutOffset = 0;
  const r = 54; const cx = 70; const cy = 70; const circ = 2 * Math.PI * r;
  const donutSlices = donutData.map(d => { const dash = (d.pct/100)*circ; const gap = circ-dash; const s = { ...d, dash, gap, offset: donutOffset }; donutOffset += dash; return s; });

  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  async function handleSignOut() { try { await signOutStaff(); } finally { window.location.replace("/staff-login"); } }

  return (
    <div className="od-root">
      {/* ── SIDEBAR ─────────────────────────────────────────────────────── */}
      <aside className="od-sidebar">
        <div className="od-sidebar-brand">
          <div className="od-brand-icon">S</div>
          <div>
            <div className="od-brand-text">ServeFlow</div>
            <div className="od-brand-sub">Management Suite</div>
          </div>
        </div>
        <nav className="od-nav" aria-label="Dashboard navigation">
          {NAV_ITEMS.map(item => (
            <button key={item.id} className={`od-nav-item${nav === item.id ? " active" : ""}`} onClick={() => setNav(item.id)}>
              <span className="od-nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="od-sidebar-footer">
          <div className="od-restaurant-badge">
            <div className="od-restaurant-avatar">{restaurantName.charAt(0)}</div>
            <div>
              <div className="od-restaurant-name">{restaurantName}</div>
              <div className="od-restaurant-role">Admin Access</div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── MAIN ────────────────────────────────────────────────────────── */}
      <div className="od-main">
        {/* ── TOP BAR ─────────────────────────────────────────────────── */}
        <header className="od-topbar">
          <div className="od-branch-selector">📍 {restaurantName} ▾</div>
          <div className="od-topbar-search">
            <span className="od-search-icon">🔍</span>
            <input placeholder="Search orders, tables..." aria-label="Search" />
          </div>
          <div className="od-topbar-right">
            <span className="od-topbar-date">{dateStr}</span>
            <span className="od-topbar-revenue">{fmtMoney(todayRevenue)} today</span>
            <button className="od-icon-btn" aria-label="Notifications">
              🔔<span className="od-notif-dot" />
            </button>
            <div className="od-profile">
              <div className="od-profile-avatar">{(ownerName ?? restaurantName).charAt(0)}</div>
              <div className="od-profile-info">
                <div className="od-profile-name">{ownerName || "Owner"}</div>
                <div className="od-profile-role">Restaurant Owner</div>
              </div>
            </div>
            <button className="od-btn-ghost" onClick={handleSignOut} style={{ marginLeft: 4 }}>⎋ Sign Out</button>
          </div>
        </header>

        {error && <div style={{ margin: "12px 24px", padding: "12px 16px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, color: "#dc2626", fontSize: 14 }}>⚠️ {error}</div>}

        {/* ── PAGE BODY ───────────────────────────────────────────────── */}
        {nav === "overview" && <OverviewPage orders={orders} paidOrders={paidOrders} pendingOrders={pendingOrders} todayRevenue={todayRevenue} totalOrders={totalOrders} avgOrderValue={avgOrderValue} activeStaff={activeStaff} menuItems={menuItems} sparkData={sparkData} sparkMax={sparkMax} barData={barData} barMax={barMax} barHours={barHours} donutSlices={donutSlices} donutData={donutData} r={r} cx={cx} cy={cy} loading={loading} />}
        {nav === "orders" && <OrdersPage orders={orders} loading={loading} />}
        {nav === "analytics" && <AnalyticsPage orders={paidOrders} todayRevenue={todayRevenue} barData={barData} barMax={barMax} barHours={barHours} donutSlices={donutSlices} donutData={donutData} r={r} cx={cx} cy={cy} menuItems={menuItems} />}
        {nav === "staff" && <StaffPage staff={staff} restaurantId={restaurantId} />}
        {nav === "menu" && <MenuPage items={menuItems} />}
        {nav === "qr" && <QrTablesPage restaurantName={restaurantName} />}
        {(nav === "customers" || nav === "reports" || nav === "settings") && <ComingSoonPage nav={nav} />}
      </div>
    </div>
  );
}

// ─── OVERVIEW PAGE ────────────────────────────────────────────────────────────
function OverviewPage({ orders, paidOrders, pendingOrders, todayRevenue, totalOrders, avgOrderValue, activeStaff, menuItems, sparkData, sparkMax, barData, barMax, barHours, donutSlices, donutData, r, cx, cy, loading }: {
  orders: OdOrder[]; paidOrders: OdOrder[]; pendingOrders: OdOrder[];
  todayRevenue: number; totalOrders: number; avgOrderValue: number; activeStaff: number;
  menuItems: OdMenuItem[]; sparkData: number[]; sparkMax: number;
  barData: number[]; barMax: number; barHours: number[];
  donutSlices: {label:string;pct:number;color:string;dash:number;gap:number;offset:number}[];
  donutData: {label:string;pct:number;color:string}[];
  r:number; cx:number; cy:number; loading: boolean;
}) {
  const kpis = [
    { label: "Revenue Today", value: fmtMoney(todayRevenue), badge: "+12%", badgeType: "up" as const },
    { label: "Total Orders", value: `${totalOrders}`, badge: "+5.2%", badgeType: "up" as const },
    { label: "Active Tables", value: `${pendingOrders.length} active`, badge: "High", badgeType: "neutral" as const },
    { label: "Avg Order Value", value: fmtMoney(avgOrderValue), badge: "+0.2", badgeType: "up" as const },
    { label: "Pending Payment", value: `${pendingOrders.length}`, badge: "Live", badgeType: "neutral" as const },
    { label: "Active Staff", value: `${activeStaff}`, badge: "", badgeType: "neutral" as const },
    { label: "Menu Items", value: `${menuItems.length}`, badge: "", badgeType: "neutral" as const },
    { label: "Completed Today", value: `${paidOrders.length}`, badge: "", badgeType: "up" as const },
  ];

  return (
    <div className="od-page">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">Executive Overview</h1>
          <p className="od-page-subtitle">Real-time operational performance for {""}</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="od-btn-ghost">📅 Today</button>
          <button className="od-btn-primary">⬇ Export Report</button>
        </div>
      </div>

      {/* KPI grid */}
      {loading
        ? <div className="od-kpi-grid">{Array.from({length:8}).map((_,i) => <div key={i} className="od-skeleton od-skel-kpi"/>)}</div>
        : <div className="od-kpi-grid">
            {kpis.map((k,i) => (
              <div key={k.label} className="od-kpi-card">
                <div className="od-kpi-top">
                  <div className="od-kpi-label">{k.label}</div>
                  {k.badge && <span className={`od-kpi-badge ${k.badgeType}`}>{k.badgeType === "up" ? "↑" : ""}{k.badge}</span>}
                </div>
                <div className="od-kpi-value">{k.value}</div>
                <div className="od-kpi-sparkline">
                  {sparkData.map((v,j) => (
                    <div key={j} className={`od-spark-bar${j === sparkData.length-1 ? " active" : ""}`}
                      style={{ height: `${Math.max(20, (v/sparkMax)*100)}%` }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
      }

      {/* Charts + quick actions */}
      <div className="od-two-col">
        <div className="od-card">
          <div className="od-card-header">
            <div>
              <div className="od-card-title">Today's Revenue Performance</div>
            </div>
            <div className="od-chart-tabs">
              <button className="od-chart-tab active">Hourly</button>
              <button className="od-chart-tab">Weekly</button>
            </div>
          </div>
          <div className="od-chart-area">
            <div className="od-bar-chart">
              {barData.map((v,i) => (
                <div key={i} className="od-bar-col">
                  <div className="od-bar" style={{ height: `${Math.max(4, (v/barMax)*130)}px` }} title={`${barHours[i]}:00 — ${fmtMoney(v)}`} />
                  <div className="od-bar-label">{barHours[i] < 12 ? `${barHours[i]}AM` : barHours[i] === 12 ? "12PM" : `${barHours[i]-12}PM`}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="od-card">
            <div className="od-card-header"><div className="od-card-title">Quick Actions</div></div>
            <div className="od-quick-actions">
              {[
                { icon: "🛒", title: "New Manual Order", sub: "Direct POS entry" },
                { icon: "⏱", title: "Staff Shift Start", sub: "Log attendance" },
                { icon: "🍽", title: "Menu Update", sub: "Price & availability" },
              ].map(qa => (
                <div key={qa.title} className="od-quick-action">
                  <div className="od-qa-icon">{qa.icon}</div>
                  <div><div className="od-qa-title">{qa.title}</div><div className="od-qa-sub">{qa.sub}</div></div>
                  <span className="od-qa-arrow">›</span>
                </div>
              ))}
            </div>
          </div>
          <div className="od-kitchen-card">
            <div className="od-kitchen-title">🍳 Kitchen Status</div>
            <div className="od-kitchen-staff">
              {["K","C","O","S"].map(l => <div key={l} className="od-staff-chip">{l}</div>)}
            </div>
            <div className="od-kitchen-stat-label">AVG PREP TIME</div>
            <div className="od-kitchen-stat-value">14m 20s</div>
          </div>
        </div>
      </div>

      {/* Recent orders */}
      <div className="od-card">
        <div className="od-card-header">
          <div className="od-card-title">Recent High-Value Orders</div>
          <button className="od-btn-ghost" style={{ fontSize: 12 }}>View All Orders</button>
        </div>
        <div className="od-table-wrap">
          <table className="od-table">
            <thead><tr><th>Order ID</th><th>Table</th><th>Customer</th><th>Items</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {orders.slice(0,5).map(o => (
                <tr key={o.id}>
                  <td><span className="od-order-id">{fmtOrderId(o.id)}</span></td>
                  <td>Table {o.table_number || "—"}</td>
                  <td>{o.customer_name || "Guest"}</td>
                  <td>—</td>
                  <td><span className="od-amount">{fmtMoney(o.total_price)}</span></td>
                  <td><span className={`od-status-badge ${o.status === "paid" ? "paid" : o.status === "preparing" ? "prep" : o.status === "ready" ? "ready" : "pending"}`}>{o.status === "pending_payment" ? "Pending" : o.status === "paid" ? "Paid" : o.status === "preparing" ? "In Prep" : o.status}</span></td>
                </tr>
              ))}
              {orders.length === 0 && <tr><td colSpan={6}><div className="od-empty"><div className="od-empty-icon">📭</div><div className="od-empty-msg">No orders today</div></div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── ORDERS PAGE ───────────────────────────────────────────────────────────────
function OrdersPage({ orders, loading }: { orders: OdOrder[]; loading: boolean }) {
  const [tab, setTab] = useState<string>("all");
  const filtered = tab === "all" ? orders : orders.filter(o => {
    if (tab === "pending") return o.status === "pending_payment";
    if (tab === "paid") return o.status === "paid";
    if (tab === "preparing") return o.status === "preparing";
    if (tab === "ready") return o.status === "ready";
    return true;
  });
  return (
    <div className="od-page">
      <div className="od-page-header">
        <div><h1 className="od-page-title">Live Order Center</h1><p className="od-page-subtitle">Real-time operational command center</p></div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ padding: "6px 14px", borderRadius: 9, background: "var(--od-primary)", color: "#fff", fontSize: 13, fontWeight: 700 }}>{orders.length} Active Orders</div>
        </div>
      </div>
      <div className="od-tabs">
        {["all","pending","paid","preparing","ready"].map(t => (
          <button key={t} className={`od-tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
            {t === "all" ? "All" : t === "pending" ? "Pending Payment" : t === "paid" ? "Paid" : t === "preparing" ? "Preparing" : "Ready"}
            {" "}({t === "all" ? orders.length : orders.filter(o => t === "pending" ? o.status === "pending_payment" : o.status === t).length})
          </button>
        ))}
      </div>
      <div className="od-card">
        <div className="od-table-wrap">
          <table className="od-table">
            <thead><tr><th>Order ID</th><th>Table</th><th>Customer</th><th>Payment</th><th>Total</th><th>Time</th><th>Status</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={7}><div style={{padding:32,textAlign:"center",color:"var(--od-muted)"}}>Loading orders...</div></td></tr>
                : filtered.length === 0
                  ? <tr><td colSpan={7}><div className="od-empty"><div className="od-empty-icon">📭</div><div className="od-empty-msg">No orders</div></div></td></tr>
                  : filtered.map(o => (
                    <tr key={o.id}>
                      <td><span className="od-order-id">{fmtOrderId(o.id)}</span></td>
                      <td><strong>Table {o.table_number || "—"}</strong></td>
                      <td>{o.customer_name || "Guest"}</td>
                      <td>{o.payment_method || "—"}</td>
                      <td><span className="od-amount">{fmtMoney(o.total_price)}</span></td>
                      <td style={{fontSize:12,color:"var(--od-muted)"}}>{fmtDateTime(o.created_at)}</td>
                      <td><span className={`od-status-badge ${o.status === "paid" ? "paid" : o.status === "preparing" ? "prep" : o.status === "ready" ? "ready" : "pending"}`}>{o.status === "pending_payment" ? "Pending" : o.status === "paid" ? "Paid" : o.status === "preparing" ? "Preparing" : o.status}</span></td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── ANALYTICS PAGE ────────────────────────────────────────────────────────────
function AnalyticsPage({ orders, todayRevenue, barData, barMax, barHours, donutSlices, donutData, r, cx, cy, menuItems }: {
  orders: OdOrder[]; todayRevenue: number; barData: number[]; barMax: number; barHours: number[];
  donutSlices: {label:string;pct:number;color:string;dash:number;gap:number;offset:number}[];
  donutData: {label:string;pct:number;color:string}[];
  r:number; cx:number; cy:number; menuItems: OdMenuItem[];
}) {
  return (
    <div className="od-page">
      <div className="od-page-header">
        <div><h1 className="od-page-title">Revenue & Analytics</h1><p className="od-page-subtitle">Real-time financial tracking</p></div>
        <div className="od-tabs"><button className="od-tab active">Today</button><button className="od-tab">Week</button><button className="od-tab">Month</button></div>
      </div>
      <div className="od-kpi-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        <div className="od-kpi-card"><div className="od-kpi-top"><div className="od-kpi-label">Net Revenue</div><span className="od-kpi-badge up">+12.4%↑</span></div><div className="od-kpi-value">{fmtMoneyK(todayRevenue)}</div></div>
        <div className="od-kpi-card"><div className="od-kpi-top"><div className="od-kpi-label">Avg Ticket</div><span className="od-kpi-badge up">+5.2%↑</span></div><div className="od-kpi-value">{orders.length > 0 ? fmtMoney(Math.round(todayRevenue / orders.length)) : "ETB 0"}</div></div>
        <div className="od-kpi-card"><div className="od-kpi-top"><div className="od-kpi-label">Returning Customers</div><span className="od-kpi-badge down">-2.1%</span></div><div className="od-kpi-value">65%</div></div>
      </div>
      <div className="od-two-col">
        <div className="od-card">
          <div className="od-card-header"><div className="od-card-title">Revenue vs Orders</div></div>
          <div className="od-chart-area">
            <div className="od-bar-chart">
              {barData.map((v,i) => (
                <div key={i} className="od-bar-col">
                  <div className="od-bar" style={{ height: `${Math.max(4, (v/barMax)*130)}px` }} />
                  <div className="od-bar-label">{barHours[i] < 12 ? `${barHours[i]}AM` : barHours[i] === 12 ? "12" : `${barHours[i]-12}PM`}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="od-card">
          <div className="od-card-header"><div className="od-card-title">Payment Methods</div></div>
          <div className="od-donut-wrap">
            <svg width="140" height="140" viewBox="0 0 140 140">
              {donutSlices.map((s,i) => (
                <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth="20"
                  strokeDasharray={`${s.dash} ${s.gap}`} strokeDashoffset={-s.offset}
                  transform={`rotate(-90 ${cx} ${cy})`} />
              ))}
              <text x={cx} y={cy-6} textAnchor="middle" fontSize="10" fill="var(--od-muted)" fontWeight="600">TOTAL</text>
              <text x={cx} y={cy+10} textAnchor="middle" fontSize="14" fill="var(--od-text)" fontWeight="800">{fmtMoneyK(todayRevenue)}</text>
            </svg>
            <div className="od-legend">
              {donutData.map(d => (
                <div key={d.label} className="od-legend-row">
                  <div className="od-legend-dot-label"><div className="od-legend-dot" style={{ background: d.color }} /><span>{d.label}</span></div>
                  <span style={{ fontWeight: 700 }}>{d.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="od-card">
        <div className="od-card-header"><div className="od-card-title">Top Selling Items</div><button className="od-btn-ghost" style={{fontSize:12}}>View Detailed Report ↗</button></div>
        <div className="od-table-wrap">
          <table className="od-table">
            <thead><tr><th>Rank</th><th>Item Name</th><th>Orders</th><th>Status</th><th>Revenue</th></tr></thead>
            <tbody>
              {menuItems.slice(0,6).map((item,i) => (
                <tr key={item.id}>
                  <td><span className="od-rank">#{i+1}</span></td>
                  <td><strong>{item.name}</strong></td>
                  <td>{Math.floor(Math.random()*400)+50}</td>
                  <td><span className={`od-item-badge ${i === 0 ? "bestseller" : i === 1 ? "trending" : "stable"}`}>{i === 0 ? "Best Seller" : i === 1 ? "Trending" : "Stable"}</span></td>
                  <td><span className="od-amount">{fmtMoney(item.price * (Math.floor(Math.random()*400)+50))}</span></td>
                </tr>
              ))}
              {menuItems.length === 0 && <tr><td colSpan={5}><div className="od-empty"><div className="od-empty-icon">🍽</div><div className="od-empty-msg">No menu items yet</div></div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── STAFF PAGE ────────────────────────────────────────────────────────────────
function StaffPage({ staff, restaurantId }: { staff: OdStaff[]; restaurantId: string }) {
  const [tab, setTab] = useState("all");
  const filtered = tab === "all" ? staff : staff.filter(s => s.role === tab);
  return (
    <div className="od-page">
      <div className="od-page-header">
        <div><h1 className="od-page-title">Personnel Command Center</h1><p className="od-page-subtitle">Manage your roster, track performance, and optimize kitchen efficiency.</p></div>
        <button className="od-btn-primary">👤+ Add New Staff</button>
      </div>
      <div className="od-tabs">
        {[["all","All Members"],["owner","Owners"],["cashier","Cashiers"],["kitchen","Kitchen Staff"]].map(([v,l]) => (
          <button key={v} className={`od-tab${tab === v ? " active" : ""}`} onClick={() => setTab(v)}>
            {l} {v === "all" && <span style={{ background: "var(--od-primary)", color: "#fff", borderRadius: 999, padding: "1px 7px", fontSize: 11, fontWeight: 800, marginLeft: 4 }}>{staff.length}</span>}
          </button>
        ))}
      </div>
      <div className="od-card">
        <div className="od-card-header"><div className="od-card-title">Current Roster</div></div>
        <div className="od-table-wrap">
          <table className="od-table">
            <thead><tr><th>Staff Member</th><th>Role</th><th>Status</th><th>Last Login</th><th>Orders</th></tr></thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan={5}><div className="od-empty"><div className="od-empty-icon">👥</div><div className="od-empty-msg">No staff in this category</div></div></td></tr>
                : filtered.map(s => (
                    <tr key={s.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div className="od-staff-avatar-small">{(s.display_name || "?").charAt(0).toUpperCase()}</div>
                          <div><div className="od-staff-name">{s.display_name || "Unknown"}</div><div className="od-staff-email">{s.role}@serveflow.com</div></div>
                        </div>
                      </td>
                      <td style={{ textTransform: "capitalize" }}>{s.role}</td>
                      <td>{s.active ? <span className="od-active-pill"><span className="od-active-dot" />Active</span> : <span className="od-offline-pill">Offline</span>}</td>
                      <td style={{ fontSize: 12, color: "var(--od-muted)" }}>{new Date(s.created_at).toLocaleDateString()}</td>
                      <td>—</td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
        <div style={{ padding: "12px 20px", fontSize: 13, color: "var(--od-muted)", borderTop: "1px solid var(--od-border)", display: "flex", justifyContent: "space-between" }}>
          <span>Showing {filtered.length} of {staff.length} members</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="od-btn-ghost" style={{ height: 30, fontSize: 12 }}>Previous</button>
            <button className="od-btn-primary" style={{ height: 30, fontSize: 12 }}>Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MENU PAGE ─────────────────────────────────────────────────────────────────
function MenuPage({ items }: { items: OdMenuItem[] }) {
  return (
    <div className="od-page">
      <div className="od-page-header">
        <div><h1 className="od-page-title">Menu Management</h1><p className="od-page-subtitle">Manage your restaurant menu, categories, and pricing.</p></div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="od-btn-ghost">📷 Upload Menu Photo</button>
          <button className="od-btn-primary">+ Add Item</button>
        </div>
      </div>
      <div className="od-card">
        <div className="od-table-wrap">
          <table className="od-table">
            <thead><tr><th>Item Name</th><th>Price</th><th>Availability</th><th>Actions</th></tr></thead>
            <tbody>
              {items.length === 0
                ? <tr><td colSpan={4}><div className="od-empty"><div className="od-empty-icon">🍽</div><div className="od-empty-msg">No menu items yet</div><div className="od-empty-sub">Add your first item or upload a menu photo</div></div></td></tr>
                : items.map(item => (
                    <tr key={item.id}>
                      <td><strong>{item.name}</strong></td>
                      <td>{fmtMoney(item.price)}</td>
                      <td><span className={`od-status-badge ${item.available ? "paid" : "pending"}`}>{item.available ? "Available" : "Unavailable"}</span></td>
                      <td><div style={{ display: "flex", gap: 8 }}>
                        <button className="od-btn-ghost" style={{ height: 28, fontSize: 11 }}>Edit</button>
                        <button className="od-btn-ghost" style={{ height: 28, fontSize: 11, color: "var(--od-danger)", borderColor: "rgba(220,38,38,0.2)" }}>Delete</button>
                      </div></td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── QR & TABLES PAGE ──────────────────────────────────────────────────────────
function QrTablesPage({ restaurantName }: { restaurantName: string }) {
  const tables = Array.from({ length: 12 }, (_, i) => ({ num: i + 1, status: i < 3 ? "occupied" : i < 5 ? "available" : i < 7 ? "preparing" : "available" }));
  return (
    <div className="od-page">
      <div className="od-page-header">
        <div><h1 className="od-page-title">QR & Table Management</h1><p className="od-page-subtitle">Restaurant floor management for {restaurantName}</p></div>
        <button className="od-btn-primary">⬇ Bulk QR Export</button>
      </div>
      <div className="od-card">
        <div className="od-card-header"><div className="od-card-title">Restaurant Floor</div></div>
        <div style={{ padding: 20, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 14 }}>
          {tables.map(t => (
            <div key={t.num} style={{ padding: "16px", borderRadius: 10, border: "1px solid var(--od-border)", textAlign: "center", background: t.status === "occupied" ? "var(--od-warning-bg)" : t.status === "preparing" ? "#eff6ff" : "var(--od-success-bg)" }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>🪑</div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>Table {t.num}</div>
              <div style={{ fontSize: 11, color: "var(--od-muted)", marginBottom: 10, textTransform: "capitalize" }}>{t.status}</div>
              <button className="od-btn-ghost" style={{ width: "100%", height: 28, fontSize: 11, justifyContent: "center" }}>QR Code</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── COMING SOON ───────────────────────────────────────────────────────────────
function ComingSoonPage({ nav }: { nav: string }) {
  const labels: Record<string,string> = { customers: "Customer Insights", reports: "Reports & Exports", settings: "Restaurant Settings" };
  return (
    <div className="od-page">
      <div style={{ flex: 1, display: "grid", placeItems: "center", minHeight: 400 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🚀</div>
          <h2 style={{ fontSize: 24, fontWeight: 900, color: "var(--od-text)", marginBottom: 8 }}>{labels[nav] || nav}</h2>
          <p style={{ color: "var(--od-muted)", fontSize: 15 }}>This section is coming soon.</p>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../core/database";
import { signOutStaff } from "../../staff-auth/services/staffAuthService";
import {
  createStaff,
  deactivateStaff,
  generateStaffTemporaryPassword,
  loadStaffActivityLog,
  reactivateStaff,
  sendStaffPasswordReset,
  updateStaff,
  type ManagedStaffMember,
  type StaffActivityLog,
} from "../services/staffManagementService";
import "../styles/ownerDashboard.css";

function fmtMoney(value: number) {
  return `ETB ${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtMoneyK(value: number) {
  return value >= 1000 ? `ETB ${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : fmtMoney(value);
}

function fmtOrderId(id: string) {
  return `#SF-${id.slice(0, 5).toUpperCase()}`;
}

function fmtDateTime(iso: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function fmtTimeAgo(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function useNow() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  return time;
}

type OwnerOrderStatus = "pending_payment" | "paid" | "preparing" | "ready" | "completed" | "cancelled";

type OdOrder = {
  id: string;
  status: OwnerOrderStatus;
  customer_name: string | null;
  table_number: string | null;
  payment_method: string | null;
  total_price: number;
  created_at: string;
  payment_verified_at: string | null;
  completed_at: string | null;
  item_count: number;
};

type OdStaff = ManagedStaffMember;

type OdMenuItem = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  available: boolean;
  category_id: string;
  image_url: string | null;
};

type OdCategory = {
  id: string;
  name: string;
};

type OdOrderItem = {
  id: string;
  order_id: string;
  quantity: number;
  price: number;
  menu_item_id: string | null;
  name: string;
};

type NavId = "overview" | "orders" | "analytics" | "menu" | "staff" | "qr" | "customers" | "reports" | "settings";

const NAV_ITEMS: { id: NavId; icon: string; label: string }[] = [
  { id: "overview", icon: "OV", label: "Overview" },
  { id: "orders", icon: "OR", label: "Orders" },
  { id: "analytics", icon: "AN", label: "Revenue & Analytics" },
  { id: "menu", icon: "MN", label: "Menu" },
  { id: "staff", icon: "ST", label: "Staff" },
  { id: "qr", icon: "QR", label: "QR & Tables" },
  { id: "customers", icon: "CU", label: "Customers" },
  { id: "reports", icon: "RP", label: "Reports" },
  { id: "settings", icon: "SE", label: "Settings" },
];

const REVENUE_STATUSES: OwnerOrderStatus[] = ["paid", "preparing", "ready", "completed"];
const ACTIVE_ORDER_STATUSES: OwnerOrderStatus[] = ["pending_payment", "paid", "preparing", "ready"];

type OwnerDashboardPageProps = {
  restaurantId: string;
  restaurantName: string;
  ownerName?: string;
};

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    pending_payment: "Pending",
    paid: "Paid",
    preparing: "Preparing",
    ready: "Ready",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  return labels[status] ?? status;
}

function statusClass(status: string) {
  if (status === "preparing") return "prep";
  if (status === "paid" || status === "completed") return "paid";
  if (status === "ready") return "ready";
  if (status === "cancelled") return "cancelled";
  return "pending";
}

function getMenuItemName(menuItem: unknown) {
  if (Array.isArray(menuItem)) return menuItem[0]?.name || "Menu item";
  if (menuItem && typeof menuItem === "object" && "name" in menuItem) {
    return String((menuItem as { name?: string | null }).name || "Menu item");
  }
  return "Menu item";
}

function startOfTodayIso() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.toISOString();
}

function sameHour(iso: string, hour: number) {
  return new Date(iso).getHours() === hour;
}

function isRevenueOrder(order: OdOrder) {
  return Boolean(order.payment_verified_at) || REVENUE_STATUSES.includes(order.status);
}

export function OwnerDashboardPage({ restaurantId, restaurantName, ownerName }: OwnerDashboardPageProps) {
  const now = useNow();
  const [nav, setNav] = useState<NavId>("overview");
  const [orders, setOrders] = useState<OdOrder[]>([]);
  const [staff, setStaff] = useState<OdStaff[]>([]);
  const [menuItems, setMenuItems] = useState<OdMenuItem[]>([]);
  const [categories, setCategories] = useState<OdCategory[]>([]);
  const [orderItems, setOrderItems] = useState<OdOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const [
          { data: orderData, error: orderError },
          { data: staffData, error: staffError },
          { data: menuData, error: menuError },
          { data: categoryData, error: categoryError },
        ] =
          await Promise.all([
            supabase
              .from("orders")
              .select("id,status,customer_name,table_number,payment_method,total_price,created_at,payment_verified_at,completed_at")
              .eq("restaurant_id", restaurantId)
              .order("created_at", { ascending: false })
              .limit(500),
            supabase
              .from("restaurant_staff")
              .select("id,user_id,display_name,email,role,active,created_at,last_login_at")
              .eq("restaurant_id", restaurantId)
              .order("created_at", { ascending: true }),
            supabase
              .from("menu_items")
              .select("id,name,description,price,available,category_id,image_url")
              .eq("restaurant_id", restaurantId)
              .order("name", { ascending: true }),
            supabase
              .from("categories")
              .select("id,name")
              .eq("restaurant_id", restaurantId)
              .order("name", { ascending: true }),
          ]);

        if (orderError) throw new Error(orderError.message);
        if (staffError) throw new Error(staffError.message);
        if (menuError) throw new Error(menuError.message);
        if (categoryError) throw new Error(categoryError.message);
        if (!mounted) return;

        const normalizedOrders = (orderData ?? []).map((row) => ({
          id: String(row.id),
          status: String(row.status) as OwnerOrderStatus,
          customer_name: row.customer_name ?? null,
          table_number: row.table_number ?? null,
          payment_method: row.payment_method ?? null,
          total_price: Number(row.total_price),
          created_at: String(row.created_at),
          payment_verified_at: row.payment_verified_at ?? null,
          completed_at: row.completed_at ?? null,
          item_count: 0,
        }));

        const orderIds = normalizedOrders.map((order) => order.id);
        let normalizedItems: OdOrderItem[] = [];

        if (orderIds.length > 0) {
          const { data: itemData, error: itemError } = await supabase
            .from("order_items")
            .select("id,order_id,menu_item_id,quantity,price,menu_items!order_items_menu_item_same_restaurant(name)")
            .eq("restaurant_id", restaurantId)
            .in("order_id", orderIds);

          if (itemError) throw new Error(itemError.message);

          normalizedItems = (itemData ?? []).map((row) => ({
            id: String(row.id),
            order_id: String(row.order_id),
            menu_item_id: row.menu_item_id ? String(row.menu_item_id) : null,
            quantity: Number(row.quantity),
            price: Number(row.price),
            name: getMenuItemName(row.menu_items),
          }));
        }

        const itemCounts = new Map<string, number>();
        for (const item of normalizedItems) {
          itemCounts.set(item.order_id, (itemCounts.get(item.order_id) ?? 0) + item.quantity);
        }

        setOrders(normalizedOrders.map((order) => ({ ...order, item_count: itemCounts.get(order.id) ?? 0 })));
        setOrderItems(normalizedItems);
        setStaff((staffData ?? []) as OdStaff[]);
        setMenuItems((menuData ?? []).map((row) => ({ ...row, price: Number(row.price) })) as OdMenuItem[]);
        setCategories((categoryData ?? []) as OdCategory[]);
      } catch (loadError) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : "Failed to load owner dashboard.");
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
    const channel = supabase
      .channel(`owner-${restaurantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` }, (payload) => {
        const deletedId = String((payload.old as { id?: string } | null)?.id ?? "");
        if (payload.eventType === "DELETE") {
          setOrders((previous) => previous.filter((existing) => existing.id !== deletedId));
          return;
        }

        const row = payload.new as Partial<OdOrder>;
        if (!row?.id) return;
        setOrders((previous) => {
          const index = previous.findIndex((existing) => existing.id === row.id);
          const existing = index >= 0 ? previous[index] : undefined;
          const order: OdOrder = {
            id: String(row.id),
            status: String(row.status) as OwnerOrderStatus,
            customer_name: row.customer_name ?? null,
            table_number: row.table_number ?? null,
            payment_method: row.payment_method ?? null,
            total_price: Number(row.total_price),
            created_at: String(row.created_at),
            payment_verified_at: row.payment_verified_at ?? null,
            completed_at: row.completed_at ?? null,
            item_count: existing?.item_count ?? 0,
          };
          if (index >= 0) {
            const next = [...previous];
            next[index] = order;
            return next;
          }
          return [order, ...previous];
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  const todayStart = startOfTodayIso();
  const todayOrders = useMemo(() => orders.filter((order) => order.created_at >= todayStart), [orders, todayStart]);
  const revenueOrders = useMemo(() => todayOrders.filter(isRevenueOrder), [todayOrders]);
  const allRevenueOrders = useMemo(() => orders.filter(isRevenueOrder), [orders]);
  const todayRevenue = useMemo(() => revenueOrders.reduce((sum, order) => sum + order.total_price, 0), [revenueOrders]);
  const allRevenue = useMemo(() => allRevenueOrders.reduce((sum, order) => sum + order.total_price, 0), [allRevenueOrders]);
  const activeOrders = useMemo(() => orders.filter((order) => ACTIVE_ORDER_STATUSES.includes(order.status)), [orders]);
  const pendingOrders = useMemo(() => orders.filter((order) => order.status === "pending_payment"), [orders]);
  const completedToday = useMemo(() => orders.filter((order) => order.status === "completed" && (order.completed_at ?? order.created_at) >= todayStart), [orders, todayStart]);
  const avgOrderValue = revenueOrders.length > 0 ? Math.round(todayRevenue / revenueOrders.length) : 0;
  const activeStaff = staff.filter((member) => member.active).length;
  const kitchenStaff = staff.filter((member) => member.role === "kitchen" && member.active);
  const cashierStaff = staff.filter((member) => member.role === "cashier" && member.active);

  const sparkData = Array.from({ length: 7 }, (_, index) => {
    const hour = new Date();
    hour.setHours(hour.getHours() - (6 - index), 0, 0, 0);
    return revenueOrders.filter((order) => sameHour(order.payment_verified_at ?? order.created_at, hour.getHours())).reduce((sum, order) => sum + order.total_price, 0);
  });
  const sparkMax = Math.max(...sparkData, 1);

  const barHours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const barData = barHours.map((hour) =>
    revenueOrders.filter((order) => sameHour(order.payment_verified_at ?? order.created_at, hour)).reduce((sum, order) => sum + order.total_price, 0)
  );
  const orderBarData = barHours.map((hour) => todayOrders.filter((order) => sameHour(order.created_at, hour)).length);
  const barMax = Math.max(...barData, 1);
  const orderBarMax = Math.max(...orderBarData, 1);

  const methods = ["Cash", "Telebirr", "CBE Birr", "Mobile Banking", "Chapa", "Credit/Debit Card"];
  const colors = ["#0f766e", "#f59e0b", "#475569", "#7c3aed", "#ef4444", "#0891b2"];
  const methodTotals = methods.map((method) =>
    revenueOrders.filter((order) => order.payment_method === method).reduce((sum, order) => sum + order.total_price, 0)
  );
  const methodTotal = Math.max(methodTotals.reduce((sum, value) => sum + value, 0), 1);
  const donutData = methods
    .map((method, index) => ({ label: method, pct: Math.round((methodTotals[index] / methodTotal) * 100), color: colors[index] }))
    .filter((item) => item.pct > 0);
  if (donutData.length === 0) donutData.push({ label: "No payments yet", pct: 100, color: "#e2e8f0" });

  let donutOffset = 0;
  const r = 54;
  const cx = 70;
  const cy = 70;
  const circ = 2 * Math.PI * r;
  const donutSlices = donutData.map((item) => {
    const dash = (item.pct / 100) * circ;
    const slice = { ...item, dash, gap: circ - dash, offset: donutOffset };
    donutOffset += dash;
    return slice;
  });

  const revenueOrderIds = useMemo(() => new Set(allRevenueOrders.map((order) => order.id)), [allRevenueOrders]);
  const topItems = useMemo(() => {
    const totals = new Map<string, { name: string; quantity: number; revenue: number }>();
    for (const item of orderItems) {
      if (!revenueOrderIds.has(item.order_id)) continue;
      const key = item.menu_item_id ?? item.name;
      const current = totals.get(key) ?? { name: item.name, quantity: 0, revenue: 0 };
      current.quantity += item.quantity;
      current.revenue += item.quantity * item.price;
      totals.set(key, current);
    }
    return [...totals.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 6);
  }, [orderItems, revenueOrderIds]);

  const dateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  async function handleSignOut() {
    try {
      await signOutStaff();
    } finally {
      window.location.replace("/staff-login");
    }
  }

  async function refreshStaff() {
    const { data, error: staffError } = await supabase
      .from("restaurant_staff")
      .select("id,user_id,display_name,email,role,active,created_at,last_login_at")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: true });

    if (staffError) {
      throw new Error(staffError.message);
    }

    setStaff((data ?? []) as OdStaff[]);
  }

  async function refreshMenu() {
    const [{ data: menuData, error: menuError }, { data: categoryData, error: categoryError }] = await Promise.all([
      supabase
        .from("menu_items")
        .select("id,name,description,price,available,category_id,image_url")
        .eq("restaurant_id", restaurantId)
        .order("name", { ascending: true }),
      supabase
        .from("categories")
        .select("id,name")
        .eq("restaurant_id", restaurantId)
        .order("name", { ascending: true }),
    ]);

    if (menuError) throw new Error(menuError.message);
    if (categoryError) throw new Error(categoryError.message);

    setMenuItems((menuData ?? []).map((row) => ({ ...row, price: Number(row.price) })) as OdMenuItem[]);
    setCategories((categoryData ?? []) as OdCategory[]);
  }

  const dashboardData = {
    restaurantName,
    orders,
    todayOrders,
    revenueOrders,
    activeOrders,
    pendingOrders,
    completedToday,
    todayRevenue,
    allRevenue,
    avgOrderValue,
    activeStaff,
    kitchenStaff,
    cashierStaff,
    menuItems,
    orderItems,
    sparkData,
    sparkMax,
    barData,
    orderBarData,
    barMax,
    orderBarMax,
    barHours,
    donutSlices,
    donutData,
    topItems,
    r,
    cx,
    cy,
    loading,
  };

  return (
    <div className="od-root">
      <aside className="od-sidebar">
        <div className="od-sidebar-brand">
          <div className="od-brand-icon">S</div>
          <div>
            <div className="od-brand-text">ServeFlow</div>
            <div className="od-brand-sub">Management Suite</div>
          </div>
        </div>

        <nav className="od-nav" aria-label="Dashboard navigation">
          {NAV_ITEMS.map((item) => (
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

      <div className="od-main">
        <header className="od-topbar">
          <div className="od-branch-selector">{restaurantName}</div>
          <div className="od-topbar-search">
            <span className="od-search-icon">/</span>
            <input placeholder="Search orders, tables, staff..." aria-label="Search" />
          </div>
          <div className="od-topbar-right">
            <span className="od-topbar-date">{dateStr}</span>
            <span className="od-topbar-revenue">{fmtMoney(todayRevenue)} today</span>
            <button className="od-icon-btn" aria-label="Notifications">
              !
              <span className="od-notif-dot" />
            </button>
            <div className="od-profile">
              <div className="od-profile-avatar">{(ownerName ?? restaurantName).charAt(0).toUpperCase()}</div>
              <div className="od-profile-info">
                <div className="od-profile-name">{ownerName || "Owner"}</div>
                <div className="od-profile-role">Restaurant Owner</div>
              </div>
            </div>
            <button className="od-btn-ghost" onClick={handleSignOut}>
              Sign Out
            </button>
          </div>
        </header>

        {error && <div className="od-error">Warning: {error}</div>}

        {nav === "overview" && <OverviewPage data={dashboardData} />}
        {nav === "orders" && <OrdersPage orders={orders} activeOrders={activeOrders} loading={loading} restaurantName={restaurantName} />}
        {nav === "analytics" && <AnalyticsPage data={dashboardData} />}
        {nav === "staff" && (
          <StaffPage
            staff={staff}
            restaurantId={restaurantId}
            restaurantName={restaurantName}
            onStaffChanged={refreshStaff}
          />
        )}
        {nav === "menu" && (
          <MenuPage
            restaurantId={restaurantId}
            items={menuItems}
            categories={categories}
            topItems={topItems}
            onMenuChanged={refreshMenu}
          />
        )}
        {nav === "qr" && <QrTablesPage restaurantName={restaurantName} orders={activeOrders} />}
        {(nav === "customers" || nav === "reports" || nav === "settings") && <ComingSoonPage nav={nav} />}
      </div>
    </div>
  );
}

type DashboardData = {
  restaurantName: string;
  orders: OdOrder[];
  todayOrders: OdOrder[];
  revenueOrders: OdOrder[];
  activeOrders: OdOrder[];
  pendingOrders: OdOrder[];
  completedToday: OdOrder[];
  todayRevenue: number;
  allRevenue: number;
  avgOrderValue: number;
  activeStaff: number;
  kitchenStaff: OdStaff[];
  cashierStaff: OdStaff[];
  menuItems: OdMenuItem[];
  orderItems: OdOrderItem[];
  sparkData: number[];
  sparkMax: number;
  barData: number[];
  orderBarData: number[];
  barMax: number;
  orderBarMax: number;
  barHours: number[];
  donutSlices: { label: string; pct: number; color: string; dash: number; gap: number; offset: number }[];
  donutData: { label: string; pct: number; color: string }[];
  topItems: { name: string; quantity: number; revenue: number }[];
  r: number;
  cx: number;
  cy: number;
  loading: boolean;
};

function OverviewPage({ data }: { data: DashboardData }) {
  const kpis = [
    { label: "Revenue Today", value: fmtMoney(data.todayRevenue), badge: "Live", tone: "up" },
    { label: "Total Orders", value: `${data.todayOrders.length}`, badge: `${data.activeOrders.length} active`, tone: "neutral" },
    { label: "Active Tables", value: `${new Set(data.activeOrders.map((order) => order.table_number).filter(Boolean)).size}`, badge: "Now", tone: "neutral" },
    { label: "Avg Order Value", value: fmtMoney(data.avgOrderValue), badge: "Paid", tone: "up" },
    { label: "Pending Payment", value: `${data.pendingOrders.length}`, badge: "Action", tone: data.pendingOrders.length > 0 ? "down" : "neutral" },
    { label: "Active Staff", value: `${data.activeStaff}`, badge: `${data.kitchenStaff.length} kitchen`, tone: "neutral" },
    { label: "Menu Items", value: `${data.menuItems.length}`, badge: `${data.menuItems.filter((item) => item.available).length} live`, tone: "neutral" },
    { label: "Completed Today", value: `${data.completedToday.length}`, badge: "Saved", tone: "up" },
  ];

  return (
    <div className="od-page">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">Executive Overview</h1>
          <p className="od-page-subtitle">Real-time operational performance for {data.restaurantName}</p>
        </div>
        <div className="od-header-actions">
          <button className="od-btn-ghost">Today</button>
          <button className="od-btn-primary">Export Report</button>
        </div>
      </div>

      {data.loading ? (
        <div className="od-kpi-grid">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="od-skeleton od-skel-kpi" />)}</div>
      ) : (
        <div className="od-kpi-grid">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="od-kpi-card">
              <div className="od-kpi-top">
                <div className="od-kpi-label">{kpi.label}</div>
                <span className={`od-kpi-badge ${kpi.tone}`}>{kpi.badge}</span>
              </div>
              <div className="od-kpi-value">{kpi.value}</div>
              <div className="od-kpi-sparkline">
                {data.sparkData.map((value, index) => (
                  <div
                    key={index}
                    className={`od-spark-bar${index === data.sparkData.length - 1 ? " active" : ""}`}
                    style={{ height: `${Math.max(18, (value / data.sparkMax) * 100)}%` }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="od-two-col">
        <div className="od-card">
          <div className="od-card-header">
            <div className="od-card-title">Today's Revenue Performance</div>
            <div className="od-chart-tabs">
              <button className="od-chart-tab active">Hourly</button>
              <button className="od-chart-tab">Orders</button>
            </div>
          </div>
          <RevenueBars data={data} />
        </div>

        <div className="od-side-stack">
          <QuickActions />
          <KitchenStatus data={data} />
        </div>
      </div>

      <RecentOrdersTable orders={data.orders.slice(0, 6)} title="Recent High-Value Orders" emptyLabel="No owner-visible orders yet" />
    </div>
  );
}

function RevenueBars({ data }: { data: DashboardData }) {
  return (
    <div className="od-chart-area">
      <div className="od-bar-chart">
        {data.barData.map((value, index) => (
          <div key={data.barHours[index]} className="od-bar-col">
            <div className="od-bar-pair">
              <div className="od-bar" style={{ height: `${Math.max(4, (value / data.barMax) * 130)}px` }} title={fmtMoney(value)} />
              <div className="od-bar orders" style={{ height: `${Math.max(4, (data.orderBarData[index] / data.orderBarMax) * 100)}px` }} title={`${data.orderBarData[index]} orders`} />
            </div>
            <div className="od-bar-label">
              {data.barHours[index] < 12 ? `${data.barHours[index]}AM` : data.barHours[index] === 12 ? "12PM" : `${data.barHours[index] - 12}PM`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuickActions() {
  const actions = [
    { icon: "+", title: "New Manual Order", sub: "Direct POS entry" },
    { icon: "IN", title: "Staff Shift Start", sub: "Log attendance" },
    { icon: "MN", title: "Menu Update", sub: "Price and availability" },
  ];
  return (
    <div className="od-card">
      <div className="od-card-header">
        <div className="od-card-title">Quick Actions</div>
      </div>
      <div className="od-quick-actions">
        {actions.map((action) => (
          <button key={action.title} className="od-quick-action" type="button">
            <span className="od-qa-icon">{action.icon}</span>
            <span>
              <span className="od-qa-title">{action.title}</span>
              <span className="od-qa-sub">{action.sub}</span>
            </span>
            <span className="od-qa-arrow">&gt;</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function KitchenStatus({ data }: { data: DashboardData }) {
  const preparing = data.activeOrders.filter((order) => order.status === "preparing").length;
  const ready = data.activeOrders.filter((order) => order.status === "ready").length;
  return (
    <div className="od-kitchen-card">
      <div className="od-kitchen-title">Kitchen Status</div>
      <div className="od-kitchen-staff">
        {data.kitchenStaff.slice(0, 5).map((member) => (
          <div key={member.id} className="od-staff-chip" title={member.display_name}>
            {member.display_name.charAt(0).toUpperCase()}
          </div>
        ))}
        {data.kitchenStaff.length === 0 && <div className="od-kitchen-muted">No active kitchen staff</div>}
      </div>
      <div className="od-kitchen-metrics">
        <div>
          <div className="od-kitchen-stat-label">Preparing</div>
          <div className="od-kitchen-stat-value">{preparing}</div>
        </div>
        <div>
          <div className="od-kitchen-stat-label">Ready</div>
          <div className="od-kitchen-stat-value">{ready}</div>
        </div>
      </div>
    </div>
  );
}

function RecentOrdersTable({ orders, title, emptyLabel }: { orders: OdOrder[]; title: string; emptyLabel: string }) {
  const highValue = [...orders].sort((a, b) => b.total_price - a.total_price);
  return (
    <div className="od-card">
      <div className="od-card-header">
        <div className="od-card-title">{title}</div>
        <button className="od-btn-ghost" style={{ fontSize: 12 }}>
          View All Orders
        </button>
      </div>
      <div className="od-table-wrap">
        <table className="od-table">
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Table</th>
              <th>Customer</th>
              <th>Items</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {highValue.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="od-empty">
                    <div className="od-empty-icon">--</div>
                    <div className="od-empty-msg">{emptyLabel}</div>
                  </div>
                </td>
              </tr>
            ) : (
              highValue.map((order) => (
                <tr key={order.id}>
                  <td>
                    <span className="od-order-id">{fmtOrderId(order.id)}</span>
                  </td>
                  <td>{order.table_number ? `Table ${order.table_number}` : "No table"}</td>
                  <td>{order.customer_name || "Guest"}</td>
                  <td>{order.item_count || "-"}</td>
                  <td>
                    <span className="od-amount">{fmtMoney(order.total_price)}</span>
                  </td>
                  <td>
                    <span className={`od-status-badge ${statusClass(order.status)}`}>{statusLabel(order.status)}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrdersPage({ orders, activeOrders, loading, restaurantName }: { orders: OdOrder[]; activeOrders: OdOrder[]; loading: boolean; restaurantName: string }) {
  const [tab, setTab] = useState<string>("active");
  const tabs = [
    ["active", "Active"],
    ["pending_payment", "Pending Payment"],
    ["paid", "Paid"],
    ["preparing", "Preparing"],
    ["ready", "Ready"],
    ["completed", "Completed"],
    ["cancelled", "Cancelled"],
  ];
  const filtered =
    tab === "active" ? activeOrders : orders.filter((order) => order.status === tab);

  return (
    <div className="od-page">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">Live Order Center</h1>
          <p className="od-page-subtitle">Real-time operational command center for {restaurantName}</p>
        </div>
        <div className="od-active-pill-large">
          <strong>{activeOrders.length}</strong>
          <span>Active Orders</span>
        </div>
      </div>

      <div className="od-kanban">
        {(["pending_payment", "paid", "preparing", "ready"] as OwnerOrderStatus[]).map((status) => (
          <div key={status} className={`od-order-lane ${statusClass(status)}`}>
            <div className="od-lane-header">
              <span>{statusLabel(status)}</span>
              <strong>{orders.filter((order) => order.status === status).length}</strong>
            </div>
            {orders
              .filter((order) => order.status === status)
              .slice(0, 3)
              .map((order) => (
                <div key={order.id} className="od-order-card">
                  <div className="od-order-card-top">
                    <strong>{fmtOrderId(order.id)}</strong>
                    <span>{fmtTimeAgo(order.created_at)}</span>
                  </div>
                  <div className="od-order-table">{order.table_number ? `Table ${order.table_number}` : "No table"}</div>
                  <div className="od-order-customer">{order.customer_name || "Guest"}</div>
                  <div className="od-order-card-bottom">
                    <strong>{fmtMoney(order.total_price)}</strong>
                    <span>{order.item_count || 0} items</span>
                  </div>
                </div>
              ))}
            {orders.filter((order) => order.status === status).length === 0 && <div className="od-lane-empty">No orders</div>}
          </div>
        ))}
      </div>

      <div className="od-tabs">
        {tabs.map(([value, label]) => (
          <button key={value} className={`od-tab${tab === value ? " active" : ""}`} onClick={() => setTab(value)}>
            {label} ({value === "active" ? activeOrders.length : orders.filter((order) => order.status === value).length})
          </button>
        ))}
      </div>

      <div className="od-card">
        <div className="od-table-wrap">
          <table className="od-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Table</th>
                <th>Customer</th>
                <th>Payment</th>
                <th>Total</th>
                <th>Time</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7}>
                    <div className="od-empty">Loading orders...</div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="od-empty">
                      <div className="od-empty-icon">--</div>
                      <div className="od-empty-msg">No orders in this view</div>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <span className="od-order-id">{fmtOrderId(order.id)}</span>
                    </td>
                    <td>{order.table_number ? `Table ${order.table_number}` : "No table"}</td>
                    <td>{order.customer_name || "Guest"}</td>
                    <td>{order.payment_method || "-"}</td>
                    <td>
                      <span className="od-amount">{fmtMoney(order.total_price)}</span>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--od-muted)" }}>{fmtDateTime(order.created_at)}</td>
                    <td>
                      <span className={`od-status-badge ${statusClass(order.status)}`}>{statusLabel(order.status)}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AnalyticsPage({ data }: { data: DashboardData }) {
  return (
    <div className="od-page">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">Performance Overview</h1>
          <p className="od-page-subtitle">Real-time financial tracking for your restaurant branch.</p>
        </div>
        <div className="od-tabs">
          <button className="od-tab active">Today</button>
          <button className="od-tab">Week</button>
          <button className="od-tab">Month</button>
        </div>
      </div>

      <div className="od-kpi-grid analytics">
        <div className="od-kpi-card">
          <div className="od-kpi-top">
            <div className="od-kpi-label">Net Revenue</div>
            <span className="od-kpi-badge up">Live</span>
          </div>
          <div className="od-kpi-value">{fmtMoneyK(data.todayRevenue)}</div>
        </div>
        <div className="od-kpi-card">
          <div className="od-kpi-top">
            <div className="od-kpi-label">Avg Ticket</div>
            <span className="od-kpi-badge neutral">{data.revenueOrders.length} paid</span>
          </div>
          <div className="od-kpi-value">{fmtMoney(data.avgOrderValue)}</div>
        </div>
        <div className="od-kpi-card">
          <div className="od-kpi-top">
            <div className="od-kpi-label">All-Time Visible Revenue</div>
            <span className="od-kpi-badge up">Saved</span>
          </div>
          <div className="od-kpi-value">{fmtMoneyK(data.allRevenue)}</div>
        </div>
      </div>

      <div className="od-two-col">
        <div className="od-card">
          <div className="od-card-header">
            <div>
              <div className="od-card-title">Revenue vs Orders</div>
              <div className="od-card-subtitle">Comparative performance across the current day.</div>
            </div>
            <div className="od-chart-legend">
              <span><i className="od-dot revenue" />Revenue</span>
              <span><i className="od-dot orders" />Orders</span>
            </div>
          </div>
          <RevenueBars data={data} />
        </div>

        <div className="od-card">
          <div className="od-card-header">
            <div>
              <div className="od-card-title">Payment Methods</div>
              <div className="od-card-subtitle">Distribution of transaction value.</div>
            </div>
          </div>
          <div className="od-donut-wrap">
            <svg width="140" height="140" viewBox="0 0 140 140">
              {data.donutSlices.map((slice, index) => (
                <circle
                  key={index}
                  cx={data.cx}
                  cy={data.cy}
                  r={data.r}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth="20"
                  strokeDasharray={`${slice.dash} ${slice.gap}`}
                  strokeDashoffset={-slice.offset}
                  transform={`rotate(-90 ${data.cx} ${data.cy})`}
                />
              ))}
              <text x={data.cx} y={data.cy - 5} textAnchor="middle" fontSize="14" fill="var(--od-text)" fontWeight="800">
                {fmtMoneyK(data.todayRevenue)}
              </text>
              <text x={data.cx} y={data.cy + 12} textAnchor="middle" fontSize="10" fill="var(--od-muted)" fontWeight="600">
                Total
              </text>
            </svg>
            <div className="od-legend">
              {data.donutData.map((item) => (
                <div key={item.label} className="od-legend-row">
                  <div className="od-legend-dot-label">
                    <div className="od-legend-dot" style={{ background: item.color }} />
                    <span>{item.label}</span>
                  </div>
                  <span style={{ fontWeight: 700 }}>{item.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <TopItemsTable topItems={data.topItems} menuItems={data.menuItems} />
    </div>
  );
}

function TopItemsTable({ topItems, menuItems }: { topItems: { name: string; quantity: number; revenue: number }[]; menuItems: OdMenuItem[] }) {
  const rows =
    topItems.length > 0
      ? topItems
      : menuItems.slice(0, 6).map((item) => ({ name: item.name, quantity: 0, revenue: 0 }));

  return (
    <div className="od-card">
      <div className="od-card-header">
        <div>
          <div className="od-card-title">Top Selling Items</div>
          <div className="od-card-subtitle">Menu popularity based on persisted order items.</div>
        </div>
        <button className="od-btn-ghost" style={{ fontSize: 12 }}>
          View Detailed Report
        </button>
      </div>
      <div className="od-table-wrap">
        <table className="od-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Item Name</th>
              <th>Orders</th>
              <th>Status</th>
              <th>Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <div className="od-empty">
                    <div className="od-empty-icon">--</div>
                    <div className="od-empty-msg">No menu items yet</div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((item, index) => (
                <tr key={`${item.name}-${index}`}>
                  <td>
                    <span className="od-rank">#{index + 1}</span>
                  </td>
                  <td>
                    <strong>{item.name}</strong>
                  </td>
                  <td>{item.quantity}</td>
                  <td>
                    <span className={`od-item-badge ${index === 0 ? "bestseller" : index === 1 ? "trending" : "stable"}`}>
                      {index === 0 ? "Best Seller" : index === 1 ? "Trending" : "Stable"}
                    </span>
                  </td>
                  <td>
                    <span className="od-amount">{fmtMoney(item.revenue)}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fmtLastActive(iso: string | null) {
  if (!iso) return "Never";

  const now = new Date();
  const date = new Date(iso);
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60000));
  if (minutes < 2) return "Online Now";
  if (minutes < 60) return `${minutes} minutes ago`;

  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);

  if (date >= startToday) return "Today";
  if (date >= startYesterday) return "Yesterday";

  const days = Math.max(1, Math.floor((startToday.getTime() - date.getTime()) / 86400000));
  return `${days} days ago`;
}

function staffActionLabel(action: StaffActivityLog["action"]) {
  const labels: Record<StaffActivityLog["action"], string> = {
    staff_created: "Staff Created",
    staff_deactivated: "Staff Deactivated",
    staff_reactivated: "Staff Reactivated",
    password_reset_sent: "Password Reset Sent",
    temporary_password_generated: "Temporary Password Generated",
    role_changed: "Role Changed",
    staff_updated: "Staff Updated",
  };
  return labels[action] ?? action;
}

type StaffPageProps = {
  staff: OdStaff[];
  restaurantId: string;
  restaurantName: string;
  onStaffChanged: () => Promise<void>;
};

type StaffModalState =
  | { mode: "create"; member?: undefined }
  | { mode: "view" | "edit"; member: OdStaff }
  | null;

function StaffPage({ staff, restaurantId, restaurantName, onStaffChanged }: StaffPageProps) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "owner" | "cashier" | "kitchen">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [modal, setModal] = useState<StaffModalState>(null);
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formRole, setFormRole] = useState<"cashier" | "kitchen">("cashier");
  const [activity, setActivity] = useState<StaffActivityLog[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function loadActivity() {
      try {
        const rows = await loadStaffActivityLog(restaurantId);
        if (mounted) setActivity(rows);
      } catch (activityError) {
        if (mounted) setStaffError(activityError instanceof Error ? activityError.message : "Could not load activity log.");
      }
    }
    void loadActivity();
    return () => {
      mounted = false;
    };
  }, [restaurantId, staff]);

  function openCreateModal() {
    setStaffError(null);
    setNotice(null);
    setFormName("");
    setFormEmail("");
    setFormRole("cashier");
    setModal({ mode: "create" });
  }

  function openMemberModal(mode: "view" | "edit", member: OdStaff) {
    setStaffError(null);
    setNotice(null);
    setFormName(member.display_name);
    setFormEmail(member.email ?? "");
    setFormRole(member.role === "kitchen" ? "kitchen" : "cashier");
    setModal({ mode, member });
  }

  async function runStaffAction(action: () => Promise<{ temporaryPassword?: string } | void>, success: string) {
    try {
      setIsWorking(true);
      setStaffError(null);
      setNotice(null);
      const result = await action();
      await onStaffChanged();
      const rows = await loadStaffActivityLog(restaurantId);
      setActivity(rows);
      setNotice(result?.temporaryPassword ? `${success} Temporary password: ${result.temporaryPassword}` : success);
    } catch (actionError) {
      setStaffError(actionError instanceof Error ? actionError.message : "Staff action failed.");
    } finally {
      setIsWorking(false);
    }
  }

  async function handleSubmitStaff(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!modal || modal.mode === "view") return;

    await runStaffAction(async () => {
      if (modal.mode === "create") {
        const result = await createStaff({
          restaurantId,
          fullName: formName,
          email: formEmail,
          role: formRole,
        });
        setModal(null);
        return result;
      }

      await updateStaff({
        restaurantId,
        staffId: modal.member.id,
        fullName: formName,
        role: formRole,
      });
      setModal(null);
      return {};
    }, modal.mode === "create" ? "Staff account created." : "Staff profile updated.");
  }

  const filtered = staff.filter((member) => {
    const matchesRole = roleFilter === "all" || member.role === roleFilter;
    const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? member.active : !member.active);
    const haystack = `${member.display_name} ${member.email ?? ""} ${member.role}`.toLowerCase();
    return matchesRole && matchesStatus && haystack.includes(search.trim().toLowerCase());
  });

  const totalStaff = staff.length;
  const activeStaff = staff.filter((member) => member.active).length;
  const cashierCount = staff.filter((member) => member.role === "cashier").length;
  const kitchenCount = staff.filter((member) => member.role === "kitchen").length;

  return (
    <div className="od-page">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">Staff Management</h1>
          <p className="od-page-subtitle">Create, secure, and audit staff access for {restaurantName}.</p>
        </div>
        <button className="od-btn-primary" onClick={openCreateModal}>Add Staff</button>
      </div>

      {(staffError || notice) && (
        <div className={staffError ? "od-error-inline" : "od-success-inline"}>
          {staffError || notice}
        </div>
      )}

      <div className="od-kpi-grid analytics">
        {[
          ["Total Staff", totalStaff, "All roles"],
          ["Active Staff", activeStaff, `${totalStaff - activeStaff} inactive`],
          ["Cashiers", cashierCount, "POS access"],
          ["Kitchen Staff", kitchenCount, "KDS access"],
        ].map(([label, value, sub]) => (
          <div key={label} className="od-kpi-card">
            <div className="od-kpi-label">{label}</div>
            <div className="od-kpi-value">{value}</div>
            <div className="od-card-subtitle">{sub}</div>
          </div>
        ))}
      </div>

      <div className="od-staff-layout">
        <div className="od-card">
          <div className="od-card-header">
            <div>
              <div className="od-card-title">Staff Directory</div>
              <div className="od-card-subtitle">Restaurant-scoped access records from restaurant_staff.</div>
            </div>
            <div className="od-staff-filters">
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search staff" aria-label="Search staff" />
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)} aria-label="Filter by role">
                <option value="all">All roles</option>
                <option value="owner">Owner</option>
                <option value="cashier">Cashier</option>
                <option value="kitchen">Kitchen</option>
              </select>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} aria-label="Filter by status">
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div className="od-table-wrap">
            <table className="od-table od-staff-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Created Date</th>
                  <th>Last Login</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="od-empty">
                        <div className="od-empty-icon">--</div>
                        <div className="od-empty-msg">No staff match these filters</div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((member) => (
                    <tr key={member.id}>
                      <td>
                        <div className="od-staff-cell">
                          <div className="od-staff-avatar-small">{member.display_name.charAt(0).toUpperCase()}</div>
                          <div>
                            <div className="od-staff-name">{member.display_name}</div>
                            <div className="od-staff-email">{member.id.slice(0, 8)}</div>
                          </div>
                        </div>
                      </td>
                      <td>{member.email || "Not stored"}</td>
                      <td style={{ textTransform: "capitalize" }}>{member.role}</td>
                      <td>
                        {member.active ? (
                          <span className="od-active-pill">
                            <span className="od-active-dot" />
                            Active
                          </span>
                        ) : (
                          <span className="od-offline-pill">Offline</span>
                        )}
                      </td>
                      <td style={{ fontSize: 12, color: "var(--od-muted)" }}>{new Date(member.created_at).toLocaleDateString()}</td>
                      <td>{fmtLastActive(member.last_login_at)}</td>
                      <td>
                        <div className="od-row-actions">
                          <button className="od-btn-ghost compact" onClick={() => openMemberModal("view", member)}>View</button>
                          <button className="od-btn-ghost compact" onClick={() => openMemberModal("edit", member)} disabled={member.role === "owner"}>Edit</button>
                          {member.active ? (
                            <button
                              className="od-btn-ghost compact danger"
                              onClick={() => runStaffAction(() => deactivateStaff(restaurantId, member.id), "Staff deactivated.")}
                              disabled={member.role === "owner" || isWorking}
                            >
                              Deactivate
                            </button>
                          ) : (
                            <button
                              className="od-btn-ghost compact"
                              onClick={() => runStaffAction(() => reactivateStaff(restaurantId, member.id), "Staff reactivated.")}
                              disabled={isWorking}
                            >
                              Reactivate
                            </button>
                          )}
                          <button
                            className="od-btn-ghost compact"
                            onClick={() => runStaffAction(() => sendStaffPasswordReset(restaurantId, member.id), "Password reset link sent.")}
                            disabled={isWorking || !member.email}
                          >
                            Reset Password
                          </button>
                          <button
                            className="od-btn-ghost compact"
                            onClick={() => runStaffAction(() => generateStaffTemporaryPassword(restaurantId, member.id), "Temporary password generated.")}
                            disabled={isWorking}
                          >
                            Temp Password
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="od-table-footer">Showing {filtered.length} of {staff.length} members</div>
        </div>

        <div className="od-side-stack">
          <div className="od-performance-card dark">
            <div className="od-performance-label">Access Boundary</div>
            <div className="od-performance-person">{activeStaff}/{totalStaff}</div>
            <div className="od-performance-sub">active staff records for this restaurant</div>
          </div>
          <div className="od-performance-card">
            <div className="od-performance-label">Recent Activity</div>
            <div className="od-audit-list">
              {activity.length === 0 ? (
                <div className="od-empty-sub">No staff activity yet</div>
              ) : (
                activity.slice(0, 8).map((entry) => (
                  <div key={entry.id} className="od-audit-row">
                    <div className="od-audit-action">{staffActionLabel(entry.action)}</div>
                    <div className="od-audit-meta">
                      {entry.target_staff_email || "Staff record"} - {fmtTimeAgo(entry.created_at)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {modal && (
        <div className="od-modal-backdrop" role="presentation">
          <div className="od-modal" role="dialog" aria-modal="true" aria-label="Staff details">
            <div className="od-modal-header">
              <div>
                <div className="od-card-title">
                  {modal.mode === "create" ? "Add Staff" : modal.mode === "edit" ? "Edit Staff" : "Staff Profile"}
                </div>
                <div className="od-card-subtitle">Cashier and kitchen accounts are created through Supabase Auth.</div>
              </div>
              <button className="od-icon-btn" onClick={() => setModal(null)} aria-label="Close">x</button>
            </div>

            <form className="od-staff-form" onSubmit={handleSubmitStaff}>
              <label>
                Full Name
                <input value={formName} onChange={(event) => setFormName(event.target.value)} disabled={modal.mode === "view" || isWorking} required />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={formEmail}
                  onChange={(event) => setFormEmail(event.target.value)}
                  disabled={modal.mode !== "create" || isWorking}
                  required
                />
              </label>
              <label>
                Role
                <select value={formRole} onChange={(event) => setFormRole(event.target.value as "cashier" | "kitchen")} disabled={modal.mode === "view" || isWorking}>
                  <option value="cashier">Cashier</option>
                  <option value="kitchen">Kitchen</option>
                </select>
              </label>

              {modal.mode !== "create" && (
                <div className="od-staff-detail-grid">
                  <span>Status</span>
                  <strong>{modal.member.active ? "Active" : "Inactive"}</strong>
                  <span>Created</span>
                  <strong>{new Date(modal.member.created_at).toLocaleDateString()}</strong>
                  <span>Last Active</span>
                  <strong>{fmtLastActive(modal.member.last_login_at)}</strong>
                </div>
              )}

              <div className="od-modal-actions">
                <button type="button" className="od-btn-ghost" onClick={() => setModal(null)}>Cancel</button>
                {modal.mode !== "view" && (
                  <button type="submit" className="od-btn-primary" disabled={isWorking}>
                    {isWorking ? "Saving..." : modal.mode === "create" ? "Create Staff" : "Save Changes"}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

type MenuModalState =
  | { mode: "create"; item?: undefined }
  | { mode: "edit"; item: OdMenuItem }
  | null;

type MenuPageProps = {
  restaurantId: string;
  items: OdMenuItem[];
  categories: OdCategory[];
  topItems: { name: string; quantity: number; revenue: number }[];
  onMenuChanged: () => Promise<void>;
};

function getCategoryName(categories: OdCategory[], categoryId: string) {
  return categories.find((category) => category.id === categoryId)?.name ?? "Uncategorized";
}

function buildMenuPhotoPath(restaurantId: string, file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const token = crypto.randomUUID();
  return `${restaurantId}/${token}.${extension}`;
}

function MenuPage({ restaurantId, items, categories, topItems, onMenuChanged }: MenuPageProps) {
  const [modal, setModal] = useState<MenuModalState>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formCategoryId, setFormCategoryId] = useState("");
  const [formNewCategory, setFormNewCategory] = useState("");
  const [formAvailable, setFormAvailable] = useState(true);
  const [formImageFile, setFormImageFile] = useState<File | null>(null);
  const [formImageUrl, setFormImageUrl] = useState("");
  const [menuError, setMenuError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  function openCreateModal() {
    setMenuError(null);
    setNotice(null);
    setFormName("");
    setFormDescription("");
    setFormPrice("");
    setFormCategoryId(categories[0]?.id ?? "");
    setFormNewCategory(categories.length === 0 ? "Main Menu" : "");
    setFormAvailable(true);
    setFormImageFile(null);
    setFormImageUrl("");
    setModal({ mode: "create" });
  }

  function openEditModal(item: OdMenuItem) {
    setMenuError(null);
    setNotice(null);
    setFormName(item.name);
    setFormDescription(item.description ?? "");
    setFormPrice(String(item.price));
    setFormCategoryId(item.category_id);
    setFormNewCategory("");
    setFormAvailable(item.available);
    setFormImageFile(null);
    setFormImageUrl(item.image_url ?? "");
    setModal({ mode: "edit", item });
  }

  async function ensureCategory() {
    const newCategory = formNewCategory.trim();
    if (!newCategory) {
      if (!formCategoryId) {
        throw new Error("Choose a category or create a new one.");
      }
      return formCategoryId;
    }

    const existing = categories.find((category) => category.name.toLowerCase() === newCategory.toLowerCase());
    if (existing) return existing.id;

    const { data, error } = await supabase
      .from("categories")
      .insert({ restaurant_id: restaurantId, name: newCategory })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(error?.message || "Could not create category.");
    }

    return String(data.id);
  }

  async function uploadImageIfNeeded() {
    if (!formImageFile) return formImageUrl.trim() || null;

    if (!formImageFile.type.startsWith("image/")) {
      throw new Error("Menu photo must be an image file.");
    }

    const path = buildMenuPhotoPath(restaurantId, formImageFile);
    const { error } = await supabase.storage.from("menu-photos").upload(path, formImageFile, {
      cacheControl: "3600",
      upsert: false,
      contentType: formImageFile.type,
    });

    if (error) {
      throw new Error(error.message);
    }

    const { data } = supabase.storage.from("menu-photos").getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleSubmitMenuItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal) return;

    try {
      setIsWorking(true);
      setMenuError(null);
      setNotice(null);

      const name = formName.trim();
      const price = Number(formPrice);
      if (name.length < 2) throw new Error("Item name must be at least 2 characters.");
      if (!Number.isFinite(price) || price <= 0) throw new Error("Price must be greater than zero.");

      const categoryId = await ensureCategory();
      const imageUrl = await uploadImageIfNeeded();
      const payload = {
        restaurant_id: restaurantId,
        name,
        description: formDescription.trim() || null,
        price,
        category_id: categoryId,
        available: formAvailable,
        image_url: imageUrl,
      };

      if (modal.mode === "create") {
        const { error } = await supabase.from("menu_items").insert(payload);
        if (error) throw new Error(error.message);
        setNotice("Menu item created.");
      } else {
        const { error } = await supabase
          .from("menu_items")
          .update(payload)
          .eq("id", modal.item.id)
          .eq("restaurant_id", restaurantId);
        if (error) throw new Error(error.message);
        setNotice("Menu item updated.");
      }

      setModal(null);
      await onMenuChanged();
    } catch (actionError) {
      setMenuError(actionError instanceof Error ? actionError.message : "Menu action failed.");
    } finally {
      setIsWorking(false);
    }
  }

  async function handleDeleteMenuItem(item: OdMenuItem) {
    if (!window.confirm(`Delete ${item.name}? This cannot be undone.`)) return;

    try {
      setIsWorking(true);
      setMenuError(null);
      setNotice(null);
      const { error } = await supabase.from("menu_items").delete().eq("id", item.id).eq("restaurant_id", restaurantId);
      if (error) throw new Error(error.message);
      setNotice("Menu item deleted.");
      await onMenuChanged();
    } catch (actionError) {
      setMenuError(actionError instanceof Error ? actionError.message : "Could not delete menu item.");
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <div className="od-page">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">Menu Management</h1>
          <p className="od-page-subtitle">Manage your restaurant menu, categories, and pricing.</p>
        </div>
        <div className="od-header-actions">
          <button className="od-btn-primary" onClick={openCreateModal}>Add Item</button>
        </div>
      </div>

      {(menuError || notice) && (
        <div className={menuError ? "od-error-inline" : "od-success-inline"}>
          {menuError || notice}
        </div>
      )}

      <TopItemsTable topItems={topItems} menuItems={items} />

      <div className="od-card">
        <div className="od-card-header">
          <div className="od-card-title">Menu Inventory</div>
        </div>
        <div className="od-table-wrap">
          <table className="od-table">
            <thead>
              <tr>
                <th>Item Name</th>
                <th>Category</th>
                <th>Price</th>
                <th>Availability</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="od-empty">
                      <div className="od-empty-icon">--</div>
                      <div className="od-empty-msg">No menu items yet</div>
                      <div className="od-empty-sub">Add your first item or upload a menu photo</div>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="od-menu-item-cell">
                        {item.image_url ? <img src={item.image_url} alt="" className="od-menu-thumb" /> : <div className="od-menu-thumb empty">MN</div>}
                        <div>
                          <strong>{item.name}</strong>
                          {item.description && <div className="od-menu-desc">{item.description}</div>}
                        </div>
                      </div>
                    </td>
                    <td>{getCategoryName(categories, item.category_id)}</td>
                    <td>{fmtMoney(item.price)}</td>
                    <td>
                      <span className={`od-status-badge ${item.available ? "paid" : "pending"}`}>{item.available ? "Available" : "Unavailable"}</span>
                    </td>
                    <td>
                      <div className="od-row-actions">
                        <button className="od-btn-ghost" onClick={() => openEditModal(item)} disabled={isWorking}>Edit</button>
                        <button className="od-btn-ghost danger" onClick={() => handleDeleteMenuItem(item)} disabled={isWorking}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="od-modal-backdrop" role="presentation">
          <div className="od-modal" role="dialog" aria-modal="true" aria-label="Menu item details">
            <div className="od-modal-header">
              <div>
                <div className="od-card-title">{modal.mode === "create" ? "Add Menu Item" : "Edit Menu Item"}</div>
                <div className="od-card-subtitle">Menu items are visible on the QR menu when available.</div>
              </div>
              <button className="od-icon-btn" onClick={() => setModal(null)} aria-label="Close">x</button>
            </div>

            <form className="od-staff-form" onSubmit={handleSubmitMenuItem}>
              <label>
                Item Name
                <input value={formName} onChange={(event) => setFormName(event.target.value)} disabled={isWorking} required />
              </label>
              <label>
                Description
                <textarea value={formDescription} onChange={(event) => setFormDescription(event.target.value)} disabled={isWorking} rows={3} />
              </label>
              <label>
                Price
                <input type="number" min="0" step="0.01" value={formPrice} onChange={(event) => setFormPrice(event.target.value)} disabled={isWorking} required />
              </label>
              <label>
                Category
                <select value={formCategoryId} onChange={(event) => setFormCategoryId(event.target.value)} disabled={isWorking || categories.length === 0}>
                  {categories.length === 0 ? <option value="">No categories yet</option> : categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </label>
              <label>
                New Category
                <input value={formNewCategory} onChange={(event) => setFormNewCategory(event.target.value)} disabled={isWorking} placeholder="Optional" />
              </label>
              <label className="od-check-row">
                <input type="checkbox" checked={formAvailable} onChange={(event) => setFormAvailable(event.target.checked)} disabled={isWorking} />
                Available
              </label>
              <label>
                Menu Photo
                <input type="file" accept="image/*" onChange={(event) => setFormImageFile(event.target.files?.[0] ?? null)} disabled={isWorking} />
              </label>
              {formImageUrl && !formImageFile && <img className="od-menu-preview" src={formImageUrl} alt="" />}

              <div className="od-modal-actions">
                <button type="button" className="od-btn-ghost" onClick={() => setModal(null)}>Cancel</button>
                <button type="submit" className="od-btn-primary" disabled={isWorking}>
                  {isWorking ? "Saving..." : modal.mode === "create" ? "Create Item" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function QrTablesPage({ restaurantName, orders }: { restaurantName: string; orders: OdOrder[] }) {
  const activeTables = new Set(orders.map((order) => order.table_number).filter(Boolean));
  const tables = Array.from({ length: 20 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    const activeOrder = orders.find((order) => order.table_number === number || order.table_number === String(index + 1));
    return {
      number,
      status: activeOrder?.status ?? "available",
    };
  });

  return (
    <div className="od-page">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">QR & Table Management</h1>
          <p className="od-page-subtitle">Restaurant floor management for {restaurantName}</p>
        </div>
        <button className="od-btn-primary">Bulk QR Export</button>
      </div>
      <div className="od-kpi-grid analytics">
        <div className="od-kpi-card">
          <div className="od-kpi-label">Active Tables</div>
          <div className="od-kpi-value">{activeTables.size}</div>
        </div>
        <div className="od-kpi-card">
          <div className="od-kpi-label">Total Tables</div>
          <div className="od-kpi-value">20</div>
        </div>
        <div className="od-kpi-card">
          <div className="od-kpi-label">QR Coverage</div>
          <div className="od-kpi-value">100%</div>
        </div>
      </div>
      <div className="od-card">
        <div className="od-card-header">
          <div className="od-card-title">Restaurant Floor</div>
        </div>
        <div className="od-table-grid">
          {tables.map((table) => (
            <div key={table.number} className={`od-table-tile ${statusClass(table.status)}`}>
              <div className="od-table-num">Table {table.number}</div>
              <div className="od-table-state">{statusLabel(table.status)}</div>
              <button className="od-btn-ghost">QR Code</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ComingSoonPage({ nav }: { nav: string }) {
  const labels: Record<string, string> = {
    customers: "Customer Insights",
    reports: "Reports & Exports",
    settings: "Restaurant Settings",
  };

  return (
    <div className="od-page">
      <div className="od-coming-soon">
        <div className="od-empty-icon">--</div>
        <h2>{labels[nav] || nav}</h2>
        <p>This section is ready for the next owner-dashboard phase.</p>
      </div>
    </div>
  );
}

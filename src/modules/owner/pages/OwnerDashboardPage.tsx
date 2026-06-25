import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
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

type OdMenuUpload = {
  id: string;
  file_name: string;
  file_path: string;
  file_url: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

type OdOrderItem = {
  id: string;
  order_id: string;
  quantity: number;
  price: number;
  menu_item_id: string | null;
  name: string;
};

type JsonRecord = Record<string, unknown>;

type RestaurantConfig = {
  id: string;
  name: string;
  slug: string;
  total_tables: number;
  profile: JsonRecord;
  business_hours: JsonRecord;
  ordering_settings: JsonRecord;
  branding: JsonRecord;
  notification_settings: JsonRecord;
  security_settings: JsonRecord;
  subscription_plan: string;
  billing_status: string;
};

type RestaurantTable = {
  id: string;
  restaurant_id: string;
  table_number: number;
  label: string;
  qr_path: string;
  active: boolean;
};

type OwnerActiveShift = {
  id: string;
  restaurant_id: string;
  opened_by: string;
  opened_at: string;
  opening_cash: number;
};

type OwnerShiftHistory = {
  id: string;
  cashier_name: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  expected_cash: number | null;
  actual_cash: number | null;
  variance: number | null;
  variance_reason: string | null;
};

type OwnerCashVariance = {
  id: string;
  shift_id: string;
  cashier_name: string;
  closed_at: string;
  expected_cash: number;
  actual_cash: number;
  variance: number;
  variance_reason: string | null;
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

function toJsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function jsonString(value: JsonRecord, key: string, fallback = "") {
  const raw = value[key];
  return typeof raw === "string" ? raw : fallback;
}

function jsonBool(value: JsonRecord, key: string, fallback = false) {
  const raw = value[key];
  return typeof raw === "boolean" ? raw : fallback;
}

function buildRestaurantConfig(row: Record<string, unknown>, fallbackName: string): RestaurantConfig {
  return {
    id: String(row.id),
    name: typeof row.name === "string" ? row.name : fallbackName,
    slug: typeof row.slug === "string" ? row.slug : "",
    total_tables: Number(row.total_tables ?? row.table_count ?? 20),
    profile: toJsonRecord(row.profile),
    business_hours: toJsonRecord(row.business_hours),
    ordering_settings: toJsonRecord(row.ordering_settings),
    branding: toJsonRecord(row.branding),
    notification_settings: toJsonRecord(row.notification_settings),
    security_settings: toJsonRecord(row.security_settings),
    subscription_plan: typeof row.subscription_plan === "string" ? row.subscription_plan : "starter",
    billing_status: typeof row.billing_status === "string" ? row.billing_status : "trial",
  };
}

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function downloadText(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportRowsAsCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  downloadText(
    filename,
    [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n"),
    "text/csv;charset=utf-8"
  );
}

function exportRowsAsExcel(filename: string, title: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const tableRows = [headers, ...rows]
    .map((row, index) => `<tr>${row.map((cell) => `<${index === 0 ? "th" : "td"}>${String(cell ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</${index === 0 ? "th" : "td"}>`).join("")}</tr>`)
    .join("");
  downloadText(
    filename,
    `<html><head><meta charset="utf-8" /></head><body><h1>${title}</h1><table>${tableRows}</table></body></html>`,
    "application/vnd.ms-excel;charset=utf-8"
  );
}

export function OwnerDashboardPage({ restaurantId, restaurantName, ownerName }: OwnerDashboardPageProps) {
  const now = useNow();
  const [nav, setNav] = useState<NavId>("overview");
  const [orders, setOrders] = useState<OdOrder[]>([]);
  const [staff, setStaff] = useState<OdStaff[]>([]);
  const [menuItems, setMenuItems] = useState<OdMenuItem[]>([]);
  const [categories, setCategories] = useState<OdCategory[]>([]);
  const [orderItems, setOrderItems] = useState<OdOrderItem[]>([]);
  const [activeShifts, setActiveShifts] = useState<OwnerActiveShift[]>([]);
  const [restaurantConfig, setRestaurantConfig] = useState<RestaurantConfig | null>(null);
  const [restaurantTables, setRestaurantTables] = useState<RestaurantTable[]>([]);
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
          { data: restaurantData, error: restaurantError },
          { data: tableData, error: tableError },
          { data: shiftData, error: shiftError },
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
            supabase
              .from("restaurants")
              .select("id,name,slug,total_tables,table_count,profile,business_hours,ordering_settings,branding,notification_settings,security_settings,subscription_plan,billing_status")
              .eq("id", restaurantId)
              .maybeSingle(),
            supabase
              .from("restaurant_tables")
              .select("id,restaurant_id,table_number,label,qr_path,active")
              .eq("restaurant_id", restaurantId)
              .eq("active", true)
              .order("table_number", { ascending: true }),
            supabase
              .from("cashier_shifts")
              .select("id,restaurant_id,opened_by,opened_at,opening_cash")
              .eq("restaurant_id", restaurantId)
              .is("closed_at", null)
              .order("opened_at", { ascending: false }),
          ]);

        if (orderError) throw new Error(orderError.message);
        if (staffError) throw new Error(staffError.message);
        if (menuError) throw new Error(menuError.message);
        if (categoryError) throw new Error(categoryError.message);
        if (restaurantError) throw new Error(restaurantError.message);
        if (tableError) throw new Error(tableError.message);
        if (shiftError) throw new Error(shiftError.message);
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
        setActiveShifts((shiftData ?? []).map((row) => ({ ...row, opening_cash: Number(row.opening_cash) })) as OwnerActiveShift[]);
        if (restaurantData) setRestaurantConfig(buildRestaurantConfig(restaurantData as Record<string, unknown>, restaurantName));
        setRestaurantTables((tableData ?? []).map((row) => ({ ...row, table_number: Number(row.table_number) })) as RestaurantTable[]);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "cashier_shifts", filter: `restaurant_id=eq.${restaurantId}` }, () => {
        void supabase
          .from("cashier_shifts")
          .select("id,restaurant_id,opened_by,opened_at,opening_cash")
          .eq("restaurant_id", restaurantId)
          .is("closed_at", null)
          .order("opened_at", { ascending: false })
          .then(({ data, error: shiftError }) => {
            if (shiftError) {
              setError(shiftError.message);
              return;
            }
            setActiveShifts((data ?? []).map((row) => ({ ...row, opening_cash: Number(row.opening_cash) })) as OwnerActiveShift[]);
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

  async function refreshRestaurantConfig() {
    const [{ data: restaurantData, error: restaurantError }, { data: tableData, error: tableError }] = await Promise.all([
      supabase
        .from("restaurants")
        .select("id,name,slug,total_tables,table_count,profile,business_hours,ordering_settings,branding,notification_settings,security_settings,subscription_plan,billing_status")
        .eq("id", restaurantId)
        .maybeSingle(),
      supabase
        .from("restaurant_tables")
        .select("id,restaurant_id,table_number,label,qr_path,active")
        .eq("restaurant_id", restaurantId)
        .eq("active", true)
        .order("table_number", { ascending: true }),
    ]);

    if (restaurantError) throw new Error(restaurantError.message);
    if (tableError) throw new Error(tableError.message);
    if (restaurantData) setRestaurantConfig(buildRestaurantConfig(restaurantData as Record<string, unknown>, restaurantName));
    setRestaurantTables((tableData ?? []).map((row) => ({ ...row, table_number: Number(row.table_number) })) as RestaurantTable[]);
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
    activeShifts,
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

        {nav === "overview" && <OverviewPage data={dashboardData} staff={staff} />}
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
        {nav === "qr" && <QrTablesPage restaurantName={restaurantName} restaurantSlug={restaurantConfig?.slug ?? ""} orders={activeOrders} tables={restaurantTables} />}
        {nav === "customers" && <CustomersPage orders={orders} />}
        {nav === "reports" && <ReportsPage restaurantId={restaurantId} restaurantName={restaurantName} />}
        {nav === "settings" && (
          <SettingsPage
            restaurantId={restaurantId}
            fallbackRestaurantName={restaurantName}
            config={restaurantConfig}
            tables={restaurantTables}
            onSettingsChanged={refreshRestaurantConfig}
          />
        )}
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
  activeShifts: OwnerActiveShift[];
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

function OverviewPage({ data, staff }: { data: DashboardData; staff: OdStaff[] }) {
  const staffById = new Map(staff.map((member) => [member.id, member]));
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

      <div className="od-card">
        <div className="od-card-header">
          <div>
            <div className="od-card-title">Active Cashier Shifts</div>
            <div className="od-card-subtitle">Open drawers currently visible to owner access.</div>
          </div>
        </div>
        <div className="od-table-wrap">
          <table className="od-table">
            <thead>
              <tr><th>Cashier</th><th>Opened</th><th>Opening Cash</th><th>Duration</th></tr>
            </thead>
            <tbody>
              {data.activeShifts.length === 0 ? (
                <tr><td colSpan={4}><div className="od-empty compact">No active cashier shifts</div></td></tr>
              ) : data.activeShifts.map((shift) => {
                const cashier = staffById.get(shift.opened_by);
                return (
                  <tr key={shift.id}>
                    <td>{cashier?.display_name ?? "Cashier"}</td>
                    <td>{fmtDateTime(shift.opened_at)}</td>
                    <td>{fmtMoney(shift.opening_cash)}</td>
                    <td>{fmtTimeAgo(shift.opened_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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

function buildMenuFilePath(restaurantId: string, file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || (file.type === "application/pdf" ? "pdf" : "jpg");
  const token = crypto.randomUUID();
  return `${restaurantId}/${token}.${extension}`;
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function MenuPage({ restaurantId, items, categories, topItems, onMenuChanged }: MenuPageProps) {
  const menuUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [modal, setModal] = useState<MenuModalState>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formCategoryId, setFormCategoryId] = useState("");
  const [formNewCategory, setFormNewCategory] = useState("");
  const [formAvailable, setFormAvailable] = useState(true);
  const [formImageFile, setFormImageFile] = useState<File | null>(null);
  const [formImageUrl, setFormImageUrl] = useState("");
  const [menuUploads, setMenuUploads] = useState<OdMenuUpload[]>([]);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadMenuUploads() {
      const { data, error } = await supabase
        .from("menu_uploads")
        .select("id,file_name,file_path,file_url,mime_type,size_bytes,created_at")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false });

      if (!mounted) return;
      if (error) {
        setMenuError(error.message);
        return;
      }

      setMenuUploads((data ?? []).map((row) => ({
        ...row,
        size_bytes: Number(row.size_bytes),
      })) as OdMenuUpload[]);
    }

    void loadMenuUploads();
    return () => {
      mounted = false;
    };
  }, [restaurantId]);

  async function refreshMenuUploads() {
    const { data, error } = await supabase
      .from("menu_uploads")
      .select("id,file_name,file_path,file_url,mime_type,size_bytes,created_at")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    setMenuUploads((data ?? []).map((row) => ({ ...row, size_bytes: Number(row.size_bytes) })) as OdMenuUpload[]);
  }

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

  async function handleUploadMenuFile(file: File | null) {
    if (!file) return;

    try {
      setIsWorking(true);
      setMenuError(null);
      setNotice(null);

      const isAllowedType = file.type.startsWith("image/") || file.type === "application/pdf";
      if (!isAllowedType) throw new Error("Upload a menu image or PDF file.");
      if (file.size > 10 * 1024 * 1024) throw new Error("Menu file must be 10 MB or smaller.");

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        throw new Error(userError?.message || "You must be signed in as the owner to upload a menu.");
      }

      const path = buildMenuFilePath(restaurantId, file);
      const { error: uploadError } = await supabase.storage.from("menu-files").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });

      if (uploadError) throw new Error(uploadError.message);

      const { data: publicUrlData } = supabase.storage.from("menu-files").getPublicUrl(path);
      const { error: insertError } = await supabase.from("menu_uploads").insert({
        restaurant_id: restaurantId,
        uploaded_by: userData.user.id,
        file_name: file.name,
        file_path: path,
        file_url: publicUrlData.publicUrl,
        mime_type: file.type,
        size_bytes: file.size,
      });

      if (insertError) {
        await supabase.storage.from("menu-files").remove([path]);
        throw new Error(insertError.message);
      }

      setNotice("Menu file uploaded.");
      await refreshMenuUploads();
    } catch (actionError) {
      setMenuError(actionError instanceof Error ? actionError.message : "Could not upload menu file.");
    } finally {
      if (menuUploadInputRef.current) menuUploadInputRef.current.value = "";
      setIsWorking(false);
    }
  }

  async function handleDeleteMenuUpload(upload: OdMenuUpload) {
    if (!window.confirm(`Delete ${upload.file_name}? This cannot be undone.`)) return;

    try {
      setIsWorking(true);
      setMenuError(null);
      setNotice(null);

      const { error: deleteError } = await supabase
        .from("menu_uploads")
        .delete()
        .eq("id", upload.id)
        .eq("restaurant_id", restaurantId);
      if (deleteError) throw new Error(deleteError.message);

      const { error: storageError } = await supabase.storage.from("menu-files").remove([upload.file_path]);
      if (storageError) throw new Error(storageError.message);

      setNotice("Menu file deleted.");
      await refreshMenuUploads();
    } catch (actionError) {
      setMenuError(actionError instanceof Error ? actionError.message : "Could not delete menu file.");
    } finally {
      setIsWorking(false);
    }
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
          <input
            ref={menuUploadInputRef}
            className="od-hidden-file-input"
            type="file"
            accept="image/*,application/pdf"
            onChange={(event) => void handleUploadMenuFile(event.target.files?.[0] ?? null)}
            disabled={isWorking}
          />
          <button className="od-btn-ghost" type="button" onClick={() => menuUploadInputRef.current?.click()} disabled={isWorking}>
            Upload Menu
          </button>
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
          <div>
            <div className="od-card-title">Uploaded Menu Files</div>
            <div className="od-card-subtitle">Image and PDF menus saved to owner-managed storage.</div>
          </div>
        </div>
        <div className="od-menu-upload-list">
          {menuUploads.length === 0 ? (
            <div className="od-empty compact">
              <div className="od-empty-msg">No menu files uploaded</div>
              <div className="od-empty-sub">Upload a menu image or PDF from the button above.</div>
            </div>
          ) : (
            menuUploads.map((upload) => (
              <div className="od-menu-upload-row" key={upload.id}>
                <div className="od-menu-upload-icon">{upload.mime_type === "application/pdf" ? "PDF" : "IMG"}</div>
                <div className="od-menu-upload-info">
                  <strong>{upload.file_name}</strong>
                  <span>{formatFileSize(upload.size_bytes)} - {fmtDateTime(upload.created_at)}</span>
                </div>
                <div className="od-row-actions">
                  <a className="od-btn-ghost" href={upload.file_url} target="_blank" rel="noreferrer">View</a>
                  <button className="od-btn-ghost danger" type="button" onClick={() => void handleDeleteMenuUpload(upload)} disabled={isWorking}>Delete</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

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

type ReportRow = Record<string, string | number | null | undefined>;

type OwnerReportData = {
  summary: {
    revenue: number;
    orders: number;
    average_order_value: number;
    completed_orders: number;
    cancelled_orders: number;
    unique_customers: number;
  };
  sales_by_day: { date: string; revenue: number; orders: number }[];
  orders_by_status: { status: string; orders: number }[];
  menu_performance: { name: string; category: string; quantity: number; revenue: number }[];
  staff_performance: { name: string; role: string; orders_completed: number; payments_verified: number }[];
  table_usage: { table_number: number; orders: number; revenue: number }[];
  customers: { customer_name: string; orders: number; revenue: number; last_order_at: string | null }[];
  shift_history: OwnerShiftHistory[];
  cash_variances: OwnerCashVariance[];
  ai_insights: { title: string; detail: string }[];
};

function emptyReportData(): OwnerReportData {
  return {
    summary: { revenue: 0, orders: 0, average_order_value: 0, completed_orders: 0, cancelled_orders: 0, unique_customers: 0 },
    sales_by_day: [],
    orders_by_status: [],
    menu_performance: [],
    staff_performance: [],
    table_usage: [],
    customers: [],
    shift_history: [],
    cash_variances: [],
    ai_insights: [],
  };
}

function normalizeReportData(value: unknown): OwnerReportData {
  const data = value && typeof value === "object" ? (value as Partial<OwnerReportData>) : {};
  const summary = data.summary ?? emptyReportData().summary;
  return {
    summary: {
      revenue: Number(summary.revenue ?? 0),
      orders: Number(summary.orders ?? 0),
      average_order_value: Number(summary.average_order_value ?? 0),
      completed_orders: Number(summary.completed_orders ?? 0),
      cancelled_orders: Number(summary.cancelled_orders ?? 0),
      unique_customers: Number(summary.unique_customers ?? 0),
    },
    sales_by_day: (data.sales_by_day ?? []).map((row) => ({ date: String(row.date), revenue: Number(row.revenue), orders: Number(row.orders) })),
    orders_by_status: (data.orders_by_status ?? []).map((row) => ({ status: String(row.status), orders: Number(row.orders) })),
    menu_performance: (data.menu_performance ?? []).map((row) => ({ name: String(row.name), category: String(row.category), quantity: Number(row.quantity), revenue: Number(row.revenue) })),
    staff_performance: (data.staff_performance ?? []).map((row) => ({ name: String(row.name), role: String(row.role), orders_completed: Number(row.orders_completed), payments_verified: Number(row.payments_verified) })),
    table_usage: (data.table_usage ?? []).map((row) => ({ table_number: Number(row.table_number), orders: Number(row.orders), revenue: Number(row.revenue) })),
    customers: (data.customers ?? []).map((row) => ({ customer_name: String(row.customer_name), orders: Number(row.orders), revenue: Number(row.revenue), last_order_at: row.last_order_at ? String(row.last_order_at) : null })),
    shift_history: (data.shift_history ?? []).map((row) => ({
      id: String(row.id),
      cashier_name: String(row.cashier_name ?? "Cashier"),
      opened_at: String(row.opened_at),
      closed_at: row.closed_at ? String(row.closed_at) : null,
      opening_cash: Number(row.opening_cash),
      expected_cash: row.expected_cash === null ? null : Number(row.expected_cash),
      actual_cash: row.actual_cash === null ? null : Number(row.actual_cash),
      variance: row.variance === null ? null : Number(row.variance),
      variance_reason: row.variance_reason ? String(row.variance_reason) : null,
    })),
    cash_variances: (data.cash_variances ?? []).map((row) => ({
      id: String(row.id),
      shift_id: String(row.shift_id),
      cashier_name: String(row.cashier_name ?? "Cashier"),
      closed_at: String(row.closed_at),
      expected_cash: Number(row.expected_cash),
      actual_cash: Number(row.actual_cash),
      variance: Number(row.variance),
      variance_reason: row.variance_reason ? String(row.variance_reason) : null,
    })),
    ai_insights: (data.ai_insights ?? []).map((row) => ({ title: String(row.title), detail: String(row.detail) })),
  };
}

function MiniLineChart({ rows }: { rows: { date: string; revenue: number; orders: number }[] }) {
  const values = rows.length > 0 ? rows : [{ date: "No data", revenue: 0, orders: 0 }];
  const max = Math.max(...values.map((row) => row.revenue), 1);
  const points = values
    .map((row, index) => {
      const x = values.length === 1 ? 280 : (index / (values.length - 1)) * 560;
      const y = 180 - (row.revenue / max) * 150;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="od-report-chart">
      <svg viewBox="0 0 560 190" role="img" aria-label="Sales trend">
        <polyline points={points} fill="none" stroke="var(--od-primary)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {values.map((row, index) => {
          const x = values.length === 1 ? 280 : (index / (values.length - 1)) * 560;
          const y = 180 - (row.revenue / max) * 150;
          return <circle key={`${row.date}-${index}`} cx={x} cy={y} r="5" fill="var(--od-primary)" />;
        })}
      </svg>
    </div>
  );
}

function ReportTable({ title, subtitle, headers, rows }: { title: string; subtitle: string; headers: string[]; rows: ReportRow[] }) {
  return (
    <div className="od-card">
      <div className="od-card-header">
        <div>
          <div className="od-card-title">{title}</div>
          <div className="od-card-subtitle">{subtitle}</div>
        </div>
      </div>
      <div className="od-table-wrap">
        <table className="od-table">
          <thead>
            <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={headers.length}><div className="od-empty compact">No report data in this range</div></td></tr>
            ) : rows.map((row, index) => (
              <tr key={index}>
                {headers.map((header) => <td key={header}>{row[header]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReportsPage({ restaurantId, restaurantName }: { restaurantId: string; restaurantName: string }) {
  const defaultEnd = toDateInputValue(new Date());
  const defaultStartDate = new Date();
  defaultStartDate.setDate(defaultStartDate.getDate() - 30);
  const [startDate, setStartDate] = useState(toDateInputValue(defaultStartDate));
  const [endDate, setEndDate] = useState(defaultEnd);
  const [reportData, setReportData] = useState<OwnerReportData>(emptyReportData());
  const [loadingReport, setLoadingReport] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function loadReport() {
      try {
        setLoadingReport(true);
        setReportError(null);
        const endExclusive = new Date(`${endDate}T00:00:00`);
        endExclusive.setDate(endExclusive.getDate() + 1);
        const rangeStart = new Date(`${startDate}T00:00:00`).toISOString();
        const rangeEnd = endExclusive.toISOString();
        const [{ data, error }, { data: shiftData, error: shiftError }] = await Promise.all([
          supabase.rpc("get_owner_reporting_center", {
            target_restaurant_id: restaurantId,
            range_start: rangeStart,
            range_end: rangeEnd,
          }),
          supabase.rpc("get_owner_shift_visibility", {
            target_restaurant_id: restaurantId,
            range_start: rangeStart,
            range_end: rangeEnd,
          }),
        ]);
        if (error) throw new Error(error.message);
        if (shiftError) throw new Error(shiftError.message);
        const reportPayload = data && typeof data === "object" ? data as object : {};
        const shiftPayload = shiftData && typeof shiftData === "object" ? shiftData as object : {};
        if (mounted) setReportData(normalizeReportData({ ...reportPayload, ...shiftPayload }));
      } catch (loadError) {
        if (mounted) setReportError(loadError instanceof Error ? loadError.message : "Could not load reports.");
      } finally {
        if (mounted) setLoadingReport(false);
      }
    }
    void loadReport();
    return () => { mounted = false; };
  }, [restaurantId, startDate, endDate]);

  const salesRows = reportData.sales_by_day.map((row) => ({ Date: row.date.slice(0, 10), Revenue: fmtMoney(row.revenue), Orders: row.orders }));
  const orderRows = reportData.orders_by_status.map((row) => ({ Status: statusLabel(row.status), Orders: row.orders }));
  const menuRows = reportData.menu_performance.map((row) => ({ Item: row.name, Category: row.category, Quantity: row.quantity, Revenue: fmtMoney(row.revenue) }));
  const staffRows = reportData.staff_performance.map((row) => ({ Staff: row.name, Role: row.role, Completed: row.orders_completed, Payments: row.payments_verified }));
  const tableRows = reportData.table_usage.map((row) => ({ Table: row.table_number, Orders: row.orders, Revenue: fmtMoney(row.revenue) }));
  const customerRows = reportData.customers.map((row) => ({ Customer: row.customer_name, Orders: row.orders, Revenue: fmtMoney(row.revenue), "Last Order": row.last_order_at ? fmtDateTime(row.last_order_at) : "-" }));
  const shiftRows = reportData.shift_history.map((row) => ({
    Cashier: row.cashier_name,
    Opened: fmtDateTime(row.opened_at),
    Closed: row.closed_at ? fmtDateTime(row.closed_at) : "Active",
    Expected: row.expected_cash === null ? "-" : fmtMoney(row.expected_cash),
    Actual: row.actual_cash === null ? "-" : fmtMoney(row.actual_cash),
    Variance: row.variance === null ? "-" : fmtMoney(row.variance),
  }));
  const varianceRows = reportData.cash_variances.map((row) => ({
    Cashier: row.cashier_name,
    Closed: fmtDateTime(row.closed_at),
    Expected: fmtMoney(row.expected_cash),
    Actual: fmtMoney(row.actual_cash),
    Variance: fmtMoney(row.variance),
    Reason: row.variance_reason ?? "-",
  }));
  const exportHeaders = ["Report", "Metric", "Value"];
  const exportRows = [
    ["Sales", "Revenue", reportData.summary.revenue],
    ["Orders", "Total orders", reportData.summary.orders],
    ["Orders", "Completed orders", reportData.summary.completed_orders],
    ["Orders", "Cancelled orders", reportData.summary.cancelled_orders],
    ["Sales", "Average order value", Math.round(reportData.summary.average_order_value)],
    ["Customers", "Unique customers", reportData.summary.unique_customers],
  ];

  function handleCsvExport() {
    exportRowsAsCsv(`serveflow-report-${startDate}-${endDate}.csv`, exportHeaders, exportRows);
  }

  function handleExcelExport() {
    exportRowsAsExcel(`serveflow-report-${startDate}-${endDate}.xls`, `${restaurantName} Reporting Center`, exportHeaders, exportRows);
  }

  function handlePrint() {
    window.print();
  }

  return (
    <div className="od-page od-print-area">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">Reporting Center</h1>
          <p className="od-page-subtitle">Sales, operations, menu, staff, table, customer, and AI business reports.</p>
        </div>
        <div className="od-header-actions od-no-print">
          <button className="od-btn-ghost" type="button" onClick={handleCsvExport}>CSV Export</button>
          <button className="od-btn-ghost" type="button" onClick={handleExcelExport}>Excel Export</button>
          <button className="od-btn-ghost" type="button" onClick={handlePrint}>PDF / Print</button>
        </div>
      </div>

      <div className="od-card od-no-print">
        <div className="od-settings-grid compact">
          <label>Start Date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label>End Date<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
        </div>
      </div>

      {reportError && <div className="od-error-inline">{reportError}</div>}

      <div className="od-kpi-grid analytics">
        <div className="od-kpi-card"><div className="od-kpi-label">Revenue</div><div className="od-kpi-value">{loadingReport ? "Loading..." : fmtMoneyK(reportData.summary.revenue)}</div></div>
        <div className="od-kpi-card"><div className="od-kpi-label">Orders</div><div className="od-kpi-value">{loadingReport ? "Loading..." : reportData.summary.orders}</div></div>
        <div className="od-kpi-card"><div className="od-kpi-label">Average Order</div><div className="od-kpi-value">{loadingReport ? "Loading..." : fmtMoney(Math.round(reportData.summary.average_order_value))}</div></div>
        <div className="od-kpi-card"><div className="od-kpi-label">Customers</div><div className="od-kpi-value">{loadingReport ? "Loading..." : reportData.summary.unique_customers}</div></div>
      </div>

      <div className="od-card">
        <div className="od-card-header">
          <div>
            <div className="od-card-title">Sales Reports</div>
            <div className="od-card-subtitle">Revenue and order trend for the selected date range.</div>
          </div>
        </div>
        <MiniLineChart rows={reportData.sales_by_day} />
      </div>

      <ReportTable title="Order Reports" subtitle="Order volume by workflow status." headers={["Status", "Orders"]} rows={orderRows} />
      <ReportTable title="Menu Performance Reports" subtitle="Top menu items by persisted order item revenue." headers={["Item", "Category", "Quantity", "Revenue"]} rows={menuRows} />
      <ReportTable title="Staff Performance Reports" subtitle="Payment verification and completion activity by staff member." headers={["Staff", "Role", "Completed", "Payments"]} rows={staffRows} />
      <ReportTable title="Cashier Shift History" subtitle="Read-only shift openings, closings, and reconciliation totals." headers={["Cashier", "Opened", "Closed", "Expected", "Actual", "Variance"]} rows={shiftRows} />
      <ReportTable title="Cash Variance Reports" subtitle="Permanent reconciliation variances recorded at shift close." headers={["Cashier", "Closed", "Expected", "Actual", "Variance", "Reason"]} rows={varianceRows} />
      <ReportTable title="Table Usage Reports" subtitle="Revenue and order volume by managed table." headers={["Table", "Orders", "Revenue"]} rows={tableRows} />
      <ReportTable title="Customer Reports" subtitle="Repeat and high-value customers based on captured customer names." headers={["Customer", "Orders", "Revenue", "Last Order"]} rows={customerRows} />

      <div className="od-card">
        <div className="od-card-header">
          <div>
            <div className="od-card-title">AI Business Reports</div>
            <div className="od-card-subtitle">Operational recommendations derived from current report data.</div>
          </div>
        </div>
        <div className="od-insight-grid">
          {reportData.ai_insights.map((insight) => (
            <div className="od-insight-card" key={insight.title}>
              <strong>{insight.title}</strong>
              <span>{insight.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CustomersPage({ orders }: { orders: OdOrder[] }) {
  const customers = [...orders.reduce((map, order) => {
    const key = order.customer_name?.trim() || "Guest";
    const current = map.get(key) ?? { name: key, orders: 0, revenue: 0, last: order.created_at };
    current.orders += 1;
    current.revenue += isRevenueOrder(order) ? order.total_price : 0;
    if (order.created_at > current.last) current.last = order.created_at;
    map.set(key, current);
    return map;
  }, new Map<string, { name: string; orders: number; revenue: number; last: string }>()).values()]
    .sort((a, b) => b.revenue - a.revenue);

  return (
    <div className="od-page">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">Customer Insights</h1>
          <p className="od-page-subtitle">Customer frequency and value from captured order names.</p>
        </div>
      </div>
      <ReportTable
        title="Customer Reports"
        subtitle="Visible customer history from real orders."
        headers={["Customer", "Orders", "Revenue", "Last Order"]}
        rows={customers.map((customer) => ({
          Customer: customer.name,
          Orders: customer.orders,
          Revenue: fmtMoney(customer.revenue),
          "Last Order": fmtDateTime(customer.last),
        }))}
      />
    </div>
  );
}

function QrTablesPage({ restaurantName, restaurantSlug, orders, tables }: { restaurantName: string; restaurantSlug: string; orders: OdOrder[]; tables: RestaurantTable[] }) {
  const activeTables = new Set(orders.map((order) => order.table_number).filter(Boolean));
  const visibleTables = tables.length > 0 ? tables : Array.from({ length: 20 }, (_, index) => ({
    id: `fallback-${index + 1}`,
    restaurant_id: "",
    table_number: index + 1,
    label: `Table ${index + 1}`,
    qr_path: restaurantSlug ? `/r/${restaurantSlug}/order?table=${index + 1}` : "",
    active: true,
  }));
  const floorTables = visibleTables.map((restaurantTable) => {
    const number = String(restaurantTable.table_number);
    const activeOrder = orders.find((order) => order.table_number === number);
    return {
      number: restaurantTable.table_number,
      label: restaurantTable.label,
      qrPath: restaurantTable.qr_path,
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
        <button className="od-btn-primary" onClick={() => window.print()}>Bulk QR Export</button>
      </div>
      <div className="od-kpi-grid analytics">
        <div className="od-kpi-card">
          <div className="od-kpi-label">Active Tables</div>
          <div className="od-kpi-value">{activeTables.size}</div>
        </div>
        <div className="od-kpi-card">
          <div className="od-kpi-label">Total Tables</div>
          <div className="od-kpi-value">{visibleTables.length}</div>
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
          {floorTables.map((table) => (
            <div key={table.number} className={`od-table-tile ${statusClass(table.status)}`}>
              <div className="od-table-num">{table.label}</div>
              <div className="od-table-state">{statusLabel(table.status)}</div>
              <a className="od-btn-ghost" href={table.qrPath} target="_blank" rel="noreferrer">QR Link</a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type SettingsFormState = {
  name: string;
  totalTables: string;
  phone: string;
  email: string;
  address: string;
  timezone: string;
  currency: string;
  opensAt: string;
  closesAt: string;
  acceptsQrOrders: boolean;
  autoAcceptOrders: boolean;
  serviceCharge: string;
  primaryColor: string;
  logoUrl: string;
  emailNotifications: boolean;
  smsNotifications: boolean;
  requireStrongPasswords: boolean;
  sessionTimeoutMinutes: string;
};

function configToSettingsForm(config: RestaurantConfig | null, fallbackName: string): SettingsFormState {
  return {
    name: config?.name ?? fallbackName,
    totalTables: String(config?.total_tables ?? 20),
    phone: jsonString(config?.profile ?? {}, "phone"),
    email: jsonString(config?.profile ?? {}, "email"),
    address: jsonString(config?.profile ?? {}, "address"),
    timezone: jsonString(config?.profile ?? {}, "timezone", "Africa/Nairobi"),
    currency: jsonString(config?.profile ?? {}, "currency", "ETB"),
    opensAt: jsonString(config?.business_hours ?? {}, "opens_at", "08:00"),
    closesAt: jsonString(config?.business_hours ?? {}, "closes_at", "22:00"),
    acceptsQrOrders: jsonBool(config?.ordering_settings ?? {}, "accepts_qr_orders", true),
    autoAcceptOrders: jsonBool(config?.ordering_settings ?? {}, "auto_accept_orders", false),
    serviceCharge: String((config?.ordering_settings?.service_charge_percent as number | undefined) ?? 0),
    primaryColor: jsonString(config?.branding ?? {}, "primary_color", "#0f766e"),
    logoUrl: jsonString(config?.branding ?? {}, "logo_url"),
    emailNotifications: jsonBool(config?.notification_settings ?? {}, "email_notifications", true),
    smsNotifications: jsonBool(config?.notification_settings ?? {}, "sms_notifications", false),
    requireStrongPasswords: jsonBool(config?.security_settings ?? {}, "require_strong_passwords", true),
    sessionTimeoutMinutes: String((config?.security_settings?.session_timeout_minutes as number | undefined) ?? 480),
  };
}

function SettingsPage({
  restaurantId,
  fallbackRestaurantName,
  config,
  tables,
  onSettingsChanged,
}: {
  restaurantId: string;
  fallbackRestaurantName: string;
  config: RestaurantConfig | null;
  tables: RestaurantTable[];
  onSettingsChanged: () => Promise<void>;
}) {
  const [form, setForm] = useState<SettingsFormState>(() => configToSettingsForm(config, fallbackRestaurantName));
  const [working, setWorking] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [qrCodes, setQrCodes] = useState<Record<number, string>>({});

  useEffect(() => {
    setForm(configToSettingsForm(config, fallbackRestaurantName));
  }, [config, fallbackRestaurantName]);

  useEffect(() => {
    let mounted = true;
    async function generateQrCodes() {
      const pairs = await Promise.all(
        tables.slice(0, 80).map(async (table) => {
          const url = `${window.location.origin}${table.qr_path}`;
          const dataUrl = await QRCode.toDataURL(url, { width: 132, margin: 1 });
          return [table.table_number, dataUrl] as const;
        })
      );
      if (mounted) setQrCodes(Object.fromEntries(pairs));
    }
    void generateQrCodes();
    return () => { mounted = false; };
  }, [tables]);

  function updateField<K extends keyof SettingsFormState>(key: K, value: SettingsFormState[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setWorking(true);
      setSettingsError(null);
      setNotice(null);
      const totalTables = Number(form.totalTables);
      const serviceCharge = Number(form.serviceCharge);
      const sessionTimeout = Number(form.sessionTimeoutMinutes);
      if (!Number.isInteger(totalTables) || totalTables < 1 || totalTables > 500) throw new Error("Total tables must be a whole number from 1 to 500.");
      if (!Number.isFinite(serviceCharge) || serviceCharge < 0 || serviceCharge > 30) throw new Error("Service charge must be between 0 and 30 percent.");
      if (!Number.isInteger(sessionTimeout) || sessionTimeout < 15 || sessionTimeout > 1440) throw new Error("Session timeout must be between 15 and 1440 minutes.");

      const { error } = await supabase.rpc("update_restaurant_configuration", {
        target_restaurant_id: restaurantId,
        restaurant_name: form.name,
        requested_total_tables: totalTables,
        profile_payload: {
          phone: form.phone.trim(),
          email: form.email.trim(),
          address: form.address.trim(),
          timezone: form.timezone.trim(),
          currency: form.currency.trim(),
        },
        business_hours_payload: {
          opens_at: form.opensAt,
          closes_at: form.closesAt,
        },
        ordering_settings_payload: {
          accepts_qr_orders: form.acceptsQrOrders,
          auto_accept_orders: form.autoAcceptOrders,
          service_charge_percent: serviceCharge,
        },
        branding_payload: {
          primary_color: form.primaryColor,
          logo_url: form.logoUrl.trim(),
        },
        notification_settings_payload: {
          email_notifications: form.emailNotifications,
          sms_notifications: form.smsNotifications,
        },
        security_settings_payload: {
          require_strong_passwords: form.requireStrongPasswords,
          session_timeout_minutes: sessionTimeout,
        },
      });
      if (error) throw new Error(error.message);
      await onSettingsChanged();
      setNotice("Settings saved and table QR records synchronized.");
    } catch (saveError) {
      setSettingsError(saveError instanceof Error ? saveError.message : "Could not save settings.");
    } finally {
      setWorking(false);
    }
  }

  function handleCancel() {
    setForm(configToSettingsForm(config, fallbackRestaurantName));
    setSettingsError(null);
    setNotice(null);
  }

  return (
    <div className="od-page">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">Business Configuration</h1>
          <p className="od-page-subtitle">Restaurant profile, tables, QR codes, ordering, branding, notifications, billing, and security.</p>
        </div>
      </div>

      {!config && <div className="od-card"><div className="od-empty compact">Loading settings...</div></div>}
      {(settingsError || notice) && <div className={settingsError ? "od-error-inline" : "od-success-inline"}>{settingsError || notice}</div>}

      <form className="od-settings-form" onSubmit={handleSave}>
        <div className="od-settings-actions">
          <button className="od-btn-ghost" type="button" onClick={handleCancel} disabled={working}>Cancel</button>
          <button className="od-btn-primary" type="submit" disabled={working}>{working ? "Saving..." : "Save Changes"}</button>
        </div>

        <div className="od-settings-layout">
          <div className="od-settings-main">
            <section className="od-card">
              <div className="od-card-header"><div><div className="od-card-title">Restaurant Profile</div><div className="od-card-subtitle">Core information used across owner and public experiences.</div></div></div>
              <div className="od-settings-grid">
                <label>Restaurant Name<input value={form.name} onChange={(event) => updateField("name", event.target.value)} disabled={working} /></label>
                <label>Phone<input value={form.phone} onChange={(event) => updateField("phone", event.target.value)} disabled={working} /></label>
                <label>Email<input type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} disabled={working} /></label>
                <label>Currency<input value={form.currency} onChange={(event) => updateField("currency", event.target.value)} disabled={working} /></label>
                <label className="wide">Address<input value={form.address} onChange={(event) => updateField("address", event.target.value)} disabled={working} /></label>
                <label>Timezone<input value={form.timezone} onChange={(event) => updateField("timezone", event.target.value)} disabled={working} /></label>
              </div>
            </section>

            <section className="od-card">
              <div className="od-card-header"><div><div className="od-card-title">Table Management</div><div className="od-card-subtitle">Controls restaurant_tables records and table validation during ordering.</div></div></div>
              <div className="od-settings-grid compact">
                <label>Total Tables<input type="number" min="1" max="500" value={form.totalTables} onChange={(event) => updateField("totalTables", event.target.value)} disabled={working} /></label>
                <div className="od-setting-stat"><strong>{tables.length}</strong><span>Active table records</span></div>
                <div className="od-setting-stat"><strong>100%</strong><span>QR coverage after save</span></div>
              </div>
            </section>

            <section className="od-card">
              <div className="od-card-header"><div><div className="od-card-title">Business Hours</div><div className="od-card-subtitle">Default operating window for ordering and reports.</div></div></div>
              <div className="od-settings-grid compact">
                <label>Opens At<input type="time" value={form.opensAt} onChange={(event) => updateField("opensAt", event.target.value)} disabled={working} /></label>
                <label>Closes At<input type="time" value={form.closesAt} onChange={(event) => updateField("closesAt", event.target.value)} disabled={working} /></label>
              </div>
            </section>

            <section className="od-card">
              <div className="od-card-header"><div><div className="od-card-title">Ordering Settings</div><div className="od-card-subtitle">Customer ordering behavior and payment workflow defaults.</div></div></div>
              <div className="od-settings-grid compact">
                <label className="od-toggle-row"><input type="checkbox" checked={form.acceptsQrOrders} onChange={(event) => updateField("acceptsQrOrders", event.target.checked)} disabled={working} />QR orders enabled</label>
                <label className="od-toggle-row"><input type="checkbox" checked={form.autoAcceptOrders} onChange={(event) => updateField("autoAcceptOrders", event.target.checked)} disabled={working} />Auto-accept paid orders</label>
                <label>Service Charge %<input type="number" min="0" max="30" step="0.1" value={form.serviceCharge} onChange={(event) => updateField("serviceCharge", event.target.value)} disabled={working} /></label>
              </div>
            </section>

            <section className="od-card">
              <div className="od-card-header"><div><div className="od-card-title">Branding</div><div className="od-card-subtitle">Public menu visual identity.</div></div></div>
              <div className="od-settings-grid compact">
                <label>Primary Color<input type="color" value={form.primaryColor} onChange={(event) => updateField("primaryColor", event.target.value)} disabled={working} /></label>
                <label className="wide">Logo URL<input value={form.logoUrl} onChange={(event) => updateField("logoUrl", event.target.value)} disabled={working} /></label>
              </div>
            </section>
          </div>

          <div className="od-settings-side">
            <section className="od-card">
              <div className="od-card-header"><div><div className="od-card-title">QR Code Management</div><div className="od-card-subtitle">Every active table has a generated public ordering code.</div></div></div>
              <div className="od-qr-list">
                {tables.length === 0 ? <div className="od-empty compact">Save table settings to generate QR codes.</div> : tables.slice(0, 12).map((table) => (
                  <div className="od-qr-row" key={table.id}>
                    {qrCodes[table.table_number] ? <img src={qrCodes[table.table_number]} alt="" /> : <div className="od-qr-placeholder">QR</div>}
                    <div><strong>{table.label}</strong><span>{table.qr_path}</span></div>
                  </div>
                ))}
              </div>
            </section>

            <section className="od-card">
              <div className="od-card-header"><div><div className="od-card-title">Notification Settings</div></div></div>
              <div className="od-settings-stack">
                <label className="od-toggle-row"><input type="checkbox" checked={form.emailNotifications} onChange={(event) => updateField("emailNotifications", event.target.checked)} disabled={working} />Email notifications</label>
                <label className="od-toggle-row"><input type="checkbox" checked={form.smsNotifications} onChange={(event) => updateField("smsNotifications", event.target.checked)} disabled={working} />SMS notifications</label>
              </div>
            </section>

            <section className="od-card">
              <div className="od-card-header"><div><div className="od-card-title">Subscription & Billing</div></div></div>
              <div className="od-billing-box">
                <strong>{config?.subscription_plan ?? "starter"}</strong>
                <span>{config?.billing_status ?? "trial"}</span>
                <button className="od-btn-ghost" type="button" disabled>Manage Billing</button>
              </div>
            </section>

            <section className="od-card">
              <div className="od-card-header"><div><div className="od-card-title">Security</div></div></div>
              <div className="od-settings-stack">
                <label className="od-toggle-row"><input type="checkbox" checked={form.requireStrongPasswords} onChange={(event) => updateField("requireStrongPasswords", event.target.checked)} disabled={working} />Strong passwords</label>
                <label>Session Timeout<input type="number" min="15" max="1440" value={form.sessionTimeoutMinutes} onChange={(event) => updateField("sessionTimeoutMinutes", event.target.value)} disabled={working} /></label>
              </div>
            </section>
          </div>
        </div>
      </form>
    </div>
  );
}

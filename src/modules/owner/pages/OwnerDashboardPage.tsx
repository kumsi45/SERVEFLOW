import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { getQrAppUrl } from "../../../core/config/appUrl";
import { supabase } from "../../../core/database";
import { formatPreparationEstimate } from "../../../core/menu/preparationTime";
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

function getOwnerGreeting(now: Date) {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) {
    return { dashboardLabel: "Morning Dashboard", greeting: "Good morning" };
  }
  if (hour >= 12 && hour < 17) {
    return { dashboardLabel: "Afternoon Dashboard", greeting: "Good afternoon" };
  }
  if (hour >= 17 && hour < 21) {
    return { dashboardLabel: "Evening Dashboard", greeting: "Good evening" };
  }
  return { dashboardLabel: "Night Dashboard", greeting: "Good night" };
}

type OwnerOrderStatus = "pending_payment" | "paid" | "preparing" | "ready" | "completed" | "cancelled";
type AnalyticsPeriod = "today" | "week" | "month";

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

function isOperationalStaff(member: Pick<OdStaff, "role">) {
  return member.role !== "owner";
}

type OdMenuItem = {
  id: string;
  name: string;
  description: string | null;
  ingredients?: string[] | null;
  allergens?: string[] | null;
  preparation_time_minutes?: number | null;
  spice_level?: number | null;
  dietary_tags?: string[] | null;
  calories?: number | null;
  protein_g?: number | null;
  carbohydrates_g?: number | null;
  fat_g?: number | null;
  fiber_g?: number | null;
  sugar_g?: number | null;
  sodium_mg?: number | null;
  price: number;
  available: boolean;
  category_id: string;
  kitchen_station_id: string | null;
  image_url: string | null;
  archived_at?: string | null;
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
  kitchen_settings: JsonRecord;
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
  qr_url: string | null;
  qr_created_at: string;
  qr_regenerated_at: string;
  active: boolean;
  created_at: string;
};

type RestaurantTableQrStats = {
  table_id: string;
  orders_today: number;
  last_scan_at: string | null;
  last_order_at: string | null;
  scan_count: number | null;
};

type OdKitchenStation = {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  display_color: string;
  icon: string;
  priority: number;
  active: boolean;
  assigned_menu_items: number;
  created_at: string;
  updated_at: string;
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

type OwnerReportSummary = OwnerReportData["summary"];

type NavId = "overview" | "orders" | "analytics" | "menu" | "stations" | "staff" | "qr" | "customers" | "reports" | "settings";

const NAV_ITEMS: { id: NavId; icon: string; label: string }[] = [
  { id: "overview", icon: "OV", label: "Overview" },
  { id: "orders", icon: "OR", label: "Orders" },
  { id: "analytics", icon: "AN", label: "Revenue & Analytics" },
  { id: "menu", icon: "MN", label: "Menu" },
  { id: "stations", icon: "KS", label: "Kitchen Stations" },
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

function navIconLabel(id: NavId) {
  const labels: Record<NavId, string> = {
    overview: "[]",
    orders: "=",
    analytics: "|",
    menu: "x",
    stations: "KS",
    staff: "+",
    qr: "#",
    customers: "o",
    reports: "|",
    settings: "*",
  };
  return labels[id];
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

function getAnalyticsDateRange(period: AnalyticsPeriod) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);

  if (period === "week") {
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
    end.setDate(start.getDate() + 7);
  } else if (period === "month") {
    start.setDate(1);
    end.setMonth(start.getMonth() + 1, 1);
  } else {
    end.setDate(start.getDate() + 1);
  }

  return { rangeStart: start.toISOString(), rangeEnd: end.toISOString() };
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

function jsonStringArray(value: JsonRecord, key: string): string[] {
  const raw = value[key];
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : [];
}

function buildBrandingAssetPath(restaurantId: string, assetType: "logo" | "cover") {
  return `${restaurantId}/branding/${assetType}`;
}

function buildRestaurantConfig(row: Record<string, unknown>, fallbackName: string): RestaurantConfig {
  return {
    id: String(row.id),
    name: typeof row.name === "string" ? row.name : fallbackName,
    slug: typeof row.slug === "string" ? row.slug : "",
    total_tables: Number(row.total_tables ?? row.table_count ?? 20),
    profile: toJsonRecord(row.profile),
    business_hours: toJsonRecord(row.business_hours),
    kitchen_settings: toJsonRecord(row.kitchen_settings),
    ordering_settings: toJsonRecord(row.ordering_settings),
    branding: toJsonRecord(row.branding),
    notification_settings: toJsonRecord(row.notification_settings),
    security_settings: toJsonRecord(row.security_settings),
    subscription_plan: typeof row.subscription_plan === "string" ? row.subscription_plan : "starter",
    billing_status: typeof row.billing_status === "string" ? row.billing_status : "trial",
  };
}

function normalizeRestaurantTable(row: Record<string, unknown>): RestaurantTable {
  return {
    id: String(row.id),
    restaurant_id: String(row.restaurant_id),
    table_number: Number(row.table_number),
    label: typeof row.label === "string" ? row.label : `Table ${Number(row.table_number)}`,
    qr_path: typeof row.qr_path === "string" ? row.qr_path : "",
    qr_url: typeof row.qr_url === "string" ? row.qr_url : null,
    qr_created_at: typeof row.qr_created_at === "string" ? row.qr_created_at : String(row.created_at ?? ""),
    qr_regenerated_at: typeof row.qr_regenerated_at === "string" ? row.qr_regenerated_at : String(row.updated_at ?? row.created_at ?? ""),
    active: Boolean(row.active),
    created_at: typeof row.created_at === "string" ? row.created_at : "",
  };
}

function normalizeKitchenStation(row: Record<string, unknown>): OdKitchenStation {
  return {
    id: String(row.id),
    restaurant_id: String(row.restaurant_id),
    name: String(row.name),
    description: typeof row.description === "string" ? row.description : null,
    display_color: typeof row.display_color === "string" ? row.display_color : "#0f766e",
    icon: typeof row.icon === "string" ? row.icon : "MK",
    priority: Number(row.priority ?? 100),
    active: Boolean(row.active),
    assigned_menu_items: Number(row.assigned_menu_items ?? 0),
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    updated_at: typeof row.updated_at === "string" ? row.updated_at : "",
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [orders, setOrders] = useState<OdOrder[]>([]);
  const [staff, setStaff] = useState<OdStaff[]>([]);
  const [menuItems, setMenuItems] = useState<OdMenuItem[]>([]);
  const [categories, setCategories] = useState<OdCategory[]>([]);
  const [orderItems, setOrderItems] = useState<OdOrderItem[]>([]);
  const [activeShifts, setActiveShifts] = useState<OwnerActiveShift[]>([]);
  const [restaurantConfig, setRestaurantConfig] = useState<RestaurantConfig | null>(null);
  const [restaurantTables, setRestaurantTables] = useState<RestaurantTable[]>([]);
  const [kitchenStations, setKitchenStations] = useState<OdKitchenStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboardReports, setDashboardReports] = useState<Record<AnalyticsPeriod, OwnerReportSummary>>({
    today: emptyReportData().summary,
    week: emptyReportData().summary,
    month: emptyReportData().summary,
  });
  const [dashboardReportsLoading, setDashboardReportsLoading] = useState(true);

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
          { data: stationData, error: stationError },
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
              .select("id,user_id,display_name,email,role,assigned_kitchen_station_id,active,created_at,last_login_at")
              .eq("restaurant_id", restaurantId)
              .neq("role", "owner")
              .order("created_at", { ascending: true }),
            supabase
              .from("menu_items")
              .select("id,name,description,ingredients,allergens,preparation_time_minutes,spice_level,dietary_tags,calories,protein_g,carbohydrates_g,fat_g,fiber_g,sugar_g,sodium_mg,price,available,category_id,kitchen_station_id,image_url,archived_at")
              .eq("restaurant_id", restaurantId)
              .is("archived_at", null)
              .order("name", { ascending: true }),
            supabase
              .from("categories")
              .select("id,name")
              .eq("restaurant_id", restaurantId)
              .order("name", { ascending: true }),
            supabase
              .from("restaurants")
              .select("id,name,slug,total_tables,table_count,profile,business_hours,kitchen_settings,ordering_settings,branding,notification_settings,security_settings,subscription_plan,billing_status")
              .eq("id", restaurantId)
              .maybeSingle(),
            supabase
              .from("restaurant_tables")
              .select("id,restaurant_id,table_number,label,qr_path,qr_url,qr_created_at,qr_regenerated_at,active,created_at")
              .eq("restaurant_id", restaurantId)
              .order("table_number", { ascending: true }),
            supabase
              .from("cashier_shifts")
              .select("id,restaurant_id,opened_by,opened_at,opening_cash")
              .eq("restaurant_id", restaurantId)
              .is("closed_at", null)
              .order("opened_at", { ascending: false }),
            supabase.rpc("get_owner_kitchen_stations", {
              target_restaurant_id: restaurantId,
            }),
          ]);

        if (orderError) throw new Error(orderError.message);
        if (staffError) throw new Error(staffError.message);
        if (menuError) throw new Error(menuError.message);
        if (categoryError) throw new Error(categoryError.message);
        if (restaurantError) throw new Error(restaurantError.message);
        if (tableError) throw new Error(tableError.message);
        if (shiftError) throw new Error(shiftError.message);
        if (stationError) throw new Error(stationError.message);
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
        setRestaurantTables((tableData ?? []).map((row) => normalizeRestaurantTable(row as Record<string, unknown>)));
        setKitchenStations(((stationData ?? []) as Record<string, unknown>[]).map((row) => normalizeKitchenStation(row)));
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
    let mounted = true;

    async function loadDashboardReports() {
      try {
        setDashboardReportsLoading(true);
        const reports = await Promise.all(
          (["today", "week", "month"] as AnalyticsPeriod[]).map(async (reportPeriod) => {
            const { rangeStart, rangeEnd } = getAnalyticsDateRange(reportPeriod);
            const { data: reportPayload, error: reportError } = await supabase.rpc("get_owner_reporting_center", {
              target_restaurant_id: restaurantId,
              range_start: rangeStart,
              range_end: rangeEnd,
            });
            if (reportError) throw new Error(reportError.message);
            return [reportPeriod, normalizeReportData(reportPayload && typeof reportPayload === "object" ? reportPayload as object : {}).summary] as const;
          })
        );
        if (mounted) setDashboardReports(Object.fromEntries(reports) as Record<AnalyticsPeriod, OwnerReportSummary>);
      } catch (reportError) {
        if (mounted) setError(reportError instanceof Error ? reportError.message : "Failed to load revenue summaries.");
      } finally {
        if (mounted) setDashboardReportsLoading(false);
      }
    }

    void loadDashboardReports();
    return () => { mounted = false; };
  }, [restaurantId, orders]);

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
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items", filter: `restaurant_id=eq.${restaurantId}` }, async (payload) => {
        const oldRow = payload.old as Partial<OdOrderItem> & { order_id?: string; quantity?: number | string } | null;
        const newRow = payload.new as Partial<OdOrderItem> & { order_id?: string; quantity?: number | string; menu_item_id?: string | null } | null;
        const orderId = String(newRow?.order_id ?? oldRow?.order_id ?? "");
        if (!orderId) return;

        if (payload.eventType === "INSERT" && newRow?.id) {
          const menuItem = newRow.menu_item_id ? menuItems.find((item) => item.id === newRow.menu_item_id) : null;
          setOrderItems((previous) => [
            ...previous,
            {
              id: String(newRow.id),
              order_id: orderId,
              menu_item_id: newRow.menu_item_id ? String(newRow.menu_item_id) : null,
              quantity: Number(newRow.quantity ?? 0),
              price: Number(newRow.price ?? 0),
              name: menuItem?.name ?? "Menu item",
            },
          ]);
          setOrders((previous) => previous.map((order) => order.id === orderId ? { ...order, item_count: order.item_count + Number(newRow.quantity ?? 0) } : order));
        }

        if (payload.eventType === "DELETE" && oldRow?.id) {
          setOrderItems((previous) => previous.filter((item) => item.id !== oldRow.id));
          setOrders((previous) => previous.map((order) => order.id === orderId ? { ...order, item_count: Math.max(0, order.item_count - Number(oldRow.quantity ?? 0)) } : order));
        }
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
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_tables", filter: `restaurant_id=eq.${restaurantId}` }, () => {
        void refreshRestaurantConfig().catch((refreshError) => {
          setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh table configuration.");
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "menu_items", filter: `restaurant_id=eq.${restaurantId}` }, () => {
        void refreshMenu().catch((refreshError) => {
          setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh menu items.");
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "kitchen_stations", filter: `restaurant_id=eq.${restaurantId}` }, () => {
        void refreshKitchenStations().catch((refreshError) => {
          setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh kitchen stations.");
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_staff", filter: `restaurant_id=eq.${restaurantId}` }, () => {
        void refreshStaff().catch((refreshError) => {
          setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh staff.");
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "restaurants", filter: `id=eq.${restaurantId}` }, () => {
        void refreshRestaurantConfig().catch((refreshError) => {
          setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh restaurant configuration.");
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [restaurantId, menuItems]);

  const todayStart = startOfTodayIso();
  const todayOrders = useMemo(() => orders.filter((order) => order.created_at >= todayStart), [orders, todayStart]);
  const revenueOrders = useMemo(() => todayOrders.filter(isRevenueOrder), [todayOrders]);
  const allRevenueOrders = useMemo(() => orders.filter(isRevenueOrder), [orders]);
  const todayRevenue = dashboardReports.today.revenue;
  const weekRevenue = dashboardReports.week.revenue;
  const monthRevenue = dashboardReports.month.revenue;
  const allRevenue = monthRevenue;
  const activeOrders = useMemo(() => orders.filter((order) => ACTIVE_ORDER_STATUSES.includes(order.status)), [orders]);
  const pendingOrders = useMemo(() => orders.filter((order) => order.status === "pending_payment"), [orders]);
  const completedToday = useMemo(() => orders.filter((order) => order.status === "completed" && (order.completed_at ?? order.created_at) >= todayStart), [orders, todayStart]);
  const avgOrderValue = Math.round(dashboardReports.today.average_order_value);
  const activeStaff = staff.filter((member) => isOperationalStaff(member) && member.active).length;
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
      .select("id,user_id,display_name,email,role,assigned_kitchen_station_id,active,created_at,last_login_at")
      .eq("restaurant_id", restaurantId)
      .neq("role", "owner")
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
      .select("id,name,description,ingredients,allergens,preparation_time_minutes,spice_level,dietary_tags,calories,protein_g,carbohydrates_g,fat_g,fiber_g,sugar_g,sodium_mg,price,available,category_id,kitchen_station_id,image_url,archived_at")
      .eq("restaurant_id", restaurantId)
      .is("archived_at", null)
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

  async function refreshKitchenStations() {
    const { data, error: stationError } = await supabase.rpc("get_owner_kitchen_stations", {
      target_restaurant_id: restaurantId,
    });
    if (stationError) throw new Error(stationError.message);
    setKitchenStations(((data ?? []) as Record<string, unknown>[]).map((row) => normalizeKitchenStation(row)));
  }

  async function refreshRestaurantConfig() {
    const [{ data: restaurantData, error: restaurantError }, { data: tableData, error: tableError }] = await Promise.all([
      supabase
        .from("restaurants")
        .select("id,name,slug,total_tables,table_count,profile,business_hours,kitchen_settings,ordering_settings,branding,notification_settings,security_settings,subscription_plan,billing_status")
        .eq("id", restaurantId)
        .maybeSingle(),
      supabase
        .from("restaurant_tables")
        .select("id,restaurant_id,table_number,label,qr_path,qr_url,qr_created_at,qr_regenerated_at,active,created_at")
        .eq("restaurant_id", restaurantId)
        .order("table_number", { ascending: true }),
    ]);

    if (restaurantError) throw new Error(restaurantError.message);
    if (tableError) throw new Error(tableError.message);
    if (restaurantData) setRestaurantConfig(buildRestaurantConfig(restaurantData as Record<string, unknown>, restaurantName));
    setRestaurantTables((tableData ?? []).map((row) => normalizeRestaurantTable(row as Record<string, unknown>)));
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
    weekRevenue,
    monthRevenue,
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
    dashboardReportsLoading,
  };

  function handleMobileNavigate(nextNav: NavId) {
    setNav(nextNav);
    setMobileMenuOpen(false);
  }

  return (
    <div className="od-root">
      <header className="od-mobile-appbar">
        <h1>Dashboard</h1>
        <div className="od-mobile-appbar-actions">
          <button
            type="button"
            aria-label="Open dashboard menu"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            <span className="od-mobile-menu-icon" aria-hidden="true" />
          </button>
          <button type="button" aria-label="Notifications">
            <span className="od-mobile-bell-icon" aria-hidden="true" />
          </button>
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="od-mobile-menu-layer">
          <button className="od-mobile-menu-backdrop" type="button" aria-label="Close dashboard menu" onClick={() => setMobileMenuOpen(false)} />
          <aside className="od-mobile-menu" aria-label="Owner dashboard menu">
            <div className="od-mobile-menu-head">
              <div className="od-restaurant-badge">
                <div className="od-restaurant-avatar">{restaurantName.charAt(0)}</div>
                <div>
                  <div className="od-restaurant-name">{restaurantName}</div>
                  <div className="od-restaurant-role">Admin Access</div>
                </div>
              </div>
              <button type="button" aria-label="Close dashboard menu" onClick={() => setMobileMenuOpen(false)}>Close</button>
            </div>
            <nav className="od-mobile-menu-nav" aria-label="All owner dashboard sections">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={nav === item.id ? "active" : ""}
                  onClick={() => handleMobileNavigate(item.id)}
                >
                  <span>{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </nav>
            <button className="od-mobile-menu-signout" type="button" onClick={handleSignOut}>
              Sign Out
            </button>
          </aside>
        </div>
      )}

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

        {nav === "overview" && <OverviewPage data={dashboardData} staff={staff} ownerName={ownerName} onNavigate={setNav} now={now} />}
        {nav === "orders" && <OrdersPage orders={orders} activeOrders={activeOrders} loading={loading} restaurantName={restaurantName} />}
        {nav === "analytics" && <AnalyticsPage data={dashboardData} restaurantId={restaurantId} />}
        {nav === "staff" && (
          <StaffPage
            staff={staff}
            restaurantId={restaurantId}
            restaurantName={restaurantName}
            stations={kitchenStations}
            onStaffChanged={refreshStaff}
          />
        )}
        {nav === "menu" && (
          <MenuPage
            restaurantId={restaurantId}
            items={menuItems}
            categories={categories}
            stations={kitchenStations}
            topItems={topItems}
            onMenuChanged={refreshMenu}
          />
        )}
        {nav === "stations" && (
          <KitchenStationsPage
            restaurantId={restaurantId}
            stations={kitchenStations}
            onStationsChanged={refreshKitchenStations}
          />
        )}
        {nav === "qr" && (
          <QrTablesPage
            restaurantId={restaurantId}
            restaurantName={restaurantConfig?.name ?? restaurantName}
            restaurantSlug={restaurantConfig?.slug ?? ""}
            logoUrl={jsonString(restaurantConfig?.branding ?? {}, "logo_url")}
            orders={orders}
            tables={restaurantTables}
            onTableChanged={(updatedTable) => {
              setRestaurantTables((previous) => previous
                .map((table) => table.id === updatedTable.id ? updatedTable : table)
                .sort((left, right) => left.table_number - right.table_number));
            }}
          />
        )}
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

      <nav className="od-mobile-bottom-nav" aria-label="Owner mobile navigation">
        {([
          { id: "overview" as NavId, label: "Overview" },
          { id: "orders" as NavId, label: "Orders" },
          { id: "menu" as NavId, label: "Menu" },
          { id: "stations" as NavId, label: "Stations" },
          { id: "settings" as NavId, label: "Settings" },
        ]).map((item) => (
          <button
            key={item.id}
            type="button"
            className={nav === item.id ? "active" : ""}
            onClick={() => handleMobileNavigate(item.id)}
          >
            <span>{navIconLabel(item.id)}</span>
            {item.label}
          </button>
        ))}
      </nav>
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
  weekRevenue: number;
  monthRevenue: number;
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
  dashboardReportsLoading: boolean;
};

function OverviewPage({ data, staff, ownerName, onNavigate, now }: { data: DashboardData; staff: OdStaff[]; ownerName?: string; onNavigate: (nav: NavId) => void; now: Date }) {
  const staffById = new Map(staff.map((member) => [member.id, member]));
  const kpis = [
    { label: "Revenue Today", value: data.dashboardReportsLoading ? "Loading..." : fmtMoney(data.todayRevenue), badge: "Today", tone: "up" },
    { label: "Current Week", value: data.dashboardReportsLoading ? "Loading..." : fmtMoney(data.weekRevenue), badge: "Week", tone: "up" },
    { label: "Current Month", value: data.dashboardReportsLoading ? "Loading..." : fmtMoney(data.monthRevenue), badge: "Month", tone: "up" },
    { label: "Avg Order Value", value: fmtMoney(data.avgOrderValue), badge: "Paid", tone: "up" },
    { label: "Pending Payment", value: `${data.pendingOrders.length}`, badge: "Action", tone: data.pendingOrders.length > 0 ? "down" : "neutral" },
    { label: "Active Staff", value: `${data.activeStaff}`, badge: `${data.kitchenStaff.length} kitchen`, tone: "neutral" },
    { label: "Menu Items", value: `${data.menuItems.length}`, badge: `${data.menuItems.filter((item) => item.available).length} live`, tone: "neutral" },
    { label: "Completed Today", value: `${data.completedToday.length}`, badge: "Saved", tone: "up" },
  ];

  return (
    <div className="od-page">
      <OwnerMobileOverview data={data} ownerName={ownerName} onNavigate={onNavigate} now={now} />

      <div className="od-overview-desktop">
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
    </div>
  );
}

function OwnerMobileOverview({ data, ownerName, onNavigate, now }: { data: DashboardData; ownerName?: string; onNavigate: (nav: NavId) => void; now: Date }) {
  const { dashboardLabel, greeting } = getOwnerGreeting(now);
  const recentOrders = [...data.orders]
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .slice(0, 3);
  const mobileKpis = [
    { icon: "$", label: "Today's Revenue", value: data.dashboardReportsLoading ? "Loading..." : fmtMoney(data.todayRevenue), delta: "12%", tone: "up" },
    { icon: "[]", label: "Active Orders", value: `${data.activeOrders.length}`, delta: "8%", tone: "up" },
    { icon: "o", label: "New Customers", value: `${Math.max(data.completedToday.length, data.orders.filter((order) => order.customer_name).length)}`, delta: "0%", tone: "flat" },
  ];
  const quickActions = [
    { icon: "+", label: "New Order", nav: "orders" as NavId, primary: true },
    { icon: "#", label: "Generate QR", nav: "qr" as NavId },
    { icon: "x", label: "Manage Menu", nav: "menu" as NavId },
    { icon: "+", label: "Add Staff", nav: "staff" as NavId },
  ];

  return (
    <section className="od-mobile-overview" aria-label="Mobile owner dashboard">
      <div className="od-mobile-greeting">
        <span>{dashboardLabel}</span>
        <h2>{greeting}, {ownerName || "Admin"}</h2>
      </div>

      <div className="od-mobile-kpis">
        {mobileKpis.map((kpi, index) => (
          <article key={kpi.label} className={`od-mobile-kpi${index === 0 ? " featured" : ""}`}>
            <div className="od-mobile-kpi-top">
              <span className="od-mobile-kpi-icon">{kpi.icon}</span>
              <span className={`od-mobile-delta ${kpi.tone}`}>+ {kpi.delta}</span>
            </div>
            <span className="od-mobile-kpi-label">{kpi.label}</span>
            <strong>{kpi.value}</strong>
          </article>
        ))}
      </div>

      <div className="od-mobile-section-heading">
        <h3>Quick Actions</h3>
      </div>
      <div className="od-mobile-actions">
        {quickActions.map((action) => (
          <button key={action.label} type="button" className={action.primary ? "primary" : ""} onClick={() => onNavigate(action.nav)}>
            <span>{action.icon}</span>
            {action.label}
          </button>
        ))}
      </div>

      <div className="od-mobile-section-heading inline">
        <h3>Recent Activity</h3>
        <button type="button" onClick={() => onNavigate("orders")}>View All</button>
      </div>
      <div className="od-mobile-activity">
        {recentOrders.length === 0 ? (
          <div className="od-mobile-empty">No recent owner-visible orders yet.</div>
        ) : recentOrders.map((order) => (
          <button key={order.id} type="button" className="od-mobile-activity-row" onClick={() => onNavigate("orders")}>
            <span className="od-mobile-activity-icon">[]</span>
            <span className="od-mobile-activity-main">
              <strong>{fmtOrderId(order.id)}</strong>
              <span>{order.table_number ? `Table ${order.table_number}` : "Takeout"} - {order.item_count || 0} items</span>
            </span>
            <span className="od-mobile-activity-side">
              <span className={`od-mobile-status ${statusClass(order.status)}`}>{statusLabel(order.status)}</span>
              <strong>{fmtMoney(order.total_price)}</strong>
            </span>
          </button>
        ))}
      </div>
    </section>
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

function AnalyticsPage({ data, restaurantId }: { data: DashboardData; restaurantId: string }) {
  const [period, setPeriod] = useState<AnalyticsPeriod>("today");
  const [periodReport, setPeriodReport] = useState<OwnerReportData>(emptyReportData());
  const [loadingPeriodReport, setLoadingPeriodReport] = useState(true);
  const [periodReportError, setPeriodReportError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function loadPeriodReport() {
      try {
        setLoadingPeriodReport(true);
        setPeriodReportError(null);
        const { rangeStart, rangeEnd } = getAnalyticsDateRange(period);
        const { data: reportPayload, error } = await supabase.rpc("get_owner_reporting_center", {
          target_restaurant_id: restaurantId,
          range_start: rangeStart,
          range_end: rangeEnd,
        });
        if (error) throw new Error(error.message);
        if (mounted) setPeriodReport(normalizeReportData(reportPayload && typeof reportPayload === "object" ? reportPayload as object : {}));
      } catch (loadError) {
        if (mounted) setPeriodReportError(loadError instanceof Error ? loadError.message : "Could not load revenue report.");
      } finally {
        if (mounted) setLoadingPeriodReport(false);
      }
    }

    void loadPeriodReport();
    return () => { mounted = false; };
  }, [restaurantId, period]);

  const periodSummary = periodReport.summary;
  const periodLabel = period === "today" ? "Today" : period === "week" ? "Week" : "Month";

  return (
    <div className="od-page">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">Performance Overview</h1>
          <p className="od-page-subtitle">Real-time financial tracking for your restaurant branch.</p>
        </div>
        <div className="od-tabs">
          {(["today", "week", "month"] as AnalyticsPeriod[]).map((option) => (
            <button key={option} type="button" className={`od-tab${period === option ? " active" : ""}`} onClick={() => setPeriod(option)}>
              {option === "today" ? "Today" : option === "week" ? "Week" : "Month"}
            </button>
          ))}
        </div>
      </div>

      {periodReportError && <div className="od-error-inline">{periodReportError}</div>}

      <div className="od-kpi-grid analytics">
        <div className="od-kpi-card">
          <div className="od-kpi-top">
            <div className="od-kpi-label">Net Revenue</div>
            <span className="od-kpi-badge up">{periodLabel}</span>
          </div>
          <div className="od-kpi-value">{loadingPeriodReport ? "Loading..." : fmtMoneyK(periodSummary.revenue)}</div>
        </div>
        <div className="od-kpi-card">
          <div className="od-kpi-top">
            <div className="od-kpi-label">Avg Ticket</div>
            <span className="od-kpi-badge neutral">{periodSummary.orders} orders</span>
          </div>
          <div className="od-kpi-value">{loadingPeriodReport ? "Loading..." : fmtMoney(Math.round(periodSummary.average_order_value))}</div>
        </div>
        <div className="od-kpi-card">
          <div className="od-kpi-top">
            <div className="od-kpi-label">Completed Orders</div>
            <span className="od-kpi-badge up">{periodLabel}</span>
          </div>
          <div className="od-kpi-value">{loadingPeriodReport ? "Loading..." : periodSummary.completed_orders}</div>
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
    kitchen_station_created: "Kitchen Station Created",
    kitchen_station_updated: "Kitchen Station Updated",
    kitchen_station_enabled: "Kitchen Station Enabled",
    kitchen_station_disabled: "Kitchen Station Disabled",
    kitchen_station_deleted: "Kitchen Station Deleted",
    kitchen_staff_station_assigned: "Kitchen Staff Assigned To Station",
    kitchen_staff_station_changed: "Kitchen Staff Station Changed",
    menu_station_assigned: "Menu Station Assigned",
    menu_station_changed: "Menu Station Changed",
  };
  return labels[action] ?? action;
}

function isKitchenStationAction(action: StaffActivityLog["action"]) {
  return action.startsWith("kitchen_station_");
}

function isKitchenStaffStationAction(action: StaffActivityLog["action"]) {
  return action.startsWith("kitchen_staff_station_");
}

function isMenuStationAction(action: StaffActivityLog["action"]) {
  return action.startsWith("menu_station_");
}

function staffActivityTargetLabel(entry: StaffActivityLog) {
  if (isKitchenStaffStationAction(entry.action)) {
    const staffName = entry.details.staff_name;
    const oldStation = entry.details.old_station;
    const newStation = entry.details.new_station;
    const nameLabel = typeof staffName === "string" && staffName.trim() ? staffName : entry.target_staff_email || "Kitchen staff";
    const newLabel = typeof newStation === "string" && newStation.trim() ? newStation : "No station";
    if (typeof oldStation === "string" && oldStation.trim()) {
      return `${nameLabel}: ${oldStation} to ${newLabel}`;
    }
    return `${nameLabel}: ${newLabel}`;
  }

  if (isKitchenStationAction(entry.action)) {
    const stationName = entry.details.station_name;
    return typeof stationName === "string" && stationName.trim() ? stationName : "Kitchen station";
  }

  if (isMenuStationAction(entry.action)) {
    const menuItemName = entry.details.menu_item_name;
    const stationName = entry.details.station_name;
    const itemLabel = typeof menuItemName === "string" && menuItemName.trim() ? menuItemName : "Menu item";
    return typeof stationName === "string" && stationName.trim() ? `${itemLabel} - ${stationName}` : itemLabel;
  }

  return entry.target_staff_email || "Staff record";
}

type StaffPageProps = {
  staff: OdStaff[];
  restaurantId: string;
  restaurantName: string;
  stations: OdKitchenStation[];
  onStaffChanged: () => Promise<void>;
};

type StaffModalState =
  | { mode: "create"; member?: undefined }
  | { mode: "view" | "edit"; member: OdStaff }
  | null;

function StaffPage({ staff, restaurantId, restaurantName, stations, onStaffChanged }: StaffPageProps) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "cashier" | "kitchen">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [modal, setModal] = useState<StaffModalState>(null);
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formRole, setFormRole] = useState<"cashier" | "kitchen">("cashier");
  const [formStationId, setFormStationId] = useState("");
  const [activity, setActivity] = useState<StaffActivityLog[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const activeStations = useMemo(
    () => [...stations].filter((station) => station.active).sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name)),
    [stations]
  );
  const stationById = useMemo(() => new Map(stations.map((station) => [station.id, station])), [stations]);

  useEffect(() => {
    if (!modal || modal.mode === "view") return;
    if (formRole !== "kitchen") {
      if (formStationId) setFormStationId("");
      return;
    }
    if (!formStationId && activeStations.length === 1) {
      setFormStationId(activeStations[0].id);
    }
  }, [activeStations, formRole, formStationId, modal]);

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
    setFormStationId(activeStations.length === 1 ? activeStations[0].id : "");
    setModal({ mode: "create" });
  }

  function openMemberModal(mode: "view" | "edit", member: OdStaff) {
    setStaffError(null);
    setNotice(null);
    setFormName(member.display_name);
    setFormEmail(member.email ?? "");
    setFormRole(member.role === "kitchen" ? "kitchen" : "cashier");
    setFormStationId(member.role === "kitchen" ? member.assigned_kitchen_station_id ?? "" : "");
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

    const assignedKitchenStationId = formRole === "kitchen" ? formStationId : null;
    if (formRole === "kitchen" && !assignedKitchenStationId) {
      setStaffError("Choose a kitchen station for kitchen staff.");
      return;
    }

    await runStaffAction(async () => {
      if (modal.mode === "create") {
        const result = await createStaff({
          restaurantId,
          fullName: formName,
          email: formEmail,
          role: formRole,
          assignedKitchenStationId,
        });
        setModal(null);
        return result;
      }

      await updateStaff({
        restaurantId,
        staffId: modal.member.id,
        fullName: formName,
        role: formRole,
        assignedKitchenStationId,
      });
      setModal(null);
      return {};
    }, modal.mode === "create" ? "Staff account created." : "Staff profile updated.");
  }

  const operationalStaff = staff.filter(isOperationalStaff);
  const operationalStaffIds = new Set(operationalStaff.map((member) => member.id));
  const operationalStaffEmails = new Set(operationalStaff.map((member) => member.email).filter((email): email is string => Boolean(email)));
  const staffActivity = activity.filter((entry) =>
    isKitchenStationAction(entry.action)
    || isKitchenStaffStationAction(entry.action)
    || isMenuStationAction(entry.action)
    ||
    (entry.target_staff_id !== null && operationalStaffIds.has(entry.target_staff_id))
    || (entry.target_staff_email !== null && operationalStaffEmails.has(entry.target_staff_email))
  );

  const filtered = operationalStaff.filter((member) => {
    const matchesRole = roleFilter === "all" || member.role === roleFilter;
    const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? member.active : !member.active);
    const haystack = `${member.display_name} ${member.email ?? ""} ${member.role}`.toLowerCase();
    return matchesRole && matchesStatus && haystack.includes(search.trim().toLowerCase());
  });

  const totalStaff = operationalStaff.length;
  const activeStaff = operationalStaff.filter((member) => member.active).length;
  const cashierCount = operationalStaff.filter((member) => member.role === "cashier").length;
  const kitchenCount = operationalStaff.filter((member) => member.role === "kitchen").length;

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
                  <th>Station</th>
                  <th>Status</th>
                  <th>Created Date</th>
                  <th>Last Login</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
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
                      <td>{member.role === "kitchen" && member.assigned_kitchen_station_id ? stationById.get(member.assigned_kitchen_station_id)?.name ?? "Unassigned" : "-"}</td>
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
          <div className="od-table-footer">Showing {filtered.length} of {operationalStaff.length} members</div>
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
              {staffActivity.length === 0 ? (
                <div className="od-empty-sub">No staff activity yet</div>
              ) : (
                staffActivity.slice(0, 8).map((entry) => (
                  <div key={entry.id} className="od-audit-row">
                    <div className="od-audit-action">{staffActionLabel(entry.action)}</div>
                    <div className="od-audit-meta">
                      {staffActivityTargetLabel(entry)} - {fmtTimeAgo(entry.created_at)}
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
              {formRole === "kitchen" && (
                <label>
                  Kitchen Station *
                  <select
                    value={formStationId}
                    onChange={(event) => setFormStationId(event.target.value)}
                    disabled={modal.mode === "view" || isWorking}
                    required
                  >
                    <option value="">Select station</option>
                    {activeStations.map((station) => (
                      <option key={station.id} value={station.id}>{station.name}</option>
                    ))}
                  </select>
                </label>
              )}

              {modal.mode !== "create" && (
                <div className="od-staff-detail-grid">
                  <span>Status</span>
                  <strong>{modal.member.active ? "Active" : "Inactive"}</strong>
                  <span>Created</span>
                  <strong>{new Date(modal.member.created_at).toLocaleDateString()}</strong>
                  <span>Last Active</span>
                  <strong>{fmtLastActive(modal.member.last_login_at)}</strong>
                  <span>Station</span>
                  <strong>{modal.member.role === "kitchen" && modal.member.assigned_kitchen_station_id ? stationById.get(modal.member.assigned_kitchen_station_id)?.name ?? "Unassigned" : "-"}</strong>
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

type StationModalState =
  | { mode: "create"; station?: undefined }
  | { mode: "edit"; station: OdKitchenStation }
  | null;

const KITCHEN_STATION_ICONS = [
  { value: "MK", label: "Main Kitchen" },
  { value: "HD", label: "Hot Drinks" },
  { value: "JB", label: "Juice Bar" },
  { value: "BK", label: "Bakery" },
  { value: "DS", label: "Dessert" },
  { value: "GR", label: "Grill" },
  { value: "TF", label: "Traditional Food" },
  { value: "BR", label: "Bar" },
];

const KITCHEN_STATION_COLORS = ["#0f766e", "#2563eb", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#16a34a", "#475569"];

function KitchenStationsPage({
  restaurantId,
  stations,
  onStationsChanged,
}: {
  restaurantId: string;
  stations: OdKitchenStation[];
  onStationsChanged: () => Promise<void>;
}) {
  const [modal, setModal] = useState<StationModalState>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formColor, setFormColor] = useState(KITCHEN_STATION_COLORS[0]);
  const [formIcon, setFormIcon] = useState(KITCHEN_STATION_ICONS[0].value);
  const [formPriority, setFormPriority] = useState("100");
  const [formActive, setFormActive] = useState(true);
  const [stationError, setStationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const sortedStations = useMemo(
    () => [...stations].sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name)),
    [stations]
  );
  const activeCount = sortedStations.filter((station) => station.active).length;

  function openCreateModal() {
    setStationError(null);
    setNotice(null);
    setFormName("");
    setFormDescription("");
    setFormColor(KITCHEN_STATION_COLORS[0]);
    setFormIcon(KITCHEN_STATION_ICONS[0].value);
    setFormPriority(String((sortedStations[sortedStations.length - 1]?.priority ?? 0) + 10));
    setFormActive(true);
    setModal({ mode: "create" });
  }

  function openEditModal(station: OdKitchenStation) {
    setStationError(null);
    setNotice(null);
    setFormName(station.name);
    setFormDescription(station.description ?? "");
    setFormColor(station.display_color);
    setFormIcon(station.icon);
    setFormPriority(String(station.priority));
    setFormActive(station.active);
    setModal({ mode: "edit", station });
  }

  async function submitStation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal) return;

    try {
      setSaving(true);
      setStationError(null);
      setNotice(null);
      const priority = Number(formPriority);
      if (!formName.trim()) throw new Error("Station name is required.");
      if (!Number.isInteger(priority) || priority < 0 || priority > 10000) throw new Error("Priority must be a whole number from 0 to 10000.");

      const { error } = await supabase.rpc("manage_kitchen_station", {
        target_restaurant_id: restaurantId,
        action: modal.mode === "create" ? "create" : "update",
        station_id: modal.mode === "edit" ? modal.station.id : null,
        station_name: formName.trim(),
        station_description: formDescription.trim() || null,
        station_display_color: formColor,
        station_icon: formIcon,
        station_priority: priority,
        station_active: formActive,
      });
      if (error) throw new Error(error.message);
      setNotice(modal.mode === "create" ? "Kitchen station created." : "Kitchen station updated.");
      setModal(null);
      await onStationsChanged();
    } catch (actionError) {
      setStationError(actionError instanceof Error ? actionError.message : "Kitchen station action failed.");
    } finally {
      setSaving(false);
    }
  }

  async function runStationAction(station: OdKitchenStation, action: "enable" | "disable" | "delete") {
    if (action === "delete" && !window.confirm(`Delete ${station.name}? This cannot be undone.`)) return;

    try {
      setWorkingId(`${action}:${station.id}`);
      setStationError(null);
      setNotice(null);
      const { error } = await supabase.rpc("manage_kitchen_station", {
        target_restaurant_id: restaurantId,
        action,
        station_id: station.id,
        station_name: null,
        station_description: null,
        station_display_color: station.display_color,
        station_icon: station.icon,
        station_priority: station.priority,
        station_active: station.active,
      });
      if (error) throw new Error(error.message);
      setNotice(action === "delete" ? "Kitchen station deleted." : action === "enable" ? "Kitchen station enabled." : "Kitchen station disabled.");
      await onStationsChanged();
    } catch (actionError) {
      setStationError(actionError instanceof Error ? actionError.message : "Kitchen station action failed.");
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <div className="od-page">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">Kitchen Stations</h1>
          <p className="od-page-subtitle">Create and manage kitchen station foundations for future routing.</p>
        </div>
        <div className="od-header-actions">
          <button className="od-btn-primary" type="button" onClick={openCreateModal}>Create Station</button>
        </div>
      </div>

      {(stationError || notice) && (
        <div className={stationError ? "od-error-inline" : "od-success-inline"}>
          {stationError || notice}
        </div>
      )}

      <section className="od-kpi-grid">
        <div className="od-kpi-card">
          <div className="od-kpi-label">Total Stations</div>
          <div className="od-kpi-value">{sortedStations.length}</div>
        </div>
        <div className="od-kpi-card">
          <div className="od-kpi-label">Active Stations</div>
          <div className="od-kpi-value">{activeCount}</div>
        </div>
        <div className="od-kpi-card">
          <div className="od-kpi-label">Assigned Menu Items</div>
          <div className="od-kpi-value">{sortedStations.reduce((sum, station) => sum + station.assigned_menu_items, 0)}</div>
        </div>
      </section>

      <section className="od-station-grid">
        {sortedStations.length === 0 ? (
          <div className="od-card">
            <div className="od-empty">
              <div className="od-empty-msg">No kitchen stations yet</div>
              <div className="od-empty-sub">Main Kitchen will be created automatically.</div>
            </div>
          </div>
        ) : sortedStations.map((station) => {
          const busy = workingId?.endsWith(station.id) || saving;
          const deleteDisabled = busy;
          return (
            <article key={station.id} className={`od-station-card ${station.active ? "active" : "inactive"}`}>
              <div className="od-station-head">
                <div className="od-station-icon" style={{ background: station.display_color }}>{station.icon}</div>
                <div className="od-station-title">
                  <h2>{station.name}</h2>
                  <span className={`od-status-badge ${station.active ? "paid" : "pending"}`}>{station.active ? "Active" : "Inactive"}</span>
                </div>
              </div>
              {station.description ? <p className="od-station-desc">{station.description}</p> : <p className="od-station-desc muted">No description added.</p>}
              <div className="od-station-meta">
                <span><strong>{station.priority}</strong> Priority</span>
                <span><strong>{station.assigned_menu_items}</strong> Menu Items</span>
              </div>
              <div className="od-row-actions">
                <button className="od-btn-ghost compact" type="button" onClick={() => openEditModal(station)} disabled={busy}>Edit</button>
                <button className="od-btn-ghost compact" type="button" onClick={() => void runStationAction(station, station.active ? "disable" : "enable")} disabled={busy}>
                  {station.active ? "Disable" : "Enable"}
                </button>
                <button
                  className="od-btn-ghost compact danger"
                  type="button"
                  onClick={() => void runStationAction(station, "delete")}
                  disabled={deleteDisabled}
                  title={station.assigned_menu_items > 0 ? "This station is currently in use." : "Delete station"}
                >
                  Delete
                </button>
              </div>
              {station.assigned_menu_items > 0 && <div className="od-station-hint">This station is currently in use.</div>}
            </article>
          );
        })}
      </section>

      {modal && (
        <div className="od-modal-backdrop" role="presentation">
          <div className="od-modal" role="dialog" aria-modal="true" aria-label="Kitchen station details">
            <div className="od-modal-header">
              <div>
                <div className="od-card-title">{modal.mode === "create" ? "Create Station" : "Edit Station"}</div>
                <div className="od-card-subtitle">Station names must be unique inside this restaurant.</div>
              </div>
              <button className="od-icon-btn" type="button" onClick={() => setModal(null)} aria-label="Close">x</button>
            </div>
            <form className="od-staff-form" onSubmit={submitStation}>
              <label>
                Station Name
                <input value={formName} onChange={(event) => setFormName(event.target.value)} disabled={saving} required maxLength={80} />
              </label>
              <label>
                Description
                <textarea value={formDescription} onChange={(event) => setFormDescription(event.target.value)} disabled={saving} rows={3} maxLength={240} />
              </label>
              <label>
                Icon
                <select value={formIcon} onChange={(event) => setFormIcon(event.target.value)} disabled={saving}>
                  {KITCHEN_STATION_ICONS.map((icon) => <option key={icon.value} value={icon.value}>{icon.value} - {icon.label}</option>)}
                </select>
              </label>
              <label>
                Priority
                <input type="number" min="0" max="10000" step="1" value={formPriority} onChange={(event) => setFormPriority(event.target.value)} disabled={saving} required />
              </label>
              <div className="od-color-field">
                <span>Display Color</span>
                <div className="od-color-options">
                  {KITCHEN_STATION_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={formColor === color ? "selected" : ""}
                      style={{ background: color }}
                      onClick={() => setFormColor(color)}
                      disabled={saving}
                      aria-label={`Use color ${color}`}
                    />
                  ))}
                  <input type="color" value={formColor} onChange={(event) => setFormColor(event.target.value)} disabled={saving} aria-label="Custom station color" />
                </div>
              </div>
              <label className="od-check-row">
                <input type="checkbox" checked={formActive} onChange={(event) => setFormActive(event.target.checked)} disabled={saving} />
                Active
              </label>
              <div className="od-modal-actions">
                <button type="button" className="od-btn-ghost" onClick={() => setModal(null)} disabled={saving}>Cancel</button>
                <button type="submit" className="od-btn-primary" disabled={saving}>{saving ? "Saving..." : "Save Station"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

type MenuPageProps = {
  restaurantId: string;
  items: OdMenuItem[];
  categories: OdCategory[];
  stations: OdKitchenStation[];
  topItems: { name: string; quantity: number; revenue: number }[];
  onMenuChanged: () => Promise<void>;
};

function getCategoryName(categories: OdCategory[], categoryId: string) {
  return categories.find((category) => category.id === categoryId)?.name ?? "Uncategorized";
}

function getStationName(stations: OdKitchenStation[], stationId: string | null) {
  return stations.find((station) => station.id === stationId)?.name ?? "Main Kitchen";
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

function formatOptionalNutritionInput(value: number | null | undefined) {
  return value === null || typeof value === "undefined" ? "" : String(value);
}

function parseOptionalNutritionNumber(label: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be zero or greater.`);
  return parsed;
}

function parseOptionalNutritionInteger(label: string, value: string) {
  const parsed = parseOptionalNutritionNumber(label, value);
  if (parsed === null) return null;
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be a whole number.`);
  return parsed;
}

function parseOptionalPositiveInteger(label: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} must be a whole number.`);
  return parsed;
}

function formatIngredientInput(ingredients: string[] | null | undefined) {
  return (ingredients ?? []).join("\n");
}

function parseIngredientInput(value: string) {
  const ingredients = Array.from(new Set(
    value
      .split(/\r?\n|,/)
      .map((ingredient) => ingredient.trim())
      .filter((ingredient) => ingredient.length > 0)
  ));

  return ingredients.length > 0 ? ingredients : null;
}

function MenuPage({ restaurantId, items, categories, stations, topItems, onMenuChanged }: MenuPageProps) {
  const menuUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [modal, setModal] = useState<MenuModalState>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState<"all" | "available" | "unavailable">("all");
  const [stationFilter, setStationFilter] = useState("all");
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPreparationTime, setFormPreparationTime] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formCategoryId, setFormCategoryId] = useState("");
  const [formNewCategory, setFormNewCategory] = useState("");
  const [formStationId, setFormStationId] = useState("");
  const [formAvailable, setFormAvailable] = useState(true);
  const [formImageFile, setFormImageFile] = useState<File | null>(null);
  const [formImageUrl, setFormImageUrl] = useState("");
  const [formIngredients, setFormIngredients] = useState("");
  const [formCalories, setFormCalories] = useState("");
  const [formProteinG, setFormProteinG] = useState("");
  const [formCarbohydratesG, setFormCarbohydratesG] = useState("");
  const [formFatG, setFormFatG] = useState("");
  const [formFiberG, setFormFiberG] = useState("");
  const [formSugarG, setFormSugarG] = useState("");
  const [formSodiumMg, setFormSodiumMg] = useState("");
  const [menuUploads, setMenuUploads] = useState<OdMenuUpload[]>([]);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const activeStations = useMemo(
    () => [...stations].filter((station) => station.active).sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name)),
    [stations]
  );
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch = !query
        || item.name.toLowerCase().includes(query)
        || (item.description ?? "").toLowerCase().includes(query);
      const matchesCategory = categoryFilter === "all" || item.category_id === categoryFilter;
      const matchesAvailability = availabilityFilter === "all"
        || (availabilityFilter === "available" ? item.available : !item.available);
      const matchesStation = stationFilter === "all" || item.kitchen_station_id === stationFilter;
      return matchesSearch && matchesCategory && matchesAvailability && matchesStation;
    });
  }, [availabilityFilter, categoryFilter, items, search, stationFilter]);

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
    setFormPreparationTime("");
    setFormPrice("");
    setFormCategoryId(categories[0]?.id ?? "");
    setFormNewCategory(categories.length === 0 ? "Main Menu" : "");
    setFormStationId("");
    setFormAvailable(true);
    setFormImageFile(null);
    setFormImageUrl("");
    setFormIngredients("");
    setFormCalories("");
    setFormProteinG("");
    setFormCarbohydratesG("");
    setFormFatG("");
    setFormFiberG("");
    setFormSugarG("");
    setFormSodiumMg("");
    setModal({ mode: "create" });
  }

  function openEditModal(item: OdMenuItem) {
    setMenuError(null);
    setNotice(null);
    setFormName(item.name);
    setFormDescription(item.description ?? "");
    setFormPreparationTime(item.preparation_time_minutes === null || typeof item.preparation_time_minutes === "undefined" ? "" : String(item.preparation_time_minutes));
    setFormPrice(String(item.price));
    setFormCategoryId(item.category_id);
    setFormNewCategory("");
    setFormStationId(item.kitchen_station_id ?? activeStations[0]?.id ?? "");
    setFormAvailable(item.available);
    setFormImageFile(null);
    setFormImageUrl(item.image_url ?? "");
    setFormIngredients(formatIngredientInput(item.ingredients));
    setFormCalories(formatOptionalNutritionInput(item.calories));
    setFormProteinG(formatOptionalNutritionInput(item.protein_g));
    setFormCarbohydratesG(formatOptionalNutritionInput(item.carbohydrates_g));
    setFormFatG(formatOptionalNutritionInput(item.fat_g));
    setFormFiberG(formatOptionalNutritionInput(item.fiber_g));
    setFormSugarG(formatOptionalNutritionInput(item.sugar_g));
    setFormSodiumMg(formatOptionalNutritionInput(item.sodium_mg));
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
      const ingredients = parseIngredientInput(formIngredients);
      const preparationTimeMinutes = parseOptionalPositiveInteger("Preparation time", formPreparationTime);
      const calories = parseOptionalNutritionInteger("Calories", formCalories);
      const proteinG = parseOptionalNutritionNumber("Protein", formProteinG);
      const carbohydratesG = parseOptionalNutritionNumber("Carbs", formCarbohydratesG);
      const fatG = parseOptionalNutritionNumber("Fat", formFatG);
      const fiberG = parseOptionalNutritionNumber("Fiber", formFiberG);
      const sugarG = parseOptionalNutritionNumber("Sugar", formSugarG);
      const sodiumMg = parseOptionalNutritionNumber("Sodium", formSodiumMg);
      const payload = {
        restaurant_id: restaurantId,
        name,
        description: formDescription.trim() || null,
        preparation_time_minutes: preparationTimeMinutes,
        price,
        category_id: categoryId,
        kitchen_station_id: formStationId || null,
        available: formAvailable,
        image_url: imageUrl,
        ingredients,
        calories,
        protein_g: proteinG,
        carbohydrates_g: carbohydratesG,
        fat_g: fatG,
        fiber_g: fiberG,
        sugar_g: sugarG,
        sodium_mg: sodiumMg,
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
      const { data, error } = await supabase.rpc("archive_or_delete_menu_item", {
        target_restaurant_id: restaurantId,
        target_menu_item_id: item.id,
      });
      if (error) throw new Error(error.message);
      const action = data && typeof data === "object" && "action" in data ? String((data as { action?: unknown }).action) : "deleted";
      setNotice(action === "archived" ? "Menu item archived because it has order history." : "Menu item deleted.");
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
          <div className="od-staff-filters">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search menu" aria-label="Search menu items" />
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filter menu by category">
              <option value="all">All Categories</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <select value={availabilityFilter} onChange={(event) => setAvailabilityFilter(event.target.value as typeof availabilityFilter)} aria-label="Filter menu by availability">
              <option value="all">All Availability</option>
              <option value="available">Available</option>
              <option value="unavailable">Unavailable</option>
            </select>
            <select value={stationFilter} onChange={(event) => setStationFilter(event.target.value)} aria-label="Filter menu by kitchen station">
              <option value="all">All Stations</option>
              {activeStations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
            </select>
          </div>
        </div>
        <div className="od-table-wrap">
          <table className="od-table">
            <thead>
              <tr>
                <th>Item Name</th>
                <th>Category</th>
                <th>Station</th>
                <th>Prep Time</th>
                <th>Price</th>
                <th>Availability</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="od-empty">
                      <div className="od-empty-icon">--</div>
                      <div className="od-empty-msg">{items.length === 0 ? "No menu items yet" : "No menu items match these filters"}</div>
                      <div className="od-empty-sub">{items.length === 0 ? "Add your first item or upload a menu photo" : "Adjust search, category, availability, or station"}</div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
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
                    <td><span className="od-station-badge">{getStationName(stations, item.kitchen_station_id)}</span></td>
                    <td>{formatPreparationEstimate(item.preparation_time_minutes) ?? "Not set"}</td>
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
        <div className="od-table-footer">Showing {filteredItems.length} of {items.length} items</div>
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
                Ingredients
                <textarea value={formIngredients} onChange={(event) => setFormIngredients(event.target.value)} disabled={isWorking} rows={4} placeholder={"Mozzarella\nTomato Sauce\nFresh Basil"} />
              </label>
              <label>
                Preparation Time (minutes)
                <input type="number" min="0" step="1" value={formPreparationTime} onChange={(event) => setFormPreparationTime(event.target.value)} disabled={isWorking} placeholder="Optional" />
              </label>
              <label>
                Price
                <input type="number" min="0" step="0.01" value={formPrice} onChange={(event) => setFormPrice(event.target.value)} disabled={isWorking} required />
              </label>
              <label>
                Calories
                <input type="number" min="0" step="1" value={formCalories} onChange={(event) => setFormCalories(event.target.value)} disabled={isWorking} placeholder="Optional" />
              </label>
              <label>
                Protein (g)
                <input type="number" min="0" step="0.1" value={formProteinG} onChange={(event) => setFormProteinG(event.target.value)} disabled={isWorking} placeholder="Optional" />
              </label>
              <label>
                Carbs (g)
                <input type="number" min="0" step="0.1" value={formCarbohydratesG} onChange={(event) => setFormCarbohydratesG(event.target.value)} disabled={isWorking} placeholder="Optional" />
              </label>
              <label>
                Fat (g)
                <input type="number" min="0" step="0.1" value={formFatG} onChange={(event) => setFormFatG(event.target.value)} disabled={isWorking} placeholder="Optional" />
              </label>
              <label>
                Fiber (g)
                <input type="number" min="0" step="0.1" value={formFiberG} onChange={(event) => setFormFiberG(event.target.value)} disabled={isWorking} placeholder="Optional" />
              </label>
              <label>
                Sugar (g)
                <input type="number" min="0" step="0.1" value={formSugarG} onChange={(event) => setFormSugarG(event.target.value)} disabled={isWorking} placeholder="Optional" />
              </label>
              <label>
                Sodium (mg)
                <input type="number" min="0" step="0.1" value={formSodiumMg} onChange={(event) => setFormSodiumMg(event.target.value)} disabled={isWorking} placeholder="Optional" />
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
              <label>
                Kitchen Station
                <select value={formStationId} onChange={(event) => setFormStationId(event.target.value)} disabled={isWorking}>
                  <option value="">Auto assign</option>
                  {activeStations.map((station) => (
                    <option key={station.id} value={station.id}>{station.name}</option>
                  ))}
                </select>
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

function getOrderingUrl(qrPath: string) {
  if (!qrPath) return "";
  try {
    return getQrAppUrl(qrPath);
  } catch {
    return "";
  }
}

type PrintableQrTable = {
  table: RestaurantTable;
  orderingUrl: string;
};

function safeFilename(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "qr-code";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dataUrlToBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function drawRoundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  if (!src) return null;
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

async function createQrCardCanvas({
  restaurantName,
  logoUrl,
  table,
  orderingUrl,
}: {
  restaurantName: string;
  logoUrl: string;
  table: RestaurantTable;
  orderingUrl: string;
}) {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 1200;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available.");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#d8dee8";
  context.lineWidth = 6;
  drawRoundRect(context, 48, 48, 804, 1104, 28);
  context.stroke();

  const logo = await loadImage(logoUrl);
  context.save();
  drawRoundRect(context, 370, 96, 160, 160, 22);
  context.clip();
  if (logo) {
    context.drawImage(logo, 370, 96, 160, 160);
  } else {
    context.fillStyle = "#0f766e";
    context.fillRect(370, 96, 160, 160);
    context.fillStyle = "#ffffff";
    context.font = "800 46px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(restaurantName.slice(0, 2).toUpperCase(), 450, 176);
  }
  context.restore();

  context.fillStyle = "#0f172a";
  context.font = "800 46px Arial";
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.fillText(restaurantName, 450, 330, 760);
  context.fillStyle = "#64748b";
  context.font = "800 30px Arial";
  context.fillText(`Table ${table.table_number}`, 450, 388);

  const qrDataUrl = await QRCode.toDataURL(orderingUrl, { width: 560, margin: 1 });
  const qrImage = await loadImage(qrDataUrl);
  if (!qrImage) throw new Error("QR image could not be generated.");
  context.drawImage(qrImage, 170, 450, 560, 560);

  context.fillStyle = "#0f172a";
  context.font = "800 38px Arial";
  context.fillText("Scan to Order", 450, 1080);
  context.fillStyle = "#64748b";
  context.font = "600 22px Arial";
  context.fillText(orderingUrl, 450, 1124, 760);

  return canvas;
}

function buildPdfFromJpegs(images: { bytes: Uint8Array; width: number; height: number }[]) {
  const objects: (string | Uint8Array)[] = [];
  const addObject = (content: string | Uint8Array) => {
    objects.push(content);
    return objects.length;
  };
  const pageIds: number[] = [];
  const pagesId = 2;
  addObject("<< /Type /Catalog /Pages 2 0 R >>");
  addObject("");

  images.forEach((image) => {
    const imageId = objects.length + 2;
    const contentId = objects.length + 3;
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im${imageId} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
    const imageHeader = `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`;
    const imageFooter = "\nendstream";
    const imageObject = new Uint8Array(imageHeader.length + image.bytes.length + imageFooter.length);
    imageObject.set(new TextEncoder().encode(imageHeader), 0);
    imageObject.set(image.bytes, imageHeader.length);
    imageObject.set(new TextEncoder().encode(imageFooter), imageHeader.length + image.bytes.length);
    addObject(imageObject);
    const contentStream = `q\n540 0 0 720 36 36 cm\n/Im${imageId} Do\nQ`;
    addObject(`<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`);
  });

  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  const chunks: Uint8Array[] = [new TextEncoder().encode("%PDF-1.4\n")];
  const offsets: number[] = [0];
  let length = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const header = new TextEncoder().encode(`${index + 1} 0 obj\n`);
    const body = typeof object === "string" ? new TextEncoder().encode(object) : object;
    const footer = new TextEncoder().encode("\nendobj\n");
    chunks.push(header, body, footer);
    length += header.length + body.length + footer.length;
  });
  const xrefOffset = length;
  const xref = [
    `xref\n0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    `startxref\n${xrefOffset}`,
    "%%EOF",
  ].join("\n");
  chunks.push(new TextEncoder().encode(xref));
  const blobParts = chunks.map((chunk) => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer);
  return new Blob(blobParts, { type: "application/pdf" });
}

function QrTablesPage({
  restaurantId,
  restaurantName,
  restaurantSlug,
  logoUrl,
  orders,
  tables,
  onTableChanged,
}: {
  restaurantId: string;
  restaurantName: string;
  restaurantSlug: string;
  logoUrl: string;
  orders: OdOrder[];
  tables: RestaurantTable[];
  onTableChanged: (table: RestaurantTable) => void;
}) {
  const [qrCodes, setQrCodes] = useState<Record<string, string>>({});
  const [qrStats, setQrStats] = useState<Record<string, RestaurantTableQrStats>>({});
  const [previewTable, setPreviewTable] = useState<RestaurantTable | null>(null);
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [workingTableId, setWorkingTableId] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const activeTableOrders = orders.filter((order) => ACTIVE_ORDER_STATUSES.includes(order.status));
  const activeTables = new Set(activeTableOrders.map((order) => order.table_number).filter(Boolean));
  const todayStart = startOfTodayIso();
  const rows = tables.map((restaurantTable) => {
    const number = String(restaurantTable.table_number);
    const activeOrder = activeTableOrders.find((order) => order.table_number === number);
    return {
      table: restaurantTable,
      occupied: Boolean(activeOrder),
      ordersToday: qrStats[restaurantTable.id]?.orders_today ?? orders.filter((order) => order.table_number === number && order.created_at >= todayStart).length,
      lastScanAt: qrStats[restaurantTable.id]?.last_scan_at ?? null,
      lastOrderAt: qrStats[restaurantTable.id]?.last_order_at ?? orders.find((order) => order.table_number === number)?.created_at ?? null,
      scanCount: qrStats[restaurantTable.id]?.scan_count ?? null,
      orderingUrl: getOrderingUrl(restaurantTable.qr_url || restaurantTable.qr_path),
    };
  });

  const selectedRows = rows.filter((row) => selectedTableIds.includes(row.table.id));

  useEffect(() => {
    let mounted = true;
    async function generateQrCodes() {
      const pairs = await Promise.all(
        tables.map(async (table) => {
          const url = getOrderingUrl(table.qr_url || table.qr_path);
          if (!url) return [table.id, ""] as const;
          const dataUrl = await QRCode.toDataURL(url, { width: 96, margin: 1 });
          return [table.id, dataUrl] as const;
        })
      );
      if (mounted) setQrCodes(Object.fromEntries(pairs));
    }
    void generateQrCodes();
    return () => { mounted = false; };
  }, [tables]);

  useEffect(() => {
    let mounted = true;
    async function loadQrStats() {
      try {
        const { data, error } = await supabase.rpc("get_owner_table_qr_stats", {
          target_restaurant_id: restaurantId,
        });
        if (error) throw new Error(error.message);
        const statRows = Array.isArray(data) ? data : [];
        const normalizedStats = statRows.reduce<Record<string, RestaurantTableQrStats>>((accumulator, row) => {
          if (!row || typeof row !== "object") return accumulator;
          const payload = row as Record<string, unknown>;
          const tableId = typeof payload.table_id === "string" ? payload.table_id : "";
          if (!tableId) return accumulator;
          accumulator[tableId] = {
            table_id: tableId,
            orders_today: Number(payload.orders_today ?? 0),
            last_scan_at: typeof payload.last_scan_at === "string" ? payload.last_scan_at : null,
            last_order_at: typeof payload.last_order_at === "string" ? payload.last_order_at : null,
            scan_count: payload.scan_count === null || typeof payload.scan_count === "undefined" ? null : Number(payload.scan_count),
          };
          return accumulator;
        }, {});
        if (mounted) setQrStats(normalizedStats);
      } catch (statsError) {
        if (mounted) setQrError(statsError instanceof Error ? statsError.message : "Could not load QR statistics.");
      }
    }
    void loadQrStats();
    return () => { mounted = false; };
  }, [restaurantId, tables, orders]);

  async function regenerateQr(table: RestaurantTable) {
    try {
      setWorkingTableId(table.id);
      setQrError(null);
      setNotice(null);
      const { data, error } = await supabase.rpc("regenerate_restaurant_table_qr", {
        target_restaurant_id: restaurantId,
        target_table_id: table.id,
      });
      if (error) throw new Error(error.message);
      const updatedTable = normalizeRestaurantTable(data as Record<string, unknown>);
      onTableChanged(updatedTable);
      setPreviewTable((current) => current?.id === updatedTable.id ? updatedTable : current);
      setNotice(`QR regenerated for ${updatedTable.label}.`);
    } catch (regenerateError) {
      setQrError(regenerateError instanceof Error ? regenerateError.message : "Could not regenerate QR code.");
    } finally {
      setWorkingTableId(null);
    }
  }

  async function setTableActive(table: RestaurantTable, active: boolean) {
    try {
      setWorkingTableId(table.id);
      setQrError(null);
      setNotice(null);
      const { data, error } = await supabase.rpc("set_restaurant_table_active", {
        target_restaurant_id: restaurantId,
        target_table_id: table.id,
        requested_active: active,
      });
      if (error) throw new Error(error.message);
      const updatedTable = normalizeRestaurantTable(data as Record<string, unknown>);
      onTableChanged(updatedTable);
      setPreviewTable((current) => current?.id === updatedTable.id ? updatedTable : current);
      setNotice(`${updatedTable.label} ${active ? "enabled" : "disabled"}.`);
    } catch (activeError) {
      setQrError(activeError instanceof Error ? activeError.message : "Could not update table status.");
    } finally {
      setWorkingTableId(null);
    }
  }

  const previewUrl = previewTable ? getOrderingUrl(previewTable.qr_url || previewTable.qr_path) : "";
  const previewPrintable = previewTable && previewUrl ? { table: previewTable, orderingUrl: previewUrl } : null;
  const allSelected = rows.length > 0 && rows.every((row) => selectedTableIds.includes(row.table.id));

  function toggleSelectedTable(tableId: string) {
    setSelectedTableIds((previous) => previous.includes(tableId) ? previous.filter((id) => id !== tableId) : [...previous, tableId]);
  }

  function toggleAllSelected() {
    setSelectedTableIds(allSelected ? [] : rows.map((row) => row.table.id));
  }

  async function downloadQrPng(printable: PrintableQrTable) {
    const canvas = await createQrCardCanvas({ restaurantName, logoUrl, table: printable.table, orderingUrl: printable.orderingUrl });
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(`${safeFilename(restaurantName)}-table-${printable.table.table_number}-qr.png`, blob);
    }, "image/png");
  }

  async function downloadQrSvg(printable: PrintableQrTable) {
    const qrSvg = await QRCode.toString(printable.orderingUrl, { type: "svg", width: 360, margin: 1 });
    const escapedName = escapeHtml(restaurantName);
    const escapedUrl = escapeHtml(printable.orderingUrl);
    const logoMarkup = logoUrl
      ? `<image href="${escapeHtml(logoUrl)}" x="210" y="34" width="80" height="80" preserveAspectRatio="xMidYMid slice" />`
      : `<rect x="210" y="34" width="80" height="80" rx="12" fill="#0f766e" /><text x="250" y="84" text-anchor="middle" font-family="Arial" font-size="22" font-weight="800" fill="#fff">${escapeHtml(restaurantName.slice(0, 2).toUpperCase())}</text>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700">
<rect width="500" height="700" rx="18" fill="#fff"/>
<rect x="20" y="20" width="460" height="660" rx="18" fill="none" stroke="#d8dee8" stroke-width="3"/>
${logoMarkup}
<text x="250" y="158" text-anchor="middle" font-family="Arial" font-size="28" font-weight="800" fill="#0f172a">${escapedName}</text>
<text x="250" y="196" text-anchor="middle" font-family="Arial" font-size="18" font-weight="800" fill="#64748b">Table ${printable.table.table_number}</text>
<g transform="translate(70 230)">${qrSvg.replace(/<\?xml[^>]*>/, "").replace(/<svg[^>]*>/, "").replace("</svg>", "")}</g>
<text x="250" y="626" text-anchor="middle" font-family="Arial" font-size="26" font-weight="800" fill="#0f172a">Scan to Order</text>
<text x="250" y="658" text-anchor="middle" font-family="Arial" font-size="11" font-weight="600" fill="#64748b">${escapedUrl}</text>
</svg>`;
    downloadBlob(`${safeFilename(restaurantName)}-table-${printable.table.table_number}-qr.svg`, new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  }

  async function downloadQrPdf(printables: PrintableQrTable[], filename: string) {
    if (printables.length === 0) return;
    const images = await Promise.all(printables.map(async (printable) => {
      const canvas = await createQrCardCanvas({ restaurantName, logoUrl, table: printable.table, orderingUrl: printable.orderingUrl });
      return { bytes: dataUrlToBytes(canvas.toDataURL("image/jpeg", 0.92)), width: canvas.width, height: canvas.height };
    }));
    downloadBlob(filename, buildPdfFromJpegs(images));
  }

  async function printQrCards(printables: PrintableQrTable[]) {
    if (printables.length === 0) return;
    const cards = await Promise.all(printables.map(async (printable) => {
      const qrDataUrl = await QRCode.toDataURL(printable.orderingUrl, { width: 320, margin: 1 });
      const logo = logoUrl
        ? `<img class="qr-logo" src="${escapeHtml(logoUrl)}" alt="" />`
        : `<div class="qr-logo fallback">${escapeHtml(restaurantName.slice(0, 2).toUpperCase())}</div>`;
      return `<section class="qr-print-card">
${logo}
<h1>${escapeHtml(restaurantName)}</h1>
<h2>Table ${printable.table.table_number}</h2>
<img class="qr-code" src="${qrDataUrl}" alt="" />
<p class="scan">Scan to Order</p>
</section>`;
    }));
    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) {
      setQrError("Could not open the print window. Please allow pop-ups for this site.");
      return;
    }
    printWindow.document.write(`<!doctype html><html><head><title>${escapeHtml(restaurantName)} QR Codes</title><style>
body{margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a}.qr-print-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;padding:24px}.qr-print-card{break-inside:avoid;page-break-inside:avoid;background:#fff;border:1px solid #d8dee8;border-radius:14px;padding:28px;text-align:center;display:grid;justify-items:center;gap:10px}.qr-logo{width:72px;height:72px;border-radius:10px;object-fit:cover;border:1px solid #d8dee8}.qr-logo.fallback{display:grid;place-items:center;background:#0f766e;color:#fff;font-size:22px;font-weight:800}.qr-code{width:280px;height:280px}h1{font-size:24px;line-height:1.15;margin:0}h2{font-size:18px;color:#64748b;margin:0}.scan{font-size:24px;font-weight:800;margin:0}@media print{body{background:#fff}.qr-print-grid{padding:0;grid-template-columns:repeat(2,1fr)}.qr-print-card{border:0;min-height:46vh;page-break-inside:avoid}}@page{size:A4;margin:12mm}
</style></head><body><main class="qr-print-grid">${cards.join("")}</main><script>window.addEventListener('load',()=>{const images=[...document.images];Promise.all(images.map((image)=>image.complete?Promise.resolve():new Promise((resolve)=>{image.onload=resolve;image.onerror=resolve;}))).then(()=>setTimeout(()=>window.print(),100));});<\/script></body></html>`);
    printWindow.document.close();
  }

  return (
    <div className="od-page">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">QR & Table Management</h1>
          <p className="od-page-subtitle">Restaurant floor management for {restaurantName}</p>
        </div>
        <div className="od-header-actions">
          <button className="od-btn-ghost" type="button" onClick={() => void printQrCards(selectedRows)} disabled={selectedRows.length === 0}>Print Selected</button>
          <button className="od-btn-primary" type="button" onClick={() => void printQrCards(rows)}>Print Entire Restaurant</button>
        </div>
      </div>
      <div className="od-kpi-grid analytics">
        <div className="od-kpi-card">
          <div className="od-kpi-label">Occupied Tables</div>
          <div className="od-kpi-value">{activeTables.size}</div>
        </div>
        <div className="od-kpi-card">
          <div className="od-kpi-label">Total Tables</div>
          <div className="od-kpi-value">{tables.length}</div>
        </div>
        <div className="od-kpi-card">
          <div className="od-kpi-label">Disabled Tables</div>
          <div className="od-kpi-value">{tables.filter((table) => !table.active).length}</div>
        </div>
      </div>
      {(qrError || notice) && <div className={qrError ? "od-error-inline" : "od-success-inline"}>{qrError || notice}</div>}
      <div className="od-card">
        <div className="od-card-header">
          <div>
            <div className="od-card-title">Restaurant Tables</div>
            <div className="od-card-subtitle">Owner QR controls for the existing /r/{restaurantSlug || ":slug"}/order route.</div>
          </div>
        </div>
        <div className="od-table-wrap">
          <table className="od-table od-qr-table">
            <thead>
              <tr>
                <th><input type="checkbox" checked={allSelected} onChange={toggleAllSelected} aria-label="Select all table QR codes" /></th>
                <th>Table Number</th>
                <th>Status</th>
                <th>Occupancy</th>
                <th>QR Preview</th>
                <th>Created Date</th>
                <th>Last Regenerated</th>
                <th>Orders Today</th>
                <th>Last Scan</th>
                <th>Last Order</th>
                <th>Scan Count</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ table, occupied, ordersToday, lastScanAt, lastOrderAt, scanCount, orderingUrl }) => (
                <tr key={table.id}>
                  <td><input type="checkbox" checked={selectedTableIds.includes(table.id)} onChange={() => toggleSelectedTable(table.id)} aria-label={`Select ${table.label}`} /></td>
                  <td><strong>{table.label || `Table ${table.table_number}`}</strong></td>
                  <td><span className={table.active ? "od-active-pill" : "od-offline-pill"}>{table.active ? "Active" : "Disabled"}</span></td>
                  <td><span className={`od-status-badge ${occupied ? "paid" : "pending"}`}>{occupied ? "Occupied" : "Available"}</span></td>
                  <td>
                    {qrCodes[table.id] ? <img className="od-qr-thumb" src={qrCodes[table.id]} alt={`QR for ${table.label}`} /> : <div className="od-qr-placeholder compact">QR</div>}
                  </td>
                  <td>{table.created_at ? fmtDateTime(table.created_at) : "Not recorded"}</td>
                  <td>{table.qr_regenerated_at ? fmtDateTime(table.qr_regenerated_at) : "Not recorded"}</td>
                  <td><strong>{ordersToday}</strong></td>
                  <td>{lastScanAt ? fmtTimeAgo(lastScanAt) : "No scans"}</td>
                  <td>{lastOrderAt ? fmtTimeAgo(lastOrderAt) : "No orders"}</td>
                  <td>{scanCount ?? "N/A"}</td>
                  <td>
                    <div className="od-row-actions">
                      <button className="od-btn-ghost compact" type="button" onClick={() => setPreviewTable(table)} disabled={!orderingUrl}>View QR</button>
                      <button className="od-btn-ghost compact" type="button" onClick={() => void regenerateQr(table)} disabled={workingTableId === table.id}>Regenerate QR</button>
                      {table.active ? (
                        <button className="od-btn-ghost compact danger" type="button" onClick={() => void setTableActive(table, false)} disabled={workingTableId === table.id}>Disable</button>
                      ) : (
                        <button className="od-btn-ghost compact" type="button" onClick={() => void setTableActive(table, true)} disabled={workingTableId === table.id}>Enable</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <div className="od-empty compact">No restaurant tables found. Save table settings to synchronize QR records.</div>}
        </div>
      </div>
      {previewTable && (
        <div className="od-modal-backdrop" role="presentation" onClick={() => setPreviewTable(null)}>
          <div className="od-modal od-qr-modal" role="dialog" aria-modal="true" aria-labelledby="od-qr-modal-title" onClick={(event) => event.stopPropagation()}>
            <div className="od-modal-header">
              <div>
                <div className="od-card-title" id="od-qr-modal-title">Table QR Code</div>
                <div className="od-card-subtitle">{restaurantName}</div>
              </div>
              <button className="od-icon-btn" type="button" aria-label="Close QR preview" onClick={() => setPreviewTable(null)}>X</button>
            </div>
            <div className="od-qr-preview">
              {logoUrl ? <img className="od-qr-logo" src={logoUrl} alt={`${restaurantName} logo`} /> : <div className="od-qr-logo fallback">{restaurantName.slice(0, 2).toUpperCase()}</div>}
              <div className="od-qr-restaurant">{restaurantName}</div>
              <div className="od-qr-table-number">Table {previewTable.table_number}</div>
              {qrCodes[previewTable.id] ? <img className="od-qr-large" src={qrCodes[previewTable.id]} alt={`QR code for table ${previewTable.table_number}`} /> : <div className="od-qr-large od-qr-placeholder">QR</div>}
              <a className="od-qr-url" href={previewUrl} target="_blank" rel="noreferrer">{previewUrl}</a>
              {previewPrintable && (
                <div className="od-qr-export-actions">
                  <button className="od-btn-ghost" type="button" onClick={() => void downloadQrPng(previewPrintable)}>Download PNG</button>
                  <button className="od-btn-ghost" type="button" onClick={() => void downloadQrSvg(previewPrintable)}>Download SVG</button>
                  <button className="od-btn-ghost" type="button" onClick={() => void downloadQrPdf([previewPrintable], `${safeFilename(restaurantName)}-table-${previewTable.table_number}-qr.pdf`)}>Download PDF</button>
                  <button className="od-btn-primary" type="button" onClick={() => void printQrCards([previewPrintable])}>Print</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type SettingsFormState = {
  name: string;
  totalTables: string;
  phone: string;
  email: string;
  address: string;
  description: string;
  timezone: string;
  currency: string;
  opensAt: string;
  closesAt: string;
  closedDays: string[];
  kitchenMode: "single" | "advanced" | "skipped";
  acceptsQrOrders: boolean;
  autoAcceptOrders: boolean;
  serviceCharge: string;
  primaryColor: string;
  logoUrl: string;
  coverUrl: string;
  emailNotifications: boolean;
  smsNotifications: boolean;
  requireStrongPasswords: boolean;
  sessionTimeoutMinutes: string;
};

const BUSINESS_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function configToSettingsForm(config: RestaurantConfig | null, fallbackName: string): SettingsFormState {
  const kitchenMode = jsonBool(config?.kitchen_settings ?? {}, "skipped", false)
    ? "skipped"
    : jsonString(config?.kitchen_settings ?? {}, "mode", "single") === "advanced"
      ? "advanced"
      : "single";

  return {
    name: config?.name ?? fallbackName,
    totalTables: String(config?.total_tables ?? 20),
    phone: jsonString(config?.profile ?? {}, "phone"),
    email: jsonString(config?.profile ?? {}, "email"),
    address: jsonString(config?.profile ?? {}, "address"),
    description: jsonString(config?.profile ?? {}, "description"),
    timezone: jsonString(config?.profile ?? {}, "timezone", "Africa/Nairobi"),
    currency: jsonString(config?.profile ?? {}, "currency", "ETB"),
    opensAt: jsonString(config?.business_hours ?? {}, "opens_at", "08:00"),
    closesAt: jsonString(config?.business_hours ?? {}, "closes_at", "22:00"),
    closedDays: jsonStringArray(config?.business_hours ?? {}, "closed_days"),
    kitchenMode,
    acceptsQrOrders: jsonBool(config?.ordering_settings ?? {}, "accepts_qr_orders", true),
    autoAcceptOrders: jsonBool(config?.ordering_settings ?? {}, "auto_accept_orders", false),
    serviceCharge: String((config?.ordering_settings?.service_charge_percent as number | undefined) ?? 0),
    primaryColor: jsonString(config?.branding ?? {}, "primary_color", "#0f766e"),
    logoUrl: jsonString(config?.branding ?? {}, "logo_url"),
    coverUrl: jsonString(config?.branding ?? {}, "cover_url"),
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
  const [assetUploading, setAssetUploading] = useState<"logo" | "cover" | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [qrCodes, setQrCodes] = useState<Record<number, string>>({});
  const [appUrl, setAppUrl] = useState("http://localhost:5173");
  const [appUrlWorking, setAppUrlWorking] = useState(false);
  const activeTables = useMemo(() => tables.filter((table) => table.active), [tables]);

  useEffect(() => {
    setForm(configToSettingsForm(config, fallbackRestaurantName));
  }, [config, fallbackRestaurantName]);

  useEffect(() => {
    let mounted = true;
    async function loadAppUrl() {
      try {
        const { data, error } = await supabase.rpc("get_app_url");
        if (error) throw new Error(error.message);
        if (mounted && typeof data === "string" && data.trim()) {
          setAppUrl(data);
        }
      } catch (error) {
        if (mounted) setSettingsError(error instanceof Error ? error.message : "Could not load application URL.");
      }
    }
    void loadAppUrl();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function generateQrCodes() {
      try {
        const pairs = await Promise.all(
          activeTables.slice(0, 80).map(async (table) => {
            const url = getOrderingUrl(table.qr_url || table.qr_path);
            if (!url) return [table.table_number, ""] as const;
            const dataUrl = await QRCode.toDataURL(url, { width: 132, margin: 1 });
            return [table.table_number, dataUrl] as const;
          })
        );
        if (mounted) setQrCodes(Object.fromEntries(pairs));
      } catch (error) {
        if (mounted) setSettingsError(error instanceof Error ? error.message : "Could not generate QR codes.");
      }
    }
    void generateQrCodes();
    return () => { mounted = false; };
  }, [activeTables]);

  function updateField<K extends keyof SettingsFormState>(key: K, value: SettingsFormState[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  function toggleClosedDay(day: string) {
    setForm((previous) => ({
      ...previous,
      closedDays: previous.closedDays.includes(day)
        ? previous.closedDays.filter((entry) => entry !== day)
        : [...previous.closedDays, day],
    }));
  }

  async function uploadBrandingAsset(assetType: "logo" | "cover", file: File | null) {
    if (!file) return;

    try {
      setAssetUploading(assetType);
      setSettingsError(null);
      setNotice(null);

      if (!file.type.startsWith("image/")) throw new Error("Branding asset must be an image file.");
      if (file.size > 5 * 1024 * 1024) throw new Error("Branding asset must be 5 MB or smaller.");

      const path = buildBrandingAssetPath(restaurantId, assetType);
      const { error: uploadError } = await supabase.storage.from("menu-photos").upload(path, file, {
        cacheControl: "0",
        upsert: true,
        contentType: file.type,
      });
      if (uploadError) throw new Error(uploadError.message);

      const { data } = supabase.storage.from("menu-photos").getPublicUrl(path);
      if (assetType === "logo") updateField("logoUrl", data.publicUrl);
      if (assetType === "cover") updateField("coverUrl", data.publicUrl);
    } catch (uploadError) {
      setSettingsError(uploadError instanceof Error ? uploadError.message : "Could not upload branding asset.");
    } finally {
      setAssetUploading(null);
    }
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
          description: form.description.trim(),
          timezone: form.timezone.trim(),
          currency: form.currency.trim(),
        },
        business_hours_payload: {
          version: 1,
          opens_at: form.opensAt,
          closes_at: form.closesAt,
          closed_days: form.closedDays,
          schedules: [{
            name: "Default",
            opens_at: form.opensAt,
            closes_at: form.closesAt,
            closed_days: form.closedDays,
          }],
        },
        kitchen_settings_payload: {
          mode: form.kitchenMode === "advanced" ? "advanced" : "single",
          skipped: form.kitchenMode === "skipped",
        },
        ordering_settings_payload: {
          accepts_qr_orders: form.acceptsQrOrders,
          auto_accept_orders: form.autoAcceptOrders,
          service_charge_percent: serviceCharge,
        },
        branding_payload: {
          primary_color: form.primaryColor,
          logo_url: form.logoUrl.trim(),
          cover_url: form.coverUrl.trim(),
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
      setNotice("Settings saved.");
    } catch (saveError) {
      setSettingsError(saveError instanceof Error ? saveError.message : "Could not save settings.");
    } finally {
      setWorking(false);
    }
  }

  async function saveApplicationUrl() {
    try {
      setAppUrlWorking(true);
      setSettingsError(null);
      setNotice(null);
      const { data, error } = await supabase.rpc("set_app_url", {
        requested_app_url: appUrl,
      });
      if (error) throw new Error(error.message);
      if (typeof data === "string" && data.trim()) setAppUrl(data);
      await onSettingsChanged();
      setNotice("Application URL saved and QR codes regenerated.");
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Could not save application URL.");
    } finally {
      setAppUrlWorking(false);
    }
  }

  async function regenerateAllQrCodes() {
    try {
      setAppUrlWorking(true);
      setSettingsError(null);
      setNotice(null);
      const { error } = await supabase.rpc("regenerate_all_restaurant_table_qr", {
        target_restaurant_id: restaurantId,
      });
      if (error) throw new Error(error.message);
      await onSettingsChanged();
      setNotice("All table QR codes regenerated with the configured application URL.");
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Could not regenerate QR codes.");
    } finally {
      setAppUrlWorking(false);
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
                <label className="wide">Description<textarea value={form.description} onChange={(event) => updateField("description", event.target.value)} disabled={working} /></label>
                <label>Timezone<input value={form.timezone} onChange={(event) => updateField("timezone", event.target.value)} disabled={working} /></label>
              </div>
            </section>

            <section className="od-card">
              <div className="od-card-header"><div><div className="od-card-title">Table Management</div><div className="od-card-subtitle">Updates the configured table count used for table validation.</div></div></div>
              <div className="od-settings-grid compact">
                <label>Total Tables<input type="number" min="1" max="500" value={form.totalTables} onChange={(event) => updateField("totalTables", event.target.value)} disabled={working} /></label>
                <div className="od-setting-stat"><strong>{activeTables.length}</strong><span>Active table records</span></div>
                <div className="od-setting-stat"><strong>{config?.total_tables ?? form.totalTables}</strong><span>Configured tables</span></div>
              </div>
            </section>

            <section className="od-card">
              <div className="od-card-header"><div><div className="od-card-title">Business Hours</div><div className="od-card-subtitle">Default operating window for ordering and reports.</div></div></div>
              <div className="od-settings-grid compact">
                <label>Opens At<input type="time" value={form.opensAt} onChange={(event) => updateField("opensAt", event.target.value)} disabled={working} /></label>
                <label>Closes At<input type="time" value={form.closesAt} onChange={(event) => updateField("closesAt", event.target.value)} disabled={working} /></label>
                <div className="od-settings-day-group">
                  {BUSINESS_DAYS.map((day) => (
                    <label className="od-toggle-row" key={day}>
                      <input type="checkbox" checked={form.closedDays.includes(day)} onChange={() => toggleClosedDay(day)} disabled={working} />
                      {day} closed
                    </label>
                  ))}
                </div>
              </div>
            </section>

            <section className="od-card">
              <div className="od-card-header"><div><div className="od-card-title">Kitchen Configuration</div><div className="od-card-subtitle">Stores the onboarding kitchen preference only.</div></div></div>
              <div className="od-settings-grid compact">
                <label>Kitchen Setup<select value={form.kitchenMode} onChange={(event) => updateField("kitchenMode", event.target.value as SettingsFormState["kitchenMode"])} disabled={working}>
                  <option value="single">Single Kitchen</option>
                  <option value="advanced">Multiple Kitchen Stations Preference</option>
                  <option value="skipped">Skipped</option>
                </select></label>
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
                <label>Logo Image<input type="file" accept="image/*" onChange={(event) => void uploadBrandingAsset("logo", event.target.files?.[0] ?? null)} disabled={working || assetUploading !== null} /></label>
                <label>Cover Image<input type="file" accept="image/*" onChange={(event) => void uploadBrandingAsset("cover", event.target.files?.[0] ?? null)} disabled={working || assetUploading !== null} /></label>
                <label className="wide">Logo URL<input value={form.logoUrl} onChange={(event) => updateField("logoUrl", event.target.value)} disabled={working} /></label>
                <label className="wide">Cover URL<input value={form.coverUrl} onChange={(event) => updateField("coverUrl", event.target.value)} disabled={working} /></label>
              </div>
            </section>
          </div>

          <div className="od-settings-side">
            <section className="od-card">
              <div className="od-card-header"><div><div className="od-card-title">QR Code Management</div><div className="od-card-subtitle">Shows existing active table ordering codes.</div></div></div>
              <div className="od-settings-stack">
                <label>Application URL<input value={appUrl} onChange={(event) => setAppUrl(event.target.value)} disabled={appUrlWorking || working} placeholder="http://10.61.145.181:5173" /></label>
                <button className="od-btn-primary" type="button" onClick={() => void saveApplicationUrl()} disabled={appUrlWorking || working}>
                  {appUrlWorking ? "Updating..." : "Save Application URL"}
                </button>
                <button className="od-btn-ghost" type="button" onClick={() => void regenerateAllQrCodes()} disabled={appUrlWorking || working || activeTables.length === 0}>
                  Regenerate All QR Codes
                </button>
              </div>
              <div className="od-qr-list">
                {activeTables.length === 0 ? <div className="od-empty compact">No active table QR codes yet.</div> : activeTables.slice(0, 12).map((table) => (
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

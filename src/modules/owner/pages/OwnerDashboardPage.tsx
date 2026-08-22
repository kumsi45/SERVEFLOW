import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  assertAbsoluteQrPayload,
  buildAbsolutePublicUrl,
} from "../../../core/config/appUrl";
import { supabase } from "../../../core/database";
import { ResilientImage } from "../../../core/presentation/ResilientImage";
import { ServeFlowBrand } from "../../../core/presentation/ServeFlowBrand";
import { SmartImage } from "../../../core/presentation/SmartImage";
import { createSmartImagePublicUrl, resolveSmartImage } from "../../../core/presentation/smartImageDelivery";
import { createRestaurantEventConsumer } from "../../../core/realtime/restaurantEventService";
import { analyticsWindow } from "../../../core/analytics/historicalAnalytics";
import {
  formatCompactCurrency,
  formatCurrency,
  type CurrencyConfig,
} from "../../../core/format/currency";
import { formatPreparationEstimate } from "../../../core/menu/preparationTime";
import {
  canonicalOperationalStatus,
  canonicalPaymentMethod,
  operationalLabel,
  type OperationalStatus,
  type PaymentPolicy,
} from "../../../core/payment/lifecycle";
import { signOutStaff } from "../../staff-auth/services/staffAuthService";
import { publishMenuThemeSelection } from "../../menu/theme-engine/themeEvents";
import { resolveMenuTheme, type MenuTheme } from "../../menu/theme-engine/ThemeTypes";
import { OwnerAiAdvisor } from "../components/ai/OwnerAiAdvisor";
import { PrintingPaymentConfigurationCenter } from "../components/settings/PrintingPaymentConfigurationCenter";
import {
  searchActiveDirectInventoryItems,
  searchActiveMenuRecipes,
  type DirectInventoryOption,
  type MenuRecipeOption,
} from "../../menu-recipes/services/menuRecipeService";
import { createRecipe, softDeleteRecipe } from "../../recipes/services/recipeService";
import {
  staffAuthEmailRequired,
  staffAuthRoleLabel,
  usesWaiterPin,
  validateStaffPasswordConfirmation,
  validateWaiterPin,
} from "../../../../supabase/functions/_shared/staffAuthPolicy";
import {
  createStaff,
  deleteStaff,
  deactivateStaff,
  loadStaffActivityLog,
  reactivateStaff,
  sendStaffPasswordReset,
  setStaffWaiterPin,
  updateStaff,
  type ManagedStaffMember,
  type StaffActivityLog,
} from "../services/staffManagementService";
import "../styles/ownerDashboard.css";

let activeOwnerCurrency: CurrencyConfig | null = null;
let activeOwnerTimezone = "Africa/Nairobi";

function fmtMoney(value: number) {
  return formatCurrency(value, activeOwnerCurrency);
}

function fmtMoneyK(value: number) {
  return formatCompactCurrency(value, activeOwnerCurrency);
}

function fmtOrderLabel(order: Pick<OdOrder, "display_number" | "id">) {
  return order.display_number ?? "Current order";
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
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 60000),
  );
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
    return {
      dashboardLabel: "Afternoon Dashboard",
      greeting: "Good afternoon",
    };
  }
  if (hour >= 17 && hour < 21) {
    return { dashboardLabel: "Evening Dashboard", greeting: "Good evening" };
  }
  return { dashboardLabel: "Night Dashboard", greeting: "Good night" };
}

type OwnerOrderStatus =
  | "pending_payment"
  | "paid"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled";
type AnalyticsPeriod = "today" | "week" | "month";

type OdOrder = {
  id: string;
  display_number: string | null;
  status: OwnerOrderStatus;
  operational_status: OperationalStatus;
  dining_session_status:
    "open" | "closed" | "abandoned" | "expired" | "checked_out" | string | null;
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

function staffRoleLabel(role: string) {
  if (role === "inventory_officer") return "Inventory Officer";
  if (role === "inventory") return "Inventory Staff";
  return role.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  recipe_id: string | null;
  recipe_name: string | null;
  recipe_status: string | null;
  direct_inventory_item_id: string | null;
  direct_inventory_item_name: string | null;
};

function OwnerMenuThumbnail({ item }: { item: Pick<OdMenuItem, "id" | "name" | "image_url"> }) {
  const image = resolveSmartImage({ itemId: item.id, master: item.image_url ? { source: "MASTER", status: "APPROVED", url: item.image_url, version: 1 } : null, placeholderUrl: "" }, "thumbnail", "owner-review");
  return image.url ? <SmartImage resolution={image} alt="" className="od-menu-thumb" fallback="MN" fallbackClassName="od-menu-thumb empty" /> : <div className="od-menu-thumb empty">MN</div>;
}

type InventoryTrackingType = "recipe" | "ready_to_sell" | "no_tracking";

function inventoryTrackingType(item: Pick<OdMenuItem, "recipe_id" | "direct_inventory_item_id">): InventoryTrackingType {
  if (item.recipe_id) return "recipe";
  if (item.direct_inventory_item_id) return "ready_to_sell";
  return "no_tracking";
}

function inventoryTrackingLabel(type: InventoryTrackingType) {
  if (type === "recipe") return "Recipe";
  if (type === "ready_to_sell") return "Ready-to-Sell";
  return "No Tracking";
}

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
  invoice_id: string | null;
  quantity: number;
  price: number;
  menu_item_id: string | null;
  name: string;
};

type OdPayment = {
  id: string;
  order_id: string;
  status: string;
  payment_status: string;
  total_price: number;
  payment_method: string | null;
  verified_at: string | null;
  paid_at: string | null;
  created_at: string;
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
  payment_policy: PaymentPolicy;
  vat_enabled: boolean;
  vat_percentage: number;
  service_charge_enabled: boolean;
  service_charge_percentage: number;
  branding: JsonRecord;
  notification_settings: JsonRecord;
  security_settings: JsonRecord;
  subscription_plan: string;
  billing_status: string;
  currency_code: string;
  currency_symbol: string;
  locale: string;
  date_format: string;
  time_format: string;
  menu_theme: MenuTheme;
  setup_status: JsonRecord;
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

type NavId =
  | "overview"
  | "orders"
  | "analytics"
  | "menu"
  | "stations"
  | "staff"
  | "qr"
  | "customers"
  | "reports"
  | "printing"
  | "settings";

type OwnerNavTarget = NavId | "inventory" | "recipes";

const NAV_SECTIONS: Array<{ label: string | null; items: Array<{ id: OwnerNavTarget; icon: string; label: string }> }> = [
  { label: null, items: [{ id: "overview", icon: "⌂", label: "Dashboard" }] },
  { label: "Operations", items: [
    { id: "orders", icon: "≡", label: "Orders" }, { id: "menu", icon: "◇", label: "Menu" },
    { id: "stations", icon: "♨", label: "Kitchen" }, { id: "inventory", icon: "▦", label: "Inventory" },
    { id: "customers", icon: "○", label: "Customers" }, { id: "staff", icon: "♙", label: "Staff" },
  ] },
  { label: "Business", items: [{ id: "analytics", icon: "$", label: "Finance" }, { id: "reports", icon: "↗", label: "Reports" }] },
  { label: "Business management", items: [
    { id: "qr", icon: "#", label: "QR & Tables" }, { id: "printing", icon: "▤", label: "Printing" }, { id: "settings", icon: "⚙", label: "Settings" },
  ] },
];
const NAV_ITEMS = NAV_SECTIONS.flatMap((section) => section.items);

const ACTIVE_ORDER_STATUSES: OperationalStatus[] = [
  "new",
  "accepted",
  "preparing",
  "ready",
];

type OwnerDashboardPageProps = {
  restaurantId: string;
  restaurantName: string;
  ownerName?: string;
  currency?: CurrencyConfig;
};

function statusLabel(status: string) {
  return operationalLabel(canonicalOperationalStatus(status));
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
    printing: "P",
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
  return analyticsWindow("today", activeOwnerTimezone).rangeStart;
}

function getAnalyticsDateRange(period: AnalyticsPeriod) {
  return analyticsWindow(period, activeOwnerTimezone);
}

function sameHour(iso: string, hour: number) {
  return new Date(iso).getHours() === hour;
}

function isRevenueOrder(order: OdOrder) {
  return Boolean(order.payment_verified_at);
}

function toJsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
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
  return Array.isArray(raw)
    ? raw.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function buildBrandingAssetPath(
  restaurantId: string,
  assetType: "logo" | "cover",
) {
  return `${restaurantId}/branding/${assetType}`;
}

function buildRestaurantConfig(
  row: Record<string, unknown>,
  fallbackName: string,
): RestaurantConfig {
  return {
    id: String(row.id),
    name: typeof row.name === "string" ? row.name : fallbackName,
    slug: typeof row.slug === "string" ? row.slug : "",
    total_tables: Number(row.total_tables ?? row.table_count ?? 20),
    profile: toJsonRecord(row.profile),
    business_hours: toJsonRecord(row.business_hours),
    kitchen_settings: toJsonRecord(row.kitchen_settings),
    ordering_settings: toJsonRecord(row.ordering_settings),
    payment_policy: ["pay_before_kitchen", "kitchen_before_payment"].includes(
      String(row.payment_policy),
    )
      ? (row.payment_policy as PaymentPolicy)
      : "pay_before_kitchen",
    vat_enabled: Boolean(row.vat_enabled),
    vat_percentage: Number(row.vat_percentage ?? 15),
    service_charge_enabled: Boolean(row.service_charge_enabled),
    service_charge_percentage: Number(row.service_charge_percentage ?? 0),
    branding: toJsonRecord(row.branding),
    notification_settings: toJsonRecord(row.notification_settings),
    security_settings: toJsonRecord(row.security_settings),
    subscription_plan:
      typeof row.subscription_plan === "string"
        ? row.subscription_plan
        : "starter",
    billing_status:
      typeof row.billing_status === "string" ? row.billing_status : "trial",
    currency_code:
      typeof row.currency_code === "string" ? row.currency_code : "ETB",
    currency_symbol:
      typeof row.currency_symbol === "string" ? row.currency_symbol : "Br",
    locale: typeof row.locale === "string" ? row.locale : "am-ET",
    date_format:
      typeof row.date_format === "string" ? row.date_format : "medium",
    time_format: typeof row.time_format === "string" ? row.time_format : "24h",
    menu_theme: resolveMenuTheme(row.menu_theme),
    setup_status: toJsonRecord(row.setup_status),
  };
}

function normalizeRestaurantTable(
  row: Record<string, unknown>,
): RestaurantTable {
  return {
    id: String(row.id),
    restaurant_id: String(row.restaurant_id),
    table_number: Number(row.table_number),
    label:
      typeof row.label === "string"
        ? row.label
        : `Table ${Number(row.table_number)}`,
    qr_path: typeof row.qr_path === "string" ? row.qr_path : "",
    qr_url: typeof row.qr_url === "string" ? row.qr_url : null,
    qr_created_at:
      typeof row.qr_created_at === "string"
        ? row.qr_created_at
        : String(row.created_at ?? ""),
    qr_regenerated_at:
      typeof row.qr_regenerated_at === "string"
        ? row.qr_regenerated_at
        : String(row.updated_at ?? row.created_at ?? ""),
    active: Boolean(row.active),
    created_at: typeof row.created_at === "string" ? row.created_at : "",
  };
}

function normalizeKitchenStation(
  row: Record<string, unknown>,
): OdKitchenStation {
  return {
    id: String(row.id),
    restaurant_id: String(row.restaurant_id),
    name: String(row.name),
    description: typeof row.description === "string" ? row.description : null,
    display_color:
      typeof row.display_color === "string" ? row.display_color : "#0f766e",
    icon: typeof row.icon === "string" ? row.icon : "MK",
    priority: Number(row.priority ?? 100),
    active: Boolean(row.active),
    assigned_menu_items: Number(row.assigned_menu_items ?? 0),
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    updated_at: typeof row.updated_at === "string" ? row.updated_at : "",
  };
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDateInputRange(startDate: string, endDate: string) {
  return analyticsWindow("custom", activeOwnerTimezone, startDate, endDate);
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

function exportRowsAsCsv(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
) {
  downloadText(
    filename,
    [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n"),
    "text/csv;charset=utf-8",
  );
}

function exportRowsAsExcel(
  filename: string,
  title: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
) {
  const tableRows = [headers, ...rows]
    .map(
      (row, index) =>
        `<tr>${row
          .map(
            (cell) =>
              `<${index === 0 ? "th" : "td"}>${String(cell ?? "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")}</${index === 0 ? "th" : "td"}>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  downloadText(
    filename,
    `<html><head><meta charset="utf-8" /></head><body><h1>${title}</h1><table>${tableRows}</table></body></html>`,
    "application/vnd.ms-excel;charset=utf-8",
  );
}

type OwnerUtilityPanelKind = "notifications" | "subscription" | "help" | "about" | "feedback";

function OwnerUtilityPanel({ panel, onClose }: { panel: OwnerUtilityPanelKind; onClose: () => void }) {
  const title = panel === "about" ? "About ServeFlow" : panel === "help" ? "Help Center" : panel === "feedback" ? "Send Feedback" : panel.charAt(0).toUpperCase() + panel.slice(1);
  const helpTopics = ["Getting Started", "Orders", "Menu", "Kitchen", "Inventory", "Finance", "Printing", "Frequently Asked Questions", "Video Tutorials", "Contact Support"];
  return <div className="od-utility-layer"><button type="button" className="od-assistant-backdrop" aria-label="Close panel" onClick={onClose} /><aside className={`od-utility-panel ${panel}`} aria-label={title}><header><div><span className="od-v10-eyebrow">ServeFlow support</span><h2>{title}</h2></div><button type="button" aria-label="Close panel" onClick={onClose}>×</button></header>
    {panel === "help" ? <div className="od-help-center"><label><span aria-hidden="true">⌕</span><input type="search" placeholder="Search help articles" aria-label="Search Help Center" /></label><div className="od-help-grid">{helpTopics.map((topic, index) => <button type="button" key={topic}><span>{["↗", "▣", "◇", "♨", "▦", "$", "▤", "?", "▶", "◌"][index]}</span><strong>{topic}</strong><small>{index === 9 ? "Talk with the ServeFlow team" : "Guides and practical answers"}</small></button>)}</div></div> : null}
    {panel === "about" ? <div className="od-about-page"><div className="od-about-brand"><div><ServeFlowBrand variant="compact" /><p>Hospitality Business Management Platform</p></div><span>v1.0.0</span></div><dl><div><dt>Developed & Maintained by</dt><dd>KumsiTech</dd></div><div><dt>Founder & Lead Architect</dt><dd>Abdulhayi Alo</dd></div></dl><section><span className="od-v10-eyebrow">Our mission</span><p>ServeFlow helps cafés, restaurants, hotels, bars, lounges, bakeries, fast-food businesses, and other hospitality businesses manage daily operations through QR ordering, POS, Kitchen Display System, Inventory, Finance, Reporting, and AI-powered business intelligence.</p></section><section><span className="od-v10-eyebrow">Platform features</span><div className="od-about-features">{["QR Ordering", "Cashier", "Kitchen", "Waiter", "Inventory", "Finance", "Reports", "AI Business Advisor"].map((feature) => <span key={feature}>✓ {feature}</span>)}</div></section><nav aria-label="ServeFlow information"><button type="button">Official Website</button><button type="button">Privacy Policy</button><button type="button">Terms of Service</button><button type="button">Release Notes</button><button type="button">System Status</button><button type="button">Contact Support</button></nav></div> : null}
    {panel === "feedback" ? <form className="od-feedback-page" onSubmit={(event) => event.preventDefault()}><p>Help us make ServeFlow better for every hospitality business.</p><fieldset><legend>What would you like to share?</legend><div><button type="button"><span>!</span><strong>Report Bug</strong></button><button type="button"><span>+</span><strong>Suggest Feature</strong></button><button type="button"><span>★</span><strong>Rate Experience</strong></button></div></fieldset><label>Tell us more<textarea rows={6} placeholder="Describe your experience or suggestion…" /></label><button type="submit" className="od-btn-primary">Send Feedback</button><small>Feedback submission will be enabled in a future release.</small></form> : null}
    {panel === "notifications" || panel === "subscription" ? <div className="od-utility-content"><ServeFlowBrand variant="icon-only" /><p>{panel === "notifications" ? "Your business notifications will appear here." : "Manage your ServeFlow plan and billing from this dedicated account area."}</p><span>More account tools coming soon</span></div> : null}
  </aside></div>;
}

export function OwnerDashboardPage({
  restaurantId,
  restaurantName,
  ownerName,
  currency,
  initialSection,
}: OwnerDashboardPageProps & { initialSection?: string }) {
  const now = useNow();
  const [nav, setNav] = useState<NavId>(
    () =>
      (
        ({
          dashboard: "overview",
          orders: "orders",
          menu: "menu",
          staff: "staff",
          reports: "reports",
          settings: "settings",
          analytics: "analytics",
          tables: "qr",
        }) as Record<string, NavId>
      )[initialSection ?? ""] ?? "overview",
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false);
  const [utilityPanel, setUtilityPanel] = useState<OwnerUtilityPanelKind | null>(null);
  const [orders, setOrders] = useState<OdOrder[]>([]);
  const [payments, setPayments] = useState<OdPayment[]>([]);
  const [staff, setStaff] = useState<OdStaff[]>([]);
  const [menuItems, setMenuItems] = useState<OdMenuItem[]>([]);
  const [categories, setCategories] = useState<OdCategory[]>([]);
  const [orderItems, setOrderItems] = useState<OdOrderItem[]>([]);
  const [activeShifts, setActiveShifts] = useState<OwnerActiveShift[]>([]);
  const [restaurantConfig, setRestaurantConfig] =
    useState<RestaurantConfig | null>(null);
  activeOwnerCurrency = restaurantConfig
    ? {
        currencyCode: restaurantConfig.currency_code,
        currencySymbol: restaurantConfig.currency_symbol,
        locale: restaurantConfig.locale,
      }
    : (currency ?? null);
  activeOwnerTimezone = restaurantConfig
    ? jsonString(restaurantConfig.profile, "timezone", "Africa/Nairobi")
    : "Africa/Nairobi";
  const [restaurantTables, setRestaurantTables] = useState<RestaurantTable[]>(
    [],
  );
  const [kitchenStations, setKitchenStations] = useState<OdKitchenStation[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboardReports, setDashboardReports] = useState<
    Record<AnalyticsPeriod, OwnerReportSummary>
  >({
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
          { data: paymentData, error: paymentError },
          { data: stationData, error: stationError },
        ] = await Promise.all([
          supabase
            .from("orders")
            .select(
              "id,display_number,status,operational_status,dining_session_status,customer_name,table_number,payment_method,total_price,created_at,payment_verified_at,completed_at",
            )
            .eq("restaurant_id", restaurantId)
            .order("created_at", { ascending: false })
            .limit(500),
          supabase
            .from("restaurant_staff")
            .select(
              "id,user_id,display_name,email,username,phone_number,role,assigned_kitchen_station_id,active,created_at,last_login_at,staff_session_active,waiter_session_active",
            )
            .eq("restaurant_id", restaurantId)
            .neq("role", "owner")
            .order("created_at", { ascending: true }),
          supabase
            .from("menu_items")
            .select(
              "id,name,description,ingredients,allergens,preparation_time_minutes,spice_level,dietary_tags,calories,protein_g,carbohydrates_g,fat_g,fiber_g,sugar_g,sodium_mg,price,available,category_id,kitchen_station_id,image_url,archived_at,recipe_id,direct_inventory_item_id,recipes!menu_items_recipe_same_restaurant(name,status),inventory_items!menu_items_direct_inventory_item_same_restaurant(name)",
            )
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
            .select(
              "id,name,slug,total_tables,table_count,profile,business_hours,kitchen_settings,ordering_settings,payment_policy,vat_enabled,vat_percentage,service_charge_enabled,service_charge_percentage,branding,notification_settings,security_settings,subscription_plan,billing_status,currency_code,currency_symbol,locale,date_format,time_format,menu_theme,setup_status",
            )
            .eq("id", restaurantId)
            .maybeSingle(),
          supabase
            .from("restaurant_tables")
            .select(
              "id,restaurant_id,table_number,label,qr_path,qr_url,qr_created_at,qr_regenerated_at,active,created_at",
            )
            .eq("restaurant_id", restaurantId)
            .order("table_number", { ascending: true }),
          supabase
            .from("cashier_shifts")
            .select("id,restaurant_id,opened_by,opened_at,opening_cash")
            .eq("restaurant_id", restaurantId)
            .is("closed_at", null)
            .order("opened_at", { ascending: false }),
          supabase
            .from("order_invoices")
            .select(
              "id,order_id,status,payment_status,total_price,payment_method,paid_at,created_at",
            )
            .eq("restaurant_id", restaurantId)
            .eq("payment_status", "paid")
            .order("paid_at", { ascending: false })
            .limit(1000),
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
        if (paymentError) throw new Error(paymentError.message);
        if (stationError) throw new Error(stationError.message);
        if (!mounted) return;

        const normalizedOrders = (orderData ?? []).map((row) => ({
          id: String(row.id),
          display_number:
            typeof row.display_number === "string" ? row.display_number : null,
          status: String(row.status) as OwnerOrderStatus,
          operational_status: canonicalOperationalStatus(
            row.operational_status,
          ),
          dining_session_status:
            typeof row.dining_session_status === "string"
              ? row.dining_session_status
              : null,
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
            .select(
              "id,order_id,invoice_id,menu_item_id,quantity,price,menu_items!order_items_menu_item_same_restaurant(name)",
            )
            .eq("restaurant_id", restaurantId)
            .in("order_id", orderIds);

          if (itemError) throw new Error(itemError.message);

          normalizedItems = (itemData ?? []).map((row) => ({
            id: String(row.id),
            order_id: String(row.order_id),
            invoice_id:
              typeof row.invoice_id === "string" ? row.invoice_id : null,
            menu_item_id: row.menu_item_id ? String(row.menu_item_id) : null,
            quantity: Number(row.quantity),
            price: Number(row.price),
            name: getMenuItemName(row.menu_items),
          }));
        }

        const itemCounts = new Map<string, number>();
        for (const item of normalizedItems) {
          itemCounts.set(
            item.order_id,
            (itemCounts.get(item.order_id) ?? 0) + item.quantity,
          );
        }

        setOrders(
          normalizedOrders.map((order) => ({
            ...order,
            item_count: itemCounts.get(order.id) ?? 0,
          })),
        );
        setPayments(
          (paymentData ?? []).map((row) => ({
            id: String(row.id),
            order_id: String(row.order_id),
            status: String(row.status),
            payment_status: String(row.payment_status),
            total_price: Number(row.total_price),
            payment_method: row.payment_method ?? null,
            verified_at: row.paid_at ?? null,
            paid_at: row.paid_at ?? null,
            created_at: String(row.created_at),
          })),
        );
        setOrderItems(normalizedItems);
        setStaff((staffData ?? []) as OdStaff[]);
        setMenuItems(
          (menuData ?? []).map((row) => ({
            ...row,
            price: Number(row.price),
            recipe_name: (Array.isArray(row.recipes) ? row.recipes[0] : row.recipes)?.name ?? null,
            recipe_status: (Array.isArray(row.recipes) ? row.recipes[0] : row.recipes)?.status ?? null,
            direct_inventory_item_name:
              (Array.isArray(row.inventory_items) ? row.inventory_items[0] : row.inventory_items)?.name ?? null,
          })) as OdMenuItem[],
        );
        setCategories((categoryData ?? []) as OdCategory[]);
        setActiveShifts(
          (shiftData ?? []).map((row) => ({
            ...row,
            opening_cash: Number(row.opening_cash),
          })) as OwnerActiveShift[],
        );
        if (restaurantData)
          setRestaurantConfig(
            buildRestaurantConfig(
              restaurantData as Record<string, unknown>,
              restaurantName,
            ),
          );
        setRestaurantTables(
          (tableData ?? []).map((row) =>
            normalizeRestaurantTable(row as Record<string, unknown>),
          ),
        );
        setKitchenStations(
          ((stationData ?? []) as Record<string, unknown>[]).map((row) =>
            normalizeKitchenStation(row),
          ),
        );
      } catch (loadError) {
        if (mounted)
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load owner dashboard.",
          );
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
          (["today", "week", "month"] as AnalyticsPeriod[]).map(
            async (reportPeriod) => {
              const { rangeStart, rangeEnd } =
                getAnalyticsDateRange(reportPeriod);
              const [reportPayload, billPayload] = await Promise.all([
                loadOwnerReportData(restaurantId, rangeStart, rangeEnd),
                loadOwnerDiningBillReportData(
                  restaurantId,
                  rangeStart,
                  rangeEnd,
                ),
              ]);
              return [
                reportPeriod,
                mergeOwnerBillMetrics(reportPayload, billPayload).summary,
              ] as const;
            },
          ),
        );
        if (mounted)
          setDashboardReports(
            Object.fromEntries(reports) as Record<
              AnalyticsPeriod,
              OwnerReportSummary
            >,
          );
      } catch (reportError) {
        if (mounted)
          setError(
            reportError instanceof Error
              ? reportError.message
              : "Failed to load revenue summaries.",
          );
      } finally {
        if (mounted) setDashboardReportsLoading(false);
      }
    }

    void loadDashboardReports();
    return () => {
      mounted = false;
    };
  }, [restaurantId, orders]);

  useEffect(() => {
    const channel = createRestaurantEventConsumer(restaurantId)
      .onTable({
          event: "*",
          schema: "public",
          table: "orders",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        (payload) => {
          const deletedId = String(
            (payload.old as { id?: string } | null)?.id ?? "",
          );
          if (payload.eventType === "DELETE") {
            setOrders((previous) =>
              previous.filter((existing) => existing.id !== deletedId),
            );
            return;
          }

          const row = payload.new as Partial<OdOrder>;
          if (!row?.id) return;
          setOrders((previous) => {
            const index = previous.findIndex(
              (existing) => existing.id === row.id,
            );
            const existing = index >= 0 ? previous[index] : undefined;
            const order: OdOrder = {
              id: String(row.id),
              display_number:
                typeof row.display_number === "string"
                  ? row.display_number
                  : (existing?.display_number ?? null),
              status: String(row.status) as OwnerOrderStatus,
              operational_status: canonicalOperationalStatus(
                row.operational_status ?? existing?.operational_status,
              ),
              dining_session_status:
                typeof row.dining_session_status === "string"
                  ? row.dining_session_status
                  : (existing?.dining_session_status ?? null),
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
        },
      )
      .onTable({
          event: "*",
          schema: "public",
          table: "order_items",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        async (payload) => {
          const oldRow = payload.old as
            | (Partial<OdOrderItem> & {
                order_id?: string;
                quantity?: number | string;
              })
            | null;
          const newRow = payload.new as
            | (Partial<OdOrderItem> & {
                order_id?: string;
                invoice_id?: string | null;
                quantity?: number | string;
                menu_item_id?: string | null;
              })
            | null;
          const orderId = String(newRow?.order_id ?? oldRow?.order_id ?? "");
          if (!orderId) return;

          if (payload.eventType === "INSERT" && newRow?.id) {
            const menuItem = newRow.menu_item_id
              ? menuItems.find((item) => item.id === newRow.menu_item_id)
              : null;
            setOrderItems((previous) => [
              ...previous,
              {
                id: String(newRow.id),
                order_id: orderId,
                invoice_id: newRow.invoice_id
                  ? String(newRow.invoice_id)
                  : null,
                menu_item_id: newRow.menu_item_id
                  ? String(newRow.menu_item_id)
                  : null,
                quantity: Number(newRow.quantity ?? 0),
                price: Number(newRow.price ?? 0),
                name: menuItem?.name ?? "Menu item",
              },
            ]);
            setOrders((previous) =>
              previous.map((order) =>
                order.id === orderId
                  ? {
                      ...order,
                      item_count:
                        order.item_count + Number(newRow.quantity ?? 0),
                    }
                  : order,
              ),
            );
          }

          if (payload.eventType === "DELETE" && oldRow?.id) {
            setOrderItems((previous) =>
              previous.filter((item) => item.id !== oldRow.id),
            );
            setOrders((previous) =>
              previous.map((order) =>
                order.id === orderId
                  ? {
                      ...order,
                      item_count: Math.max(
                        0,
                        order.item_count - Number(oldRow.quantity ?? 0),
                      ),
                    }
                  : order,
              ),
            );
          }
        },
      )
      .onTable({
          event: "*",
          schema: "public",
          table: "order_invoices",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        () => {
          void supabase
            .from("order_invoices")
            .select(
              "id,order_id,status,payment_status,total_price,payment_method,paid_at,created_at",
            )
            .eq("restaurant_id", restaurantId)
            .eq("payment_status", "paid")
            .order("paid_at", { ascending: false })
            .limit(1000)
            .then(({ data, error: paymentError }) => {
              if (paymentError) {
                setError(paymentError.message);
                return;
              }
              setPayments(
                (data ?? []).map((row) => ({
                  id: String(row.id),
                  order_id: String(row.order_id),
                  status: String(row.status),
                  payment_status: String(row.payment_status),
                  total_price: Number(row.total_price),
                  payment_method: row.payment_method ?? null,
                  verified_at: row.paid_at ?? null,
                  paid_at: row.paid_at ?? null,
                  created_at: String(row.created_at),
                })),
              );
            });
        },
      )
      .onTable({
          event: "*",
          schema: "public",
          table: "cashier_shifts",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        () => {
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
              setActiveShifts(
                (data ?? []).map((row) => ({
                  ...row,
                  opening_cash: Number(row.opening_cash),
                })) as OwnerActiveShift[],
              );
            });
        },
      )
      .onTable({
          event: "*",
          schema: "public",
          table: "restaurant_tables",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        () => {
          void refreshRestaurantConfig().catch((refreshError) => {
            setError(
              refreshError instanceof Error
                ? refreshError.message
                : "Failed to refresh table configuration.",
            );
          });
        },
      )
      .onTable({
          event: "*",
          schema: "public",
          table: "menu_items",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        () => {
          void refreshMenu().catch((refreshError) => {
            setError(
              refreshError instanceof Error
                ? refreshError.message
                : "Failed to refresh menu items.",
            );
          });
        },
      )
      .onTable({
          event: "*",
          schema: "public",
          table: "kitchen_stations",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        () => {
          void refreshKitchenStations().catch((refreshError) => {
            setError(
              refreshError instanceof Error
                ? refreshError.message
                : "Failed to refresh kitchen stations.",
            );
          });
        },
      )
      .onTable({
          event: "*",
          schema: "public",
          table: "restaurant_staff",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        () => {
          void refreshStaff().catch((refreshError) => {
            setError(
              refreshError instanceof Error
                ? refreshError.message
                : "Failed to refresh staff.",
            );
          });
        },
      )
      .onTable({
          event: "UPDATE",
          schema: "public",
          table: "restaurants",
          filter: `id=eq.${restaurantId}`,
        },
        () => {
          void refreshRestaurantConfig().catch((refreshError) => {
            setError(
              refreshError instanceof Error
                ? refreshError.message
                : "Failed to refresh restaurant configuration.",
            );
          });
        },
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [restaurantId, menuItems]);

  const todayStart = startOfTodayIso();
  const todayOrders = useMemo(
    () => orders.filter((order) => order.created_at >= todayStart),
    [orders, todayStart],
  );
  const todayPayments = useMemo(
    () =>
      payments.filter(
        (payment) => Boolean(payment.paid_at) && payment.paid_at! >= todayStart,
      ),
    [payments, todayStart],
  );
  const revenueOrders = useMemo(
    () => todayOrders.filter(isRevenueOrder),
    [todayOrders],
  );
  const allRevenueOrders = useMemo(
    () => orders.filter(isRevenueOrder),
    [orders],
  );
  const revenueForPeriod = (period: AnalyticsPeriod) => {
    const { rangeStart, rangeEnd } = getAnalyticsDateRange(period);
    return payments
      .filter(
        (payment) =>
          payment.payment_status === "paid" &&
          Boolean(payment.paid_at) &&
          payment.paid_at! >= rangeStart &&
          payment.paid_at! < rangeEnd,
      )
      .reduce((sum, payment) => sum + payment.total_price, 0);
  };
  const todayRevenue = revenueForPeriod("today");
  const weekRevenue = revenueForPeriod("week");
  const monthRevenue = revenueForPeriod("month");
  const allRevenue = monthRevenue;
  const todayBillsPrinted = dashboardReports.today.bills_printed;
  const todayBillsReprinted = dashboardReports.today.bills_reprinted;
  const todayAverageBill = dashboardReports.today.average_bill;
  const todayLargestBill = dashboardReports.today.largest_bill;
  const todayVatCollected = dashboardReports.today.vat_collected;
  const activeOrders = useMemo(
    () =>
      orders.filter((order) =>
        ACTIVE_ORDER_STATUSES.includes(order.operational_status),
      ),
    [orders],
  );
  const pendingOrders = useMemo(
    () => orders.filter((order) => order.operational_status === "new"),
    [orders],
  );
  const completedToday = useMemo(
    () =>
      orders.filter(
        (order) =>
          ["served", "closed"].includes(order.operational_status) &&
          (order.completed_at ?? order.created_at) >= todayStart,
      ),
    [orders, todayStart],
  );
  const avgOrderValue = Math.round(dashboardReports.today.average_order_value);
  const activeStaff = staff.filter(
    (member) => isOperationalStaff(member) && member.active,
  ).length;
  const kitchenStaff = staff.filter(
    (member) => member.role === "kitchen" && member.active,
  );
  const cashierStaff = staff.filter(
    (member) => member.role === "cashier" && member.active,
  );

  const sparkData = Array.from({ length: 7 }, (_, index) => {
    const hour = new Date();
    hour.setHours(hour.getHours() - (6 - index), 0, 0, 0);
    return todayPayments
      .filter((payment) => sameHour(payment.paid_at ?? "", hour.getHours()))
      .reduce((sum, payment) => sum + payment.total_price, 0);
  });
  const sparkMax = Math.max(...sparkData, 1);

  const barHours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const barData = barHours.map((hour) =>
    todayPayments
      .filter((payment) => sameHour(payment.paid_at ?? "", hour))
      .reduce((sum, payment) => sum + payment.total_price, 0),
  );
  const orderBarData = barHours.map(
    (hour) =>
      todayPayments.filter((payment) => sameHour(payment.paid_at ?? "", hour))
        .length,
  );
  const barMax = Math.max(...barData, 1);
  const orderBarMax = Math.max(...orderBarData, 1);

  const methods = ["Cash", "Telebirr", "CBE Birr", "Card", "Chapa"];
  const colors = [
    "#0f766e",
    "#f59e0b",
    "#475569",
    "#7c3aed",
    "#ef4444",
    "#0891b2",
  ];
  const methodTotals = methods.map((method) =>
    todayPayments
      .filter(
        (payment) =>
          (payment.payment_method === "Credit/Debit Card"
            ? "Card"
            : payment.payment_method) === method,
      )
      .reduce((sum, payment) => sum + payment.total_price, 0),
  );
  const methodTotal = Math.max(
    methodTotals.reduce((sum, value) => sum + value, 0),
    1,
  );
  const donutData = methods
    .map((method, index) => ({
      label: method,
      pct: Math.round((methodTotals[index] / methodTotal) * 100),
      color: colors[index],
    }))
    .filter((item) => item.pct > 0);
  if (donutData.length === 0)
    donutData.push({ label: "No payments yet", pct: 100, color: "#e2e8f0" });

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

  const revenueInvoiceIds = useMemo(
    () => new Set(payments.map((payment) => payment.id)),
    [payments],
  );
  const topItems = useMemo(() => {
    const totals = new Map<
      string,
      { name: string; quantity: number; revenue: number }
    >();
    for (const item of orderItems) {
      if (!item.invoice_id || !revenueInvoiceIds.has(item.invoice_id)) continue;
      const key = item.menu_item_id ?? item.name;
      const current = totals.get(key) ?? {
        name: item.name,
        quantity: 0,
        revenue: 0,
      };
      current.quantity += item.quantity;
      current.revenue += item.quantity * item.price;
      totals.set(key, current);
    }
    return [...totals.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6);
  }, [orderItems, revenueInvoiceIds]);

  const dateStr = now.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

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
      .select(
        "id,user_id,display_name,email,username,phone_number,role,assigned_kitchen_station_id,active,created_at,last_login_at,staff_session_active,waiter_session_active",
      )
      .eq("restaurant_id", restaurantId)
      .neq("role", "owner")
      .order("created_at", { ascending: true });

    if (staffError) {
      throw new Error(staffError.message);
    }

    setStaff((data ?? []) as OdStaff[]);
  }

  async function refreshMenu() {
    const [
      { data: menuData, error: menuError },
      { data: categoryData, error: categoryError },
    ] = await Promise.all([
      supabase
        .from("menu_items")
        .select(
          "id,name,description,ingredients,allergens,preparation_time_minutes,spice_level,dietary_tags,calories,protein_g,carbohydrates_g,fat_g,fiber_g,sugar_g,sodium_mg,price,available,category_id,kitchen_station_id,image_url,archived_at,recipe_id,direct_inventory_item_id,recipes!menu_items_recipe_same_restaurant(name,status),inventory_items!menu_items_direct_inventory_item_same_restaurant(name)",
        )
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

    setMenuItems(
      (menuData ?? []).map((row) => ({
        ...row,
        price: Number(row.price),
        recipe_name: (Array.isArray(row.recipes) ? row.recipes[0] : row.recipes)?.name ?? null,
        recipe_status: (Array.isArray(row.recipes) ? row.recipes[0] : row.recipes)?.status ?? null,
        direct_inventory_item_name:
          (Array.isArray(row.inventory_items) ? row.inventory_items[0] : row.inventory_items)?.name ?? null,
      })) as OdMenuItem[],
    );
    setCategories((categoryData ?? []) as OdCategory[]);
  }

  async function refreshKitchenStations() {
    const { data, error: stationError } = await supabase.rpc(
      "get_owner_kitchen_stations",
      {
        target_restaurant_id: restaurantId,
      },
    );
    if (stationError) throw new Error(stationError.message);
    setKitchenStations(
      ((data ?? []) as Record<string, unknown>[]).map((row) =>
        normalizeKitchenStation(row),
      ),
    );
  }

  async function refreshRestaurantConfig() {
    const [
      { data: restaurantData, error: restaurantError },
      { data: tableData, error: tableError },
    ] = await Promise.all([
      supabase
        .from("restaurants")
        .select(
          "id,name,slug,total_tables,table_count,profile,business_hours,kitchen_settings,ordering_settings,payment_policy,vat_enabled,vat_percentage,service_charge_enabled,service_charge_percentage,branding,notification_settings,security_settings,subscription_plan,billing_status,currency_code,currency_symbol,locale,date_format,time_format,menu_theme,setup_status",
        )
        .eq("id", restaurantId)
        .maybeSingle(),
      supabase
        .from("restaurant_tables")
        .select(
          "id,restaurant_id,table_number,label,qr_path,qr_url,qr_created_at,qr_regenerated_at,active,created_at",
        )
        .eq("restaurant_id", restaurantId)
        .order("table_number", { ascending: true }),
    ]);

    if (restaurantError) throw new Error(restaurantError.message);
    if (tableError) throw new Error(tableError.message);
    if (restaurantData)
      setRestaurantConfig(
        buildRestaurantConfig(
          restaurantData as Record<string, unknown>,
          restaurantName,
        ),
      );
    setRestaurantTables(
      (tableData ?? []).map((row) =>
        normalizeRestaurantTable(row as Record<string, unknown>),
      ),
    );
  }

  const dashboardData = {
    restaurantName,
    orders,
    payments,
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
    todayBillsPrinted,
    todayBillsReprinted,
    todayAverageBill,
    todayLargestBill,
    todayVatCollected,
    r,
    cx,
    cy,
    loading,
    dashboardReportsLoading,
  };
  const currentNavLabel = NAV_ITEMS.find((item) => item.id === nav)?.label ?? "Dashboard";

  function handleDashboardNavigate(nextNav: OwnerNavTarget) {
    if (nextNav === "recipes") {
      window.history.pushState({}, "", "/owner/recipes");
      window.dispatchEvent(new PopStateEvent("popstate"));
      return;
    }
    if (nextNav === "inventory") {
      window.sessionStorage.setItem("serveflow.active-restaurant:inventory", restaurantId);
      window.history.pushState({}, "", "/inventory/dashboard");
      window.dispatchEvent(new PopStateEvent("popstate"));
      return;
    }
    setNav(nextNav);
  }

  function handleMobileNavigate(nextNav: OwnerNavTarget) {
    handleDashboardNavigate(nextNav);
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
          <button type="button" aria-label="Notifications" onClick={() => setUtilityPanel("notifications")}>
            <span className="od-mobile-bell-icon" aria-hidden="true" />
          </button>
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="od-mobile-menu-layer">
          <button
            className="od-mobile-menu-backdrop"
            type="button"
            aria-label="Close dashboard menu"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="od-mobile-menu" aria-label="Owner dashboard menu">
            <div className="od-mobile-menu-head">
              <div className="od-restaurant-badge">
                <div className="od-restaurant-avatar">
                  {restaurantName.charAt(0)}
                </div>
                <div>
                  <div className="od-restaurant-name">{restaurantName}</div>
                  <div className="od-restaurant-role">Business owner</div>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close dashboard menu"
                onClick={() => setMobileMenuOpen(false)}
              >
                Close
              </button>
            </div>
            <nav
              className="od-mobile-menu-nav"
              aria-label="Complete owner navigation"
            >
              <button type="button" className={nav === "overview" ? "active" : ""} onClick={() => handleMobileNavigate("overview")}><span>⌂</span>Dashboard</button>
              <div className="od-mobile-menu-group"><small>Operations</small>
                <button type="button" className={nav === "orders" ? "active" : ""} onClick={() => handleMobileNavigate("orders")}><span>▣</span>Orders</button>
                <button type="button" className={nav === "menu" ? "active" : ""} onClick={() => handleMobileNavigate("menu")}><span>◇</span>Menu</button>
                <button type="button" className={nav === "stations" ? "active" : ""} onClick={() => handleMobileNavigate("stations")}><span>♨</span>Kitchen</button>
                <button type="button" onClick={() => handleMobileNavigate("inventory")}><span>▦</span>Inventory</button>
                <button type="button" className={nav === "customers" ? "active" : ""} onClick={() => handleMobileNavigate("customers")}><span>◎</span>Customers</button>
                <button type="button" className={nav === "staff" ? "active" : ""} onClick={() => handleMobileNavigate("staff")}><span>♙</span>Staff</button>
              </div>
              <div className="od-mobile-menu-group"><small>Business</small>
                <button type="button" className={nav === "analytics" ? "active" : ""} onClick={() => handleMobileNavigate("analytics")}><span>$</span>Finance</button>
                <button type="button" className={nav === "reports" ? "active" : ""} onClick={() => handleMobileNavigate("reports")}><span>↗</span>Reports</button>
              </div>
              <div className="od-mobile-menu-group"><small>Management</small>
                <button type="button" className={nav === "qr" ? "active" : ""} onClick={() => handleMobileNavigate("qr")}><span>#</span>QR & Tables</button>
                <button type="button" className={nav === "printing" ? "active" : ""} onClick={() => handleMobileNavigate("printing")}><span>▤</span>Printing</button>
              </div>
              <div className="od-mobile-menu-group"><small>Help</small>
                <button type="button" onClick={() => { setUtilityPanel("help"); setMobileMenuOpen(false); }}><span>?</span>Help Center</button>
                <button type="button" onClick={() => { setUtilityPanel("about"); setMobileMenuOpen(false); }}><span>i</span>About ServeFlow</button>
                <button type="button" onClick={() => { setUtilityPanel("feedback"); setMobileMenuOpen(false); }}><span>◌</span>Send Feedback</button>
              </div>
              <div className="od-mobile-menu-group"><small>System</small>
                <button type="button" onClick={() => { setUtilityPanel("subscription"); setMobileMenuOpen(false); }}><span>◇</span>Subscription</button>
              </div>
            </nav>
            <button
              className="od-mobile-menu-signout"
              type="button"
              onClick={handleSignOut}
            >
              Sign Out
            </button>
          </aside>
        </div>
      )}

      <aside className={`od-sidebar${sidebarCollapsed ? " collapsed" : ""}`}>
        <div className="od-sidebar-brand">
          <ServeFlowBrand variant={sidebarCollapsed ? "icon-only" : "compact"} />
          <button type="button" className="od-sidebar-collapse" aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? "›" : "‹"}</button>
        </div>

        <nav className="od-nav" aria-label="Dashboard navigation">
          {NAV_SECTIONS.map((section, sectionIndex) => <section key={section.label ?? "dashboard"} className="od-nav-section">
            {section.label ? <div className="od-nav-section-label">{section.label}</div> : null}
            {section.items.map((item) => <button key={item.id} title={sidebarCollapsed ? item.label : undefined} className={`od-nav-item${nav === item.id ? " active" : ""}`} onClick={() => handleDashboardNavigate(item.id)}><span className="od-nav-icon">{item.icon}</span><span className="od-nav-label">{item.label}</span></button>)}
            {sectionIndex < NAV_SECTIONS.length - 1 ? <div className="od-nav-divider" /> : null}
          </section>)}
        </nav>

        <div className="od-sidebar-footer">
          <div className="od-sidebar-utility">
            <button type="button" onClick={() => setUtilityPanel("subscription")}><span>◇</span><b>Subscription</b></button>
            <button type="button" onClick={() => setUtilityPanel("help")}><span>?</span><b>Help & Support</b></button>
            <button type="button" onClick={() => setUtilityPanel("about")}><span>i</span><b>About ServeFlow</b></button>
          </div>
          <div className="od-restaurant-badge">
            <div className="od-restaurant-avatar">
              {restaurantName.charAt(0)}
            </div>
            <div>
              <div className="od-restaurant-name">{restaurantName}</div>
              <div className="od-restaurant-role">Business owner</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="od-main">
        <header className="od-topbar">
          <div className="od-breadcrumb"><span>Owner</span><b>/</b><strong>{currentNavLabel}</strong></div>
          <div className="od-topbar-search">
            <span className="od-search-icon">/</span>
            <input
              placeholder="Search orders, tables, staff..."
              aria-label="Search"
            />
          </div>
          <div className="od-topbar-right">
            <span className="od-topbar-date">{dateStr}</span>
            <span className="od-topbar-revenue">
              {fmtMoney(todayRevenue)} today
            </span>
            <button className="od-icon-btn" aria-label="Notifications">
              !
              <span className="od-notif-dot" />
            </button>
            <div className="od-profile">
              <div className="od-profile-avatar">
                {(ownerName ?? restaurantName).charAt(0).toUpperCase()}
              </div>
              <div className="od-profile-info">
                <div className="od-profile-name">{ownerName || "Owner"}</div>
                <div className="od-profile-role">Business Owner</div>
              </div>
            </div>
            <button className="od-btn-ghost" onClick={handleSignOut}>
              Sign Out
            </button>
          </div>
        </header>

        {error && <div className="od-error">Warning: {error}</div>}

        {nav === "overview" && (
          <ExecutiveOverviewV10
            data={dashboardData}
            ownerName={ownerName}
            onNavigate={handleDashboardNavigate}
            now={now}
          />
        )}
        {nav === "orders" && (
          <OrdersPage
            orders={orders}
            activeOrders={activeOrders}
            loading={loading}
            restaurantName={restaurantName}
          />
        )}
        {nav === "analytics" && (
          <AnalyticsPage data={dashboardData} restaurantId={restaurantId} />
        )}
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
              setRestaurantTables((previous) =>
                previous
                  .map((table) =>
                    table.id === updatedTable.id ? updatedTable : table,
                  )
                  .sort(
                    (left, right) => left.table_number - right.table_number,
                  ),
              );
            }}
          />
        )}
        {nav === "customers" && <CustomersPage restaurantId={restaurantId} />}
        {nav === "reports" && (
          <ReportsPage
            restaurantId={restaurantId}
            restaurantName={restaurantName}
          />
        )}
        {nav === "printing" && <div className="od-page"><div className="od-page-header"><div><h1 className="od-page-title">Printing</h1><p className="od-page-subtitle">Manage business receipts, order tickets, and print-ready documents from one place.</p></div></div><div className="od-card"><div className="od-card-header"><div><div className="od-card-title">Printing workspace</div><div className="od-card-subtitle">Printing preferences remain connected to the existing business configuration.</div></div></div><div className="od-empty">Printer setup and device controls will appear here when printing hardware is connected.</div></div></div>}
        {nav === "settings" && (
          <SettingsPage
            restaurantId={restaurantId}
            fallbackRestaurantName={restaurantName}
            config={restaurantConfig}
            tables={restaurantTables}
            menuItems={menuItems}
            kitchenStations={kitchenStations}
            staff={staff}
            onNavigate={(target) => setNav(target as NavId)}
            onSettingsChanged={refreshRestaurantConfig}
          />
        )}
      </div>

      <OwnerAiAdvisor
        open={aiAssistantOpen}
        onOpen={() => setAiAssistantOpen(true)}
        onClose={() => setAiAssistantOpen(false)}
        businessName={restaurantConfig?.name ?? restaurantName}
      />

      {utilityPanel && <OwnerUtilityPanel panel={utilityPanel} onClose={() => setUtilityPanel(null)} />}

      <nav
        className="od-mobile-bottom-nav"
        aria-label="Owner mobile navigation"
      >
        {[
          { id: "overview" as NavId, label: "Dashboard" },
          { id: "orders" as NavId, label: "Orders" },
          { id: "menu" as NavId, label: "Menu" },
          { id: "stations" as NavId, label: "Kitchen" },
          { id: "settings" as NavId, label: "Settings" },
        ].map((item) => (
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
  payments: OdPayment[];
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
  donutSlices: {
    label: string;
    pct: number;
    color: string;
    dash: number;
    gap: number;
    offset: number;
  }[];
  donutData: { label: string; pct: number; color: string }[];
  topItems: { name: string; quantity: number; revenue: number }[];
  todayBillsPrinted: number;
  todayBillsReprinted: number;
  todayAverageBill: number;
  todayLargestBill: number;
  todayVatCollected: number;
  r: number;
  cx: number;
  cy: number;
  loading: boolean;
  dashboardReportsLoading: boolean;
};

type OverviewRange = "today" | "yesterday" | "week" | "month" | "custom";

function ExecutiveOverviewV10({ data, now, ownerName, onNavigate }: {
  data: DashboardData;
  now: Date;
  ownerName?: string;
  onNavigate: (nav: OwnerNavTarget) => void;
}) {
  const recentOrders = [...data.orders].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5);
  const recentPayments = [...data.payments].sort((a, b) => new Date(b.paid_at ?? b.created_at).getTime() - new Date(a.paid_at ?? a.created_at).getTime()).slice(0, 4);
  const customers = new Set(data.todayOrders.map((order) => order.customer_name?.trim()).filter(Boolean)).size;
  const kitchenActive = data.activeOrders.filter((order) => ["accepted", "preparing", "ready"].includes(order.operational_status)).length;
  const pendingPayments = data.todayOrders.filter((order) => order.operational_status === "new").length;
  const completedOrders = data.completedToday.length;
  const todayStart = analyticsWindow("today", activeOwnerTimezone, undefined, undefined, now).rangeStart;
  const todayPayments = data.payments.filter((payment) => Boolean(payment.paid_at) && payment.paid_at! >= todayStart);
  const cashRevenue = todayPayments.filter((payment) => canonicalPaymentMethod(payment.payment_method) === "Cash").reduce((sum, payment) => sum + payment.total_price, 0);
  const digitalRevenue = todayPayments.filter((payment) => canonicalPaymentMethod(payment.payment_method) !== "Cash").reduce((sum, payment) => sum + payment.total_price, 0);
  const totalRevenue = cashRevenue + digitalRevenue;
  const health = [
    ["Orders today", String(data.todayOrders.length), `${data.activeOrders.length} currently active`, "neutral"],
    ["Kitchen status", kitchenActive ? `${kitchenActive} active` : "Clear", kitchenActive ? "Orders moving through kitchen" : "No active queue", kitchenActive ? "warning" : "positive"],
    ["Inventory alerts", "Review", "Open inventory health", "neutral"],
    ["Staff working", String(data.activeStaff), `${data.kitchenStaff.length} kitchen team`, "positive"],
    ["Pending payments", String(pendingPayments), pendingPayments ? "Needs attention" : "Everything settled", pendingPayments ? "warning" : "positive"],
  ];
  const performance = [
    ["Today's revenue", fmtMoney(data.todayRevenue), "Verified sales", "↗"],
    ["Average order", fmtMoney(Math.round(data.avgOrderValue)), `${data.todayOrders.length} orders today`, "≈"],
    ["Customers", String(customers), "Named customers today", "◎"],
    ["Completed orders", String(completedOrders), `${data.activeOrders.length} active`, "✓"],
  ];
  const actions: Array<[string, string, string, OwnerNavTarget, boolean?]> = [
    ["New Order", "Open order workspace", "+", "orders", true],
    ["New Menu Item", "Add to your menu", "◇", "menu"],
    ["Adjust Inventory", "Update stock levels", "▦", "inventory"],
    ["Record Expense", "Open financial reports", "−", "reports"],
    ["Generate Report", "Export performance", "↗", "reports"],
  ];

  return <main className="od-page od-v10-overview">
    <header className="od-v10-header">
      <div className="od-v10-heading">
        <span className="od-v10-eyebrow">Live operations</span>
        <h1>{getOwnerGreeting(now).greeting}, {ownerName || "Owner"}</h1>
      </div>
    </header>

    {data.loading ? <div className="od-v10-skeleton-grid" aria-label="Loading dashboard">{Array.from({ length: 10 }).map((_, index) => <div key={index} className="od-skeleton od-skel-kpi" />)}</div> : <>
      <section className="od-v10-health" aria-labelledby="business-health-title">
        <header><div><h2 id="business-health-title">Today's operations</h2></div><span className="od-live-indicator">Live now</span></header>
        <div className="od-v10-health-grid"><article className="od-v10-health-item od-v10-revenue-kpi"><span>Today's revenue</span><div><section><small>Cash</small><strong>{fmtMoney(cashRevenue)}</strong></section><section><small>Digital</small><strong>{fmtMoney(digitalRevenue)}</strong></section><section className="total"><small>Total</small><strong>{fmtMoney(totalRevenue)}</strong></section></div></article>{health.map(([name, value, detail, tone]) => <button key={name} type="button" className={`od-v10-health-item ${tone}`} onClick={() => name === "Inventory alerts" && onNavigate("inventory")} disabled={name !== "Inventory alerts"}><span>{name}</span><strong>{value}</strong><small>{detail}</small></button>)}</div>
      </section>

      <section className="od-v10-performance" aria-label="Performance summary">{performance.map(([name, value, detail, icon]) => <article key={name} className="od-v10-performance-card"><div><span>{name}</span><b>{icon}</b></div><strong>{value}</strong><small>{detail}</small></article>)}</section>

      <section className="od-v10-layout">
        <div className="od-v10-main-column">
          <article className="od-v10-panel od-v10-revenue-panel"><header><div><span className="od-v10-eyebrow">Revenue today</span><h2>Payment summary</h2></div></header><div className="od-v10-revenue-split"><div><span>Cash</span><strong>{fmtMoney(cashRevenue)}</strong></div><div><span>Digital</span><strong>{fmtMoney(digitalRevenue)}</strong></div><div className="total"><span>Total</span><strong>{fmtMoney(totalRevenue)}</strong></div></div></article>
          <article className="od-v10-panel"><header><div><span className="od-v10-eyebrow">Activity timeline</span><h2>Recent orders</h2></div><button type="button" onClick={() => onNavigate("orders")}>View all</button></header><div className="od-v10-timeline">{recentOrders.length ? recentOrders.map((order) => <button type="button" key={order.id} onClick={() => onNavigate("orders")}><span className="od-v10-timeline-icon">{order.status === "completed" ? "✓" : "•"}</span><span><strong>{fmtOrderLabel(order)}</strong><small>{order.table_number ? `Table ${order.table_number}` : "Takeout"} · {order.item_count} items · {fmtTimeAgo(order.created_at)}</small></span><span className="od-v10-timeline-end"><b>{fmtMoney(order.total_price)}</b><small className={statusClass(order.operational_status)}>{statusLabel(order.operational_status)}</small></span></button>) : <div className="od-v10-empty">Orders will appear here as your team starts serving customers.</div>}</div></article>
        </div>
        <aside className="od-v10-side-column">
          <article className="od-v10-panel od-v10-actions-panel"><header><div><span className="od-v10-eyebrow">Shortcuts</span><h2>Quick actions</h2></div></header><div>{actions.map(([name, detail, icon, target, primary]) => <button type="button" key={name} className={primary ? "primary" : ""} onClick={() => onNavigate(target)}><span>{icon}</span><span><strong>{name}</strong><small>{detail}</small></span><b>›</b></button>)}</div></article>
          <article className="od-v10-panel od-v10-payments"><header><div><span className="od-v10-eyebrow">Payments</span><h2>Latest payments</h2></div></header><div>{recentPayments.length ? recentPayments.map((payment) => <div key={payment.id}><span><strong>{canonicalPaymentMethod(payment.payment_method)}</strong><small>{fmtTimeAgo(payment.paid_at ?? payment.created_at)}</small></span><b>{fmtMoney(payment.total_price)}</b></div>) : <div className="od-v10-empty">No completed payments yet.</div>}</div></article>
        </aside>
      </section>
    </>}
  </main>;
}

function OverviewPage({
  data,
  now,
}: {
  data: DashboardData;
  staff: OdStaff[];
  ownerName?: string;
  onNavigate: (nav: NavId) => void;
  now: Date;
}) {
  const [range, setRange] = useState<OverviewRange>("today");
  const [customStart, setCustomStart] = useState(() =>
    now.toISOString().slice(0, 10),
  );
  const [customEnd, setCustomEnd] = useState(() =>
    now.toISOString().slice(0, 10),
  );

  const { start, end, label } = useMemo(() => {
    const canonicalWindow = analyticsWindow(
      range,
      activeOwnerTimezone,
      customStart,
      customEnd,
      now,
    );
    const endOfRange = new Date(now);
    endOfRange.setHours(23, 59, 59, 999);
    const startOfRange = new Date(now);
    startOfRange.setHours(0, 0, 0, 0);
    if (range === "yesterday") {
      startOfRange.setDate(startOfRange.getDate() - 1);
      endOfRange.setDate(endOfRange.getDate() - 1);
    }
    if (range === "week")
      startOfRange.setDate(
        startOfRange.getDate() - ((startOfRange.getDay() + 6) % 7),
      );
    if (range === "month") startOfRange.setDate(1);
    if (range === "custom") {
      const selectedStart = new Date(`${customStart}T00:00:00`);
      const selectedEnd = new Date(`${customEnd}T23:59:59.999`);
      return {
        start: new Date(canonicalWindow.rangeStart).getTime(),
        end: new Date(canonicalWindow.rangeEnd).getTime(),
        label: `${selectedStart.toLocaleDateString()} – ${selectedEnd.toLocaleDateString()}`,
      };
    }
    return {
      start: new Date(canonicalWindow.rangeStart).getTime(),
      end: new Date(canonicalWindow.rangeEnd).getTime(),
      label:
        range === "today"
          ? "Today"
          : range === "yesterday"
            ? "Yesterday"
            : range === "week"
              ? "This Week"
              : "This Month",
    };
  }, [customEnd, customStart, now, range]);

  const inRange = (iso: string | null) =>
    Boolean(iso) &&
    new Date(iso!).getTime() >= start &&
    new Date(iso!).getTime() < end;
  const rangeOrders = data.orders.filter((order) => inRange(order.created_at));
  const rangePayments = data.payments.filter((payment) =>
    inRange(payment.paid_at),
  );
  const cashRevenue = rangePayments
    .filter(
      (payment) => canonicalPaymentMethod(payment.payment_method) === "Cash",
    )
    .reduce((sum, payment) => sum + payment.total_price, 0);
  const digitalRevenue = rangePayments
    .filter(
      (payment) => canonicalPaymentMethod(payment.payment_method) !== "Cash",
    )
    .reduce((sum, payment) => sum + payment.total_price, 0);
  const totalRevenue = cashRevenue + digitalRevenue;
  const pendingPayments = rangeOrders.filter(
    (order) => order.operational_status === "new",
  ).length;
  const kitchenWaiting = rangeOrders.filter(
    (order) =>
      order.operational_status === "accepted" ||
      order.operational_status === "preparing",
  ).length;
  const ordersInProgress = rangeOrders.filter((order) =>
    ["accepted", "preparing", "ready"].includes(order.operational_status),
  ).length;
  const activeRangeOrders = rangeOrders.filter((order) =>
    ACTIVE_ORDER_STATUSES.includes(order.operational_status),
  );
  const activeTables = new Set(
    activeRangeOrders.map((order) => order.table_number).filter(Boolean),
  ).size;
  const namedCustomers = new Set(
    rangeOrders
      .map((order) => order.customer_name?.trim().toLowerCase())
      .filter(Boolean),
  );
  const anonymousCustomers = rangeOrders.filter(
    (order) => !order.customer_name?.trim(),
  ).length;
  const customers = namedCustomers.size + anonymousCustomers;
  const averageBill = rangePayments.length
    ? totalRevenue / rangePayments.length
    : 0;
  const kitchenDurations = rangeOrders
    .filter((order) => order.completed_at && order.payment_verified_at)
    .map((order) =>
      Math.max(
        0,
        new Date(order.completed_at!).getTime() -
          new Date(order.payment_verified_at!).getTime(),
      ),
    );
  const averageKitchenMinutes = kitchenDurations.length
    ? Math.round(
        kitchenDurations.reduce((sum, duration) => sum + duration, 0) /
          kitchenDurations.length /
          60000,
      )
    : 0;
  const kpis = [
    {
      label: "Pending Payments",
      value: `${pendingPayments}`,
      detail: "Awaiting verification",
      urgent: pendingPayments > 0,
    },
    {
      label: "Kitchen Waiting",
      value: `${kitchenWaiting}`,
      detail: "Paid or preparing",
      urgent: kitchenWaiting > 0,
    },
    {
      label: "Orders In Progress",
      value: `${ordersInProgress}`,
      detail: "Live kitchen workflow",
    },
    {
      label: "Active Tables",
      value: `${activeTables}`,
      detail: "Currently serving",
    },
    { label: "Today's Customers", value: `${customers}`, detail: label },
    {
      label: "Average Bill Today",
      value: fmtMoney(Math.round(averageBill)),
      detail: label,
    },
    {
      label: "Average Kitchen Time",
      value: `${averageKitchenMinutes} min`,
      detail: label,
    },
    {
      label: "Active Staff",
      value: `${data.activeStaff}`,
      detail: "Available now",
    },
  ];

  return (
    <div className="od-page od-executive-overview">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">Executive Overview</h1>
          <p className="od-page-subtitle">
            Live operational performance for {data.restaurantName} · {label}
          </p>
        </div>
        <div className="od-overview-filter" aria-label="Overview date range">
          {(
            ["today", "yesterday", "week", "month", "custom"] as OverviewRange[]
          ).map((option) => (
            <button
              key={option}
              type="button"
              className={range === option ? "active" : ""}
              onClick={() => setRange(option)}
            >
              {option === "week"
                ? "This Week"
                : option === "month"
                  ? "This Month"
                  : option.charAt(0).toUpperCase() + option.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {range === "custom" ? (
        <div className="od-custom-range">
          <label>
            From
            <input
              type="date"
              value={customStart}
              max={customEnd}
              onChange={(event) => setCustomStart(event.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={customEnd}
              min={customStart}
              onChange={(event) => setCustomEnd(event.target.value)}
            />
          </label>
        </div>
      ) : null}
      {data.loading ? (
        <div className="od-executive-grid">
          {Array.from({ length: 9 }).map((_, index) => (
            <div key={index} className="od-skeleton od-skel-kpi" />
          ))}
        </div>
      ) : (
        <>
          <section
            className="od-revenue-card"
            aria-label="Revenue for selected range"
          >
            <header>
              <div>
                <span>Revenue</span>
                <strong>{label}</strong>
              </div>
              <span className="od-live-indicator">Live</span>
            </header>
            <div>
              <article>
                <span>Cash</span>
                <strong>{fmtMoney(cashRevenue)}</strong>
              </article>
              <article>
                <span>Digital</span>
                <strong>{fmtMoney(digitalRevenue)}</strong>
              </article>
              <article className="total">
                <span>Total</span>
                <strong>{fmtMoney(totalRevenue)}</strong>
              </article>
            </div>
          </section>
          <section className="od-executive-grid">
            {kpis.map((kpi) => (
              <article
                key={kpi.label}
                className={`od-executive-kpi${kpi.urgent ? " urgent" : ""}`}
              >
                <div className="od-kpi-label">{kpi.label}</div>
                <strong>{kpi.value}</strong>
                <span>{kpi.detail}</span>
              </article>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function OwnerMobileOverview({
  data,
  ownerName,
  onNavigate,
  now,
}: {
  data: DashboardData;
  ownerName?: string;
  onNavigate: (nav: NavId) => void;
  now: Date;
}) {
  const { dashboardLabel, greeting } = getOwnerGreeting(now);
  const recentOrders = [...data.orders]
    .sort(
      (left, right) =>
        new Date(right.created_at).getTime() -
        new Date(left.created_at).getTime(),
    )
    .slice(0, 3);
  const mobileKpis = [
    {
      icon: "$",
      label: "Today's Revenue",
      value: data.dashboardReportsLoading
        ? "Loading..."
        : fmtMoney(data.todayRevenue),
      delta: "12%",
      tone: "up",
    },
    {
      icon: "[]",
      label: "Active Orders",
      value: `${data.activeOrders.length}`,
      delta: "8%",
      tone: "up",
    },
    {
      icon: "o",
      label: "New Customers",
      value: `${Math.max(data.completedToday.length, data.orders.filter((order) => order.customer_name).length)}`,
      delta: "0%",
      tone: "flat",
    },
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
        <h2>
          {greeting}, {ownerName || "Admin"}
        </h2>
      </div>

      <div className="od-mobile-kpis">
        {mobileKpis.map((kpi, index) => (
          <article
            key={kpi.label}
            className={`od-mobile-kpi${index === 0 ? " featured" : ""}`}
          >
            <div className="od-mobile-kpi-top">
              <span className="od-mobile-kpi-icon">{kpi.icon}</span>
              <span className={`od-mobile-delta ${kpi.tone}`}>
                + {kpi.delta}
              </span>
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
          <button
            key={action.label}
            type="button"
            className={action.primary ? "primary" : ""}
            onClick={() => onNavigate(action.nav)}
          >
            <span>{action.icon}</span>
            {action.label}
          </button>
        ))}
      </div>

      <div className="od-mobile-section-heading inline">
        <h3>Recent Activity</h3>
        <button type="button" onClick={() => onNavigate("orders")}>
          View All
        </button>
      </div>
      <div className="od-mobile-activity">
        {recentOrders.length === 0 ? (
          <div className="od-mobile-empty">
            No recent owner-visible orders yet.
          </div>
        ) : (
          recentOrders.map((order) => (
            <button
              key={order.id}
              type="button"
              className="od-mobile-activity-row"
              onClick={() => onNavigate("orders")}
            >
              <span className="od-mobile-activity-icon">[]</span>
              <span className="od-mobile-activity-main">
                <strong>{fmtOrderLabel(order)}</strong>
                <span>
                  {order.table_number
                    ? `Table ${order.table_number}`
                    : "Takeout"}{" "}
                  - {order.item_count || 0} items
                </span>
              </span>
              <span className="od-mobile-activity-side">
                <span
                  className={`od-mobile-status ${statusClass(order.operational_status)}`}
                >
                  {statusLabel(order.operational_status)}
                </span>
                <strong>{fmtMoney(order.total_price)}</strong>
              </span>
            </button>
          ))
        )}
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
              <div
                className="od-bar"
                style={{
                  height: `${Math.max(4, (value / data.barMax) * 130)}px`,
                }}
                title={fmtMoney(value)}
              />
              <div
                className="od-bar orders"
                style={{
                  height: `${Math.max(4, (data.orderBarData[index] / data.orderBarMax) * 100)}px`,
                }}
                title={`${data.orderBarData[index]} orders`}
              />
            </div>
            <div className="od-bar-label">
              {data.barHours[index] < 12
                ? `${data.barHours[index]}AM`
                : data.barHours[index] === 12
                  ? "12PM"
                  : `${data.barHours[index] - 12}PM`}
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
  const preparing = data.activeOrders.filter(
    (order) => order.status === "preparing",
  ).length;
  const ready = data.activeOrders.filter(
    (order) => order.status === "ready",
  ).length;
  return (
    <div className="od-kitchen-card">
      <div className="od-kitchen-title">Kitchen Status</div>
      <div className="od-kitchen-staff">
        {data.kitchenStaff.slice(0, 5).map((member) => (
          <div
            key={member.id}
            className="od-staff-chip"
            title={member.display_name}
          >
            {member.display_name.charAt(0).toUpperCase()}
          </div>
        ))}
        {data.kitchenStaff.length === 0 && (
          <div className="od-kitchen-muted">No active kitchen staff</div>
        )}
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

function RecentOrdersTable({
  orders,
  title,
  emptyLabel,
}: {
  orders: OdOrder[];
  title: string;
  emptyLabel: string;
}) {
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
                    <span className="od-order-id">{fmtOrderLabel(order)}</span>
                  </td>
                  <td>
                    {order.table_number
                      ? `Table ${order.table_number}`
                      : "No table"}
                  </td>
                  <td>{order.customer_name || "Guest"}</td>
                  <td>{order.item_count || "-"}</td>
                  <td>
                    <span className="od-amount">
                      {fmtMoney(order.total_price)}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`od-status-badge ${statusClass(order.operational_status)}`}
                    >
                      {statusLabel(order.operational_status)}
                    </span>
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

function OrdersPage({
  orders,
  activeOrders,
  loading,
  restaurantName,
}: {
  orders: OdOrder[];
  activeOrders: OdOrder[];
  loading: boolean;
  restaurantName: string;
}) {
  const [tab, setTab] = useState<string>("active");
  const tabs = [
    ["active", "Active"],
    ["new", "New"],
    ["accepted", "Accepted"],
    ["preparing", "Preparing"],
    ["ready", "Ready"],
    ["served", "Served"],
    ["closed", "Closed"],
  ];
  const filtered =
    tab === "active"
      ? activeOrders
      : orders.filter((order) => order.operational_status === tab);

  return (
    <div className="od-page od-operations-page od-orders-experience">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">Live Order Center</h1>
          <p className="od-page-subtitle">
            Real-time operational command center for {restaurantName}
          </p>
        </div>
        <div className="od-active-pill-large">
          <strong>{activeOrders.length}</strong>
          <span>Active Orders</span>
        </div>
      </div>

      <div className="od-kanban">
        {(["new", "accepted", "preparing", "ready"] as OperationalStatus[]).map(
          (status) => (
            <div
              key={status}
              className={`od-order-lane ${statusClass(status)}`}
            >
              <div className="od-lane-header">
                <span>{statusLabel(status)}</span>
                <strong>
                  {
                    orders.filter(
                      (order) => order.operational_status === status,
                    ).length
                  }
                </strong>
              </div>
              {orders
                .filter((order) => order.operational_status === status)
                .slice(0, 3)
                .map((order) => (
                  <div key={order.id} className="od-order-card">
                    <div className="od-order-card-top">
                      <strong>{fmtOrderLabel(order)}</strong>
                      <span>{fmtTimeAgo(order.created_at)}</span>
                    </div>
                    <div className="od-order-table">
                      {order.table_number
                        ? `Table ${order.table_number}`
                        : "No table"}
                    </div>
                    <div className="od-order-customer">
                      {order.customer_name || "Guest"}
                    </div>
                    <div className="od-order-card-bottom">
                      <strong>{fmtMoney(order.total_price)}</strong>
                      <span>{order.item_count || 0} items</span>
                    </div>
                  </div>
                ))}
              {orders.filter((order) => order.operational_status === status)
                .length === 0 && <div className="od-lane-empty">No orders</div>}
            </div>
          ),
        )}
      </div>

      <div className="od-tabs">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            className={`od-tab${tab === value ? " active" : ""}`}
            onClick={() => setTab(value)}
          >
            {label} (
            {value === "active"
              ? activeOrders.length
              : orders.filter((order) => order.operational_status === value)
                  .length}
            )
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
                      <span className="od-order-id">
                        {fmtOrderLabel(order)}
                      </span>
                    </td>
                    <td>
                      {order.table_number
                        ? `Table ${order.table_number}`
                        : "No table"}
                    </td>
                    <td>{order.customer_name || "Guest"}</td>
                    <td>{order.payment_method || "-"}</td>
                    <td>
                      <span className="od-amount">
                        {fmtMoney(order.total_price)}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--od-muted)" }}>
                      {fmtDateTime(order.created_at)}
                    </td>
                    <td>
                      <span
                        className={`od-status-badge ${statusClass(order.operational_status)}`}
                      >
                        {statusLabel(order.operational_status)}
                      </span>
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

type FinancialPeriod = AnalyticsPeriod | "custom";
type FinancialInvoice = {
  id: string;
  status: string;
  total: number;
  method: string;
  verifiedAt: string;
};

function AnalyticsPage({
  data,
  restaurantId,
}: {
  data: DashboardData;
  restaurantId: string;
}) {
  const [period, setPeriod] = useState<FinancialPeriod>("today");
  const [customStart, setCustomStart] = useState(() =>
    toDateInputValue(new Date()),
  );
  const [customEnd, setCustomEnd] = useState(() =>
    toDateInputValue(new Date()),
  );
  const [invoices, setInvoices] = useState<FinancialInvoice[]>([]);
  const [loadingPeriodReport, setLoadingPeriodReport] = useState(true);
  const [periodReportError, setPeriodReportError] = useState<string | null>(
    null,
  );

  const ranges = useMemo(() => {
    const selected =
      period === "custom"
        ? getDateInputRange(customStart, customEnd)
        : getAnalyticsDateRange(period);
    const start = new Date(selected.rangeStart);
    const end = new Date(selected.rangeEnd);
    const duration = end.getTime() - start.getTime();
    const previousEnd = new Date(start);
    const previousStart = new Date(start.getTime() - duration);
    if (period === "month")
      previousStart.setMonth(previousEnd.getMonth() - 1, 1);
    return {
      selected,
      previous: {
        rangeStart: previousStart.toISOString(),
        rangeEnd: previousEnd.toISOString(),
      },
    };
  }, [customEnd, customStart, period]);

  useEffect(() => {
    let mounted = true;
    async function loadPeriodReport() {
      try {
        setLoadingPeriodReport(true);
        setPeriodReportError(null);
        const { data: rows, error } = await supabase
          .from("order_invoices")
          .select("id,status,payment_status,total_price,payment_method,paid_at")
          .eq("restaurant_id", restaurantId)
          .eq("payment_status", "paid")
          .gte("paid_at", ranges.previous.rangeStart)
          .lt("paid_at", ranges.selected.rangeEnd)
          .order("paid_at", { ascending: true });
        if (error) throw new Error(error.message);
        if (mounted)
          setInvoices(
            (rows ?? [])
              .filter(
                (row) => row.payment_status === "paid" && Boolean(row.paid_at),
              )
              .map((row) => ({
                id: String(row.id),
                status: String(row.payment_status),
                total: Number(row.total_price),
                method: canonicalPaymentMethod(row.payment_method),
                verifiedAt: String(row.paid_at),
              })),
          );
      } catch (loadError) {
        if (mounted)
          setPeriodReportError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load revenue report.",
          );
      } finally {
        if (mounted) setLoadingPeriodReport(false);
      }
    }

    void loadPeriodReport();
    return () => {
      mounted = false;
    };
  }, [data.payments, ranges, restaurantId]);

  const selectedInvoices = invoices.filter((invoice) =>
    isInRange(
      invoice.verifiedAt,
      ranges.selected.rangeStart,
      ranges.selected.rangeEnd,
    ),
  );
  const previousInvoices = invoices.filter((invoice) =>
    isInRange(
      invoice.verifiedAt,
      ranges.previous.rangeStart,
      ranges.previous.rangeEnd,
    ),
  );
  const normalizeMethod = (method: string) => {
    const value = method.toLowerCase();
    if (value === "cash") return "Cash";
    if (value.includes("telebirr")) return "Telebirr";
    if (value.includes("cbe")) return "CBE Birr";
    if (
      value.includes("card") ||
      value.includes("credit") ||
      value.includes("debit")
    )
      return "Card";
    return "Other Digital";
  };
  const methodNames = ["Cash", "Telebirr", "CBE Birr", "Card", "Other Digital"];
  const methodTotals = methodNames.map((method) => ({
    method,
    total: selectedInvoices
      .filter((invoice) => normalizeMethod(invoice.method) === method)
      .reduce((sum, invoice) => sum + invoice.total, 0),
  }));
  const grossRevenue = selectedInvoices.reduce(
    (sum, invoice) => sum + invoice.total,
    0,
  );
  const previousRevenue = previousInvoices.reduce(
    (sum, invoice) => sum + invoice.total,
    0,
  );
  const vat = grossRevenue - grossRevenue / 1.15;
  const netRevenue = grossRevenue - vat;
  const comparison =
    previousRevenue === 0
      ? grossRevenue === 0
        ? 0
        : 100
      : ((grossRevenue - previousRevenue) / previousRevenue) * 100;
  const periodLabel =
    period === "today"
      ? "Today"
      : period === "week"
        ? "This Week"
        : period === "month"
          ? "This Month"
          : "Custom";
  const comparisonLabel =
    period === "today"
      ? "Today vs Yesterday"
      : period === "week"
        ? "Week vs Last Week"
        : period === "month"
          ? "Month vs Last Month"
          : "Custom vs Previous Period";
  const bucket = (key: (date: Date) => string) =>
    [
      ...selectedInvoices
        .reduce((map, invoice) => {
          const label = key(new Date(invoice.verifiedAt));
          map.set(label, (map.get(label) ?? 0) + invoice.total);
          return map;
        }, new Map<string, number>())
        .entries(),
    ].map(([label, value]) => ({ label, value }));
  const hourly = bucket((date) =>
    date.toLocaleTimeString([], { hour: "numeric" }),
  );
  const daily = bucket((date) =>
    date.toLocaleDateString([], { month: "short", day: "numeric" }),
  );
  const weekly = bucket((date) => {
    const first = new Date(date);
    first.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return `Week of ${first.toLocaleDateString([], { month: "short", day: "numeric" })}`;
  });
  const monthly = bucket((date) =>
    date.toLocaleDateString([], { month: "short", year: "numeric" }),
  );
  const trend =
    period === "today" ? hourly : period === "month" ? daily : daily;
  const distributionTotal = Math.max(grossRevenue, 1);

  return (
    <div className="od-page od-finance-center">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">Finance</h1>
          <p className="od-page-subtitle">
            Revenue, payments, taxes, and daily financial performance.
          </p>
        </div>
        <div className="od-tabs">
          {(["today", "week", "month", "custom"] as FinancialPeriod[]).map(
            (option) => (
              <button
                key={option}
                type="button"
                className={`od-tab${period === option ? " active" : ""}`}
                onClick={() => setPeriod(option)}
              >
                {option === "today"
                  ? "Today"
                  : option === "week"
                    ? "Week"
                    : option === "month"
                      ? "Month"
                      : "Custom"}
              </button>
            ),
          )}
        </div>
      </div>

      <nav className="od-finance-capabilities" aria-label="Finance workspaces">
        {["Revenue", "Expenses", "Profit", "Cash Register", "Payment Methods", "Taxes", "Refunds", "Daily Closing", "Financial Summary"].map((item, index) => <button type="button" key={item} className={index === 0 ? "active" : ""}><span>{["↗", "−", "+", "▤", "◇", "%", "↙", "✓", "◎"][index]}</span>{item}</button>)}
      </nav>

      {periodReportError && (
        <div className="od-error-inline">{periodReportError}</div>
      )}
      {period === "custom" ? (
        <div className="od-custom-range">
          <label>
            From
            <input
              type="date"
              value={customStart}
              max={customEnd}
              onChange={(event) => setCustomStart(event.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={customEnd}
              min={customStart}
              onChange={(event) => setCustomEnd(event.target.value)}
            />
          </label>
        </div>
      ) : null}

      <div className="od-financial-breakdown">
        {methodTotals.map((row) => (
          <article key={row.method}>
            <span>{row.method}</span>
            <strong>
              {loadingPeriodReport ? "Loading..." : fmtMoney(row.total)}
            </strong>
          </article>
        ))}
        <article className="total">
          <span>Total Revenue</span>
          <strong>
            {loadingPeriodReport ? "Loading..." : fmtMoney(grossRevenue)}
          </strong>
        </article>
        <article>
          <span>VAT</span>
          <strong>
            {loadingPeriodReport ? "Loading..." : fmtMoney(Math.round(vat))}
          </strong>
        </article>
        <article>
          <span>Net Revenue</span>
          <strong>
            {loadingPeriodReport
              ? "Loading..."
              : fmtMoney(Math.round(netRevenue))}
          </strong>
        </article>
        <article>
          <span>Gross Revenue</span>
          <strong>
            {loadingPeriodReport ? "Loading..." : fmtMoney(grossRevenue)}
          </strong>
        </article>
      </div>

      <section className="od-financial-comparison">
        <div>
          <span>{comparisonLabel}</span>
          <strong className={comparison >= 0 ? "positive" : "negative"}>
            {comparison >= 0 ? "+" : ""}
            {comparison.toFixed(1)}%
          </strong>
        </div>
        <div>
          <span>{periodLabel}</span>
          <strong>{fmtMoney(grossRevenue)}</strong>
        </div>
        <div>
          <span>Previous period</span>
          <strong>{fmtMoney(previousRevenue)}</strong>
        </div>
      </section>

      <div className="od-two-col">
        <div className="od-card od-financial-chart">
          <div className="od-card-header">
            <div>
              <div className="od-card-title">Revenue Trend</div>
              <div className="od-card-subtitle">
                {periodLabel} · paid invoices only
              </div>
            </div>
          </div>
          <FinancialBars rows={trend} />
        </div>

        <div className="od-card">
          <div className="od-card-header">
            <div>
              <div className="od-card-title">Payment Method Distribution</div>
              <div className="od-card-subtitle">
                Share of collected revenue.
              </div>
            </div>
          </div>
          <div className="od-payment-distribution">
            {methodTotals.map((row) => (
              <div key={row.method}>
                <span>{row.method}</span>
                <i>
                  <b
                    style={{
                      width: `${(row.total / distributionTotal) * 100}%`,
                    }}
                  />
                </i>
                <strong>
                  {grossRevenue
                    ? Math.round((row.total / grossRevenue) * 100)
                    : 0}
                  %
                </strong>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="od-financial-chart-grid">
        <FinancialChart title="Hourly Revenue" rows={hourly} />
        <FinancialChart title="Daily Revenue" rows={daily} />
        <FinancialChart title="Weekly Revenue" rows={weekly} />
        <FinancialChart title="Monthly Revenue" rows={monthly} />
      </div>
    </div>
  );
}

function FinancialBars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="od-financial-bars">
      {rows.length ? (
        rows.map((row) => (
          <div key={row.label}>
            <strong>{fmtMoneyK(row.value)}</strong>
            <i
              style={{ height: `${Math.max(5, (row.value / max) * 130)}px` }}
            />
            <span>{row.label}</span>
          </div>
        ))
      ) : (
        <div className="od-empty compact">No paid revenue in this period</div>
      )}
    </div>
  );
}
function FinancialChart({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: number }[];
}) {
  return (
    <section className="od-card od-financial-chart">
      <div className="od-card-header">
        <div>
          <div className="od-card-title">{title}</div>
          <div className="od-card-subtitle">Paid invoices</div>
        </div>
      </div>
      <FinancialBars rows={rows} />
    </section>
  );
}

function TopItemsTable({
  topItems,
  menuItems,
}: {
  topItems: { name: string; quantity: number; revenue: number }[];
  menuItems: OdMenuItem[];
}) {
  const rows =
    topItems.length > 0
      ? topItems
      : menuItems
          .slice(0, 6)
          .map((item) => ({ name: item.name, quantity: 0, revenue: 0 }));

  return (
    <div className="od-card">
      <div className="od-card-header">
        <div>
          <div className="od-card-title">Top Selling Items</div>
          <div className="od-card-subtitle">
            Menu popularity based on persisted order items.
          </div>
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
                    <span
                      className={`od-item-badge ${index === 0 ? "bestseller" : index === 1 ? "trending" : "stable"}`}
                    >
                      {index === 0
                        ? "Best Seller"
                        : index === 1
                          ? "Trending"
                          : "Stable"}
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
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - date.getTime()) / 60000),
  );
  if (minutes < 2) return "Online Now";
  if (minutes < 60) return `${minutes} minutes ago`;

  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);

  if (date >= startToday) return "Today";
  if (date >= startYesterday) return "Yesterday";

  const days = Math.max(
    1,
    Math.floor((startToday.getTime() - date.getTime()) / 86400000),
  );
  return `${days} days ago`;
}

function staffActionLabel(action: StaffActivityLog["action"]) {
  const labels: Record<StaffActivityLog["action"], string> = {
    staff_created: "Staff Created",
    staff_deactivated: "Staff Deactivated",
    staff_reactivated: "Staff Reactivated",
    password_reset_sent: "Password Reset Sent",
    temporary_password_generated: "Temporary Password Generated",
    waiter_created: "Waiter Created",
    waiter_updated: "Waiter Updated",
    waiter_activated: "Waiter Activated",
    waiter_deactivated: "Waiter Deactivated",
    waiter_pin_reset: "Waiter PIN Reset",
    waiter_deleted: "Waiter Deleted",
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

function isWaiterAction(action: StaffActivityLog["action"]) {
  return action.startsWith("waiter_");
}

function staffActivityTargetLabel(entry: StaffActivityLog) {
  if (isWaiterAction(entry.action)) {
    const username = entry.details.username;
    const displayName = entry.details.display_name;
    if (typeof displayName === "string" && displayName.trim()) {
      return displayName;
    }
    return typeof username === "string" && username.trim()
      ? username
      : "Waiter record";
  }

  if (isKitchenStaffStationAction(entry.action)) {
    const staffName = entry.details.staff_name;
    const oldStation = entry.details.old_station;
    const newStation = entry.details.new_station;
    const nameLabel =
      typeof staffName === "string" && staffName.trim()
        ? staffName
        : entry.target_staff_email || "Kitchen staff";
    const newLabel =
      typeof newStation === "string" && newStation.trim()
        ? newStation
        : "No station";
    if (typeof oldStation === "string" && oldStation.trim()) {
      return `${nameLabel}: ${oldStation} to ${newLabel}`;
    }
    return `${nameLabel}: ${newLabel}`;
  }

  if (isKitchenStationAction(entry.action)) {
    const stationName = entry.details.station_name;
    return typeof stationName === "string" && stationName.trim()
      ? stationName
      : "Kitchen station";
  }

  if (isMenuStationAction(entry.action)) {
    const menuItemName = entry.details.menu_item_name;
    const stationName = entry.details.station_name;
    const itemLabel =
      typeof menuItemName === "string" && menuItemName.trim()
        ? menuItemName
        : "Menu item";
    return typeof stationName === "string" && stationName.trim()
      ? `${itemLabel} - ${stationName}`
      : itemLabel;
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

type ModuleReportRpc =
  | "get_owner_menu_module_report"
  | "get_owner_kitchen_module_report"
  | "get_owner_staff_module_report"
  | "get_owner_tables_module_report"
  | "get_owner_customers_module_report";
function IndependentModuleReport({
  restaurantId,
  rpc,
  columns,
}: {
  restaurantId: string;
  rpc: ModuleReportRpc;
  columns: Array<{
    key: string;
    label: string;
    money?: boolean;
    suffix?: string;
  }>;
}) {
  const [period, setPeriod] = useState<FinancialPeriod>("today");
  const [startDate, setStartDate] = useState(toDateInputValue(new Date()));
  const [endDate, setEndDate] = useState(toDateInputValue(new Date()));
  const [payload, setPayload] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        setLoading(true);
        setReportError(null);
        const range =
          period === "custom"
            ? getDateInputRange(startDate, endDate)
            : getAnalyticsDateRange(period);
        const { data, error } = await supabase.rpc(rpc, {
          target_restaurant_id: restaurantId,
          range_start: range.rangeStart,
          range_end: range.rangeEnd,
        });
        if (error) throw new Error(error.message);
        if (mounted)
          setPayload(
            data && typeof data === "object"
              ? (data as Record<string, unknown>)
              : {},
          );
      } catch (error) {
        if (mounted)
          setReportError(
            error instanceof Error
              ? error.message
              : "Module report unavailable.",
          );
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [endDate, period, restaurantId, rpc, startDate]);
  const rows = Array.isArray(payload.rows)
    ? (payload.rows as Record<string, unknown>[])
    : [];
  return (
    <section className="od-module-report">
      <header>
        <div>
          <h2>Module Reporting</h2>
          <p>Paid invoices only</p>
        </div>
        <div className="od-tabs">
          {(["today", "week", "month", "custom"] as FinancialPeriod[]).map(
            (option) => (
              <button
                key={option}
                className={`od-tab${period === option ? " active" : ""}`}
                onClick={() => setPeriod(option)}
              >
                {option === "week"
                  ? "Week"
                  : option === "month"
                    ? "Month"
                    : option.charAt(0).toUpperCase() + option.slice(1)}
              </button>
            ),
          )}
        </div>
      </header>
      {period === "custom" ? (
        <div className="od-custom-range">
          <label>
            From
            <input
              type="date"
              value={startDate}
              max={endDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
        </div>
      ) : null}
      {reportError ? (
        <div className="od-error-inline">{reportError}</div>
      ) : null}
      <div className="od-table-wrap">
        <table className="od-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length}>Loading report…</td>
              </tr>
            ) : rows.length ? (
              rows.map((row, index) => (
                <tr
                  key={String(
                    row.id ??
                      row.name ??
                      row.staff ??
                      row.table_number ??
                      index,
                  )}
                >
                  {columns.map((column) => (
                    <td key={column.key}>
                      {column.money
                        ? fmtMoney(Number(row[column.key] ?? 0))
                        : `${String(row[column.key] ?? "—")}${column.suffix ?? ""}`}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length}>
                  <div className="od-empty compact">
                    No paid activity in this range
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {payload.top_seller ||
      payload.bottom_seller ||
      payload.most_used_table ||
      payload.new_customers !== undefined ||
      payload.returning_customers !== undefined ? (
        <footer>
          {payload.top_seller ? (
            <span>
              <b>Top Seller</b>
              {String(payload.top_seller)}
            </span>
          ) : null}
          {payload.bottom_seller ? (
            <span>
              <b>Bottom Seller</b>
              {String(payload.bottom_seller)}
            </span>
          ) : null}
          {payload.most_used_table ? (
            <span>
              <b>Most Used Table</b>
              {String(payload.most_used_table)}
            </span>
          ) : null}
          {payload.new_customers !== undefined ? (
            <span>
              <b>New Customers</b>
              {String(payload.new_customers)}
            </span>
          ) : null}
          {payload.returning_customers !== undefined ? (
            <span>
              <b>Returning Customers</b>
              {String(payload.returning_customers)}
            </span>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}

type StaffModalState =
  | { mode: "create"; member?: undefined }
  | { mode: "view" | "edit"; member: OdStaff }
  | null;

function StaffPage({
  staff,
  restaurantId,
  restaurantName,
  stations,
  onStaffChanged,
}: StaffPageProps) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<
    "all" | "manager" | "cashier" | "kitchen" | "waiter" | "inventory" | "inventory_officer"
  >("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [modal, setModal] = useState<StaffModalState>(null);
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formUsername, setFormUsername] = useState("");
  const [formPin, setFormPin] = useState("");
  const [formConfirmPassword, setFormConfirmPassword] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formRole, setFormRole] = useState<
    "manager" | "cashier" | "kitchen" | "waiter" | "inventory" | "inventory_officer"
  >("cashier");
  const [formStationId, setFormStationId] = useState("");
  const [activity, setActivity] = useState<StaffActivityLog[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [directoryMetrics, setDirectoryMetrics] = useState<
    Map<string, Record<string, unknown>>
  >(new Map());
  const [averageShiftMinutes, setAverageShiftMinutes] = useState(0);

  const activeStations = useMemo(
    () =>
      [...stations]
        .filter((station) => station.active)
        .sort(
          (left, right) =>
            left.priority - right.priority ||
            left.name.localeCompare(right.name),
        ),
    [stations],
  );
  const stationById = useMemo(
    () => new Map(stations.map((station) => [station.id, station])),
    [stations],
  );

  useEffect(() => {
    if (!modal || modal.mode !== "edit") return;
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
        if (mounted)
          setStaffError(
            activityError instanceof Error
              ? activityError.message
              : "Could not load activity log.",
          );
      }
    }
    void loadActivity();
    return () => {
      mounted = false;
    };
  }, [restaurantId, staff]);
  useEffect(() => {
    let mounted = true;
    const range = getAnalyticsDateRange("today");
    void supabase
      .rpc("get_owner_staff_module_report", {
        target_restaurant_id: restaurantId,
        range_start: range.rangeStart,
        range_end: range.rangeEnd,
      })
      .then(({ data }) => {
        if (!mounted) return;
        const payload =
          data && typeof data === "object"
            ? (data as Record<string, unknown>)
            : {};
        const rows = Array.isArray(payload.rows)
          ? (payload.rows as Record<string, unknown>[])
          : [];
        setDirectoryMetrics(new Map(rows.map((row) => [String(row.id), row])));
        setAverageShiftMinutes(Number(payload.average_shift_minutes ?? 0));
      });
    return () => {
      mounted = false;
    };
  }, [restaurantId, staff]);

  function openCreateModal() {
    setStaffError(null);
    setNotice(null);
    setFormName("");
    setFormEmail("");
    setFormUsername("");
    setFormPin("");
    setFormConfirmPassword("");
    setFormPhone("");
    setFormRole("cashier");
    setFormStationId("");
    setModal({ mode: "create" });
  }

  function openMemberModal(mode: "view" | "edit", member: OdStaff) {
    setStaffError(null);
    setNotice(null);
    setFormName(member.display_name);
    setFormEmail(member.email ?? "");
    setFormUsername(member.username ?? "");
    setFormPin("");
    setFormConfirmPassword("");
    setFormPhone(member.phone_number ?? "");
    setFormRole(
      member.role === "manager"
        ? "manager"
        : member.role === "kitchen"
          ? "kitchen"
          : member.role === "waiter"
            ? "waiter"
            : member.role === "inventory_officer"
              ? "inventory_officer"
              : member.role === "inventory"
                ? "inventory"
            : "cashier",
    );
    setFormStationId(
      member.role === "kitchen"
        ? (member.assigned_kitchen_station_id ?? "")
        : "",
    );
    setModal({ mode, member });
  }

  async function runStaffAction(
    action: () => Promise<unknown>,
    success: string,
  ) {
    try {
      setIsWorking(true);
      setStaffError(null);
      setNotice(null);
      await action();
      await onStaffChanged();
      const rows = await loadStaffActivityLog(restaurantId);
      setActivity(rows);
      setNotice(success);
    } catch (actionError) {
      setStaffError(
        actionError instanceof Error
          ? actionError.message
          : "Staff action failed.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function handleSubmitStaff(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!modal || modal.mode === "view") return;

    const assignedKitchenStationId =
      modal.mode === "edit" && formRole === "kitchen" ? formStationId || null : null;
    if (!formName.trim()) {
      setStaffError("Enter the staff member's full name.");
      return;
    }

    if (modal.mode === "create") {
      if (staffAuthEmailRequired(formRole) && !formEmail.trim()) {
        setStaffError(`Email is required for ${staffAuthRoleLabel(formRole)} accounts.`);
        return;
      }
      const credentialError = usesWaiterPin(formRole)
        ? validateWaiterPin(formPin)
        : validateStaffPasswordConfirmation(formPin, formConfirmPassword);
      if (credentialError) {
        setStaffError(credentialError);
        return;
      }
    }

    await runStaffAction(
      async () => {
        if (modal.mode === "create") {
          const result = await createStaff({
            restaurantId,
            fullName: formName,
            email: formEmail,
            password: usesWaiterPin(formRole) ? undefined : formPin,
            pin: usesWaiterPin(formRole) ? formPin : undefined,
            phoneNumber: formPhone,
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
          phoneNumber: formPhone,
          role: formRole,
          assignedKitchenStationId,
        });
        setModal(null);
        return {};
      },
      modal.mode === "create"
        ? "Staff account created."
        : "Staff profile updated.",
    );
  }

  const operationalStaff = staff.filter(isOperationalStaff);
  const businessActivityActions = new Set([
    "staff_created",
    "staff_deactivated",
    "staff_reactivated",
    "password_reset_sent",
    "temporary_password_generated",
    "waiter_created",
    "waiter_updated",
    "waiter_activated",
    "waiter_deactivated",
    "waiter_pin_reset",
    "waiter_deleted",
    "role_changed",
    "staff_updated",
    "kitchen_order_completed",
    "shift_opened",
    "shift_closed",
    "verify_payment",
    "final_bill_requested",
  ]);
  const staffActivity = activity.filter((entry) =>
    businessActivityActions.has(String(entry.action)),
  );

  const filtered = operationalStaff.filter((member) => {
    const matchesRole = roleFilter === "all" || member.role === roleFilter;
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" ? member.active : !member.active);
    const shift =
      member.staff_session_active || member.waiter_session_active
        ? "on shift"
        : "off shift";
    const haystack =
      `${member.display_name} ${member.username ?? ""} ${member.email ?? ""} ${member.role} ${member.active ? "active" : "inactive"} ${shift}`.toLowerCase();
    return (
      matchesRole &&
      matchesStatus &&
      haystack.includes(search.trim().toLowerCase())
    );
  });

  const totalStaff = operationalStaff.length;
  const activeStaff = operationalStaff.filter((member) => member.active).length;
  const currentlyWorking = operationalStaff.filter((member) =>
    Boolean(member.staff_session_active || member.waiter_session_active),
  ).length;
  const onBreak = 0;
  const offlineStaff = totalStaff - currentlyWorking - onBreak;
  const managerCount = operationalStaff.filter(
    (member) => String(member.role) === "manager",
  ).length;
  const cashierCount = operationalStaff.filter(
    (member) => member.role === "cashier",
  ).length;
  const kitchenCount = operationalStaff.filter(
    (member) => member.role === "kitchen",
  ).length;
  const waiterCount = operationalStaff.filter(
    (member) => member.role === "waiter",
  ).length;
  const inventoryOfficerCount = operationalStaff.filter(
    (member) => member.role === "inventory_officer",
  ).length;

  return (
    <div className="od-page od-operations-page od-staff-experience">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">Staff Management</h1>
          <p className="od-page-subtitle">
            Create, secure, and audit staff access for {restaurantName}.
          </p>
        </div>
        <button className="od-btn-primary" onClick={openCreateModal}>
          Add Staff
        </button>
      </div>

      {(staffError || notice) && (
        <div className={staffError ? "od-error-inline" : "od-success-inline"}>
          {staffError || notice}
        </div>
      )}

      <div className="od-kpi-grid analytics">
        {[
          ["Total Staff", totalStaff, "All roles"],
          ["Currently Working", currentlyWorking, "Live staff sessions"],
          ["On Break", onBreak, "No active breaks"],
          ["Offline", offlineStaff, "Not currently clocked in"],
          ["Managers", managerCount, "Management access"],
          ["Cashiers", cashierCount, "POS access"],
          ["Kitchen Staff", kitchenCount, "KDS access"],
          ["Waiters", waiterCount, "Shared terminal access"],
          ["Inventory Officers", inventoryOfficerCount, "Inventory access"],
          [
            "Average Shift Length",
            averageShiftMinutes
              ? `${Math.floor(averageShiftMinutes / 60)}h ${Math.round(averageShiftMinutes % 60)}m`
              : "—",
            "Today's completed and active shifts",
          ],
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
              <div className="od-card-subtitle">
                Profiles, live work status, shift context, and today's
                performance.
              </div>
            </div>
            <div className="od-staff-filters">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, username, role, status or shift"
                aria-label="Search staff"
              />
              <select
                value={roleFilter}
                onChange={(event) =>
                  setRoleFilter(event.target.value as typeof roleFilter)
                }
                aria-label="Filter by role"
              >
                <option value="all">All roles</option>
                <option value="manager">Manager</option>
                <option value="cashier">Cashier</option>
                <option value="kitchen">Kitchen</option>
                <option value="waiter">Waiter</option>
                <option value="inventory_officer">Inventory Officer</option>
                <option value="inventory">Inventory Staff (Legacy)</option>
              </select>
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as typeof statusFilter)
                }
                aria-label="Filter by status"
              >
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
                  <th>Username</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Shift</th>
                  <th>Last Login</th>
                  <th>Orders Served Today</th>
                  <th>Revenue Today</th>
                  <th>Role Metric</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10}>
                      <div className="od-empty">
                        <div className="od-empty-icon">--</div>
                        <div className="od-empty-msg">
                          No staff match these filters
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((member) => {
                    const metrics = directoryMetrics.get(member.id);
                    return (
                      <tr key={member.id}>
                        <td>
                          <div className="od-staff-cell">
                            <div className="od-staff-avatar-small">
                              {member.display_name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="od-staff-name">
                                {member.display_name}
                              </div>
                              <div className="od-staff-email">
                                {member.email ||
                                  member.username ||
                                  "Staff account"} · {member.credential_readiness === "password_ready" ? "Password ready" : member.credential_readiness === "waiter_pin_ready" ? "Waiter PIN ready" : member.role === "waiter" ? "Waiter PIN setup required" : "Password setup required"}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          {member.username || member.email || "Not stored"}
                        </td>
                        <td>
                          <span className={`od-role-badge ${member.role}`}>
                            {staffRoleLabel(member.role)}
                          </span>
                        </td>
                        <td>
                          {member.active ? (
                            <span className="od-active-pill">
                              <span className="od-active-dot" />
                              Active
                            </span>
                          ) : (
                            <span className="od-offline-pill">Inactive</span>
                          )}
                        </td>
                        <td>
                          {member.staff_session_active ||
                          member.waiter_session_active ? (
                            <span className="od-active-pill">
                              <span className="od-active-dot" />
                              On Shift
                            </span>
                          ) : (
                            <span className="od-offline-pill">Off Shift</span>
                          )}
                        </td>
                        <td>{fmtLastActive(member.last_login_at)}</td>
                        <td>{String(metrics?.orders_taken ?? 0)}</td>
                        <td>
                          {fmtMoney(Number(metrics?.revenue_generated ?? 0))}
                        </td>
                        <td>
                          {member.role === "kitchen"
                            ? `Tickets ${String(metrics?.kitchen_tickets_completed ?? 0)}`
                            : member.role === "waiter"
                              ? `Tables ${String(metrics?.tables_served ?? 0)}`
                              : `Bills ${String(metrics?.bills_requested ?? 0)}`}
                        </td>
                        <td>
                          <div className="od-row-actions">
                            <button
                              className="od-btn-ghost compact"
                              onClick={() => openMemberModal("view", member)}
                            >
                              View
                            </button>
                            <button
                              className="od-btn-ghost compact"
                              onClick={() => openMemberModal("edit", member)}
                              disabled={member.role === "owner"}
                            >
                              Edit
                            </button>
                            <button
                              className="od-btn-ghost compact"
                              onClick={() => openMemberModal("edit", member)}
                              disabled={member.role === "owner"}
                            >
                              Change Role
                            </button>
                            {member.role === "kitchen" ? (
                              <button
                                className="od-btn-ghost compact"
                                onClick={() => openMemberModal("edit", member)}
                              >
                                Assign Station
                              </button>
                            ) : null}
                            {member.active ? (
                              <button
                                className="od-btn-ghost compact danger"
                                onClick={() =>
                                  runStaffAction(
                                    () =>
                                      deactivateStaff(restaurantId, member.id),
                                    "Staff deactivated.",
                                  )
                                }
                                disabled={member.role === "owner" || isWorking}
                              >
                                Deactivate
                              </button>
                            ) : (
                              <button
                                className="od-btn-ghost compact"
                                onClick={() =>
                                  runStaffAction(
                                    () =>
                                      reactivateStaff(restaurantId, member.id),
                                    "Staff reactivated.",
                                  )
                                }
                                disabled={isWorking}
                              >
                                Reactivate
                              </button>
                            )}
                            {member.role === "waiter" && (
                              <button
                                className="od-btn-ghost compact danger"
                                onClick={() =>
                                  runStaffAction(
                                    () => deleteStaff(restaurantId, member.id),
                                    "Waiter deleted.",
                                  )
                                }
                                disabled={
                                  isWorking ||
                                  Boolean(member.waiter_session_active)
                                }
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="od-table-footer">
            Showing {filtered.length} of {operationalStaff.length} members
          </div>
        </div>

        <div className="od-side-stack">
          <div className="od-performance-card dark">
            <div className="od-performance-label">Currently Working</div>
            <div className="od-performance-person">
              {currentlyWorking}/{totalStaff}
            </div>
            <div className="od-performance-sub">
              live restaurant staff sessions
            </div>
          </div>
          <div className="od-performance-card">
            <div className="od-performance-label">Business Staff Activity</div>
            <div className="od-audit-list">
              {staffActivity.length === 0 ? (
                <div className="od-empty-sub">No staff activity yet</div>
              ) : (
                staffActivity.slice(0, 8).map((entry) => (
                  <div key={entry.id} className="od-audit-row">
                    <div className="od-audit-action">
                      {staffActionLabel(entry.action)}
                    </div>
                    <div className="od-audit-meta">
                      {staffActivityTargetLabel(entry)} -{" "}
                      {fmtTimeAgo(entry.created_at)}
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
          <div
            className="od-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Staff details"
          >
            <div className="od-modal-header">
              <div>
                <div className="od-card-title">
                  {modal.mode === "create"
                    ? "Add Staff"
                    : modal.mode === "edit"
                      ? "Edit Staff"
                      : "Staff Profile"}
                </div>
                <div className="od-card-subtitle">
                  Owners can create managers and operational restaurant staff.
                </div>
              </div>
              <button
                className="od-icon-btn"
                onClick={() => setModal(null)}
                aria-label="Close"
              >
                x
              </button>
            </div>

            <form className="od-staff-form" onSubmit={handleSubmitStaff}>
              <label>
                Full Name
                <input
                  value={formName}
                  onChange={(event) => setFormName(event.target.value)}
                  disabled={modal.mode === "view" || isWorking}
                  required
                />
              </label>
              <label>
                {staffAuthEmailRequired(formRole) ? "Email *" : "Email (optional)"}
                <input
                  type="email"
                  value={formEmail}
                  onChange={(event) => setFormEmail(event.target.value)}
                  disabled={modal.mode !== "create" || isWorking}
                  placeholder={staffAuthEmailRequired(formRole) ? "Required work email" : "Optional contact email"}
                  required={modal.mode === "create" && staffAuthEmailRequired(formRole)}
                />
              </label>
              {modal.mode === "create" && (
                usesWaiterPin(formRole) ? (
                  <label>4-digit PIN *<input type="password" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} value={formPin} onChange={(event) => setFormPin(event.target.value.replace(/\D/g, "").slice(0, 4))} disabled={isWorking} autoComplete="new-password" required /></label>
                ) : <>
                  <label>Password *<input type="password" minLength={8} maxLength={128} value={formPin} onChange={(event) => setFormPin(event.target.value)} disabled={isWorking} autoComplete="new-password" required /></label>
                  <label>Confirm Password *<input type="password" minLength={8} maxLength={128} value={formConfirmPassword} onChange={(event) => setFormConfirmPassword(event.target.value)} disabled={isWorking} autoComplete="new-password" required /></label>
                </>
              )}
              {(
                <label>
                  Phone Number
                  <input
                    value={formPhone}
                    onChange={(event) => setFormPhone(event.target.value)}
                    disabled={modal.mode === "view" || isWorking}
                    inputMode="tel"
                    placeholder="Optional"
                  />
                </label>
              )}
              <label>
                Role
                <select
                  value={formRole}
                  onChange={(event) => {
                    setFormRole(event.target.value as "manager" | "cashier" | "kitchen" | "waiter" | "inventory" | "inventory_officer");
                    if (modal.mode === "create") {
                      setFormPin("");
                      setFormConfirmPassword("");
                    }
                  }}
                  disabled={modal.mode === "view" || isWorking}
                >
                  <option value="manager">Manager</option>
                  <option value="cashier">Cashier</option>
                  <option value="kitchen">Chef</option>
                  <option value="waiter">Waiter</option>
                  <option value="inventory_officer">Inventory Officer</option>
                  <option value="inventory" disabled>Inventory Staff (Legacy)</option>
                </select>
              </label>
              {modal.mode === "edit" && formRole === "kitchen" && (
                <label>
                  Kitchen Station *
                  <select
                    value={formStationId}
                    onChange={(event) => setFormStationId(event.target.value)}
                    disabled={isWorking}
                    required
                  >
                    <option value="">Select station</option>
                    {activeStations.map((station) => (
                      <option key={station.id} value={station.id}>
                        {station.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {modal.mode !== "create" && (
                <div className="od-staff-detail-grid">
                  <span>Status</span>
                  <strong>{modal.member.active ? "Active" : "Inactive"}</strong>
                  <span>Employee ID</span>
                  <strong>{modal.member.employee_id || "-"}</strong>
                  <span>Phone</span>
                  <strong>{modal.member.phone_number || "-"}</strong>
                  <span>Created</span>
                  <strong>
                    {new Date(modal.member.created_at).toLocaleDateString()}
                  </strong>
                  <span>Last Active</span>
                  <strong>{fmtLastActive(modal.member.last_login_at)}</strong>
                  <span>Credential readiness</span>
                  <strong>{modal.member.credential_readiness === "password_ready" ? "Password ready" : modal.member.credential_readiness === "waiter_pin_ready" ? "Waiter PIN ready" : modal.member.role === "waiter" ? "Waiter PIN setup required" : "Password setup required"}</strong>
                  <span>Station</span>
                  <strong>
                    {modal.member.role === "kitchen" &&
                    modal.member.assigned_kitchen_station_id
                      ? (stationById.get(
                          modal.member.assigned_kitchen_station_id,
                        )?.name ?? "Unassigned")
                      : "-"}
                  </strong>
                </div>
              )}

              {modal.mode !== "create" && modal.member.role === "waiter" && (
                <label>
                  {modal.member.credential_readiness === "waiter_pin_ready" ? "Reset Waiter PIN" : "Set Waiter PIN"}
                  <input type="password" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} value={formPin} onChange={(event) => setFormPin(event.target.value.replace(/\D/g, "").slice(0, 4))} disabled={isWorking} autoComplete="new-password" />
                  <button type="button" className="od-btn-ghost" disabled={isWorking || formPin.length !== 4} onClick={() => void runStaffAction(() => setStaffWaiterPin(restaurantId, modal.member.id, formPin), "Waiter PIN updated.")}>Set/Reset Waiter PIN</button>
                </label>
              )}

              {modal.mode !== "create" && modal.member.role !== "waiter" && (
                <button type="button" className="od-btn-ghost" disabled={isWorking || !modal.member.email || modal.member.credential_readiness === "password_ready"} onClick={() => void runStaffAction(() => sendStaffPasswordReset(restaurantId, modal.member.id), "Password setup link sent.")}>{modal.member.credential_readiness === "reset_required" ? "Resend setup link" : "Send password setup link"}</button>
              )}

              <div className="od-modal-actions">
                <button
                  type="button"
                  className="od-btn-ghost"
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                {modal.mode !== "view" && (
                  <button
                    type="submit"
                    className="od-btn-primary"
                    disabled={isWorking}
                  >
                    {isWorking
                      ? "Saving..."
                      : modal.mode === "create"
                        ? `Create ${staffAuthRoleLabel(formRole)}`
                        : "Save Changes"}
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

const KITCHEN_STATION_COLORS = [
  "#0f766e",
  "#2563eb",
  "#d97706",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
  "#16a34a",
  "#475569",
];

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
    () =>
      [...stations].sort(
        (left, right) =>
          left.priority - right.priority || left.name.localeCompare(right.name),
      ),
    [stations],
  );
  const activeCount = sortedStations.filter((station) => station.active).length;

  function openCreateModal() {
    setStationError(null);
    setNotice(null);
    setFormName("");
    setFormDescription("");
    setFormColor(KITCHEN_STATION_COLORS[0]);
    setFormIcon(KITCHEN_STATION_ICONS[0].value);
    setFormPriority(
      String((sortedStations[sortedStations.length - 1]?.priority ?? 0) + 10),
    );
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
      if (!Number.isInteger(priority) || priority < 0 || priority > 10000)
        throw new Error("Priority must be a whole number from 0 to 10000.");

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
      setNotice(
        modal.mode === "create"
          ? "Kitchen station created."
          : "Kitchen station updated.",
      );
      setModal(null);
      await onStationsChanged();
    } catch (actionError) {
      setStationError(
        actionError instanceof Error
          ? actionError.message
          : "Kitchen station action failed.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function runStationAction(
    station: OdKitchenStation,
    action: "enable" | "disable" | "delete",
  ) {
    if (
      action === "delete" &&
      !window.confirm(`Delete ${station.name}? This cannot be undone.`)
    )
      return;

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
      setNotice(
        action === "delete"
          ? "Kitchen station deleted."
          : action === "enable"
            ? "Kitchen station enabled."
            : "Kitchen station disabled.",
      );
      await onStationsChanged();
    } catch (actionError) {
      setStationError(
        actionError instanceof Error
          ? actionError.message
          : "Kitchen station action failed.",
      );
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <div className="od-page od-operations-page od-kitchen-experience">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">Kitchen Stations</h1>
          <p className="od-page-subtitle">
            Create and manage kitchen station foundations for future routing.
          </p>
        </div>
        <div className="od-header-actions">
          <button
            className="od-btn-primary"
            type="button"
            onClick={openCreateModal}
          >
            Create Station
          </button>
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
          <div className="od-kpi-value">
            {sortedStations.reduce(
              (sum, station) => sum + station.assigned_menu_items,
              0,
            )}
          </div>
        </div>
      </section>

      <section className="od-station-grid">
        {sortedStations.length === 0 ? (
          <div className="od-card">
            <div className="od-empty">
              <div className="od-empty-msg">No kitchen stations yet</div>
              <div className="od-empty-sub">
                Main Kitchen will be created automatically.
              </div>
            </div>
          </div>
        ) : (
          sortedStations.map((station) => {
            const busy = workingId?.endsWith(station.id) || saving;
            const deleteDisabled = busy;
            return (
              <article
                key={station.id}
                className={`od-station-card ${station.active ? "active" : "inactive"}`}
              >
                <div className="od-station-head">
                  <div
                    className="od-station-icon"
                    style={{ background: station.display_color }}
                  >
                    {station.icon}
                  </div>
                  <div className="od-station-title">
                    <h2>{station.name}</h2>
                    <span
                      className={`od-status-badge ${station.active ? "paid" : "pending"}`}
                    >
                      {station.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                </div>
                {station.description ? (
                  <p className="od-station-desc">{station.description}</p>
                ) : (
                  <p className="od-station-desc muted">No description added.</p>
                )}
                <div className="od-station-meta">
                  <span>
                    <strong>{station.priority}</strong> Priority
                  </span>
                  <span>
                    <strong>{station.assigned_menu_items}</strong> Menu Items
                  </span>
                </div>
                <div className="od-row-actions">
                  <button
                    className="od-btn-ghost compact"
                    type="button"
                    onClick={() => openEditModal(station)}
                    disabled={busy}
                  >
                    Edit
                  </button>
                  <button
                    className="od-btn-ghost compact"
                    type="button"
                    onClick={() =>
                      void runStationAction(
                        station,
                        station.active ? "disable" : "enable",
                      )
                    }
                    disabled={busy}
                  >
                    {station.active ? "Disable" : "Enable"}
                  </button>
                  <button
                    className="od-btn-ghost compact danger"
                    type="button"
                    onClick={() => void runStationAction(station, "delete")}
                    disabled={deleteDisabled}
                    title={
                      station.assigned_menu_items > 0
                        ? "This station is currently in use."
                        : "Delete station"
                    }
                  >
                    Delete
                  </button>
                </div>
                {station.assigned_menu_items > 0 && (
                  <div className="od-station-hint">
                    This station is currently in use.
                  </div>
                )}
              </article>
            );
          })
        )}
      </section>

      {modal && (
        <div className="od-modal-backdrop" role="presentation">
          <div
            className="od-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Kitchen station details"
          >
            <div className="od-modal-header">
              <div>
                <div className="od-card-title">
                  {modal.mode === "create" ? "Create Station" : "Edit Station"}
                </div>
                <div className="od-card-subtitle">
                  Station names must be unique inside this restaurant.
                </div>
              </div>
              <button
                className="od-icon-btn"
                type="button"
                onClick={() => setModal(null)}
                aria-label="Close"
              >
                x
              </button>
            </div>
            <form className="od-staff-form" onSubmit={submitStation}>
              <label>
                Station Name
                <input
                  value={formName}
                  onChange={(event) => setFormName(event.target.value)}
                  disabled={saving}
                  required
                  maxLength={80}
                />
              </label>
              <label>
                Description
                <textarea
                  value={formDescription}
                  onChange={(event) => setFormDescription(event.target.value)}
                  disabled={saving}
                  rows={3}
                  maxLength={240}
                />
              </label>
              <label>
                Icon
                <select
                  value={formIcon}
                  onChange={(event) => setFormIcon(event.target.value)}
                  disabled={saving}
                >
                  {KITCHEN_STATION_ICONS.map((icon) => (
                    <option key={icon.value} value={icon.value}>
                      {icon.value} - {icon.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priority
                <input
                  type="number"
                  min="0"
                  max="10000"
                  step="1"
                  value={formPriority}
                  onChange={(event) => setFormPriority(event.target.value)}
                  disabled={saving}
                  required
                />
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
                  <input
                    type="color"
                    value={formColor}
                    onChange={(event) => setFormColor(event.target.value)}
                    disabled={saving}
                    aria-label="Custom station color"
                  />
                </div>
              </div>
              <label className="od-check-row">
                <input
                  type="checkbox"
                  checked={formActive}
                  onChange={(event) => setFormActive(event.target.checked)}
                  disabled={saving}
                />
                Active
              </label>
              <div className="od-modal-actions">
                <button
                  type="button"
                  className="od-btn-ghost"
                  onClick={() => setModal(null)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="od-btn-primary"
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save Station"}
                </button>
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
  return (
    categories.find((category) => category.id === categoryId)?.name ??
    "Uncategorized"
  );
}

function getStationName(
  stations: OdKitchenStation[],
  stationId: string | null,
) {
  return (
    stations.find((station) => station.id === stationId)?.name ?? "Main Kitchen"
  );
}

function buildMenuPhotoPath(restaurantId: string, file: File) {
  const extension =
    file.name
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "jpg";
  const token = crypto.randomUUID();
  return `${restaurantId}/${token}.${extension}`;
}

function buildMenuFilePath(restaurantId: string, file: File) {
  const extension =
    file.name
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "") ||
    (file.type === "application/pdf" ? "pdf" : "jpg");
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
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new Error(`${label} must be zero or greater.`);
  return parsed;
}

function parseOptionalNutritionInteger(label: string, value: string) {
  const parsed = parseOptionalNutritionNumber(label, value);
  if (parsed === null) return null;
  if (!Number.isInteger(parsed))
    throw new Error(`${label} must be a whole number.`);
  return parsed;
}

function parseOptionalPositiveInteger(label: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new Error(`${label} must be a whole number.`);
  return parsed;
}

function formatIngredientInput(ingredients: string[] | null | undefined) {
  return (ingredients ?? []).join("\n");
}

function parseIngredientInput(value: string) {
  const ingredients = Array.from(
    new Set(
      value
        .split(/\r?\n|,/)
        .map((ingredient) => ingredient.trim())
        .filter((ingredient) => ingredient.length > 0),
    ),
  );

  return ingredients.length > 0 ? ingredients : null;
}

function MenuPage({
  restaurantId,
  items,
  categories,
  stations,
  topItems,
  onMenuChanged,
}: MenuPageProps) {
  const menuUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [modal, setModal] = useState<MenuModalState>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState<
    "all" | "available" | "unavailable"
  >("all");
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
  const [formRecipeId, setFormRecipeId] = useState("");
  const [formDirectInventoryItemId, setFormDirectInventoryItemId] = useState("");
  const [formTrackingType, setFormTrackingType] = useState<InventoryTrackingType>("recipe");
  const [recipeSearch, setRecipeSearch] = useState("");
  const [directInventorySearch, setDirectInventorySearch] = useState("");
  const [recipeOptions, setRecipeOptions] = useState<MenuRecipeOption[]>([]);
  const [directInventoryOptions, setDirectInventoryOptions] = useState<DirectInventoryOption[]>([]);
  const [menuUploads, setMenuUploads] = useState<OdMenuUpload[]>([]);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  useEffect(() => {
    if (!modal || formTrackingType !== "recipe") return;
    const timer = window.setTimeout(() => {
      void searchActiveMenuRecipes(restaurantId, recipeSearch).then(setRecipeOptions).catch((cause) => setMenuError(cause instanceof Error ? cause.message : "Recipes could not be loaded."));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [formTrackingType, modal, recipeSearch, restaurantId]);
  useEffect(() => {
    if (!modal || formTrackingType !== "ready_to_sell") return;
    const timer = window.setTimeout(() => {
      void searchActiveDirectInventoryItems(restaurantId, directInventorySearch).then(setDirectInventoryOptions).catch((cause) => setMenuError(cause instanceof Error ? cause.message : "Inventory items could not be loaded."));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [directInventorySearch, formTrackingType, modal, restaurantId]);
  const activeStations = useMemo(
    () =>
      [...stations]
        .filter((station) => station.active)
        .sort(
          (left, right) =>
            left.priority - right.priority ||
            left.name.localeCompare(right.name),
        ),
    [stations],
  );
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch =
        !query ||
        item.name.toLowerCase().includes(query) ||
        (item.description ?? "").toLowerCase().includes(query);
      const matchesCategory =
        categoryFilter === "all" || item.category_id === categoryFilter;
      const matchesAvailability =
        availabilityFilter === "all" ||
        (availabilityFilter === "available" ? item.available : !item.available);
      const matchesStation =
        stationFilter === "all" || item.kitchen_station_id === stationFilter;
      return (
        matchesSearch &&
        matchesCategory &&
        matchesAvailability &&
        matchesStation
      );
    });
  }, [availabilityFilter, categoryFilter, items, search, stationFilter]);

  useEffect(() => {
    let mounted = true;

    async function loadMenuUploads() {
      const { data, error } = await supabase
        .from("menu_uploads")
        .select(
          "id,file_name,file_path,file_url,mime_type,size_bytes,created_at",
        )
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false });

      if (!mounted) return;
      if (error) {
        setMenuError(error.message);
        return;
      }

      setMenuUploads(
        (data ?? []).map((row) => ({
          ...row,
          size_bytes: Number(row.size_bytes),
        })) as OdMenuUpload[],
      );
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
    setMenuUploads(
      (data ?? []).map((row) => ({
        ...row,
        size_bytes: Number(row.size_bytes),
      })) as OdMenuUpload[],
    );
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
    setFormRecipeId("");
    setFormDirectInventoryItemId("");
    setFormTrackingType("recipe");
    setRecipeSearch("");
    setDirectInventorySearch("");
    setModal({ mode: "create" });
  }

  function openEditModal(item: OdMenuItem) {
    setMenuError(null);
    setNotice(null);
    setFormName(item.name);
    setFormDescription(item.description ?? "");
    setFormPreparationTime(
      item.preparation_time_minutes === null ||
        typeof item.preparation_time_minutes === "undefined"
        ? ""
        : String(item.preparation_time_minutes),
    );
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
    setFormRecipeId(item.recipe_id ?? "");
    setFormDirectInventoryItemId(item.direct_inventory_item_id ?? "");
    setFormTrackingType(inventoryTrackingType(item));
    setRecipeSearch(item.recipe_name ?? "");
    setDirectInventorySearch(item.direct_inventory_item_name ?? "");
    setModal({ mode: "edit", item });
  }

  useEffect(() => {
    const targetId = new URLSearchParams(window.location.search).get("item");
    if (!targetId || modal) return;
    const target = items.find((item) => item.id === targetId);
    if (target) { window.history.replaceState({}, "", window.location.pathname); openEditModal(target); }
  }, [items, modal]);

  async function ensureCategory() {
    const newCategory = formNewCategory.trim();
    if (!newCategory) {
      if (!formCategoryId) {
        throw new Error("Choose a category or create a new one.");
      }
      return formCategoryId;
    }

    const existing = categories.find(
      (category) => category.name.toLowerCase() === newCategory.toLowerCase(),
    );
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
    const { error } = await supabase.storage
      .from("menu-photos")
      .upload(path, formImageFile, {
        cacheControl: "3600",
        upsert: false,
        contentType: formImageFile.type,
      });

    if (error) {
      throw new Error(error.message);
    }

    return createSmartImagePublicUrl("menu-photos", path);
  }

  async function handleUploadMenuFile(file: File | null) {
    if (!file) return;

    try {
      setIsWorking(true);
      setMenuError(null);
      setNotice(null);

      const isAllowedType =
        file.type.startsWith("image/") || file.type === "application/pdf";
      if (!isAllowedType) throw new Error("Upload a menu image or PDF file.");
      if (file.size > 10 * 1024 * 1024)
        throw new Error("Menu file must be 10 MB or smaller.");

      const { data: userData, error: userError } =
        await supabase.auth.getUser();
      if (userError || !userData.user) {
        throw new Error(
          userError?.message ||
            "You must be signed in as the owner to upload a menu.",
        );
      }

      const path = buildMenuFilePath(restaurantId, file);
      const { error: uploadError } = await supabase.storage
        .from("menu-files")
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type,
        });

      if (uploadError) throw new Error(uploadError.message);

      const { data: publicUrlData } = supabase.storage
        .from("menu-files")
        .getPublicUrl(path);
      const { error: insertError } = await supabase
        .from("menu_uploads")
        .insert({
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
      setMenuError(
        actionError instanceof Error
          ? actionError.message
          : "Could not upload menu file.",
      );
    } finally {
      if (menuUploadInputRef.current) menuUploadInputRef.current.value = "";
      setIsWorking(false);
    }
  }

  async function handleDeleteMenuUpload(upload: OdMenuUpload) {
    if (!window.confirm(`Delete ${upload.file_name}? This cannot be undone.`))
      return;

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

      const { error: storageError } = await supabase.storage
        .from("menu-files")
        .remove([upload.file_path]);
      if (storageError) throw new Error(storageError.message);

      setNotice("Menu file deleted.");
      await refreshMenuUploads();
    } catch (actionError) {
      setMenuError(
        actionError instanceof Error
          ? actionError.message
          : "Could not delete menu file.",
      );
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
      if (name.length < 2)
        throw new Error("Item name must be at least 2 characters.");
      if (!Number.isFinite(price) || price <= 0)
        throw new Error("Price must be greater than zero.");
      const categoryId = await ensureCategory();
      const imageUrl = await uploadImageIfNeeded();
      const ingredients = parseIngredientInput(formIngredients);
      const preparationTimeMinutes = parseOptionalPositiveInteger(
        "Preparation time",
        formPreparationTime,
      );
      const calories = parseOptionalNutritionInteger("Calories", formCalories);
      const proteinG = parseOptionalNutritionNumber("Protein", formProteinG);
      const carbohydratesG = parseOptionalNutritionNumber(
        "Carbs",
        formCarbohydratesG,
      );
      const fatG = parseOptionalNutritionNumber("Fat", formFatG);
      const fiberG = parseOptionalNutritionNumber("Fiber", formFiberG);
      const sugarG = parseOptionalNutritionNumber("Sugar", formSugarG);
      const sodiumMg = parseOptionalNutritionNumber("Sodium", formSodiumMg);
      if (formTrackingType === "ready_to_sell" && !formDirectInventoryItemId) {
        throw new Error("Choose the inventory ingredient sold by this menu item.");
      }
      const recipeId = formTrackingType === "recipe" ? formRecipeId : "";
      const directInventoryItemId = formTrackingType === "ready_to_sell" ? formDirectInventoryItemId : "";
      let automaticallyCreatedRecipeId: string | null = null;
      let resolvedRecipeId = recipeId;
      if (formTrackingType === "recipe" && !resolvedRecipeId) {
        const createdRecipe = await createRecipe(restaurantId, {
          name, description: "", categoryId: "",
          preparationTimeMinutes: formPreparationTime || "0",
          yieldQuantity: "1", yieldUnit: "serving", status: "active",
        });
        resolvedRecipeId = createdRecipe.id;
        automaticallyCreatedRecipeId = createdRecipe.id;
      }
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
        recipe_id: resolvedRecipeId || null,
        direct_inventory_item_id: directInventoryItemId || null,
      };

      try {
        if (modal.mode === "create") {
          const { error } = await supabase.from("menu_items").insert(payload);
          if (error) throw new Error(error.message);
          setNotice(automaticallyCreatedRecipeId ? "Menu item and recipe created automatically." : "Menu item created.");
        } else {
          const { error } = await supabase
            .from("menu_items")
            .update(payload)
            .eq("id", modal.item.id)
            .eq("restaurant_id", restaurantId);
          if (error) throw new Error(error.message);
          setNotice(automaticallyCreatedRecipeId ? "Menu item updated and recipe created automatically." : "Menu item updated.");
        }
      } catch (cause) {
        if (automaticallyCreatedRecipeId) await softDeleteRecipe(restaurantId, automaticallyCreatedRecipeId).catch(() => undefined);
        throw cause;
      }

      setModal(null);
      await onMenuChanged();
      if (automaticallyCreatedRecipeId) {
        window.location.assign(`/owner/recipes?edit=${encodeURIComponent(automaticallyCreatedRecipeId)}`);
      }
    } catch (actionError) {
      setMenuError(
        actionError instanceof Error
          ? actionError.message
          : "Menu action failed.",
      );
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
      const { data, error } = await supabase.rpc(
        "archive_or_delete_menu_item",
        {
          target_restaurant_id: restaurantId,
          target_menu_item_id: item.id,
        },
      );
      if (error) throw new Error(error.message);
      const action =
        data && typeof data === "object" && "action" in data
          ? String((data as { action?: unknown }).action)
          : "deleted";
      setNotice(
        action === "archived"
          ? "Menu item archived because it has order history."
          : "Menu item deleted.",
      );
      await onMenuChanged();
    } catch (actionError) {
      setMenuError(
        actionError instanceof Error
          ? actionError.message
          : "Could not delete menu item.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <div className="od-page od-operations-page od-menu-experience">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">Menu Management</h1>
          <p className="od-page-subtitle">
            Manage your business menu, categories, pricing, and availability.
          </p>
        </div>
        <div className="od-header-actions">
          <input
            ref={menuUploadInputRef}
            className="od-hidden-file-input"
            type="file"
            accept="image/*,application/pdf"
            onChange={(event) =>
              void handleUploadMenuFile(event.target.files?.[0] ?? null)
            }
            disabled={isWorking}
          />
          <button
            className="od-btn-ghost"
            type="button"
            onClick={() => menuUploadInputRef.current?.click()}
            disabled={isWorking}
          >
            Upload Menu
          </button>
          <button className="od-btn-ghost" type="button" disabled title="Smart Item Library workspace is coming soon">
            Smart Item Library
          </button>
          <button className="od-btn-primary" onClick={openCreateModal}>
            Add Item
          </button>
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
            <div className="od-card-subtitle">
              Image and PDF menus saved to owner-managed storage.
            </div>
          </div>
        </div>
        <div className="od-menu-upload-list">
          {menuUploads.length === 0 ? (
            <div className="od-empty compact">
              <div className="od-empty-msg">No menu files uploaded</div>
              <div className="od-empty-sub">
                Upload a menu image or PDF from the button above.
              </div>
            </div>
          ) : (
            menuUploads.map((upload) => (
              <div className="od-menu-upload-row" key={upload.id}>
                <div className="od-menu-upload-icon">
                  {upload.mime_type === "application/pdf" ? "PDF" : "IMG"}
                </div>
                <div className="od-menu-upload-info">
                  <strong>{upload.file_name}</strong>
                  <span>
                    {formatFileSize(upload.size_bytes)} -{" "}
                    {fmtDateTime(upload.created_at)}
                  </span>
                </div>
                <div className="od-row-actions">
                  <a
                    className="od-btn-ghost"
                    href={upload.file_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View
                  </a>
                  <button
                    className="od-btn-ghost danger"
                    type="button"
                    onClick={() => void handleDeleteMenuUpload(upload)}
                    disabled={isWorking}
                  >
                    Delete
                  </button>
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
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search menu"
              aria-label="Search menu items"
            />
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              aria-label="Filter menu by category"
            >
              <option value="all">All Categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <select
              value={availabilityFilter}
              onChange={(event) =>
                setAvailabilityFilter(
                  event.target.value as typeof availabilityFilter,
                )
              }
              aria-label="Filter menu by availability"
            >
              <option value="all">All Availability</option>
              <option value="available">Available</option>
              <option value="unavailable">Unavailable</option>
            </select>
            <select
              value={stationFilter}
              onChange={(event) => setStationFilter(event.target.value)}
              aria-label="Filter menu by kitchen station"
            >
              <option value="all">All Stations</option>
              {activeStations.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.name}
                </option>
              ))}
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
                <th>Stock Tracking</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="od-empty">
                      <div className="od-empty-icon">--</div>
                      <div className="od-empty-msg">
                        {items.length === 0
                          ? "No menu items yet"
                          : "No menu items match these filters"}
                      </div>
                      <div className="od-empty-sub">
                        {items.length === 0
                          ? "Add your first item or upload a menu photo"
                          : "Adjust search, category, availability, or station"}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="od-menu-item-cell">
                        <OwnerMenuThumbnail item={item} />
                        <div>
                          <strong>{item.name}</strong>
                          {item.description && (
                            <div className="od-menu-desc">
                              {item.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>{getCategoryName(categories, item.category_id)}</td>
                    <td>
                      <span className="od-station-badge">
                        {getStationName(stations, item.kitchen_station_id)}
                      </span>
                    </td>
                    <td>
                      {formatPreparationEstimate(
                        item.preparation_time_minutes,
                      ) ?? "Not set"}
                    </td>
                    <td>{fmtMoney(item.price)}</td>
                    <td>
                      <span
                        className={`od-status-badge ${item.available ? "paid" : "pending"}`}
                      >
                        {item.available ? "Available" : "Unavailable"}
                      </span>
                    </td>
                    <td>
                      <div className="od-tracking-cell">
                        <span className={`od-tracking-badge ${inventoryTrackingType(item)}`}>{inventoryTrackingLabel(inventoryTrackingType(item))}</span>
                        {item.recipe_id && <small>{item.recipe_name ?? "Linked recipe"}</small>}
                        {item.direct_inventory_item_id && <small>{item.direct_inventory_item_name ?? "Inventory ingredient"}</small>}
                      </div>
                    </td>
                    <td>
                      <div className="od-row-actions">
                        <button
                          className="od-btn-ghost"
                          onClick={() => openEditModal(item)}
                          disabled={isWorking}
                        >
                          Edit
                        </button>
                        <button
                          className="od-btn-ghost danger"
                          onClick={() => handleDeleteMenuItem(item)}
                          disabled={isWorking}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="od-table-footer">
          Showing {filteredItems.length} of {items.length} items
        </div>
      </div>

      {modal && (
        <div className="od-modal-backdrop" role="presentation">
          <div
            className="od-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Menu item details"
          >
            <div className="od-modal-header">
              <div>
                <div className="od-card-title">
                  {modal.mode === "create" ? "Add Menu Item" : "Edit Menu Item"}
                </div>
                <div className="od-card-subtitle">
                  Menu items are visible on the QR menu when available.
                </div>
              </div>
              <button
                className="od-icon-btn"
                onClick={() => setModal(null)}
                aria-label="Close"
              >
                x
              </button>
            </div>

            <form className="od-staff-form" onSubmit={handleSubmitMenuItem}>
              <label>
                Item Name
                <input
                  value={formName}
                  onChange={(event) => setFormName(event.target.value)}
                  disabled={isWorking}
                  required
                />
              </label>
              <label>
                Description
                <textarea
                  value={formDescription}
                  onChange={(event) => setFormDescription(event.target.value)}
                  disabled={isWorking}
                  rows={3}
                />
              </label>
              <label>
                Ingredients
                <textarea
                  value={formIngredients}
                  onChange={(event) => setFormIngredients(event.target.value)}
                  disabled={isWorking}
                  rows={4}
                  placeholder={"Mozzarella\nTomato Sauce\nFresh Basil"}
                />
              </label>
              <label>
                Preparation Time (minutes)
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={formPreparationTime}
                  onChange={(event) =>
                    setFormPreparationTime(event.target.value)
                  }
                  disabled={isWorking}
                  placeholder="Optional"
                />
              </label>
              <label>
                Price
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formPrice}
                  onChange={(event) => setFormPrice(event.target.value)}
                  disabled={isWorking}
                  required
                />
              </label>
              <label>
                Calories
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={formCalories}
                  onChange={(event) => setFormCalories(event.target.value)}
                  disabled={isWorking}
                  placeholder="Optional"
                />
              </label>
              <label>
                Protein (g)
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={formProteinG}
                  onChange={(event) => setFormProteinG(event.target.value)}
                  disabled={isWorking}
                  placeholder="Optional"
                />
              </label>
              <label>
                Carbs (g)
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={formCarbohydratesG}
                  onChange={(event) =>
                    setFormCarbohydratesG(event.target.value)
                  }
                  disabled={isWorking}
                  placeholder="Optional"
                />
              </label>
              <label>
                Fat (g)
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={formFatG}
                  onChange={(event) => setFormFatG(event.target.value)}
                  disabled={isWorking}
                  placeholder="Optional"
                />
              </label>
              <label>
                Fiber (g)
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={formFiberG}
                  onChange={(event) => setFormFiberG(event.target.value)}
                  disabled={isWorking}
                  placeholder="Optional"
                />
              </label>
              <label>
                Sugar (g)
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={formSugarG}
                  onChange={(event) => setFormSugarG(event.target.value)}
                  disabled={isWorking}
                  placeholder="Optional"
                />
              </label>
              <label>
                Sodium (mg)
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={formSodiumMg}
                  onChange={(event) => setFormSodiumMg(event.target.value)}
                  disabled={isWorking}
                  placeholder="Optional"
                />
              </label>
              <label>
                Category
                <select
                  value={formCategoryId}
                  onChange={(event) => setFormCategoryId(event.target.value)}
                  disabled={isWorking || categories.length === 0}
                >
                  {categories.length === 0 ? (
                    <option value="">No categories yet</option>
                  ) : (
                    categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label>
                New Category
                <input
                  value={formNewCategory}
                  onChange={(event) => setFormNewCategory(event.target.value)}
                  disabled={isWorking}
                  placeholder="Optional"
                />
              </label>
              <fieldset className="od-recipe-link-fieldset od-tracking-fieldset">
                <legend>Stock Tracking</legend>
                <p className="od-tracking-question">How should inventory be tracked for this menu item?</p>
                <div className="od-tracking-options">
                  <button type="button" className={formTrackingType === "recipe" ? "selected" : ""} onClick={() => { setFormTrackingType("recipe"); setFormDirectInventoryItemId(""); }}><strong>Recipe</strong><small>Prepared from ingredients</small><em>Most common</em></button>
                  <button type="button" className={formTrackingType === "ready_to_sell" ? "selected" : ""} onClick={() => { setFormTrackingType("ready_to_sell"); setFormRecipeId(""); }}><strong>Ready-to-Sell Item</strong><small>Sold exactly as purchased</small></button>
                  <button type="button" className={formTrackingType === "no_tracking" ? "selected" : ""} onClick={() => { setFormTrackingType("no_tracking"); setFormRecipeId(""); setFormDirectInventoryItemId(""); }}><strong>No Tracking</strong><small>No inventory deduction</small></button>
                </div>
                {formTrackingType === "recipe" && <div className="od-tracking-detail"><p>ServeFlow will create and link a recipe automatically. You can also reuse an existing active recipe.</p><label>Search existing recipes<input value={recipeSearch} onChange={(event) => setRecipeSearch(event.target.value)} disabled={isWorking} placeholder="Optional" /></label><label>Existing Recipe<select value={formRecipeId} onChange={(event) => setFormRecipeId(event.target.value)} disabled={isWorking}><option value="">Create recipe automatically</option>{recipeOptions.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}</select></label></div>}
                {formTrackingType === "ready_to_sell" && <div className="od-tracking-detail"><p>Link the packaged menu item to its matching inventory ingredient.</p><label>Search Inventory Ingredient<input value={directInventorySearch} onChange={(event) => setDirectInventorySearch(event.target.value)} disabled={isWorking} placeholder="Search inventory" /></label><label>Inventory Ingredient<select required value={formDirectInventoryItemId} onChange={(event) => setFormDirectInventoryItemId(event.target.value)} disabled={isWorking}><option value="">Choose inventory ingredient</option>{directInventoryOptions.map((item) => <option key={item.id} value={item.id}>{item.name}{item.sku ? ` (${item.sku})` : ""}</option>)}</select></label></div>}
                {formTrackingType === "no_tracking" && <p className="od-tracking-confirmation">No recipe or inventory ingredient is required.</p>}
              </fieldset>
              <label>
                Kitchen Station
                <select
                  value={formStationId}
                  onChange={(event) => setFormStationId(event.target.value)}
                  disabled={isWorking}
                >
                  <option value="">Auto assign</option>
                  {activeStations.map((station) => (
                    <option key={station.id} value={station.id}>
                      {station.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="od-check-row">
                <input
                  type="checkbox"
                  checked={formAvailable}
                  onChange={(event) => setFormAvailable(event.target.checked)}
                  disabled={isWorking}
                />
                Available
              </label>
              <label>
                Menu Photo
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) =>
                    setFormImageFile(event.target.files?.[0] ?? null)
                  }
                  disabled={isWorking}
                />
              </label>
              {formImageUrl && !formImageFile && (
                <ResilientImage className="od-menu-preview" src={formImageUrl} alt="" fallback={null} fallbackClassName="od-menu-preview empty" usage="card" />
              )}

              <div className="od-modal-actions">
                <button
                  type="button"
                  className="od-btn-ghost"
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="od-btn-primary"
                  disabled={isWorking}
                >
                  {isWorking
                    ? "Saving..."
                    : modal.mode === "create"
                      ? "Create Item"
                      : "Save Changes"}
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
    feedback_count: number;
    average_rating: number;
    bills_printed: number;
    bills_reprinted: number;
    average_bill: number;
    largest_bill: number;
    vat_collected: number;
  };
  sales_by_day: { date: string; revenue: number; orders: number }[];
  orders_by_status: { status: string; orders: number }[];
  menu_performance: {
    name: string;
    category: string;
    quantity: number;
    revenue: number;
  }[];
  payment_methods: { method: string; payments: number; revenue: number }[];
  staff_performance: {
    name: string;
    role: string;
    orders_completed: number;
    payments_verified: number;
  }[];
  table_usage: { table_number: number; orders: number; revenue: number }[];
  customers: {
    customer_name: string;
    orders: number;
    revenue: number;
    last_order_at: string | null;
  }[];
  shift_history: OwnerShiftHistory[];
  cash_variances: OwnerCashVariance[];
  feedback: OwnerFeedbackReportRow[];
  daily_bill_counts: {
    date: string;
    bills: number;
    revenue: number;
    vat: number;
  }[];
  monthly_bill_counts: {
    month: string;
    bills: number;
    revenue: number;
    vat: number;
  }[];
  top_bills: {
    bill_number: string;
    printed_at: string;
    print_count: number;
    grand_total: number;
    vat_amount: number;
  }[];
  ai_insights: { title: string; detail: string }[];
};

function emptyReportData(): OwnerReportData {
  return {
    summary: {
      revenue: 0,
      orders: 0,
      average_order_value: 0,
      completed_orders: 0,
      cancelled_orders: 0,
      unique_customers: 0,
      feedback_count: 0,
      average_rating: 0,
      bills_printed: 0,
      bills_reprinted: 0,
      average_bill: 0,
      largest_bill: 0,
      vat_collected: 0,
    },
    sales_by_day: [],
    orders_by_status: [],
    menu_performance: [],
    payment_methods: [],
    staff_performance: [],
    table_usage: [],
    customers: [],
    shift_history: [],
    cash_variances: [],
    feedback: [],
    daily_bill_counts: [],
    monthly_bill_counts: [],
    top_bills: [],
    ai_insights: [],
  };
}

function normalizeReportData(value: unknown): OwnerReportData {
  const data =
    value && typeof value === "object"
      ? (value as Partial<OwnerReportData>)
      : {};
  const summary = data.summary ?? emptyReportData().summary;
  return {
    summary: {
      revenue: Number(summary.revenue ?? 0),
      orders: Number(summary.orders ?? 0),
      average_order_value: Number(summary.average_order_value ?? 0),
      completed_orders: Number(summary.completed_orders ?? 0),
      cancelled_orders: Number(summary.cancelled_orders ?? 0),
      unique_customers: Number(summary.unique_customers ?? 0),
      feedback_count: Number(summary.feedback_count ?? 0),
      average_rating: Number(summary.average_rating ?? 0),
      bills_printed: Number(summary.bills_printed ?? 0),
      bills_reprinted: Number(summary.bills_reprinted ?? 0),
      average_bill: Number(summary.average_bill ?? 0),
      largest_bill: Number(summary.largest_bill ?? 0),
      vat_collected: Number(summary.vat_collected ?? 0),
    },
    sales_by_day: (data.sales_by_day ?? []).map((row) => ({
      date: String(row.date),
      revenue: Number(row.revenue),
      orders: Number(row.orders),
    })),
    orders_by_status: (data.orders_by_status ?? []).map((row) => ({
      status: String(row.status),
      orders: Number(row.orders),
    })),
    menu_performance: (data.menu_performance ?? []).map((row) => ({
      name: String(row.name),
      category: String(row.category),
      quantity: Number(row.quantity),
      revenue: Number(row.revenue),
    })),
    payment_methods: (data.payment_methods ?? []).map((row) => ({
      method: String(row.method),
      payments: Number(row.payments),
      revenue: Number(row.revenue),
    })),
    staff_performance: (data.staff_performance ?? []).map((row) => ({
      name: String(row.name),
      role: String(row.role),
      orders_completed: Number(row.orders_completed),
      payments_verified: Number(row.payments_verified),
    })),
    table_usage: (data.table_usage ?? []).map((row) => ({
      table_number: Number(row.table_number),
      orders: Number(row.orders),
      revenue: Number(row.revenue),
    })),
    customers: (data.customers ?? []).map((row) => ({
      customer_name: String(row.customer_name),
      orders: Number(row.orders),
      revenue: Number(row.revenue),
      last_order_at: row.last_order_at ? String(row.last_order_at) : null,
    })),
    shift_history: (data.shift_history ?? []).map((row) => ({
      id: String(row.id),
      cashier_name: String(row.cashier_name ?? "Cashier"),
      opened_at: String(row.opened_at),
      closed_at: row.closed_at ? String(row.closed_at) : null,
      opening_cash: Number(row.opening_cash),
      expected_cash:
        row.expected_cash === null ? null : Number(row.expected_cash),
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
    feedback: (data.feedback ?? []).map((row) => ({
      id: String(row.id),
      order_id: String(row.order_id),
      table_number: row.table_number ? String(row.table_number) : null,
      customer_name: row.customer_name ? String(row.customer_name) : null,
      rating: Number(row.rating),
      reactions: Array.isArray(row.reactions) ? row.reactions.map(String) : [],
      comment: row.comment ? String(row.comment) : null,
      photo_url: row.photo_url ? String(row.photo_url) : null,
      created_at: String(row.created_at),
      item_names: Array.isArray(row.item_names) ? row.item_names.map(String) : [],
    })),
    daily_bill_counts: (data.daily_bill_counts ?? []).map((row) => ({
      date: String(row.date),
      bills: Number(row.bills),
      revenue: Number(row.revenue),
      vat: Number(row.vat),
    })),
    monthly_bill_counts: (data.monthly_bill_counts ?? []).map((row) => ({
      month: String(row.month),
      bills: Number(row.bills),
      revenue: Number(row.revenue),
      vat: Number(row.vat),
    })),
    top_bills: (data.top_bills ?? []).map((row) => ({
      bill_number: String(row.bill_number),
      printed_at: String(row.printed_at),
      print_count: Number(row.print_count),
      grand_total: Number(row.grand_total),
      vat_amount: Number(row.vat_amount),
    })),
    ai_insights: (data.ai_insights ?? []).map((row) => ({
      title: String(row.title),
      detail: String(row.detail),
    })),
  };
}

type OwnerFeedbackReportRow = {
  id: string;
  order_id: string;
  table_number: string | null;
  customer_name: string | null;
  rating: number;
  reactions: string[];
  comment: string | null;
  photo_url: string | null;
  created_at: string;
  item_names: string[];
};

type OwnerReportOrderRow = {
  id: string;
  status: string;
  customer_name: string | null;
  table_number: string | null;
  payment_method: string | null;
  total_price: number | string;
  created_at: string;
  payment_verified_at: string | null;
  completed_at?: string | null;
  completed_by?: string | null;
};

type OwnerReportInvoiceRow = {
  id: string;
  order_id: string;
  status: string;
  payment_status: string;
  total_price: number | string;
  payment_method: string | null;
  verified_at?: string | null;
  verified_by?: string | null;
  paid_at: string | null;
  paid_by: string | null;
  created_by_staff_id?: string | null;
  created_at: string;
};

type OwnerReportItemRow = {
  id: string;
  order_id: string;
  invoice_id?: string | null;
  menu_item_id: string | null;
  quantity: number | string;
  price: number | string;
};

type OwnerReportMenuRow = {
  id: string;
  name: string;
  category_id: string | null;
};

type OwnerReportStaffRow = {
  id: string;
  display_name: string;
  role: string;
};

type OwnerFeedbackDbRow = {
  id: string;
  order_id: string;
  table_number: string | null;
  rating: number | string;
  reactions: string[] | null;
  comment: string | null;
  photo_url: string | null;
  created_at: string;
};

function isInRange(
  iso: string | null | undefined,
  rangeStart: string,
  rangeEnd: string,
) {
  return Boolean(iso && iso >= rangeStart && iso < rangeEnd);
}

function dateKey(iso: string) {
  return toDateInputValue(new Date(iso));
}

function mergeFeedbackIntoReport(
  report: OwnerReportData,
  feedback: OwnerFeedbackReportRow[],
): OwnerReportData {
  const averageRating =
    feedback.length > 0
      ? feedback.reduce((sum, row) => sum + row.rating, 0) / feedback.length
      : 0;

  return {
    ...report,
    summary: {
      ...report.summary,
      feedback_count: feedback.length,
      average_rating: averageRating,
    },
    feedback,
    ai_insights: [
      ...report.ai_insights,
      ...(feedback.length > 0
        ? [
            {
              title: "Customer feedback",
              detail: `Average meal rating is ${averageRating.toFixed(1)}/5 from ${feedback.length} response${feedback.length === 1 ? "" : "s"}. Review comments for service and menu improvements.`,
            },
          ]
        : [
            {
              title: "Customer feedback",
              detail:
                "No feedback was submitted in this range yet. Keep prompting guests after served orders.",
            },
          ]),
    ],
  };
}

async function loadOwnerFeedbackReportRows(
  restaurantId: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<OwnerFeedbackReportRow[]> {
  const { data: feedbackRows, error: feedbackError } = await supabase
    .from("public_order_feedback")
    .select(
      "id,order_id,table_number,rating,reactions,comment,photo_url,created_at",
    )
    .eq("restaurant_id", restaurantId)
    .gte("created_at", rangeStart)
    .lt("created_at", rangeEnd)
    .order("created_at", { ascending: false });

  if (feedbackError) {
    throw new Error(
      `Could not load customer feedback: ${feedbackError.message}`,
    );
  }

  const feedback = (feedbackRows ?? []) as OwnerFeedbackDbRow[];
  const orderIds = [
    ...new Set(feedback.map((row) => row.order_id).filter(Boolean)),
  ];
  const orderCustomerById = new Map<string, string | null>();
  const itemNamesByOrderId = new Map<string, string[]>();

  if (orderIds.length > 0) {
    const { data: orderRows, error: orderError } = await supabase
      .from("orders")
      .select("id,customer_name")
      .eq("restaurant_id", restaurantId)
      .in("id", orderIds);

    if (orderError) {
      throw new Error(`Could not load feedback orders: ${orderError.message}`);
    }

    for (const order of (orderRows ?? []) as {
      id: string;
      customer_name: string | null;
    }[]) {
      orderCustomerById.set(order.id, order.customer_name);
    }

    const { data: itemRows, error: itemError } = await supabase
      .from("order_items")
      .select(
        "order_id,menu_item_id,menu_items!order_items_menu_item_same_restaurant(name)",
      )
      .eq("restaurant_id", restaurantId)
      .in("order_id", orderIds);
    if (itemError) throw new Error(`Could not load feedback items: ${itemError.message}`);
    for (const item of (itemRows ?? []) as unknown as Array<{ order_id: string; menu_items: { name?: string } | Array<{ name?: string }> | null }>) {
      const menu = Array.isArray(item.menu_items) ? item.menu_items[0] : item.menu_items;
      const name = menu?.name?.trim();
      if (name) itemNamesByOrderId.set(item.order_id, [...(itemNamesByOrderId.get(item.order_id) ?? []), name]);
    }
  }

  return feedback.map((row) => ({
    id: row.id,
    order_id: row.order_id,
    table_number: row.table_number,
    customer_name: orderCustomerById.get(row.order_id) ?? null,
    rating: Number(row.rating),
    reactions: Array.isArray(row.reactions) ? row.reactions.map(String) : [],
    comment: row.comment,
    photo_url: row.photo_url,
    created_at: row.created_at,
    item_names: [...new Set(itemNamesByOrderId.get(row.order_id) ?? [])],
  }));
}

async function buildOwnerReportDataFromTables(
  restaurantId: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<OwnerReportData> {
  const [
    { data: orderRows, error: orderError },
    { data: invoiceRows, error: invoiceError },
    { data: itemRows, error: itemError },
    { data: menuRows, error: menuError },
    { data: categoryRows, error: categoryError },
    { data: staffRows, error: staffError },
  ] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id,status,customer_name,table_number,payment_method,total_price,created_at,payment_verified_at,completed_at,completed_by",
      )
      .eq("restaurant_id", restaurantId)
      .gte("created_at", rangeStart)
      .lt("created_at", rangeEnd),
    supabase
      .from("order_invoices")
      .select(
        "id,order_id,status,payment_status,total_price,payment_method,paid_at,paid_by,created_by_staff_id,created_at",
      )
      .eq("restaurant_id", restaurantId),
    supabase
      .from("order_items")
      .select("id,order_id,invoice_id,menu_item_id,quantity,price")
      .eq("restaurant_id", restaurantId),
    supabase
      .from("menu_items")
      .select("id,name,category_id")
      .eq("restaurant_id", restaurantId),
    supabase
      .from("categories")
      .select("id,name")
      .eq("restaurant_id", restaurantId),
    supabase
      .from("restaurant_staff")
      .select("id,display_name,role")
      .eq("restaurant_id", restaurantId)
      .neq("role", "owner"),
  ]);

  if (orderError) throw new Error(orderError.message);
  if (itemError) throw new Error(itemError.message);
  if (menuError) throw new Error(menuError.message);
  if (categoryError) throw new Error(categoryError.message);
  if (staffError) throw new Error(staffError.message);

  const orders = ((orderRows ?? []) as OwnerReportOrderRow[]).map((row) => ({
    ...row,
    total_price: Number(row.total_price),
  }));
  const invoices = invoiceError
    ? []
    : ((invoiceRows ?? []) as OwnerReportInvoiceRow[])
        .filter(
          (invoice) =>
            invoice.payment_status === "paid" &&
            Boolean(invoice.paid_at) &&
            isInRange(invoice.paid_at ?? "", rangeStart, rangeEnd),
        )
        .map((invoice) => ({
          ...invoice,
          total_price: Number(invoice.total_price),
        }));
  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const revenueByOrderId = new Map<string, number>();

  for (const invoice of invoices) {
    revenueByOrderId.set(
      invoice.order_id,
      (revenueByOrderId.get(invoice.order_id) ?? 0) + invoice.total_price,
    );
  }

  const totalRevenue = [...revenueByOrderId.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  const revenueOrderIds = new Set(revenueByOrderId.keys());
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const menuById = new Map(
    ((menuRows ?? []) as OwnerReportMenuRow[]).map((menuItem) => [
      menuItem.id,
      menuItem,
    ]),
  );
  const categoryById = new Map(
    ((categoryRows ?? []) as OdCategory[]).map((category) => [
      category.id,
      category.name,
    ]),
  );
  const staffById = new Map(
    ((staffRows ?? []) as OwnerReportStaffRow[]).map((staffMember) => [
      staffMember.id,
      staffMember,
    ]),
  );

  const salesByDay = new Map<
    string,
    { date: string; revenue: number; orders: number }
  >();
  for (const invoice of invoices) {
    const key = dateKey(invoice.paid_at ?? "");
    const current = salesByDay.get(key) ?? { date: key, revenue: 0, orders: 0 };
    current.revenue += invoice.total_price;
    current.orders += 1;
    salesByDay.set(key, current);
  }

  const ordersByStatus = new Map<string, number>();
  const tableUsage = new Map<
    number,
    { table_number: number; orders: number; revenue: number }
  >();
  const customerTotals = new Map<
    string,
    {
      customer_name: string;
      orders: number;
      revenue: number;
      last_order_at: string | null;
    }
  >();
  for (const order of orders) {
    if (!revenueOrderIds.has(order.id)) continue;
    ordersByStatus.set(
      order.status,
      (ordersByStatus.get(order.status) ?? 0) + 1,
    );
    const tableNumber = Number(order.table_number);
    if (Number.isFinite(tableNumber)) {
      const current = tableUsage.get(tableNumber) ?? {
        table_number: tableNumber,
        orders: 0,
        revenue: 0,
      };
      current.orders += invoices.filter(
        (invoice) => invoice.order_id === order.id,
      ).length;
      current.revenue += revenueByOrderId.get(order.id) ?? 0;
      tableUsage.set(tableNumber, current);
    }
    const customerName = order.customer_name?.trim() || "Guest";
    const customer = customerTotals.get(customerName) ?? {
      customer_name: customerName,
      orders: 0,
      revenue: 0,
      last_order_at: null,
    };
    customer.orders += invoices.filter(
      (invoice) => invoice.order_id === order.id,
    ).length;
    customer.revenue += revenueByOrderId.get(order.id) ?? 0;
    if (!customer.last_order_at || order.created_at > customer.last_order_at)
      customer.last_order_at = order.created_at;
    customerTotals.set(customerName, customer);
  }

  const menuTotals = new Map<
    string,
    { name: string; category: string; quantity: number; revenue: number }
  >();
  for (const item of (itemRows ?? []) as OwnerReportItemRow[]) {
    const invoice = item.invoice_id ? invoiceById.get(item.invoice_id) : null;
    if (!invoice) continue;

    const menuItem = item.menu_item_id
      ? menuById.get(item.menu_item_id)
      : undefined;
    const key = item.menu_item_id ?? `${item.order_id}:${item.id}`;
    const current = menuTotals.get(key) ?? {
      name: menuItem?.name ?? "Menu item",
      category: menuItem?.category_id
        ? (categoryById.get(menuItem.category_id) ?? "Menu")
        : "Menu",
      quantity: 0,
      revenue: 0,
    };
    current.quantity += Number(item.quantity);
    current.revenue += Number(item.quantity) * Number(item.price);
    menuTotals.set(key, current);
  }

  const paymentMethodTotals = new Map<
    string,
    { method: string; payments: number; revenue: number }
  >();
  for (const invoice of invoices) {
    const method = canonicalPaymentMethod(invoice.payment_method);
    const current = paymentMethodTotals.get(method) ?? {
      method,
      payments: 0,
      revenue: 0,
    };
    current.payments += 1;
    current.revenue += invoice.total_price;
    paymentMethodTotals.set(method, current);
  }

  const staffTotals = new Map<
    string,
    {
      name: string;
      role: string;
      orders_completed: number;
      payments_verified: number;
    }
  >();
  function staffTotal(staffId: string | null | undefined) {
    if (!staffId) return null;
    const staffMember = staffById.get(staffId);
    const current = staffTotals.get(staffId) ?? {
      name: staffMember?.display_name ?? "Staff",
      role: staffMember?.role ?? "staff",
      orders_completed: 0,
      payments_verified: 0,
    };
    staffTotals.set(staffId, current);
    return current;
  }
  for (const invoice of invoices) {
    const creator = staffTotal(invoice.created_by_staff_id);
    if (creator) creator.orders_completed += 1;
    const total = staffTotal(invoice.verified_by ?? invoice.paid_by);
    if (total) total.payments_verified += 1;
  }
  for (const order of orders) {
    if (order.status === "completed") {
      const total = staffTotal(order.completed_by);
      if (total) total.orders_completed += 1;
    }
  }

  const paidOrderCount = invoices.length;
  const uniqueCustomers = [...customerTotals.keys()].filter(
    (name) => name !== "Guest",
  ).length;

  return {
    summary: {
      ...emptyReportData().summary,
      revenue: totalRevenue,
      orders: invoices.length,
      average_order_value:
        paidOrderCount > 0 ? totalRevenue / paidOrderCount : 0,
      completed_orders: orders.filter(
        (order) =>
          revenueOrderIds.has(order.id) && order.status === "completed",
      ).length,
      cancelled_orders: orders.filter(
        (order) =>
          revenueOrderIds.has(order.id) && order.status === "cancelled",
      ).length,
      unique_customers: uniqueCustomers,
      feedback_count: 0,
      average_rating: 0,
    },
    sales_by_day: [...salesByDay.values()].sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    orders_by_status: [...ordersByStatus.entries()].map(
      ([status, orderCount]) => ({ status, orders: orderCount }),
    ),
    menu_performance: [...menuTotals.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 20),
    payment_methods: [...paymentMethodTotals.values()].sort(
      (a, b) => b.revenue - a.revenue,
    ),
    staff_performance: [...staffTotals.values()].sort(
      (a, b) =>
        b.payments_verified +
        b.orders_completed -
        (a.payments_verified + a.orders_completed),
    ),
    table_usage: [...tableUsage.values()].sort(
      (a, b) => a.table_number - b.table_number,
    ),
    customers: [...customerTotals.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 50),
    shift_history: [],
    cash_variances: [],
    feedback: [],
    daily_bill_counts: [],
    monthly_bill_counts: [],
    top_bills: [],
    ai_insights: [
      {
        title: "Report source",
        detail:
          "Generated from persisted owner-visible orders, invoices, items, staff, and table data.",
      },
    ],
  };
}

async function loadOwnerReportData(
  restaurantId: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<OwnerReportData> {
  const feedbackRows = await loadOwnerFeedbackReportRows(
    restaurantId,
    rangeStart,
    rangeEnd,
  );
  const { data, error } = await supabase.rpc("get_owner_reporting_center", {
    target_restaurant_id: restaurantId,
    range_start: rangeStart,
    range_end: rangeEnd,
  });

  if (error) {
    const tableReport = await buildOwnerReportDataFromTables(
      restaurantId,
      rangeStart,
      rangeEnd,
    );
    return mergeFeedbackIntoReport(tableReport, feedbackRows);
  }

  const rpcReport = normalizeReportData(
    data && typeof data === "object" ? (data as object) : {},
  );

  if (
    rpcReport.summary.orders > 0 ||
    rpcReport.summary.revenue > 0 ||
    rpcReport.sales_by_day.length > 0 ||
    rpcReport.menu_performance.length > 0
  ) {
    return mergeFeedbackIntoReport(rpcReport, feedbackRows);
  }

  const tableReport = await buildOwnerReportDataFromTables(
    restaurantId,
    rangeStart,
    rangeEnd,
  );
  return mergeFeedbackIntoReport(
    tableReport.summary.orders > 0 || tableReport.summary.revenue > 0
      ? tableReport
      : rpcReport,
    feedbackRows,
  );
}

type OwnerDiningBillRow = {
  bill_number: string;
  printed_at: string;
  print_count: number | string;
  grand_total: number | string;
  vat_amount: number | string;
};

function mergeOwnerBillMetrics(
  report: OwnerReportData,
  billReport: OwnerReportData,
): OwnerReportData {
  return normalizeReportData({
    ...report,
    summary: {
      ...report.summary,
      bills_printed: billReport.summary.bills_printed,
      bills_reprinted: billReport.summary.bills_reprinted,
      average_bill: billReport.summary.average_bill,
      largest_bill: billReport.summary.largest_bill,
      vat_collected: billReport.summary.vat_collected,
    },
    daily_bill_counts: billReport.daily_bill_counts,
    monthly_bill_counts: billReport.monthly_bill_counts,
    top_bills: billReport.top_bills,
  });
}

async function loadOwnerDiningBillReportData(
  restaurantId: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<OwnerReportData> {
  const empty = emptyReportData();
  const { data, error } = await supabase
    .from("dining_session_bills")
    .select("bill_number,printed_at,print_count,grand_total,vat_amount")
    .eq("restaurant_id", restaurantId)
    .neq("status", "voided")
    .gte("printed_at", rangeStart)
    .lt("printed_at", rangeEnd)
    .order("grand_total", { ascending: false });

  if (error) return empty;

  const rows = ((data ?? []) as OwnerDiningBillRow[]).map((row) => ({
    bill_number: String(row.bill_number),
    printed_at: String(row.printed_at),
    print_count: Number(row.print_count ?? 1),
    grand_total: Number(row.grand_total ?? 0),
    vat_amount: Number(row.vat_amount ?? 0),
  }));

  const daily = new Map<
    string,
    { date: string; bills: number; revenue: number; vat: number }
  >();
  const monthly = new Map<
    string,
    { month: string; bills: number; revenue: number; vat: number }
  >();
  for (const bill of rows) {
    const printedAt = new Date(bill.printed_at);
    const dayKey = Number.isNaN(printedAt.getTime())
      ? bill.printed_at.slice(0, 10)
      : printedAt.toISOString().slice(0, 10);
    const monthKey = dayKey.slice(0, 7);
    const day = daily.get(dayKey) ?? {
      date: dayKey,
      bills: 0,
      revenue: 0,
      vat: 0,
    };
    day.bills += 1;
    day.revenue += bill.grand_total;
    day.vat += bill.vat_amount;
    daily.set(dayKey, day);
    const month = monthly.get(monthKey) ?? {
      month: monthKey,
      bills: 0,
      revenue: 0,
      vat: 0,
    };
    month.bills += 1;
    month.revenue += bill.grand_total;
    month.vat += bill.vat_amount;
    monthly.set(monthKey, month);
  }

  const billCount = rows.length;
  const totalRevenue = rows.reduce((sum, bill) => sum + bill.grand_total, 0);
  const totalVat = rows.reduce((sum, bill) => sum + bill.vat_amount, 0);
  const reprintCount = rows.reduce(
    (sum, bill) => sum + Math.max(0, bill.print_count - 1),
    0,
  );

  return normalizeReportData({
    ...empty,
    summary: {
      ...empty.summary,
      bills_printed: billCount,
      bills_reprinted: reprintCount,
      average_bill: billCount > 0 ? totalRevenue / billCount : 0,
      largest_bill: rows[0]?.grand_total ?? 0,
      vat_collected: totalVat,
    },
    daily_bill_counts: [...daily.values()].sort((left, right) =>
      left.date.localeCompare(right.date),
    ),
    monthly_bill_counts: [...monthly.values()].sort((left, right) =>
      left.month.localeCompare(right.month),
    ),
    top_bills: rows.slice(0, 10),
  });
}

function MiniLineChart({
  rows,
}: {
  rows: { date: string; revenue: number; orders: number }[];
}) {
  const values =
    rows.length > 0 ? rows : [{ date: "No data", revenue: 0, orders: 0 }];
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
        <polyline
          points={points}
          fill="none"
          stroke="var(--od-primary)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {values.map((row, index) => {
          const x =
            values.length === 1 ? 280 : (index / (values.length - 1)) * 560;
          const y = 180 - (row.revenue / max) * 150;
          return (
            <circle
              key={`${row.date}-${index}`}
              cx={x}
              cy={y}
              r="5"
              fill="var(--od-primary)"
            />
          );
        })}
      </svg>
    </div>
  );
}

function ReportTable({
  title,
  subtitle,
  headers,
  rows,
}: {
  title: string;
  subtitle: string;
  headers: string[];
  rows: ReportRow[];
}) {
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
            <tr>
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={headers.length}>
                  <div className="od-empty compact">
                    No report data in this range
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={index}>
                  {headers.map((header) => (
                    <td key={header}>{row[header]}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type ReportsCenterRange =
  | "today"
  | "yesterday"
  | "week"
  | "last_week"
  | "month"
  | "last_month"
  | "custom";
const REPORT_MODULES = [
  ["Executive Summary", "sales", "summary"],
  ["Sales", "sales", "summary"],
  ["Revenue", "financial", "revenue"],
  ["Orders", "sales", "orders"],
  ["Menu Performance", "menu", "rows"],
  ["Kitchen Performance", "kitchen", "rows"],
  ["Staff Performance", "staff", "rows"],
  ["Customers", "customers", "rows"],
  ["Table Performance", "tables", "rows"],
  ["Inventory", "inventory", "rows"],
  ["Finance", "financial", "summary"],
  ["Payment Methods", "sales", "payment_breakdown"],
  ["Taxes", "financial", "taxes"],
  ["Refunds", "financial", "refunds"],
  ["Profit & Loss", "financial", "profit_loss"],
] as const;

function ReportsPage({
  restaurantId,
  restaurantName,
}: {
  restaurantId: string;
  restaurantName: string;
}) {
  const [range, setRange] = useState<ReportsCenterRange>("today");
  const [customStart, setCustomStart] = useState(toDateInputValue(new Date()));
  const [customEnd, setCustomEnd] = useState(toDateInputValue(new Date()));
  const [modules, setModules] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const [feedback, setFeedback] = useState<OwnerFeedbackReportRow[]>([]);
  const [feedbackSearch, setFeedbackSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);
  const selectedRange = useMemo(() => {
    if (range === "custom")
      return analyticsWindow(
        "custom",
        activeOwnerTimezone,
        customStart,
        customEnd,
      );
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    let start = new Date(now),
      end = new Date(now);
    end.setDate(end.getDate() + 1);
    if (range === "yesterday") {
      start.setDate(start.getDate() - 1);
      end = new Date(now);
    }
    if (range === "week" || range === "last_week") {
      start.setDate(
        start.getDate() -
          ((start.getDay() + 6) % 7) -
          (range === "last_week" ? 7 : 0),
      );
      end = new Date(start);
      end.setDate(end.getDate() + 7);
    }
    if (range === "month" || range === "last_month") {
      start.setDate(1);
      if (range === "last_month") start.setMonth(start.getMonth() - 1);
      end = new Date(start);
      end.setMonth(end.getMonth() + 1);
    }
    return analyticsWindow(range, activeOwnerTimezone);
  }, [customEnd, customStart, range]);
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        setLoading(true);
        setReportError(null);
        const args = {
          target_restaurant_id: restaurantId,
          range_start: selectedRange.rangeStart,
          range_end: selectedRange.rangeEnd,
        };
        const calls = [
          ["sales", "get_owner_sales_module_report"],
          ["financial", "get_owner_financial_module_report"],
          ["menu", "get_owner_menu_module_report"],
          ["kitchen", "get_owner_kitchen_module_report"],
          ["staff", "get_owner_staff_module_report"],
          ["tables", "get_owner_tables_module_report"],
          ["customers", "get_owner_customers_module_report"],
          ["inventory", "get_owner_inventory_module_report"],
          ["ai", "get_owner_ai_business_insights"],
          ["audit", "get_owner_audit_module_report"],
        ] as const;
        const [results, feedbackRows] = await Promise.all([
          Promise.all(
          calls.map(async ([key, rpc]) => {
            const { data, error } = await supabase.rpc(rpc, args);
            if (error) throw new Error(`${key}: ${error.message}`);
            return [
              key,
              data && typeof data === "object"
                ? (data as Record<string, unknown>)
                : {},
            ] as const;
          })),
          loadOwnerFeedbackReportRows(restaurantId, selectedRange.rangeStart, selectedRange.rangeEnd),
        ]);
        if (mounted) {
          setModules(Object.fromEntries(results));
          setFeedback(feedbackRows);
        }
      } catch (error) {
        if (mounted)
          setReportError(
            error instanceof Error ? error.message : "Reports unavailable.",
          );
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [restaurantId, selectedRange]);
  const exportRows = [...REPORT_MODULES.flatMap(
    ([title, moduleKey, payloadKey]) => {
      const value = modules[moduleKey]?.[payloadKey];
      const rows = Array.isArray(value)
        ? (value as Record<string, unknown>[])
        : [];
      return rows.flatMap((row) =>
        Object.entries(row).map(([metric, result]) => [
          title,
          metric,
          String(result ?? ""),
        ]),
      );
    },
  ), ...feedback.flatMap((row) => [
    ["Customer Feedback", "Rating", `${row.rating}/5`],
    ["Customer Feedback", "Customer", row.customer_name ?? "Guest"],
    ["Customer Feedback", "Items", row.item_names.join(", ")],
    ["Customer Feedback", "Comment", row.comment ?? ""],
  ])];
  const csv = () =>
    exportRowsAsCsv(
      `serveflow-reports-${range}.csv`,
      ["Report", "Metric", "Value"],
      exportRows,
    );
  const excel = () =>
    exportRowsAsExcel(
      `serveflow-reports-${range}.xls`,
      `${restaurantName} Reports Center`,
      ["Report", "Metric", "Value"],
      exportRows,
    );
  const insights = Array.isArray(modules.ai?.insights)
    ? (modules.ai.insights as Record<string, unknown>[])
    : [];
  const visibleFeedback = feedback.filter((row) => {
    const query = feedbackSearch.trim().toLowerCase();
    return !query || [row.customer_name, row.comment, row.table_number, ...row.item_names].some((value) => String(value ?? "").toLowerCase().includes(query));
  });
  const averageFeedback = feedback.length ? feedback.reduce((sum, row) => sum + row.rating, 0) / feedback.length : 0;
  const feedbackItems = [...feedback.reduce((map, row) => {
    row.item_names.forEach((name) => {
      const current = map.get(name) ?? { name, total: 0, reviews: 0 };
      current.total += row.rating;
      current.reviews += 1;
      map.set(name, current);
    });
    return map;
  }, new Map<string, { name: string; total: number; reviews: number }>()).values()].map((item) => ({ ...item, average: item.total / item.reviews }));
  const highestRated = [...feedbackItems].sort((a, b) => b.average - a.average || b.reviews - a.reviews)[0];
  const lowestRated = [...feedbackItems].sort((a, b) => a.average - b.average || b.reviews - a.reviews)[0];
  const mostReviewed = [...feedbackItems].sort((a, b) => b.reviews - a.reviews || b.average - a.average)[0];
  return (
    <div className="od-page od-print-area od-reports-center">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">Reports Center</h1>
          <p className="od-page-subtitle">
            Executive intelligence and every business report in one place.
          </p>
        </div>
        <div className="od-header-actions od-no-print">
          <button className="od-btn-ghost" onClick={() => window.print()}>
            PDF
          </button>
          <button className="od-btn-ghost" onClick={excel}>
            Excel
          </button>
          <button className="od-btn-ghost" onClick={csv}>
            CSV
          </button>
          <button className="od-btn-primary" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </div>
      <div className="od-report-range od-no-print">
        {(
          [
            "today",
            "yesterday",
            "week",
            "month",
            "custom",
          ] as ReportsCenterRange[]
        ).map((option) => (
          <button
            key={option}
            className={range === option ? "active" : ""}
            onClick={() => setRange(option)}
          >
            {
              (
                {
                  today: "Today",
                  yesterday: "Yesterday",
                  week: "Week",
                  month: "Month",
                  custom: "Custom",
                } as Record<ReportsCenterRange, string>
              )[option]
            }
          </button>
        ))}
      </div>
      {range === "custom" ? (
        <div className="od-custom-range od-no-print">
          <label>
            From
            <input
              type="date"
              value={customStart}
              max={customEnd}
              onChange={(event) => setCustomStart(event.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={customEnd}
              min={customStart}
              onChange={(event) => setCustomEnd(event.target.value)}
            />
          </label>
        </div>
      ) : null}
      {reportError ? (
        <div className="od-error-inline">{reportError}</div>
      ) : null}
      {loading ? (
        <div className="od-empty">Loading business intelligence…</div>
      ) : (
        <>
          <section className="od-ai-insights">
            <header>
              <div>
                <span>AI Business Insights</span>
                <h2>Executive Briefing</h2>
              </div>
              <b>Report data only</b>
            </header>
            <div>
              {insights.map((insight, index) => (
                <article key={index} className={String(insight.type ?? "")}>
                  <small>{String(insight.type ?? "Insight")}</small>
                  <strong>{String(insight.title ?? "Business insight")}</strong>
                  <p>{String(insight.detail ?? "")}</p>
                </article>
              ))}
            </div>
          </section>
          <div className="od-bi-chart-grid">
            <BiChart title="Hourly Revenue" rows={modules.sales?.top_hours} />
            <BiChart
              title="Payment Method Pie Chart"
              rows={modules.sales?.payment_breakdown}
            />
            <BiChart title="Top Menu Chart" rows={modules.menu?.rows} />
            <BiChart title="Kitchen Speed Chart" rows={modules.kitchen?.rows} />
            <BiChart
              title="Staff Performance Chart"
              rows={modules.staff?.rows}
            />
            <BiChart
              title="Customer Growth Chart"
              rows={modules.customers?.rows}
            />
          </div>
          <section className="od-card od-feedback-report">
            <div className="od-card-header">
              <div><div className="od-card-title">Customer Feedback</div><div className="od-card-subtitle">Verified served-order ratings for the selected date range.</div></div>
              <label className="od-report-search"><span className="sr-only">Search feedback</span><input value={feedbackSearch} onChange={(event) => setFeedbackSearch(event.target.value)} placeholder="Search reviews, customers or items" /></label>
            </div>
            <div className="od-kpi-grid analytics">
              <div className="od-kpi-card"><div className="od-kpi-label">Average Rating</div><div className="od-kpi-value">{averageFeedback.toFixed(1)}/5</div></div>
              <div className="od-kpi-card"><div className="od-kpi-label">Overall Rating</div><div className="od-kpi-value">{feedback.length} reviews</div></div>
              <div className="od-kpi-card"><div className="od-kpi-label">Highest Rated Item</div><div className="od-kpi-value">{highestRated ? `${highestRated.name} · ${highestRated.average.toFixed(1)}` : "—"}</div></div>
              <div className="od-kpi-card"><div className="od-kpi-label">Lowest Rated Item</div><div className="od-kpi-value">{lowestRated ? `${lowestRated.name} · ${lowestRated.average.toFixed(1)}` : "—"}</div></div>
              <div className="od-kpi-card"><div className="od-kpi-label">Most Reviewed Item</div><div className="od-kpi-value">{mostReviewed ? `${mostReviewed.name} · ${mostReviewed.reviews}` : "—"}</div></div>
            </div>
            <ReportTable title="Recent Reviews" subtitle="One review per completed order. Item ratings are attributed from that order's experience rating." headers={["Date", "Customer", "Items", "Rating", "Comment"]} rows={visibleFeedback.map((row) => ({ Date: fmtDateTime(row.created_at), Customer: row.customer_name ?? "Guest", Items: row.item_names.join(", ") || "—", Rating: `${row.rating}/5`, Comment: row.comment ?? "—" }))} />
          </section>
          <div className="od-report-center-grid">
            {REPORT_MODULES.map(([title, moduleKey, payloadKey]) => (
              <ModuleExportSection
                key={title}
                title={title}
                value={modules[moduleKey]?.[payloadKey]}
              />
            ))}
          </div>
          <section className="od-card">
            <div className="od-card-header">
              <div>
                <div className="od-card-title">Export Center</div>
                <div className="od-card-subtitle">
                  PDF, Excel, CSV and print use the displayed module payloads.
                </div>
              </div>
            </div>
          </section>
          <details className="od-advanced-audit">
            <summary>
              Advanced <span>Audit Logs</span>
            </summary>
            <ModuleExportSection
              title="Advanced Audit Logs"
              value={modules.audit?.rows}
            />
          </details>
        </>
      )}
    </div>
  );
}

function BiChart({ title, rows }: { title: string; rows: unknown }) {
  const values = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  const numericKey = values.length
    ? Object.keys(values[0]).find(
        (key) =>
          typeof values[0][key] === "number" &&
          /(revenue|quantity|orders|performance|spend|time)/.test(key),
      )
    : undefined;
  const max = Math.max(
    ...values.map((row) => Number(numericKey ? row[numericKey] : 0)),
    1,
  );
  return (
    <section className="od-card od-bi-chart">
      <div className="od-card-header">
        <div className="od-card-title">{title}</div>
      </div>
      <div>
        {values.slice(0, 8).map((row, index) => {
          const label = String(
            row.name ??
              row.method ??
              row.staff ??
              row.customer_name ??
              row.hour_of_day ??
              index,
          );
          const value = Number(numericKey ? row[numericKey] : 0);
          return (
            <span key={index}>
              <b>{label}</b>
              <i>
                <em style={{ width: `${(value / max) * 100}%` }} />
              </i>
              <small>{value.toLocaleString()}</small>
            </span>
          );
        })}
      </div>
    </section>
  );
}

function ModuleExportSection({
  title,
  value,
}: {
  title: string;
  value: unknown;
}) {
  const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const hiddenHeaders = new Set(["id", "menu_item_id", "kitchen_station_id", "station_id", "staff_id"]);
  if (title === "Staff Performance") ["bill_request", "bill_requests", "bills_requested", "customers_served", "customer_served"].forEach((header) => hiddenHeaders.add(header));
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((header) => !hiddenHeaders.has(header));
  const headerLabel = (header: string) => {
    if (title === "Menu Performance" && header === "average_price") return "Item Price";
    if (title === "Staff Performance" && header === "staff") return "Name";
    return header.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  };
  const durationLabel = (value: unknown) => {
    const totalSeconds = Math.max(0, Math.round(Number(value ?? 0) * 60));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours ? `${hours} hr` : "", minutes ? `${minutes} min` : "", `${seconds} sec`].filter(Boolean).join(" ");
  };
  const displayValue = (row: Record<string, unknown>, header: string) => {
    if ((title === "Kitchen Performance" && header === "average_prep_time") || (title === "Table Performance" && header === "average_stay")) return durationLabel(row[header]);
    if (typeof row[header] === "number" && /(revenue|value|spend|bill|price)/.test(header)) return fmtMoney(Number(row[header]));
    return String(row[header] ?? "—");
  };
  return (
    <section className="od-card">
      <div className="od-card-header">
        <div>
          <div className="od-card-title">{title}</div>
          <div className="od-card-subtitle">Originating module values</div>
        </div>
      </div>
      <div className="od-table-wrap">
        <table className="od-table">
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header}>{headerLabel(header)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, index) => (
                <tr key={index}>
                  {headers.map((header) => (
                    <td key={header}>
                      {displayValue(row, header)}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td>
                  <div className="od-empty compact">
                    No module values in this range
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LegacyReportsPage({
  restaurantId,
  restaurantName,
}: {
  restaurantId: string;
  restaurantName: string;
}) {
  const defaultEnd = toDateInputValue(new Date());
  const defaultStartDate = new Date();
  defaultStartDate.setDate(defaultStartDate.getDate() - 30);
  const [startDate, setStartDate] = useState(
    toDateInputValue(defaultStartDate),
  );
  const [endDate, setEndDate] = useState(defaultEnd);
  const [reportData, setReportData] =
    useState<OwnerReportData>(emptyReportData());
  const [loadingReport, setLoadingReport] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function loadReport() {
      try {
        setLoadingReport(true);
        setReportError(null);
        const { rangeStart, rangeEnd } = getDateInputRange(startDate, endDate);
        const [
          reportPayload,
          billPayload,
          { data: shiftData, error: shiftError },
        ] = await Promise.all([
          loadOwnerReportData(restaurantId, rangeStart, rangeEnd),
          loadOwnerDiningBillReportData(restaurantId, rangeStart, rangeEnd),
          supabase.rpc("get_owner_shift_visibility", {
            target_restaurant_id: restaurantId,
            range_start: rangeStart,
            range_end: rangeEnd,
          }),
        ]);
        if (shiftError) throw new Error(shiftError.message);
        const shiftPayload =
          shiftData && typeof shiftData === "object"
            ? (shiftData as object)
            : {};
        const billMergedReport = mergeOwnerBillMetrics(
          reportPayload,
          billPayload,
        );
        if (mounted) {
          setReportData(
            normalizeReportData({
              ...billMergedReport,
              ...shiftPayload,
              summary: billMergedReport.summary,
              feedback: reportPayload.feedback,
            }),
          );
        }
      } catch (loadError) {
        if (mounted)
          setReportError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load reports.",
          );
      } finally {
        if (mounted) setLoadingReport(false);
      }
    }
    void loadReport();
    return () => {
      mounted = false;
    };
  }, [restaurantId, startDate, endDate]);

  const salesRows = reportData.sales_by_day.map((row) => ({
    Date: row.date.slice(0, 10),
    Revenue: fmtMoney(row.revenue),
    Orders: row.orders,
  }));
  const orderRows = reportData.orders_by_status.map((row) => ({
    Status: statusLabel(row.status),
    Orders: row.orders,
  }));
  const menuRows = reportData.menu_performance.map((row) => ({
    Item: row.name,
    Category: row.category,
    Quantity: row.quantity,
    Revenue: fmtMoney(row.revenue),
  }));
  const paymentMethodRows = reportData.payment_methods.map((row) => ({
    Method: row.method,
    Payments: row.payments,
    Revenue: fmtMoney(row.revenue),
  }));
  const topBillRows = reportData.top_bills.map((row) => ({
    "Bill Number": row.bill_number,
    Printed: fmtDateTime(row.printed_at),
    "Print Count": row.print_count,
    "Grand Total": fmtMoney(row.grand_total),
    VAT: fmtMoney(row.vat_amount),
  }));
  const dailyBillRows = reportData.daily_bill_counts.map((row) => ({
    Date: row.date,
    Bills: row.bills,
    Revenue: fmtMoney(row.revenue),
    VAT: fmtMoney(row.vat),
  }));
  const monthlyBillRows = reportData.monthly_bill_counts.map((row) => ({
    Month: row.month,
    Bills: row.bills,
    Revenue: fmtMoney(row.revenue),
    VAT: fmtMoney(row.vat),
  }));
  const staffRows = reportData.staff_performance.map((row) => ({
    Staff: row.name,
    Role: row.role,
    Completed: row.orders_completed,
    Payments: row.payments_verified,
  }));
  const tableRows = reportData.table_usage.map((row) => ({
    Table: row.table_number,
    Orders: row.orders,
    Revenue: fmtMoney(row.revenue),
  }));
  const customerRows = reportData.customers.map((row) => ({
    Customer: row.customer_name,
    Orders: row.orders,
    Revenue: fmtMoney(row.revenue),
    "Last Order": row.last_order_at ? fmtDateTime(row.last_order_at) : "-",
  }));
  const feedbackRows = reportData.feedback.map((row) => ({
    Date: fmtDateTime(row.created_at),
    Customer: row.customer_name ?? "Guest",
    Table: row.table_number ?? "-",
    Rating: `${row.rating}/5`,
    Reactions: row.reactions.length > 0 ? row.reactions.join(", ") : "-",
    Comment: row.comment ?? "-",
    Photo: row.photo_url ? "Yes" : "No",
  }));
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
    [
      "Sales",
      "Average order value",
      Math.round(reportData.summary.average_order_value),
    ],
    ["Customers", "Unique customers", reportData.summary.unique_customers],
    ["Feedback", "Responses", reportData.summary.feedback_count],
    [
      "Feedback",
      "Average rating",
      reportData.summary.average_rating
        ? reportData.summary.average_rating.toFixed(1)
        : "0.0",
    ],
    ["Bills", "Bills printed", reportData.summary.bills_printed],
    ["Bills", "Bills reprinted", reportData.summary.bills_reprinted],
    ["Bills", "Average bill", Math.round(reportData.summary.average_bill)],
    ["Bills", "Largest bill", reportData.summary.largest_bill],
    ["Bills", "VAT collected", reportData.summary.vat_collected],
    ...reportData.payment_methods.map(
      (row) =>
        ["Payment Method", row.method, row.revenue] as [string, string, number],
    ),
    ...reportData.feedback.map(
      (row) =>
        [
          "Feedback",
          `${fmtDateTime(row.created_at)} | ${row.customer_name ?? "Guest"} | Table ${row.table_number ?? "-"}`,
          `${row.rating}/5 | ${row.reactions.join(", ") || "No reactions"} | ${row.comment ?? "No comment"}${row.photo_url ? ` | Photo: ${row.photo_url}` : ""}`,
        ] as [string, string, string],
    ),
  ];

  function handleCsvExport() {
    exportRowsAsCsv(
      `serveflow-report-${startDate}-${endDate}.csv`,
      exportHeaders,
      exportRows,
    );
  }

  function handleExcelExport() {
    exportRowsAsExcel(
      `serveflow-report-${startDate}-${endDate}.xls`,
      `${restaurantName} Reporting Center`,
      exportHeaders,
      exportRows,
    );
  }

  function handlePrint() {
    window.print();
  }

  return (
    <div className="od-page od-print-area">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">Reporting Center</h1>
          <p className="od-page-subtitle">
            Sales, operations, menu, staff, table, customer, and AI business
            reports.
          </p>
        </div>
        <div className="od-header-actions od-no-print">
          <button
            className="od-btn-ghost"
            type="button"
            onClick={handleCsvExport}
          >
            CSV Export
          </button>
          <button
            className="od-btn-ghost"
            type="button"
            onClick={handleExcelExport}
          >
            Excel Export
          </button>
          <button className="od-btn-ghost" type="button" onClick={handlePrint}>
            PDF / Print
          </button>
        </div>
      </div>

      <div className="od-card od-no-print">
        <div className="od-settings-grid compact">
          <label>
            Start Date
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label>
            End Date
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
        </div>
      </div>

      {reportError && <div className="od-error-inline">{reportError}</div>}

      <div className="od-kpi-grid analytics">
        <div className="od-kpi-card">
          <div className="od-kpi-label">Bills Printed Today</div>
          <div className="od-kpi-value">
            {loadingReport ? "Loading..." : reportData.summary.bills_printed}
          </div>
        </div>
        <div className="od-kpi-card">
          <div className="od-kpi-label">Bills Reprinted Today</div>
          <div className="od-kpi-value">
            {loadingReport ? "Loading..." : reportData.summary.bills_reprinted}
          </div>
        </div>
        <div className="od-kpi-card">
          <div className="od-kpi-label">Average Bill</div>
          <div className="od-kpi-value">
            {loadingReport
              ? "Loading..."
              : fmtMoney(Math.round(reportData.summary.average_bill))}
          </div>
        </div>
        <div className="od-kpi-card">
          <div className="od-kpi-label">Largest Bill</div>
          <div className="od-kpi-value">
            {loadingReport
              ? "Loading..."
              : fmtMoney(reportData.summary.largest_bill)}
          </div>
        </div>
        <div className="od-kpi-card">
          <div className="od-kpi-label">VAT Collected</div>
          <div className="od-kpi-value">
            {loadingReport
              ? "Loading..."
              : fmtMoney(reportData.summary.vat_collected)}
          </div>
        </div>
        <div className="od-kpi-card">
          <div className="od-kpi-label">Daily Bill Count</div>
          <div className="od-kpi-value">
            {loadingReport
              ? "Loading..."
              : reportData.daily_bill_counts.reduce(
                  (sum, row) => sum + row.bills,
                  0,
                )}
          </div>
        </div>
        <div className="od-kpi-card">
          <div className="od-kpi-label">Monthly Bill Count</div>
          <div className="od-kpi-value">
            {loadingReport
              ? "Loading..."
              : reportData.monthly_bill_counts.reduce(
                  (sum, row) => sum + row.bills,
                  0,
                )}
          </div>
        </div>
        <div className="od-kpi-card">
          <div className="od-kpi-label">Bill Revenue</div>
          <div className="od-kpi-value">
            {loadingReport
              ? "Loading..."
              : fmtMoneyK(
                  reportData.top_bills.reduce(
                    (sum, row) => sum + row.grand_total,
                    0,
                  ),
                )}
          </div>
        </div>
      </div>

      <ReportTable
        title="Top Bills"
        subtitle="Highest final dining bills from dining_session_bills only."
        headers={[
          "Bill Number",
          "Printed",
          "Print Count",
          "Grand Total",
          "VAT",
        ]}
        rows={topBillRows}
      />
      <ReportTable
        title="Daily Bill Count"
        subtitle="Daily final bill counts from dining_session_bills only."
        headers={["Date", "Bills", "Revenue", "VAT"]}
        rows={dailyBillRows}
      />
      <ReportTable
        title="Monthly Bill Count"
        subtitle="Monthly final bill counts from dining_session_bills only."
        headers={["Month", "Bills", "Revenue", "VAT"]}
        rows={monthlyBillRows}
      />

      <div className="od-card">
        <div className="od-card-header">
          <div>
            <div className="od-card-title">Sales Reports</div>
            <div className="od-card-subtitle">
              Revenue and order trend for the selected date range.
            </div>
          </div>
        </div>
        <MiniLineChart rows={reportData.sales_by_day} />
      </div>

      <ReportTable
        title="Order Reports"
        subtitle="Order volume by workflow status."
        headers={["Status", "Orders"]}
        rows={orderRows}
      />
      <ReportTable
        title="Menu Performance Reports"
        subtitle="Top menu items by persisted order item revenue."
        headers={["Item", "Category", "Quantity", "Revenue"]}
        rows={menuRows}
      />
      <ReportTable
        title="Payment Method Reports"
        subtitle="Revenue by payment method."
        headers={["Method", "Payments", "Revenue"]}
        rows={paymentMethodRows}
      />
      <ReportTable
        title="Staff Performance Reports"
        subtitle="Payment collection and completion activity by staff member."
        headers={["Staff", "Role", "Completed", "Payments"]}
        rows={staffRows}
      />
      <ReportTable
        title="Cashier Shift History"
        subtitle="Read-only shift openings, closings, and reconciliation totals."
        headers={[
          "Cashier",
          "Opened",
          "Closed",
          "Expected",
          "Actual",
          "Variance",
        ]}
        rows={shiftRows}
      />
      <ReportTable
        title="Cash Variance Reports"
        subtitle="Permanent reconciliation variances recorded at shift close."
        headers={[
          "Cashier",
          "Closed",
          "Expected",
          "Actual",
          "Variance",
          "Reason",
        ]}
        rows={varianceRows}
      />
      <ReportTable
        title="Table Usage Reports"
        subtitle="Revenue and order volume by managed table."
        headers={["Table", "Orders", "Revenue"]}
        rows={tableRows}
      />
      <ReportTable
        title="Customer Reports"
        subtitle="Repeat and high-value customers based on captured customer names."
        headers={["Customer", "Orders", "Revenue", "Last Order"]}
        rows={customerRows}
      />
      <ReportTable
        title="Customer Feedback Reports"
        subtitle="Ratings, comments, reactions, and optional photos submitted after served orders."
        headers={[
          "Date",
          "Customer",
          "Table",
          "Rating",
          "Reactions",
          "Comment",
          "Photo",
        ]}
        rows={feedbackRows}
      />

      <div className="od-card">
        <div className="od-card-header">
          <div>
            <div className="od-card-title">AI Business Reports</div>
            <div className="od-card-subtitle">
              Operational recommendations derived from current report data.
            </div>
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

function CustomersPage({ restaurantId }: { restaurantId: string }) {
  return (
    <div className="od-page od-operations-page od-customers-experience">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">Customer Insights</h1>
          <p className="od-page-subtitle">
            Customer frequency and value from captured order names.
          </p>
        </div>
      </div>
    </div>
  );
}

function getOrderingUrl(
  qrUrl: string | null | undefined,
  qrPath?: string | null | undefined,
) {
  return buildAbsolutePublicUrl(qrUrl?.trim() || qrPath?.trim());
}

function getOrderingUrlOrigin(orderingUrl: string) {
  try {
    return new URL(orderingUrl).origin;
  } catch {
    return "relative";
  }
}

function logOwnerQrDiagnostic(stage: string, context: Record<string, unknown>) {
  const viteEnv = import.meta.env as unknown as { DEV?: boolean };
  if (!viteEnv.DEV) return;
  console.debug("[ServeFlow QR]", stage, context);
}

type PrintableQrTable = {
  table: RestaurantTable;
  orderingUrl: string;
};

function safeFilename(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "qr-code"
  );
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
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
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

function drawRoundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(
    x + width,
    y + height,
    x + width - radius,
    y + height,
  );
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

  assertAbsoluteQrPayload(orderingUrl);
  const qrDataUrl = await QRCode.toDataURL(orderingUrl, {
    width: 560,
    margin: 1,
  });
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

function buildPdfFromJpegs(
  images: { bytes: Uint8Array; width: number; height: number }[],
) {
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
    const pageId = addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im${imageId} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
    const imageHeader = `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`;
    const imageFooter = "\nendstream";
    const imageObject = new Uint8Array(
      imageHeader.length + image.bytes.length + imageFooter.length,
    );
    imageObject.set(new TextEncoder().encode(imageHeader), 0);
    imageObject.set(image.bytes, imageHeader.length);
    imageObject.set(
      new TextEncoder().encode(imageFooter),
      imageHeader.length + image.bytes.length,
    );
    addObject(imageObject);
    const contentStream = `q\n540 0 0 720 36 36 cm\n/Im${imageId} Do\nQ`;
    addObject(
      `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`,
    );
  });

  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  const chunks: Uint8Array[] = [new TextEncoder().encode("%PDF-1.4\n")];
  const offsets: number[] = [0];
  let length = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const header = new TextEncoder().encode(`${index + 1} 0 obj\n`);
    const body =
      typeof object === "string" ? new TextEncoder().encode(object) : object;
    const footer = new TextEncoder().encode("\nendobj\n");
    chunks.push(header, body, footer);
    length += header.length + body.length + footer.length;
  });
  const xrefOffset = length;
  const xref = [
    `xref\n0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    `startxref\n${xrefOffset}`,
    "%%EOF",
  ].join("\n");
  chunks.push(new TextEncoder().encode(xref));
  const blobParts = chunks.map(
    (chunk) =>
      chunk.buffer.slice(
        chunk.byteOffset,
        chunk.byteOffset + chunk.byteLength,
      ) as ArrayBuffer,
  );
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
  const [qrStats, setQrStats] = useState<
    Record<string, RestaurantTableQrStats>
  >({});
  const [previewTable, setPreviewTable] = useState<RestaurantTable | null>(
    null,
  );
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [workingTableId, setWorkingTableId] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const activeTableOrders = orders.filter(
    (order) => order.dining_session_status === "open",
  );
  const activeTables = new Set(
    activeTableOrders.map((order) => order.table_number).filter(Boolean),
  );
  const todayStart = startOfTodayIso();
  const rows = tables.map((restaurantTable) => {
    const number = String(restaurantTable.table_number);
    const activeOrder = activeTableOrders.find(
      (order) => order.table_number === number,
    );
    return {
      table: restaurantTable,
      occupied: Boolean(activeOrder),
      ordersToday:
        qrStats[restaurantTable.id]?.orders_today ??
        orders.filter(
          (order) =>
            order.table_number === number && order.created_at >= todayStart,
        ).length,
      lastScanAt: qrStats[restaurantTable.id]?.last_scan_at ?? null,
      lastOrderAt:
        qrStats[restaurantTable.id]?.last_order_at ??
        orders.find((order) => order.table_number === number)?.created_at ??
        null,
      scanCount: qrStats[restaurantTable.id]?.scan_count ?? null,
      orderingUrl: getOrderingUrl(
        restaurantTable.qr_url,
        restaurantTable.qr_path,
      ),
    };
  });

  const selectedRows = rows.filter((row) =>
    selectedTableIds.includes(row.table.id),
  );

  useEffect(() => {
    let mounted = true;
    async function generateQrCodes() {
      const pairs = await Promise.all(
        tables.map(async (table) => {
          const url = getOrderingUrl(table.qr_url, table.qr_path);
          if (!url) return [table.id, ""] as const;
          logOwnerQrDiagnostic("ownerDashboard:generatedQrUrl", {
            generatedQrUrl: url,
            currentAppUrl: getOrderingUrlOrigin(url),
            restaurantId,
            tableNumber: table.table_number,
          });
          assertAbsoluteQrPayload(url);
          const dataUrl = await QRCode.toDataURL(url, { width: 96, margin: 1 });
          return [table.id, dataUrl] as const;
        }),
      );
      if (mounted) setQrCodes(Object.fromEntries(pairs));
    }
    void generateQrCodes();
    return () => {
      mounted = false;
    };
  }, [restaurantId, tables]);

  useEffect(() => {
    let mounted = true;
    async function loadQrStats() {
      try {
        const { data, error } = await supabase.rpc("get_owner_table_qr_stats", {
          target_restaurant_id: restaurantId,
        });
        if (error) throw new Error(error.message);
        const statRows = Array.isArray(data) ? data : [];
        const normalizedStats = statRows.reduce<
          Record<string, RestaurantTableQrStats>
        >((accumulator, row) => {
          if (!row || typeof row !== "object") return accumulator;
          const payload = row as Record<string, unknown>;
          const tableId =
            typeof payload.table_id === "string" ? payload.table_id : "";
          if (!tableId) return accumulator;
          accumulator[tableId] = {
            table_id: tableId,
            orders_today: Number(payload.orders_today ?? 0),
            last_scan_at:
              typeof payload.last_scan_at === "string"
                ? payload.last_scan_at
                : null,
            last_order_at:
              typeof payload.last_order_at === "string"
                ? payload.last_order_at
                : null,
            scan_count:
              payload.scan_count === null ||
              typeof payload.scan_count === "undefined"
                ? null
                : Number(payload.scan_count),
          };
          return accumulator;
        }, {});
        if (mounted) setQrStats(normalizedStats);
      } catch (statsError) {
        if (mounted)
          setQrError(
            statsError instanceof Error
              ? statsError.message
              : "Could not load QR statistics.",
          );
      }
    }
    void loadQrStats();
    return () => {
      mounted = false;
    };
  }, [restaurantId, tables, orders]);

  async function regenerateQr(table: RestaurantTable) {
    try {
      setWorkingTableId(table.id);
      setQrError(null);
      setNotice(null);
      const { data, error } = await supabase.rpc(
        "regenerate_restaurant_table_qr",
        {
          target_restaurant_id: restaurantId,
          target_table_id: table.id,
        },
      );
      if (error) throw new Error(error.message);
      const updatedTable = normalizeRestaurantTable(
        data as Record<string, unknown>,
      );
      onTableChanged(updatedTable);
      setPreviewTable((current) =>
        current?.id === updatedTable.id ? updatedTable : current,
      );
      setNotice(`QR regenerated for ${updatedTable.label}.`);
    } catch (regenerateError) {
      setQrError(
        regenerateError instanceof Error
          ? regenerateError.message
          : "Could not regenerate QR code.",
      );
    } finally {
      setWorkingTableId(null);
    }
  }

  async function setTableActive(table: RestaurantTable, active: boolean) {
    try {
      setWorkingTableId(table.id);
      setQrError(null);
      setNotice(null);
      const { data, error } = await supabase.rpc(
        "set_restaurant_table_active",
        {
          target_restaurant_id: restaurantId,
          target_table_id: table.id,
          requested_active: active,
        },
      );
      if (error) throw new Error(error.message);
      const updatedTable = normalizeRestaurantTable(
        data as Record<string, unknown>,
      );
      onTableChanged(updatedTable);
      setPreviewTable((current) =>
        current?.id === updatedTable.id ? updatedTable : current,
      );
      setNotice(`${updatedTable.label} ${active ? "enabled" : "disabled"}.`);
    } catch (activeError) {
      setQrError(
        activeError instanceof Error
          ? activeError.message
          : "Could not update table status.",
      );
    } finally {
      setWorkingTableId(null);
    }
  }

  const previewUrl = previewTable
    ? getOrderingUrl(previewTable.qr_url, previewTable.qr_path)
    : "";
  const previewPrintable =
    previewTable && previewUrl
      ? { table: previewTable, orderingUrl: previewUrl }
      : null;
  const allSelected =
    rows.length > 0 &&
    rows.every((row) => selectedTableIds.includes(row.table.id));

  function toggleSelectedTable(tableId: string) {
    setSelectedTableIds((previous) =>
      previous.includes(tableId)
        ? previous.filter((id) => id !== tableId)
        : [...previous, tableId],
    );
  }

  function toggleAllSelected() {
    setSelectedTableIds(allSelected ? [] : rows.map((row) => row.table.id));
  }

  async function downloadQrPng(printable: PrintableQrTable) {
    const canvas = await createQrCardCanvas({
      restaurantName,
      logoUrl,
      table: printable.table,
      orderingUrl: printable.orderingUrl,
    });
    canvas.toBlob((blob) => {
      if (blob)
        downloadBlob(
          `${safeFilename(restaurantName)}-table-${printable.table.table_number}-qr.png`,
          blob,
        );
    }, "image/png");
  }

  async function downloadQrSvg(printable: PrintableQrTable) {
    assertAbsoluteQrPayload(printable.orderingUrl);
    const qrSvg = await QRCode.toString(printable.orderingUrl, {
      type: "svg",
      width: 360,
      margin: 1,
    });
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
<g transform="translate(70 230)">${qrSvg
      .replace(/<\?xml[^>]*>/, "")
      .replace(/<svg[^>]*>/, "")
      .replace("</svg>", "")}</g>
<text x="250" y="626" text-anchor="middle" font-family="Arial" font-size="26" font-weight="800" fill="#0f172a">Scan to Order</text>
<text x="250" y="658" text-anchor="middle" font-family="Arial" font-size="11" font-weight="600" fill="#64748b">${escapedUrl}</text>
</svg>`;
    downloadBlob(
      `${safeFilename(restaurantName)}-table-${printable.table.table_number}-qr.svg`,
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
    );
  }

  async function downloadQrPdf(
    printables: PrintableQrTable[],
    filename: string,
  ) {
    if (printables.length === 0) return;
    const images = await Promise.all(
      printables.map(async (printable) => {
        const canvas = await createQrCardCanvas({
          restaurantName,
          logoUrl,
          table: printable.table,
          orderingUrl: printable.orderingUrl,
        });
        return {
          bytes: dataUrlToBytes(canvas.toDataURL("image/jpeg", 0.92)),
          width: canvas.width,
          height: canvas.height,
        };
      }),
    );
    downloadBlob(filename, buildPdfFromJpegs(images));
  }

  async function printQrCards(printables: PrintableQrTable[]) {
    if (printables.length === 0) return;
    const cards = await Promise.all(
      printables.map(async (printable) => {
        assertAbsoluteQrPayload(printable.orderingUrl);
        const qrDataUrl = await QRCode.toDataURL(printable.orderingUrl, {
          width: 320,
          margin: 1,
        });
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
      }),
    );
    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) {
      setQrError(
        "Could not open the print window. Please allow pop-ups for this site.",
      );
      return;
    }
    printWindow.document
      .write(`<!doctype html><html><head><title>${escapeHtml(restaurantName)} QR Codes</title><style>
body{margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a}.qr-print-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;padding:24px}.qr-print-card{break-inside:avoid;page-break-inside:avoid;background:#fff;border:1px solid #d8dee8;border-radius:14px;padding:28px;text-align:center;display:grid;justify-items:center;gap:10px}.qr-logo{width:72px;height:72px;border-radius:10px;object-fit:cover;border:1px solid #d8dee8}.qr-logo.fallback{display:grid;place-items:center;background:#0f766e;color:#fff;font-size:22px;font-weight:800}.qr-code{width:280px;height:280px}h1{font-size:24px;line-height:1.15;margin:0}h2{font-size:18px;color:#64748b;margin:0}.scan{font-size:24px;font-weight:800;margin:0}@media print{body{background:#fff}.qr-print-grid{padding:0;grid-template-columns:repeat(2,1fr)}.qr-print-card{border:0;min-height:46vh;page-break-inside:avoid}}@page{size:A4;margin:12mm}
</style></head><body><main class="qr-print-grid">${cards.join("")}</main><script>window.addEventListener('load',()=>{const images=[...document.images];Promise.all(images.map((image)=>image.complete?Promise.resolve():new Promise((resolve)=>{image.onload=resolve;image.onerror=resolve;}))).then(()=>setTimeout(()=>window.print(),100));});<\/script></body></html>`);
    printWindow.document.close();
  }

  return (
    <div className="od-page od-operations-page od-qr-experience">
      <div className="od-page-header">
        <div>
          <h1 className="od-page-title">QR & Table Management</h1>
          <p className="od-page-subtitle">
            Business floor and QR management for {restaurantName}
          </p>
        </div>
        <div className="od-header-actions">
          <button
            className="od-btn-ghost"
            type="button"
            onClick={() => void printQrCards(selectedRows)}
            disabled={selectedRows.length === 0}
          >
            Print Selected
          </button>
          <button
            className="od-btn-primary"
            type="button"
            onClick={() => void printQrCards(rows)}
          >
            Print All Tables
          </button>
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
          <div className="od-kpi-value">
            {tables.filter((table) => !table.active).length}
          </div>
        </div>
      </div>
      {(qrError || notice) && (
        <div className={qrError ? "od-error-inline" : "od-success-inline"}>
          {qrError || notice}
        </div>
      )}
      <div className="od-card">
        <div className="od-card-header">
          <div>
            <div className="od-card-title">Business Tables</div>
            <div className="od-card-subtitle">
              Owner QR controls for the direct /r/{restaurantSlug || ":slug"}{" "}
              digital menu route.
            </div>
          </div>
        </div>
        <div className="od-table-wrap">
          <table className="od-table od-qr-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAllSelected}
                    aria-label="Select all table QR codes"
                  />
                </th>
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
              {rows.map(
                ({
                  table,
                  occupied,
                  ordersToday,
                  lastScanAt,
                  lastOrderAt,
                  scanCount,
                  orderingUrl,
                }) => (
                  <tr key={table.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedTableIds.includes(table.id)}
                        onChange={() => toggleSelectedTable(table.id)}
                        aria-label={`Select ${table.label}`}
                      />
                    </td>
                    <td>
                      <strong>
                        {table.label || `Table ${table.table_number}`}
                      </strong>
                    </td>
                    <td>
                      <span
                        className={
                          table.active ? "od-active-pill" : "od-offline-pill"
                        }
                      >
                        {table.active ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`od-status-badge ${occupied ? "paid" : "pending"}`}
                      >
                        {occupied ? "Occupied" : "Available"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="od-qr-thumb-button"
                        type="button"
                        onClick={() => setPreviewTable(table)}
                        disabled={!orderingUrl}
                        aria-label={`View QR for ${table.label}`}
                      >
                        {qrCodes[table.id] ? (
                          <img
                            className="od-qr-thumb"
                            src={qrCodes[table.id]}
                            alt={`QR for ${table.label}`}
                          />
                        ) : (
                          <span className="od-qr-placeholder compact">QR</span>
                        )}
                      </button>
                    </td>
                    <td>
                      {table.created_at
                        ? fmtDateTime(table.created_at)
                        : "Not recorded"}
                    </td>
                    <td>
                      {table.qr_regenerated_at
                        ? fmtDateTime(table.qr_regenerated_at)
                        : "Not recorded"}
                    </td>
                    <td>
                      <strong>{ordersToday}</strong>
                    </td>
                    <td>{lastScanAt ? fmtTimeAgo(lastScanAt) : "No scans"}</td>
                    <td>
                      {lastOrderAt ? fmtTimeAgo(lastOrderAt) : "No orders"}
                    </td>
                    <td>{scanCount ?? "N/A"}</td>
                    <td>
                      <div className="od-row-actions">
                        <button
                          className="od-btn-ghost compact"
                          type="button"
                          onClick={() => setPreviewTable(table)}
                          disabled={!orderingUrl}
                        >
                          View QR
                        </button>
                        <button
                          className="od-btn-ghost compact"
                          type="button"
                          onClick={() => void regenerateQr(table)}
                          disabled={workingTableId === table.id}
                        >
                          Regenerate QR
                        </button>
                        {table.active ? (
                          <button
                            className="od-btn-ghost compact danger"
                            type="button"
                            onClick={() => void setTableActive(table, false)}
                            disabled={workingTableId === table.id}
                          >
                            Disable
                          </button>
                        ) : (
                          <button
                            className="od-btn-ghost compact"
                            type="button"
                            onClick={() => void setTableActive(table, true)}
                            disabled={workingTableId === table.id}
                          >
                            Enable
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="od-empty compact">
              No restaurant tables found. Save table settings to synchronize QR
              records.
            </div>
          )}
        </div>
      </div>
      {previewTable && (
        <div
          className="od-modal-backdrop"
          role="presentation"
          onClick={() => setPreviewTable(null)}
        >
          <div
            className="od-modal od-qr-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="od-qr-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="od-modal-header">
              <div>
                <div className="od-card-title" id="od-qr-modal-title">
                  Table QR Code
                </div>
                <div className="od-card-subtitle">{restaurantName}</div>
              </div>
              <button
                className="od-icon-btn"
                type="button"
                aria-label="Close QR preview"
                onClick={() => setPreviewTable(null)}
              >
                X
              </button>
            </div>
            <div className="od-qr-preview">
              {logoUrl ? (
                <img
                  className="od-qr-logo"
                  src={logoUrl}
                  alt={`${restaurantName} logo`}
                />
              ) : (
                <div className="od-qr-logo fallback">
                  {restaurantName.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="od-qr-restaurant">{restaurantName}</div>
              <div className="od-qr-table-number">
                Table {previewTable.table_number}
              </div>
              {qrCodes[previewTable.id] ? (
                <img
                  className="od-qr-large"
                  src={qrCodes[previewTable.id]}
                  alt={`QR code for table ${previewTable.table_number}`}
                />
              ) : (
                <div className="od-qr-large od-qr-placeholder">QR</div>
              )}
              <a
                className="od-qr-url"
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
              >
                {previewUrl}
              </a>
              {previewPrintable && (
                <div className="od-qr-export-actions">
                  <button
                    className="od-btn-ghost"
                    type="button"
                    onClick={() => void downloadQrPng(previewPrintable)}
                  >
                    Download PNG
                  </button>
                  <button
                    className="od-btn-ghost"
                    type="button"
                    onClick={() => void downloadQrSvg(previewPrintable)}
                  >
                    Download SVG
                  </button>
                  <button
                    className="od-btn-ghost"
                    type="button"
                    onClick={() =>
                      void downloadQrPdf(
                        [previewPrintable],
                        `${safeFilename(restaurantName)}-table-${previewTable.table_number}-qr.pdf`,
                      )
                    }
                  >
                    Download PDF
                  </button>
                  <button
                    className="od-btn-primary"
                    type="button"
                    onClick={() => void printQrCards([previewPrintable])}
                  >
                    Print
                  </button>
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
  businessType: string;
  totalTables: string;
  phone: string;
  email: string;
  address: string;
  description: string;
  website: string;
  instagram: string;
  facebook: string;
  tinVat: string;
  receiptFooter: string;
  timezone: string;
  currency: string;
  currencySymbol: string;
  locale: string;
  dateFormat: string;
  timeFormat: "12h" | "24h";
  opensAt: string;
  closesAt: string;
  closedDays: string[];
  kitchenMode: "single" | "advanced" | "skipped";
  acceptsQrOrders: boolean;
  autoAcceptOrders: boolean;
  paymentPolicy: PaymentPolicy;
  vatEnabled: boolean;
  vatPercentage: string;
  serviceChargeEnabled: boolean;
  serviceCharge: string;
  primaryColor: string;
  logoUrl: string;
  coverUrl: string;
  emailNotifications: boolean;
  smsNotifications: boolean;
  requireStrongPasswords: boolean;
  sessionTimeoutMinutes: string;
  menuTheme: MenuTheme;
};

const BUSINESS_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function configToSettingsForm(
  config: RestaurantConfig | null,
  fallbackName: string,
): SettingsFormState {
  const kitchenMode = jsonBool(config?.kitchen_settings ?? {}, "skipped", false)
    ? "skipped"
    : jsonString(config?.kitchen_settings ?? {}, "mode", "single") ===
        "advanced"
      ? "advanced"
      : "single";

  return {
    name: config?.name ?? fallbackName,
    businessType: jsonString(config?.profile ?? {}, "restaurant_type", "Restaurant"),
    totalTables: String(config?.total_tables ?? 20),
    phone: jsonString(config?.profile ?? {}, "phone"),
    email: jsonString(config?.profile ?? {}, "email"),
    address: jsonString(config?.profile ?? {}, "address"),
    description: jsonString(config?.profile ?? {}, "description"),
    website: jsonString((config?.profile?.social_links as Record<string, unknown>) ?? {}, "website"),
    instagram: jsonString((config?.profile?.social_links as Record<string, unknown>) ?? {}, "instagram"),
    facebook: jsonString((config?.profile?.social_links as Record<string, unknown>) ?? {}, "facebook"),
    tinVat: jsonString(config?.profile ?? {}, "tin_vat"),
    receiptFooter: jsonString(config?.profile ?? {}, "receipt_footer"),
    timezone: jsonString(config?.profile ?? {}, "timezone", "Africa/Nairobi"),
    currency: config?.currency_code ?? "ETB",
    currencySymbol: config?.currency_symbol ?? "Br",
    locale: config?.locale ?? "am-ET",
    dateFormat: config?.date_format ?? "medium",
    timeFormat: config?.time_format === "12h" ? "12h" : "24h",
    opensAt: jsonString(config?.business_hours ?? {}, "opens_at", "08:00"),
    closesAt: jsonString(config?.business_hours ?? {}, "closes_at", "22:00"),
    closedDays: jsonStringArray(config?.business_hours ?? {}, "closed_days"),
    kitchenMode,
    acceptsQrOrders: jsonBool(
      config?.ordering_settings ?? {},
      "accepts_qr_orders",
      true,
    ),
    autoAcceptOrders: jsonBool(
      config?.ordering_settings ?? {},
      "auto_accept_orders",
      false,
    ),
    paymentPolicy: config?.payment_policy ?? "pay_before_kitchen",
    vatEnabled: config?.vat_enabled ?? false,
    vatPercentage: String(config?.vat_percentage ?? 15),
    serviceChargeEnabled: config?.service_charge_enabled ?? false,
    serviceCharge: String(config?.service_charge_percentage ?? 0),
    primaryColor: jsonString(
      config?.branding ?? {},
      "primary_color",
      "#0f766e",
    ),
    logoUrl: jsonString(config?.branding ?? {}, "logo_url"),
    coverUrl: jsonString(config?.branding ?? {}, "cover_url"),
    emailNotifications: jsonBool(
      config?.notification_settings ?? {},
      "email_notifications",
      true,
    ),
    smsNotifications: jsonBool(
      config?.notification_settings ?? {},
      "sms_notifications",
      false,
    ),
    requireStrongPasswords: jsonBool(
      config?.security_settings ?? {},
      "require_strong_passwords",
      true,
    ),
    sessionTimeoutMinutes: String(
      (config?.security_settings?.session_timeout_minutes as
      number | undefined) ?? 480,
    ),
    menuTheme: config?.menu_theme ?? "modern",
  };
}

function SettingsPage({
  restaurantId,
  fallbackRestaurantName,
  config,
  tables,
  menuItems,
  kitchenStations,
  staff,
  onNavigate,
  onSettingsChanged,
}: {
  restaurantId: string;
  fallbackRestaurantName: string;
  config: RestaurantConfig | null;
  tables: RestaurantTable[];
  menuItems: OdMenuItem[];
  kitchenStations: OdKitchenStation[];
  staff: OdStaff[];
  onNavigate: (target: string) => void;
  onSettingsChanged: () => Promise<void>;
}) {
  const [form, setForm] = useState<SettingsFormState>(() =>
    configToSettingsForm(config, fallbackRestaurantName),
  );
  const [working, setWorking] = useState(false);
  const [assetUploading, setAssetUploading] = useState<"logo" | "cover" | null>(
    null,
  );
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [qrCodes, setQrCodes] = useState<Record<number, string>>({});
  const [appUrl, setAppUrl] = useState("");
  const [appUrlWorking, setAppUrlWorking] = useState(false);
  const [settingsWorkspace, setSettingsWorkspace] = useState<"business" | "printing-payments">("business");
  const activeTables = useMemo(
    () => tables.filter((table) => table.active),
    [tables],
  );

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
        if (mounted)
          setSettingsError(
            error instanceof Error
              ? error.message
              : "Could not load application URL.",
          );
      }
    }
    void loadAppUrl();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function generateQrCodes() {
      try {
        const pairs = await Promise.all(
          activeTables.slice(0, 80).map(async (table) => {
            const url = getOrderingUrl(table.qr_url, table.qr_path);
            if (!url) return [table.table_number, ""] as const;
            logOwnerQrDiagnostic("ownerSettings:generatedQrUrl", {
              generatedQrUrl: url,
              currentAppUrl: getOrderingUrlOrigin(url),
              restaurantId,
              tableNumber: table.table_number,
            });
            assertAbsoluteQrPayload(url);
            const dataUrl = await QRCode.toDataURL(url, {
              width: 132,
              margin: 1,
            });
            return [table.table_number, dataUrl] as const;
          }),
        );
        if (mounted) setQrCodes(Object.fromEntries(pairs));
      } catch (error) {
        if (mounted)
          setSettingsError(
            error instanceof Error
              ? error.message
              : "Could not generate QR codes.",
          );
      }
    }
    void generateQrCodes();
    return () => {
      mounted = false;
    };
  }, [activeTables]);

  function updateField<K extends keyof SettingsFormState>(
    key: K,
    value: SettingsFormState[K],
  ) {
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

  async function uploadBrandingAsset(
    assetType: "logo" | "cover",
    file: File | null,
  ) {
    if (!file) return;

    try {
      setAssetUploading(assetType);
      setSettingsError(null);
      setNotice(null);

      if (!file.type.startsWith("image/"))
        throw new Error("Branding asset must be an image file.");
      if (file.size > 5 * 1024 * 1024)
        throw new Error("Branding asset must be 5 MB or smaller.");

      const path = buildBrandingAssetPath(restaurantId, assetType);
      const { error: uploadError } = await supabase.storage
        .from("menu-photos")
        .upload(path, file, {
          cacheControl: "0",
          upsert: true,
          contentType: file.type,
        });
      if (uploadError) throw new Error(uploadError.message);

      const publicUrl = createSmartImagePublicUrl("menu-photos", path);
      if (assetType === "logo") updateField("logoUrl", publicUrl);
      if (assetType === "cover") updateField("coverUrl", publicUrl);
    } catch (uploadError) {
      setSettingsError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not upload branding asset.",
      );
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
      const vatPercentage = Number(form.vatPercentage);
      const sessionTimeout = Number(form.sessionTimeoutMinutes);
      const currencyCode = form.currency.trim().toUpperCase();
      const currencySymbol = form.currencySymbol.trim();
      const locale = form.locale.trim();
      if (
        !Number.isInteger(totalTables) ||
        totalTables < 1 ||
        totalTables > 500
      )
        throw new Error("Total tables must be a whole number from 1 to 500.");
      if (
        !Number.isFinite(vatPercentage) || vatPercentage < 0 || vatPercentage > 100
      ) throw new Error("VAT must be between 0 and 100 percent.");
      if (
        !Number.isFinite(serviceCharge) ||
        serviceCharge < 0 ||
        serviceCharge > 30
      )
        throw new Error("Service charge must be between 0 and 30 percent.");
      if (
        !Number.isInteger(sessionTimeout) ||
        sessionTimeout < 15 ||
        sessionTimeout > 1440
      )
        throw new Error("Session timeout must be between 15 and 1440 minutes.");
      if (!/^[A-Z]{3}$/.test(currencyCode))
        throw new Error("Currency code must be a 3-letter ISO code.");
      if (!currencySymbol) throw new Error("Currency symbol is required.");
      if (!locale) throw new Error("Locale is required.");

      const { error } = await supabase.rpc("update_restaurant_configuration", {
        target_restaurant_id: restaurantId,
        restaurant_name: form.name,
        requested_total_tables: totalTables,
        profile_payload: {
          phone: form.phone.trim(),
          email: form.email.trim(),
          address: form.address.trim(),
          description: form.description.trim(),
          restaurant_type: form.businessType,
          tin_vat: form.tinVat.trim(),
          receipt_footer: form.receiptFooter.trim(),
          social_links: {
            website: form.website.trim(),
            instagram: form.instagram.trim(),
            facebook: form.facebook.trim(),
          },
          timezone: form.timezone.trim(),
          currency: currencyCode,
        },
        business_hours_payload: {
          version: 1,
          opens_at: form.opensAt,
          closes_at: form.closesAt,
          closed_days: form.closedDays,
          schedules: [
            {
              name: "Default",
              opens_at: form.opensAt,
              closes_at: form.closesAt,
              closed_days: form.closedDays,
            },
          ],
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
      const { error: regionalError } = await supabase
        .from("restaurants")
        .update({
          currency_code: currencyCode,
          currency_symbol: currencySymbol,
          locale,
          date_format: form.dateFormat,
          time_format: form.timeFormat,
          menu_theme: form.menuTheme,
        })
        .eq("id", restaurantId);
      if (regionalError) throw new Error(regionalError.message);
      const { error: policyError } = await supabase.rpc(
        "set_restaurant_payment_policy",
        {
          target_restaurant_id: restaurantId,
          requested_policy: form.paymentPolicy,
        },
      );
      if (policyError) throw new Error(policyError.message);
      const { error: financialError } = await supabase.rpc(
        "set_restaurant_financial_settings",
        {
          target_restaurant_id: restaurantId,
          requested_vat_enabled: form.vatEnabled,
          requested_vat_percentage: vatPercentage,
          requested_service_charge_enabled: form.serviceChargeEnabled,
          requested_service_charge_percentage: serviceCharge,
        },
      );
      if (financialError) throw new Error(financialError.message);
      await onSettingsChanged();
      publishMenuThemeSelection(restaurantId, form.menuTheme);
      setNotice("Settings saved.");
    } catch (saveError) {
      setSettingsError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save settings.",
      );
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
      setSettingsError(
        error instanceof Error
          ? error.message
          : "Could not save application URL.",
      );
    } finally {
      setAppUrlWorking(false);
    }
  }

  async function regenerateAllQrCodes() {
    try {
      setAppUrlWorking(true);
      setSettingsError(null);
      setNotice(null);
      const { error } = await supabase.rpc(
        "regenerate_all_restaurant_table_qr",
        {
          target_restaurant_id: restaurantId,
        },
      );
      if (error) throw new Error(error.message);
      await onSettingsChanged();
      setNotice(
        "All table QR codes regenerated with the configured application URL.",
      );
    } catch (error) {
      setSettingsError(
        error instanceof Error
          ? error.message
          : "Could not regenerate QR codes.",
      );
    } finally {
      setAppUrlWorking(false);
    }
  }

  function handleCancel() {
    setForm(configToSettingsForm(config, fallbackRestaurantName));
    setSettingsError(null);
    setNotice(null);
  }

  const settingsHealthChecks: Array<[string, boolean, string]> = [
    ["Business Profile Complete", Boolean(form.name && form.businessType), "business-profile"],
    ["QR Menu Published", form.acceptsQrOrders && menuItems.length > 0, "business-profile"],
    ["Payment Methods Configured", false, "payment-billing"],
    ["Kitchen Station Configured", kitchenStations.some((station) => station.active), "printing"],
    ["Receipt Printer Connected", false, "printing"],
    ["Kitchen Printer Connected", false, "printing"],
    ["Inventory Ready", false, "notifications"],
    ["Staff Ready", staff.some((member) => member.active && isOperationalStaff(member)), "notifications"],
  ];

  return (
    <div className="od-page od-config-page">
      <div className="od-page-header od-config-header">
        <div>
          <span className="od-config-eyebrow">Owner settings</span>
          <h1 className="od-page-title">Business Configuration Center</h1>
          <p className="od-page-subtitle">
            Configure the essentials that keep your hospitality business ready for service.
          </p>
        </div>
      </div>

      {!config && (
        <div className="od-card">
          <div className="od-empty compact">Loading settings...</div>
        </div>
      )}
      {(settingsError || notice) && (
        <div
          className={settingsError ? "od-error-inline" : "od-success-inline"}
        >
          {settingsError || notice}
        </div>
      )}

      <nav className="od-settings-workspaces" aria-label="Business settings areas">
        <button type="button" className={settingsWorkspace === "business" ? "active" : ""} onClick={() => setSettingsWorkspace("business")}><span>B</span><div><strong>Business Settings</strong><small>Profile, hours and notifications</small></div></button>
        <button type="button" className={settingsWorkspace === "printing-payments" ? "active" : ""} onClick={() => setSettingsWorkspace("printing-payments")}><span>P</span><div><strong>Printing &amp; Payments</strong><small>Devices, kitchen output and customer payments</small></div></button>
      </nav>

      {settingsWorkspace === "printing-payments" ? <PrintingPaymentConfigurationCenter
        restaurantId={restaurantId}
        businessName={form.name || fallbackRestaurantName}
        currencySymbol={form.currencySymbol}
        stations={kitchenStations}
        health={{
          profileComplete: Boolean(form.name && form.businessType && form.address),
          menuPublished: jsonBool(config?.setup_status ?? {}, "completed", false),
          qrReady: form.acceptsQrOrders && activeTables.length > 0,
          inventoryReady: false,
          staffReady: staff.some((member) => member.active && isOperationalStaff(member)),
          logoReady: Boolean(form.logoUrl),
          hoursReady: Boolean(form.opensAt && form.closesAt),
        }}
        onNavigate={onNavigate}
        onOpenBusiness={() => setSettingsWorkspace("business")}
      /> : null}

      <form className={`od-config-center ${settingsWorkspace !== "business" ? "workspace-hidden" : ""}`} onSubmit={handleSave}>
        <aside className="od-health-card" aria-labelledby="system-health-title">
          <div className="od-health-score"><span>{settingsHealthChecks.filter(([, ready]) => ready).length}/{settingsHealthChecks.length}</span><small>systems ready</small></div>
          <div className="od-health-copy"><span className="od-config-eyebrow">System health</span><h2 id="system-health-title">Your business readiness</h2><p>See what is ready and jump directly to anything that still needs attention.</p></div>
          <div className="od-health-grid">
            {settingsHealthChecks.map(([label, ready, target]) => <a key={label} href={`#${target}`} className={ready ? "ready" : "attention"}><span aria-hidden="true">{ready ? "✓" : "!"}</span><strong>{label}</strong><small>{ready ? "Ready" : "Set up"}</small></a>)}
          </div>
        </aside>

        <div className="od-config-toolbar"><div><strong>Business essentials</strong><span>Profile and operational notifications</span></div><div><button className="od-btn-ghost" type="button" onClick={handleCancel} disabled={working}>Discard</button><button className="od-btn-primary" type="submit" disabled={working}>{working ? "Saving…" : "Save changes"}</button></div></div>

        <div className="od-config-sections">
          <details className="od-config-section" id="business-profile" open>
            <summary><span className="od-config-icon" aria-hidden="true">B</span><div><strong>Business</strong><small>Identity, location, hours, branding and regional preferences</small></div><span className="od-config-chevron" aria-hidden="true">⌄</span></summary>
            <div className="od-config-content">
              <div className="od-config-subhead"><h3>Business profile</h3><p>The information customers and staff use to recognize your business.</p></div>
              <div className="od-settings-grid">
                <label>Business Name<input value={form.name} onChange={(event) => updateField("name", event.target.value)} disabled={working} /></label>
                <label>Business Type<select value={form.businessType} onChange={(event) => updateField("businessType", event.target.value)} disabled={working}>{["Cafe", "Restaurant", "Hotel", "Fast Food", "Bar", "Lounge", "Bakery", "Food Business"].map((type) => <option value={type} key={type}>{type}</option>)}</select><small>Used to tailor your ServeFlow experience.</small></label>
                <label className="wide">Business Description<textarea value={form.description} onChange={(event) => updateField("description", event.target.value)} disabled={working} placeholder="Tell customers what makes your business special." /></label>
                <label className="wide">Address<input value={form.address} onChange={(event) => updateField("address", event.target.value)} disabled={working} /></label>
              </div>
              <div className="od-config-media-grid">
                <label className="od-media-upload"><span>{form.logoUrl ? "Logo ready" : "Add business logo"}</span><small>Square image recommended</small><input type="file" accept="image/*" onChange={(event) => void uploadBrandingAsset("logo", event.target.files?.[0] ?? null)} disabled={working || assetUploading !== null} /></label>
                <label className="od-media-upload cover"><span>{form.coverUrl ? "Cover ready" : "Add cover image"}</span><small>Wide image recommended</small><input type="file" accept="image/*" onChange={(event) => void uploadBrandingAsset("cover", event.target.files?.[0] ?? null)} disabled={working || assetUploading !== null} /></label>
              </div>
              <div className="od-config-divider" />
              <div className="od-config-subhead"><h3>Business hours</h3><p>Set the standard service window and closed days.</p></div>
              <div className="od-settings-grid compact"><label>Opens At<input type="time" value={form.opensAt} onChange={(event) => updateField("opensAt", event.target.value)} disabled={working} /></label><label>Closes At<input type="time" value={form.closesAt} onChange={(event) => updateField("closesAt", event.target.value)} disabled={working} /></label></div>
              <div className="od-day-pills">{BUSINESS_DAYS.map((day) => <label key={day} className={form.closedDays.includes(day) ? "closed" : ""}><input type="checkbox" checked={form.closedDays.includes(day)} onChange={() => toggleClosedDay(day)} disabled={working} /><span>{day.slice(0, 3)}</span><small>{form.closedDays.includes(day) ? "Closed" : "Open"}</small></label>)}</div>
              <div className="od-config-divider" />
              <div className="od-settings-grid compact"><label>Currency<select value={form.currency} onChange={(event) => updateField("currency", event.target.value)} disabled={working}><option value="ETB">ETB — Ethiopian Birr</option><option value="USD">USD — US Dollar</option><option value="EUR">EUR — Euro</option></select><small>Used across orders, reports and receipts.</small></label><label>Time Zone<input value={form.timezone} onChange={(event) => updateField("timezone", event.target.value)} disabled={working} /></label><label>Language<select value="current" disabled aria-label="Business language"><option value="current">Language configuration coming soon</option></select><small>Your current platform language remains unchanged.</small></label></div>
            </div>
          </details>

          <details className="od-config-section" id="payment-billing">
            <summary><span className="od-config-icon" aria-hidden="true">P</span><div><strong>Payment &amp; Billing</strong><small>Policies, methods, accounts, VAT and service charges</small></div><span className="od-config-chevron" aria-hidden="true">⌄</span></summary>
            <div className="od-config-content">
              <div className="od-config-subhead"><h3>Payment policy</h3><p>Choose when an order becomes eligible for kitchen preparation.</p></div>
              <div className="od-choice-grid"><label className={form.paymentPolicy === "pay_before_kitchen" ? "selected" : ""}><input type="radio" name="paymentPolicy" checked={form.paymentPolicy === "pay_before_kitchen"} onChange={() => updateField("paymentPolicy", "pay_before_kitchen")} /><strong>Customer Pays Before Kitchen</strong><small>Best for QR and counter ordering.</small></label><label className={form.paymentPolicy === "kitchen_before_payment" ? "selected" : ""}><input type="radio" name="paymentPolicy" checked={form.paymentPolicy === "kitchen_before_payment"} onChange={() => updateField("paymentPolicy", "kitchen_before_payment")} /><strong>Waiter Places Order → Payment Due</strong><small>Best for table service.</small></label><label className="future"><input type="radio" disabled /><strong>Mixed Mode</strong><small>Future capability</small></label></div>
              <div className="od-config-divider" />
              <div className="od-config-subhead"><h3>Payment methods</h3><p>Manage the methods displayed during checkout.</p></div>
              <div className="od-setting-list">{["Cash", "Telebirr", "CBE Birr", "Mobile Banking", "Bank Transfer", "Credit Card"].map((method, index) => <label key={method}><div><strong>{method}</strong><small>{index === 0 ? "Available for cashier payments" : "Account connection interface"}</small></div><input className="od-switch" type="checkbox" defaultChecked={index === 0} aria-label={`Enable ${method}`} /></label>)}</div>
              <div className="od-config-divider" />
              <div className="od-config-subhead"><h3>Business payment accounts</h3><p>Add Telebirr or bank settlement details. Account connections are presentation-only in this phase.</p></div>
              <div className="od-account-grid"><article><span>Mobile money</span><strong>Telebirr</strong><p>Business name · Phone number · Reference format</p><button type="button" className="od-btn-ghost" disabled>Add account</button></article><article><span>Commercial bank</span><strong>CBE and other banks</strong><p>Account name · Account number · Bank</p><button type="button" className="od-btn-ghost" disabled>Add bank account</button></article></div>
              <div className="od-config-divider" />
              <div className="od-charge-grid"><article><div><strong>VAT</strong><input className="od-switch" type="checkbox" checked={form.vatEnabled} onChange={(event) => updateField("vatEnabled", event.target.checked)} /></div><label>Percentage<input type="number" min="0" max="100" value={form.vatPercentage} onChange={(event) => updateField("vatPercentage", event.target.value)} disabled={!form.vatEnabled || working} /></label><select disabled={!form.vatEnabled}><option>Added after price</option><option>Included in price</option></select></article><article><div><strong>Service charge</strong><input className="od-switch" type="checkbox" checked={form.serviceChargeEnabled} onChange={(event) => updateField("serviceChargeEnabled", event.target.checked)} /></div><label>Percentage<input type="number" min="0" max="30" value={form.serviceCharge} onChange={(event) => updateField("serviceCharge", event.target.value)} disabled={!form.serviceChargeEnabled || working} /></label><select disabled={!form.serviceChargeEnabled}><option>Percentage</option><option>Fixed amount</option></select></article><article><div><strong>Commission</strong><input className="od-switch" type="checkbox" disabled /></div><p>Commission configuration is ready for a future business rule.</p></article><article><div><strong>Daily closing</strong><input className="od-switch" type="checkbox" disabled /></div><p>Closing automation will appear when the service is available.</p></article></div>
            </div>
          </details>

          <details className="od-config-section" id="printing">
            <summary><span className="od-config-icon" aria-hidden="true">R</span><div><strong>Printing</strong><small>Receipt, kitchen and station output configuration</small></div><span className="od-config-chevron" aria-hidden="true">⌄</span></summary>
            <div className="od-config-content"><div className="od-config-subhead"><h3>Printer connections</h3><p>Printer controls are ready for connection without changing printer services.</p></div><div className="od-printer-grid">{[["Receipt Printer","Not connected"],["Kitchen Printer","Not connected"],["Station Printers","No mappings"]].map(([name,status]) => <article key={name}><span className="od-printer-status" /><div><strong>{name}</strong><small>{status}</small></div><button type="button" className="od-btn-ghost" disabled>Configure</button></article>)}</div><div className="od-config-divider" /><div className="od-settings-grid compact"><label>Kitchen Output<select defaultValue="kds"><option value="kds">KDS</option><option value="printer">Printer</option><option value="both">Both</option></select><small>Choose how kitchen tickets are delivered.</small></label><label>Connection<select defaultValue="usb"><option value="usb">USB</option><option value="network">Network</option><option value="bluetooth" disabled>Bluetooth — Future</option></select></label><label>Printer Behaviour<select defaultValue="manual"><option value="manual">Print on demand</option><option value="automatic">Print automatically</option></select></label></div><div className="od-printer-map"><span>Printer mapping</span><div><strong>Kitchen</strong><small>Kitchen Printer</small></div><div><strong>Bar</strong><small>Bar Printer</small></div><div><strong>Bakery</strong><small>Bakery Printer</small></div></div><button type="button" className="od-btn-ghost" disabled>Run printer test</button></div>
          </details>

          <details className="od-config-section" id="notifications">
            <summary><span className="od-config-icon" aria-hidden="true">N</span><div><strong>Notifications</strong><small>Choose the operational updates that deserve your attention</small></div><span className="od-config-chevron" aria-hidden="true">⌄</span></summary>
            <div className="od-config-content"><div className="od-config-subhead"><h3>Business alerts</h3><p>Keep important activity visible without unnecessary noise.</p></div><div className="od-setting-list">{["Low Stock", "Orders", "Refunds", "Finance", "Attendance", "Daily Closing Reminder"].map((notification, index) => <label key={notification}><div><strong>{notification}</strong><small>{index < 2 ? "Recommended for daily operations" : "Optional owner notification"}</small></div><input className="od-switch" type="checkbox" defaultChecked={index < 2} aria-label={`Enable ${notification} notifications`} /></label>)}</div></div>
          </details>
        </div>
      </form>

      <form className="od-settings-form" onSubmit={handleSave} hidden aria-hidden="true">
        <div className="od-settings-actions">
          <button
            className="od-btn-ghost"
            type="button"
            onClick={handleCancel}
            disabled={working}
          >
            Cancel
          </button>
          <button className="od-btn-primary" type="submit" disabled={working}>
            {working ? "Saving..." : "Save Changes"}
          </button>
        </div>

        <div className="od-settings-layout">
          <div className="od-settings-main">
            <section className="od-card">
              <div className="od-card-header">
                <div>
                  <div className="od-card-title">Business Information</div>
                  <div className="od-card-subtitle">
                    Core information used across owner and public experiences.
                  </div>
                </div>
              </div>
              <div className="od-settings-grid">
                <label>
                  Business Name
                  <input
                    value={form.name}
                    onChange={(event) =>
                      updateField("name", event.target.value)
                    }
                    disabled={working}
                  />
                </label>
                <label>
                  Business Type
                  <select value={form.businessType} onChange={(event) => updateField("businessType", event.target.value)} disabled={working}>
                    {['Restaurant', 'Cafe', 'Hotel', 'Fast Food', 'Bar', 'Lounge'].map((type) => <option value={type} key={type}>{type}</option>)}
                  </select>
                </label>
                <label>
                  Phone
                  <input
                    value={form.phone}
                    onChange={(event) =>
                      updateField("phone", event.target.value)
                    }
                    disabled={working}
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) =>
                      updateField("email", event.target.value)
                    }
                    disabled={working}
                  />
                </label>
                <label className="wide">
                  Address
                  <input
                    value={form.address}
                    onChange={(event) =>
                      updateField("address", event.target.value)
                    }
                    disabled={working}
                  />
                </label>
                <label className="wide">
                  Description
                  <textarea
                    value={form.description}
                    onChange={(event) =>
                      updateField("description", event.target.value)
                    }
                    disabled={working}
                  />
                </label>
                <label>
                  Website
                  <input inputMode="url" value={form.website} onChange={(event) => updateField("website", event.target.value)} disabled={working} />
                </label>
                <label>
                  Instagram
                  <input value={form.instagram} onChange={(event) => updateField("instagram", event.target.value)} disabled={working} />
                </label>
                <label>
                  Facebook
                  <input value={form.facebook} onChange={(event) => updateField("facebook", event.target.value)} disabled={working} />
                </label>
                <label>
                  VAT / TIN
                  <input value={form.tinVat} onChange={(event) => updateField("tinVat", event.target.value)} disabled={working} />
                </label>
                <label className="wide">
                  Receipt Footer
                  <input value={form.receiptFooter} onChange={(event) => updateField("receiptFooter", event.target.value)} disabled={working} />
                </label>
                <label>
                  Timezone
                  <input
                    value={form.timezone}
                    onChange={(event) =>
                      updateField("timezone", event.target.value)
                    }
                    disabled={working}
                  />
                </label>
              </div>
            </section>

            <section className="od-card">
              <div className="od-card-header">
                <div>
                  <div className="od-card-title">
                    Currency & Regional Settings
                  </div>
                  <div className="od-card-subtitle">
                    Controls how money, dates, and time are displayed for this
                    restaurant only.
                  </div>
                </div>
              </div>
              <div className="od-settings-grid compact">
                <label>
                  Currency Code
                  <input
                    value={form.currency}
                    maxLength={3}
                    onChange={(event) =>
                      updateField("currency", event.target.value.toUpperCase())
                    }
                    disabled={working}
                  />
                </label>
                <label>
                  Currency Symbol
                  <input
                    value={form.currencySymbol}
                    maxLength={12}
                    onChange={(event) =>
                      updateField("currencySymbol", event.target.value)
                    }
                    disabled={working}
                  />
                </label>
                <label>
                  Locale
                  <input
                    value={form.locale}
                    onChange={(event) =>
                      updateField("locale", event.target.value)
                    }
                    disabled={working}
                  />
                </label>
                <label>
                  Date Format
                  <select
                    value={form.dateFormat}
                    onChange={(event) =>
                      updateField("dateFormat", event.target.value)
                    }
                    disabled={working}
                  >
                    <option value="short">Short</option>
                    <option value="medium">Medium</option>
                    <option value="long">Long</option>
                  </select>
                </label>
                <label>
                  Time Format
                  <select
                    value={form.timeFormat}
                    onChange={(event) =>
                      updateField(
                        "timeFormat",
                        event.target.value as SettingsFormState["timeFormat"],
                      )
                    }
                    disabled={working}
                  >
                    <option value="24h">24-hour</option>
                    <option value="12h">12-hour</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="od-card">
              <div className="od-card-header">
                <div>
                  <div className="od-card-title">Table Management</div>
                  <div className="od-card-subtitle">
                    Updates the configured table count used for table
                    validation.
                  </div>
                </div>
              </div>
              <div className="od-settings-grid compact">
                <label>
                  Total Tables
                  <input
                    type="number"
                    min="1"
                    max="500"
                    value={form.totalTables}
                    onChange={(event) =>
                      updateField("totalTables", event.target.value)
                    }
                    disabled={working}
                  />
                </label>
                <div className="od-setting-stat">
                  <strong>{activeTables.length}</strong>
                  <span>Active table records</span>
                </div>
                <div className="od-setting-stat">
                  <strong>{config?.total_tables ?? form.totalTables}</strong>
                  <span>Configured tables</span>
                </div>
              </div>
            </section>

            <section className="od-card">
              <div className="od-card-header">
                <div>
                  <div className="od-card-title">Business Hours</div>
                  <div className="od-card-subtitle">
                    Default operating window for ordering and reports.
                  </div>
                </div>
              </div>
              <div className="od-settings-grid compact">
                <label>
                  Opens At
                  <input
                    type="time"
                    value={form.opensAt}
                    onChange={(event) =>
                      updateField("opensAt", event.target.value)
                    }
                    disabled={working}
                  />
                </label>
                <label>
                  Closes At
                  <input
                    type="time"
                    value={form.closesAt}
                    onChange={(event) =>
                      updateField("closesAt", event.target.value)
                    }
                    disabled={working}
                  />
                </label>
                <div className="od-settings-day-group">
                  {BUSINESS_DAYS.map((day) => (
                    <label className="od-toggle-row" key={day}>
                      <input
                        type="checkbox"
                        checked={form.closedDays.includes(day)}
                        onChange={() => toggleClosedDay(day)}
                        disabled={working}
                      />
                      {day} closed
                    </label>
                  ))}
                </div>
              </div>
            </section>

            <section className="od-card">
              <div className="od-card-header">
                <div>
                  <div className="od-card-title">Kitchen Configuration</div>
                  <div className="od-card-subtitle">
                    Stores the onboarding kitchen preference only.
                  </div>
                </div>
              </div>
              <div className="od-settings-grid compact">
                <label>
                  Kitchen Setup
                  <select
                    value={form.kitchenMode}
                    onChange={(event) =>
                      updateField(
                        "kitchenMode",
                        event.target.value as SettingsFormState["kitchenMode"],
                      )
                    }
                    disabled={working}
                  >
                    <option value="single">Single Kitchen</option>
                    <option value="advanced">
                      Multiple Kitchen Stations Preference
                    </option>
                    <option value="skipped">Skipped</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="od-card">
              <div className="od-card-header">
                <div>
                  <div className="od-card-title">Ordering Settings</div>
                  <div className="od-card-subtitle">
                    Customer ordering behavior and payment workflow defaults.
                  </div>
                </div>
              </div>
              <div className="od-settings-grid compact">
                <label className="od-toggle-row">
                  <input
                    type="checkbox"
                    checked={form.acceptsQrOrders}
                    onChange={(event) =>
                      updateField("acceptsQrOrders", event.target.checked)
                    }
                    disabled={working}
                  />
                  QR orders enabled
                </label>
                <label className="od-toggle-row">
                  <input
                    type="checkbox"
                    checked={form.autoAcceptOrders}
                    onChange={(event) =>
                      updateField("autoAcceptOrders", event.target.checked)
                    }
                    disabled={working}
                  />
                  Auto-accept paid orders
                </label>
                <label>
                  Payment Policy
                  <select
                    value={form.paymentPolicy}
                    onChange={(event) =>
                      updateField(
                        "paymentPolicy",
                        event.target.value as PaymentPolicy,
                      )
                    }
                    disabled={working}
                  >
                    <option value="pay_before_kitchen">
                      Pay Before Kitchen
                    </option>
                    <option value="kitchen_before_payment">
                      Kitchen Before Payment
                    </option>
                  </select>
                  <small>
                    QR customer orders always require payment before kitchen.
                  </small>
                </label>
                <label className="od-toggle-row">
                  <input
                    type="checkbox"
                    checked={form.vatEnabled}
                    onChange={(event) =>
                      updateField("vatEnabled", event.target.checked)
                    }
                    disabled={working}
                  />
                  VAT enabled
                </label>
                <label>
                  VAT %
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={form.vatPercentage}
                    onChange={(event) =>
                      updateField("vatPercentage", event.target.value)
                    }
                    disabled={working || !form.vatEnabled}
                  />
                </label>
                <label className="od-toggle-row">
                  <input
                    type="checkbox"
                    checked={form.serviceChargeEnabled}
                    onChange={(event) =>
                      updateField("serviceChargeEnabled", event.target.checked)
                    }
                    disabled={working}
                  />
                  Service charge enabled
                </label>
                <label>
                  Service Charge %
                  <input
                    type="number"
                    min="0"
                    max="30"
                    step="0.1"
                    value={form.serviceCharge}
                    onChange={(event) =>
                      updateField("serviceCharge", event.target.value)
                    }
                    disabled={working || !form.serviceChargeEnabled}
                  />
                </label>
              </div>
            </section>

            <section className="od-card">
              <div className="od-card-header">
                <div>
                  <div className="od-card-title">Branding</div>
                  <div className="od-card-subtitle">
                    Public menu visual identity.
                  </div>
                </div>
              </div>
              <div className="od-settings-grid compact">
                <label>
                  Primary Color
                  <input
                    type="color"
                    value={form.primaryColor}
                    onChange={(event) =>
                      updateField("primaryColor", event.target.value)
                    }
                    disabled={working}
                  />
                </label>
                <label>
                  Logo Image
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) =>
                      void uploadBrandingAsset(
                        "logo",
                        event.target.files?.[0] ?? null,
                      )
                    }
                    disabled={working || assetUploading !== null}
                  />
                </label>
                <label>
                  Cover Image
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) =>
                      void uploadBrandingAsset(
                        "cover",
                        event.target.files?.[0] ?? null,
                      )
                    }
                    disabled={working || assetUploading !== null}
                  />
                </label>
                <label className="wide">
                  Logo URL
                  <input
                    value={form.logoUrl}
                    onChange={(event) =>
                      updateField("logoUrl", event.target.value)
                    }
                    disabled={working}
                  />
                </label>
                <label className="wide">
                  Cover URL
                  <input
                    value={form.coverUrl}
                    onChange={(event) =>
                      updateField("coverUrl", event.target.value)
                    }
                    disabled={working}
                  />
                </label>
              </div>
            </section>

          </div>

          <div className="od-settings-side">
            <section className="od-card">
              <div className="od-card-header">
                <div>
                  <div className="od-card-title">QR Code Management</div>
                  <div className="od-card-subtitle">
                    Shows existing active table ordering codes.
                  </div>
                </div>
              </div>
              <div className="od-settings-stack">
                <label>
                  Application URL
                  <input
                    value={appUrl}
                    onChange={(event) => setAppUrl(event.target.value)}
                    disabled={appUrlWorking || working}
                    placeholder="http://10.61.145.181:5173"
                  />
                </label>
                <button
                  className="od-btn-primary"
                  type="button"
                  onClick={() => void saveApplicationUrl()}
                  disabled={appUrlWorking || working}
                >
                  {appUrlWorking ? "Updating..." : "Save Application URL"}
                </button>
                <button
                  className="od-btn-ghost"
                  type="button"
                  onClick={() => void regenerateAllQrCodes()}
                  disabled={
                    appUrlWorking || working || activeTables.length === 0
                  }
                >
                  Regenerate All QR Codes
                </button>
              </div>
              <div className="od-qr-list">
                {activeTables.length === 0 ? (
                  <div className="od-empty compact">
                    No active table QR codes yet.
                  </div>
                ) : (
                  activeTables.slice(0, 12).map((table) => (
                    <div className="od-qr-row" key={table.id}>
                      {qrCodes[table.table_number] ? (
                        <img src={qrCodes[table.table_number]} alt="" />
                      ) : (
                        <div className="od-qr-placeholder">QR</div>
                      )}
                      <div>
                        <strong>{table.label}</strong>
                        <span>{table.qr_path}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="od-card">
              <div className="od-card-header">
                <div>
                  <div className="od-card-title">Notification Settings</div>
                </div>
              </div>
              <div className="od-settings-stack">
                <label className="od-toggle-row">
                  <input
                    type="checkbox"
                    checked={form.emailNotifications}
                    onChange={(event) =>
                      updateField("emailNotifications", event.target.checked)
                    }
                    disabled={working}
                  />
                  Email notifications
                </label>
                <label className="od-toggle-row">
                  <input
                    type="checkbox"
                    checked={form.smsNotifications}
                    onChange={(event) =>
                      updateField("smsNotifications", event.target.checked)
                    }
                    disabled={working}
                  />
                  SMS notifications
                </label>
              </div>
            </section>

            <section className="od-card">
              <div className="od-card-header">
                <div>
                  <div className="od-card-title">Subscription & Billing</div>
                </div>
              </div>
              <div className="od-billing-box">
                <strong>{config?.subscription_plan ?? "starter"}</strong>
                <span>{config?.billing_status ?? "trial"}</span>
                <button className="od-btn-ghost" type="button" disabled>
                  Manage Billing
                </button>
              </div>
            </section>

            <section className="od-card">
              <div className="od-card-header">
                <div>
                  <div className="od-card-title">Security</div>
                </div>
              </div>
              <div className="od-settings-stack">
                <label className="od-toggle-row">
                  <input
                    type="checkbox"
                    checked={form.requireStrongPasswords}
                    onChange={(event) =>
                      updateField(
                        "requireStrongPasswords",
                        event.target.checked,
                      )
                    }
                    disabled={working}
                  />
                  Strong passwords
                </label>
                <label>
                  Session Timeout
                  <input
                    type="number"
                    min="15"
                    max="1440"
                    value={form.sessionTimeoutMinutes}
                    onChange={(event) =>
                      updateField("sessionTimeoutMinutes", event.target.value)
                    }
                    disabled={working}
                  />
                </label>
              </div>
            </section>
          </div>
        </div>
      </form>
    </div>
  );
}

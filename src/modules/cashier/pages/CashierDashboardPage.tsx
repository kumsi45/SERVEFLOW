import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../../core/database";
import { signOutStaff } from "../../staff-auth/services/staffAuthService";
import type { CashierOrder, CashierOrderItem, CashierRestaurant } from "../types";
import "../styles/cashierDashboard.css";

function fmtMoney(value: number) {
  return `ETB ${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fmtOrderId(id: string) {
  return `#${id.slice(0, 6).toUpperCase()}`;
}

function fmtDateTime(iso: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function fmtTime(iso: string) {
  return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function durationFrom(startIso: string | null, now: Date) {
  if (!startIso) return "0m";
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(startIso).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff}m ago`;
  return `${Math.floor(diff / 60)}h ago`;
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

type CashierDashboardPageProps = {
  restaurantId: string;
  restaurant: CashierRestaurant;
  cashierName?: string;
};

type OrderRow = {
  invoice_id?: string | null;
  invoice_number?: number | string | null;
  invoice_status?: string | null;
  invoice_paid_at?: string | null;
  invoice_locked_at?: string | null;
  id: string;
  status: string;
  customer_name: string | null;
  table_number: string | null;
  payment_method: string | null;
  total_price: number | string;
  created_at: string;
  payment_verified_at: string | null;
  items?: ItemRow[] | string | null;
};

type ItemRow = {
  id: string;
  order_id: string;
  invoice_id?: string | null;
  quantity: number;
  price: number | string;
  notes?: string | null;
  appended_at?: string | null;
  kitchen_status?: string | null;
  menu_item_name?: string | null;
  menu_items?: { name?: string | null } | { name?: string | null }[] | null;
};

type RestaurantTable = {
  id: string;
  restaurant_id: string;
  table_number: number;
  label: string;
  active: boolean;
};

type MenuCategoryRow = {
  id: string;
  restaurant_id: string;
  name: string;
};

type CashierMenuItem = {
  id: string;
  restaurant_id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  available: boolean;
  categoryName: string;
};

type CashierCartItem = {
  menuItemId: string;
  name: string;
  categoryName: string;
  price: number;
  quantity: number;
  notes: string;
};

type SubmittedCashierOrder = {
  order_id: string;
  status: CashierOrder["status"];
  total_price: number | string;
  table_number: string | null;
  payment_method: string | null;
  payment_verified_at?: string | null;
  created_at: string;
};

type CashierOrderPayload = {
  order_id: string;
  status: CashierOrder["status"];
  total_price: number | string;
  table_number: string | null;
  payment_method: string | null;
  payment_verified_at?: string | null;
  created_at: string;
};

type ContinuationChoice = {
  tableNumber: string;
  activeOrder: CashierOrder;
} | null;

type ActiveShift = {
  id: string;
  restaurant_id: string;
  opened_by: string;
  opened_at: string;
  opening_cash: number;
  notes: string | null;
  cash_collected: number;
  digital_collected: number;
  orders_processed: number;
  payments_processed: number;
  expected_cash: number;
};

type ShiftActivity = {
  id: string;
  restaurant_id: string;
  shift_id: string | null;
  order_id: string | null;
  actor_staff_id: string | null;
  action: string;
  message: string;
  amount: number | string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type QueueTab = "active" | "pending" | "completed";
type ReconcileStep = 1 | 2 | 3 | 4 | 5;

const PAYMENT_METHODS = ["Cash", "Telebirr", "CBE Birr", "Mobile Banking", "Chapa", "Credit/Debit Card"];
const ALL_CATEGORIES = "all";
const ACTIVE_ORDER_STATUSES: CashierOrder["status"][] = ["pending_payment", "paid", "preparing", "ready"];

function normalizeOrder(row: OrderRow, items: CashierOrderItem[] = []): CashierOrder {
  return {
    id: row.id,
    invoiceId: row.invoice_id ?? null,
    invoiceNumber: row.invoice_number === null || typeof row.invoice_number === "undefined" ? null : Number(row.invoice_number),
    invoiceStatus: row.invoice_status ?? null,
    invoicePaidAt: row.invoice_paid_at ?? null,
    invoiceLockedAt: row.invoice_locked_at ?? null,
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
  const menuItem = row.menu_items;
  const name = row.menu_item_name ?? (Array.isArray(menuItem) ? menuItem[0]?.name ?? "Menu item" : menuItem?.name ?? "Menu item");
  return { id: row.id, orderId: row.order_id, invoiceId: row.invoice_id ?? null, name, quantity: Number(row.quantity), price: Number(row.price), notes: row.notes ?? null, appendedAt: row.appended_at ?? null, kitchenStatus: row.kitchen_status ?? null };
}

function normalizeInvoiceRow(row: OrderRow): CashierOrder {
  const rawItems = typeof row.items === "string" ? JSON.parse(row.items) : row.items;
  const items = Array.isArray(rawItems) ? rawItems.map((item) => normalizeItem(item as ItemRow)) : [];
  return normalizeOrder(row, items);
}

function normalizeSubmittedOrder(row: SubmittedCashierOrder): CashierOrder {
  return {
    id: row.order_id,
    status: row.status,
    customerName: null,
    tableNumber: row.table_number,
    paymentMethod: row.payment_method,
    totalPrice: Number(row.total_price),
    createdAt: row.created_at,
    paymentVerifiedAt: row.payment_verified_at ?? null,
    items: [],
  };
}

function getOrderItemPreview(items: CashierOrderItem[]) {
  const visible = items.slice(0, 3);
  const hiddenCount = Math.max(0, items.length - visible.length);
  return { visible, hiddenCount };
}

function isContinuableOrder(order: CashierOrder) {
  return ACTIVE_ORDER_STATUSES.includes(order.status);
}

function isDigitalPayment(order: CashierOrder) {
  return order.invoiceStatus === "paid" && order.paymentMethod !== "Cash";
}

function isCashPayment(order: CashierOrder) {
  return order.invoiceStatus === "paid" && order.paymentMethod === "Cash";
}

function isAwaitingCollection(order: CashierOrder) {
  return order.invoiceStatus === "paid" && (order.status === "ready" || order.status === "paid");
}

function isActiveOrder(order: CashierOrder) {
  return order.status !== "completed" && order.status !== "cancelled";
}

function KpiCard({ label, value, detail, tone = "default" }: { label: string; value: string; detail?: string; tone?: "default" | "warning" | "success" }) {
  return (
    <div className={`cd-kpi-card ${tone}`}>
      <div className="cd-kpi-label">{label}</div>
      <div className="cd-kpi-value">{value}</div>
      {detail && <div className="cd-kpi-change neutral">{detail}</div>}
    </div>
  );
}

function CashierMenuItemImage({ item }: { item: CashierMenuItem }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(item.image_url) && !imageFailed;

  return (
    <span className="cd-menu-item-image-wrap">
      {showImage ? (
        <img
          className="cd-menu-item-image"
          src={item.image_url ?? ""}
          alt={item.name}
          loading="lazy"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className="cd-menu-item-image placeholder" aria-hidden="true" />
      )}
    </span>
  );
}

function OrderDrawer({ order, onClose, onApprove, approving }: {
  order: CashierOrder;
  onClose: () => void;
  onApprove?: () => void;
  approving: boolean;
}) {
  return (
    <>
      <div className="cd-drawer-overlay" onClick={onClose} />
      <aside className="cd-drawer" role="dialog" aria-modal="true" aria-label="Order details">
        <div className="cd-drawer-header">
          <div>
            <div className="cd-drawer-title">{fmtOrderId(order.id)} · Invoice #{order.invoiceNumber ?? 1}</div>
            <div className="cd-card-subtitle">Table {order.tableNumber || "-"}</div>
          </div>
          <button className="cd-drawer-close" onClick={onClose} aria-label="Close">x</button>
        </div>
        <div className="cd-drawer-body">
          <div className="cd-drawer-detail-grid">
            <div className="cd-drawer-detail"><div className="cd-drawer-detail-label">Invoice Status</div><div className="cd-drawer-detail-value">{order.invoiceStatus === "paid" ? "Paid" : "Pending"}</div></div>
            <div className="cd-drawer-detail"><div className="cd-drawer-detail-label">Kitchen Status</div><div className="cd-drawer-detail-value">{statusLabel(order.status)}</div></div>
            <div className="cd-drawer-detail"><div className="cd-drawer-detail-label">Payment Method</div><div className="cd-drawer-detail-value">{order.paymentMethod || "-"}</div></div>
            <div className="cd-drawer-detail"><div className="cd-drawer-detail-label">Created</div><div className="cd-drawer-detail-value">{fmtDateTime(order.createdAt)}</div></div>
          </div>
          <div>
            <div className="cd-drawer-section-title">Items</div>
            <div className="cd-drawer-items">
              {order.items.length === 0 ? (
                <div className="cd-empty-sub">No item data available.</div>
              ) : order.items.map((item) => (
                <div key={item.id} className="cd-drawer-item">
                  <div><div className="cd-drawer-item-name">{item.name}</div><div className="cd-drawer-item-qty">Qty {item.quantity}</div></div>
                  <div className="cd-drawer-item-price">{fmtMoney(item.price * item.quantity)}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="cd-drawer-total">
            <span className="cd-drawer-total-label">Total</span>
            <span className="cd-drawer-total-value">{fmtMoney(order.totalPrice)}</span>
          </div>
        </div>
        <div className="cd-drawer-footer">
          {onApprove && (
            <button className="cd-drawer-approve-btn" onClick={onApprove} disabled={approving}>
              {approving ? "Verifying..." : "Verify Payment"}
            </button>
          )}
          <button className="cd-view-btn" onClick={() => window.print()}>Print Receipt</button>
        </div>
      </aside>
    </>
  );
}

export function CashierDashboardPage({ restaurantId, restaurant: initialRestaurant, cashierName }: CashierDashboardPageProps) {
  const now = useNow();
  const [orders, setOrders] = useState<CashierOrder[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [categories, setCategories] = useState<MenuCategoryRow[]>([]);
  const [menuItems, setMenuItems] = useState<CashierMenuItem[]>([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [menuSearch, setMenuSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORIES);
  const [cartItems, setCartItems] = useState<CashierCartItem[]>([]);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [continuationChoice, setContinuationChoice] = useState<ContinuationChoice>(null);
  const [activity, setActivity] = useState<ShiftActivity[]>([]);
  const [activeShift, setActiveShift] = useState<ActiveShift | null>(null);
  const [restaurant, setRestaurant] = useState<CashierRestaurant>(initialRestaurant);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queueTab, setQueueTab] = useState<QueueTab>("active");
  const [drawerOrder, setDrawerOrder] = useState<CashierOrder | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [openShiftModal, setOpenShiftModal] = useState(false);
  const [openingCash, setOpeningCash] = useState("0");
  const [openingNotes, setOpeningNotes] = useState("");
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileStep, setReconcileStep] = useState<ReconcileStep>(1);
  const [actualCash, setActualCash] = useState("");
  const [varianceReason, setVarianceReason] = useState("");
  const [workingShift, setWorkingShift] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  async function loadDashboard() {
    const [
      { data: staffData },
      { data: invoiceRows, error: invoicesError },
      { data: tableRows },
      { data: categoryRows, error: categoriesError },
      { data: menuRows, error: menuError },
      { data: shiftSummary, error: shiftError },
      { data: activityRows },
    ] = await Promise.all([
      supabase.from("restaurant_staff").select("restaurants(id,name)").eq("restaurant_id", restaurantId).eq("active", true).limit(1).maybeSingle(),
      supabase.rpc("get_cashier_invoice_queue", { target_restaurant_id: restaurantId }),
      supabase.from("restaurant_tables").select("id,restaurant_id,table_number,label,active").eq("restaurant_id", restaurantId).eq("active", true).order("table_number", { ascending: true }),
      supabase.from("categories").select("id,restaurant_id,name").eq("restaurant_id", restaurantId).order("name", { ascending: true }),
      supabase.from("menu_items").select("id,restaurant_id,category_id,name,description,price,image_url,available,categories!menu_items_category_same_restaurant(name)").eq("restaurant_id", restaurantId).order("name", { ascending: true }),
      supabase.rpc("get_cashier_shift_summary", { target_restaurant_id: restaurantId }),
      supabase.from("shift_activity_logs").select("id,restaurant_id,shift_id,order_id,actor_staff_id,action,message,amount,metadata,created_at").eq("restaurant_id", restaurantId).order("created_at", { ascending: false }).limit(30),
    ]);

    if (invoicesError) throw new Error(invoicesError.message);
    if (categoriesError) throw new Error(categoriesError.message);
    if (menuError) throw new Error(menuError.message);
    if (shiftError) throw new Error(shiftError.message);

    const rest = Array.isArray(staffData?.restaurants) ? staffData.restaurants[0] : staffData?.restaurants;
    if (rest?.name) setRestaurant({ id: rest.id, name: rest.name, logoUrl: null });

    const summary = shiftSummary as { active_shift?: ActiveShift | null } | null;
    setActiveShift(summary?.active_shift ?? null);
    setOrders(((invoiceRows ?? []) as OrderRow[]).map(normalizeInvoiceRow));
    setTables((tableRows ?? []).map((row) => ({ ...row, table_number: Number(row.table_number) })) as RestaurantTable[]);
    setCategories((categoryRows ?? []) as MenuCategoryRow[]);
    setMenuItems((menuRows ?? []).map((row) => {
      const category = Array.isArray(row.categories) ? row.categories[0] : row.categories;
      return {
        id: String(row.id),
        restaurant_id: String(row.restaurant_id),
        category_id: String(row.category_id),
        name: String(row.name),
        description: row.description ?? null,
        price: Number(row.price),
        image_url: row.image_url ?? null,
        available: Boolean(row.available),
        categoryName: category?.name ?? "Menu",
      };
    }) as CashierMenuItem[]);
    setActivity((activityRows ?? []).map((row) => ({ ...row, amount: row.amount === null ? null : Number(row.amount) })) as ShiftActivity[]);
  }

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        await loadDashboard();
      } catch (loadError) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : "Could not load cashier dashboard.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => { mounted = false; };
  }, [restaurantId]);

  useEffect(() => {
    const refresh = () => {
      void loadDashboard().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Realtime refresh failed."));
    };
    const channel = supabase.channel(`cashier-operations-${restaurantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_invoices", filter: `restaurant_id=eq.${restaurantId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items", filter: `restaurant_id=eq.${restaurantId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "cashier_shifts", filter: `restaurant_id=eq.${restaurantId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_reconciliations", filter: `restaurant_id=eq.${restaurantId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "shift_activity_logs", filter: `restaurant_id=eq.${restaurantId}` }, refresh)
      .subscribe();
    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [restaurantId]);

  async function handleApprove(order: CashierOrder) {
    try {
      const targetActionId = order.invoiceId ?? order.id;
      setApprovingId(targetActionId);
      setError(null);
      const { data, error: rpcError } = await supabase.rpc("approve_order_payment", { target_order_id: order.id });
      if (rpcError) throw new Error(rpcError.message);
      const updated = normalizeOrder(data as OrderRow);
      setOrders((prev) => prev.map((existing) => (existing.invoiceId ?? existing.id) === targetActionId ? { ...existing, ...updated, invoiceId: existing.invoiceId, invoiceNumber: existing.invoiceNumber, invoiceStatus: "paid", invoicePaidAt: new Date().toISOString(), items: existing.items } : existing));
      if ((drawerOrder?.invoiceId ?? drawerOrder?.id) === targetActionId) setDrawerOrder((current) => current ? { ...current, ...updated, invoiceId: current.invoiceId, invoiceNumber: current.invoiceNumber, invoiceStatus: "paid", invoicePaidAt: new Date().toISOString(), items: current.items } : null);
      await loadDashboard();
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "Payment verification failed.");
    } finally {
      setApprovingId(null);
    }
  }

  async function handleOpenShift() {
    try {
      setWorkingShift(true);
      setError(null);
      const { error: rpcError } = await supabase.rpc("open_cashier_shift", {
        target_restaurant_id: restaurantId,
        opening_cash_amount: Number(openingCash || 0),
        opening_notes: openingNotes || null,
      });
      if (rpcError) throw new Error(rpcError.message);
      setOpenShiftModal(false);
      setOpeningCash("0");
      setOpeningNotes("");
      await loadDashboard();
    } catch (shiftError) {
      setError(shiftError instanceof Error ? shiftError.message : "Could not open shift.");
    } finally {
      setWorkingShift(false);
    }
  }

  async function handleCloseShift() {
    if (!activeShift) return;
    try {
      setWorkingShift(true);
      setError(null);
      const { error: rpcError } = await supabase.rpc("close_cashier_shift", {
        target_shift_id: activeShift.id,
        actual_cash_amount: Number(actualCash || 0),
        variance_explanation: varianceReason || null,
      });
      if (rpcError) throw new Error(rpcError.message);
      setReconcileOpen(false);
      setReconcileStep(1);
      setActualCash("");
      setVarianceReason("");
      await loadDashboard();
    } catch (shiftError) {
      setError(shiftError instanceof Error ? shiftError.message : "Could not close shift.");
    } finally {
      setWorkingShift(false);
    }
  }

  function addMenuItemToCart(item: CashierMenuItem) {
    if (!item.available) return;
    setCartItems((previous) => {
      const existing = previous.find((cartItem) => cartItem.menuItemId === item.id);
      if (existing) {
        return previous.map((cartItem) => cartItem.menuItemId === item.id ? { ...cartItem, quantity: Math.min(99, cartItem.quantity + 1) } : cartItem);
      }
      return [...previous, { menuItemId: item.id, name: item.name, categoryName: item.categoryName, price: item.price, quantity: 1, notes: "" }];
    });
  }

  function updateCartQuantity(menuItemId: string, quantity: number) {
    if (quantity < 1) {
      setCartItems((previous) => previous.filter((item) => item.menuItemId !== menuItemId));
      return;
    }
    setCartItems((previous) => previous.map((item) => item.menuItemId === menuItemId ? { ...item, quantity: Math.min(99, quantity) } : item));
  }

  function updateCartNotes(menuItemId: string, notes: string) {
    setCartItems((previous) => previous.map((item) => item.menuItemId === menuItemId ? { ...item, notes } : item));
  }

  async function submitPosOrder(mode: "append" | "create") {
    try {
      setSubmittingOrder(true);
      setError(null);
      const payload = cartItems.map((item) => ({
        menu_item_id: item.menuItemId,
        quantity: item.quantity,
        notes: item.notes.trim() || null,
      }));

      if (mode === "append") {
        const activeOrder = orders.find((order) => order.tableNumber === selectedTable && isContinuableOrder(order));
        if (!activeOrder) throw new Error("No active order found for this table.");
        const { data, error: rpcError } = await supabase.rpc("append_items_to_order", {
          target_order_id: activeOrder.id,
          requested_items: payload,
        });
        if (rpcError) throw new Error(rpcError.message);
        const updated = normalizeSubmittedOrder(data as CashierOrderPayload);
        setOrders((previous) => previous.map((order) => order.id === activeOrder.id ? { ...order, ...updated, items: order.items } : order));
      } else {
        const { data, error: rpcError } = await supabase.rpc("create_cashier_order", {
          target_restaurant_id: restaurantId,
          table_number: selectedTable,
          selected_payment_method: selectedPaymentMethod,
          requested_items: payload,
        });
        if (rpcError) throw new Error(rpcError.message);
        const created = normalizeSubmittedOrder(data as SubmittedCashierOrder);
        setOrders((previous) => [created, ...previous]);
      }

      setCartItems([]);
      setSelectedTable("");
      setSelectedPaymentMethod(PAYMENT_METHODS[0]);
      setContinuationChoice(null);
      await loadDashboard();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not submit order.");
    } finally {
      setSubmittingOrder(false);
    }
  }

  function handleSubmitPosOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTable) {
      setError("Select a table before submitting the order.");
      return;
    }
    if (cartItems.length === 0) {
      setError("Add at least one menu item before submitting the order.");
      return;
    }
    const activeOrder = orders.find((order) => order.tableNumber === selectedTable && isContinuableOrder(order));
    if (activeOrder) {
      setContinuationChoice({ tableNumber: selectedTable, activeOrder });
      return;
    }
    void submitPosOrder("create");
  }

  async function handleSignOut() {
    try { await signOutStaff(); } finally { window.location.replace("/staff-login"); }
  }

  const verifiedOrders = useMemo(() => orders.filter((order) => order.invoiceStatus === "paid"), [orders]);
  const pendingPayments = useMemo(() => orders.filter((order) => order.invoiceStatus === "pending"), [orders]);
  const activeOrders = useMemo(() => orders.filter(isActiveOrder), [orders]);
  const awaitingCollection = useMemo(() => orders.filter(isAwaitingCollection), [orders]);
  const completedOrders = useMemo(() => orders.filter((order) => order.status === "completed"), [orders]);
  const cashCollectedToday = activeShift?.cash_collected ?? verifiedOrders.filter(isCashPayment).reduce((sum, order) => sum + order.totalPrice, 0);
  const digitalCollectedToday = activeShift?.digital_collected ?? verifiedOrders.filter(isDigitalPayment).reduce((sum, order) => sum + order.totalPrice, 0);
  const occupiedTableNumbers = useMemo(() => new Set(activeOrders.map((order) => order.tableNumber).filter(Boolean)), [activeOrders]);
  const awaitingPaymentTableNumbers = useMemo(() => new Set(pendingPayments.map((order) => order.tableNumber).filter(Boolean)), [pendingPayments]);
  const cartTotal = useMemo(() => cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0), [cartItems]);
  const selectedTableActiveOrder = useMemo(() => orders.find((order) => order.tableNumber === selectedTable && isContinuableOrder(order)) ?? null, [orders, selectedTable]);
  const filteredMenuItems = useMemo(() => {
    const search = menuSearch.trim().toLowerCase();
    return menuItems.filter((item) => {
      const matchesCategory = selectedCategory === ALL_CATEGORIES || item.category_id === selectedCategory;
      const matchesSearch = !search || item.name.toLowerCase().includes(search) || item.categoryName.toLowerCase().includes(search) || (item.description ?? "").toLowerCase().includes(search);
      return matchesCategory && matchesSearch;
    });
  }, [menuItems, menuSearch, selectedCategory]);
  const availableTables = Math.max(0, tables.length - occupiedTableNumbers.size);
  const queueOrders = queueTab === "active" ? activeOrders : queueTab === "pending" ? pendingPayments : completedOrders;
  const expectedCash = activeShift?.expected_cash ?? 0;
  const actualCashNumber = Number(actualCash || 0);
  const variance = actualCash === "" ? 0 : actualCashNumber - expectedCash;
  const needsVarianceReason = variance !== 0;
  const dateStr = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  function openTable(tableNumber: number) {
    const order = activeOrders.find((candidate) => candidate.tableNumber === String(tableNumber));
    if (order) setDrawerOrder(order);
  }

  return (
    <div className="cd-root">
      <header className="cd-header">
        <div className="cd-header-left">
          <div className="cd-logo" aria-hidden="true">{restaurant.name.charAt(0).toUpperCase()}</div>
          <div className="cd-header-info">
            <div className="cd-restaurant-name">{restaurant.name}</div>
            <div className={`cd-shift-badge ${activeShift ? "active" : "closed"}`}>
              <span className="cd-shift-dot" />
              {activeShift ? "Cashier · Active Shift" : "Cashier · Shift Closed"}
            </div>
          </div>
        </div>
        <div className="cd-header-right">
          <div className="cd-header-datetime"><div className="cd-header-date">{dateStr}</div><div className="cd-header-time">{timeStr}</div></div>
          <button className="cd-icon-btn" aria-label="Notifications">!</button>
          <button className="cd-signout-btn" onClick={handleSignOut}>Sign Out</button>
        </div>
      </header>

      <main className="cd-body">
        {error && <div className="cd-error-banner">{error}</div>}

        {loading ? (
          <div className="cd-kpi-grid">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="cd-skeleton cd-skeleton-kpi" />)}</div>
        ) : (
          <>
            <section className={`cd-shift-hero ${activeShift ? "active" : "closed"}`}>
              <div>
                <div className="cd-shift-eyebrow">{activeShift ? "Active Shift" : "Shift Not Started"}</div>
                <h1>{activeShift ? `Shift Duration: ${durationFrom(activeShift.opened_at, now)}` : "Ready to serve?"}</h1>
                <p>{activeShift ? `Started ${fmtDateTime(activeShift.opened_at)} · ${cashierName || "Cashier"}` : "Open a shift and confirm the opening cash drawer amount to begin processing orders."}</p>
              </div>
              {activeShift ? (
                <>
                  <div className="cd-shift-hero-stat"><span>Opening Cash</span><strong>{fmtMoney(activeShift.opening_cash)}</strong></div>
                  <div className="cd-shift-hero-stat"><span>Cash Collected</span><strong>{fmtMoney(activeShift.cash_collected)}</strong></div>
                  <div className="cd-shift-hero-stat"><span>Digital Collected</span><strong>{fmtMoney(activeShift.digital_collected)}</strong></div>
                  <button className="cd-close-shift-btn" onClick={() => setReconcileOpen(true)}>Close Shift</button>
                </>
              ) : (
                <button className="cd-close-shift-btn" onClick={() => setOpenShiftModal(true)}>Open Shift</button>
              )}
            </section>

            <section className="cd-kpi-grid">
              <KpiCard label="Active Orders" value={`${activeOrders.length}`} detail="In workflow" />
              <KpiCard label="Pending Payments" value={`${pendingPayments.length}`} detail="Needs verification" tone={pendingPayments.length > 0 ? "warning" : "default"} />
              <KpiCard label="Awaiting Collection" value={`${awaitingCollection.length}`} detail="Ready or handed over" />
              <KpiCard label="Occupied Tables" value={`${occupiedTableNumbers.size}`} detail={`${availableTables} available`} />
              <KpiCard label="Cash Collected Today" value={fmtMoney(cashCollectedToday)} detail="Verified cash payments" tone="success" />
              <KpiCard label="Digital Payments Today" value={fmtMoney(digitalCollectedToday)} detail="Verified digital payments" />
            </section>

            <section className="cd-main-grid">
              <div className="cd-card">
                <div className="cd-card-header">
                  <div className="cd-tabs">
                    <button className={`cd-tab${queueTab === "active" ? " active" : ""}`} onClick={() => setQueueTab("active")}>Active Orders <span className="cd-tab-badge">{activeOrders.length}</span></button>
                    <button className={`cd-tab${queueTab === "pending" ? " active" : ""}`} onClick={() => setQueueTab("pending")}>Pending Payments <span className="cd-tab-badge">{pendingPayments.length}</span></button>
                    <button className={`cd-tab${queueTab === "completed" ? " active" : ""}`} onClick={() => setQueueTab("completed")}>Completed Orders <span className="cd-tab-badge">{completedOrders.length}</span></button>
                  </div>
                  <span className="cd-card-subtitle">Newest first</span>
                </div>
                <div className="cd-order-list">
                  {queueOrders.length === 0 ? (
                    <div className="cd-empty"><div className="cd-empty-title">No orders in this queue</div><div className="cd-empty-sub">Realtime orders will appear here.</div></div>
                  ) : queueOrders.map((order) => {
                    const preview = getOrderItemPreview(order.items);
                    return (
                      <article key={order.invoiceId ?? order.id} className={`cd-order-card ${order.invoiceStatus === "pending" ? "pending_payment" : order.status}`} onClick={() => setDrawerOrder(order)}>
                        <div className="cd-order-table-tile">Tbl<strong>{order.tableNumber || "-"}</strong></div>
                        <div className="cd-order-card-main">
                          <div className="cd-order-card-title">
                            <strong>{fmtOrderId(order.id)} · Inv #{order.invoiceNumber ?? 1}</strong>
                            <span className={`cd-badge ${order.invoiceStatus === "paid" ? "paid" : "pending"}`}>{order.invoiceStatus === "paid" ? "Paid" : "Pending"}</span>
                            <span className="cd-badge cbe">{statusLabel(order.status)}</span>
                          </div>
                          <div className="cd-order-card-meta">
                            {timeAgo(order.createdAt)} · {order.items.length} items · {order.paymentMethod || "No method"} · {fmtMoney(order.totalPrice)}
                          </div>
                          {preview.visible.length > 0 && (
                            <div className="cd-order-item-preview" aria-label="Order item preview">
                              {preview.visible.map((item) => <div key={item.id}>{item.name} x{item.quantity}</div>)}
                              {preview.hiddenCount > 0 && <div className="cd-order-item-more">+{preview.hiddenCount} more item{preview.hiddenCount === 1 ? "" : "s"}</div>}
                            </div>
                          )}
                        </div>
                        <div className="cd-order-card-actions" onClick={(event) => event.stopPropagation()}>
                          <button className="cd-view-btn" onClick={() => setDrawerOrder(order)}>View</button>
                          {order.invoiceStatus === "pending" && <button className="cd-approve-btn" disabled={approvingId === (order.invoiceId ?? order.id)} onClick={() => handleApprove(order)}>{approvingId === (order.invoiceId ?? order.id) ? "..." : "Verify Payment"}</button>}
                          <button className="cd-view-btn" onClick={() => window.print()}>Print Receipt</button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>

              <aside className="cd-side-stack">
                <div className="cd-card">
                  <div className="cd-card-header"><div><div className="cd-card-title">Table Management</div><div className="cd-card-subtitle">{availableTables} available · {occupiedTableNumbers.size} occupied · {awaitingPaymentTableNumbers.size} awaiting payment</div></div></div>
                  <div className="cd-table-grid">
                    {tables.map((table) => {
                      const key = String(table.table_number);
                      const awaitingPayment = awaitingPaymentTableNumbers.has(key);
                      const occupied = occupiedTableNumbers.has(key);
                      return (
                        <button key={table.id} className={`cd-table-cell ${awaitingPayment ? "pay" : occupied ? "occupied" : "available"}`} onClick={() => openTable(table.table_number)}>
                          {table.table_number}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="cd-card">
                  <div className="cd-card-header"><div><div className="cd-card-title">Live Activity</div><div className="cd-card-subtitle">Newest first</div></div></div>
                  <div className="cd-activity-list">
                    {activity.length === 0 ? (
                      <div className="cd-empty compact"><div className="cd-empty-title">No activity yet</div></div>
                    ) : activity.slice(0, 10).map((entry) => (
                      <div key={entry.id} className="cd-activity-item">
                        <div className={`cd-activity-dot ${entry.action}`} />
                        <div className="cd-activity-content">
                          <div className="cd-activity-main">{entry.message}</div>
                          <div className="cd-activity-sub">{fmtTime(entry.created_at)}</div>
                        </div>
                        {entry.amount !== null && <div className="cd-activity-amount">{fmtMoney(Number(entry.amount))}</div>}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="cd-card">
                  <div className="cd-card-header"><div><div className="cd-card-title">Cashier Summary</div><div className="cd-card-subtitle">{cashierName || "Cashier"}</div></div></div>
                  <div className="cd-shift-grid">
                    <div className="cd-shift-stat"><div className="cd-shift-stat-label">Orders Processed</div><div className="cd-shift-stat-value">{activeShift?.orders_processed ?? orders.length}</div></div>
                    <div className="cd-shift-stat"><div className="cd-shift-stat-label">Payments Processed</div><div className="cd-shift-stat-value">{activeShift?.payments_processed ?? verifiedOrders.length}</div></div>
                    <div className="cd-shift-stat"><div className="cd-shift-stat-label">Expected Drawer</div><div className="cd-shift-stat-value">{fmtMoney(activeShift?.expected_cash ?? 0)}</div></div>
                    <div className="cd-shift-stat"><div className="cd-shift-stat-label">Shift Duration</div><div className="cd-shift-stat-value">{activeShift ? durationFrom(activeShift.opened_at, now) : "0m"}</div></div>
                  </div>
                </div>
              </aside>
            </section>

            <section className="cd-pos-panel">
              <form className="cd-pos-form" onSubmit={handleSubmitPosOrder}>
                <div className="cd-card-header">
                  <div>
                    <div className="cd-card-title">POS Order Entry</div>
                    <div className="cd-card-subtitle">Create cashier orders or add items to active table orders.</div>
                  </div>
                  <button className="cd-approve-btn" type="submit" disabled={submittingOrder || cartItems.length === 0 || !selectedTable}>
                    {submittingOrder ? "Submitting..." : selectedTableActiveOrder ? "Add to Order" : "Submit Order"}
                  </button>
                </div>

                <div className="cd-pos-layout">
                  <div className="cd-pos-menu">
                    <div className="cd-pos-controls">
                      <label className="cd-pos-field">
                        <span>Table</span>
                        <select value={selectedTable} onChange={(event) => setSelectedTable(event.target.value)}>
                          <option value="">Select table</option>
                          {tables.map((table) => (
                            <option key={table.id} value={String(table.table_number)}>
                              {table.label || `Table ${table.table_number}`}{occupiedTableNumbers.has(String(table.table_number)) ? " - occupied" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="cd-pos-field">
                        <span>Payment</span>
                        <select value={selectedPaymentMethod} onChange={(event) => setSelectedPaymentMethod(event.target.value)}>
                          {PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
                        </select>
                      </label>
                      <label className="cd-pos-field wide">
                        <span>Search Menu</span>
                        <input value={menuSearch} onChange={(event) => setMenuSearch(event.target.value)} placeholder="Search items or categories" />
                      </label>
                    </div>

                    {selectedTableActiveOrder && (
                      <div className="cd-pos-active-note">
                        Active order {fmtOrderId(selectedTableActiveOrder.id)} found for Table {selectedTable}. Submitting will ask whether to add to it or create a new order.
                      </div>
                    )}

                    <div className="cd-category-strip">
                      <button type="button" className={`cd-category-chip${selectedCategory === ALL_CATEGORIES ? " active" : ""}`} onClick={() => setSelectedCategory(ALL_CATEGORIES)}>All</button>
                      {categories.map((category) => (
                        <button key={category.id} type="button" className={`cd-category-chip${selectedCategory === category.id ? " active" : ""}`} onClick={() => setSelectedCategory(category.id)}>
                          {category.name}
                        </button>
                      ))}
                    </div>

                    <div className="cd-menu-grid">
                      {filteredMenuItems.length === 0 ? (
                        <div className="cd-empty compact"><div className="cd-empty-title">No menu items found</div></div>
                      ) : filteredMenuItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`cd-menu-item-btn${item.available ? "" : " unavailable"}`}
                          onClick={() => addMenuItemToCart(item)}
                          disabled={!item.available}
                        >
                          <CashierMenuItemImage item={item} />
                          <span className="cd-menu-item-copy">
                            <span className="cd-menu-item-topline">
                              <span className="cd-menu-item-category">{item.categoryName}</span>
                              <span className={`cd-menu-item-availability ${item.available ? "available" : "unavailable"}`}>
                                {item.available ? "Available" : "Unavailable"}
                              </span>
                            </span>
                            <span className="cd-menu-item-name">{item.name}</span>
                            {item.description ? <span className="cd-menu-item-description">{item.description}</span> : null}
                            <strong>{fmtMoney(item.price)}</strong>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <aside className="cd-pos-cart">
                    <div className="cd-pos-cart-header">
                      <div>
                        <div className="cd-card-title">Current Ticket</div>
                        <div className="cd-card-subtitle">{cartItems.length} unique item(s)</div>
                      </div>
                      {cartItems.length > 0 && <button className="cd-view-btn" type="button" onClick={() => setCartItems([])}>Clear</button>}
                    </div>

                    <div className="cd-cart-list">
                      {cartItems.length === 0 ? (
                        <div className="cd-empty compact"><div className="cd-empty-title">Cart is empty</div><div className="cd-empty-sub">Select menu items to begin.</div></div>
                      ) : cartItems.map((item) => (
                        <div key={item.menuItemId} className="cd-cart-item">
                          <div className="cd-cart-item-top">
                            <div>
                              <div className="cd-cart-item-name">{item.name}</div>
                              <div className="cd-cart-item-meta">{fmtMoney(item.price)} each</div>
                            </div>
                            <button type="button" className="cd-cart-remove" onClick={() => updateCartQuantity(item.menuItemId, 0)} aria-label={`Remove ${item.name}`}>x</button>
                          </div>
                          <div className="cd-cart-qty-row">
                            <button type="button" onClick={() => updateCartQuantity(item.menuItemId, item.quantity - 1)}>-</button>
                            <input type="number" min="1" max="99" value={item.quantity} onChange={(event) => updateCartQuantity(item.menuItemId, Number(event.target.value || 1))} />
                            <button type="button" onClick={() => updateCartQuantity(item.menuItemId, item.quantity + 1)}>+</button>
                            <strong>{fmtMoney(item.price * item.quantity)}</strong>
                          </div>
                          <textarea value={item.notes} onChange={(event) => updateCartNotes(item.menuItemId, event.target.value)} placeholder="Item notes" maxLength={500} />
                        </div>
                      ))}
                    </div>

                    <div className="cd-pos-total">
                      <span>Total</span>
                      <strong>{fmtMoney(cartTotal)}</strong>
                    </div>
                  </aside>
                </div>
              </form>
            </section>
          </>
        )}
      </main>

      {drawerOrder && (
        <OrderDrawer
          order={drawerOrder}
          onClose={() => setDrawerOrder(null)}
          onApprove={drawerOrder.invoiceStatus === "pending" ? () => handleApprove(drawerOrder) : undefined}
          approving={approvingId === (drawerOrder.invoiceId ?? drawerOrder.id)}
        />
      )}

      {continuationChoice && (
        <div className="cd-modal-overlay">
          <div className="cd-modal" role="dialog" aria-modal="true" aria-label="Active order found">
            <div className="cd-modal-header">
              <div>
                <h2>Active order found for Table {continuationChoice.tableNumber}</h2>
                <p>{fmtOrderId(continuationChoice.activeOrder.id)} is {statusLabel(continuationChoice.activeOrder.status)} with a current total of {fmtMoney(continuationChoice.activeOrder.totalPrice)}.</p>
              </div>
              <button onClick={() => setContinuationChoice(null)}>x</button>
            </div>
            <div className="cd-modal-actions split">
              <button className="cd-approve-btn" onClick={() => void submitPosOrder("append")} disabled={submittingOrder}>
                {submittingOrder ? "Adding..." : "Add To Existing Order"}
              </button>
              <button className="cd-view-btn" onClick={() => void submitPosOrder("create")} disabled={submittingOrder}>
                Create New Order
              </button>
            </div>
          </div>
        </div>
      )}

      {openShiftModal && (
        <div className="cd-modal-overlay">
          <div className="cd-modal" role="dialog" aria-modal="true" aria-label="Open shift">
            <div className="cd-modal-header"><div><h2>Open Shift</h2><p>Confirm drawer cash before processing orders.</p></div><button onClick={() => setOpenShiftModal(false)}>x</button></div>
            <label className="cd-field"><span>Opening Cash Amount</span><input type="number" min="0" step="0.01" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} /></label>
            <label className="cd-field"><span>Optional Notes</span><textarea value={openingNotes} onChange={(event) => setOpeningNotes(event.target.value)} placeholder="Drawer count discrepancies or equipment notes" /></label>
            <button className="cd-primary-action" onClick={handleOpenShift} disabled={workingShift}>{workingShift ? "Opening..." : "Open Shift"}</button>
          </div>
        </div>
      )}

      {reconcileOpen && activeShift && (
        <div className="cd-modal-overlay">
          <div className="cd-modal wide" role="dialog" aria-modal="true" aria-label="Close shift reconciliation">
            <div className="cd-modal-header"><div><h2>Close Shift</h2><p>Step {reconcileStep} of 5 · Reconcile drawer cash.</p></div><button onClick={() => setReconcileOpen(false)}>x</button></div>
            {reconcileStep === 1 && (
              <div className="cd-reconcile-panel">
                <div className="cd-reconcile-row"><span>Opening Cash</span><strong>{fmtMoney(activeShift.opening_cash)}</strong></div>
                <div className="cd-reconcile-row"><span>Cash Payments</span><strong>{fmtMoney(activeShift.cash_collected)}</strong></div>
                <div className="cd-reconcile-row"><span>Cash Refunds</span><strong>{fmtMoney(0)}</strong></div>
                <div className="cd-reconcile-row total"><span>Expected Drawer Cash</span><strong>{fmtMoney(expectedCash)}</strong></div>
              </div>
            )}
            {reconcileStep === 2 && <label className="cd-field"><span>Actual Cash Counted</span><input type="number" min="0" step="0.01" value={actualCash} onChange={(event) => setActualCash(event.target.value)} autoFocus /></label>}
            {reconcileStep === 3 && <div className="cd-reconcile-panel"><div className="cd-reconcile-row"><span>Expected</span><strong>{fmtMoney(expectedCash)}</strong></div><div className="cd-reconcile-row"><span>Actual</span><strong>{fmtMoney(actualCashNumber)}</strong></div><div className={`cd-reconcile-row total ${variance === 0 ? "balanced" : "variance"}`}><span>Variance</span><strong>{fmtMoney(Math.abs(variance))}</strong></div></div>}
            {reconcileStep === 4 && (
              <label className="cd-field">
                <span>{needsVarianceReason ? "Variance Explanation Required" : "Closing Notes"}</span>
                <textarea value={varianceReason} onChange={(event) => setVarianceReason(event.target.value)} placeholder={needsVarianceReason ? "Explain the cash drawer difference" : "Optional closing notes"} />
              </label>
            )}
            {reconcileStep === 5 && <div className="cd-reconcile-panel"><div className="cd-empty-title">Ready to close shift</div><div className="cd-empty-sub">Expected {fmtMoney(expectedCash)} · Actual {fmtMoney(actualCashNumber)} · Variance {fmtMoney(Math.abs(variance))}</div></div>}
            <div className="cd-modal-actions">
              <button className="cd-view-btn" onClick={() => setReconcileStep((step) => Math.max(1, step - 1) as ReconcileStep)} disabled={reconcileStep === 1 || workingShift}>Back</button>
              {reconcileStep < 5 ? (
                <button className="cd-approve-btn" onClick={() => setReconcileStep((step) => Math.min(5, step + 1) as ReconcileStep)} disabled={(reconcileStep === 2 && actualCash === "") || (reconcileStep === 4 && needsVarianceReason && varianceReason.trim().length === 0)}>Next</button>
              ) : (
                <button className="cd-approve-btn" onClick={handleCloseShift} disabled={workingShift}>{workingShift ? "Closing..." : "Close Shift"}</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

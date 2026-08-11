import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabase } from "../../../core/database";
import { formatCurrency } from "../../../core/format/currency";
import { SmartImage } from "../../../core/presentation/SmartImage";
import { resolveSmartImage } from "../../../core/presentation/smartImageDelivery";
import {
  canonicalOperationalStatus,
  canonicalPaymentStatus,
  operationalLabel,
  paymentLabel,
} from "../../../core/payment/lifecycle";
import {
  playNotificationTone,
  type RealtimeConnectionState,
} from "../../../core/realtime/realtimeNotifications";
import { getRestaurantEventStream } from "../../../core/realtime/restaurantEventService";
import { signOutStaff } from "../../staff-auth/services/staffAuthService";
import type {
  CashierOrder,
  CashierOrderItem,
  CashierRestaurant,
} from "../types";
import {
  loadCashierWorkflowFoundation,
  type CashierWorkflowFoundation,
  type CashierWorkflowRow,
} from "../cashierWorkflow";
import {
  buildOperationalQueueView,
  OPERATIONAL_QUEUE_TABS,
  summarizeOperationalItems,
  type OperationalQueueTab,
} from "../operationalWorkspace";
import {
  CashierMetricCard,
  CashierTopBar,
  CashierIcon,
} from "../components/CashierDashboardUi";
import {
  CashierToastViewport,
  useCashierToasts,
} from "../components/CashierToastSystem";
import {
  formatServiceLocationName,
  ServiceLocationQuickSwitch,
  type ServiceLocationCardModel,
  type ServiceLocationStatus,
} from "../components/ServiceLocationQuickSwitch";
import {
  handleCashierCancellationRequest,
  loadCashierCancellationRequests,
  type CashierCancellationRequest,
} from "../services/cashierCancellationService";
import "../styles/cashierDashboard.css";

function fmtOrderLabel(order: Pick<CashierOrder, "displayNumber" | "id">) {
  return order.displayNumber ?? "Current order";
}

function fmtInvoiceLabel(
  order: Pick<CashierOrder, "invoiceDisplayNumber" | "invoiceNumber">,
) {
  return order.invoiceDisplayNumber ?? `Inv ${order.invoiceNumber ?? 1}`;
}

function fmtSessionLabel(
  session: Pick<
    DiningSessionSummary,
    "diningSessionDisplayNumber" | "diningSessionId"
  >,
) {
  return session.diningSessionDisplayNumber ?? "Dining session";
}

function fmtDateTime(iso: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function fmtTime(iso: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function compactTableCode(value?: string | number | null) {
  const table = String(value ?? "").trim();
  if (!table) return null;
  const numericTable = table.match(
    /^(?:(?:service\s+location|table)\s*)?t?\s*[-:]?\s*0*(\d+)$/i,
  );
  return numericTable ? `T${Number(numericTable[1])}` : table;
}

function orderTableCode(
  order: Pick<CashierOrder, "tableNumber" | "invoiceSource">,
) {
  return (
    compactTableCode(order.tableNumber) ??
    (order.invoiceSource === "public_qr" ? "Direct order" : "—")
  );
}

function relativeEventTime(
  event: "Requested" | "Paid" | "Completed",
  iso: string,
) {
  const timestamp = new Date(iso);
  const elapsedMinutes = Math.max(
    0,
    Math.floor((Date.now() - timestamp.getTime()) / 60000),
  );
  if (elapsedMinutes < 1) return `${event} now`;
  if (elapsedMinutes < 60) return `${event} ${elapsedMinutes} min ago`;

  const now = new Date();
  const isToday = timestamp.toDateString() === now.toDateString();
  if (isToday) return `${event} at ${fmtTime(iso)}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (timestamp.toDateString() === yesterday.toDateString()) {
    return `Yesterday, ${fmtTime(iso)}`;
  }
  return `${event} ${fmtDateTime(iso)}`;
}

function durationFrom(startIso: string | null, now: Date) {
  if (!startIso) return "0m";
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - new Date(startIso).getTime()) / 60000),
  );
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff}m ago`;
  return `${Math.floor(diff / 60)}h ago`;
}

function diningSessionLabel(status: string) {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sourceLabel(source?: string | null) {
  if (source === "public_qr") return "Customer QR";
  if (source === "waiter") return "Waiter";
  if (source === "cashier") return "Cashier";
  if (source === "authenticated") return "Customer";
  return "Unknown";
}

function creatorLabel(
  order: Pick<
    CashierOrder,
    "invoiceCreatorName" | "invoiceSource" | "waiterName"
  >,
) {
  return (
    order.invoiceCreatorName ||
    order.waiterName ||
    sourceLabel(order.invoiceSource)
  );
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
  display_number?: string | null;
  invoice_id?: string | null;
  invoice_display_number?: string | null;
  kitchen_ticket_number?: string | null;
  invoice_source?: string | null;
  invoice_creator_name?: string | null;
  invoice_kitchen_status?: string | null;
  invoice_number?: number | string | null;
  invoice_status?: string | null;
  payment_status?: string | null;
  operational_status?: string | null;
  invoice_paid_at?: string | null;
  invoice_locked_at?: string | null;
  invoice_verified_at?: string | null;
  invoice_verified_by?: string | null;
  invoice_verified_by_name?: string | null;
  invoice_rejected_at?: string | null;
  invoice_rejection_reason?: string | null;
  invoice_retry_requested_at?: string | null;
  reference_number?: string | null;
  transaction_id?: string | null;
  screenshot_url?: string | null;
  dining_session_id?: string | null;
  dining_session_display_number?: string | null;
  dining_session_status?: string | null;
  order_batch_id?: string | null;
  id: string;
  status: string;
  customer_name: string | null;
  customer_phone?: string | null;
  table_number: string | null;
  order_source?: string | null;
  waiter_name?: string | null;
  order_note?: string | null;
  payment_method: string | null;
  total_price: number | string;
  subtotal?: number | string | null;
  vat_rate?: number | string | null;
  vat_amount?: number | string | null;
  service_charge_rate?: number | string | null;
  service_charge_amount?: number | string | null;
  discount_amount?: number | string | null;
  created_at: string;
  payment_verified_at?: string | null;
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
  dining_session_status?: string | null;
  total_price: number | string;
  table_number: string | null;
  payment_method: string | null;
  payment_verified_at?: string | null;
  created_at: string;
};

type CashierOrderPayload = {
  order_id: string;
  status: CashierOrder["status"];
  dining_session_status?: string | null;
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

type FinalBillFormat = "80mm" | "58mm" | "a4" | "browser";

type FinalBillLineItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

type FinalBillPayment = {
  method: string;
  amount: number;
};

type FinalDiningBillModel = {
  bill: {
    id: string;
    billNumber: string;
    receiptNumber: string;
    diningSessionId: string;
    diningSessionNumber: string;
    tableNumber: string | null;
    customerName: string | null;
    waiterName: string | null;
    cashierName: string | null;
    printedAt: string;
    printCount: number;
    format: FinalBillFormat;
    pdfPath: string | null;
    status: string;
  };
  restaurant: {
    name: string;
    logoUrl: string | null;
    tinNumber: string | null;
    vatRegistrationNumber: string | null;
    phone: string | null;
    address: string | null;
    website: string | null;
  };
  items: FinalBillLineItem[];
  totals: {
    subtotal: number;
    vatRate: number;
    vatAmount: number;
    serviceChargeRate: number;
    serviceChargeAmount: number;
    discountAmount: number;
    grandTotal: number;
  };
  payments: FinalBillPayment[];
};

type DiningSessionSummary = {
  diningSessionId: string;
  diningSessionDisplayNumber: string | null;
  diningSessionStatus: string | null;
  tableNumber: string | null;
  customerName: string | null;
  waiterName: string | null;
  createdAt: string;
  latestAt: string;
  batches: CashierOrder[];
  verifiedTotal: number;
  pendingCount: number;
  incompleteItemCount: number;
  itemCount: number;
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

function cancellationStatusLabel(value: string, kind: "payment" | "kitchen") {
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (kind === "payment") return paymentLabel(normalized);
  if (["", "none", "held", "pending", "waiting payment", "new"].includes(normalized))
    return "Not started";
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cancellationItemsLabel(request: CashierCancellationRequest) {
  const visible = request.items.slice(0, 3)
    .map((item) => `${item.quantity}× ${item.name}`);
  const hidden = Math.max(0, request.items.length - visible.length);
  const preview = `${visible.join(" · ")}${hidden ? ` · +${hidden} more` : ""}`;
  return request.scope === "order" ? `Entire Order${preview ? ` · ${preview}` : ""}` : preview;
}

type QueueTab = "pending" | "paid" | "preparing" | "ready" | "completed";
const QUEUE_PRESENTATION = {
  pending: { title: "Payment Due Queue", icon: "due", action: "Verify Payment", empty: "No payments waiting." },
  preparing: { title: "Bill Requested Queue", icon: "bill", action: "Print Bill", empty: "No bill requests right now." },
  ready: { title: "Receipt Pending Queue", icon: "print", action: "Print Receipt", empty: "No receipts waiting to print." },
  paid: { title: "Paid Queue", icon: "paid", action: "Review", empty: "No paid orders are waiting for review." },
  completed: { title: "Completed Queue", icon: "completed", action: "View", empty: "No completed transactions yet." },
} as const;
type ReconcileStep = 1 | 2 | 3 | 4 | 5;
type CheckoutPaymentMethod = {
  method_code: string;
  display_name: string;
  value: string;
};
const PAYMENT_METHODS = [
  "Cash",
  "Telebirr",
  "CBE Birr",
  "Mobile Banking",
  "Card",
  "Chapa",
  "Mixed",
];
const ALL_CATEGORIES = "all";
const ACTIVE_ORDER_STATUSES: CashierOrder["status"][] = [
  "new",
  "accepted",
  "preparing",
  "ready",
  "served",
];
const PAYMENT_SCREENSHOT_BUCKET = "payment-screenshots";

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtBillMoney(value: number) {
  return `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeFinalBillPayload(value: unknown): FinalDiningBillModel {
  const root = asRecord(value);
  const bill = asRecord(root.bill);
  const restaurant = asRecord(root.restaurant);
  const totals = asRecord(root.totals);
  const format = String(bill.format ?? "80mm");

  return {
    bill: {
      id: String(bill.id ?? ""),
      billNumber: String(bill.bill_number ?? ""),
      receiptNumber: String(bill.receipt_number ?? bill.bill_number ?? ""),
      diningSessionId: String(bill.dining_session_id ?? ""),
      diningSessionNumber: String(bill.dining_session_number ?? ""),
      tableNumber: bill.table_number ? String(bill.table_number) : null,
      customerName: bill.customer_name ? String(bill.customer_name) : null,
      waiterName: bill.waiter_name ? String(bill.waiter_name) : null,
      cashierName: bill.cashier_name ? String(bill.cashier_name) : null,
      printedAt: String(bill.printed_at ?? new Date().toISOString()),
      printCount: Number(bill.print_count ?? 1),
      format:
        format === "58mm" || format === "a4" || format === "browser"
          ? format
          : "80mm",
      pdfPath: bill.pdf_path ? String(bill.pdf_path) : null,
      status: String(bill.status ?? "printed"),
    },
    restaurant: {
      name: String(restaurant.name ?? "Restaurant"),
      logoUrl: restaurant.logo_url ? String(restaurant.logo_url) : null,
      tinNumber: restaurant.tin_number ? String(restaurant.tin_number) : null,
      vatRegistrationNumber: restaurant.vat_registration_number
        ? String(restaurant.vat_registration_number)
        : null,
      phone: restaurant.phone ? String(restaurant.phone) : null,
      address: restaurant.address ? String(restaurant.address) : null,
      website: restaurant.website ? String(restaurant.website) : null,
    },
    items: Array.isArray(root.items)
      ? root.items.map((item) => {
          const row = asRecord(item);
          return {
            name: String(row.name ?? "Menu item"),
            quantity: Number(row.quantity ?? 0),
            unitPrice: Number(row.unit_price ?? 0),
            total: Number(row.total ?? 0),
          };
        })
      : [],
    totals: {
      subtotal: Number(totals.subtotal ?? 0),
      vatRate: Number(totals.vat_rate ?? 0.15),
      vatAmount: Number(totals.vat_amount ?? 0),
      serviceChargeRate: Number(totals.service_charge_rate ?? 0),
      serviceChargeAmount: Number(totals.service_charge_amount ?? 0),
      discountAmount: Number(totals.discount_amount ?? 0),
      grandTotal: Number(totals.grand_total ?? 0),
    },
    payments: Array.isArray(root.payments)
      ? root.payments.map((payment) => {
          const row = asRecord(payment);
          return {
            method: String(row.method ?? "Other"),
            amount: Number(row.amount ?? 0),
          };
        })
      : [],
  };
}

function customerTypeLabel(session: DiningSessionSummary) {
  const sources = new Set(
    session.batches.map((batch) => batch.invoiceSource ?? batch.orderSource),
  );
  if (sources.has("public_qr") && sources.size > 1)
    return "QR + Staff Assisted";
  if (sources.has("public_qr")) return "QR Customer";
  if (sources.has("waiter")) return "Waiter Assisted";
  if (sources.has("cashier")) return "Cashier POS";
  return "Restaurant Guest";
}

export function buildFinalBillReviewModel(
  session: DiningSessionSummary,
  restaurant: CashierRestaurant,
  cashierName: string,
  format: FinalBillFormat,
  documentType: "receipt" | "bill" = "receipt",
): FinalDiningBillModel {
  const grouped = new Map<string, FinalBillLineItem>();
  for (const batch of session.batches)
    for (const item of batch.items) {
      const key = `${item.name}:${item.price}`;
      const current = grouped.get(key) ?? {
        name: item.name,
        quantity: 0,
        unitPrice: item.price,
        total: 0,
      };
      current.quantity += item.quantity;
      current.total += item.quantity * item.price;
      grouped.set(key, current);
    }
  const paidBatches = session.batches.filter((batch) => batch.invoiceStatus === "paid");
  const financialBatches = documentType === "bill"
    ? session.batches.filter((batch) => !["cancelled", "refunded"].includes(batch.invoiceStatus ?? ""))
    : paidBatches;
  const total = documentType === "bill"
    ? financialBatches.reduce((sum, batch) => sum + batch.totalPrice, 0)
    : session.verifiedTotal;
  const subtotal = financialBatches.reduce((sum, batch) => sum + Number(batch.subtotal ?? 0), 0);
  const vatAmount = financialBatches.reduce((sum, batch) => sum + Number(batch.vatAmount ?? 0), 0);
  const serviceChargeAmount = financialBatches.reduce((sum, batch) => sum + Number(batch.serviceChargeAmount ?? 0), 0);
  const discountAmount = financialBatches.reduce((sum, batch) => sum + Number(batch.discountAmount ?? 0), 0);
  const vatRate = subtotal > 0 ? vatAmount / subtotal : 0;
  const serviceChargeRate = subtotal > 0 ? serviceChargeAmount / subtotal : 0;
  const methods = new Map<string, number>();
  for (const batch of paidBatches)
    methods.set(
      batch.paymentMethod || "Other",
      (methods.get(batch.paymentMethod || "Other") ?? 0) + batch.totalPrice,
    );
  return {
    bill: {
      id: "",
      billNumber: "",
      receiptNumber: "",
      diningSessionId: session.diningSessionId,
      diningSessionNumber: "",
      tableNumber: session.tableNumber,
      customerName: session.customerName,
      waiterName: session.waiterName,
      cashierName,
      printedAt: new Date().toISOString(),
      printCount: 0,
      format,
      pdfPath: null,
      status: documentType === "bill" ? "bill-preview" : "preview",
    },
    restaurant: {
      name: restaurant.name,
      logoUrl: restaurant.logoUrl,
      tinNumber: null,
      vatRegistrationNumber: null,
      phone: null,
      address: null,
      website: null,
    },
    items: [...grouped.values()],
    totals: {
      subtotal,
      vatRate,
      vatAmount,
      serviceChargeRate,
      serviceChargeAmount,
      discountAmount,
      grandTotal: total,
    },
    payments: documentType === "bill"
      ? []
      : [...methods].map(([method, amount]) => ({ method, amount })),
  };
}

function chunkBillItems(items: FinalBillLineItem[], format: FinalBillFormat) {
  const perPage =
    format === "browser"
      ? 24
      : format === "a4"
        ? 28
        : format === "58mm"
          ? 10
          : 16;
  const pages: FinalBillLineItem[][] = [];
  for (let index = 0; index < items.length; index += perPage) {
    pages.push(items.slice(index, index + perPage));
  }
  return pages.length > 0 ? pages : [[]];
}

function buildFinalBillPrintHtml(model: FinalDiningBillModel) {
  const isBillPreview = model.bill.status === "bill-preview";
  const pages = chunkBillItems(model.items, model.bill.format);
  const isA4 = model.bill.format === "a4";
  const isBrowser = model.bill.format === "browser";
  const width =
    model.bill.format === "58mm"
      ? "58mm"
      : model.bill.format === "80mm"
        ? "80mm"
        : isBrowser
          ? "100%"
          : "210mm";
  const pageSize = isA4
    ? "A4"
    : model.bill.format === "58mm"
      ? "58mm auto"
      : model.bill.format === "80mm"
        ? "80mm auto"
        : "auto";
  const printedAt = new Date(model.bill.printedAt);
  const date = printedAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
  const time = printedAt.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const totalPaid = model.payments.reduce(
    (sum, payment) => sum + payment.amount,
    0,
  );
  const paymentAmounts = new Map(
    model.payments.map((payment) => [
      payment.method.toLowerCase(),
      payment.amount,
    ]),
  );
  const paymentBreakdown = [
    "Cash",
    "Telebirr",
    "CBE Birr",
    "Card",
    "Chapa",
    "Other",
  ].map((method) => ({
    method,
    amount: paymentAmounts.get(method.toLowerCase()) ?? 0,
  }));
  const logo = model.restaurant.logoUrl
    ? `<img class="bill-logo" src="${escapeHtml(model.restaurant.logoUrl)}" alt="" />`
    : `<div class="bill-logo fallback">${escapeHtml(model.restaurant.name.charAt(0).toUpperCase())}</div>`;

  const pageHtml = pages
    .map((items, pageIndex) => {
      const lastPage = pageIndex === pages.length - 1;
      const itemRows = items
        .map(
          (item) => `
      <tr>
        <td>${escapeHtml(item.quantity)}</td>
        <td>${escapeHtml(item.name)}</td>
        <td class="num">${fmtBillMoney(item.unitPrice)}</td>
        <td class="num">${fmtBillMoney(item.total)}</td>
      </tr>
    `,
        )
        .join("");

      const totalsHtml = lastPage
        ? `
      <section class="bill-totals">
        <div><span>Subtotal</span><strong>${fmtBillMoney(model.totals.subtotal)}</strong></div>
        <div><span>VAT (${Math.round(model.totals.vatRate * 100)}%)</span><strong>${fmtBillMoney(model.totals.vatAmount)}</strong></div>
        ${model.totals.serviceChargeAmount > 0 ? `<div><span>Service Charge (${Math.round(model.totals.serviceChargeRate * 100)}%)</span><strong>${fmtBillMoney(model.totals.serviceChargeAmount)}</strong></div>` : ""}
        ${model.totals.discountAmount !== 0 ? `<div><span>Discount</span><strong>${fmtBillMoney(Math.abs(model.totals.discountAmount))}</strong></div>` : ""}
        <div class="grand"><span>Grand Total</span><strong>${fmtBillMoney(model.totals.grandTotal)}</strong></div>
      </section>
      ${isBillPreview ? "" : `<section class="bill-payments">
        <h3>Payment Breakdown</h3>
        ${paymentBreakdown.map((payment) => `<div><span>${escapeHtml(payment.method)}</span><strong>${fmtBillMoney(payment.amount)}</strong></div>`).join("")}
        <div class="paid"><span>Total Paid</span><strong>${fmtBillMoney(totalPaid)}</strong></div>
      </section>`}
      <footer>
        <strong>Thank you for visiting</strong>
        ${model.restaurant.phone ? `<span>${escapeHtml(model.restaurant.phone)}</span>` : ""}
        ${model.restaurant.website ? `<span>${escapeHtml(model.restaurant.website)}</span>` : ""}
        <span>QR feedback coming soon</span>
      </footer>
    `
        : `<div class="continue">Continue on page ${pageIndex + 2}...</div>`;

      return `
      <section class="bill-page">
        <header>
          ${
            pageIndex === 0
              ? `
            ${logo}
            <h1>${escapeHtml(model.restaurant.name)}</h1>
            <p>${isBillPreview ? "Customer Bill" : "Payment Receipt"}</p>
            ${model.restaurant.tinNumber ? `<p>TIN: ${escapeHtml(model.restaurant.tinNumber)}</p>` : ""}
            ${model.restaurant.vatRegistrationNumber ? `<p>VAT Number: ${escapeHtml(model.restaurant.vatRegistrationNumber)}</p>` : ""}
            ${model.restaurant.address ? `<p>${escapeHtml(model.restaurant.address)}</p>` : ""}
            ${model.restaurant.phone ? `<p>Tel: ${escapeHtml(model.restaurant.phone)}</p>` : ""}
          `
              : `<h2>${escapeHtml(model.restaurant.name)}</h2><p>${isBillPreview ? "Bill" : "Receipt"} continued</p>`
          }
        </header>
        <section class="bill-meta">
          <div><span>Table</span><strong>${escapeHtml(model.bill.tableNumber ?? "-")}</strong></div>
          <div><span>Customer</span><strong>${escapeHtml(model.bill.customerName ?? "Guest")}</strong></div>
          <div><span>Waiter</span><strong>${escapeHtml(model.bill.waiterName ?? "-")}</strong></div>
          <div><span>Cashier</span><strong>${escapeHtml(model.bill.cashierName ?? "-")}</strong></div>
          <div><span>Date</span><strong>${escapeHtml(date)}</strong></div>
          <div><span>Time</span><strong>${escapeHtml(time)}</strong></div>
          <div><span>Page</span><strong>${pageIndex + 1}/${pages.length}</strong></div>
        </section>
        <table>
          <thead><tr><th>Qty</th><th>Description</th><th class="num">Unit Price</th><th class="num">Total</th></tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        ${totalsHtml}
      </section>
    `;
    })
    .join("");

  return `<!doctype html><html><head><title>${escapeHtml(model.restaurant.name)} ${isBillPreview ? "Bill" : "Receipt"}</title><style>
    *{box-sizing:border-box}body{margin:0;background:#f8fafc;color:#111827;font-family:${isA4 ? "Arial, sans-serif" : "'Courier New', monospace"}}
    .bill-page{width:${width};max-width:${isBrowser ? "210mm" : width};min-height:${isA4 ? "287mm" : "auto"};margin:${isA4 || isBrowser ? "10mm auto" : "0 auto"};padding:${isA4 || isBrowser ? "14mm" : "5mm"};background:#fff;page-break-after:always}
    .bill-page:last-child{page-break-after:auto}.bill-logo{width:${isA4 ? "64px" : "48px"};height:${isA4 ? "64px" : "48px"};object-fit:cover;margin:0 auto 8px;display:grid;place-items:center;border-radius:8px}.bill-logo.fallback{background:#111827;color:#fff;font-weight:900}
    header{text-align:center;border-bottom:1px dashed #111;padding-bottom:10px;margin-bottom:10px}h1,h2{font-size:${isA4 ? "22px" : "16px"};margin:0 0 4px;text-transform:uppercase}p{margin:2px 0;font-size:${isA4 ? "12px" : "11px"}}
    .bill-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 12px;border-bottom:1px dashed #111;padding-bottom:10px;margin-bottom:10px;font-size:${isA4 ? "12px" : "11px"}}
    .bill-meta div,.bill-totals div,.bill-payments div{display:flex;justify-content:space-between;gap:10px}.bill-meta span{color:#4b5563}table{width:100%;border-collapse:collapse;font-size:${isA4 ? "12px" : "11px"}}th{text-align:left;border-bottom:1px solid #111;padding:5px 0}td{vertical-align:top;padding:5px 0;border-bottom:1px solid #e5e7eb}.num{text-align:right;white-space:nowrap}
    .continue{text-align:center;border-top:1px dashed #111;margin-top:16px;padding-top:12px;font-weight:800}.bill-totals,.bill-payments{border-top:1px dashed #111;margin-top:14px;padding-top:10px;font-size:${isA4 || isBrowser ? "13px" : "12px"};display:grid;gap:7px}.bill-totals .grand,.bill-payments .paid{border-top:1px solid #111;padding-top:8px;text-transform:uppercase;font-size:${isA4 || isBrowser ? "16px" : "14px"}}.bill-payments h3{margin:0 0 4px;font-size:${isA4 || isBrowser ? "13px" : "12px"};text-transform:uppercase}footer{text-align:center;border-top:1px dashed #111;margin-top:14px;padding-top:10px;display:grid;gap:3px;font-size:${isA4 || isBrowser ? "12px" : "11px"}}
    @page{size:${pageSize};margin:0}@media print{body{background:#fff}.bill-page{margin:0 auto;box-shadow:none}}
  </style></head><body>${pageHtml}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),120));<\/script></body></html>`;
}

function printFinalBill(model: FinalDiningBillModel) {
  const printWindow = window.open("", "_blank", "width=900,height=700");
  if (!printWindow) {
    throw new Error(
      "Could not open the print window. Please allow pop-ups for this site.",
    );
  }
  printWindow.document.write(buildFinalBillPrintHtml(model));
  printWindow.document.close();
}

function normalizeOrder(
  row: OrderRow,
  items: CashierOrderItem[] = [],
): CashierOrder {
  return {
    id: row.id,
    displayNumber: row.display_number ?? null,
    invoiceId: row.invoice_id ?? null,
    invoiceDisplayNumber: row.invoice_display_number ?? null,
    kitchenTicketNumber: row.kitchen_ticket_number ?? null,
    invoiceSource: row.invoice_source ?? row.order_source ?? null,
    invoiceCreatorName: row.invoice_creator_name ?? row.waiter_name ?? null,
    invoiceKitchenStatus: row.invoice_kitchen_status ?? null,
    invoiceNumber:
      row.invoice_number === null || typeof row.invoice_number === "undefined"
        ? null
        : Number(row.invoice_number),
    invoiceStatus: canonicalPaymentStatus(
      row.payment_status ?? row.invoice_status,
    ),
    invoicePaidAt: row.invoice_paid_at ?? null,
    invoiceLockedAt: row.invoice_locked_at ?? null,
    invoiceVerifiedAt: row.invoice_verified_at ?? row.invoice_paid_at ?? null,
    invoiceVerifiedBy: row.invoice_verified_by ?? null,
    invoiceVerifiedByName: row.invoice_verified_by_name ?? null,
    invoiceRejectedAt: row.invoice_rejected_at ?? null,
    invoiceRejectionReason: row.invoice_rejection_reason ?? null,
    invoiceRetryRequestedAt: row.invoice_retry_requested_at ?? null,
    referenceNumber: row.reference_number ?? null,
    transactionId: row.transaction_id ?? null,
    screenshotUrl: row.screenshot_url ?? null,
    diningSessionId: row.dining_session_id ?? row.id,
    diningSessionDisplayNumber: row.dining_session_display_number ?? null,
    diningSessionStatus: row.dining_session_status ?? null,
    orderBatchId: row.order_batch_id ?? row.invoice_id ?? null,
    status: canonicalOperationalStatus(row.operational_status ?? row.status),
    customerName: row.customer_name,
    customerPhone: row.customer_phone ?? null,
    tableNumber: row.table_number,
    orderSource: row.order_source ?? null,
    waiterName: row.waiter_name ?? null,
    orderNote: row.order_note ?? null,
    paymentMethod: row.payment_method,
    totalPrice: Number(row.total_price),
    subtotal: Number(row.subtotal ?? 0),
    vatRate: Number(row.vat_rate ?? 0),
    vatAmount: Number(row.vat_amount ?? 0),
    serviceChargeRate: Number(row.service_charge_rate ?? 0),
    serviceChargeAmount: Number(row.service_charge_amount ?? 0),
    discountAmount: Number(row.discount_amount ?? 0),
    createdAt: row.created_at,
    paymentVerifiedAt: row.payment_verified_at ?? row.invoice_paid_at ?? null,
    items,
  };
}

function normalizeItem(row: ItemRow): CashierOrderItem {
  const menuItem = row.menu_items;
  const name =
    row.menu_item_name ??
    (Array.isArray(menuItem)
      ? (menuItem[0]?.name ?? "Menu item")
      : (menuItem?.name ?? "Menu item"));
  return {
    id: row.id,
    orderId: row.order_id,
    invoiceId: row.invoice_id ?? null,
    name,
    quantity: Number(row.quantity),
    price: Number(row.price),
    notes: row.notes ?? null,
    appendedAt: row.appended_at ?? null,
    kitchenStatus: row.kitchen_status ?? null,
  };
}

function normalizeInvoiceRow(row: OrderRow): CashierOrder {
  const rawItems =
    typeof row.items === "string" ? JSON.parse(row.items) : row.items;
  const items = Array.isArray(rawItems)
    ? rawItems.map((item) => normalizeItem(item as ItemRow))
    : [];
  return normalizeOrder(row, items);
}

function normalizeSubmittedOrder(row: SubmittedCashierOrder): CashierOrder {
  return {
    id: row.order_id,
    displayNumber: null,
    invoiceSource: "cashier",
    invoiceCreatorName: "Cashier",
    invoiceKitchenStatus: "waiting_payment",
    invoiceStatus: "pending",
    diningSessionId: row.order_id,
    diningSessionDisplayNumber: null,
    diningSessionStatus: row.dining_session_status ?? "open",
    status: row.status,
    customerName: null,
    customerPhone: null,
    tableNumber: row.table_number,
    orderSource: null,
    waiterName: null,
    orderNote: null,
    paymentMethod: row.payment_method,
    totalPrice: Number(row.total_price),
    createdAt: row.created_at,
    paymentVerifiedAt: row.payment_verified_at ?? null,
    items: [],
  };
}

function isContinuableOrder(order: CashierOrder) {
  return order.diningSessionStatus === "open";
}

function isDigitalPayment(order: CashierOrder) {
  return order.invoiceStatus === "paid" && order.paymentMethod !== "Cash";
}

function isCashPayment(order: CashierOrder) {
  return order.invoiceStatus === "paid" && order.paymentMethod === "Cash";
}

function isAwaitingCollection(order: CashierOrder) {
  return (
    order.invoiceStatus === "paid" &&
    (order.status === "ready" || order.status === "served")
  );
}

function isCompletedOrder(order: CashierOrder) {
  return (
    order.diningSessionStatus === "closed" ||
    order.diningSessionStatus === "checked_out"
  );
}

function isUnpaidPayment(order: CashierOrder) {
  return (
    !isCompletedOrder(order) &&
    (order.invoiceStatus === "pending" || order.invoiceStatus === "held")
  );
}

function isVerifiablePayment(order: CashierOrder) {
  return (
    !isCompletedOrder(order) &&
    (order.invoiceStatus === "pending" || order.invoiceStatus === "held")
  );
}

function isActiveOrder(order: CashierOrder) {
  return order.diningSessionStatus === "open";
}

function compareDiningSessionsNewestFirst(
  left: DiningSessionSummary,
  right: DiningSessionSummary,
) {
  const latestDifference =
    new Date(right.latestAt).getTime() - new Date(left.latestAt).getTime();
  if (latestDifference !== 0) return latestDifference;

  const createdDifference =
    new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  if (createdDifference !== 0) return createdDifference;

  return right.diningSessionId.localeCompare(left.diningSessionId);
}

function buildDiningSessionSummaries(sessionOrders: CashierOrder[]) {
  const sessions = new Map<string, DiningSessionSummary>();
  for (const order of sessionOrders) {
    const diningSessionId = order.diningSessionId ?? order.id;
    const current = sessions.get(diningSessionId) ?? {
      diningSessionId,
      diningSessionDisplayNumber:
        order.diningSessionDisplayNumber ?? order.displayNumber ?? null,
      diningSessionStatus: order.diningSessionStatus ?? null,
      tableNumber: order.tableNumber,
      customerName: order.customerName,
      waiterName: order.waiterName ?? null,
      createdAt: order.createdAt,
      latestAt: order.createdAt,
      batches: [],
      verifiedTotal: 0,
      pendingCount: 0,
      incompleteItemCount: 0,
      itemCount: 0,
    };
    current.batches.push(order);
    current.verifiedTotal +=
      order.invoiceStatus === "paid" ? order.totalPrice : 0;
    if (
      order.invoiceStatus !== "paid" &&
      order.invoiceStatus !== "cancelled" &&
      order.invoiceStatus !== "refunded"
    )
      current.pendingCount += 1;
    current.itemCount += order.items.length;
    current.incompleteItemCount += order.items.filter(
      (item) => item.kitchenStatus !== "completed",
    ).length;
    if (
      new Date(order.createdAt).getTime() > new Date(current.latestAt).getTime()
    )
      current.latestAt = order.createdAt;
    if (
      new Date(order.createdAt).getTime() <
      new Date(current.createdAt).getTime()
    )
      current.createdAt = order.createdAt;
    if (!current.waiterName && order.waiterName)
      current.waiterName = order.waiterName;
    if (!current.customerName && order.customerName)
      current.customerName = order.customerName;
    sessions.set(diningSessionId, current);
  }
  return [...sessions.values()].sort(compareDiningSessionsNewestFirst);
}

function paymentDueOrder(session: DiningSessionSummary): CashierOrder {
  const dueBatches = session.batches.filter(isUnpaidPayment);
  const first = dueBatches[0] ?? session.batches[0];
  if (!first) throw new Error("Dining session has no order batches.");
  const dueMethods = dueBatches
    .map((batch) => batch.paymentMethod?.trim() || "")
    .filter(Boolean);
  const authoritativeMethod =
    dueMethods.length === dueBatches.length && new Set(dueMethods).size === 1
      ? dueMethods[0]
      : null;
  return {
    ...first,
    id: session.diningSessionId,
    displayNumber: session.diningSessionDisplayNumber,
    invoiceId: null,
    invoiceDisplayNumber: "Running Bill",
    invoiceNumber: null,
    invoiceStatus: dueBatches.some((batch) => batch.invoiceStatus === "held")
      ? "held"
      : "pending",
    diningSessionId: session.diningSessionId,
    diningSessionStatus: session.diningSessionStatus,
    totalPrice: dueBatches.reduce((sum, batch) => sum + batch.totalPrice, 0),
    paymentMethod: authoritativeMethod,
    items: dueBatches.flatMap((batch) => batch.items),
    referenceNumber: null,
    transactionId: null,
    screenshotUrl: null,
  };
}

function CashierMenuItemImage({ item }: { item: CashierMenuItem }) {
  const image = resolveSmartImage({ itemId: item.id, master: item.image_url ? { source: "MASTER", status: "APPROVED", url: item.image_url, version: 1 } : null, placeholderUrl: "" }, "card");

  return (
    <span className="cd-menu-item-image-wrap">
      {image.url ? (
        <SmartImage resolution={image} className="cd-menu-item-image" alt={item.name} fallback={null} fallbackClassName="cd-menu-item-image placeholder" />
      ) : (
        <span className="cd-menu-item-image placeholder" aria-hidden="true" />
      )}
    </span>
  );
}

export type CheckoutWorkspaceStatus =
  | "payment-due"
  | "bill-requested"
  | "receipt-pending"
  | "paid"
  | "completed";

export function checkoutServiceLocationLabel(
  order: Pick<CashierOrder, "tableNumber" | "invoiceSource">,
) {
  const compact = orderTableCode(order);
  const tableNumber = compact.match(/^T(\d+)$/i)?.[1];
  if (tableNumber) return `Table ${Number(tableNumber)}`;
  return compact === "Direct order" ? "QR Order" : compact;
}

export function resolveCheckoutWorkspaceStatus(
  order: Pick<
    CashierOrder,
    "invoiceId" | "invoiceStatus" | "status" | "diningSessionStatus"
  >,
  billRequestedInvoiceIds: ReadonlySet<string>,
  receiptPendingInvoiceIds: ReadonlySet<string>,
): CheckoutWorkspaceStatus {
  if (
    order.status === "closed" ||
    ["closed", "checked_out"].includes(order.diningSessionStatus ?? "")
  ) {
    return "completed";
  }
  if (order.invoiceId && receiptPendingInvoiceIds.has(order.invoiceId)) {
    return "receipt-pending";
  }
  if (order.invoiceId && billRequestedInvoiceIds.has(order.invoiceId)) {
    return "bill-requested";
  }
  if (order.invoiceStatus === "paid") return "paid";
  return "payment-due";
}

const CHECKOUT_STATUS_LABEL: Record<CheckoutWorkspaceStatus, string> = {
  "payment-due": "Payment Due",
  "bill-requested": "Bill Requested",
  "receipt-pending": "Receipt Pending",
  paid: "Paid",
  completed: "Completed",
};

function checkoutOrderSource(order: CashierOrder) {
  const source = (order.invoiceSource || order.orderSource || "").toLowerCase();
  if (source === "waiter" || order.waiterName) {
    return { label: "Waiter", name: order.waiterName || order.invoiceCreatorName || null };
  }
  if (source === "cashier") {
    return { label: "Cashier", name: order.invoiceCreatorName || null };
  }
  if (source === "public_qr" || source === "self_order") {
    return { label: "Self Order", name: order.customerName || null };
  }
  if (source === "room_service") {
    return { label: "Room Service", name: order.invoiceCreatorName || order.customerName || null };
  }
  if (source === "delivery") {
    return { label: "Delivery", name: order.customerName || null };
  }
  return { label: "Customer", name: order.customerName || null };
}

function compactElapsedLabel(iso: string, now: Date) {
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - new Date(iso).getTime()) / 60000),
  );
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `${hours} hr${remainingMinutes ? ` ${remainingMinutes} min` : ""}`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days} d${remainingHours ? ` ${remainingHours} hr` : ""}`;
}

function CheckoutSlideOverDrawer({
  order,
  checkoutStatus,
  serviceLocationName,
  onClose,
  onReleaseTable,
  onApprove,
  onPrintBill,
  onPrintReceipt,
  approving,
  paymentReference,
  paymentTransactionId,
  paymentScreenshotPreviewUrl,
  duplicateReferenceNotice,
  collectionPaymentMethod,
  availablePaymentMethods,
  paymentMethodConfigurationError,
  onCollectionPaymentMethodChange,
  formatMoney,
}: {
  order: CashierOrder;
  checkoutStatus: CheckoutWorkspaceStatus;
  serviceLocationName: string;
  onClose: () => void;
  onReleaseTable?: () => void;
  onApprove?: () => void;
  onPrintBill?: () => void;
  onPrintReceipt?: () => void;
  approving: boolean;
  paymentReference: string;
  paymentTransactionId: string;
  paymentScreenshotPreviewUrl: string | null;
  duplicateReferenceNotice: string | null;
  collectionPaymentMethod: string;
  availablePaymentMethods: CheckoutPaymentMethod[];
  paymentMethodConfigurationError: string | null;
  onCollectionPaymentMethodChange: (value: string) => void;
  formatMoney: (value: number) => string;
}) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const screenshotTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [screenshotPreviewOpen, setScreenshotPreviewOpen] = useState(false);
  const [showAllCheckoutItems, setShowAllCheckoutItems] = useState(false);
  const [screenshotFitMode, setScreenshotFitMode] = useState<"fit" | "zoom">(
    "fit",
  );
  const [screenshotZoom, setScreenshotZoom] = useState(1);
  const isPending =
    order.invoiceStatus === "pending" || order.invoiceStatus === "held";
  const isPaymentDue = checkoutStatus === "payment-due";
  const showPaymentSelector = checkoutStatus === "payment-due" && isPending;
  const displayPaymentMethod =
    collectionPaymentMethod.trim() || order.paymentMethod?.trim() || "";
  const paymentMethodIssue = paymentMethodConfigurationError ||
    (!displayPaymentMethod && availablePaymentMethods.length === 0
      ? "No checkout payment methods are enabled for this business."
      : null);
  const selectablePaymentMethods =
    displayPaymentMethod &&
    !availablePaymentMethods.some((method) => method.value === displayPaymentMethod)
      ? [
          {
            method_code: "recorded_workflow_method",
            display_name: displayPaymentMethod,
            value: displayPaymentMethod,
          },
          ...availablePaymentMethods,
        ]
      : availablePaymentMethods;
  const isDigital = displayPaymentMethod !== "" && displayPaymentMethod !== "Cash";
  const { label: orderSourceLabel, name: orderSourceName } =
    checkoutOrderSource(order);
  const statusLabel = isPaymentDue && !displayPaymentMethod
    ? "Awaiting Payment Method"
    : CHECKOUT_STATUS_LABEL[checkoutStatus];
  const displayReference =
    paymentReference.trim() || order.referenceNumber?.trim() || "";
  const requiresCustomerReference =
    isDigital && orderSourceLabel !== "Waiter" && !displayReference;
  const displayTransaction =
    paymentTransactionId.trim() || order.transactionId?.trim() || "";
  const screenshotFileName = order.screenshotUrl
    ? order.screenshotUrl.split("/").pop() || "Payment screenshot"
    : "Payment screenshot";
  const screenshotUploadedAt =
    order.invoicePaidAt ||
    order.paymentVerifiedAt ||
    order.invoiceVerifiedAt ||
    order.createdAt;
  const checkoutItemLimit = 7;
  const visibleItems = showAllCheckoutItems
    ? order.items
    : order.items.slice(0, checkoutItemLimit);
  const hiddenItemCount = Math.max(0, order.items.length - checkoutItemLimit);
  const paymentVerified = order.invoiceStatus === "paid" || Boolean(
    order.invoicePaidAt || order.paymentVerifiedAt || order.invoiceVerifiedAt,
  );

  function closeScreenshotPreview() {
    setScreenshotPreviewOpen(false);
    window.setTimeout(() => screenshotTriggerRef.current?.focus(), 0);
  }

  useEffect(() => {
    setShowAllCheckoutItems(false);
    drawerRef.current
      ?.querySelector<HTMLElement>(
        "button:not(:disabled), [href], select:not(:disabled), [tabindex]:not([tabindex='-1'])",
      )
      ?.focus();
  }, [order.id]);

  function trapFocus(
    event: ReactKeyboardEvent<HTMLElement>,
    container: HTMLElement | null,
    close: () => void,
  ) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab" || !container) return;
    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(
        "button:not(:disabled), [href], select:not(:disabled), textarea:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])",
      ),
    ).filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const paymentEvidenceCard = isDigital ? (
    <div className="cd-payment-evidence-card" aria-label="Customer payment evidence">
      <div className="cd-payment-evidence-heading">Payment Evidence</div>
      <div>
        <span>Reference Number {orderSourceLabel !== "Waiter" ? <em>Required</em> : null}</span>
        <strong className={requiresCustomerReference ? "missing" : undefined}>
          {displayReference || (requiresCustomerReference ? "Required" : "Not provided")}
        </strong>
      </div>
      {displayTransaction ? (
        <div><span>Transaction ID</span><strong>{displayTransaction}</strong></div>
      ) : null}
      <div>
        <span>Screenshot <em>Optional</em></span>
        <strong>{paymentScreenshotPreviewUrl ? "Uploaded" : "Not provided"}</strong>
      </div>
      {paymentScreenshotPreviewUrl ? (
        <div className="cd-payment-screenshot-row">
          <img src={paymentScreenshotPreviewUrl} alt="" />
          <div><strong>{screenshotFileName}</strong><span>{fmtDateTime(screenshotUploadedAt)}</span></div>
          <button
            ref={screenshotTriggerRef}
            type="button"
            onClick={() => {
              setScreenshotFitMode("fit");
              setScreenshotZoom(1);
              setScreenshotPreviewOpen(true);
            }}
          >
            View Screenshot
          </button>
        </div>
      ) : null}
    </div>
  ) : null;

  const primaryAction = checkoutStatus === "payment-due"
    ? { label: approving ? "Verifying..." : "Verify Payment", onClick: displayPaymentMethod && !requiresCustomerReference ? onApprove : undefined, disabled: !displayPaymentMethod || requiresCustomerReference || !onApprove || approving || Boolean(paymentMethodIssue), icon: "paid" as const }
    : checkoutStatus === "bill-requested"
      ? { label: "Print Bill", onClick: onPrintBill, disabled: !onPrintBill || approving, icon: "bill" as const }
      : checkoutStatus === "receipt-pending" || checkoutStatus === "paid"
        ? { label: "Print Receipt", onClick: onPrintReceipt, disabled: !onPrintReceipt || approving, icon: "print" as const }
        : { label: "Reprint Receipt", onClick: onPrintReceipt, disabled: !onPrintReceipt || approving, icon: "print" as const };

  return (
    <>
      <section
        ref={drawerRef}
        className={`cd-drawer cd-checkout-slide-over status-${checkoutStatus}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cashier-checkout-drawer-title"
        onKeyDown={(event) =>
          trapFocus(event, drawerRef.current, () => {
            if (screenshotPreviewOpen) {
              closeScreenshotPreview();
              return;
            }
            onClose();
          })
        }
      >
        <header className="cd-drawer-header">
          <div className="cd-checkout-heading">
            <span className="cd-checkout-label">Checkout</span>
            <h2 className="cd-drawer-title" id="cashier-checkout-drawer-title">{serviceLocationName}</h2>
            <div className="cd-checkout-assignee" aria-label={orderSourceName ? `${orderSourceLabel}: ${orderSourceName}` : orderSourceLabel}>
              <span>{orderSourceLabel}</span>
              {orderSourceName ? <><i aria-hidden="true">•</i><strong>{orderSourceName}</strong></> : null}
            </div>
          </div>
          <div className="cd-checkout-header-actions">
            {statusLabel !== "Paid" ? (
              <span className={`cd-checkout-status-badge ${checkoutStatus}`} aria-label={`Current queue status: ${statusLabel}`}>
                <i aria-hidden="true" />{statusLabel}
              </span>
            ) : null}
            <button type="button" className="cd-drawer-close" onClick={onClose} aria-label="Close checkout">&times;</button>
          </div>
        </header>
        <div className="cd-drawer-body">
          <section className="cd-checkout-order-summary" aria-label="Items and bill summary">
            <div className="cd-checkout-item-count">{order.items.length} items</div>
            <div className="cd-drawer-items">
              {order.items.length === 0 ? <div className="cd-empty-sub">No item data available.</div> : visibleItems.map((item) => (
                <div key={item.id} className="cd-drawer-item">
                  <div className="cd-drawer-item-name">
                    <span>{item.name}</span><strong>×{item.quantity}</strong>
                    {item.notes ? <div className="cd-drawer-item-modifiers">{item.notes}</div> : null}
                  </div>
                  <div className="cd-drawer-item-price">{formatMoney(item.price * item.quantity)}</div>
                </div>
              ))}
            </div>
            {hiddenItemCount > 0 ? (
              <button
                type="button"
                className="cd-checkout-hidden-items"
                aria-expanded={showAllCheckoutItems}
                onClick={() => setShowAllCheckoutItems((current) => !current)}
              >
                {showAllCheckoutItems ? "Show fewer items" : `Show ${hiddenItemCount} more items`}
              </button>
            ) : null}
            <div className="cd-checkout-breakdown" aria-label="Charges">
              <span>Subtotal</span><strong>{formatMoney(order.subtotal ?? order.totalPrice)}</strong>
              {(order.vatAmount ?? 0) > 0 ? <><span>VAT</span><strong>{formatMoney(order.vatAmount ?? 0)}</strong></> : null}
              {(order.serviceChargeAmount ?? 0) > 0 ? <><span>Service Charge</span><strong>{formatMoney(order.serviceChargeAmount ?? 0)}</strong></> : null}
              {(order.discountAmount ?? 0) !== 0 ? <><span>Discount</span><strong>- {formatMoney(Math.abs(order.discountAmount ?? 0))}</strong></> : null}
              <span className="cd-checkout-total-row">Total</span><strong className="cd-checkout-total-row">{formatMoney(order.totalPrice)}</strong>
            </div>
          </section>

          <section className="cd-payment-method-panel" aria-labelledby="checkout-payment-method-title">
            <label htmlFor="cashier-checkout-payment-method" id="checkout-payment-method-title">Payment Method</label>
            <select
              id="cashier-checkout-payment-method"
              value={displayPaymentMethod}
              disabled={!showPaymentSelector || approving || Boolean(paymentMethodIssue)}
              onChange={(event) => onCollectionPaymentMethodChange(event.target.value)}
            >
              <option value="">{showPaymentSelector ? "Not Selected" : "Not recorded"}</option>
              {selectablePaymentMethods.map((method) => <option key={method.method_code} value={method.value}>{method.display_name}</option>)}
            </select>
            {paymentMethodIssue ? <div className="cd-payment-method-error" role="alert"><strong>Payment methods unavailable</strong><span>{paymentMethodIssue}</span></div> : null}
            {paymentEvidenceCard}
            {duplicateReferenceNotice ? <div className="cd-payment-duplicate"><span>{duplicateReferenceNotice}</span></div> : null}
          </section>
          {order.orderNote ? <div className="cd-pos-active-note">{order.orderNote}</div> : null}
        </div>
        <footer className="cd-drawer-footer">
          <div className="cd-checkout-footer-actions">
            <button
              type="button"
              className="cd-checkout-secondary-action"
              onClick={onReleaseTable}
              disabled={!onReleaseTable || !paymentVerified || approving}
            >
              Release Table
            </button>
            <button
              type="button"
              className={`cd-checkout-primary-action${checkoutStatus === "completed" ? " neutral" : ""}`}
              onClick={primaryAction.onClick}
              disabled={primaryAction.disabled}
            >
              <CashierIcon name={primaryAction.icon} />{primaryAction.label}
            </button>
          </div>
        </footer>
      </section>
      {screenshotPreviewOpen && paymentScreenshotPreviewUrl ? (
        <div
          className="cd-screenshot-preview"
          role="dialog"
          aria-modal="true"
          aria-label="Payment screenshot preview"
          ref={previewRef}
          onKeyDown={(event) =>
            trapFocus(event, previewRef.current, () =>
              closeScreenshotPreview(),
            )
          }
        >
          <header>
            <strong>Payment Screenshot</strong>
            <div>
              <button
                type="button"
                onClick={() => { setScreenshotFitMode("zoom"); setScreenshotZoom((value) => Math.max(.5, value - .25)); }}
                aria-label="Zoom out"
              >
                Zoom out
              </button>
              <button
                type="button"
                onClick={() => { setScreenshotFitMode("zoom"); setScreenshotZoom((value) => Math.min(3, value + .25)); }}
                aria-label="Zoom in"
              >
                Zoom in
              </button>
              <button type="button" onClick={() => { setScreenshotFitMode("fit"); setScreenshotZoom(1); }}>
                Fit to screen
              </button>
              <button
                type="button"
                onClick={closeScreenshotPreview}
                aria-label="Close screenshot preview"
              >
                Close
              </button>
            </div>
          </header>
          <div className={`cd-screenshot-stage ${screenshotFitMode}`}>
            <img
              src={paymentScreenshotPreviewUrl}
              alt="Payment screenshot"
              style={screenshotFitMode === "zoom" ? { width: `${screenshotZoom * 100}%` } : undefined}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

export function CashierDashboardPage({
  restaurantId,
  restaurant: initialRestaurant,
  cashierName,
  initialSection,
}: CashierDashboardPageProps & { initialSection?: string }) {
  const now = useNow();
  const [orders, setOrders] = useState<CashierOrder[]>([]);
  const [workflow, setWorkflow] = useState<CashierWorkflowFoundation | null>(null);
  const [checkoutPaymentMethods, setCheckoutPaymentMethods] = useState<
    CheckoutPaymentMethod[]
  >([]);
  const [paymentMethodConfigurationError, setPaymentMethodConfigurationError] =
    useState<string | null>(null);
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [activityCollapsed, setActivityCollapsed] = useState(false);
  const [cancellationRequestsOpen, setCancellationRequestsOpen] = useState(false);
  const [cancellationRequests, setCancellationRequests] = useState<CashierCancellationRequest[]>([]);
  const [cancellationRequestsError, setCancellationRequestsError] = useState<string | null>(null);
  const [cancellationConfirmation, setCancellationConfirmation] = useState<CashierCancellationRequest | null>(null);
  const [cancellationWorkingId, setCancellationWorkingId] = useState<string | null>(null);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [categories, setCategories] = useState<MenuCategoryRow[]>([]);
  const [menuItems, setMenuItems] = useState<CashierMenuItem[]>([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(
    PAYMENT_METHODS[0],
  );
  const [menuSearch, setMenuSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORIES);
  const [cartItems, setCartItems] = useState<CashierCartItem[]>([]);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [continuationChoice, setContinuationChoice] =
    useState<ContinuationChoice>(null);
  const [activity, setActivity] = useState<ShiftActivity[]>([]);
  const [activeShift, setActiveShift] = useState<ActiveShift | null>(null);
  const [restaurant, setRestaurant] =
    useState<CashierRestaurant>(initialRestaurant);
  const fmtMoney = (value: number) => formatCurrency(value, restaurant);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queueTab, setQueueTab] = useState<QueueTab>(() =>
    initialSection === "payments"
      ? "pending"
      : initialSection === "bills"
        ? "completed"
        : "pending",
  );
  const [drawerOrder, setDrawerOrder] = useState<CashierOrder | null>(null);
  const [collectionPaymentMethod, setCollectionPaymentMethod] = useState("");
  const [posEntryOpen, setPosEntryOpen] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentTransactionId, setPaymentTransactionId] = useState("");
  const [paymentScreenshotPreviewUrl, setPaymentScreenshotPreviewUrl] =
    useState<string | null>(null);
  const [ownerDuplicateOverride, setOwnerDuplicateOverride] = useState(false);
  const [duplicateReferenceNotice, setDuplicateReferenceNotice] = useState<
    string | null
  >(null);
  const [paymentNote, setPaymentNote] = useState("");
  const [openShiftModal, setOpenShiftModal] = useState(false);
  const [openingCash, setOpeningCash] = useState("0");
  const [openingNotes, setOpeningNotes] = useState("");
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileStep, setReconcileStep] = useState<ReconcileStep>(1);
  const [actualCash, setActualCash] = useState("");
  const [varianceReason, setVarianceReason] = useState("");
  const [workingShift, setWorkingShift] = useState(false);
  const {
    controller: toastController,
    pushToast,
    visible: toasts,
  } = useCashierToasts();
  const [realtimeState, setRealtimeState] =
    useState<RealtimeConnectionState>("connecting");
  const [billFormat, setBillFormat] = useState<FinalBillFormat>(() => {
    const saved = window.localStorage.getItem(
      `serveflow.cashier.receipt-format:${restaurantId}`,
    );
    return saved === "58mm" || saved === "a4" || saved === "browser"
      ? saved
      : "80mm";
  });
  const [billWorkingSessionId, setBillWorkingSessionId] = useState<
    string | null
  >(null);
  const [closingSessionId, setClosingSessionId] = useState<string | null>(null);
  const knownPendingPaymentIdsRef = useRef<Set<string>>(new Set());
  const dashboardHydratedRef = useRef(false);
  const realtimeRefreshTimerRef = useRef<number | null>(null);
  const checkoutOpenerRef = useRef<HTMLElement | null>(null);
  const cancellationOpenerRef = useRef<HTMLElement | null>(null);

  function openCancellationRequests() {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement)
      cancellationOpenerRef.current = activeElement;
    setCancellationRequestsOpen(true);
  }

  function closeCancellationRequests() {
    if (cancellationWorkingId) return;
    setCancellationConfirmation(null);
    setCancellationRequestsOpen(false);
    window.setTimeout(() => cancellationOpenerRef.current?.focus(), 0);
  }

  function hasUnsavedCheckoutChanges() {
    if (!drawerOrder) return false;
    const recordedMethod = drawerOrder.paymentMethod?.trim() || "";
    return (
      collectionPaymentMethod !== recordedMethod ||
      ownerDuplicateOverride ||
      paymentNote.trim().length > 0
    );
  }

  function confirmDiscardCheckoutChanges() {
    return (
      !hasUnsavedCheckoutChanges() ||
      window.confirm(
        "Discard checkout changes?\n\nKeep Editing to return to the checkout, or discard changes to continue.",
      )
    );
  }

  function closeCheckoutDrawer() {
    if (!confirmDiscardCheckoutChanges()) return;
    setDrawerOrder(null);
    setPaymentNote("");
    window.setTimeout(() => checkoutOpenerRef.current?.focus(), 0);
  }

  function closeCheckoutDrawerAfterAction(delayMs = 1000) {
    window.setTimeout(() => {
      setDrawerOrder(null);
      setPaymentNote("");
      window.setTimeout(() => checkoutOpenerRef.current?.focus(), 0);
    }, delayMs);
  }

  function openCheckoutDrawer(order: CashierOrder | null) {
    if (!order) {
      closeCheckoutDrawer();
      return;
    }
    if (drawerOrder && drawerOrder.id !== order.id && !confirmDiscardCheckoutChanges())
      return;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement)
      checkoutOpenerRef.current = activeElement;
    setDrawerOrder(order);
    if (order.tableNumber) setSelectedTable(order.tableNumber);
  }

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".cd-header-search input")?.focus();
      }
      if (event.key === "Escape" && cancellationConfirmation && !cancellationWorkingId) {
        setCancellationConfirmation(null);
      } else if (event.key === "Escape" && cancellationRequestsOpen) {
        closeCancellationRequests();
      } else if (event.key === "Escape" && drawerOrder) closeCheckoutDrawer();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [cancellationConfirmation, cancellationRequestsOpen, cancellationWorkingId, drawerOrder, collectionPaymentMethod, ownerDuplicateOverride, paymentNote]);

  useEffect(() => {
    if (!cancellationRequestsOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() =>
      document.querySelector<HTMLButtonElement>(".cd-cancellation-modal-close")?.focus(), 0);
    return () => { document.body.style.overflow = previousOverflow; };
  }, [cancellationRequestsOpen]);

  useEffect(() => {
    window.localStorage.setItem(
      `serveflow.cashier.receipt-format:${restaurantId}`,
      billFormat,
    );
  }, [billFormat, restaurantId]);

  useEffect(() => {
    setPaymentReference(drawerOrder?.referenceNumber ?? "");
    setPaymentTransactionId(drawerOrder?.transactionId ?? "");
    setCollectionPaymentMethod(drawerOrder?.paymentMethod?.trim() || "");
    setOwnerDuplicateOverride(false);
    setDuplicateReferenceNotice(null);
    let cancelled = false;
    async function loadScreenshotPreview() {
      if (!drawerOrder?.screenshotUrl) {
        setPaymentScreenshotPreviewUrl(null);
        return;
      }
      const { data, error } = await supabase.storage
        .from(PAYMENT_SCREENSHOT_BUCKET)
        .createSignedUrl(drawerOrder.screenshotUrl, 60 * 10);
      if (!cancelled)
        setPaymentScreenshotPreviewUrl(error ? null : data.signedUrl);
    }
    void loadScreenshotPreview();
    return () => {
      cancelled = true;
    };
  }, [drawerOrder?.id, drawerOrder?.invoiceId]);

  async function checkDuplicateReference(
    reference: string,
    transactionId: string,
  ) {
    const query = reference.trim() || transactionId.trim();
    if (!query) {
      setDuplicateReferenceNotice(null);
      return;
    }
    const { data, error: lookupError } = await supabase.rpc(
      "find_payment_reference",
      {
        target_restaurant_id: restaurantId,
        search_reference: query,
      },
    );
    if (lookupError) {
      setDuplicateReferenceNotice(null);
      return;
    }
    const matches = (
      (data ?? []) as {
        invoice_id?: string;
        invoice_number?: number;
        invoice_display_number?: string | null;
        verified_at?: string | null;
      }[]
    ).filter((row) => row.invoice_id !== drawerOrder?.invoiceId);
    setDuplicateReferenceNotice(
      matches.length > 0
        ? `Reference already exists on ${matches[0].invoice_display_number ?? `invoice ${matches[0].invoice_number ?? "unknown"}`}.`
        : null,
    );
  }

  async function handlePaymentReferenceChange(value: string) {
    setPaymentReference(value);
    await checkDuplicateReference(value, paymentTransactionId);
  }

  async function handlePaymentTransactionIdChange(value: string) {
    setPaymentTransactionId(value);
    await checkDuplicateReference(paymentReference, value);
  }

  async function loadDashboard() {
    const [
      { data: staffData },
      { data: invoiceRows, error: invoicesError },
      { data: tableRows, error: tablesError },
      { data: categoryRows, error: categoriesError },
      { data: menuRows, error: menuError },
      { data: shiftSummary, error: shiftError },
      { data: activityRows },
      workflowState,
      { data: paymentMethodRows, error: paymentMethodsError },
      cancellationState,
    ] = await Promise.all([
      supabase
        .from("restaurant_staff")
        .select("restaurants(id,name,currency_code,currency_symbol,locale)")
        .eq("restaurant_id", restaurantId)
        .eq("active", true)
        .limit(1)
        .maybeSingle(),
      supabase.rpc("get_cashier_payment_queue", {
        target_restaurant_id: restaurantId,
      }),
      supabase
        .from("restaurant_tables")
        .select("id,restaurant_id,table_number,label,active")
        .eq("restaurant_id", restaurantId)
        .eq("active", true)
        .order("table_number", { ascending: true }),
      supabase
        .from("categories")
        .select("id,restaurant_id,name")
        .eq("restaurant_id", restaurantId)
        .order("name", { ascending: true }),
      supabase
        .from("menu_items")
        .select(
          "id,restaurant_id,category_id,name,description,price,image_url,available,categories!menu_items_category_same_restaurant(name)",
        )
        .eq("restaurant_id", restaurantId)
        .order("name", { ascending: true }),
      supabase.rpc("get_cashier_shift_summary", {
        target_restaurant_id: restaurantId,
      }),
      supabase
        .from("shift_activity_logs")
        .select(
          "id,restaurant_id,shift_id,order_id,actor_staff_id,action,message,amount,metadata,created_at",
        )
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(30),
      loadCashierWorkflowFoundation(restaurantId),
      supabase.rpc("get_cashier_checkout_payment_methods", {
        target_restaurant_id: restaurantId,
      }),
      loadCashierCancellationRequests(restaurantId)
        .then((requests) => ({ requests, error: null as string | null }))
        .catch((loadError: unknown) => ({
          requests: [] as CashierCancellationRequest[],
          error: loadError instanceof Error ? loadError.message : "Cancellation requests could not be loaded.",
        })),
    ]);

    if (invoicesError) throw new Error(invoicesError.message);
    if (tablesError) throw new Error(tablesError.message);
    if (categoriesError) throw new Error(categoriesError.message);
    if (menuError) throw new Error(menuError.message);
    if (shiftError) throw new Error(shiftError.message);
    setPaymentMethodConfigurationError(paymentMethodsError?.message ?? null);
    setCancellationRequestsError(cancellationState.error);

    const rest = Array.isArray(staffData?.restaurants)
      ? staffData.restaurants[0]
      : staffData?.restaurants;
    if (rest?.name)
      setRestaurant({
        id: rest.id,
        name: rest.name,
        logoUrl: null,
        currencyCode: rest.currency_code ?? null,
        currencySymbol: rest.currency_symbol ?? null,
        locale: rest.locale ?? null,
      });

    const summary = shiftSummary as {
      active_shift?: ActiveShift | null;
    } | null;
    const normalizedOrders = ((invoiceRows ?? []) as OrderRow[]).map(
      normalizeInvoiceRow,
    );
    const dueSessions = buildDiningSessionSummaries(
      normalizedOrders.filter(isActiveOrder),
    ).filter((session) => session.pendingCount > 0);
    const pendingPaymentIds = new Set(
      dueSessions.map((session) => session.diningSessionId),
    );
    const newPendingSessions = dueSessions.filter(
      (session) =>
        !knownPendingPaymentIdsRef.current.has(session.diningSessionId),
    );

    if (dashboardHydratedRef.current && newPendingSessions.length > 0) {
      const newest = newPendingSessions[0];
      const total = newest.batches.reduce(
        (sum, batch) => sum + batch.totalPrice,
        0,
      );
      pushToast({
        type: "information",
        title:
          newPendingSessions.length === 1
            ? "New order received"
            : `${newPendingSessions.length} new orders received`,
        description:
          newPendingSessions.length === 1
            ? `${compactTableCode(newest.tableNumber) ?? "Direct order"} · ${newest.itemCount} ${newest.itemCount === 1 ? "item" : "items"} · ${formatCurrency(total, restaurant)}`
            : "Payment Due queue updated",
        durationMs: 6_000,
        dedupeKey: `new-order:${newPendingSessions.map((session) => `${session.diningSessionId}:${session.latestAt}`).join("|")}`,
      });
      setQueueTab("pending");
      playNotificationTone("cashier");
    }

    knownPendingPaymentIdsRef.current = pendingPaymentIds;
    dashboardHydratedRef.current = true;
    setActiveShift(summary?.active_shift ?? null);
    setOrders(normalizedOrders);
    setTables(
      (tableRows ?? []).map((row) => ({
        ...row,
        table_number: Number(row.table_number),
      })) as RestaurantTable[],
    );
    setCategories((categoryRows ?? []) as MenuCategoryRow[]);
    setMenuItems(
      (menuRows ?? []).map((row) => {
        const category = Array.isArray(row.categories)
          ? row.categories[0]
          : row.categories;
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
      }) as CashierMenuItem[],
    );
    setActivity(
      (activityRows ?? []).map((row) => ({
        ...row,
        amount: row.amount === null ? null : Number(row.amount),
      })) as ShiftActivity[],
    );
    setWorkflow(workflowState);
    setCancellationRequests(cancellationState.requests);
    setCheckoutPaymentMethods(
      !paymentMethodsError && Array.isArray(paymentMethodRows)
        ? paymentMethodRows.filter(
            (method): method is CheckoutPaymentMethod =>
              Boolean(
                method &&
                  typeof method === "object" &&
                  typeof method.method_code === "string" &&
                  typeof method.display_name === "string" &&
                  typeof method.value === "string" &&
                  method.value.trim(),
              ),
          )
        : [],
    );
    return { orders: normalizedOrders, workflow: workflowState };
  }

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        await loadDashboard();
      } catch (loadError) {
        if (mounted)
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load cashier dashboard.",
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
    const refresh = () => {
      if (realtimeRefreshTimerRef.current !== null)
        window.clearTimeout(realtimeRefreshTimerRef.current);
      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        realtimeRefreshTimerRef.current = null;
        void loadDashboard().catch(() =>
          pushToast({
            type: "error",
            title: "Network sync failed",
            description: "Live updates could not refresh. Check the connection and try again.",
            dedupeKey: "cashier-realtime-refresh-failed",
          }),
        );
      }, 120);
    };
    const cashierTables = new Set(["orders", "order_invoices", "order_items", "order_cancellation_requests", "restaurant_tables", "cashier_shifts", "cash_reconciliations", "shift_activity_logs"]);
    const unsubscribe = getRestaurantEventStream(restaurantId).subscribe(
      (event) => { if (cashierTables.has(event.table)) refresh(); },
      (status) => { setRealtimeState(status); if (status === "connected" && dashboardHydratedRef.current) refresh(); },
    );
    return () => {
      if (realtimeRefreshTimerRef.current !== null)
        window.clearTimeout(realtimeRefreshTimerRef.current);
      realtimeRefreshTimerRef.current = null;
      unsubscribe();
    };
  }, [pushToast, restaurantId]);

  async function handleApprove(order: CashierOrder) {
    try {
      const diningSessionId = order.diningSessionId ?? order.id;
      const selectedMethod =
        collectionPaymentMethod.trim() || order.paymentMethod?.trim();
      if (!selectedMethod) {
        throw new Error("Select the payment method before verifying.");
      }
      setApprovingId(diningSessionId);
      setError(null);
      const { data, error: rpcError } = await supabase.rpc(
        "verify_dining_session_payment",
        {
          target_dining_session_id: diningSessionId,
          selected_payment_method: selectedMethod,
          payment_reference_number: paymentReference || null,
          payment_transaction_id: paymentTransactionId || null,
          payment_screenshot_url: order.screenshotUrl || null,
          owner_duplicate_override: ownerDuplicateOverride,
        },
      );
      if (rpcError) throw new Error(rpcError.message);
      const verification = (data ?? {}) as {
        table_released?: boolean;
        remaining_state?: string;
        remaining_active_item_count?: number;
        remaining_open_order_count?: number;
        remaining_unpaid_count?: number;
      };
      setOwnerDuplicateOverride(false);
      setDuplicateReferenceNotice(null);
      setPaymentNote("");
      pushToast({
        type: "success",
        title: "Payment verified",
        description: `${fmtInvoiceLabel(order)} · ${fmtMoney(order.totalPrice)}`,
        dedupeKey: `payment-verified:${diningSessionId}`,
      });
      pushToast({
        type: verification.table_released ? "success" : "information",
        title: verification.table_released
          ? "Service location released"
          : "Service location remains occupied",
        description: verification.table_released
          ? "Every payment and order item is complete."
          : verification.remaining_state === "active_items"
            ? `${verification.remaining_active_item_count ?? 0} active item(s) remain.`
            : verification.remaining_state === "other_open_order"
              ? `${verification.remaining_open_order_count ?? 0} other open order(s) remain.`
              : `${verification.remaining_unpaid_count ?? 0} unpaid batch(es) remain.`,
        dedupeKey: `service-location-state:${diningSessionId}:${verification.remaining_state ?? "unknown"}`,
      });
      const refreshed = await loadDashboard();
      const refreshedReceiptIds = new Set(
        refreshed.workflow?.receipt_pending_queue.map((entry) => entry.invoice_id) ?? [],
      );
      const refreshedOrder = refreshed.orders.find((candidate) =>
        candidate.invoiceId === order.invoiceId ||
        (candidate.diningSessionId ?? candidate.id) === diningSessionId,
      );
      if (
        refreshedOrder?.invoiceId &&
        refreshedReceiptIds.has(refreshedOrder.invoiceId)
      ) {
        setDrawerOrder(refreshedOrder);
      } else {
        window.setTimeout(() => {
          setDrawerOrder(null);
          setPaymentReference("");
          setPaymentTransactionId("");
          setPaymentScreenshotPreviewUrl(null);
        }, 1000);
      }
    } catch (approveError) {
      pushToast({
        type: "error",
        title: "Payment verification failed",
        description:
          approveError instanceof Error
            ? approveError.message
            : "Review the payment details and try again.",
      });
    } finally {
      setApprovingId(null);
    }
  }

  async function handleRejectPayment(order: CashierOrder) {
    try {
      const targetActionId = order.invoiceId ?? order.id;
      if (!order.invoiceId)
        throw new Error("Payment batch is missing for this order.");
      setApprovingId(targetActionId);
      setError(null);
      const { error: rpcError } = await supabase.rpc("reject_order_payment", {
        target_invoice_id: order.invoiceId,
        rejection_note: paymentNote || null,
      });
      if (rpcError) throw new Error(rpcError.message);
      setPaymentNote("");
      pushToast({
        type: "warning",
        title: "Payment rejected",
        description: fmtInvoiceLabel(order),
        dedupeKey: `payment-rejected:${order.invoiceId}`,
      });
      await loadDashboard();
    } catch (rejectError) {
      pushToast({
        type: "error",
        title: "Payment rejection failed",
        description:
          rejectError instanceof Error
            ? rejectError.message
            : "Review the payment and try again.",
      });
    } finally {
      setApprovingId(null);
    }
  }

  async function handleRequestRetry(order: CashierOrder) {
    try {
      const targetActionId = order.invoiceId ?? order.id;
      if (!order.invoiceId)
        throw new Error("Payment batch is missing for this order.");
      setApprovingId(targetActionId);
      setError(null);
      const { error: rpcError } = await supabase.rpc(
        "request_order_payment_retry",
        {
          target_invoice_id: order.invoiceId,
          retry_note: paymentNote || null,
        },
      );
      if (rpcError) throw new Error(rpcError.message);
      setPaymentNote("");
      pushToast({
        type: "information",
        title: "Payment retry requested",
        description: fmtInvoiceLabel(order),
        dedupeKey: `payment-retry:${order.invoiceId}`,
      });
      await loadDashboard();
    } catch (retryError) {
      pushToast({
        type: "error",
        title: "Payment retry failed",
        description:
          retryError instanceof Error
            ? retryError.message
            : "Try the request again.",
      });
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
      setError(
        shiftError instanceof Error
          ? shiftError.message
          : "Could not open shift.",
      );
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
      setError(
        shiftError instanceof Error
          ? shiftError.message
          : "Could not close shift.",
      );
    } finally {
      setWorkingShift(false);
    }
  }

  function addMenuItemToCart(item: CashierMenuItem) {
    if (!item.available) return;
    setCartItems((previous) => {
      const existing = previous.find(
        (cartItem) => cartItem.menuItemId === item.id,
      );
      if (existing) {
        return previous.map((cartItem) =>
          cartItem.menuItemId === item.id
            ? { ...cartItem, quantity: Math.min(99, cartItem.quantity + 1) }
            : cartItem,
        );
      }
      return [
        ...previous,
        {
          menuItemId: item.id,
          name: item.name,
          categoryName: item.categoryName,
          price: item.price,
          quantity: 1,
          notes: "",
        },
      ];
    });
  }

  function updateCartQuantity(menuItemId: string, quantity: number) {
    if (quantity < 1) {
      setCartItems((previous) =>
        previous.filter((item) => item.menuItemId !== menuItemId),
      );
      return;
    }
    setCartItems((previous) =>
      previous.map((item) =>
        item.menuItemId === menuItemId
          ? { ...item, quantity: Math.min(99, quantity) }
          : item,
      ),
    );
  }

  function updateCartNotes(menuItemId: string, notes: string) {
    setCartItems((previous) =>
      previous.map((item) =>
        item.menuItemId === menuItemId ? { ...item, notes } : item,
      ),
    );
  }

  async function submitPosOrder(mode: "append" | "create") {
    try {
      setSubmittingOrder(true);
      setError(null);
      let submittedOrderId = "";
      const payload = cartItems.map((item) => ({
        menu_item_id: item.menuItemId,
        quantity: item.quantity,
        notes: item.notes.trim() || null,
      }));

      if (mode === "append") {
        const activeOrder = orders.find(
          (order) =>
            order.tableNumber === selectedTable && isContinuableOrder(order),
        );
        if (!activeOrder)
          throw new Error("No active order found for this table.");
        const { data, error: rpcError } = await supabase.rpc(
          "append_items_to_order",
          {
            target_order_id: activeOrder.id,
            requested_items: payload,
          },
        );
        if (rpcError) throw new Error(rpcError.message);
        const updated = normalizeSubmittedOrder(data as CashierOrderPayload);
        submittedOrderId = updated.id;
        setOrders((previous) =>
          previous.map((order) =>
            order.id === activeOrder.id
              ? { ...order, ...updated, items: order.items }
              : order,
          ),
        );
      } else {
        const { data, error: rpcError } = await supabase.rpc(
          "create_cashier_order",
          {
            target_restaurant_id: restaurantId,
            table_number: selectedTable,
            selected_payment_method: selectedPaymentMethod,
            requested_items: payload,
          },
        );
        if (rpcError) throw new Error(rpcError.message);
        const created = normalizeSubmittedOrder(data as SubmittedCashierOrder);
        submittedOrderId = created.id;
        setOrders((previous) => [created, ...previous]);
      }

      pushToast({
        type: "success",
        title: mode === "append" ? "Order updated" : "Order created",
        description: compactTableCode(selectedTable) ?? "Direct order",
        dedupeKey: `${mode === "append" ? "order-updated" : "order-created"}:${submittedOrderId}`,
      });
      setCartItems([]);
      setSelectedTable("");
      setSelectedPaymentMethod(PAYMENT_METHODS[0]);
      setContinuationChoice(null);
      await loadDashboard();
    } catch (submitError) {
      pushToast({
        type: "error",
        title: "Order submission failed",
        description:
          submitError instanceof Error
            ? submitError.message
            : "Review the order and try again.",
      });
    } finally {
      setSubmittingOrder(false);
    }
  }

  function handleSubmitPosOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTable) {
      pushToast({
        type: "warning",
        title: "Table required",
        description: "Select a table before submitting the order.",
      });
      return;
    }
    if (cartItems.length === 0) {
      pushToast({
        type: "warning",
        title: "Order is empty",
        description: "Add at least one menu item before submitting the order.",
      });
      return;
    }
    const activeOrder = orders.find(
      (order) =>
        order.tableNumber === selectedTable && isContinuableOrder(order),
    );
    if (activeOrder) {
      setContinuationChoice({ tableNumber: selectedTable, activeOrder });
      return;
    }
    void submitPosOrder("create");
  }

  async function handleSignOut() {
    try {
      await signOutStaff();
    } finally {
      window.location.replace("/staff-login");
    }
  }

  async function handlePrintRequestedBill(session: DiningSessionSummary) {
    try {
      setBillWorkingSessionId(session.diningSessionId);
      setError(null);
      const billModel = buildFinalBillReviewModel(
        session,
        restaurant,
        cashierName || "Cashier",
        billFormat,
        "bill",
      );
      const { error: billStateError } = await supabase.rpc(
        "record_cashier_bill_action",
        {
          target_order_id: session.diningSessionId,
          requested_action: "print",
        },
      );
      if (billStateError) throw new Error(billStateError.message);
      printFinalBill(billModel);
      pushToast({
        type: "success",
        title: "Bill sent to printer",
        description: compactTableCode(session.tableNumber) ?? "Current order",
        dedupeKey: `bill-printed:${session.diningSessionId}`,
      });
      await loadDashboard();
      return true;
    } catch (billError) {
      pushToast({
        type: "error",
        title: "Bill printing failed",
        description: billError instanceof Error
          ? billError.message
          : "Check the printer connection and try again.",
      });
      return false;
    } finally {
      setBillWorkingSessionId(null);
    }
  }

  async function handlePrintFinalBill(session: DiningSessionSummary) {
    try {
      setBillWorkingSessionId(session.diningSessionId);
      setError(null);
      const { data, error: rpcError } = await supabase.rpc(
        "print_final_dining_bill",
        {
          target_dining_session_id: session.diningSessionId,
          target_format: billFormat,
        },
      );
      if (rpcError) throw new Error(rpcError.message);
      const billModel = normalizeFinalBillPayload(data);
      printFinalBill(billModel);
      const { error: receiptStateError } = await supabase.rpc(
        "mark_cashier_session_receipts_printed",
        {
          target_order_id: session.diningSessionId,
          is_reprint: billModel.bill.printCount > 1,
        },
      );
      if (receiptStateError) throw new Error(receiptStateError.message);
      pushToast({
        type: "success",
        title: "Receipt printed",
        description: `${billModel.bill.receiptNumber || billModel.bill.billNumber} · Copy ${billModel.bill.printCount}`,
        dedupeKey: `receipt-printed:${billModel.bill.id}:${billModel.bill.printCount}`,
      });
      await loadDashboard();
      return true;
    } catch (billError) {
      pushToast({
        type: "error",
        title: "Receipt printing failed",
        description:
          billError instanceof Error
            ? billError.message
            : "Check the printer connection and try again.",
      });
      return false;
    } finally {
      setBillWorkingSessionId(null);
    }
  }

  async function handleCloseDiningSessionFromBill(
    session: DiningSessionSummary,
  ) {
    if (
      !window.confirm(
        `Close the invoice for ${compactTableCode(session.tableNumber) ?? "this table"}? Receipt printing is optional. Confirm the table is ready for its next service.`,
      )
    )
      return;
    try {
      setClosingSessionId(session.diningSessionId);
      setError(null);
      const { error: rpcError } = await supabase.rpc("cashier_close_invoice_and_release_table", {
        target_order_id: session.diningSessionId,
        confirmed: true,
      });
      if (rpcError) throw new Error(rpcError.message);
      pushToast({
        type: "success",
        title: "Order completed",
        description: `${compactTableCode(session.tableNumber) ?? "Table"} · Invoice closed`,
        dedupeKey: `order-completed:${session.diningSessionId}`,
      });
      setDrawerOrder(null);
      await loadDashboard();
    } catch (closeError) {
      setError(
        closeError instanceof Error
          ? closeError.message
          : "Could not close dining session.",
      );
    } finally {
      setClosingSessionId(null);
    }
  }

  const pendingPayments = useMemo(
    () => orders.filter(isUnpaidPayment),
    [orders],
  );
  const activeOrders = useMemo(() => orders.filter(isActiveOrder), [orders]);
  const allDiningSessions = useMemo(
    () => buildDiningSessionSummaries(orders),
    [orders],
  );
  const awaitingCollection = useMemo(
    () => orders.filter(isAwaitingCollection),
    [orders],
  );
  const completedOrders = useMemo(
    () => orders.filter(isCompletedOrder),
    [orders],
  );
  const activeDiningSessions = useMemo(
    () => buildDiningSessionSummaries(activeOrders),
    [activeOrders],
  );
  const paymentDueSessions = useMemo(
    () => activeDiningSessions.filter((session) => session.pendingCount > 0),
    [activeDiningSessions],
  );
  const completedDiningSessions = useMemo(
    () => buildDiningSessionSummaries(completedOrders),
    [completedOrders],
  );
  const billRequestedInvoiceIds = useMemo(
    () => new Set((workflow?.bill_requested_queue ?? []).map((row) => row.invoice_id)),
    [workflow],
  );
  const receiptPendingInvoiceIds = useMemo(
    () => new Set((workflow?.receipt_pending_queue ?? []).map((row) => row.invoice_id)),
    [workflow],
  );
  const billRequestedSessions = useMemo(
    () => activeDiningSessions.filter((session) => session.batches.some((order) => order.invoiceId && billRequestedInvoiceIds.has(order.invoiceId))),
    [activeDiningSessions, billRequestedInvoiceIds],
  );
  const receiptPendingSessions = useMemo(
    () => activeDiningSessions.filter((session) => session.batches.some((order) => order.invoiceId && receiptPendingInvoiceIds.has(order.invoiceId))),
    [activeDiningSessions, receiptPendingInvoiceIds],
  );
  const openSessionOrders = useMemo(
    () => orders.filter(isContinuableOrder),
    [orders],
  );
  const cashCollectedToday = activeShift?.cash_collected ?? 0;
  const digitalCollectedToday = activeShift?.digital_collected ?? 0;
  const occupiedTableNumbers = useMemo(
    () =>
      new Set(
        openSessionOrders.map((order) => order.tableNumber).filter(Boolean),
      ),
    [openSessionOrders],
  );
  const awaitingPaymentTableNumbers = useMemo(
    () =>
      new Set(
        pendingPayments.map((order) => order.tableNumber).filter(Boolean),
      ),
    [pendingPayments],
  );
  const readyTableNumbers = useMemo(
    () =>
      new Set(
        awaitingCollection.map((order) => order.tableNumber).filter(Boolean),
      ),
    [awaitingCollection],
  );
  const billRequestedTableNumbers = useMemo(
    () =>
      new Set(
        billRequestedSessions
          .map((session) => session.tableNumber)
          .filter((tableNumber): tableNumber is string => Boolean(tableNumber)),
      ),
    [billRequestedSessions],
  );
  const receiptPendingTableNumbers = useMemo(
    () =>
      new Set(
        receiptPendingSessions
          .map((session) => session.tableNumber)
          .filter((tableNumber): tableNumber is string => Boolean(tableNumber)),
      ),
    [receiptPendingSessions],
  );
  const activeSessionByTable = useMemo(
    () =>
      new Map(
        activeDiningSessions
          .filter((session) => Boolean(session.tableNumber))
          .map((session) => [session.tableNumber as string, session]),
      ),
    [activeDiningSessions],
  );
  const serviceLocationCards = useMemo<ServiceLocationCardModel[]>(
    () => tables.map((table) => {
      const key = String(table.table_number);
      const session = activeSessionByTable.get(key);
      const status: ServiceLocationStatus = receiptPendingTableNumbers.has(key)
        ? "receipt-pending"
        : billRequestedTableNumbers.has(key)
          ? "bill-requested"
          : awaitingPaymentTableNumbers.has(key)
            ? "payment-due"
            : occupiedTableNumbers.has(key)
              ? "occupied"
              : "available";
      const paymentDueTotal = status === "payment-due" && session
        ? session.batches.reduce((sum, batch) => sum + batch.totalPrice, 0)
        : null;
      const supportingText = paymentDueTotal !== null
        ? formatCurrency(paymentDueTotal, restaurant)
        : status === "occupied" && session
          ? `${session.itemCount} ${session.itemCount === 1 ? "item" : "items"}`
          : null;

      return {
        id: table.id,
        key,
        tableNumber: table.table_number,
        name: formatServiceLocationName({
          label: table.label,
          tableNumber: table.table_number,
        }),
        status,
        supportingText,
      };
    }),
    [
      activeSessionByTable,
      awaitingPaymentTableNumbers,
      billRequestedTableNumbers,
      occupiedTableNumbers,
      receiptPendingTableNumbers,
      restaurant,
      tables,
    ],
  );
  const cartTotal = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cartItems],
  );
  const selectedTableActiveOrder = useMemo(
    () =>
      orders.find(
        (order) =>
          order.tableNumber === selectedTable && isContinuableOrder(order),
      ) ?? null,
    [orders, selectedTable],
  );
  const filteredMenuItems = useMemo(() => {
    const search = menuSearch.trim().toLowerCase();
    return menuItems.filter((item) => {
      const matchesCategory =
        selectedCategory === ALL_CATEGORIES ||
        item.category_id === selectedCategory;
      const matchesSearch =
        !search ||
        item.name.toLowerCase().includes(search) ||
        item.categoryName.toLowerCase().includes(search) ||
        (item.description ?? "").toLowerCase().includes(search);
      return matchesCategory && matchesSearch;
    });
  }, [menuItems, menuSearch, selectedCategory]);
  const availableTables = Math.max(
    0,
    tables.length - occupiedTableNumbers.size,
  );
  const drawerDiningSession = drawerOrder
    ? allDiningSessions.find(
        (session) =>
          session.diningSessionId ===
          (drawerOrder.diningSessionId ?? drawerOrder.id),
      ) ?? null
    : null;
  const drawerConfiguredLocation = drawerOrder
    ? tables.find((table) => String(table.table_number) === drawerOrder.tableNumber) ?? null
    : null;
  const drawerServiceLocationName = drawerOrder
    ? drawerConfiguredLocation
      ? formatServiceLocationName({
          label: drawerConfiguredLocation.label,
          tableNumber: drawerConfiguredLocation.table_number,
        })
      : checkoutServiceLocationLabel(drawerOrder)
    : "Service Location";
  const drawerCheckoutStatus = drawerOrder
    ? resolveCheckoutWorkspaceStatus(
        drawerOrder,
        billRequestedInvoiceIds,
        receiptPendingInvoiceIds,
      )
    : null;
  const visibleQueueTab: OperationalQueueTab =
    queueTab === "paid" ? "completed" : queueTab;
  const operationalQueueView = useMemo(() => {
    const query = workspaceSearch.trim().toLowerCase();
    return buildOperationalQueueView(
      {
        pending: paymentDueSessions,
        preparing: billRequestedSessions,
        ready: receiptPendingSessions,
        completed: completedDiningSessions,
      },
      {
        matches: (session) =>
          !query ||
          session.batches.some((batch) =>
            [
              batch.tableNumber,
              batch.customerName,
              batch.customerPhone,
              batch.waiterName,
              batch.invoiceDisplayNumber,
              batch.displayNumber,
              batch.invoiceNumber?.toString(),
            ].some((candidate) => candidate?.toLowerCase().includes(query)),
          ),
        compare: compareDiningSessionsNewestFirst,
      },
    );
  }, [
    billRequestedSessions,
    completedDiningSessions,
    paymentDueSessions,
    receiptPendingSessions,
    workspaceSearch,
  ]);
  const operationalQueue = operationalQueueView.rows[visibleQueueTab];
  const currentQueue = QUEUE_PRESENTATION[visibleQueueTab];
  const expectedCash = activeShift?.expected_cash ?? 0;
  const actualCashNumber = Number(actualCash || 0);
  const variance = actualCash === "" ? 0 : actualCashNumber - expectedCash;
  const needsVarianceReason = variance !== 0;
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  function openTable(tableNumber: number) {
    setSelectedTable(String(tableNumber));
    const session = activeDiningSessions.find(
      (candidate) => candidate.tableNumber === String(tableNumber),
    );
    if (!session) return;
    const actionableOrder = session.pendingCount > 0
      ? paymentDueOrder(session)
      : session.batches.find((batch) =>
          batch.invoiceId &&
          (billRequestedInvoiceIds.has(batch.invoiceId) ||
            receiptPendingInvoiceIds.has(batch.invoiceId)),
        ) ?? session.batches[0] ?? null;
    if (actionableOrder) openCheckoutDrawer(actionableOrder);
  }

  function handleWorkspaceSearch(value: string) {
    setWorkspaceSearch(value);
    const query = value.trim().toLowerCase();
    if (!query) return;
    const exactTable = activeDiningSessions.find(
      (session) => session.tableNumber?.toLowerCase() === query,
    );
    const match = exactTable?.batches[0] ?? orders.find((order) =>
      [order.tableNumber, order.customerName, order.customerPhone, order.invoiceDisplayNumber,
        order.displayNumber, order.invoiceNumber?.toString()]
        .some((candidate) => candidate?.toLowerCase().includes(query)),
    );
    if (match) openCheckoutDrawer(match);
  }

  function handleQueueTabKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentTab: OperationalQueueTab,
  ) {
    const currentIndex = OPERATIONAL_QUEUE_TABS.indexOf(currentTab);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % OPERATIONAL_QUEUE_TABS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + OPERATIONAL_QUEUE_TABS.length) %
        OPERATIONAL_QUEUE_TABS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = OPERATIONAL_QUEUE_TABS.length - 1;
    }
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = OPERATIONAL_QUEUE_TABS[nextIndex];
    setQueueTab(nextTab);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-queue-tab="${nextTab}"]`)
      ?.focus();
  }

  async function handleCancellationAction(
    request: CashierCancellationRequest,
    action: "direct_cancel" | "send_to_manager",
  ) {
    try {
      setCancellationWorkingId(request.id);
      setCancellationRequestsError(null);
      const result = await handleCashierCancellationRequest(request.id, action);
      setCancellationConfirmation(null);
      setCancellationRequests((current) => current.filter((entry) => entry.id !== request.id));
      pushToast({
        type: action === "direct_cancel" ? "success" : "information",
        title: action === "direct_cancel" ? "Cancellation completed" : "Sent to Manager",
        description: action === "direct_cancel"
          ? `${cancellationItemsLabel(request)} was cancelled. No refund or table release was created.`
          : `The request from ${request.requestedByName} is preserved for Manager review.`,
        dedupeKey: `cashier-cancellation-result:${request.id}:${result.status}`,
      });
      await loadDashboard();
    } catch (actionError) {
      const message = actionError instanceof Error
        ? actionError.message
        : "Cancellation request could not be handled.";
      pushToast({
        type: "error",
        title: "Cancellation state changed",
        description: message,
        dedupeKey: `cashier-cancellation-error:${request.id}:${message}`,
      });
      await loadDashboard().catch(() => setCancellationRequestsError(message));
    } finally {
      setCancellationWorkingId(null);
    }
  }

  const visibleCashierActivity = activity
    .filter((entry) => [
      "payment_submitted", "payment_verified", "receipt_printed", "invoice_closed",
      "customer_assistance", "manager_message", "waiter_request",
    ].some((allowed) => entry.action === allowed || entry.action.includes(allowed)))
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .slice(0, 5);
  const pendingCancellationCount = cancellationRequests.length;

  return (
    <div className="cd-root">
      <CashierTopBar
        restaurantName={restaurant.name}
        cashierName={cashierName || "Cashier"}
        shiftActive={Boolean(activeShift)}
        shiftDuration={activeShift ? durationFrom(activeShift.opened_at, now) : "00:00"}
        date={dateStr}
        time={timeStr}
        hasNotification={toasts.length > 0}
        reconnecting={realtimeState !== "connected"}
        onNotifications={() =>
          document
            .querySelector<HTMLElement>(".cd-toast:not(.exiting)")
            ?.focus()
        }
        onShiftAction={() => activeShift ? setReconcileOpen(true) : setOpenShiftModal(true)}
        onSignOut={handleSignOut}
        searchValue={workspaceSearch}
        onSearchChange={handleWorkspaceSearch}
      />
      <CashierToastViewport toasts={toasts} controller={toastController} />
      {cancellationRequestsOpen ? (
        <div
          className="cd-cancellation-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !cancellationConfirmation)
              closeCancellationRequests();
          }}
        >
          <section
            className="cd-cancellation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cd-cancellation-title"
          >
            <header className="cd-cancellation-modal-header">
              <div>
                <span>Cashier review queue</span>
                <h2 id="cd-cancellation-title">Cancellation Requests</h2>
                <p><strong>{pendingCancellationCount} Pending</strong></p>
              </div>
              <button
                className="cd-cancellation-modal-close"
                type="button"
                aria-label="Close cancellation requests"
                onClick={closeCancellationRequests}
                disabled={Boolean(cancellationWorkingId)}
              >
                ×
              </button>
            </header>
            <div className="cd-cancellation-scroll">
              {cancellationRequestsError ? (
                <div className="cd-cancellation-state error" role="alert">
                  Cancellation requests could not be loaded. The dashboard remains available.
                </div>
              ) : cancellationRequests.length === 0 ? (
                <div className="cd-cancellation-state">
                  <CashierIcon name="completed" />
                  <strong>No cancellation requests</strong>
                  <span>New requests from staff will appear here.</span>
                </div>
              ) : (
                <table className="cd-cancellation-table">
                  <thead>
                    <tr>
                      <th>Table</th>
                      <th>Requester</th>
                      <th>Item(s)</th>
                      <th>Reason</th>
                      <th>Payment</th>
                      <th>Kitchen</th>
                      <th>Amount</th>
                      <th>Waiting</th>
                      <th>Authority / Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cancellationRequests.map((request) => {
                      const direct = request.authority === "cashier_direct";
                      const financial = request.authority === "financial_approval_required";
                      const actionable = request.authority !== "not_actionable";
                      const working = cancellationWorkingId === request.id;
                      const itemLabel = cancellationItemsLabel(request);
                      return (
                      <tr key={request.id}>
                        <td><strong>{compactTableCode(request.tableNumber)}</strong></td>
                        <td className="cd-cancellation-requester"><span>Waiter</span><strong>{request.requestedByName}</strong></td>
                        <td className="cd-cancellation-items" title={itemLabel}><strong>{itemLabel}</strong></td>
                        <td className="cd-cancellation-reason" title={request.note || request.reason}>{request.reason}</td>
                        <td><span className={`cd-cancellation-status payment ${canonicalPaymentStatus(request.paymentStatus)}`}>{cancellationStatusLabel(request.paymentStatus, "payment")}</span></td>
                        <td><span className={`cd-cancellation-status kitchen ${direct ? "safe" : "attention"}`}>{cancellationStatusLabel(request.kitchenStatus, "kitchen")}</span></td>
                        <td><strong>{fmtMoney(request.affectedAmount)}</strong></td>
                        <td>{durationFrom(request.requestedAt, now)}</td>
                        <td>
                          {direct ? (
                            <div className="cd-cancellation-approval safe">
                              <span>Cashier Can Cancel</span>
                            <button
                              className="cd-cancellation-action direct"
                              type="button"
                              disabled={working}
                              onClick={() => setCancellationConfirmation(request)}
                            >
                              {working ? "Checking…" : "Cancel Directly"}
                            </button>
                            </div>
                          ) : (
                            <div className={`cd-cancellation-approval ${financial ? "financial" : "manager"}`}>
                              <span>{financial ? "Financial Approval Required" : "Manager Approval Required"}</span>
                              <button
                                className="cd-cancellation-action manager"
                                type="button"
                                disabled={!actionable || working}
                                onClick={() => void handleCancellationAction(request, "send_to_manager")}
                              >
                                {working ? "Sending…" : "Send to Manager"}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              )}
            </div>
          </section>
          {cancellationConfirmation ? (
            <div className="cd-cancellation-confirm-overlay" role="presentation">
              <section
                className="cd-cancellation-confirm"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="cd-cancellation-confirm-title"
              >
                <header>
                  <div>
                    <span>Server eligibility will be checked again</span>
                    <h3 id="cd-cancellation-confirm-title">Confirm Cancellation</h3>
                  </div>
                  <button
                    type="button"
                    aria-label="Close confirmation"
                    disabled={Boolean(cancellationWorkingId)}
                    onClick={() => setCancellationConfirmation(null)}
                  >×</button>
                </header>
                <dl>
                  <div><dt>Table</dt><dd>{compactTableCode(cancellationConfirmation.tableNumber)}</dd></div>
                  <div><dt>Order</dt><dd>#{cancellationConfirmation.orderNumber}</dd></div>
                  <div><dt>Requested by</dt><dd>Waiter {cancellationConfirmation.requestedByName}</dd></div>
                  <div><dt>Item</dt><dd>{cancellationItemsLabel(cancellationConfirmation)}</dd></div>
                  <div><dt>Reason</dt><dd>{cancellationConfirmation.note || cancellationConfirmation.reason}</dd></div>
                  <div><dt>Payment</dt><dd>{cancellationStatusLabel(cancellationConfirmation.paymentStatus, "payment")}</dd></div>
                  <div><dt>Kitchen</dt><dd>{cancellationStatusLabel(cancellationConfirmation.kitchenStatus, "kitchen")}</dd></div>
                  <div><dt>Affected Amount</dt><dd>{fmtMoney(cancellationConfirmation.affectedAmount)}</dd></div>
                </dl>
                <footer>
                  <button
                    type="button"
                    disabled={Boolean(cancellationWorkingId)}
                    onClick={() => setCancellationConfirmation(null)}
                  >Keep Request</button>
                  <button
                    className="destructive"
                    type="button"
                    disabled={Boolean(cancellationWorkingId)}
                    onClick={() => void handleCancellationAction(cancellationConfirmation, "direct_cancel")}
                  >{cancellationWorkingId ? "Checking current state…" : "Confirm Cancellation"}</button>
                </footer>
              </section>
            </div>
          ) : null}
        </div>
      ) : null}
      <aside className="cd-pos-nav" aria-label="Cashier navigation">
        <nav className="cd-pos-nav-primary">
          <button className="active" type="button" onClick={() => setPosEntryOpen(true)}><CashierIcon name="order" /><span><strong>New Order</strong></span></button>
          <button type="button" aria-haspopup="dialog" aria-expanded={cancellationRequestsOpen} onClick={openCancellationRequests}><CashierIcon name="cancel" /><span><strong>Cancellation Requests</strong></span>{pendingCancellationCount > 0 ? <b className="cd-nav-badge">{pendingCancellationCount}</b> : null}</button>
        </nav>
        <section className={`cd-nav-activity${activityCollapsed ? " collapsed" : ""}`}>
          <button className="cd-nav-section-toggle" type="button" aria-expanded={!activityCollapsed} onClick={() => setActivityCollapsed((current) => !current)}><span>Live Activity</span><b>{activityCollapsed ? "+" : "−"}</b></button>
          {!activityCollapsed ? <div className="cd-nav-activity-list">
            {visibleCashierActivity.length === 0 ? <p>No recent cashier activity</p> : visibleCashierActivity.map((entry) => (
              <article key={entry.id}><i className={`cd-activity-dot ${entry.action}`} /><div><strong>{entry.message}</strong><span>{timeAgo(entry.created_at)}</span></div></article>
            ))}
          </div> : null}
        </section>
      </aside>
      <main className="cd-body">
        {error ? (
          <section className="cd-persistent-alerts" aria-label="Operational alerts">
            <div className="cd-persistent-alert" role="alert">
              <CashierIcon name="cancel" />
              <span><strong>Action required</strong><span>{error}</span></span>
              <button type="button" aria-label="Dismiss operational alert" onClick={() => setError(null)}>×</button>
            </div>
          </section>
        ) : null}

        {loading ? (
          <div className="cd-kpi-grid">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="cd-skeleton cd-skeleton-kpi" />
            ))}
          </div>
        ) : (
          <>
            <section
              className={`cd-shift-hero ${activeShift ? "active" : "closed"}`}
            >
              <div>
                <div className="cd-shift-eyebrow">
                  {activeShift ? "Active Shift" : "Shift Not Started"}
                </div>
                <h1>
                  {activeShift
                    ? `Shift Duration: ${durationFrom(activeShift.opened_at, now)}`
                    : "Ready to serve?"}
                </h1>
                <p>
                  {activeShift
                    ? `Started ${fmtDateTime(activeShift.opened_at)} · ${cashierName || "Cashier"}`
                    : "Open a shift and confirm the opening cash drawer amount to begin processing orders."}
                </p>
              </div>
              {activeShift ? (
                <>
                  <div className="cd-shift-hero-stat">
                    <span>Opening Cash</span>
                    <strong>{fmtMoney(activeShift.opening_cash)}</strong>
                  </div>
                  <div className="cd-shift-hero-stat primary">
                    <span>Current Drawer</span>
                    <strong>{fmtMoney(activeShift.expected_cash)}</strong>
                  </div>
                  <div className="cd-shift-hero-stat">
                    <span>Cash Collected</span>
                    <strong>{fmtMoney(activeShift.cash_collected)}</strong>
                  </div>
                  <div className="cd-shift-hero-stat">
                    <span>Digital Collected</span>
                    <strong>{fmtMoney(activeShift.digital_collected)}</strong>
                  </div>
                  <button
                    className="cd-close-shift-btn"
                    onClick={() => setReconcileOpen(true)}
                  >
                    Close Shift
                  </button>
                </>
              ) : (
                <button
                  className="cd-close-shift-btn"
                  onClick={() => setOpenShiftModal(true)}
                >
                  Open Shift
                </button>
              )}
            </section>

            <section className="cd-kpi-grid" aria-label="Operational summary">
              <CashierMetricCard
                label="Active Orders"
                value={`${activeDiningSessions.length}`}
                detail="Open now"
                tone="info"
              />
              <CashierMetricCard
                label="Awaiting Collection"
                value={`${awaitingCollection.length}`}
                detail="Needs collection"
                tone="warning"
              />
              <CashierMetricCard
                label="Cash Collected"
                value={fmtMoney(cashCollectedToday)}
                detail="Current shift"
              />
              <CashierMetricCard
                label="Digital Collected"
                value={fmtMoney(digitalCollectedToday)}
                detail="Current shift"
              />
              <CashierMetricCard
                label="Total Collected"
                value={fmtMoney(cashCollectedToday + digitalCollectedToday)}
                detail="Cash + digital"
                tone="success"
              />
            </section>

            <section className="cd-main-grid">
              <div className="cd-card">
                <div className="cd-card-header">
                  <div className="cd-tabs" role="tablist" aria-label="Order queue status">
                    {([
                      ["pending", "due", "Payment Due", operationalQueueView.counts.pending],
                      ["preparing", "bill", "Bill Requested", operationalQueueView.counts.preparing],
                      ["ready", "print", "Receipt Pending", operationalQueueView.counts.ready],
                      ["completed", "completed", "Completed", operationalQueueView.counts.completed],
                    ] as const).map(([tab, icon, label, count]) => (
                      <button
                        key={tab}
                        id={`cashier-queue-tab-${tab}`}
                        type="button"
                        role="tab"
                        data-queue-tab={tab}
                        aria-selected={visibleQueueTab === tab}
                        aria-controls="cashier-operational-queue"
                        tabIndex={visibleQueueTab === tab ? 0 : -1}
                        className={`cd-tab queue-${tab}${visibleQueueTab === tab ? " active" : ""}`}
                        onClick={() => setQueueTab(tab)}
                        onKeyDown={(event) => handleQueueTabKeyDown(event, tab)}
                      >
                        <CashierIcon name={icon} />
                        <span className="cd-tab-label">{label}</span>
                        <span
                          className="cd-tab-badge"
                          aria-label={`${count} ${label.toLowerCase()} ${count === 1 ? "order" : "orders"}`}
                        >
                          {count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="cd-order-list">
                  <div
                    id="cashier-operational-queue"
                    className="cd-operational-rows"
                    role="tabpanel"
                    aria-labelledby={`cashier-queue-tab-${visibleQueueTab}`}
                  >
                    {operationalQueue.length === 0 ? (
                      <div className={`cd-queue-empty queue-${visibleQueueTab}`} role="status">
                        <CashierIcon name={currentQueue.icon} />
                        <strong>{currentQueue.empty}</strong>
                      </div>
                    ) : operationalQueue.map((session) => {
                      const order = visibleQueueTab === "pending" ? paymentDueOrder(session) : session.batches[0];
                      if (!order) return null;
                      const total = session.batches.reduce((sum, batch) => sum + batch.totalPrice, 0);
                      const minutesWaiting = Math.max(0, Math.floor((now.getTime() - new Date(session.createdAt).getTime()) / 60000));
                      const allItems = session.batches.flatMap((batch) => batch.items);
                      const itemSummary = summarizeOperationalItems(allItems);
                      const itemCountLabel = `${itemSummary.totalQuantity} ${itemSummary.totalQuantity === 1 ? "item" : "items"}`;
                      const fullItemLabel = itemSummary.fullSummary || "No item details";
                      const workflowQueue = visibleQueueTab === "pending"
                        ? workflow?.payment_submitted_queue
                        : visibleQueueTab === "preparing"
                          ? workflow?.bill_requested_queue
                          : visibleQueueTab === "ready"
                            ? workflow?.receipt_pending_queue
                            : null;
                      const queueWorkflowEntry = workflowQueue?.find((entry) =>
                        session.batches.some((batch) => batch.invoiceId === entry.invoice_id),
                      );
                      const method = order.paymentMethod?.trim() || queueWorkflowEntry?.payment_method?.trim() || "Not Selected";
                      const billRequestedAt = asRecord(queueWorkflowEntry).bill_requested_at;
                      const requestedAt = typeof billRequestedAt === "string" ? billRequestedAt : null;
                      const paidAt = order.invoicePaidAt ?? order.paymentVerifiedAt ?? queueWorkflowEntry?.submitted_at ?? null;
                      const paymentVerified = order.invoiceStatus === "paid" || Boolean(order.invoicePaidAt || order.paymentVerifiedAt);
                      const source = checkoutOrderSource(order);
                      const paymentState = visibleQueueTab === "preparing"
                        ? "Bill Requested"
                        : visibleQueueTab === "pending" && source.label === "Waiter" && !paymentVerified
                          ? "Payment Due"
                          : method !== "Not Selected"
                          ? method
                          : paymentVerified || visibleQueueTab === "ready" || visibleQueueTab === "completed"
                            ? "Paid"
                            : "Payment Due";
                      const sourceText = source.name ? `${source.label} • ${source.name}` : source.label;
                      const elapsedFrom = visibleQueueTab === "pending"
                        ? session.createdAt
                        : visibleQueueTab === "preparing"
                          ? requestedAt ?? session.createdAt
                          : visibleQueueTab === "ready"
                            ? paidAt ?? session.latestAt
                            : order.paymentVerifiedAt ?? session.latestAt;
                      const isSelected = drawerOrder?.diningSessionId === session.diningSessionId;
                      const isUrgent = visibleQueueTab === "pending" && minutesWaiting > 5;
                      const openOrder = () => {
                        openCheckoutDrawer(order);
                      };
                      const paymentMethod = (
                        <span
                          className={`cd-row-payment-value ${paymentState.toLowerCase().replace(/\s+/g, "-")}`}
                          title={paymentState}
                          aria-label={`Payment: ${paymentState}`}
                        >
                          {paymentState}
                        </span>
                      );
                      const action = (
                        <button
                          type="button"
                          className={`cd-row-action${visibleQueueTab === "completed" ? " secondary" : ""}`}
                          onClick={(event) => { event.stopPropagation(); openOrder(); }}
                        >
                          {currentQueue.action}
                        </button>
                      );
                      const itemDetails = (
                        <div
                          className="cd-row-items"
                          role="group"
                          title={`${itemCountLabel}: ${fullItemLabel}`}
                          aria-label={`${itemCountLabel}. ${fullItemLabel}`}
                        >
                          <div className="cd-row-items-detail" aria-hidden="true">
                            <span className="cd-row-items-preview">
                              {itemSummary.previewText || "No item details"}
                            </span>
                            {itemSummary.hiddenDistinctCount > 0 ? (
                              <span className="cd-row-items-more">
                                • +{itemSummary.hiddenDistinctCount} more
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                      const location = (
                        <div className="cd-row-location" title={`${orderTableCode(order)} • ${fmtInvoiceLabel(order)}`}>
                          <strong>{orderTableCode(order)}</strong>
                        </div>
                      );
                      const time = (
                        <div className={`cd-row-wait ${minutesWaiting > 10 ? "critical" : minutesWaiting > 5 ? "warning" : "fresh"}`}>
                          <strong>{compactElapsedLabel(elapsedFrom, now)}</strong>
                        </div>
                      );
                      return (
                        <article
                          key={session.diningSessionId}
                          className={`cd-operational-row queue-${visibleQueueTab}${isUrgent ? " urgent" : ""}${isSelected ? " selected" : ""}`}
                          onClick={openOrder}
                        >
                          {location}
                          <div className="cd-row-source" title={sourceText}><span>{sourceText}</span></div>
                          {itemDetails}
                          <div className="cd-row-method">{paymentMethod}</div>
                          <div className="cd-row-amount"><strong>{fmtMoney(total)}</strong></div>
                          {time}
                          {action}
                        </article>
                      );
                    })}
                  </div>
                </div>
              </div>

              <aside className="cd-side-stack">
                <div className="cd-card cd-quick-actions-card">
                  <div className="cd-card-header">
                    <div>
                      <div className="cd-card-title">Quick Actions</div>
                      <div className="cd-card-subtitle">One tap to the next task</div>
                    </div>
                  </div>
                  <div className="cd-quick-actions">
                    <button className="primary" type="button" onClick={() => setPosEntryOpen(true)}>＋ New Order</button>
                    <button type="button" onClick={() => setPosEntryOpen(true)}>▦ Scan QR</button>
                    <button type="button" onClick={() => setQueueTab("pending")}>⌕ Search Order</button>
                    <button type="button" onClick={() => setQueueTab("ready")}>▤ Reprint Receipt</button>
                    <button type="button" onClick={() => setQueueTab("paid")}>↩ Refund</button>
                    <button className="danger" type="button" onClick={() => activeShift ? setReconcileOpen(true) : setOpenShiftModal(true)}>{activeShift ? "Close Shift" : "Open Shift"}</button>
                  </div>
                </div>
                <div className="cd-card">
                  <div className="cd-card-header">
                    <div>
                      <div className="cd-card-title">Table Management</div>
                      <div className="cd-card-subtitle">
                        {availableTables} available ·{" "}
                        {occupiedTableNumbers.size} occupied ·{" "}
                        {awaitingPaymentTableNumbers.size} payment due
                      </div>
                    </div>
                  </div>
                  <div className="cd-table-grid">
                    {tables.map((table) => {
                      const key = String(table.table_number);
                      const awaitingPayment =
                        awaitingPaymentTableNumbers.has(key);
                      const ready = readyTableNumbers.has(key);
                      const occupied = occupiedTableNumbers.has(key);
                      return (
                        <button
                          type="button"
                          key={table.id}
                          className={`cd-table-cell ${awaitingPayment ? "pay" : ready ? "ready" : occupied ? "occupied" : "available"}`}
                          onClick={() => openTable(table.table_number)}
                          aria-label={`${compactTableCode(table.table_number)}: ${awaitingPayment ? "payment due" : ready ? "ready" : occupied ? "occupied" : "available"}`}
                        >
                          <strong>{table.table_number}</strong>
                          <span>{awaitingPayment ? "Payment Due" : ready ? "Ready" : occupied ? "Occupied" : "Available"}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="cd-card">
                  <div className="cd-card-header">
                    <div>
                      <div className="cd-card-title">Live Activity</div>
                      <div className="cd-card-subtitle">Newest first</div>
                    </div>
                  </div>
                  <div className="cd-activity-list">
                    {activity.length === 0 ? (
                      <div className="cd-empty compact">
                        <div className="cd-empty-title">No activity yet</div>
                      </div>
                    ) : (
                      activity.slice(0, 10).map((entry) => (
                        <div key={entry.id} className="cd-activity-item">
                          <div className={`cd-activity-dot ${entry.action}`} />
                          <div className="cd-activity-content">
                            <div className="cd-activity-main">
                              {entry.message}
                            </div>
                            <div className="cd-activity-sub">
                              {fmtTime(entry.created_at)}
                            </div>
                          </div>
                          {entry.amount !== null && (
                            <div className="cd-activity-amount">
                              {fmtMoney(Number(entry.amount))}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="cd-card">
                  <div className="cd-card-header">
                    <div>
                      <div className="cd-card-title">Cashier Summary</div>
                      <div className="cd-card-subtitle">
                        {cashierName || "Cashier"}
                      </div>
                    </div>
                  </div>
                  <div className="cd-shift-grid">
                    <div className="cd-shift-stat">
                      <div className="cd-shift-stat-label">
                        Orders Processed
                      </div>
                      <div className="cd-shift-stat-value">
                        {activeShift?.orders_processed ?? 0}
                      </div>
                    </div>
                    <div className="cd-shift-stat">
                      <div className="cd-shift-stat-label">
                        Payments Processed
                      </div>
                      <div className="cd-shift-stat-value">
                        {activeShift?.payments_processed ?? 0}
                      </div>
                    </div>
                    <div className="cd-shift-stat">
                      <div className="cd-shift-stat-label">Expected Drawer</div>
                      <div className="cd-shift-stat-value">
                        {fmtMoney(activeShift?.expected_cash ?? 0)}
                      </div>
                    </div>
                    <div className="cd-shift-stat">
                      <div className="cd-shift-stat-label">Shift Duration</div>
                      <div className="cd-shift-stat-value">
                        {activeShift
                          ? durationFrom(activeShift.opened_at, now)
                          : "0m"}
                      </div>
                    </div>
                  </div>
                </div>
              </aside>
            </section>

            {posEntryOpen ? (
              <button
                type="button"
                className="cd-pos-backdrop"
                aria-label="Close order entry"
                onClick={() => setPosEntryOpen(false)}
              />
            ) : null}
            <section
              className={`cd-pos-panel${posEntryOpen ? " open" : ""}`}
              id="cashier-pos-entry"
              aria-hidden={!posEntryOpen}
            >
              <form className="cd-pos-form" onSubmit={handleSubmitPosOrder}>
                <div className="cd-card-header">
                  <div>
                    <div className="cd-card-title">POS Order Entry</div>
                    <div className="cd-card-subtitle">
                      Create cashier orders or add items to active table orders.
                    </div>
                  </div>
                  <button
                    className="cd-approve-btn"
                    type="submit"
                    disabled={
                      submittingOrder ||
                      cartItems.length === 0 ||
                      !selectedTable
                    }
                  >
                    {submittingOrder
                      ? "Submitting..."
                      : selectedTableActiveOrder
                        ? "Add to Order"
                        : "Submit Order"}
                  </button>
                  <button
                    className="cd-pos-close"
                    type="button"
                    aria-label="Close order entry"
                    onClick={() => setPosEntryOpen(false)}
                  >
                    ×
                  </button>
                </div>

                <div className="cd-pos-layout">
                  <div className="cd-pos-menu">
                    <div className="cd-pos-controls">
                      <label className="cd-pos-field">
                        <span>Table</span>
                        <select
                          value={selectedTable}
                          onChange={(event) =>
                            setSelectedTable(event.target.value)
                          }
                        >
                          <option value="">Select table</option>
                          {tables.map((table) => (
                            <option
                              key={table.id}
                              value={String(table.table_number)}
                            >
                              {compactTableCode(table.table_number)}
                              {occupiedTableNumbers.has(
                                String(table.table_number),
                              )
                                ? " - occupied"
                                : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="cd-pos-field">
                        <span>Payment</span>
                        <select
                          value={selectedPaymentMethod}
                          onChange={(event) =>
                            setSelectedPaymentMethod(event.target.value)
                          }
                        >
                          {PAYMENT_METHODS.map((method) => (
                            <option key={method} value={method}>
                              {method}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="cd-pos-field wide">
                        <span>Search Menu</span>
                        <input
                          value={menuSearch}
                          onChange={(event) =>
                            setMenuSearch(event.target.value)
                          }
                          placeholder="Search items or categories"
                        />
                      </label>
                    </div>

                    {selectedTableActiveOrder && (
                      <div className="cd-pos-active-note">
                        Active order {fmtOrderLabel(selectedTableActiveOrder)}{" "}
                        found for {compactTableCode(selectedTable)}. Submitting will ask
                        whether to add to it or create a new order.
                      </div>
                    )}

                    <div className="cd-category-strip">
                      <button
                        type="button"
                        className={`cd-category-chip${selectedCategory === ALL_CATEGORIES ? " active" : ""}`}
                        onClick={() => setSelectedCategory(ALL_CATEGORIES)}
                      >
                        All
                      </button>
                      {categories.map((category) => (
                        <button
                          key={category.id}
                          type="button"
                          className={`cd-category-chip${selectedCategory === category.id ? " active" : ""}`}
                          onClick={() => setSelectedCategory(category.id)}
                        >
                          {category.name}
                        </button>
                      ))}
                    </div>

                    <div className="cd-menu-grid">
                      {filteredMenuItems.length === 0 ? (
                        <div className="cd-empty compact">
                          <div className="cd-empty-title">
                            No menu items found
                          </div>
                        </div>
                      ) : (
                        filteredMenuItems.map((item) => (
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
                                <span className="cd-menu-item-category">
                                  {item.categoryName}
                                </span>
                                <span
                                  className={`cd-menu-item-availability ${item.available ? "available" : "unavailable"}`}
                                >
                                  {item.available ? "Available" : "Unavailable"}
                                </span>
                              </span>
                              <span className="cd-menu-item-name">
                                {item.name}
                              </span>
                              {item.description ? (
                                <span className="cd-menu-item-description">
                                  {item.description}
                                </span>
                              ) : null}
                              <strong>{fmtMoney(item.price)}</strong>
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>

                  <aside className="cd-pos-cart">
                    <div className="cd-pos-cart-header">
                      <div>
                        <div className="cd-card-title">Current Ticket</div>
                        <div className="cd-card-subtitle">
                          {cartItems.length} unique item(s)
                        </div>
                      </div>
                      {cartItems.length > 0 && (
                        <button
                          className="cd-view-btn"
                          type="button"
                          onClick={() => setCartItems([])}
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    <div className="cd-cart-list">
                      {cartItems.length === 0 ? (
                        <div className="cd-empty compact">
                          <div className="cd-empty-title">Cart is empty</div>
                          <div className="cd-empty-sub">
                            Select menu items to begin.
                          </div>
                        </div>
                      ) : (
                        cartItems.map((item) => (
                          <div key={item.menuItemId} className="cd-cart-item">
                            <div className="cd-cart-item-top">
                              <div>
                                <div className="cd-cart-item-name">
                                  {item.name}
                                </div>
                                <div className="cd-cart-item-meta">
                                  {fmtMoney(item.price)} each
                                </div>
                              </div>
                              <button
                                type="button"
                                className="cd-cart-remove"
                                onClick={() =>
                                  updateCartQuantity(item.menuItemId, 0)
                                }
                                aria-label={`Remove ${item.name}`}
                              >
                                x
                              </button>
                            </div>
                            <div className="cd-cart-qty-row">
                              <button
                                type="button"
                                onClick={() =>
                                  updateCartQuantity(
                                    item.menuItemId,
                                    item.quantity - 1,
                                  )
                                }
                              >
                                -
                              </button>
                              <input
                                type="number"
                                min="1"
                                max="99"
                                value={item.quantity}
                                onChange={(event) =>
                                  updateCartQuantity(
                                    item.menuItemId,
                                    Number(event.target.value || 1),
                                  )
                                }
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  updateCartQuantity(
                                    item.menuItemId,
                                    item.quantity + 1,
                                  )
                                }
                              >
                                +
                              </button>
                              <strong>
                                {fmtMoney(item.price * item.quantity)}
                              </strong>
                            </div>
                            <textarea
                              value={item.notes}
                              onChange={(event) =>
                                updateCartNotes(
                                  item.menuItemId,
                                  event.target.value,
                                )
                              }
                              placeholder="Item notes"
                              maxLength={500}
                            />
                          </div>
                        ))
                      )}
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

      <aside className="cd-right-panel" aria-label="Service locations">
        <ServiceLocationQuickSwitch
          locations={serviceLocationCards}
          selectedKey={selectedTable}
          loading={loading}
          onSelect={(location) => openTable(location.tableNumber)}
        />
      </aside>

      {!loading && drawerOrder ? (
        <CheckoutSlideOverDrawer
          order={drawerOrder}
          checkoutStatus={drawerCheckoutStatus ?? "payment-due"}
          serviceLocationName={drawerServiceLocationName}
          onClose={closeCheckoutDrawer}
          onReleaseTable={
            drawerDiningSession
              ? () => void handleCloseDiningSessionFromBill(drawerDiningSession)
              : undefined
          }
          onApprove={
            isVerifiablePayment(drawerOrder)
              ? () => handleApprove(drawerOrder)
              : undefined
          }
          onPrintBill={
            drawerDiningSession && drawerCheckoutStatus === "bill-requested"
              ? () => void handlePrintRequestedBill(drawerDiningSession)
              : undefined
          }
          onPrintReceipt={
            drawerOrder.invoiceStatus === "paid" && drawerDiningSession
              ? () =>
                  void handlePrintFinalBill(drawerDiningSession).then((printed) => {
                    if (printed) closeCheckoutDrawerAfterAction(1000);
                  })
              : undefined
          }
          approving={approvingId === (drawerOrder.diningSessionId ?? drawerOrder.id)}
          paymentReference={paymentReference}
          paymentTransactionId={paymentTransactionId}
          paymentScreenshotPreviewUrl={paymentScreenshotPreviewUrl}
          duplicateReferenceNotice={duplicateReferenceNotice}
          collectionPaymentMethod={collectionPaymentMethod}
          availablePaymentMethods={checkoutPaymentMethods}
          paymentMethodConfigurationError={paymentMethodConfigurationError}
          onCollectionPaymentMethodChange={setCollectionPaymentMethod}
          formatMoney={fmtMoney}
        />
      ) : null}
      {continuationChoice && (
        <div className="cd-modal-overlay">
          <div
            className="cd-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Active order found"
          >
            <div className="cd-modal-header">
              <div>
                <h2>
                  Active order found for {compactTableCode(continuationChoice.tableNumber)}
                </h2>
                <p>
                  {fmtOrderLabel(continuationChoice.activeOrder)} is{" "}
                  {operationalLabel(continuationChoice.activeOrder.status)} with
                  a current total of{" "}
                  {fmtMoney(continuationChoice.activeOrder.totalPrice)}.
                </p>
              </div>
              <button onClick={() => setContinuationChoice(null)}>x</button>
            </div>
            <div className="cd-modal-actions split">
              <button
                className="cd-approve-btn"
                onClick={() => void submitPosOrder("append")}
                disabled={submittingOrder}
              >
                {submittingOrder ? "Adding..." : "Add To Existing Order"}
              </button>
              <button
                className="cd-view-btn"
                onClick={() => void submitPosOrder("create")}
                disabled={submittingOrder}
              >
                Create New Order
              </button>
            </div>
          </div>
        </div>
      )}

      {openShiftModal && (
        <div className="cd-modal-overlay">
          <div
            className="cd-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Open shift"
          >
            <div className="cd-modal-header">
              <div>
                <h2>Open Shift</h2>
                <p>Confirm drawer cash before processing orders.</p>
              </div>
              <button onClick={() => setOpenShiftModal(false)}>x</button>
            </div>
            <label className="cd-field">
              <span>Opening Cash Amount</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={openingCash}
                onChange={(event) => setOpeningCash(event.target.value)}
              />
            </label>
            <label className="cd-field">
              <span>Optional Notes</span>
              <textarea
                value={openingNotes}
                onChange={(event) => setOpeningNotes(event.target.value)}
                placeholder="Drawer count discrepancies or equipment notes"
              />
            </label>
            <button
              className="cd-primary-action"
              onClick={handleOpenShift}
              disabled={workingShift}
            >
              {workingShift ? "Opening..." : "Open Shift"}
            </button>
          </div>
        </div>
      )}

      {reconcileOpen && activeShift && (
        <div className="cd-modal-overlay">
          <div
            className="cd-modal wide"
            role="dialog"
            aria-modal="true"
            aria-label="Close shift reconciliation"
          >
            <div className="cd-modal-header">
              <div>
                <h2>Close Shift</h2>
                <p>Step {reconcileStep} of 5 · Reconcile drawer cash.</p>
              </div>
              <button onClick={() => setReconcileOpen(false)}>x</button>
            </div>
            {reconcileStep === 1 && (
              <div className="cd-reconcile-panel">
                <div className="cd-reconcile-row">
                  <span>Opening Cash</span>
                  <strong>{fmtMoney(activeShift.opening_cash)}</strong>
                </div>
                <div className="cd-reconcile-row">
                  <span>Cash Payments</span>
                  <strong>{fmtMoney(activeShift.cash_collected)}</strong>
                </div>
                <div className="cd-reconcile-row">
                  <span>Cash Refunds</span>
                  <strong>{fmtMoney(0)}</strong>
                </div>
                <div className="cd-reconcile-row total">
                  <span>Expected Drawer Cash</span>
                  <strong>{fmtMoney(expectedCash)}</strong>
                </div>
              </div>
            )}
            {reconcileStep === 2 && (
              <label className="cd-field">
                <span>Actual Cash Counted</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={actualCash}
                  onChange={(event) => setActualCash(event.target.value)}
                  autoFocus
                />
              </label>
            )}
            {reconcileStep === 3 && (
              <div className="cd-reconcile-panel">
                <div className="cd-reconcile-row">
                  <span>Expected</span>
                  <strong>{fmtMoney(expectedCash)}</strong>
                </div>
                <div className="cd-reconcile-row">
                  <span>Actual</span>
                  <strong>{fmtMoney(actualCashNumber)}</strong>
                </div>
                <div
                  className={`cd-reconcile-row total ${variance === 0 ? "balanced" : "variance"}`}
                >
                  <span>Variance</span>
                  <strong>{fmtMoney(Math.abs(variance))}</strong>
                </div>
              </div>
            )}
            {reconcileStep === 4 && (
              <label className="cd-field">
                <span>
                  {needsVarianceReason
                    ? "Variance Explanation Required"
                    : "Closing Notes"}
                </span>
                <textarea
                  value={varianceReason}
                  onChange={(event) => setVarianceReason(event.target.value)}
                  placeholder={
                    needsVarianceReason
                      ? "Explain the cash drawer difference"
                      : "Optional closing notes"
                  }
                />
              </label>
            )}
            {reconcileStep === 5 && (
              <div className="cd-reconcile-panel">
                <div className="cd-empty-title">Ready to close shift</div>
                <div className="cd-empty-sub">
                  Expected {fmtMoney(expectedCash)} · Actual{" "}
                  {fmtMoney(actualCashNumber)} · Variance{" "}
                  {fmtMoney(Math.abs(variance))}
                </div>
              </div>
            )}
            <div className="cd-modal-actions">
              <button
                className="cd-view-btn"
                onClick={() =>
                  setReconcileStep(
                    (step) => Math.max(1, step - 1) as ReconcileStep,
                  )
                }
                disabled={reconcileStep === 1 || workingShift}
              >
                Back
              </button>
              {reconcileStep < 5 ? (
                <button
                  className="cd-approve-btn"
                  onClick={() =>
                    setReconcileStep(
                      (step) => Math.min(5, step + 1) as ReconcileStep,
                    )
                  }
                  disabled={
                    (reconcileStep === 2 && actualCash === "") ||
                    (reconcileStep === 4 &&
                      needsVarianceReason &&
                      varianceReason.trim().length === 0)
                  }
                >
                  Next
                </button>
              ) : (
                <button
                  className="cd-approve-btn"
                  onClick={handleCloseShift}
                  disabled={workingShift}
                >
                  {workingShift ? "Closing..." : "Close Shift"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

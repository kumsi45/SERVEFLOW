import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../../core/database";
import { formatCurrency } from "../../../core/format/currency";
import {
  canonicalOperationalStatus,
  canonicalPaymentStatus,
  operationalLabel,
  paymentLabel,
} from "../../../core/payment/lifecycle";
import {
  playNotificationTone,
  realtimeStateFromStatus,
  type RealtimeConnectionState,
} from "../../../core/realtime/realtimeNotifications";
import { signOutStaff } from "../../staff-auth/services/staffAuthService";
import type {
  CashierOrder,
  CashierOrderItem,
  CashierRestaurant,
} from "../types";
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

function statusLabel(status: string) {
  if (
    [
      "pending",
      "held",
      "paid",
      "refunded",
      "cancelled",
      "verified",
      "rejected",
    ].includes(status)
  )
    return paymentLabel(status);
  if (
    [
      "new",
      "accepted",
      "preparing",
      "ready",
      "served",
      "closed",
      "pending_payment",
      "completed",
    ].includes(status)
  )
    return operationalLabel(status);
  if (status === "waiting_kitchen") return "Kitchen Waiting";
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

type QueueTab = "active" | "pending" | "completed";
type ReconcileStep = 1 | 2 | 3 | 4 | 5;
type BillHistory = {
  dining_session_id: string;
  print_count: number;
  printed_at: string;
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
const PAYMENT_SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;

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

function buildFinalBillReviewModel(
  session: DiningSessionSummary,
  restaurant: CashierRestaurant,
  cashierName: string,
  format: FinalBillFormat,
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
  const total = session.verifiedTotal;
  const subtotal = Math.round((total / 1.15) * 100) / 100;
  const methods = new Map<string, number>();
  for (const batch of session.batches.filter(
    (batch) => batch.invoiceStatus === "paid",
  ))
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
      status: "preview",
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
      vatRate: 0.15,
      vatAmount: total - subtotal,
      serviceChargeRate: 0,
      serviceChargeAmount: 0,
      discountAmount: 0,
      grandTotal: total,
    },
    payments: [...methods].map(([method, amount]) => ({ method, amount })),
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
      <section class="bill-payments">
        <h3>Payment Breakdown</h3>
        ${paymentBreakdown.map((payment) => `<div><span>${escapeHtml(payment.method)}</span><strong>${fmtBillMoney(payment.amount)}</strong></div>`).join("")}
        <div class="paid"><span>Total Paid</span><strong>${fmtBillMoney(totalPaid)}</strong></div>
      </section>
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
            <p>Ethiopian Restaurant/Cafe Bill</p>
            ${model.restaurant.tinNumber ? `<p>TIN: ${escapeHtml(model.restaurant.tinNumber)}</p>` : ""}
            ${model.restaurant.vatRegistrationNumber ? `<p>VAT Number: ${escapeHtml(model.restaurant.vatRegistrationNumber)}</p>` : ""}
            ${model.restaurant.address ? `<p>${escapeHtml(model.restaurant.address)}</p>` : ""}
            ${model.restaurant.phone ? `<p>Tel: ${escapeHtml(model.restaurant.phone)}</p>` : ""}
          `
              : `<h2>${escapeHtml(model.restaurant.name)}</h2><p>Receipt continued</p>`
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

  return `<!doctype html><html><head><title>${escapeHtml(model.restaurant.name)} Receipt</title><style>
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

function safeStorageFileName(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  return `${Date.now()}-${crypto.randomUUID()}.${extension.replace(/[^a-z0-9]/g, "") || "jpg"}`;
}

function paymentScreenshotPath(
  restaurantId: string,
  invoiceId: string,
  file: File,
) {
  return `${restaurantId}/payments/${invoiceId}/${safeStorageFileName(file)}`;
}

function getOrderItemPreview(items: CashierOrderItem[]) {
  const visible = items.slice(0, 3);
  const hiddenCount = Math.max(0, items.length - visible.length);
  return { visible, hiddenCount };
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
  return [...sessions.values()].sort(
    (left, right) =>
      new Date(right.latestAt).getTime() - new Date(left.latestAt).getTime(),
  );
}

function KpiCard({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "warning" | "success";
}) {
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

function OrderDrawer({
  order,
  onClose,
  onApprove,
  onReject,
  onRetry,
  approving,
  paymentReference,
  paymentTransactionId,
  paymentScreenshotUrl,
  paymentScreenshotPreviewUrl,
  duplicateReferenceNotice,
  ownerDuplicateOverride,
  paymentNote,
  onPaymentReferenceChange,
  onPaymentTransactionIdChange,
  onPaymentScreenshotFileChange,
  onOwnerDuplicateOverrideChange,
  onPaymentNoteChange,
  formatMoney,
}: {
  order: CashierOrder;
  onClose: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onRetry?: () => void;
  approving: boolean;
  paymentReference: string;
  paymentTransactionId: string;
  paymentScreenshotUrl: string;
  paymentScreenshotPreviewUrl: string | null;
  duplicateReferenceNotice: string | null;
  ownerDuplicateOverride: boolean;
  paymentNote: string;
  onPaymentReferenceChange: (value: string) => void;
  onPaymentTransactionIdChange: (value: string) => void;
  onPaymentScreenshotFileChange: (file: File | null) => void;
  onOwnerDuplicateOverrideChange: (value: boolean) => void;
  onPaymentNoteChange: (value: string) => void;
  formatMoney: (value: number) => string;
}) {
  const isPending =
    order.invoiceStatus === "pending" || order.invoiceStatus === "held";
  const isRejected = order.invoiceStatus === "cancelled";
  const isVerified = order.invoiceStatus === "paid";
  const isDigital = order.paymentMethod !== "Cash";

  return (
    <>
      <div className="cd-drawer-overlay" onClick={onClose} />
      <aside
        className="cd-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Order details"
      >
        <div className="cd-drawer-header">
          <div>
            <div className="cd-drawer-title">
              {fmtOrderLabel(order)} · {fmtInvoiceLabel(order)}
            </div>
            <div className="cd-card-subtitle">
              Table {order.tableNumber || "-"}
            </div>
          </div>
          <button
            className="cd-drawer-close"
            onClick={onClose}
            aria-label="Close"
          >
            x
          </button>
        </div>
        <div className="cd-drawer-body">
          <div className="cd-drawer-detail-grid">
            <div className="cd-drawer-detail">
              <div className="cd-drawer-detail-label">Payment Status</div>
              <div className="cd-drawer-detail-value">
                {statusLabel(order.invoiceStatus || "pending")}
              </div>
            </div>
            <div className="cd-drawer-detail">
              <div className="cd-drawer-detail-label">Operational Status</div>
              <div className="cd-drawer-detail-value">
                {statusLabel(order.status)}
              </div>
            </div>
            <div className="cd-drawer-detail">
              <div className="cd-drawer-detail-label">Created By</div>
              <div className="cd-drawer-detail-value">
                {creatorLabel(order)}
              </div>
            </div>
            <div className="cd-drawer-detail">
              <div className="cd-drawer-detail-label">Payment Method</div>
              <div className="cd-drawer-detail-value">
                {order.paymentMethod || "Not selected"}
              </div>
            </div>
            <div className="cd-drawer-detail">
              <div className="cd-drawer-detail-label">Created</div>
              <div className="cd-drawer-detail-value">
                {fmtDateTime(order.createdAt)}
              </div>
            </div>
            <div className="cd-drawer-detail">
              <div className="cd-drawer-detail-label">Collected By</div>
              <div className="cd-drawer-detail-value">
                {order.invoiceVerifiedByName || "-"}
              </div>
            </div>
          </div>
          {isPending || order.invoiceStatus === "paid" || isRejected ? (
            <div className="cd-payment-verification-box">
              <div className="cd-drawer-section-title">Payment Collection</div>
              <div className="cd-payment-fields">
                {isDigital ? (
                  <>
                    <label>
                      <span>Reference Number</span>
                      <input
                        value={paymentReference}
                        onChange={(event) =>
                          onPaymentReferenceChange(event.target.value)
                        }
                        maxLength={120}
                      />
                    </label>
                    <label>
                      <span>Transaction ID</span>
                      <input
                        value={paymentTransactionId}
                        onChange={(event) =>
                          onPaymentTransactionIdChange(event.target.value)
                        }
                        maxLength={120}
                      />
                    </label>
                    <label className="wide">
                      <span>Payment Screenshot</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) =>
                          onPaymentScreenshotFileChange(
                            event.target.files?.[0] ?? null,
                          )
                        }
                      />
                    </label>
                    {paymentScreenshotPreviewUrl ? (
                      <a
                        className="cd-payment-preview"
                        href={paymentScreenshotPreviewUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img
                          src={paymentScreenshotPreviewUrl}
                          alt="Payment screenshot preview"
                        />
                      </a>
                    ) : paymentScreenshotUrl ? (
                      <div className="cd-empty-sub wide">
                        Stored payment evidence is ready for review.
                      </div>
                    ) : null}
                    {duplicateReferenceNotice ? (
                      <div className="cd-payment-duplicate wide">
                        <span>{duplicateReferenceNotice}</span>
                        <label>
                          <input
                            type="checkbox"
                            checked={ownerDuplicateOverride}
                            onChange={(event) =>
                              onOwnerDuplicateOverrideChange(
                                event.target.checked,
                              )
                            }
                          />
                          Owner override duplicate reference
                        </label>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="cd-cash-confirmation">
                    Cash requires cashier confirmation before kitchen release.
                  </div>
                )}
                <label className="wide">
                  <span>Cashier Note</span>
                  <textarea
                    value={paymentNote}
                    onChange={(event) =>
                      onPaymentNoteChange(event.target.value)
                    }
                    maxLength={500}
                    placeholder="Reason for reject or retry, optional for approval"
                  />
                </label>
              </div>
            </div>
          ) : null}
          {isVerified ? (
            <div className="cd-payment-history-strip">
              <span>
                Paid{" "}
                {order.invoiceVerifiedAt
                  ? fmtDateTime(order.invoiceVerifiedAt)
                  : "-"}
              </span>
              <span>
                {order.referenceNumber
                  ? `Ref ${order.referenceNumber}`
                  : "No reference"}
              </span>
              <span>
                {order.transactionId
                  ? `Txn ${order.transactionId}`
                  : "No transaction ID"}
              </span>
            </div>
          ) : null}
          {order.orderNote ? (
            <div className="cd-pos-active-note">{order.orderNote}</div>
          ) : null}
          <div>
            <div className="cd-drawer-section-title">Items</div>
            <div className="cd-drawer-items">
              {order.items.length === 0 ? (
                <div className="cd-empty-sub">No item data available.</div>
              ) : (
                order.items.map((item) => (
                  <div key={item.id} className="cd-drawer-item">
                    <div>
                      <div className="cd-drawer-item-name">{item.name}</div>
                      <div className="cd-drawer-item-qty">
                        Qty {item.quantity}
                      </div>
                    </div>
                    <div className="cd-drawer-item-price">
                      {formatMoney(item.price * item.quantity)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="cd-drawer-total">
            <span className="cd-drawer-total-label">Total</span>
            <span className="cd-drawer-total-value">
              {formatMoney(order.totalPrice)}
            </span>
          </div>
        </div>
        <div className="cd-drawer-footer">
          {onApprove && (
            <button
              className="cd-drawer-approve-btn"
              onClick={onApprove}
              disabled={approving}
            >
              {approving ? "Collecting..." : "Collect Payment"}
            </button>
          )}
          {onReject && (
            <button
              className="cd-view-btn danger"
              onClick={onReject}
              disabled={approving}
            >
              Reject
            </button>
          )}
          {onRetry && (
            <button
              className="cd-view-btn"
              onClick={onRetry}
              disabled={approving}
            >
              Request Retry
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

function CheckoutReceiptPreview({ model }: { model: FinalDiningBillModel }) {
  const paid = model.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const printed = model.bill.printCount > 0;
  return (
    <section className="cd-checkout-receipt" aria-label="Receipt preview">
      <header>
        {model.restaurant.logoUrl ? (
          <img src={model.restaurant.logoUrl} alt="" />
        ) : (
          <span>{model.restaurant.name.charAt(0)}</span>
        )}
        <h2>{model.restaurant.name}</h2>
        {model.restaurant.address ? <p>{model.restaurant.address}</p> : null}
        {model.restaurant.phone ? <p>{model.restaurant.phone}</p> : null}
      </header>
      <div className="cd-receipt-meta">
        <span>Table {model.bill.tableNumber ?? "-"}</span>
        <span>{new Date(model.bill.printedAt).toLocaleDateString()}</span>
        <span>Cashier: {model.bill.cashierName ?? "Cashier"}</span>
        <span>
          {new Date(model.bill.printedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      <div className="cd-receipt-lines">
        <div className="heading">
          <span>Item</span>
          <span>Qty</span>
          <span>Unit</span>
          <span>Total</span>
        </div>
        {model.items.map((item, index) => (
          <div key={`${item.name}-${index}`}>
            <span>{item.name}</span>
            <span>{item.quantity}</span>
            <span>{fmtBillMoney(item.unitPrice)}</span>
            <strong>{fmtBillMoney(item.total)}</strong>
          </div>
        ))}
      </div>
      <div className="cd-receipt-totals">
        <div>
          <span>Subtotal</span>
          <strong>{fmtBillMoney(model.totals.subtotal)}</strong>
        </div>
        <div>
          <span>VAT ({Math.round(model.totals.vatRate * 100)}%)</span>
          <strong>{fmtBillMoney(model.totals.vatAmount)}</strong>
        </div>
        <div>
          <span>Service Charge</span>
          <strong>{fmtBillMoney(model.totals.serviceChargeAmount)}</strong>
        </div>
        <div>
          <span>Discount</span>
          <strong>
            - {fmtBillMoney(Math.abs(model.totals.discountAmount))}
          </strong>
        </div>
        <div className="grand">
          <span>TOTAL</span>
          <strong>{fmtBillMoney(model.totals.grandTotal)}</strong>
        </div>
      </div>
      <div className="cd-receipt-payment">
        <small>Payment Method</small>
        <strong>
          {model.payments.map((payment) => payment.method).join(" + ") ||
            "Paid"}
        </strong>
        <span>Paid {fmtBillMoney(paid || model.totals.grandTotal)}</span>
      </div>
      <footer>
        <strong>Thank you for dining with us!</strong>
        <span>
          {printed
            ? `Printed · Copy ${model.bill.printCount}`
            : "Review copy · Not yet printed"}
        </span>
      </footer>
    </section>
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
        : "active",
  );
  const [drawerOrder, setDrawerOrder] = useState<CashierOrder | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentTransactionId, setPaymentTransactionId] = useState("");
  const [paymentScreenshotUrl, setPaymentScreenshotUrl] = useState("");
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
  const [realtimeNotice, setRealtimeNotice] = useState<string | null>(null);
  const [realtimeState, setRealtimeState] =
    useState<RealtimeConnectionState>("connecting");
  const [billFormat, setBillFormat] = useState<FinalBillFormat>(() => {
    const saved = window.localStorage.getItem(
      "serveflow.cashier.receipt-format",
    );
    return saved === "58mm" || saved === "a4" || saved === "browser"
      ? saved
      : "80mm";
  });
  const [billWorkingSessionId, setBillWorkingSessionId] = useState<
    string | null
  >(null);
  const [lastPrintedBill, setLastPrintedBill] =
    useState<FinalDiningBillModel | null>(null);
  const [checkoutSession, setCheckoutSession] =
    useState<DiningSessionSummary | null>(null);
  const [advancedPrinterOptions, setAdvancedPrinterOptions] = useState(false);
  const [billHistory, setBillHistory] = useState<Map<string, BillHistory>>(
    new Map(),
  );
  const [closingSessionId, setClosingSessionId] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const knownPendingPaymentIdsRef = useRef<Set<string>>(new Set());
  const dashboardHydratedRef = useRef(false);
  const realtimeRefreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    window.localStorage.setItem("serveflow.cashier.receipt-format", billFormat);
  }, [billFormat]);

  useEffect(() => {
    setPaymentReference(drawerOrder?.referenceNumber ?? "");
    setPaymentTransactionId(drawerOrder?.transactionId ?? "");
    setPaymentScreenshotUrl(drawerOrder?.screenshotUrl ?? "");
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
  }, [drawerOrder?.invoiceId]);

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

  async function handlePaymentScreenshotFileChange(file: File | null) {
    try {
      setError(null);
      setPaymentScreenshotPreviewUrl(null);
      setPaymentScreenshotUrl("");
      if (!file) return;
      if (!file.type.startsWith("image/"))
        throw new Error("Payment screenshot must be an image file.");
      if (file.size > PAYMENT_SCREENSHOT_MAX_BYTES)
        throw new Error("Payment screenshot must be 5 MB or smaller.");
      if (!drawerOrder?.invoiceId)
        throw new Error("Payment batch is missing for this order.");

      const path = paymentScreenshotPath(
        restaurantId,
        drawerOrder.invoiceId,
        file,
      );
      const { error: uploadError } = await supabase.storage
        .from(PAYMENT_SCREENSHOT_BUCKET)
        .upload(path, file, {
          cacheControl: "0",
          upsert: false,
          contentType: file.type,
        });
      if (uploadError) throw new Error(uploadError.message);
      const { data, error: signedUrlError } = await supabase.storage
        .from(PAYMENT_SCREENSHOT_BUCKET)
        .createSignedUrl(path, 60 * 10);
      if (signedUrlError) throw new Error(signedUrlError.message);
      setPaymentScreenshotUrl(path);
      setPaymentScreenshotPreviewUrl(data.signedUrl);
    } catch (uploadError) {
      setPaymentScreenshotUrl("");
      setPaymentScreenshotPreviewUrl(null);
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Payment screenshot upload failed.",
      );
    }
  }

  async function loadDashboard() {
    const [
      { data: staffData },
      { data: invoiceRows, error: invoicesError },
      { data: tableRows },
      { data: categoryRows, error: categoriesError },
      { data: menuRows, error: menuError },
      { data: shiftSummary, error: shiftError },
      { data: activityRows },
      { data: billRows },
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
      supabase
        .from("dining_session_bills")
        .select("dining_session_id,print_count,printed_at")
        .eq("restaurant_id", restaurantId),
    ]);

    if (invoicesError) throw new Error(invoicesError.message);
    if (categoriesError) throw new Error(categoriesError.message);
    if (menuError) throw new Error(menuError.message);
    if (shiftError) throw new Error(shiftError.message);

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
    const pendingPaymentIds = new Set(
      normalizedOrders
        .filter(
          (order) =>
            order.invoiceStatus === "pending" || order.invoiceStatus === "held",
        )
        .map((order) => order.invoiceId ?? order.id),
    );
    const newPendingPaymentCount = normalizedOrders.filter((order) => {
      const orderKey = order.invoiceId ?? order.id;
      return (
        (order.invoiceStatus === "pending" || order.invoiceStatus === "held") &&
        !knownPendingPaymentIdsRef.current.has(orderKey)
      );
    }).length;

    if (dashboardHydratedRef.current && newPendingPaymentCount > 0) {
      setRealtimeNotice(
        `${newPendingPaymentCount} new payment${newPendingPaymentCount === 1 ? "" : "s"} requiring collection.`,
      );
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
    setBillHistory(
      new Map(
        ((billRows ?? []) as BillHistory[]).map((bill) => [
          bill.dining_session_id,
          bill,
        ]),
      ),
    );
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
        void loadDashboard().catch((loadError) =>
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Realtime refresh failed.",
          ),
        );
      }, 120);
    };
    const channel = supabase
      .channel(`cashier-operations-${restaurantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_invoices",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_items",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dining_sessions",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "restaurant_tables",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cashier_shifts",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cash_reconciliations",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "shift_activity_logs",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        refresh,
      )
      .subscribe((status) => {
        setRealtimeState(realtimeStateFromStatus(status));
        if (status === "SUBSCRIBED" && dashboardHydratedRef.current) refresh();
      });
    channelRef.current = channel;
    return () => {
      if (realtimeRefreshTimerRef.current !== null)
        window.clearTimeout(realtimeRefreshTimerRef.current);
      realtimeRefreshTimerRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  async function handleApprove(order: CashierOrder) {
    try {
      const targetActionId = order.invoiceId ?? order.id;
      if (!order.invoiceId)
        throw new Error("Payment batch is missing for this order.");
      setApprovingId(targetActionId);
      setError(null);
      const { data, error: rpcError } = await supabase.rpc(
        "verify_order_payment",
        {
          target_invoice_id: order.invoiceId,
          payment_reference_number: paymentReference || null,
          payment_transaction_id: paymentTransactionId || null,
          payment_screenshot_url: paymentScreenshotUrl || null,
          owner_duplicate_override: ownerDuplicateOverride,
        },
      );
      if (rpcError) throw new Error(rpcError.message);
      const updated = normalizeOrder(data as OrderRow);
      const paidAt = new Date().toISOString();
      setOrders((prev) =>
        prev.map((existing) =>
          (existing.invoiceId ?? existing.id) === targetActionId
            ? {
                ...existing,
                ...updated,
                invoiceId: existing.invoiceId,
                invoiceNumber: existing.invoiceNumber,
                invoiceStatus: "paid",
                invoicePaidAt: paidAt,
                invoiceVerifiedAt: paidAt,
                referenceNumber: paymentReference || null,
                transactionId: paymentTransactionId || null,
                screenshotUrl: paymentScreenshotUrl || null,
                items: existing.items,
              }
            : existing,
        ),
      );
      if ((drawerOrder?.invoiceId ?? drawerOrder?.id) === targetActionId)
        setDrawerOrder((current) =>
          current
            ? {
                ...current,
                ...updated,
                invoiceId: current.invoiceId,
                invoiceNumber: current.invoiceNumber,
                invoiceStatus: "paid",
                invoicePaidAt: paidAt,
                invoiceVerifiedAt: paidAt,
                referenceNumber: paymentReference || null,
                transactionId: paymentTransactionId || null,
                screenshotUrl: paymentScreenshotUrl || null,
                items: current.items,
              }
            : null,
        );
      setPaymentReference("");
      setPaymentTransactionId("");
      setPaymentScreenshotUrl("");
      setPaymentScreenshotPreviewUrl(null);
      setOwnerDuplicateOverride(false);
      setDuplicateReferenceNotice(null);
      setPaymentNote("");
      await loadDashboard();
    } catch (approveError) {
      setError(
        approveError instanceof Error
          ? approveError.message
          : "Payment collection failed.",
      );
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
      await loadDashboard();
    } catch (rejectError) {
      setError(
        rejectError instanceof Error
          ? rejectError.message
          : "Payment rejection failed.",
      );
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
      await loadDashboard();
    } catch (retryError) {
      setError(
        retryError instanceof Error
          ? retryError.message
          : "Payment retry request failed.",
      );
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
        setOrders((previous) => [created, ...previous]);
      }

      setCartItems([]);
      setSelectedTable("");
      setSelectedPaymentMethod(PAYMENT_METHODS[0]);
      setContinuationChoice(null);
      await loadDashboard();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not submit order.",
      );
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
      setLastPrintedBill(billModel);
      printFinalBill(billModel);
      setRealtimeNotice(
        `Receipt printed successfully · Copy ${billModel.bill.printCount}.`,
      );
      await loadDashboard();
    } catch (billError) {
      setError(
        billError instanceof Error
          ? billError.message
          : "Could not print final bill.",
      );
    } finally {
      setBillWorkingSessionId(null);
    }
  }

  async function handleCloseDiningSessionFromBill(
    session: DiningSessionSummary,
  ) {
    if (
      !window.confirm(
        `Release Table ${session.tableNumber ?? ""}? Confirm the customer has left and the table is ready for new guests.`,
      )
    )
      return;
    try {
      setClosingSessionId(session.diningSessionId);
      setError(null);
      const { error: rpcError } = await supabase.rpc("close_dining_session", {
        target_order_id: session.diningSessionId,
        close_reason: "table_released_after_checkout",
      });
      if (rpcError) throw new Error(rpcError.message);
      setRealtimeNotice(
        `Table ${session.tableNumber ?? ""} released successfully.`,
      );
      setCheckoutSession(null);
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

  const verifiedOrders = useMemo(
    () => orders.filter((order) => order.invoiceStatus === "paid"),
    [orders],
  );
  const pendingPayments = useMemo(
    () => orders.filter(isUnpaidPayment),
    [orders],
  );
  const activeOrders = useMemo(() => orders.filter(isActiveOrder), [orders]);
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
  const completedDiningSessions = useMemo(
    () => buildDiningSessionSummaries(completedOrders),
    [completedOrders],
  );
  const openSessionOrders = useMemo(
    () => orders.filter(isContinuableOrder),
    [orders],
  );
  const cashCollectedToday = verifiedOrders
    .filter(isCashPayment)
    .reduce((sum, order) => sum + order.totalPrice, 0);
  const digitalCollectedToday = verifiedOrders
    .filter(isDigitalPayment)
    .reduce((sum, order) => sum + order.totalPrice, 0);
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
  const openDiningSessions = activeDiningSessions;
  const checkoutBillModel = useMemo(() => {
    if (!checkoutSession) return null;
    if (
      lastPrintedBill?.bill.diningSessionId === checkoutSession.diningSessionId
    )
      return lastPrintedBill;
    return buildFinalBillReviewModel(
      checkoutSession,
      restaurant,
      cashierName || "Cashier",
      billFormat,
    );
  }, [billFormat, cashierName, checkoutSession, lastPrintedBill, restaurant]);
  const checkoutPrintHistory = checkoutSession
    ? (billHistory.get(checkoutSession.diningSessionId) ?? null)
    : null;
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
  const queueOrders = pendingPayments;
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
    const order = activeOrders.find(
      (candidate) => candidate.tableNumber === String(tableNumber),
    );
    if (order) setDrawerOrder(order);
  }

  return (
    <div className="cd-root">
      <header className="cd-header">
        {realtimeState !== "connected" ? (
          <div role="status" className="cd-realtime-state">
            Realtime reconnecting…
          </div>
        ) : null}
        <div className="cd-header-left">
          <div className="cd-logo" aria-hidden="true">
            {restaurant.name.charAt(0).toUpperCase()}
          </div>
          <div className="cd-header-info">
            <div className="cd-restaurant-name">{restaurant.name}</div>
            <div
              className={`cd-shift-badge ${activeShift ? "active" : "closed"}`}
            >
              <span className="cd-shift-dot" />
              {activeShift
                ? "Cashier · Active Shift"
                : "Cashier · Shift Closed"}
            </div>
          </div>
        </div>
        <div className="cd-header-right">
          <div className="cd-header-datetime">
            <div className="cd-header-date">{dateStr}</div>
            <div className="cd-header-time">{timeStr}</div>
          </div>
          <button
            className="cd-icon-btn"
            aria-label="Notifications"
            onClick={() => setRealtimeNotice(null)}
          >
            !{realtimeNotice ? <span className="cd-notif-dot" /> : null}
          </button>
          <button className="cd-signout-btn" onClick={handleSignOut}>
            Sign Out
          </button>
        </div>
      </header>

      <main className="cd-body">
        {realtimeNotice ? (
          <div className="cd-realtime-notice" role="status">
            <strong>{realtimeNotice}</strong>
            <button type="button" onClick={() => setRealtimeNotice(null)}>
              Dismiss
            </button>
          </div>
        ) : null}
        {error && <div className="cd-error-banner">{error}</div>}

        {loading ? (
          <div className="cd-kpi-grid">
            {Array.from({ length: 6 }).map((_, index) => (
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

            <section className="cd-kpi-grid">
              <KpiCard
                label="Active Orders"
                value={`${activeDiningSessions.length}`}
                detail="Active dining sessions"
              />
              <KpiCard
                label="Pending Payments"
                value={`${pendingPayments.length}`}
                detail="Needs collection"
                tone={pendingPayments.length > 0 ? "warning" : "default"}
              />
              <KpiCard
                label="Awaiting Collection"
                value={`${awaitingCollection.length}`}
                detail="Ready or handed over"
              />
              <KpiCard
                label="Occupied Tables"
                value={`${occupiedTableNumbers.size}`}
                detail={`${availableTables} available`}
              />
              <KpiCard
                label="Cash Collected Today"
                value={fmtMoney(cashCollectedToday)}
                detail="Paid cash invoices"
                tone="success"
              />
              <KpiCard
                label="Digital Payments Today"
                value={fmtMoney(digitalCollectedToday)}
                detail="Paid digital invoices"
              />
            </section>

            <section className="cd-main-grid">
              <div className="cd-card">
                <div className="cd-card-header">
                  <div className="cd-tabs">
                    <button
                      className={`cd-tab${queueTab === "active" ? " active" : ""}`}
                      onClick={() => setQueueTab("active")}
                    >
                      Active Orders{" "}
                      <span className="cd-tab-badge">
                        {activeDiningSessions.length}
                      </span>
                    </button>
                    <button
                      className={`cd-tab${queueTab === "pending" ? " active" : ""}`}
                      onClick={() => setQueueTab("pending")}
                    >
                      Pending Payments{" "}
                      <span className="cd-tab-badge">
                        {pendingPayments.length}
                      </span>
                    </button>
                    <button
                      className={`cd-tab${queueTab === "completed" ? " active" : ""}`}
                      onClick={() => setQueueTab("completed")}
                    >
                      Completed Orders{" "}
                      <span className="cd-tab-badge">
                        {completedDiningSessions.length}
                      </span>
                    </button>
                  </div>
                  <span className="cd-card-subtitle">Newest first</span>
                </div>
                <div className="cd-order-list">
                  {queueTab === "pending" && queueOrders.length === 0 ? (
                    <div className="cd-empty">
                      <div className="cd-empty-title">
                        No orders in this queue
                      </div>
                      <div className="cd-empty-sub">
                        Realtime orders will appear here.
                      </div>
                    </div>
                  ) : null}
                  {queueTab === "pending"
                    ? queueOrders.map((order) => {
                        const preview = getOrderItemPreview(order.items);
                        return (
                          <article
                            key={order.invoiceId ?? order.id}
                            className={`cd-order-card ${order.invoiceStatus === "pending" ? "pending_payment" : order.status}`}
                            onClick={() => setDrawerOrder(order)}
                          >
                            <div className="cd-order-table-tile">
                              Tbl<strong>{order.tableNumber || "-"}</strong>
                            </div>
                            <div className="cd-order-card-main">
                              <div className="cd-order-card-title">
                                <strong>
                                  {fmtOrderLabel(order)} ·{" "}
                                  {fmtInvoiceLabel(order)}
                                </strong>
                                <span
                                  className={`cd-badge ${order.invoiceStatus}`}
                                >
                                  Payment:{" "}
                                  {statusLabel(
                                    order.invoiceStatus || "pending",
                                  )}
                                </span>
                                <span className="cd-badge cbe">
                                  Order: {statusLabel(order.status)}
                                </span>
                              </div>
                              <div className="cd-order-card-meta cd-order-card-summary">
                                {timeAgo(order.createdAt)} · Created by:{" "}
                                {creatorLabel(order)} · {order.items.length}{" "}
                                items · {order.paymentMethod || "No method"} ·{" "}
                                {fmtMoney(order.totalPrice)}
                              </div>
                              <div className="cd-order-card-meta-grid">
                                <span>
                                  <b>Waiter:</b>{" "}
                                  {order.waiterName ||
                                    order.invoiceCreatorName ||
                                    "Unassigned"}
                                </span>
                                <span>
                                  <b>Customer:</b>{" "}
                                  {order.customerName || "Walk-in Customer"}
                                </span>
                                <span>
                                  <b>Payment Method:</b>{" "}
                                  {order.paymentMethod || "Not selected"}
                                </span>
                                <span>
                                  <b>Created:</b> {fmtTime(order.createdAt)}
                                </span>
                                <span>
                                  <b>Waiting:</b>{" "}
                                  {durationFrom(order.createdAt, now)}
                                </span>
                                <span>
                                  <b>Total:</b> {fmtMoney(order.totalPrice)}
                                </span>
                              </div>
                              {preview.visible.length > 0 && (
                                <div
                                  className="cd-order-item-preview"
                                  aria-label="Order item preview"
                                >
                                  {preview.visible.map((item) => (
                                    <div key={item.id}>
                                      {item.name} ×{item.quantity}
                                    </div>
                                  ))}
                                  {preview.hiddenCount > 0 && (
                                    <div className="cd-order-item-more">
                                      +{preview.hiddenCount} more item
                                      {preview.hiddenCount === 1 ? "" : "s"}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            <div
                              className="cd-order-card-actions"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <button
                                className="cd-view-btn"
                                onClick={() => setDrawerOrder(order)}
                              >
                                View
                              </button>
                              {isVerifiablePayment(order) && (
                                <button
                                  className="cd-approve-btn"
                                  disabled={
                                    approvingId ===
                                    (order.invoiceId ?? order.id)
                                  }
                                  onClick={() => handleApprove(order)}
                                >
                                  {approvingId === (order.invoiceId ?? order.id)
                                    ? "..."
                                    : "Collect Payment"}
                                </button>
                              )}
                            </div>
                          </article>
                        );
                      })
                    : null}
                  {queueTab !== "pending" &&
                  (queueTab === "active"
                    ? activeDiningSessions
                    : completedDiningSessions
                  ).length === 0 ? (
                    <div className="cd-empty">
                      <div className="cd-empty-title">
                        No dining sessions in this queue
                      </div>
                      <div className="cd-empty-sub">
                        Dining sessions move here by session status.
                      </div>
                    </div>
                  ) : null}
                  {queueTab !== "pending"
                    ? (queueTab === "active"
                        ? activeDiningSessions
                        : completedDiningSessions
                      ).map((session) => {
                        const firstBatch = session.batches[0];
                        const sessionTotal = session.batches.reduce(
                          (sum, batch) => sum + batch.totalPrice,
                          0,
                        );
                        return (
                          <article
                            key={session.diningSessionId}
                            className={`cd-order-card ${queueTab === "completed" ? "completed" : "pending_payment"}`}
                            onClick={() =>
                              firstBatch && setDrawerOrder(firstBatch)
                            }
                          >
                            <div className="cd-order-table-tile">
                              Tbl<strong>{session.tableNumber || "-"}</strong>
                            </div>
                            <div className="cd-order-card-main">
                              <div className="cd-order-card-title">
                                <strong>{fmtSessionLabel(session)}</strong>
                                <span
                                  className={`cd-badge ${session.diningSessionStatus === "open" ? "pending" : "paid"}`}
                                >
                                  {statusLabel(
                                    session.diningSessionStatus ?? "open",
                                  )}
                                </span>
                              </div>
                              <div className="cd-order-card-meta">
                                {timeAgo(session.latestAt)} ·{" "}
                                {session.batches.length} batch
                                {session.batches.length === 1
                                  ? ""
                                  : "es"} · {session.itemCount} item
                                {session.itemCount === 1 ? "" : "s"} ·{" "}
                                {fmtMoney(sessionTotal)}
                              </div>
                              <div className="cd-session-batch-list">
                                {session.batches.map((batch) => {
                                  const preview = getOrderItemPreview(
                                    batch.items,
                                  );
                                  return (
                                    <div
                                      className="cd-session-batch"
                                      key={batch.invoiceId ?? batch.id}
                                    >
                                      <div>
                                        <strong>
                                          {fmtOrderLabel(batch)} ·{" "}
                                          {fmtInvoiceLabel(batch)}
                                        </strong>
                                        <span>
                                          Created by: {creatorLabel(batch)} ·{" "}
                                          {preview.visible
                                            .map(
                                              (item) =>
                                                `${item.name} x${item.quantity}`,
                                            )
                                            .join(", ") || "No items"}
                                          {preview.hiddenCount > 0
                                            ? `, +${preview.hiddenCount} more`
                                            : ""}
                                        </span>
                                      </div>
                                      <div className="cd-session-batch-status">
                                        <span
                                          className={`cd-badge ${batch.invoiceStatus}`}
                                        >
                                          Payment:{" "}
                                          {statusLabel(
                                            batch.invoiceStatus || "pending",
                                          )}
                                        </span>
                                        <span className="cd-badge cbe">
                                          Order: {statusLabel(batch.status)}
                                        </span>
                                        <button
                                          className="cd-view-btn"
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setDrawerOrder(batch);
                                          }}
                                        >
                                          View
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </article>
                        );
                      })
                    : null}
                </div>
              </div>

              <aside className="cd-side-stack">
                <div className="cd-card">
                  <div className="cd-card-header">
                    <div>
                      <div className="cd-card-title">Table Management</div>
                      <div className="cd-card-subtitle">
                        {availableTables} available ·{" "}
                        {occupiedTableNumbers.size} occupied ·{" "}
                        {awaitingPaymentTableNumbers.size} awaiting payment
                      </div>
                    </div>
                  </div>
                  <div className="cd-table-grid">
                    {tables.map((table) => {
                      const key = String(table.table_number);
                      const awaitingPayment =
                        awaitingPaymentTableNumbers.has(key);
                      const occupied = occupiedTableNumbers.has(key);
                      return (
                        <button
                          key={table.id}
                          className={`cd-table-cell ${awaitingPayment ? "pay" : occupied ? "occupied" : "available"}`}
                          onClick={() => openTable(table.table_number)}
                        >
                          {table.table_number}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="cd-card">
                  <div className="cd-card-header">
                    <div>
                      <div className="cd-card-title">Checkout</div>
                      <div className="cd-card-subtitle">
                        Review the customer bill, print when needed, then
                        release the table manually.
                      </div>
                    </div>
                  </div>
                  <div className="cd-final-bill-panel">
                    {openDiningSessions.length === 0 ? (
                      <div className="cd-empty compact">
                        <div className="cd-empty-title">
                          No tables awaiting checkout
                        </div>
                        <div className="cd-empty-sub">
                          Eligible tables appear after all payments and kitchen
                          items are complete.
                        </div>
                      </div>
                    ) : (
                      <div className="cd-final-bill-session-list">
                        {openDiningSessions.map((session) => {
                          const reasons = [
                            session.pendingCount > 0
                              ? `${session.pendingCount} payment batch${session.pendingCount === 1 ? "" : "es"} pending`
                              : null,
                            session.incompleteItemCount > 0
                              ? `${session.incompleteItemCount} kitchen item${session.incompleteItemCount === 1 ? "" : "s"} incomplete`
                              : null,
                            session.verifiedTotal <= 0
                              ? "No paid payment batches"
                              : null,
                          ].filter(Boolean);
                          const canPrint = reasons.length === 0;
                          return (
                            <article
                              className="cd-final-bill-session"
                              key={session.diningSessionId}
                            >
                              <div className="cd-final-bill-session-top">
                                <div>
                                  <strong>
                                    Table {session.tableNumber ?? "-"}
                                  </strong>
                                  <span>{customerTypeLabel(session)}</span>
                                </div>
                                <span
                                  className={`cd-checkout-status ${canPrint ? "ready" : "blocked"}`}
                                >
                                  {canPrint
                                    ? "✓ Ready for Checkout"
                                    : "Not Yet Eligible"}
                                </span>
                              </div>
                              <div className="cd-checkout-card-summary">
                                <div>
                                  <small>Opened</small>
                                  <strong>{fmtTime(session.createdAt)}</strong>
                                </div>
                                <div>
                                  <small>Last Order</small>
                                  <strong>{fmtTime(session.latestAt)}</strong>
                                </div>
                                <div>
                                  <small>Items</small>
                                  <strong>{session.itemCount}</strong>
                                </div>
                                <div>
                                  <small>Invoices</small>
                                  <strong>{session.batches.length}</strong>
                                </div>
                              </div>
                              <div className="cd-checkout-paid">
                                <small>Paid Amount</small>
                                <strong>
                                  {fmtMoney(session.verifiedTotal)}
                                </strong>
                                <span>
                                  {[
                                    ...new Set(
                                      session.batches
                                        .filter(
                                          (batch) =>
                                            batch.invoiceStatus === "paid",
                                        )
                                        .map(
                                          (batch) =>
                                            batch.paymentMethod || "Other",
                                        ),
                                    ),
                                  ].join(" + ")}
                                </span>
                              </div>
                              {reasons.length > 0 ? (
                                <div className="cd-final-bill-warning">
                                  {reasons.join(". ")}
                                </div>
                              ) : null}
                              <button
                                type="button"
                                className="cd-review-bill-btn"
                                disabled={!canPrint}
                                onClick={() => {
                                  setCheckoutSession(session);
                                  setAdvancedPrinterOptions(false);
                                }}
                              >
                                Review Bill
                              </button>
                            </article>
                          );
                        })}
                      </div>
                    )}
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
                        {activeShift?.orders_processed ?? orders.length}
                      </div>
                    </div>
                    <div className="cd-shift-stat">
                      <div className="cd-shift-stat-label">
                        Payments Processed
                      </div>
                      <div className="cd-shift-stat-value">
                        {activeShift?.payments_processed ??
                          verifiedOrders.length}
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

            <section className="cd-pos-panel">
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
                              {table.label || `Table ${table.table_number}`}
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
                        found for Table {selectedTable}. Submitting will ask
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

      {drawerOrder && (
        <OrderDrawer
          order={drawerOrder}
          onClose={() => setDrawerOrder(null)}
          onApprove={
            isVerifiablePayment(drawerOrder)
              ? () => handleApprove(drawerOrder)
              : undefined
          }
          onReject={
            isVerifiablePayment(drawerOrder)
              ? () => handleRejectPayment(drawerOrder)
              : undefined
          }
          onRetry={
            drawerOrder.invoiceStatus === "pending"
              ? () => handleRequestRetry(drawerOrder)
              : undefined
          }
          approving={approvingId === (drawerOrder.invoiceId ?? drawerOrder.id)}
          paymentReference={paymentReference}
          paymentTransactionId={paymentTransactionId}
          paymentScreenshotUrl={paymentScreenshotUrl}
          paymentScreenshotPreviewUrl={paymentScreenshotPreviewUrl}
          duplicateReferenceNotice={duplicateReferenceNotice}
          ownerDuplicateOverride={ownerDuplicateOverride}
          paymentNote={paymentNote}
          onPaymentReferenceChange={(value) =>
            void handlePaymentReferenceChange(value)
          }
          onPaymentTransactionIdChange={(value) =>
            void handlePaymentTransactionIdChange(value)
          }
          onPaymentScreenshotFileChange={(file) =>
            void handlePaymentScreenshotFileChange(file)
          }
          onOwnerDuplicateOverrideChange={setOwnerDuplicateOverride}
          onPaymentNoteChange={setPaymentNote}
          formatMoney={fmtMoney}
        />
      )}

      {checkoutSession && checkoutBillModel && (
        <div className="cd-checkout-overlay">
          <section
            className="cd-checkout-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`Checkout Table ${checkoutSession.tableNumber ?? ""}`}
          >
            <header className="cd-checkout-header">
              <button type="button" onClick={() => setCheckoutSession(null)}>
                ← Back
              </button>
              <div>
                <strong>Table {checkoutSession.tableNumber ?? "-"}</strong>
                <span>✓ Ready for Checkout</span>
              </div>
              <button
                type="button"
                onClick={() => setCheckoutSession(null)}
                aria-label="Close checkout"
              >
                ×
              </button>
            </header>
            <div className="cd-checkout-layout">
              <aside className="cd-checkout-summary">
                <h2>Table Summary</h2>
                <dl>
                  <div>
                    <dt>Table</dt>
                    <dd>{checkoutSession.tableNumber ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>Customer Type</dt>
                    <dd>{customerTypeLabel(checkoutSession)}</dd>
                  </div>
                  <div>
                    <dt>Opened</dt>
                    <dd>{fmtTime(checkoutSession.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Last Order</dt>
                    <dd>{fmtTime(checkoutSession.latestAt)}</dd>
                  </div>
                  <div>
                    <dt>Total Items</dt>
                    <dd>{checkoutSession.itemCount}</dd>
                  </div>
                  <div>
                    <dt>Invoices</dt>
                    <dd>{checkoutSession.batches.length}</dd>
                  </div>
                </dl>
                <div className="cd-checkout-payment">
                  <small>Payment Status</small>
                  <strong>{fmtMoney(checkoutSession.verifiedTotal)}</strong>
                  <span>
                    Paid via{" "}
                    {checkoutBillModel.payments
                      .map((payment) => payment.method)
                      .join(" + ") || "recorded payment"}
                  </span>
                </div>
                <p>
                  All payments and kitchen items have been cleared. Printing is
                  optional; release the table only after the customer leaves.
                </p>
              </aside>
              <div className="cd-checkout-preview-wrap">
                <div className="cd-preview-label">Receipt Preview</div>
                <CheckoutReceiptPreview model={checkoutBillModel} />
              </div>
              <aside className="cd-print-controls">
                <h2>
                  {checkoutPrintHistory || checkoutBillModel.bill.printCount > 0
                    ? "Receipt Printed"
                    : "Ready to Print"}
                </h2>
                {checkoutPrintHistory ||
                checkoutBillModel.bill.printCount > 0 ? (
                  <div className="cd-print-history">
                    <span>Printed</span>
                    <strong>
                      {checkoutPrintHistory?.print_count ??
                        checkoutBillModel.bill.printCount}{" "}
                      {(checkoutPrintHistory?.print_count ??
                        checkoutBillModel.bill.printCount) === 1
                        ? "copy"
                        : "copies"}
                    </strong>
                    <small>
                      Last printed{" "}
                      {fmtDateTime(
                        checkoutPrintHistory?.printed_at ??
                          checkoutBillModel.bill.printedAt,
                      )}
                    </small>
                  </div>
                ) : (
                  <p>Review the bill carefully before printing.</p>
                )}
                <button
                  type="button"
                  className="cd-advanced-print"
                  onClick={() => setAdvancedPrinterOptions((open) => !open)}
                >
                  Advanced Printer Options{" "}
                  <span>{advancedPrinterOptions ? "⌃" : "⌄"}</span>
                </button>
                {advancedPrinterOptions ? (
                  <div className="cd-bill-format-toggle">
                    {(
                      ["80mm", "58mm", "a4", "browser"] as FinalBillFormat[]
                    ).map((format) => (
                      <button
                        key={format}
                        type="button"
                        className={billFormat === format ? "active" : ""}
                        onClick={() => setBillFormat(format)}
                      >
                        {format === "a4"
                          ? "A4"
                          : format === "browser"
                            ? "Browser"
                            : `${format} Thermal`}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="cd-printer-current">
                    Printer:{" "}
                    {billFormat === "a4"
                      ? "A4"
                      : billFormat === "browser"
                        ? "Browser"
                        : `${billFormat} Thermal`}
                  </div>
                )}
              </aside>
            </div>
            <footer className="cd-checkout-actions">
              <button
                type="button"
                className="cd-release-table-btn"
                onClick={() =>
                  void handleCloseDiningSessionFromBill(checkoutSession)
                }
                disabled={closingSessionId === checkoutSession.diningSessionId}
              >
                {closingSessionId === checkoutSession.diningSessionId
                  ? "Releasing…"
                  : "Release Table"}
              </button>
              <button
                type="button"
                className="cd-print-receipt-btn"
                onClick={() => void handlePrintFinalBill(checkoutSession)}
                disabled={
                  billWorkingSessionId === checkoutSession.diningSessionId
                }
              >
                {billWorkingSessionId === checkoutSession.diningSessionId
                  ? "Preparing Receipt…"
                  : checkoutPrintHistory ||
                      checkoutBillModel.bill.printCount > 0
                    ? "Reprint Receipt"
                    : "Print Receipt"}
              </button>
            </footer>
          </section>
        </div>
      )}

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
                  Active order found for Table {continuationChoice.tableNumber}
                </h2>
                <p>
                  {fmtOrderLabel(continuationChoice.activeOrder)} is{" "}
                  {statusLabel(continuationChoice.activeOrder.status)} with a
                  current total of{" "}
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

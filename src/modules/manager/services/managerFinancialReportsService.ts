import type { ReportingPeriodWindow } from "../../../core/analytics/historicalAnalytics";
import { supabase } from "../../../core/database";

export type ManagerReportQuality =
  | "complete"
  | "mixed_legacy"
  | "legacy_unknown"
  | "unavailable";

export type ManagerPaymentMethodTotal = {
  paymentMethod: string;
  collectedAmount: number;
  invoiceCount: number;
};

export type ManagerFinancialPeriod = {
  rangeStart: string;
  rangeEnd: string;
  collectedAmount: number;
  collectedInvoiceCount: number;
  outstandingAmount: number;
  outstandingInvoiceCount: number;
  refundAmount: number;
  refundedInvoiceCount: number;
  netCollection: number;
  subtotalAmount: number;
  discountAmount: number;
  serviceChargeAmount: number;
  refundedServiceChargeAmount: number;
  netServiceChargeAmount: number;
  vatAmount: number;
  refundedVatAmount: number;
  netVatAmount: number;
  averagePaidInvoice: number | null;
  ordersCreated: number;
  paymentMethods: ManagerPaymentMethodTotal[];
  dataQuality: {
    financialHistory: ManagerReportQuality;
    taxHistory: ManagerReportQuality;
    serviceChargeHistory: ManagerReportQuality;
    refundHistory: ManagerReportQuality;
  };
};

export type ManagerFinancialReport = {
  generatedAt: string;
  current: ManagerFinancialPeriod;
  comparison: ManagerFinancialPeriod;
  definitions: {
    collected: string;
    outstanding: string;
    refund: string;
    netCollection: string;
    ordersCreated: string;
  };
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const quality = (value: unknown): ManagerReportQuality => {
  if (
    value === "complete" ||
    value === "mixed_legacy" ||
    value === "legacy_unknown" ||
    value === "unavailable"
  ) return value;
  return "unavailable";
};

function parsePeriod(value: unknown): ManagerFinancialPeriod {
  const payload = record(value);
  const dataQuality = record(payload.data_quality);
  return {
    rangeStart: String(payload.range_start ?? ""),
    rangeEnd: String(payload.range_end ?? ""),
    collectedAmount: Number(payload.collected_amount ?? 0),
    collectedInvoiceCount: Number(payload.collected_invoice_count ?? 0),
    outstandingAmount: Number(payload.outstanding_amount ?? 0),
    outstandingInvoiceCount: Number(payload.outstanding_invoice_count ?? 0),
    refundAmount: Number(payload.refund_amount ?? 0),
    refundedInvoiceCount: Number(payload.refunded_invoice_count ?? 0),
    netCollection: Number(payload.net_collection ?? 0),
    subtotalAmount: Number(payload.subtotal_amount ?? 0),
    discountAmount: Number(payload.discount_amount ?? 0),
    serviceChargeAmount: Number(payload.service_charge_amount ?? 0),
    refundedServiceChargeAmount: Number(payload.refunded_service_charge_amount ?? 0),
    netServiceChargeAmount: Number(payload.net_service_charge_amount ?? 0),
    vatAmount: Number(payload.vat_amount ?? 0),
    refundedVatAmount: Number(payload.refunded_vat_amount ?? 0),
    netVatAmount: Number(payload.net_vat_amount ?? 0),
    averagePaidInvoice:
      payload.average_paid_invoice == null
        ? null
        : Number(payload.average_paid_invoice),
    ordersCreated: Number(payload.orders_created ?? 0),
    paymentMethods: Array.isArray(payload.payment_methods)
      ? payload.payment_methods.map((entry) => {
          const method = record(entry);
          return {
            paymentMethod: String(method.payment_method ?? "Other"),
            collectedAmount: Number(method.collected_amount ?? 0),
            invoiceCount: Number(method.invoice_count ?? 0),
          };
        })
      : [],
    dataQuality: {
      financialHistory: quality(dataQuality.financial_history),
      taxHistory: quality(dataQuality.tax_history),
      serviceChargeHistory: quality(dataQuality.service_charge_history),
      refundHistory: quality(dataQuality.refund_history),
    },
  };
}

export function parseManagerFinancialReport(value: unknown): ManagerFinancialReport {
  const payload = record(value);
  if (typeof payload.error === "string") throw new Error(payload.error);
  const definitions = record(payload.definitions);
  return {
    generatedAt: String(payload.generated_at ?? ""),
    current: parsePeriod(payload.current),
    comparison: parsePeriod(payload.comparison),
    definitions: {
      collected: String(definitions.collected ?? ""),
      outstanding: String(definitions.outstanding ?? ""),
      refund: String(definitions.refund ?? ""),
      netCollection: String(definitions.net_collection ?? ""),
      ordersCreated: String(definitions.orders_created ?? ""),
    },
  };
}

export function managerReportPercentageChange(current: number, comparison: number) {
  if (comparison === 0) return null;
  return ((current - comparison) / Math.abs(comparison)) * 100;
}

export async function loadManagerFinancialReport(
  restaurantId: string,
  window: ReportingPeriodWindow,
): Promise<ManagerFinancialReport> {
  const { data, error } = await supabase.rpc("get_manager_financial_report", {
    target_restaurant_id: restaurantId,
    range_start: window.rangeStart,
    range_end: window.rangeEnd,
    comparison_range_start: window.comparisonRangeStart,
    comparison_range_end: window.comparisonRangeEnd,
  });
  if (error) throw new Error(error.message);
  return parseManagerFinancialReport(data);
}


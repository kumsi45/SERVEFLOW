import { supabase } from "../../../core/database";
import { assertOwnerRetainedRequestAccess } from "./ownerRetainedResources";

export type OwnerFinancePaymentMethod = {
  methodIdentity: string | null;
  methodCode: string | null;
  displayLabel: string;
  classification:
    | "known_configured"
    | "legacy_unrecognized"
    | "unknown_unclassified";
  currentlyEnabled: boolean | null;
  collectedAmount: number;
  invoiceCount: number;
  sharePercent: number | null;
};

export type OwnerFinanceTrendBucket = {
  bucketStart: string;
  bucketLocalStart: string;
  collectedAmount: number;
  invoiceCount: number;
};

export type OwnerFinanceReadModel = {
  generatedAt: string;
  period: {
    start: string;
    end: string;
    comparisonStart: string;
    comparisonEnd: string;
    boundarySemantics: string;
    timezone: string;
    timezoneSource: string;
  };
  collections: {
    collectedAmount: number;
    collectedCount: number;
    comparisonAmount: number;
    comparisonCount: number;
    comparisonPercent: number | null;
  };
  obligations: {
    stateBasis: "current";
    pendingCount: number;
    pendingAmount: number;
    heldCount: number;
    heldAmount: number;
  };
  refunds: {
    refundedAmount: number;
    refundCount: number;
    comparisonAmount: number;
    comparisonCount: number;
  };
  netCollected: {
    amount: number;
    comparisonAmount: number;
    definition: string;
  };
  paymentMethods: OwnerFinancePaymentMethod[];
  cashierControl: {
    openShiftCount: number;
    openExpectedCash: number;
    openActualCash: null;
    closedShiftCount: number;
    reconciledShiftCount: number;
    reconciledExpectedCash: number;
    reconciledActualCash: number;
    nonzeroVarianceCount: number;
    varianceAmount: number;
    latestReconciliation: {
      closedAt: string;
      expectedCash: number;
      actualCash: number;
      variance: number;
    } | null;
    pendingDrawerExpenseCount: number;
    pendingDrawerExpenseAmount: number;
  };
  trend: {
    granularity: "hour" | "day" | "week" | "month";
    timezone: string;
    buckets: OwnerFinanceTrendBucket[];
  };
  quality: {
    financialSnapshots: string;
    legacySnapshotInvoiceCount: number;
    incompleteFrozenInvoiceCount: number;
    refundTiming: string;
    untimedRefundCount: number;
    paymentMethodAttribution: string;
    unknownPaymentMethodInvoiceCount: number;
    legacyUnrecognizedMethodInvoiceCount: number;
    timezone: string;
    cashReconciliation: string;
  };
};

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Owner Finance returned invalid ${label}.`);
  }
  return value as JsonObject;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Owner Finance returned invalid ${label}.`);
  }
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`Owner Finance returned invalid ${label}.`);
  }
  return value;
}

function optionalText(value: unknown, label: string): string | null {
  return value === null ? null : text(value, label);
}

function number(value: unknown, label: string): number {
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "string" && value.trim() === "")
  ) {
    throw new Error(`Owner Finance returned invalid ${label}.`);
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Owner Finance returned invalid ${label}.`);
  }
  return parsed;
}

function nullableNumber(value: unknown, label: string): number | null {
  return value === null ? null : number(value, label);
}

function booleanOrNull(value: unknown, label: string): boolean | null {
  if (value === null) return null;
  if (typeof value !== "boolean") {
    throw new Error(`Owner Finance returned invalid ${label}.`);
  }
  return value;
}

export function normalizeOwnerFinanceReadModel(
  value: unknown,
): OwnerFinanceReadModel {
  const root = object(value, "response");
  const period = object(root.period, "period");
  const collections = object(root.collections, "collections");
  const obligations = object(root.obligations, "obligations");
  const refunds = object(root.refunds, "refunds");
  const netCollected = object(root.net_collected, "net collected");
  const cashier = object(root.cashier_control, "cashier control");
  const trend = object(root.trend, "trend");
  const quality = object(root.quality, "quality");
  const latest = cashier.latest_reconciliation;
  const granularity = text(trend.granularity, "trend granularity");
  if (!["hour", "day", "week", "month"].includes(granularity)) {
    throw new Error("Owner Finance returned an unsupported trend granularity.");
  }
  const stateBasis = text(obligations.state_basis, "obligation state basis");
  if (stateBasis !== "current") {
    throw new Error("Owner Finance returned an unsupported obligation basis.");
  }
  if (cashier.open_actual_cash !== null) {
    throw new Error("Owner Finance returned actual cash for an open shift.");
  }

  return {
    generatedAt: text(root.generated_at, "generation time"),
    period: {
      start: text(period.start, "period start"),
      end: text(period.end, "period end"),
      comparisonStart: text(period.comparison_start, "comparison start"),
      comparisonEnd: text(period.comparison_end, "comparison end"),
      boundarySemantics: text(
        period.boundary_semantics,
        "boundary semantics",
      ),
      timezone: text(period.timezone, "timezone"),
      timezoneSource: text(period.timezone_source, "timezone source"),
    },
    collections: {
      collectedAmount: number(
        collections.collected_amount,
        "collected amount",
      ),
      collectedCount: number(collections.collected_count, "collected count"),
      comparisonAmount: number(
        collections.comparison_amount,
        "comparison amount",
      ),
      comparisonCount: number(
        collections.comparison_count,
        "comparison count",
      ),
      comparisonPercent: nullableNumber(
        collections.comparison_percent,
        "comparison percent",
      ),
    },
    obligations: {
      stateBasis,
      pendingCount: number(obligations.pending_count, "pending count"),
      pendingAmount: number(obligations.pending_amount, "pending amount"),
      heldCount: number(obligations.held_count, "held count"),
      heldAmount: number(obligations.held_amount, "held amount"),
    },
    refunds: {
      refundedAmount: number(refunds.refunded_amount, "refunded amount"),
      refundCount: number(refunds.refund_count, "refund count"),
      comparisonAmount: number(
        refunds.comparison_amount,
        "refund comparison amount",
      ),
      comparisonCount: number(
        refunds.comparison_count,
        "refund comparison count",
      ),
    },
    netCollected: {
      amount: number(netCollected.amount, "net collected amount"),
      comparisonAmount: number(
        netCollected.comparison_amount,
        "net collected comparison amount",
      ),
      definition: text(netCollected.definition, "net collected definition"),
    },
    paymentMethods: array(root.payment_methods, "payment methods").map(
      (entry, index) => {
        const method = object(entry, `payment method ${index + 1}`);
        const classification = text(
          method.classification,
          "payment method classification",
        );
        if (
          ![
            "known_configured",
            "legacy_unrecognized",
            "unknown_unclassified",
          ].includes(classification)
        ) {
          throw new Error(
            "Owner Finance returned an unsupported payment classification.",
          );
        }
        return {
          methodIdentity: optionalText(
            method.method_identity,
            "payment method identity",
          ),
          methodCode: optionalText(method.method_code, "payment method code"),
          displayLabel: text(method.display_label, "payment method label"),
          classification:
            classification as OwnerFinancePaymentMethod["classification"],
          currentlyEnabled: booleanOrNull(
            method.currently_enabled,
            "payment method enabled state",
          ),
          collectedAmount: number(
            method.collected_amount,
            "payment method amount",
          ),
          invoiceCount: number(
            method.invoice_count,
            "payment method invoice count",
          ),
          sharePercent: nullableNumber(
            method.share_percent,
            "payment method share",
          ),
        };
      },
    ),
    cashierControl: {
      openShiftCount: number(cashier.open_shift_count, "open shift count"),
      openExpectedCash: number(
        cashier.open_expected_cash,
        "open expected cash",
      ),
      openActualCash: null,
      closedShiftCount: number(
        cashier.closed_shift_count,
        "closed shift count",
      ),
      reconciledShiftCount: number(
        cashier.reconciled_shift_count,
        "reconciled shift count",
      ),
      reconciledExpectedCash: number(
        cashier.reconciled_expected_cash,
        "reconciled expected cash",
      ),
      reconciledActualCash: number(
        cashier.reconciled_actual_cash,
        "reconciled actual cash",
      ),
      nonzeroVarianceCount: number(
        cashier.nonzero_variance_count,
        "variance count",
      ),
      varianceAmount: number(cashier.variance_amount, "variance amount"),
      latestReconciliation:
        latest === null
          ? null
          : (() => {
              const row = object(latest, "latest reconciliation");
              return {
                closedAt: text(row.closed_at, "reconciliation close time"),
                expectedCash: number(
                  row.expected_cash,
                  "latest expected cash",
                ),
                actualCash: number(row.actual_cash, "latest actual cash"),
                variance: number(row.variance, "latest variance"),
              };
            })(),
      pendingDrawerExpenseCount: number(
        cashier.pending_drawer_expense_count,
        "pending drawer expense count",
      ),
      pendingDrawerExpenseAmount: number(
        cashier.pending_drawer_expense_amount,
        "pending drawer expense amount",
      ),
    },
    trend: {
      granularity: granularity as OwnerFinanceReadModel["trend"]["granularity"],
      timezone: text(trend.timezone, "trend timezone"),
      buckets: array(trend.buckets, "trend buckets").map((entry, index) => {
        const bucket = object(entry, `trend bucket ${index + 1}`);
        return {
          bucketStart: text(bucket.bucket_start, "trend bucket start"),
          bucketLocalStart: text(
            bucket.bucket_local_start,
            "trend local bucket start",
          ),
          collectedAmount: number(
            bucket.collected_amount,
            "trend collected amount",
          ),
          invoiceCount: number(bucket.invoice_count, "trend invoice count"),
        };
      }),
    },
    quality: {
      financialSnapshots: text(
        quality.financial_snapshots,
        "financial snapshot quality",
      ),
      legacySnapshotInvoiceCount: number(
        quality.legacy_snapshot_invoice_count,
        "legacy snapshot count",
      ),
      incompleteFrozenInvoiceCount: number(
        quality.incomplete_frozen_invoice_count,
        "incomplete snapshot count",
      ),
      refundTiming: text(quality.refund_timing, "refund timing quality"),
      untimedRefundCount: number(
        quality.untimed_refund_count,
        "untimed refund count",
      ),
      paymentMethodAttribution: text(
        quality.payment_method_attribution,
        "payment attribution quality",
      ),
      unknownPaymentMethodInvoiceCount: number(
        quality.unknown_payment_method_invoice_count,
        "unknown payment method count",
      ),
      legacyUnrecognizedMethodInvoiceCount: number(
        quality.legacy_unrecognized_method_invoice_count,
        "legacy payment method count",
      ),
      timezone: text(quality.timezone, "timezone quality"),
      cashReconciliation: text(
        quality.cash_reconciliation,
        "cash reconciliation quality",
      ),
    },
  };
}

export async function loadOwnerFinanceReadModel(input: {
  restaurantId: string;
  periodStart: string;
  periodEnd: string;
  comparisonStart: string;
  comparisonEnd: string;
}): Promise<OwnerFinanceReadModel> {
  const { data, error, status } = await supabase.rpc(
    "get_owner_finance_read_model",
    {
      target_restaurant_id: input.restaurantId,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      comparison_start: input.comparisonStart,
      comparison_end: input.comparisonEnd,
    },
  );
  assertOwnerRetainedRequestAccess(status);
  if (error) throw new Error(error.message);
  return normalizeOwnerFinanceReadModel(data);
}

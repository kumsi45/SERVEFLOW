# Manager Reports R2: financial reporting truth

R2 supplies the Manager Overview and Sales / Payments / VAT backend contract. It does not redesign the Reports UI or add Menu, Cashier, Kitchen, Staff, Inventory, Guest, Incident, Manager Decision, PDF, chart, or export reporting.

## Period and authority contract

The frontend passes the exact current and comparison half-open bounds produced by R1 `ReportingPeriodWindow`. The backend validates both ranges and rejects overlap. It does not perform a second timezone/date calculation.

`get_manager_financial_report` is a `security definer` RPC guarded by `manager_can_report(target_restaurant_id)`. That guard requires the authenticated user to have an active `manager` membership in the exact restaurant. Every invoice and order predicate also includes `target_restaurant_id`. Owner reporting RPCs are not reused and waiter, cashier, customer, anonymous, and cross-tenant callers receive no report data.

## Exact metric definitions

| Metric | Definition | Event timestamp |
| --- | --- | --- |
| Collected Amount | Frozen `grand_total` (falling back only to the invoice's stored `total_price`) for invoices with a canonical collection event. Status may be `paid` or later `refunded`; the original collection remains in its original event period. | `order_invoices.paid_at` |
| Collected Invoice Count | Count of those collection events. | `order_invoices.paid_at` |
| Outstanding Amount | Current stored amount of invoices created in the period that are still `pending` or `held`. | `order_invoices.created_at`, filtered by current state |
| Refund Amount | Full stored invoice amount for canonical refunded invoices whose refund event occurred in the period. ServeFlow does not currently store partial refund amounts. | `order_invoices.refunded_at` |
| Net Collection | `Collected Amount - Refund Amount`, with each side selected by its own event timestamp. | `paid_at` minus `refunded_at` event sets |
| Discounts | Sum of frozen invoice `discount_amount` on collection events. | `order_invoices.paid_at` |
| Service Charge | Gross frozen `service_charge_amount` on collection events. Refunded and net service-charge values are returned separately. | `paid_at` and `refunded_at` respectively |
| VAT / Tax | Gross frozen `vat_amount` on collection events. Refunded and net VAT values are returned separately. | `paid_at` and `refunded_at` respectively |
| Average Paid Invoice | `Collected Amount / Collected Invoice Count`; null when no invoice was collected. | `order_invoices.paid_at` |
| Orders Created | Operational order count, deliberately independent of invoice payment count. | `orders.created_at` |

Outstanding is explicitly a current-state answer for invoices created inside the selected period. It does not claim to reconstruct how much was outstanding at an earlier instant.

## Payment methods and comparison

Payment breakdown includes collection events only. Each bucket uses `normalize_payment_method(order_invoices.payment_method)` and the existing `Other` fallback for a missing method. Each bucket returns collected amount and invoice count. Unpaid invoices are excluded; a later-refunded invoice remains in its original collection bucket and its refund is reported separately.

The RPC returns the same factual metric object for the R1 current range and its R1 comparison range. The service exposes a percentage helper that returns `null` when the comparison value is zero; it does not invent infinity or a 100% change.

## Historical quality contract

No historical VAT or service charge is reconstructed from current rates, menu prices, or gross totals. R2 adds `order_invoices.financial_snapshot_version` without backfilling old rows, then defaults new invoices to `frozen_v1`. Existing rows remain deliberately unproven because migration 153 stored zero VAT/service-charge values for legacy history and no prior provenance marker can distinguish a true zero from an unknown historic value.

Each period returns these compact quality states for financial, tax, service-charge, and refund history:

- `complete`: all relevant rows carry explicit `frozen_v1` provenance.
- `mixed_legacy`: proven and legacy/un-timestamped evidence is mixed.
- `legacy_unknown`: relevant history exists but its original completeness cannot be proven.
- `unavailable`: no relevant event rows exist for that quality category.

The stored legacy number is returned unchanged alongside its flag. Legacy refunds without `refunded_at` cannot be placed into a reporting period and lower refund-history quality; they are never assigned a fabricated timestamp.

## Remaining limitations

- Refunds are full-invoice state/events; there is no immutable partial-refund amount ledger.
- Outstanding is mutable current state scoped by invoice creation period, not a historic balance snapshot.
- Pre-R2 financial provenance is conservatively unknown even when an old invoice may in fact contain valid frozen values.
- R2 does not expose profits, withdrawals, confidential financial settings, Owner analytics, or any later report domain.


# Manager Reports R1: reporting truth

This document defines the audited reporting contract for the Manager role. It does not redesign the Reports UI, add charts, create reporting tables, or grant access to Owner Reports.

## Canonical period contract

Manager Reports use `reportingPeriodWindow()` from `src/core/analytics/historicalAnalytics.ts`.

- Periods: `today`, `week`, `month`, `custom`.
- Timezone: the restaurant timezone from `restaurants.profile.timezone`; the current fallback remains `Africa/Nairobi` when no timezone is configured.
- Bounds: ISO `timestamptz` values with a half-open interval: `timestamp >= rangeStart AND timestamp < rangeEnd`.
- Today: current local calendar day; comparison is the previous local calendar day.
- Week: Monday through the following Monday; comparison is the previous calendar week.
- Month: first local day of the month through first local day of the next month; comparison is the previous calendar month.
- Custom: inclusive local start/end dates converted to an exclusive next-midnight end; comparison is the immediately preceding equal number of local calendar days.
- Invalid dates, reversed custom ranges, and invalid IANA timezones fail validation instead of silently changing the requested period.

Every reporting metric must also declare its event timestamp. Order creation, collection, kitchen completion, and dining-session closure are different events and must not be grouped under one generic date.

## Manager authority boundary

Managers may receive tenant-scoped operational facts needed to run the current restaurant: orders, collected and outstanding amounts, frozen invoice tax totals, payment methods, refunds/cancellations, cashier shifts/drawers/reconciliations/expenses/handovers, operational staff activity, kitchen facts, inventory movement, requests, guest service, and operational exceptions.

Managers do not inherit Owner reporting RPCs or owner-only administration. R2 must not expose profitability, withdrawals, subscription/billing administration, confidential financial configuration, owner/super-admin identities, or unrestricted historical administration. `manager_can_report()` requires an active Manager membership in the target restaurant. Shared canonical historical analytics separately permits an authorized Owner or Manager. Direct table reads used by the current Manager service are protected by same-restaurant RLS in addition to explicit `restaurant_id` filters.

## Source-of-truth map

| Domain | Canonical facts and event time | Current capability | Historical reliability and R2 gap |
| --- | --- | --- | --- |
| Overview | `orders.created_at` for volume; `order_invoices.paid_at` for collected money; `order_items.kitchen_completed_at` for served kitchen work; `orders.dining_session_closed_at` for closed sessions. Reusable RPC: `get_canonical_historical_analytics`. | Core totals exist and Manager is authorized. | Reliable only where canonical timestamps exist. The current canonical revenue aggregate includes refunded invoices as positive amounts, so R2 must report collected, refunded, and net values separately rather than treating that aggregate as net revenue. |
| Menu Performance | `order_items` joined to the frozen invoice/order lifecycle and canonical `menu_items`; quantity, item value, cancellations, and kitchen completion are factual. | No Manager menu-report RPC. Current Manager Reports has no item-level performance contract. | Current availability is stored on `menu_items.available`, but no availability history exists. R2 can distinguish sold quantity and zero sales, but cannot truthfully claim an item was available throughout a historical period. Historical names/prices also require frozen order-item evidence where available. |
| Sales & Payments / VAT | `order_invoices.paid_at`, `payment_status`, normalized `payment_method`, `subtotal`, `vat_rate`, `vat_amount`, `service_charge_amount`, `discount_amount`, `grand_total`, refund timestamps/reasons. | Collected, due, pending, refund totals and methods are partially assembled by the Manager service; canonical total RPC exists. | Frozen invoice financial fields are authoritative for newer invoices. Migration 153 backfilled legacy rows with zero VAT/service values, so old VAT cannot be reconstructed exactly. Do not reuse Owner financial RPCs or hardcoded tax math. A period-aware Manager financial RPC is missing. |
| Cashier & Shifts | `cashier_shifts.opened_at/closed_at`, immutable `cash_reconciliations`, invoice `cashier_shift_id`, `cashier_shift_expenses`, `cashier_cash_handovers`, and `shift_activity_logs`. Reusable RPCs: `get_manager_cashier_operations`, `cashier_shift_drawer_totals`. | Strong live/last-seven-days operational capability exists with Manager/Owner shift-admin authority. | Expense and handover history begins with migration 236. `get_manager_cashier_operations` has fixed today/seven-day windows and is not compatible with the shared report period; R2 needs a period-aware read RPC, not a duplicate ledger. |
| Kitchen | `order_items` milestone timestamps and `kitchen_station_id`; `kitchen_order_station_progress`; station identity from `kitchen_stations`; operational manager actions in `staff_activity_log`. | Current Manager report provides completed item duration and station summaries; `get_manager_operational_report` also returns kitchen rows. | Strict `kitchen_preparation_started_at` to `kitchen_completed_at` is trustworthy when both exist. Legacy fallbacks to `updated_at` in the old RPC can distort duration. There is no complete immutable event for every kitchen transition, so R2 must report supported milestones rather than a fabricated efficiency/productivity score. |
| Staff Operations | `restaurant_staff`, waiter table assignments, `orders.created_by_waiter_id`, payment verifier/cashier identity, kitchen staff/station identity, and `staff_activity_log`. | Manager can read non-owner operational staff and activity within the restaurant. Old report returns order counts and wait facts per waiter. | Factual assignments/actions/counts are reportable. Staffing quality, productivity, attendance duration, and performance scores are not derivable consistently. Assignment history and session timestamps are incomplete for older periods; Owner/Manager identities must remain outside staff ranking views. |
| Inventory | Immutable `inventory_movements.movement_date`, source/effect/type/quantity; `inventory_adjustments` and items; recipe deductions; purchase receipt records; `kitchen_inventory_requests` plus immutable request events. | Strong ledger and workflow sources exist, but no Manager period-report RPC combines them. | Movement history is reliable after the movement engine was introduced; earlier stock state cannot be reconstructed from current quantity. Waste/spoilage is factual only when recorded as a movement/adjustment. R2 must not infer historical consumption from current stock or legacy menu ingredient text. |
| Guests / Tables | Dining session open/close timestamps on `orders`; `restaurant_tables`; waiter assignments; `public_order_feedback`; `manager_customer_complaints`; waiter assistance requests and QR scan records. | Live guest/table supervision exists. The old report returns closed-session table duration. | Table sessions, feedback, complaints, and supported requests are factual. Orders are only a proxy for arrivals; party-size history and a durable customer identity are not consistently available. Do not label orders as guest count or fabricate customer retention. |
| Exceptions & Incidents | `order_cancellation_requests`, invoice refund/cancel fields, complaints, assistance requests, inventory request events, waste/adjustments, cash variances, handover discrepancies, and relevant activity logs. | Domain-specific exception evidence exists. | No unified incident model or common resolution taxonomy exists. R2 should aggregate supported domain events with provenance; it must not pretend every operational incident is captured. |
| Manager Decisions / Notes | `manager_ai_recommendation_decisions`, Manager-authored complaint actions, expense reviews, kitchen/customer actions, and `staff_activity_log`. | Specific Manager decisions are auditable. | There is no general Manager decision/note journal. R2 can show existing recorded decisions/actions but needs a separately authorized future design before offering general notes. AI recommendations are advisory and must not be reported as executed outcomes without the recorded decision/action evidence. |

## Current Manager Reports architecture

- Route: `ManagerOperationalReportsPage` under the Manager namespace.
- Data service: `loadManagerOperationalReport()` combines `get_manager_operational_report`, `get_canonical_historical_analytics`, and tenant-filtered reads from invoices, order items, and orders.
- Existing Manager RPC: `get_manager_operational_report` provides hourly order volume, table duration, waiter order/wait facts, station ticket facts, cancellation counts, and wait data.
- Existing canonical RPC: `get_canonical_historical_analytics` defines separate event timestamps for volume, collection, kitchen completion, and session closure.
- Realtime refresh currently subscribes to orders, items, invoices, waiter assignments, and staff.
- The existing page already contains charts and CSV/Excel/print controls from earlier work; R1 does not expand or redesign them.

## Confirmed limitations and missing backend capabilities

1. No period-aware Manager sales/payment/VAT RPC using frozen invoice totals and separate collected/refunded/net semantics.
2. No Manager menu-performance RPC and no historical menu-availability ledger.
3. No period-aware cashier/shift RPC; the current Manager cashier RPC is fixed to today/seven days.
4. No consolidated inventory reporting RPC over immutable movements, adjustments, deductions, receipts, and requests.
5. No complete kitchen transition event ledger for all historical state changes.
6. No unified exception/incident contract.
7. No general Manager decision/note journal.
8. No reliable historical party-size, guest identity, staff attendance-duration, profitability, or productivity-score source.
9. The legacy `get_daily_order_report` uses server-date conversion and order-level payment fields, excludes Managers from its role list, and is not a reusable R2 foundation.
10. The current operational RPC uses some lifecycle fallback timestamps and UTC-style buckets; R2 should use strict canonical event timestamps and explicit restaurant-local bucket labels.

## Exact R2 recommendation

R2 should implement one tenant-guarded, period-aware Manager reporting read model for Overview plus Sales & Payments/VAT only. It should accept the validated `rangeStart`, `rangeEnd`, `comparisonRangeStart`, and `comparisonRangeEnd`; aggregate frozen invoice financials by `paid_at`; return order volume separately by `created_at`; expose collected, outstanding, refunded, VAT, service charge, discounts, net collection, average paid invoice, payment methods, and explicit data-quality flags. It should reuse `manager_can_report`, normalized payment methods, and canonical invoice fields. R2 should not yet add Menu, Cashier, Kitchen, Staff, Inventory, Guests, Exceptions, Manager Notes, charts, PDF, or export work.

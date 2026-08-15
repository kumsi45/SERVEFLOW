# Manager Reports R3: menu and cashier reporting truth

R3 adds backend contracts for Menu Performance and Cashier / Shift reporting only. It does not change the Manager Reports UI or add Kitchen, Staff, Inventory, Guest/Table, Incident, Manager Decision, PDF, chart, or export reporting.

Both RPCs use `manager_can_report(target_restaurant_id)`. Only an authenticated user with an active Manager membership in the exact restaurant can receive results. Owner reporting RPCs and the broader live `has_shift_admin_role` authority are not used as the R3 report boundary.

## Menu Performance contract

Menu performance uses R1 current/comparison half-open bounds without another timezone implementation.

- Quantity sold: sum of `order_items.quantity` for items attached to invoices whose current `payment_status` is `paid`, selected by `order_invoices.paid_at`. Cancelled orders and `order_items.kitchen_status = 'cancelled'` are excluded. Unpaid, cancelled, and refunded invoices are excluded.
- Sales value: frozen `order_items.price * quantity`. It is line sales contribution before invoice-level VAT, service charge, or discount allocation; current `menu_items.price` is never used for history.
- Distinct orders: count of distinct `order_items.order_id` containing each item. It is not interchangeable with quantity or order-item row count.
- Rankings: Top Selling is ordered by quantity; Highest Sales Value is ordered separately by frozen line value. Low Selling includes only positive qualifying sales and states no cause.
- Comparison: each item and category returns current/comparison quantity and sales. Percentage change is null when the comparison value is zero.
- Categories: current tenant category identity groups qualifying frozen item lines into quantity, sales, order-item count, and distinct order count.

`Zero Recorded Sales` means no qualifying sales record in the selected period. It does not mean the item was available throughout the period. ServeFlow has no historical availability ledger. Current `Available`, `Sold Out`, or `Hidden` state is returned only as present-day context.

Frozen unit price and quantity are complete for qualifying modern item rows. Menu names and categories are current identities rather than frozen historical labels, so item/category identity history is marked `legacy_unknown` when sales exist. Availability history is always `unavailable` until a real availability-event ledger exists. A later full refund changes an invoice from paid to refunded, so its item lines no longer qualify as retained sales.

## Cashier / Shift contract

The cashier report reuses `cashier_shifts`, `cashier_shift_drawer_totals`, immutable `cash_reconciliations`, `cashier_shift_expenses`, `cashier_cash_handovers`, and `shift_activity_logs`. It does not create a second drawer formula or change `get_manager_cashier_operations`.

- Shift inclusion: a shift appears when its open-to-close interval overlaps the selected half-open period. This keeps an open shift visible even when it began earlier. A cross-boundary shift may therefore appear in multiple relevant period reports; its shift totals describe that entire shift.
- Closed shift truth: cash payments, cash refunds, expected cash, actual cash, and variance come from immutable `cash_reconciliations`.
- Open shift truth: live cash/non-cash sales, approved/pending expenses, and expected cash come from `cashier_shift_drawer_totals`. Actual cash and variance remain null, and status is `Open / Not Yet Reconciled`.
- Cash-only behavior: drawer cash is the existing normalized Cash calculation. Telebirr, CBE Birr, Card, Chapa, Mobile Banking, Mixed, and other non-Cash methods remain outside drawer cash.
- Expenses: each shift summary retains expense count plus approved, pending, and rejected amounts for that entire shift. A detailed record appears when created or reviewed in the period and retains amount, reason, note, cashier, recorder, reviewer, decision, rejection reason, and both timestamps.
- Handovers: a record appears when initiated or confirmed in the period and preserves outgoing/incoming identities, expected, declared, received, difference, status, notes, and both timestamps.
- Reconciliation: immutable rows are selected by `cash_reconciliations.closed_at`; shortages and overages remain signed variance facts and are not converted into expenses.
- Activity events: supported shift, expense, and handover audit events are selected by `shift_activity_logs.created_at`.

Expense and handover history begins with migration 236. Earlier activity cannot be reconstructed. Closed reconciliations do not contain non-cash totals; the shift row exposes the existing shift-attributed invoice projection for contextual non-cash sales, not drawer cash.

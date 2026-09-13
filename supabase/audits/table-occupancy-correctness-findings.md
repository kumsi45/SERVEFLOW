# Table occupancy correctness: migration authorization boundary

Status: root cause confirmed against hosted effective function definitions and a rollback-only reproduction. No production fix or migration has been applied.

## Exact trace

Owner `getOccupiedOwnerTableIds` reads `orders`: same restaurant, exact non-null `table_id`, `dining_session_status = 'open'`, `table_released_at IS NULL`, and non-cancelled status. Enablement and scan analytics are not inputs. The orders row is the dining session; there is no need for a separate session table to cause this bug.

`QRMenuPage.refreshActiveSession` calls `fetchSmartQrPortalState`, then (unless the portal is in waiter mode) `fetchPublicQrOrderSession`. The latter invokes the four-argument `get_public_qr_order_session`, which wraps `get_public_qr_order_session_p76_base`.

The hosted base function validates the restaurant/table/token/active flag, acquires a tenant/table advisory lock, and selects an open order. If none exists, it INSERTs an `orders` row with `status = 'pending'`, `total_price = 0`, the exact table ID, `order_source = 'public_qr'`, and `dining_session_status = 'open'`. There are no items or invoices. If a session exists, it mutates browser ownership/activity/expiry. For a different browser it can invoke `auto_release_dining_session_for_new_browser_scan` before creating another empty session.

This is a database lifecycle bug, not an Owner read-model bug. Hiding empty orders only in Owner would leave public portal, Waiter, Cashier and table-count/session authority inconsistent.

## Access-operation answers

- QR validation inside the lookup precedes, but is not itself, the session INSERT.
- `log_public_qr_scan` inserts only into `restaurant_table_qr_scans`; it does not create a session.
- `get_public_qr_menu` and its redacted base projection do not create sessions.
- `publicQrContext` generates/stores browser context locally; it does not call the database.
- `get_smart_qr_portal_state` does not create orders. It may register a browser subscription to an existing waiter order. Its stale-session expiry call is currently a no-op.
- `QRMenuPage` does not directly insert a session, but its initial/reconnect lookup causes the database INSERT above.
- Waiter creation has its own authenticated, tenant/assignment-validated real-order transaction; it does not need a QR visit to create its first order. Phantom QR orders nevertheless participate in shared open-session lookup and can affect staff workflows.
- Owner QR preview alone does not call the public session lookup; opening the resulting public menu does.

## Rollback reproduction

Run `node supabase/audits/table-occupancy-readonly-audit.cjs --rollback-reproduce` with the existing private `supabase/connection.env` configuration. Default mode only reads function definitions. The reproduction uses a new table fixture inside one transaction, runs public RPCs under `anon`, logs aggregate counts only, and always rolls back.

Hosted results:

| Event | Order rows | Open occupancy rows | Scan rows |
| --- | ---: | ---: | ---: |
| New fixture | 0 | 0 | 0 |
| Menu load and two scan logs | 0 | 0 | 2 |
| Smart portal lookup, mode available | 0 | 0 | 2 |
| Public order-session lookup | 1 | 1 | 2 |

The returned session had zero items and zero invoices. After ROLLBACK the fixture table no longer existed. No existing QR capability was rotated. This validates the defect, not a corrected migration.

## Required migration intent (not applied)

Make the public order-session lookup read-only with respect to occupancy: keep capability validation and existing-session projection, return NULL when no real session exists, and remove empty-order creation, activity/ownership updates and scan-triggered release from the lookup. Keep scan analytics separately intact.

First successful real-order submission should become the start boundary. `create_public_qr_order_p76_base` already validates nonempty, tenant-scoped available items and calculates the authoritative total before acquiring its advisory lock and creating the order/invoice/items in one transaction. Its wrapper chain must remain intact. Waiter creation must share the same location lock and canonical session lookup. Existing session reuse, different-browser rejection, released-session replacement and failed-order rollback require transactional/concurrency validation before deployment. Do not introduce React-based concurrency authority.

Primary affected function: `get_public_qr_order_session_p76_base`, behind the existing public wrapper. Review the QR and Waiter creation bases and their lock keys as part of validation; change them only if necessary. Tables involved: `orders`, `order_items`, `order_invoices`, `restaurant_tables`; analytics remain in `restaurant_table_qr_scans`. No RLS or QR authority change is intended.

Existing phantom rows need an explicit, narrowly scoped reconciliation plan. Do not delete history or silently close legitimate sessions; do not use zero price alone to identify phantom sessions. No historical cleanup was attempted.

## Release semantics to preserve

Hosted `is_public_qr_dining_session_open` is open + unreleased + non-cancelled, independent of payment or operational labels. Canonical `try_auto_release_settled_service_location` requires a valid physical table identity, at least one invoice, all invoices paid/cancelled/refunded, no nonterminal items (only completed/cancelled), and no other open unreleased session for that table. It acquires the location lock, revalidates, closes the session, stamps `table_released_at`, and writes an audit event. Payment or service labels alone must not be interpreted as release by UI code. The lookup's legacy browser-scan release must be removed from access, not replaced with a new release rule.

## Verification and limitations

17 selected existing regression files / 169 tests passed: Owner Tables 1/2A/2B/2C, P1A/P1B/P1C, workspace stability, development QR resolver, smart QR portal, customer tracking, Waiter order/lifecycle, Cashier settlement/obligations, canonical release and lifecycle.

`npm run build` passed its `tsc -b` and Vite production steps. Existing chunk-size/plugin-timing warnings remain. Audit script syntax and `git diff --check` passed.

No corrected-state regression matrix, concurrent hosted first-order submissions, browser journey or physical-phone retest has been certified: migration authorization is still required. Existing realtime consumers/coalescing, navigation, payment/release implementation, Print Center and Phase 2C.1 are unchanged.

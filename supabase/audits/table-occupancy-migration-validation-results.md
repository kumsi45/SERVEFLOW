# Occupancy migration preparation and rollback validation

Status: prepared and validated transactionally; NOT persistently deployed. Historical sessions are unchanged. Stop boundary reached.

## A–D. Migration and response contract

Prepared `261_public_qr_session_lookup_occupancy_side_effect_free.sql`. It replaces only `public.get_public_qr_order_session_p76_base(text,text,text,text)`.

The helper retains tenant/table/token/active validation, browser-ownership rejection and the existing session/items/invoices projection. Lookup uses immutable table ID. With no session, it returns SQL NULL. It no longer inserts an empty order, refreshes browser/activity/expiry fields, acquires a write lock, or invokes scan-driven release. Existing historical sessions are not hidden, modified or reconciled.

The three- and four-argument public wrappers continue to call this helper and enrich the payload. Both overloads returned truthful NULL in validation. Existing-session response retained the same real order ID, items and invoices. `normalizeSession(null)` and `QRMenuPage.setActiveSession(null)` already support this result; order submission does not require a preallocated order ID. No frontend adaptation was needed or made.

The migration aborts if the expected helper signature is missing. Applying it twice within the transaction produced the same definition and retained its OID and ACL. No GRANT/REVOKE or new overload is introduced.

## Creation-path map

The hosted read-only function scan found these direct `orders` INSERT functions:

| Function/path | Authority retained |
| --- | --- |
| `get_public_qr_order_session_p76_base` | Defective pre-order INSERT removed by prepared migration |
| `create_public_qr_order_p76_base` | Validates real items/total before table lock; creates/reuses order and creates invoice/items atomically |
| `create_waiter_order_p76_base` | Authenticated same-tenant Waiter/assignment validation; same location lock and real-order transaction |
| `create_cashier_order_phase156_base` | Effective cashier creation base; validates staff/table/items, INSERTs first order/invoice/items, protected by effective location-lock wrapper and unique indexes |
| `create_cashier_order_p77_base` | Retained historical real-order implementation; unchanged, with canonical triggers/indexes still enforced |
| `split_waiter_party` | Explicit authenticated relocation of named diners from an existing active session; legitimate stronger staff transition, not QR traffic; unchanged |

`create_public_qr_order` retains its payment-method, numbering, invoice-ownership and merge wrappers. `create_waiter_order` retains numbering and invoice ownership. `create_cashier_order` retains staff validation and location locking. `append_items_to_order` retains location locking, active-session append and `new_after_release` fallback. The generic `create_customer_order(text,jsonb)` remains retired and raises an error. QR-less obsolete public creation signature remains rejected. No creation path was rewritten.

## E–I. Hosted rollback results

All final validation assertions passed using temporary tenant/user/menu/table/shift fixtures inside a single transaction. Public operations ran as `anon`; Waiter/Cashier/Owner operations ran with the appropriate fixture JWT identity and authenticated role.

- Before access: Available.
- Menu load, repeated scan logging, two different browser contexts, smart portal and both session-lookup overloads: zero order rows, Available; scan count increased to two and last scan was populated.
- First successful QR order and first successful Waiter order: one Occupied canonical session with real content.
- Same-browser QR and Waiter additional orders reused their real order ID. QR-first then Waiter reused the session. Waiter-first then unrelated QR rejected without a duplicate.
- Cashier first order and active add-on worked. Attempting another cashier INSERT into the occupied table was rejected by existing unique protection. Cashier add-on after canonical release created a new session and retained previous-order identity/history.
- Invalid item, wrong/missing/cross-tenant QR and inactive QR submission failed without new occupancy. An injected SQL failure after a successfully evaluated real-order RPC rolled back its order/invoice/items, leaving no phantom row.
- Existing-session lookup returned the expected projection and left the complete order JSON unchanged.
- Paid invoice alone with unserved items remained Occupied. Completed service alone with unpaid invoice remained Occupied. Canonical settlement/completion/release made the table Available. Released history followed by a new QR order yielded a new order ID with exactly one active session.
- Disabled + existing active session remained Occupied. Disabled + no session remained Available. Inactive lookup, ordering and scan logging were rejected.
- Public menu redacted QR capability fields; anonymous table enumeration was denied. Regeneration used only a new fixture table: old fixture token failed, new token supported lookup and real ordering, and regeneration alone created no occupancy. NO existing business/demo table QR was rotated.
- Count reduction rejected a genuine unreleased fixture session. After canonical release, reduction succeeded, retained the historical restaurant identity and detached only the deleted table ID.

### Concurrency evidence and limit

Independent connections held the exact tenant/location advisory lock while the real QR and Waiter first-order RPCs ran in the fixture transaction. PostgreSQL `pg_locks` confirmed each RPC waiting for that lock; after release each completed with one occupied session. Both winner orderings, existing-session reuse and duplicate-INSERT rejection were tested. Hosted unique indexes on `(restaurant_id, table_number)` and `(restaurant_id, table_id)` for open sessions remain unchanged.

This is real lock-contention evidence, not certification of two fully concurrent business-order transactions. Uncommitted fixture tenants and the migration are invisible to a second business-order connection. Committing hosted fixtures would violate the authorization boundary. Docker's local daemon was unavailable. Full simultaneous two-QR and Waiter+QR payload outcomes therefore remain an isolated-environment verification item before deployment certification; no production fixture commits were used to bypass that limit.

## J–L. Reconciliation predicate and plan — NOT executed

The read-only `--candidates` audit defines a deliberately conservative review candidate:

`public_qr` source; `pending`/`new`; open and unreleased; exact valid tenant/table identity; zero total; Cash; browser/scan markers present; no customer user/content or Waiter actor; no preparation, payment, completion, bill, cleaning, lock or release evidence; no other unreleased session for the table; and no direct order/session/history references.

Reference exclusions are discovered from actual public schema columns (`order_id`, `dining_session_id`, and generic `entity_id`/`record_id`/`target_id`). They include items, invoices, invoice-payment audit, bills, inventory records, station progress, complaints, cancellation, feedback, receipts, shift activity, portal subscriptions and assistance/batch requests. Zero price alone is never a cleanup predicate. Staff split sessions and orders with real items/invoices/history are excluded.

Aggregate hosted impact at audit time:

| Population | Count | Restaurants | Oldest/newest UTC |
| --- | ---: | ---: | --- |
| Conservative no-history review candidates | 0 | 0 | None |
| Broad empty open public-QR sessions, NOT safe cleanup candidates | 7 | 3 | 2026-07-26 09:13:21.436 / 2026-09-13 13:14:09.620 |

All seven broad lookalikes had shift-activity history. Their shape matches pre-order lookup creation, but there is no explicit reliable function-origin provenance sufficient to certify automatic remediation. The conservative predicate does not prove phantom provenance even if it later returns rows.

Recommended plan: prevent new phantoms only and leave existing records unchanged. Do not DELETE, detach, fabricate invoices, or bypass the canonical release evaluator: that evaluator requires at least one invoice and rejects an empty session. Any future reconciliation requires separately authorized, per-session history review and a lifecycle/constraint-consistent audited plan, rechecking under the location lock immediately before mutation. No reconciliation SQL is included in migration 261 and no cleanup was run.

## M–N. Verification and unresolved risks

- 19 focused regression files / 181 tests passed, including the new lookup migration/Owner-authority tests, public QR contracts/tracking, Waiter creation/lifecycle, Cashier settlement/obligations, release, Owner Tables 1/2A/2B/2C, development QR resolver, P1A/P1B/P1C and workspace stability.
- `npm run build` passed TypeScript (`tsc -b`) and Vite production build; existing chunk-size warning remains.
- Both audit scripts passed `node --check`; PostgreSQL parsed and executed the exact final migration twice inside rollback validation; `git diff --check` passed.
- Final rollback assertions verified the original hosted helper definition/ACL and absence of fixture restaurants. All migration/fixture effects were rolled back; scripts contain no COMMIT.
- Source-contract/unit results are distinct from hosted transactional assertions. No authenticated browser or physical-phone journey was certified.
- Remaining risks: full simultaneous two-business-client certification, historical phantom ambiguity/unchanged occupancy, and post-deployment browser verification if deployment is later authorized.

No production frontend change, persistent deployment, historical cleanup, RLS/security redesign, QR authority change, payment/release redesign, realtime/channel/polling change, navigation redesign or Phase 2C.1 work.

## Reproduction commands

- `node supabase/audits/table-occupancy-readonly-audit.cjs --creation-map` — read-only effective creator map.
- `node supabase/audits/table-occupancy-migration-validation.cjs --inspect` — read-only schema/reference/index inspection.
- `node supabase/audits/table-occupancy-migration-validation.cjs --candidates` — read-only anonymized reconciliation audit.
- `node supabase/audits/table-occupancy-migration-validation.cjs` — applies migration twice and validates fixture workflows, then ROLLBACK; never deploys persistently.

Private database configuration is read from existing `supabase/connection.env`; capability values, identities and connection credentials are not printed.

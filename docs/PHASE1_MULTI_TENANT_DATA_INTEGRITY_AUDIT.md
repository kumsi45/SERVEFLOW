# Phase 1 Multi-Tenant Data Integrity Audit

Date: 2026-07-16

## Verdict

The repository is tenant-scoped at its query, RPC, aggregation, storage, and
realtime call sites after migration 138. Production reaches the same state only
after migration 138 is applied and its deployment assertions pass.

ServeFlow's authoritative tenant key is `restaurant_id`. Browser-provided IDs
are defense-in-depth filters; database RLS and RPC membership checks remain the
security boundary.

## Coverage

Reviewed surfaces:

- Owner, manager, cashier, kitchen, waiter, inventory, and customer QR flows
- Direct Supabase table and storage calls
- RPC call sites and their effective latest definitions
- Owner/manager reports, revenue, operational analytics, inventory forecasts,
  kitchen metrics, customer metrics, search, exports, and AI input datasets
- Auth sessions and per-tab active-restaurant state
- All Postgres Changes channel definitions
- Both Edge Functions, including service-role operations
- All tenant-bearing tables and their RLS posture across migrations 001-138

## Findings and fixes

### MT-001 — Unfilterable realtime delete events (high)

Owner, manager, cashier, kitchen, waiter, inventory, and public QR channels use
`event: "*"` with a `restaurant_id` filter. Supabase cannot filter Postgres
Changes `DELETE` events, and deleted rows cannot be authorized through RLS.

Fixed in migration 138 by restricting `supabase_realtime` to `INSERT` and
`UPDATE`. ServeFlow already models user-facing removal with archive/active
fields, so tenant delete payloads have no valid client use case.

### MT-002 — Subscription to a nonexistent tenant relation (medium)

The customer QR page subscribed to `dining_sessions`, although this schema
stores dining-session lifecycle on `orders`. This could create channel errors
and a false assumption that session isolation was being monitored.

Fixed by removing the invalid listener. The existing restaurant-filtered
`orders`, `order_items`, `order_invoices`, and `restaurant_tables` listeners are
the canonical customer session inputs.

### MT-003 — No automatic schema-drift gate (high)

Earlier audits depended on hand-maintained table lists. A newly introduced
tenant table could omit a non-null tenant key, RLS, or policies without failing
deployment.

Fixed in migration 138 with a catalog-driven deployment assertion covering
every current or future public table containing `restaurant_id`. Deployment now
fails if `restaurant_id` is nullable or RLS is disabled. Zero policies is a
valid deny-all posture for internal tables; client-visible tables use explicit
tenant policies. A service-role-only `tenant_isolation_verification` view
provides production evidence without exposing tenant data.

## Surface results

| Surface | Result | Isolation evidence |
| --- | --- | --- |
| Owner dashboard | Pass | Direct reads/writes filter `restaurant_id`; owner reports authorize the target restaurant. |
| Manager dashboard/modules | Pass | Services filter all source tables; manager RPCs validate active same-restaurant membership. |
| Cashier | Pass | Queue, shifts, orders, items, invoices, tables, and logs are restaurant-scoped. |
| Kitchen | Pass | Context and station queues bind restaurant plus active staff/station membership. |
| Waiter | Pass | Slug/order inputs resolve to an authenticated waiter membership before returning data. |
| Customer QR | Pass | Public RPCs bind slug, table, QR token, browser session, and order restaurant relationships. |
| Reports/exports | Pass | Source queries/RPCs accept and authorize a restaurant; derived CSV/UI rows use only those results. |
| AI assistant | Pass | AI recommendations are deterministic calculations over manager-scoped tenant datasets; decisions carry `restaurant_id`. |
| Inventory | Pass | Tables, requests, events, RPC authorization, forecasts, and realtime inputs are tenant-scoped. |
| Notifications | Pass | Notifications are UI-derived from tenant-scoped rows; there is no shared notification table/cache. |
| Realtime | Pass after 138 | Every channel has a restaurant filter; publication emits only filterable INSERT/UPDATE changes. |
| Search | Pass | Business-identifier and menu searches resolve/authorize the target restaurant. |
| Analytics/revenue | Pass | Aggregations operate only on restaurant-filtered orders/invoices/items. |
| Sessions | Pass | Supabase auth uses `sessionStorage`; active restaurant keys include role and QR state includes restaurant/session context. |
| React Query cache | Not present | React Query is not a dependency and no query client/keys exist. Component state is tenant-instance-local. |
| Edge Functions | Pass | `manage-staff` derives the caller identity from JWT and verifies active membership before service-role access; every target is checked against that restaurant. `owner-signup` creates a new tenant boundary. |

## Production verification

After applying all migrations, run with a service-role database connection:

```sql
select *
from public.tenant_isolation_verification
where not restaurant_id_not_null
   or not rls_enabled;
```

Expected result: zero rows. Migration 138 performs the same checks and aborts
before completion if any violation exists.

Also verify the publication:

```sql
select pubinsert, pubupdate, pubdelete, pubtruncate
from pg_publication
where pubname = 'supabase_realtime';
```

Expected: `true, true, false, false`.

Finally, execute a two-tenant authenticated test matrix in staging: attempt
same-table reads, guessed-ID reads, RPC calls, writes, storage paths, and live
updates from tenant A against tenant B. Each request must return no rows or an
authorization error, and no websocket payload may arrive. Static repository
review cannot substitute for this deployed adversarial test.

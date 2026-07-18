# Phase 6 Authentication, Session, and Multi-Tenant Isolation Audit

Date: 2026-07-16
Severity: P0 production blocker

## Root cause

Phase 5 replaced tab-scoped staff authentication with one durable `localStorage` session named `serveflow-staff-auth`. All tabs on the origin shared that Supabase token. A Kitchen sign-in replaced the token observed by already-open Owner, Manager, and Cashier tabs. Their route state remained unchanged, but every subsequent auth event/query used the Kitchen identity, making dashboards redirect or render the newly authenticated role/restaurant.

A second independent regression existed in Customer QR storage: opening any new QR scan used one global active-session marker and deleted cart/context/checkout entries belonging to every restaurant. Waiter offline orders likewise shared one global queue.

## Corrections

- Staff Supabase sessions now use `sessionStorage` plus a cryptographically random tab identifier in the `storageKey`. Tabs cannot read or mutate one another's auth session.
- Role restaurant selection remains in role-namespaced `sessionStorage` and is accepted only if present in the JWT-authorized active membership list.
- Waiter Supabase auth has a separate per-tab key. Public discovery does not persist authentication.
- Waiter login now revalidates the exact authenticated `staff_id + user_id + restaurant_id + waiter role + active state` before recording login or storing the session.
- Waiter offline queues are keyed and synchronized by normalized restaurant slug.
- Customer QR active-session markers and cleanup are scoped by restaurant slug. Restaurant B cannot delete Restaurant A browser state.
- Cashier receipt preferences are scoped by restaurant ID.
- Migration 143 removes all PostgreSQL `format()` calls from Owner AI insights and uses typed concatenation, preventing placeholder-count crashes.

## Auth client matrix

| Client | Persistence | Storage namespace | URL detection | Token refresh | Isolation |
| --- | --- | --- | --- | --- | --- |
| Staff Owner/Manager/Cashier/Kitchen | Current tab, survives refresh | `serveflow-staff-auth:<random-tab-id>` in sessionStorage | Enabled for password recovery | Enabled | Per tab; role/restaurant rechecked by guards and RLS |
| Waiter authenticated | Current tab, survives refresh | `serveflow-waiter-auth:<random-tab-id>` in sessionStorage | Disabled | Enabled | Per tab plus exact restaurant membership validation |
| Waiter discovery | None | `serveflow-waiter-public-auth` | Disabled | Disabled | No JWT/session inheritance |
| Customer QR | No Supabase auth session | Restaurant/session-prefixed browser records | Not applicable | Not applicable | Restaurant slug, session, table and QR token scoped |

## Manual validation matrix

Open each row in its own tab in one browser context. After every login, refresh every previously opened tab and confirm its role, restaurant name, JWT user, route, queries, and realtime channel remain unchanged.

| Restaurant | Owner | Manager | Cashier | Kitchen | Waiter |
| --- | --- | --- | --- | --- | --- |
| A | A-Owner | A-Manager | A-Cashier | A-Kitchen | A-Waiter |
| B | B-Owner | B-Manager | B-Cashier | B-Kitchen | B-Waiter |

Required permutations include A-Owner then A-Kitchen; A-Owner then B-Kitchen; A-Manager then B-Cashier; A/B same role; all ten tabs simultaneously; sign-out in each individual tab; refresh/reconnect of every remaining tab; and duplicate waiter usernames in A/B. A waiter credential must succeed only under its own restaurant slug.

The executable version is `tests/e2e/auth-isolation.spec.ts`. Supply `SERVEFLOW_AUTH_MATRIX_JSON` with exactly ten disposable fixtures. It verifies all routes, ten distinct auth namespaces, refresh persistence, and captures one screenshot per role/restaurant.

## Automated proof

- Source contract verifies staff auth uses no shared localStorage session.
- Route contract verifies active restaurant state is role- and tab-scoped.
- Waiter contract verifies authenticated restaurant membership and tenant-scoped offline queues.
- QR contract verifies cleanup matches only the current restaurant.
- Historical migration scan verifies no PostgreSQL `format()` remains in either fresh-install or deployed AI definitions.
- Protected Owner, Manager, Cashier and Kitchen guards query active membership for the requested restaurant under the current tab JWT.
- Realtime source contracts verify restaurant filters and channel cleanup.
- Supabase linked lint reports zero function errors after migration 143.

## Files changed

- `src/core/database/supabaseClient.ts`
- `src/modules/waiter-auth/services/waiterAuthService.ts`
- `src/modules/waiter-order/services/waiterOrderService.ts`
- `src/modules/waiter-dashboard/pages/WaiterDashboardPage.tsx`
- `src/modules/public-qr-ordering/services/publicQrContext.ts`
- `src/modules/cashier/pages/CashierDashboardPage.tsx`
- `supabase/migrations/094_phase_o102_ai_business_intelligence.sql`
- `supabase/migrations/139_canonical_historical_analytics.sql`
- `supabase/migrations/143_phase6_safe_ai_insight_formatting.sql`
- `tests/unit/auth-isolation.test.ts`
- `tests/e2e/auth-isolation.spec.ts`
- `docs/TENANCY.md`
- `docs/SECURITY.md`

## Validation limitation

The ten-account browser test is credential-gated and is reported as skipped when disposable A/B credentials are absent. Static contracts, TypeScript, build, migration application, database lint, and non-credential regressions do not substitute for this final live matrix.

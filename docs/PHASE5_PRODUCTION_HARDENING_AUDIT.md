# ServeFlow Phase 5 Production Hardening Audit

Date: 2026-07-16

## Outcome

Phase 5 added no business features. It hardened the existing tenant, lifecycle, analytics, realtime, session, storage, database, performance, and regression architecture. The linked database is migrated through version 142.

Production readiness score: **86/100**. Code, database lint, migrations, TypeScript, build, and locally runnable regressions pass. The remaining 14 points require execution of the credential-gated four-restaurant and authenticated browser workflows in a disposable staging project; skipped tests are not counted as verified.

## Problems discovered and fixed

1. Five deployed PL/pgSQL paths failed `supabase db lint` runtime validation: ambiguous identifiers in waiter assignment, payment retry, kitchen queue and public QR lifecycle, plus text-to-enum writes in both kitchen pause overloads. Migrations 140 and 141 preserve signatures and grants while repairing the functions. Remote lint now reports no errors; remaining findings are unused-variable/parameter warnings.
2. Feedback photos used a public Storage bucket with blanket public SELECT. Migration 142 makes the bucket private, restricts reads to same-restaurant Owner/Cashier membership, normalizes legacy URLs to object paths, and enforces the restaurant path prefix.
3. Staff auth used `sessionStorage`, preventing browser-restart/new-tab restoration. The shared Supabase client now uses durable `localStorage` under the isolated `serveflow-staff-auth` key. Waiter and public clients retain separate keys.
4. Eight Manager pages duplicated tenant subscriptions and only reloaded on change events. `useTenantRealtime` now owns tenant filtering, burst debouncing, subscribe/reconnect refresh, online recovery, visibility/wake recovery, timer cleanup, listener cleanup, and channel removal.
5. Customer QR implemented tracking step/message/ETA mappings in its page. Those mappings now live in `core/payment/lifecycle.ts` beside the canonical operational mapper.
6. Protected role dashboards were eagerly included in the entry bundle. Role workspaces are now lazy-loaded with a stable Suspense fallback. The main JS asset fell from approximately 978 KB to 440 KB uncompressed; Owner is an independent 189 KB chunk.
7. Manager Operations Center serialized two independent network batches. Dashboard, staff, inventory requests, and inventory items now load in one `Promise.all`.
8. Regression coverage only modeled two tenants. The guarded integration matrix now models restaurants A/B/C/D and cross-checks orders, items, invoices, staff, notifications, inventory, and kitchen requests for every foreign-tenant pairing.

## Canonical service enforcement

- Lifecycle and payment UI: `src/core/payment/lifecycle.ts`
- Historical analytics and timezone windows: `src/core/analytics/historicalAnalytics.ts`
- Currency: `src/core/format/currency.ts`
- Realtime recovery for Manager data surfaces: `src/core/realtime/useTenantRealtime.ts`
- Active restaurant selection remains role-scoped and is validated against authenticated restaurant memberships before rendering protected routes.

Kitchen continues to consume operational state only. Historical revenue uses `paid_at`, order volume uses `created_at`, kitchen completion uses `kitchen_completed_at`, and dining closure uses `dining_session_closed_at` through the canonical analytics RPC.

## Security and multi-tenant verification

- Migrations 138 and 142 enforce structural tenant checks, private feedback media, tenant-prefixed paths, RLS-aware staff reads, and a realtime publication that excludes unsafe DELETE/TRUNCATE payloads.
- Security-definer functions repaired in 140-141 retain fixed `search_path`, authentication/role checks, original signatures, and original grants.
- Remote database lint: zero errors after migrations 140-142.
- Remote migration history: local and remote versions match through 142.
- Four-tenant live verification is implemented but requires the documented A/B/C/D staging tokens and IDs. It was skipped in this run because those fixtures were not supplied.

## Realtime and recovery verification

All audited subscriptions carry `restaurant_id=eq.<active restaurant>` filters and remove their channel on cleanup. Manager subscriptions additionally recover on SUBSCRIBED, browser `online`, and visible-tab wake, with debouncing to prevent duplicate fetch bursts. Customer, Waiter, Cashier, Kitchen and Owner retain their existing filtered subscriptions and cleanup paths.

The authenticated browser reconnect/offline/multi-device suite is environment-gated. Source contracts pass; end-to-end staging execution remains required for production sign-off.

## Database migrations

- `140_phase5_database_function_stabilization.sql`: deterministic legacy PL/pgSQL resolution and type-safe kitchen activity writes.
- `141_phase5_waiter_assignment_upsert_stabilization.sql`: binds waiter assignment upsert to its live unique constraint.
- `142_phase5_feedback_storage_tenant_isolation.sql`: private tenant-scoped feedback media and path constraint.

All three migrations were applied successfully to the linked Supabase project.

## Verification results

- `npm run test:regression`: 38 PASS, 0 FAIL, 39 SKIP.
- Unit/source-contract tests: 36 PASS.
- Playwright smoke: 2 PASS with desktop/mobile screenshots.
- TypeScript: PASS via `tsc -b` in the production build.
- Production Vite build: PASS.
- `git diff --check`: PASS.
- Supabase linked database lint: PASS with no errors.

Skipped items require seeded authenticated URLs and four disposable restaurant identities. They cover staff workflows, offline/reconnect/browser restart, simultaneous devices, live payment policies, and live cross-tenant RLS. See `tests/README.md` and `test-results/REGRESSION_REPORT.md`.

## Files modified in Phase 5

- `src/app/router/RoleNamespaceRoute.tsx`
- `src/core/database/supabaseClient.ts`
- `src/core/payment/lifecycle.ts`
- `src/core/realtime/useTenantRealtime.ts`
- `src/modules/manager/pages/ManagerAiOperationsPage.tsx`
- `src/modules/manager/pages/ManagerCustomerExperiencePage.tsx`
- `src/modules/manager/pages/ManagerDashboardPage.tsx`
- `src/modules/manager/pages/ManagerKitchenSupervisionPage.tsx`
- `src/modules/manager/pages/ManagerOperationalReportsPage.tsx`
- `src/modules/manager/pages/ManagerOperationsCenterPage.tsx`
- `src/modules/manager/pages/ManagerRestaurantIntelligencePage.tsx`
- `src/modules/manager/pages/ManagerStaffOperationsPage.tsx`
- `src/modules/public-qr-ordering/services/publicQrOrderService.ts`
- `src/modules/qr-menu/pages/QRMenuPage.tsx`
- `tests/integration/supabase-regression.test.ts`
- `tests/unit/lifecycle.test.ts`
- `tests/unit/source-contracts.test.ts`
- `tests/report/resolved-regressions.json`
- migrations 140-142

## Deferred production sign-off gates

No Inventory, Supplier, Purchasing, or other business capability was added. Full production sign-off must not be declared until the 39 skipped staging tests run with zero failures and authenticated desktop/tablet/mobile screenshots are reviewed for every role. A destructive fresh-install replay was not run against the linked production database; it belongs in a disposable database created from the complete migration chain.

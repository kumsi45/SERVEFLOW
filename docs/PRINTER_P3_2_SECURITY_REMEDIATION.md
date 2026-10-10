# Printer P3.2 security remediation candidate

Status: **DEPLOYMENT BLOCKED**. No migration, function, scheduler, or secret was deployed.
Migration 273 remains unchanged. Candidate Migration 274 must be installed before these
Edge functions; deploying the functions first makes setup start fail closed.

## Root causes and changes

| Issue | Root cause | Candidate remediation |
| --- | --- | --- |
| Shared redemption budget | Every syntactically valid random pairing ID spent the same 600/hour Redis bucket before proof validation. | A per-pair budget runs first. Only an approved, unexpired pairing with a matching proof can spend the 10,000/hour emergency budget. Invalid IDs do not consume unrelated pair or emergency budgets. The previous transport-peer budget was removed because gateway proxy collisions could exhaust it. |
| Shared start budget | A signed setup token spent a 300/hour global budget; digest-key rotation changed the bucket. | Each signed token has its own Redis budget, PostgreSQL makes the one-use decision, and a high-capacity emergency budget uses a separate stable rate key. |
| Ephemeral token replay guard | Redis eviction or restart removed the only consumed-token record. | Migration 274 stores a unique HMAC setup digest and creates the pairing and event in one SQL transaction. A collision rolls back the pairing and event. The former service-role start RPC is revoked. Redis remains a fail-closed abuse dependency, not the one-use authority. |

The backend returns the same unavailable response for absent, expired, cancelled,
and wrong-proof pairing identities. The bridge body is bounded to 2,048 bytes and
the HTTP helper returns no-store errors. A known consumed or invalid setup claim
returns 403; other database failures return 503. Caller-supplied forwarding
headers are ignored. A verified upstream per-client source rule is required
before deployment; the Edge function does not charge a shared proxy bucket.

## Critical integration prerequisites

1. Provision a disposable Supabase project with Auth, PostgreSQL, Edge Functions,
   Migrations 271–274, two disposable restaurants and Owners, and disposable bridge
   identities. Use a separate Upstash Redis REST database with no eviction of live
   keys. Do not load `.env.local` or production restaurant data.
2. Configure and verify a per-client rate rule at a trusted upstream gateway.
   `Deno.serve` connection metadata identifies the connection peer, which may be a
   shared proxy behind Supabase's gateway. Do not use arbitrary forwarding headers
   in the function. Verify spoofed headers and shared-proxy traffic at the gateway;
   absent that rule, per-source abuse protection is a deployment blocker.
3. Exercise actual HTTP `OPTIONS`, missing/invalid/expired JWT, Owner membership,
   cross-tenant approval/cancellation/revocation, public start/redeem, and
   reconciliation with and without the maintenance secret. Confirm that Owner
   gateway JWT verification is enabled and bridge/reconcile gateway JWT verification
   is disabled exactly as configured.
4. Exercise first/repeated/concurrent setup use, old signing key after rotation,
   Redis flush/restart/outage, expired token, cancelled pairing, cross-restaurant
   approval, two concurrent redemptions, and all Auth/SQL partial-failure cases in
   the readiness review. Capture HTTP status, SQLSTATE, pairing/event/agent rows,
   Auth identities, Redis effects, and cleanup evidence for each case.
5. Run a real Upstash `EVAL` and confirm atomic counters, no-eviction policy, TLS,
   failures returning 503, source isolation, and emergency-budget saturation alarms.

The Windows Supabase CLI fails `supabase status` and `supabase start` with
`EUNKNOWN: unknown error, uv_spawn`. A Linux-container CLI reached Docker, but
the repository's fresh migration chain failed at 015; an isolated compatibility
copy later failed at 028. See the P3.2.1 report. Isolated Redis credentials are
not present. Unit tests and Deno checks are not integration certification.

## Operational deployment checklist

- Review Migration 274's SQL, grants, RLS, rollback path, and fresh-chain replay in
  an isolated database. Apply 274 before any P3.2 function. Never amend 271–273.
- Supply `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `PRINT_BRIDGE_DIGEST_KEYS`, `PRINT_BRIDGE_RATE_KEY` (independent 32-byte base64url
  secret), `PRINT_BRIDGE_EMAIL_DOMAIN`, `UPSTASH_REDIS_REST_URL`,
  `UPSTASH_REDIS_REST_TOKEN`, `PRINT_BRIDGE_OWNER_ORIGIN`, and
  `PRINT_BRIDGE_MAINTENANCE_KEY` through project secrets. No secret goes into
  `VITE_` variables, source control, or bridge packaging. The Owner origin is an
  exact HTTPS origin. The Redis endpoint uses TLS and an isolated database.
- Rotate digest keys by retaining the prior version until every outstanding
  five-minute token and pairing has expired plus rollout margin. Keep
  `PRINT_BRIDGE_RATE_KEY` stable through digest rotation; rotate it only with a
  separately reviewed rate-budget transition. Confirm old setup tokens cannot
  start twice after a Redis flush or key rotation.
- Configure trusted-scheduler reconciliation with the maintenance header after
  integration certification. Alert on scheduler failures, nonzero orphan counts,
  missing Auth ban, pairing provisioning errors, Redis 503, 429 spikes, and
  emergency budget saturation. Investigate missing pairing state manually;
  never delete a bound or completed Auth identity through orphan cleanup.
- Review Auth pagination limits and an operator runbook for failed cleanup,
  cancellation during provisioning, lost credential response, revocation, and
  re-pair. Confirm Owner-to-bridge setup transfer and Windows protected credential
  storage in P3.3 before exposing pairing to operators.

No production scheduling was enabled. Deployment recommendation: **do not deploy**
until the isolated lifecycle matrix, gateway source identity, JWT/CORS behavior,
Redis behavior, Migration 274, setup channel, and operational alerts are verified.

## Local verification

- Focused bridge tests: 28 passed, including simulated Redis flush, concurrent
  starts, invalid redemption isolation, stable rate-key rotation, body limit,
  shared-proxy/header-spoof isolation, and uniform internal errors. These use in-memory
  ports and do not prove the SQL or hosted gateway behavior.
- Deno checked the Owner, public bridge, and reconciliation entrypoints.
- `npm run build` passed, including `tsc -b` and the production Vite build.
- Full Vitest suite: 1,678 passed, 6 failed, 16 skipped. The failures are
  source-text assertions in `owner-operations-experience`, `owner-performance-p1b`
  (two), `phase-w5-inventory-tracking-workflow`,
  `phase-w6-v1-recipe-inventory-workflow`, and `theme-engine-foundation`.
  None targets the printer files changed here. This is not a clean full-suite gate.
- Full Playwright suite: 647 passed, 4 failed, 27 skipped. Failures occurred in
  Manager RecipeEditor (desktop and mobile), Manager Appearance (mobile), and
  Manager mobile navigation. No printer backend integration test ran in that suite.
- The exact Migration 274 SQL passed 12 checks on a synthetic PostgreSQL fixture
  in P3.2.1. Hosted-schema application, gateway JWT policy, real Auth/SQL
  lifecycle, Redis `EVAL`, scheduling, and alerting remain untested.

## Changed file inventory

| File | Change |
| --- | --- |
| `supabase/functions/_shared/printBridgePairingCore.ts` | Durable setup claim parameters, proof admission, isolated and emergency budgets. |
| `supabase/functions/_shared/printBridgeRateLimit.ts` | Stable rate key; shared transport-peer quota removed. |
| `supabase/functions/_shared/printBridgePublicHandler.ts` | Testable public HTTP action boundary that ignores forwarding headers. |
| `supabase/functions/_shared/printBridgeSupabase.ts` | New atomic RPC adapter, proof lookup, required rate-key secret. |
| `supabase/functions/_shared/printBridgeHttp.ts` | Early declared-size rejection and bounded stream cancellation. |
| `supabase/functions/print-bridge-pair/index.ts` | Public handler delegation without a shared proxy-address quota. |
| `supabase/functions/print-bridge-owner/index.ts` | Stable rate key for Owner budgets. |
| `supabase/migrations/274_print_bridge_durable_setup_claim.sql` | Candidate durable claim table, atomic service-only RPC, and legacy start RPC revocation; **not deployed**. |
| `tests/unit/print-bridge-pairing-core.test.ts` | Replay, race, invalid-redemption isolation, rotation tests. |
| `tests/unit/print-bridge-http.test.ts` | Size and error response tests. |
| `docs/PRINTER_P3_2_SECURITY_REMEDIATION.md` | This review, prerequisites, operations, and evidence. |

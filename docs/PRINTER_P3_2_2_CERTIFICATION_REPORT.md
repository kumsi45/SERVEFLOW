# Printer P3.2.2 isolated environment and integration report

Status: **INCOMPLETE — DO NOT DEPLOY**. This phase deployed no migration, Edge
Function, frontend, secret, or scheduler. Deployed Migrations 271–273 were not
edited. Candidate 274 remained byte-for-byte unchanged, SHA-256
`A3674085DB54A2C54C6A52565901EC5D6206C1E86B542894889C77EAC6956C81`.

## 1. Historical replay root causes

| Failure | Evidence | Conclusion |
| --- | --- | --- |
| 015, SQLSTATE 42883, `rls_auto_enable()` missing | `015_phase4_function_execute_grant_hardening.sql` revokes EXECUTE on this function. No checked-in migration before 015 creates it. Hosted read-only `pg_catalog` shows the function and hosted migration history includes 015. | 015 depends on a pre-existing, untracked hosted function. The exact original DDL/provenance is unavailable; no extension dependency was demonstrated. A clean repository replay is not self-contained. |
| 028, SQLSTATE 42703, `menu_items.description` missing | `028_owner_reports_settings_tables.sql` references the column; 001 creates `menu_items` without it, and checked-in Migration 055 first adds it. A disposable replay that skipped only 015's orphan REVOKE reaches and fails at 028. Hosted read-only catalog shows the column and history includes 028 and 055. | Migration ordering relies on prior hosted schema drift or an untracked pre-028 addition. Its exact origin cannot be established from migration files. |

No deployed historical migration was modified to make replay pass.

## 2. Isolated baseline and fidelity

Using the hosted PostgreSQL 17.6 read-only connection, `printer-p322-schema-only-export.cjs`
created a private, schema-only custom-format `pg_dump` of `public` with no
owner/comments and `default_transaction_read_only=on`. The archive has 2,224
TOC objects, is 2,136,042 bytes, and has **zero TABLE DATA entries**. It did
not export production customer rows, Auth identities, payment rows, or other
application data. The archive was restored into a disposable local Supabase
17.6 database with empty `auth.users`, `restaurants`, and printer tables.
Local Auth infrastructure came from the isolated Supabase stack, not from a
production Auth export. Synthetic Owner and restaurant rows were created only
after the baseline check. A local `app_url` setting was needed because schema-only
export omits application settings rows required by a restaurant trigger.

The local Supabase bootstrap gave `anon`/`authenticated` extra printer-table
ACLs; those four local-only grants were revoked to match the hosted catalog.
The six `supabase_admin`/`postgres` default ACL archive entries were restored
under their respective local roles. `printer-p322-schema-fidelity.cjs` then
compared hosted and isolated definitions: 8 relevant RPCs, 67 columns across
four printer tables, four table RLS/ACL entries, 54 constraints, 22 indexes,
and zero policies all matched. This verifies the relevant Migration 273
contract, while a full catalog equivalence proof across every public object
and hosted Auth internals was not performed.

## 3. Candidate Migration 274 and database behavior

The exact candidate applied cleanly to the restored baseline. `printer-p322-full-schema-audit.cjs`
passed 14 checks: real isolated Auth user creation; forced RLS and service-only
RPC/table grants; first claim plus event; replay; stable digest replay after key
rotation; expired and cross-restaurant claim rejection; failed transaction
recovery; one-winner independent-session claim race; approval/redemption;
redemption replay; and cancellation. The second claim session was observed in
`pg_blocking_pids()` before the winner committed; it then received SQLSTATE
23505. `printer-p322-redemption-race.cjs` separately observed cancellation
blocked behind redemption's row lock and verified that cancellation prevents
agent binding. No setup claim can be cancelled directly while pending; the
pairing must first be approved, so that ordering is the meaningful lifecycle
race tested.

`printer-p322-auth-integration.cjs` used isolated Supabase Auth and PostgREST:
Owner password sign-in and JWT validation passed; missing, invalid, and signed
expired JWTs returned 401; cross-tenant cancellation returned 400; a valid
Owner JWT cancelled its own pairing. These are real Auth/database HTTP results,
not Edge Function results.

An isolated Redis 7 container ran the actual `EVAL` counter script, returning
1 then 2. With persistence disabled, restart removed the key. Under
`allkeys-lru` and a 2 MiB cap, churn evicted a separate replay key. The
PostgreSQL claim still rejected reuse with SQLSTATE 23505 after both Redis loss
experiments. This tests durable database replay protection; it does not certify
the Upstash HTTPS REST adapter or Edge-to-Redis traffic.

## 4. Edge, gateway, and rate-limit integration

The initial nested-Docker Edge bind mount was empty and produced HTTP 503
`BOOT_ERROR`; it was replaced only in the disposable stack with a verified
host-resolvable source mount. `printer-p322-edge-http-audit.cjs` then exercised
the real local Kong gateway, Edge Runtime, Auth and PostgREST. It passed Owner
CORS preflight; missing, invalid and signed-expired Owner JWT rejection;
cross-tenant Owner denial; bounded public input validation; reconciliation
maintenance-secret denial and success; and fail-closed Owner initiation when
the configured Redis REST endpoint was unavailable. A failed-pairing orphan
identity was created through isolated Auth Admin and removed by the real Edge
reconciliation endpoint. No production identity was created.

The local Kong gateway injected `Access-Control-Allow-Origin: *` even on the
403 response for a disallowed Owner origin. The handler still rejected that
request and did not perform the operation, but the local CORS header differs
from the handler's exact-origin policy. Hosted gateway CORS behavior remains
unverified and is a blocker.

No isolated Upstash-compatible HTTPS REST service was available, so successful
public `start`/`redeem`, Auth provisioning, credential delivery, agent binding,
Owner revocation, and Edge-to-Redis restart/eviction flows were not executed as
a complete lifecycle. Source review and focused tests show public redemption
charges a per-pairing budget before proof checking, then a stable-key emergency
budget only after valid proof. The bridge ignores caller-supplied forwarded IP
headers. No trustworthy per-client source identity has been established at the
hosted gateway, and shared-proxy/flood behavior was not measured at a gateway.
A verified upstream per-source policy, spoofed-header stripping, saturation
alerts and flood tests remain deployment blockers.

## 5. Operational readiness

No reconciliation schedule or orphan/429/503 alert is configured. The handler
requires a separate long maintenance secret and source responses avoid raw
exception details, but deployed secret configuration and log redaction have not
been verified. Key rotation retains old digest versions for outstanding
pairings and keeps `PRINT_BRIDGE_RATE_KEY` stable; the rotation procedure and
recovery drill remain unexecuted. The Owner-to-bridge setup-token channel and
protected bridge credential storage are still unimplemented. Physical printing
is outside P3.2.

Before any deployment review: provision an isolated Upstash REST endpoint and
working Edge mount; execute the full HTTP lifecycle, Gateway JWT/CORS and source
flood matrix; configure all server-side secrets including independent digest,
rate, and maintenance keys; retain old digest versions through maximum token
lifetime plus margin; create a trusted reconciliation schedule and orphan/error
alerts; rehearse Redis outage, Auth orphan cleanup, lost credential response,
revocation and rollback; then review the evidence. Do not enable production
scheduling in this phase.

## 6. Regression and file record

- Deno `check --no-lock` passed for all three printer Edge entrypoints.
- `npm run build` passed, including `tsc -b`; Vite reported only a chunk-size
  advisory.
- Full Vitest: 1,678 passed, 6 failed, 16 skipped. Failures are source-text
  assertions in unchanged Owner/Inventory/Theme areas, matching P3.2.1's
  earlier failure set. No unrelated product behavior or assertions were altered.
- Full Playwright: 646 passed, 5 failed, 27 skipped. The failures are the
  desktop/mobile RecipeEditor production-tree test, mobile Manager copilot,
  Manager Appearance, and Manager navigation tests. They are unrelated to the
  printer paths and no product behavior was changed to satisfy them.
- `git diff --check` passed.

P3.2.2 added the following reproducible audit scripts:
`printer-p322-hosted-schema-probe.cjs`, `printer-p322-schema-only-export.cjs`,
`printer-p322-schema-fidelity.cjs`, `printer-p322-full-schema-audit.cjs`,
`printer-p322-redemption-race.cjs`, `printer-p322-auth-integration.cjs`,
`printer-p322-redis-loss-check.cjs`, `printer-p322-edge-mount-recovery.cjs`,
`printer-p322-edge-http-audit.cjs`, and `printer-p322-reconcile-integration.cjs`;
plus this report. P3.2/P3.2.1's existing worktree modifications remain as found.
The pre-existing P3.2/P3.2.1 files modified in this worktree are
`docs/PRINTER_P3_2_SECURITY_REMEDIATION.md`,
`supabase/functions/_shared/printBridgeRateLimit.ts`,
`supabase/functions/print-bridge-pair/index.ts`,
`supabase/functions/_shared/printBridgePublicHandler.ts`,
`tests/unit/print-bridge-http.test.ts`,
`tests/unit/print-bridge-pairing-core.test.ts`, the three P3.2.1 audits, and
`docs/PRINTER_P3_2_1_CERTIFICATION_REPORT.md`. No deployed migration changed:
271, 272 and 273 retain their deployed state and 273's SHA-256 remains
`1AC98CD9C7974DD269F20955865129F6980AEB1B802AEBEBB06EBB64284B5CD5`.
Migration 274 is required for durable one-use setup claims but remains a local,
unchanged, uncertified candidate for deployment.

**Recommendation: do not deploy.** Database and isolated Auth/PostgREST gates
have useful positive evidence, but the Edge/Upstash, trusted source identity,
complete lifecycle, and operational gates are open.

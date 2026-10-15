# Printer P3.2.5 pairing integrity and reconciliation remediation

Date: 2026-10-15 (Africa/Nairobi). **Local/nonproduction remediation only.** P3.2.4 remains incomplete. No hosted or production migration, Edge Function, Auth identity, secret, or scheduler was changed. Migrations 271–273 were not edited; Migration 274 was not edited or deployed. Candidate 275 was applied only to the guarded disposable P3.2.2 loopback PostgreSQL stack for testing.

## 1. Root cause and exploitability

The Owner's active JWT and restaurant authorize issuance of a signed five-minute setup token. The bridge's `start` verifies that token and active Owner membership, then Migration 274 atomically inserts a pending pairing, `started` event, and unique durable claim containing the original Owner and restaurant. The pending pairing itself has no restaurant yet. The Owner's `approve` verifies its JWT, its approval token, active membership, and the displayed code; Migration 273's approval RPC formerly checked only that code, pairing status/expiry, and active Owner membership for the *requested* restaurant. It did not read the durable claim. Redemption then used the approval-assigned restaurant to create and bind the dedicated Auth agent. A failure before binding leaves a `redeeming`/`failed` pairing and possibly a dedicated Auth orphan; a completed but lost credential response cannot be replayed.

That gap was exploitable by an active Owner of restaurant B who had B's valid setup token and knew the code of a pending pairing started under restaurant A. The old RPC accepted B and assigned the A-started pairing to B. The code must be known; a random outside caller without it could not approve. The P3.2.5 regression first failed as expected (the promise resolved), and a rollback-only query against the real isolated PostgreSQL function then reproduced the cross-restaurant assignment before local remediation. This is narrower and stronger evidence than P3.2.4's source-only finding. No production exploit was attempted or observed.

## 2. Database-enforced invariant

New candidate Migration 275 replaces the existing `approve_print_bridge_pairing(uuid,bytea,uuid,uuid)` body without changing its signature or Migration 273. It locks the pairing row, requires exactly its durable claim, compares the claim's Owner and restaurant with the trusted Edge-supplied authenticated Owner/restaurant, checks claim and pairing expiry, and rechecks active Owner membership. It writes the claim's restaurant and Owner into the approved pairing and event in that same transaction. A missing, expired, inconsistent, or replayed claim fails closed. Concurrent approvals serialize on the pairing row; after one commits, the other sees a non-pending state and fails. The function remains `SECURITY DEFINER` with fixed `search_path`, and only `service_role` may execute it. Browser roles still cannot read claims or call the privileged RPC.

The Edge endpoint remains responsible for verifying the Owner JWT and signed setup token before passing the Owner/restaurant to the service-only RPC. The database check binds that verified request to the *original* claim. Retained claim rows remain the durable replay authority; the reconciliation job does not delete them.

## 3. Reconciliation state machine and recovery

| State / interruption | Automated action in a run | Safety and retry boundary |
| --- | --- | --- |
| Setup token not started, or pending/approved pairing without Auth identity | No Auth deletion; expired pairing may remain for later explicit expiry handling. | Claim is retained for replay protection; no credential exists to recover. |
| `redeeming` with Auth identity before expiry plus five minutes | Retain. | Completion may still race; do not delete early. |
| `pending`, `approved`, or `redeeming` with unbound identity after expiry plus five minutes | First call the locked SQL `expire_print_bridge_pairing`, then delete the deterministic dedicated Auth identity. | Completion cannot succeed after the SQL expiry transition. If expiry fails because state changed, retain and report failure for a later run. |
| `failed`, `cancelled`, or `expired` with unbound dedicated identity | Delete Auth identity. | One attempt per run; Auth 404 is treated as already absent. A failure is counted and retried on a later invocation. |
| `completed` or bound active agent | Retain. | A lost credential response cannot be replayed; Owner revocation and new pairing are required. |
| Bound agent with `revoked_at` set | Retain identity; ban it and replace its password if Auth does not report a current ban. | Database revocation is already authoritative. Ban failure is counted for retry; a later run can finish the Auth side. |
| Missing pairing state, completed state without binding, or malformed/mismatched Auth metadata/email/restaurant | Retain and report `needsReview` or `invalid`. | The Auth restaurant must equal the pairing's restaurant or the bound agent's restaurant before deletion or ban. No guessed tenant or deletion. A privileged operator must investigate/correct provenance before cleanup. |

The implementation now scans all dedicated identities up to its existing 100,000-user cap, counts per-identity successes/failures, and continues after one identity fails. It returns HTTP 503 for `failed`, `invalid`, or `needsReview`, so a scheduler can retry and alert. An Auth deletion already completed by another run is idempotent. DB lookup/expiry errors, Auth deletion/ban errors, and malformed metadata cannot silently yield a clean 200. The page cap still fails the whole run and requires a scale review. This is a safe retry mechanism, **not proof of eventual execution**.

Production liveness requires a trusted scheduler to invoke the maintenance-key endpoint every 15 minutes, with at most three exponential-backoff retries inside 15 minutes, an alert destination for a failed/partial run or 30-minute scheduling gap, and an operator runbook for malformed/missing state and retained orphans. Monitor `examined`, `removed`, `alreadyAbsent`, `retained`, `banned`, `failed`, `invalid`, and `needsReview`, plus 429/503 rates; keep credentials out of logs. Drill Auth/DB outages, interrupted and concurrent runs, Redis outage, lost credential delivery, DB revocation plus Auth ban, and manual provenance repair. **No scheduler, alert transport, retry service, or production recovery drill was configured or verified in P3.2.5; eventual cleanup is not certified.**

## 4. Changes and evidence

| Verification | Result | Scope |
| --- | --- | --- |
| New cross-restaurant regression before fix | Expected failure: 1 failed, 25 skipped | Mocked Edge/port path; demonstrated the old model accepted B's token for A's pairing. |
| Focused Vitest, final | **35 passed, 0 failed, 2 files** | Mocked pairing and HTTP behavior, including Auth/DB failure, interrupted cleanup, stale records, tenant-mismatched identity, concurrent deletion, revoked-agent ban retry, and later successful runs. |
| Candidate 275 PostgreSQL audit, first run | **15 checks passed** | Guarded disposable local database. Included rollback-only real pre-fix exploit reproduction, same/cross-tenant approval, expired/missing/replayed/mismatched claims, rollback retry, permissions, and an independent-session approval race with positive `pg_blocking_pids()` evidence. Candidate 275 was then applied locally. |
| Candidate 275 PostgreSQL audit, final rerun | **15 checks passed** | Same local database; pre-fix step skipped because 275 was already present; added actual `anon` and `authenticated` SQLSTATE 42501 execution checks. Synthetic fixtures were rolled back or explicitly removed. |
| P3.2.5 reconciliation integration, final | **7 checks passed** | Real local Kong/Edge/Auth/PostgreSQL: malformed metadata and a wrong Auth restaurant each yielded 503 and retained identity; after Auth Admin correction, a later run removed the failed-pairing orphan; repeated run made no deletion. This was not hosted Supabase. |
| Deno `check --no-lock` | **3 Edge entrypoints passed** | Owner, public pair, and reconcile. The Edge image had no `deno` binary; `npx deno` completed the check. |
| `npx tsc -b`; `npm run build` | **Passed; passed** | Build included TypeScript and Vite; Vite reported a chunk-size advisory only. |
| `git diff --check` | **Passed** | Whitespace check after changes. |

Intermediate focused Vitest runs passed **29/29**, **33/33**, and **34/34** as the reconciliation cases were added. Intermediate real local reconciliation runs passed **5/5** twice before the tenant-metadata case raised the final count to 7/7. The first attempt to run `deno` inside the Edge image could not start because that image has no `deno` executable; the subsequent host `npx deno check --no-lock` passed for all three entrypoints, including its final rerun. TypeScript and build each passed twice. `node --check` passed for both new audit scripts. These intermediate runs are development evidence; the final results above are against the final source.

The real local integration did not test a production scheduler, hosted gateway CORS/JWT behavior, real production secret rotation, or physical devices. A guarded residue check found zero P3.2.5 pairings, orphaned Auth identities from this audit, or dangling setup claims after cleanup. The disposable local database retains candidate 275's function definition for this test environment only.

## 5. Migration and file record

- Unchanged Migration 273 SHA-256: `1AC98CD9C7974DD269F20955865129F6980AEB1B802AEBEBB06EBB64284B5CD5`.
- Unchanged candidate Migration 274 SHA-256: `A3674085DB54A2C54C6A52565901EC5D6206C1E86B542894889C77EAC6956C81`.
- New candidate Migration 275 SHA-256: `ADD0B094D0C1E3FB2DBB79808ACFF96130C295A1DFA7E4FA99DDBA630887C0D8`.
- P3.2.5 files changed: `supabase/migrations/275_print_bridge_claim_bound_approval.sql`; `supabase/functions/_shared/printBridgePairingCore.ts`; `supabase/functions/_shared/printBridgeSupabase.ts`; `supabase/functions/print-bridge-reconcile/index.ts`; `tests/unit/print-bridge-pairing-core.test.ts`; `supabase/audits/printer-p325-pairing-integrity-audit.cjs`; `supabase/audits/printer-p325-reconcile-integration.cjs`; and this report.
- Pre-existing P3.2.4 worktree changes remain: `docs/PRINTER_P3_2_PAIRING_BACKEND_IMPLEMENTATION.md` and `docs/PRINTER_P3_2_4_PRODUCTION_BOUNDARY_CERTIFICATION.md`. They were not changed in P3.2.5.

## 6. Remaining P3.2.4 boundaries

Hosted nonproduction Supabase JWT/CORS matrix and production secret inventory/rotation drill remain **UNVERIFIED**. A production scheduler, retries, alerts, and recovery drills remain **UNVERIFIED**; no eventual-cleanup guarantee is claimed. The Owner-to-bridge setup channel, Windows protected credential store, and physical transport remain **P3.3 DEPENDENCY**. The established `SOURCE_IDENTITY_NOT_REQUIRED` finding is unchanged: no forwarded-IP header is trusted or used for a per-source bucket. A controlled deployment review must examine 274 and 275 together, run the hosted matrix in a separately identified disposable project, and establish the operational controls before any production enablement. No deployment occurred in this phase.

P3.2.5 REMEDIATION VERIFIED LOCALLY — HOSTED CERTIFICATION STILL REQUIRED

# Printer P3.2.1 certification and integration readiness

Status: **INCOMPLETE — DO NOT DEPLOY**. This is a local audit of a candidate.
No migration, Edge Function, secret, or production schedule was deployed.

## Baseline and migration result

- Candidate Migration 274 SHA-256 before and after this audit:
  `A3674085DB54A2C54C6A52565901EC5D6206C1E86B542894889C77EAC6956C81`.
  The file was not edited.
- Migration 273 SHA-256: `1AC98CD9C7974DD269F20955865129F6980AEB1B802AEBEBB06EBB64284B5CD5`.
  Migrations 271–273 were not edited.
- A read-only hosted `supabase_migrations.schema_migrations` transaction returned
  `271,272,273` and no `274`. No tenant table was read or changed. Thus 274 is
  confirmed absent from hosted migration history at the time of this check.
- The exact 274 SQL applied successfully to a disposable Supabase PostgreSQL 17
  image with synthetic pairing tables. Twelve catalog/behavior checks passed.
  This fixture is **not** equivalent to the deployed schema and does not certify
  migration application after the complete 001–273 chain.

## PostgreSQL evidence and limits

The fixed-loopback audit in `supabase/audits/printer-p321-sql-audit.cjs` uses
independent `pg` clients. It confirmed first claim creates one pending pairing
and started event; replay after Redis state is absent fails with SQLSTATE 23505;
same digest across key rotation fails with 23505; expired setup and wrong-tenant
Owner fail with P0001; failed duplicate-code transaction leaves the claim
retryable; and simultaneous claims serialize on the unique setup digest. A
separate monitoring connection observed `pg_blocking_pids()` on the losing
session before the winner committed. The loser then received 23505; one claim,
pairing, and event remained.

The catalog showed forced RLS on `print_bridge_setup_claims`, service-role-only
table and RPC access, a security-definer RPC with fixed `search_path`, and
service-role revocation of the legacy start RPC. Active `anon` and
`authenticated` queries returned SQLSTATE 42501 for the claim table and RPC.
Only bytea digests are inserted by 274; raw setup tokens and proofs are not
written by this candidate. It contains no statement touching `print_jobs`.
The read-only hosted history check is in
`supabase/audits/printer-p321-hosted-history.cjs`.

The fixture does not include the full Migration 273 lifecycle. Therefore it
cannot certify concurrent redemption, canonical cancellation, claim-versus-
cancellation, agent binding, or historical print-job non-regression. The
PostgreSQL claim checks cover expiry at execution, but not every expiry race
under the hosted API's clock and transaction timing.

## Full-chain and integration environment

Docker is available. A disposable Supabase PostgreSQL image on loopback port
54397 replayed Migrations 001–014. Migration 015 required an isolated-only shim
to omit a REVOKE of absent `public.rls_auto_enable()`. Replay then reached 022
and stopped at 023 with SQLSTATE 42P01: `storage.buckets` does not exist in the
standalone database image. Historical files were not changed.

A Linux-container Supabase CLI 2.107.0 reached Docker using host networking.
The unmodified repository's full local stack stopped at Migration 015 with
SQLSTATE 42883 (`public.rls_auto_enable()` absent). A disposable copy of only
the Supabase files, with the single 015 REVOKE omitted, proceeded through 027
and stopped at Migration 028 with SQLSTATE 42703:
`column menu_items.description does not exist`. This copy was never deployed or
merged into the repository. Further historical shims would not establish a
hosted-equivalent schema. The local containers created for the audit were
stopped/removed; no production connection was used.

Real Auth/database/Edge/Redis integration has not been certified. Required
infrastructure: a disposable Supabase stack or project with complete migrations
through 273, candidate 274 applied there only, two synthetic restaurants and
Owners, disposable Auth identities, an isolated Upstash Redis REST database,
test secrets, and an authenticated test runner. Run the full matrix in the
P3.2 readiness review and record HTTP statuses, SQLSTATEs, rows, Auth identity
state, Redis state, and cleanup after each case. Do not use `.env.local` or
production restaurants.

For a fresh local stack, first provide a reviewed baseline schema or repair the
historical migration chain in a separate authorized effort. The working Linux
CLI invocation was:

```text
docker run --rm --network host -v <linux-cli-bin>:/cli -v <isolated-project>:/workspace -v /var/run/docker.sock:/var/run/docker.sock -w /workspace denoland/deno:latest /cli/supabase start
```

The isolated project must contain the reviewed migrations and functions and
must use disposable local ports. Add a separate Redis REST service compatible
with Upstash `EVAL`, dedicated test secrets, and a synthetic Auth/tenant seed.
Only then run the Owner/bridge/reconcile HTTP matrix; inspect gateway JWT/CORS
settings and Redis state before and after restart/eviction. This command is a
setup path, not a passing integration test.

## Gateway source identity and abuse controls

Deno documents `remoteAddr` as the **connection peer**; Supabase documents an
edge gateway before the function. Those sources do not establish that the
function sees a unique client address. The earlier 120-per-source Edge bucket
could therefore make a shared proxy a denial-of-service target. It was removed.
The public handler ignores caller-supplied forwarding headers. Invalid proof
requests charge only their own pairing bucket; only a validated approved proof
can charge the stable-key emergency bucket. Focused HTTP tests cover clients
sharing a proxy and spoofing `X-Forwarded-For` while preserving another
pairing's quota.

A verified per-client source rule at a trusted gateway is still required.
Hosted gateway header provenance, source collision behavior, spoofed-header
stripping, and saturation alarms have not been observed. This is a deployment
blocker. See [Deno `ServeHandlerInfo`](https://docs.deno.com/api/deno/http-server/)
and [Supabase Edge Functions](https://supabase.com/docs/guides/functions).

## Existing-suite failure investigation

- Full Vitest rerun: 1,678 passed, 6 failed, 16 skipped. The same six failures
  recur in five Owner/Inventory/Theme source-text test files. They expect
  strings absent from unchanged Owner source files. No P3.2 file is imported by
  these assertions. They are pre-existing/stale relative to this printer diff;
  no unrelated feature or assertion was rewritten.
- Prior full Playwright run: 647 passed, 4 failed, 27 skipped. A targeted
  12-test rerun had 10 passed and two failed. The desktop and mobile
  RecipeEditor failures did not recur, indicating timing sensitivity.
  Manager mobile navigation repeatedly measured a 39.999998px control against
  an exact 40px assertion. Manager Appearance repeatedly showed a preview
  column that the test expected hidden at <=767px. These source and test files
  are unchanged by P3.2. The two repeatable Manager failures remain unresolved
  outside this task's implementation scope.
- Focused printer HTTP/pairing tests: 28 passed. All three P3.2 Edge entrypoints
  passed `deno check --no-lock`. `npm run build` passed (`tsc -b` and Vite).
  `git diff --check` passed. Generated browser artifacts were restored/removed.

## Operational controls and recommendation

Reconciliation scheduling, orphan alerts, Redis availability/429/503 alerts,
digest-key retention, stable rate-key rotation, and rollback remain review
items. No production scheduling was enabled. Before deployment, verify the
hosted gateway JWT and CORS behavior, real Redis `EVAL` and outage/eviction
behavior, Owner Auth and cross-tenant controls, Auth Admin provisioning,
credential delivery, lost-response handling, revocation, and reconciliation.
Protect the Owner-to-bridge setup channel and Windows credential storage before
operator use. Deploy only after an isolated end-to-end matrix and operational
alerts pass. Current recommendation: **do not deploy**.

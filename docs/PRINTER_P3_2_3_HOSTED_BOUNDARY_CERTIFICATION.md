# Printer P3.2.3 hosted-boundary certification

Status: **INCOMPLETE - DEPLOYMENT STILL BLOCKED.** No hosted migration,
function, secret, scheduler, Auth identity, or restaurant data was changed.
Migrations 271, 272, and 273 remain immutable. Candidate Migration 274 remains
local and unchanged at SHA-256
`A3674085DB54A2C54C6A52565901EC5D6206C1E86B542894889C77EAC6956C81`.

## Gate decision

| Critical gate | Result | Evidence / disposition |
| --- | --- | --- |
| Migration 274 durable claim | PASS (isolated) | P3.2.2 restored hosted schema and tested replay, rotation, failed transactions and independent-session races. This is not a hosted deployment. |
| Upstash HTTPS REST protocol and lifecycle | PASS (isolated) | Actual temporary Upstash database accepted exact body-style `EVAL`, TTL and atomic `SET NX EX`; real local Kong/Edge/Auth/Upstash lifecycle completed setup, approval, credential delivery, agent binding and replay rejection. |
| Redis unavailability | PASS (isolated) | P3.2.2 Edge test returned 503 before a privileged action when Redis REST was unavailable. Current provider test restored normal operation. |
| Trusted hosted source identity | BLOCKED | No deployed function exists from which to observe the hosted request boundary. Supabase does not document an Edge-handler source identity as trusted and unspoofable. |
| Hosted CORS and JWT behavior | BLOCKED | Local Kong/Edge tests passed, but no safe hosted nonproduction function target is configured. |
| Hosted secret configuration and rotation drill | BLOCKED | No hosted secrets were inspected or changed under this no-deploy scope. |
| Reconciliation scheduler and alerts | BLOCKED | Design completed below; no scheduler, alert destination, or alert test exists. |
| Owner-to-bridge setup channel | BLOCKED / P3.3 dependency | Backend capability is short-lived and one-use, but the Owner UI and protected Windows credential store do not exist. |

## 1. Upstash HTTPS REST result

The intended provider supports the required protocol. A disposable Upstash
database accepted the exact body-style `EVAL` counter script used by P3.2,
returned 1 then 2, retained a bounded TTL, and applied `SET key value NX EX 30`
atomically (`OK`, then `null`). Bad bearer authentication returned 401 and an
invalid command returned 400. Upstash documents HTTPS bearer authentication,
body-style command arrays, Redis-compatible response semantics, error classes,
and scripting support. [Upstash REST API](https://upstash.com/docs/redis/features/restapi)

The complete isolated path passed:

```text
real isolated Owner JWT -> Edge initiate -> signed setup token
  -> public bridge start -> Owner code approval -> public redeem
  -> dedicated Auth session and agent binding -> second redeem rejected
```

It used disposable restaurants, Owners, Auth identities and a temporary Upstash
database. Credentials stayed only in a private OS Temp file and were never
printed or committed. The limiter treats timeout, network error, non-OK
response, provider `error`, or malformed result as HTTP 503. It applies a 2.5
second timeout. A managed-provider outage cannot be induced safely; P3.2.2 used
an unreachable HTTPS endpoint to prove Edge fail-closed behavior and this phase
proved recovery with the actual provider.

## 2. Gateway source identity and threat model

No trusted per-client IP signal is established for a hosted Edge handler. The
functions are deliberately not deployed, so neither `remoteAddr` nor forwarding
header transformation can be observed at the actual boundary. Supabase lists
`cf-connecting-ip` and `x-real-ip` as captured log headers, which is logging
evidence, not a contract that handler code may trust their provenance.
[Supabase log fields](https://supabase.com/docs/guides/observability/log-field-reference)

P3.2 must keep caller-controlled forwarding headers out of rate-limit identity:

- signed setup-token nonce budget plus PostgreSQL durable claim isolates starts;
- invalid redemption charges only the supplied pairing UUID's bounded budget;
- only a validated proof reaches the high-capacity stable-key emergency budget;
- guessed IDs and invalid proofs cannot exhaust an unrelated pairing's ordinary
  capacity.

The remaining threat is a holder of many valid setup tokens or proofs. Add a
source-based control only after upstream documentation and a safe hosted test
prove trusted identity and spoofed-header stripping.

## 3. Hosted CORS and JWT boundary

Local evidence is positive, not hosted certification: Owner missing, malformed
and expired JWTs were rejected; cross-tenant Owner requests were denied; valid
Owner requests worked; public bridge validation ran without a JWT; and the
reconciliation maintenance secret was enforced. The local gateway injected a
wildcard CORS header even on an Owner-origin 403. The handler rejected the
operation, but this makes hosted header capture mandatory.

Supabase documents that `verify_jwt` rejects missing or invalid user JWTs before
the handler, and application authorization remains a handler responsibility.
[Authorization headers](https://supabase.com/docs/guides/functions/auth-headers)
It also requires function-side OPTIONS handling for browser CORS.
[CORS troubleshooting](https://supabase.com/docs/guides/troubleshooting/unable-to-call-edge-function)

Required hosted test: a separate Supabase project with only disposable data and
a separate Upstash database. Capture OPTIONS/POST status and headers for
allowed/disallowed origins, methods and headers; Owner missing/invalid/expired/
valid/cross-tenant JWTs; public start/redeem; and reconciliation missing/valid
maintenance authentication. This project must be reviewed before production.

## 4. Secret inventory and rotation

| Secret / category | Used by | Storage and exposure | Rotation / pairing effect |
| --- | --- | --- | --- |
| `SUPABASE_URL` | all functions | Edge server setting; endpoint, not credential | Change only with project move. |
| `SUPABASE_ANON_KEY` | all functions / callers | Public project key may reach browser and bridge; never use as a user bearer token | Rotate through Supabase API-key procedure and test clients. |
| `SUPABASE_SERVICE_ROLE_KEY` | server ports | Edge secret only; never browser, Owner UI or bridge | Rotate through provider incident/runbook procedure. |
| `PRINT_BRIDGE_DIGEST_KEYS` | Owner and public pairing | Edge secret only | Add version, retain prior versions for five-minute pairing lifetime plus clock/rollout margin, then remove. Removal invalidates artifacts signed solely by removed version. |
| `PRINT_BRIDGE_RATE_KEY` | rate limiter | Edge secret only | Rotate after emergency window drains; namespace changes create a fresh budget. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | rate limiter | Edge secret only; standard token never browser/bridge | Validate replacement `EVAL`, update atomically, retire old token. PostgreSQL claims remain authoritative. |
| `PRINT_BRIDGE_MAINTENANCE_KEY` | reconciliation | Scheduler secret only | Set new key, update scheduler, verify, revoke old; agent sessions unaffected. |
| Owner JWT | Owner endpoint | Browser authenticated session only | Normal Auth expiry/rotation; never copied to bridge. |
| Setup token and code | Owner/bridge setup | Transient Owner-page memory and protected local bridge process only | Five-minute expiry, durable one-use; never localStorage/sessionStorage. |
| Bridge proof | local bridge before redeem | Protected bridge memory only | One redemption; discard after response. |
| Agent session | local bridge after redeem | Windows credential storage under dedicated service account | Revoke DB agent, then ban/reset dedicated Auth identity. |

The repository ignores `.env`, `.env.local`, local variants and
`supabase/connection.env`. This does not prove hosted logs, deployment history
or operator devices have no exposure.

## 5. Reconciliation and alerting design

Do not enable this design in this phase.

| Control | Controlled production design |
| --- | --- |
| Schedule | Every 15 minutes, with maintenance secret from a trusted scheduler. |
| Orphan | Dedicated `serveflow_kind=print_bridge` Auth identity with no bound agent whose pairing is terminal, or unbound five minutes after expiry. |
| Safety | Retain completed/bound and missing-pairing identities; never revoke active agents. |
| Retry | Three exponential-backoff retries in 15 minutes; retain uncertainty for next run. |
| Alerts | Page for 30-minute scheduler failure, cleanup failure, or Redis 503 above 1% for 10 minutes. Ticket for more than five retained unbound orphans older than 30 minutes. |
| Audit | Invocation ID, counts, failure code and pairing ID only. Redact tokens, proofs, sessions, passwords and provider credentials. |
| Recovery | Disable public pairing upstream for anomalies; review state, revoke DB agent, ban Auth identity, re-pair on remediated computer, preserve evidence. |

P3.2.2 proved deletion of a disposable failed orphan and retention logic for
bound identities. Scheduler, alert transport and recovery execution remain
untested.

## 6. P3.3 Owner-to-bridge setup-channel handoff

P3.3 must implement the following before operator use:

```text
Owner browser (active Owner JWT)
  -> five-minute one-use setup token in page memory
  -> authenticated local-only channel to selected Windows bridge
  -> bridge creates proof and displays code
  -> Owner visually compares and approves code
  -> bridge redeems proof once over TLS
  -> bridge protects delivered session in Windows credential storage
  -> active agent begins work
```

The channel must bind to a selected local bridge, require local-user consent,
use TLS or mutually authenticated loopback/local-network transport, and never
place setup tokens, proofs, refresh tokens or service-role material in browser
storage. Clear setup material on start, expiry, cancel and navigation. A lost
redemption response cannot be recovered with an old proof: revoke the uncertain
agent and re-pair. Computer compromise requires DB revocation, Auth ban,
credential-store cleanup and re-pairing on a remediated machine.

## 7. Controlled deployment checklist

### Database

- [ ] Create tested backup and capture restore owner.
- [ ] Verify candidate 274 SHA-256 exactly matches this report.
- [ ] Dry run on isolated schema-only hosted baseline.
- [ ] Obtain explicit review before applying 274; do not alter 271-273.
- [ ] Verify claim table, RLS, grants, function signature and legacy-function
  service-role revoke after apply.
- [ ] Disable Edge entrypoints first for rollback. Do not drop claim rows;
  use a reviewed forward migration if reversal is required.

### Edge and gateway

- [ ] Pass hosted test-project CORS, JWT, public bridge and maintenance matrix.
- [ ] Owner retains `verify_jwt=true`; pair/reconcile retain false only with
  proof/setup-token and maintenance authorization.
- [ ] Set exact Owner origin; inspect gateway-added headers and invocation logs.
- [ ] Confirm version hashes and no credentials/session material in logs.
- [ ] Establish documented trusted source identity before source-based limiting.

### Redis and operations

- [ ] Create dedicated Upstash database; verify `EVAL`, timeout and alerts.
- [ ] Configure dashboards for 429, 503, emergency budget, orphan count and
  scheduler outcomes.
- [ ] Complete scheduler, alert, escalation and recovery drill.
- [ ] Perform key rotation drill with prior-key grace.
- [ ] Complete P3.3 setup-channel and Windows credential-store review.

## Remaining blockers and exact next step

Critical blockers are trusted hosted source identity, hosted test-project
CORS/JWT evidence, production secret verification/rotation drill, scheduler and
alerts, and the P3.3 setup channel. The exact next step is to provision a
separate Supabase project and dedicated Upstash database, then deploy only the
reviewed candidate functions and Migration 274 **to that nonproduction project**
for the hosted matrix. It requires explicit approval because it creates external
nonproduction infrastructure and deploys code, which this phase did not do.

SERVEFLOW PRINTER P3.2.3 INCOMPLETE — DEPLOYMENT STILL BLOCKED

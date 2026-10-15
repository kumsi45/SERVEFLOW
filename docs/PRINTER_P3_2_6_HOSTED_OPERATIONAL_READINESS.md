# Printer P3.2.6 hosted and operational readiness

Date: 2026-10-15 (Africa/Nairobi). Hosted certification status: **UNVERIFIED**. This phase performed read-only project and migration inventory, local secret-disclosure checks, and an operational design review. It did not deploy or change a hosted migration, Edge Function, Auth identity, secret, or scheduler. P3.2.5's local remediation is carried forward; it is not hosted certification.

## 1. Environment identity and safe-target decision

| Check | Status | Evidence / limit |
| --- | --- | --- |
| Dedicated ServeFlow nonproduction Supabase target | **UNVERIFIED** | The authenticated CLI listed two active projects: linked `SERVEFLOW` in `eu-central-1` and unrelated `Medora` in `eu-west-1`. Neither is positively identified as a disposable ServeFlow test project. The linked reference, ignored frontend URL, and ignored PostgreSQL pooler URL all point to the same project (reference SHA-256 prefix `C6F498B52CC0`). Treat linked `SERVEFLOW` as production-sensitive. Do not use `Medora` as a substitute. |
| Hosted test credentials | **UNVERIFIED** | The shell has no `SUPABASE_ACCESS_TOKEN`, nonproduction project ID/URL/database URL, dedicated Upstash configuration, or printer maintenance secret. The CLI has enough cached access for read-only project/secret-name inventory; that is not a safe nonproduction test identity. No credential value was printed. |
| Hosted JWT, CORS, pairing, or recovery requests | **UNVERIFIED** | No nonproduction printer functions or disposable tenant/Owner/agent fixtures were identified. No hosted request was made. |
| Production-write boundary | **PASS** | Only project metadata, secret names, and `BEGIN READ ONLY` PostgreSQL migration/catalog queries were issued against linked `SERVEFLOW`. No hosted write or production deployment occurred. |

To establish a target, provision a **dedicated ServeFlow nonproduction Supabase project** and a separate disposable Upstash database. Record its project name, reference, region, organization, owner, deletion policy, and explicit nonproduction designation; compare its reference against the linked `SERVEFLOW` reference before any write. Put the nonproduction project reference, CLI access token/profile, DB URL, application origin, anon/publishable key, service-role credential, test Owner and ordinary-user credentials, Upstash REST URL/token, digest keyring, independent rate key, bridge email domain, and maintenance key in an approved local secret store or ignored environment file. Use only synthetic restaurants and Auth identities. Do not paste credentials into chat. The deployment plan in Section 7 requires separate approval even after this inventory is complete.

## 2. Hosted JWT and CORS gates

| Required hosted observation | Status | Evidence needed |
| --- | --- | --- |
| Missing, malformed, and expired JWT rejected for Owner endpoint | **UNVERIFIED** | Capture hosted status, headers, safe body, and Auth/Edge trace for each. |
| Ordinary user denied Owner operation; correct Owner accepted; cross-restaurant Owner denied | **UNVERIFIED** | Use distinct disposable Auth users and restaurants; prove database and HTTP decisions separately. |
| Revoked print agent denied by database-backed claim/renew/acknowledge checks | **UNVERIFIED** | Use a disposable hosted agent after reviewed 274/275 deployment; verify `enabled`/`revoked_at` runtime gate. |
| Public bridge proof/setup-token and maintenance-key boundaries | **UNVERIFIED** | Verify `verify_jwt=false` only for pair/reconcile; test bounded public input and missing/valid maintenance key without exposing credentials. |
| Allowed origin, disallowed origin, OPTIONS, POST, and Authorization preflight | **UNVERIFIED** | Capture actual hosted gateway and handler CORS headers for both origins and methods. A disallowed browser origin must not gain readable Owner responses; authorization must hold independently of CORS. |
| Browser-level CORS behavior | **UNVERIFIED** | Use a real browser against the approved hosted nonproduction origin. Command-line header capture alone does not prove browser behavior. |
| Service-role and secret-free responses | **PASS** | Local-only evidence: three loopback denial responses returned 401 (Owner), 400 (public pair), and 403 (reconcile), with no exact known confidential value in any body. Hosted responses and logs remain **UNVERIFIED**. |

`PRINT_BRIDGE_OWNER_ORIGIN` is not present in the linked project's secret-name list, so no hosted configured-versus-frontend origin comparison is possible. The ignored frontend configuration points to linked `SERVEFLOW`; its origin is not a substitute for a nonproduction allowed-origin setting. Earlier local Kong testing observed a wildcard CORS header on a denied Owner-origin response. That remains a reason to inspect the actual hosted gateway; CORS must not be treated as authentication or tenant authorization.

## 3. Secret and configuration inventory

Read-only CLI inventory of linked `SERVEFLOW` returned **9 secret names**. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` were present by name. All seven printer-specific configuration names below were absent by name. Name presence does not verify a value, scope, access policy, log exposure, or rotation readiness. No secret value or digest was printed.

| Item | Purpose; expected location and consumer | Classification; rotation and recovery | Observed / drill |
| --- | --- | --- | --- |
| `SUPABASE_URL`; `VITE_SUPABASE_URL` | Project endpoint in Edge and browser respectively. | Public configuration; change with project migration and verify clients. | Linked Edge name present; frontend local name present. Rotation **UNVERIFIED**. |
| `SUPABASE_ANON_KEY`; `VITE_SUPABASE_ANON_KEY` | Public Supabase client key for Edge Auth client and browser. | Public key, never a user bearer token; rotate using provider procedure and update clients. | Linked Edge name present; frontend local name present. Rotation **UNVERIFIED**. |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged Edge Auth Admin/database client. | Confidential Edge-only credential; revoke/replace through reviewed provider procedure and verify server consumers. Never ship in bridge/browser. | Linked secret name present. Rotation **UNVERIFIED**. |
| `PRINT_BRIDGE_DIGEST_KEYS` | Versioned HMAC for setup token, code, proof, and rate digests in Owner/public Edge. | Confidential Edge-only keyring; add new version, retain old through outstanding five-minute artifacts plus rollout/clock margin, then remove. Removing an old version early invalidates those artifacts. | Linked name absent. Local key-rotation/replay tests from prior phases are not a hosted drill. **UNVERIFIED**. |
| `PRINT_BRIDGE_RATE_KEY` | Stable Redis-key pseudonymization in Owner/public Edge. | Confidential independent key; digest-key rotation must not change it. A rate-key change creates fresh budgets, requiring a reviewed quiet-window transition. | Linked name absent. **UNVERIFIED**. |
| `UPSTASH_REDIS_REST_URL`; `UPSTASH_REDIS_REST_TOKEN` | Separate HTTPS Redis rate-limit dependency in Owner/public Edge. | Server-only endpoint and confidential bearer token; test replacement `EVAL`, switch Edge configuration, observe failures, then revoke old token. PostgreSQL claims remain replay authority. | Both linked names absent. Disposable Upstash protocol/lifecycle was already proven in P3.2.3; hosted rotation **UNVERIFIED**. |
| `PRINT_BRIDGE_MAINTENANCE_KEY` | Authenticates trusted scheduler to `print-bridge-reconcile`. | Confidential scheduler/Edge key; overlap scheduler and Edge rollout, verify new key, then revoke old. Do not send to browser/bridge. | Linked name absent; no scheduler. **UNVERIFIED**. |
| `PRINT_BRIDGE_OWNER_ORIGIN`; `PRINT_BRIDGE_EMAIL_DOMAIN` | Exact Owner CORS origin and deterministic dedicated Auth email domain in Edge. | Operational configuration, not bearer credentials. Origin must match approved frontend. Domain changes can strand old identities in reconciliation and need a reviewed compatibility/recovery plan. | Both linked names absent. **UNVERIFIED**. |
| Owner JWT; setup token/code; bridge proof | Owner browser session; transient Owner-to-bridge capability and local proof. | Confidential short-lived material; clear on expiry/cancel/navigation; do not store in browser persistent storage. One-use replay is enforced by durable claim. | P3.3 delivery channel absent. **P3.3 DEPENDENCY**. |
| Agent access/refresh session and local bridge credential | Dedicated Auth identity delivered once to Windows bridge. | Confidential; DB revoke first, then Auth ban/password replacement; protect refresh material under service account and re-pair after uncertain delivery. | Windows protected store and rotation drill absent. **P3.3 DEPENDENCY**. |

Static/local disclosure checks compared **7 known confidential values** without printing them: **0 exact-value matches in 1,270 Git-tracked text files, 0 in 988 built files, and 0 in up to the last 1,000 lines of the local Edge container log**. The three local denial responses also had zero exact-value matches. Only `.env.example` and `supabase/connection.env.example` are Git-tracked; ignored `.env.local` and `supabase/connection.env` hold local settings. This does not prove that unknown secrets, hosted bundles/logs, deployment history, or operator devices are clean. A safe nonproduction rotation drill and later production operator inventory remain open.

## 4. Reconciliation operating contract and liveness

The current handler requires a maintenance key of at least 43 characters, enumerates Auth identities tagged `serveflow_kind=print_bridge` in pages of 1,000 (up to 100 pages), checks pairing/agent and Auth tenant provenance, retains active or uncertain identities, and deletes only eligible unbound orphans. It bans a revoked bound identity when Auth does not show a current ban. Individual failures, invalid metadata, and states needing review yield counts and HTTP 503; a clean run yields 200. Auth 404 after a concurrent deletion is idempotent. A page-limit or enumeration failure aborts the run. No scheduler, durable run ledger, external retry service, or alert route is configured.

**Proposed control, not enabled:** assign a named Platform Operations owner and backup; run one authenticated HTTPS POST at minutes 00/15/30/45 using the maintenance key from a scheduler secret store, with at most one active invocation. Start with a 60-second invocation deadline and three retries after 30 seconds, 2 minutes, and 5 minutes; require nonproduction duration measurements before adopting that deadline. Treat HTTP 503, timeout, network error, or malformed result as failed; do not retry 401/403 without operator investigation. Skip or queue overlapping ticks rather than launching simultaneous unlimited scans. If the full scan cannot meet the deadline, or approaches the 100-page cap, redesign it with bounded pagination and durable progress before production enablement.

**Alert and recovery proposal:** page for missing invocation or no clean completed run for 30 minutes, repeated 503/timeout, or maintenance authentication failure; ticket immediately for `invalid`/`needsReview` or an eligible orphan still present after the next clean run. Monitor the returned `examined`, `removed`, `alreadyAbsent`, `retained`, `banned`, `failed`, `invalid`, and `needsReview` counts, plus public pairing 429/503 rates and Redis availability. Keep scheduler invocation ID, status, duration, and counts; exclude passwords, tokens, proofs, sessions, and provider credentials. On failure, stop exposure if abuse is suspected, inspect pairing/agent/claim state and dedicated Auth metadata in the affected tenant, repair provenance only with reviewed evidence, retry, then verify the identity is absent or the revoked identity is banned while the DB agent remains revoked. Preserve durable claims. A lost completed-session response requires Owner revocation and a fresh pairing, never proof/session replay.

The P3.2.5 local Auth/Edge recovery audit demonstrated a malformed or wrong-tenant identity retained with 503, corrected metadata, later cleanup, and an idempotent repeat. This is **local manually invoked evidence**. There was **no hosted nonproduction recovery drill** and no schedule/monitoring execution in P3.2.6. Eventual cleanup remains **UNVERIFIED**.

## 5. Migration and function deployment state

| Migration | Current file SHA-256 | Linked `SERVEFLOW` read-only history |
| --- | --- | --- |
| 271 | `E0F4870A8EEEBF4178B0B97A267E7DCD8B8C2473B92AEEE997A5584ABB3F304B` | **PASS**: version recorded; file unchanged. |
| 272 | `8A032A7010BAD8A720D4ACFDACEA6ADBDB0914A834E98D72999597E11ED53A0C` | **PASS**: version recorded; file unchanged. |
| 273 | `1AC98CD9C7974DD269F20955865129F6980AEB1B802AEBEBB06EBB64284B5CD5` | **PASS**: version recorded; file unchanged. |
| 274 | `A3674085DB54A2C54C6A52565901EC5D6206C1E86B542894889C77EAC6956C81` | **PASS**: version absent and setup-claim table absent in read-only catalog. Candidate remains pending for that project. |
| 275 | `ADD0B094D0C1E3FB2DBB79808ACFF96130C295A1DFA7E4FA99DDBA630887C0D8` | **PASS**: version absent. Candidate remains pending for that project. Applied only to the disposable local P3.2.5 database. |

The linked project's deployed printer Edge Function list/versions are **UNVERIFIED**: the read-only CLI `functions list` returned `EUNKNOWN: uv_spawn` twice. No production function was invoked as a substitute. The source config explicitly sets `verify_jwt=false` for pair and reconcile; Owner uses the default gateway verification plus handler Auth checks. Hosted effective gateway settings still require capture in a safe nonproduction project.

## 6. Proposed controlled nonproduction rollout — not executed

1. Name and independently confirm the dedicated nonproduction project and Upstash database; compare their references with linked `SERVEFLOW`; designate fixture owner and cleanup date. Obtain separate approval before any deployment.
2. Capture migration history, relevant schema/RPC definitions, deployed function versions, secret-name inventory, and a tested backup/restore owner. Hash reviewed 274/275 and function source. Confirm nonproduction baseline includes 271–273; never rewrite an already applied migration.
3. Apply reviewed 274 then 275 to that nonproduction target only. Verify table/RLS/grants/function signatures, old start-RPC revocation, atomic claims, same-tenant approval, cross-tenant denial, and independent-session races. If a shared environment has applied a candidate, use a new forward migration for corrections.
4. Configure nonproduction-only Edge secrets, exact allowed origin, and dedicated Upstash database; deploy reviewed Owner, pair, and reconcile functions. Verify effective `verify_jwt` settings and versions before traffic.
5. Run the hosted JWT, tenant, replay, revoked-agent, CORS OPTIONS/POST, browser, Redis outage, and secret-free response matrix using only disposable identities and restaurants. Capture HTTP headers/status and database evidence separately.
6. Configure a **nonproduction-only** scheduler and alert sink for the proposed cadence; measure scan duration and page count. Drill Auth deletion/ban failure, DB failure, partial 503, malformed metadata, interruption, retries, stale-run alert, and successful later cleanup. Do not infer production liveness from manual invocation.
7. Inspect nonproduction logs and Auth/DB residue, execute a nonproduction digest/Upstash/maintenance-key rotation drill, verify old credentials are rejected at the intended point and unrelated tenants continue working, and record operator signoff.
8. For rollback, disable nonproduction Edge entrypoints and scheduler first, revoke disposable agents/Auth identities, preserve setup-claim rows and audit events, then restore a reviewed snapshot or make a forward repair. Do not delete durable claims to re-enable replay or modify 271–273.

## 7. P3.3 boundary and remaining blockers

Owner-to-bridge setup transfer with local consent, Windows protected credential storage and rotation/revocation, printer discovery/capability configuration, actual USB/LAN transport, test jobs, and physical paper verification remain **P3.3 DEPENDENCY**. P3.2 backend readiness cannot establish physical printing.

The blockers for a hosted-readiness decision are: no positively identified dedicated ServeFlow nonproduction target; no hosted JWT/CORS/browser or revoked-agent evidence; no printer-specific hosted secrets or rotation drill; deployed function versions unknown; and no operational scheduler, monitoring, alert test, or hosted recovery drill. `SOURCE_IDENTITY_NOT_REQUIRED` remains established for the current rate-limit design; forwarded-IP headers are not trusted. No production deployment occurred.

## 8. P3.2.6 verification and file record

- Read-only CLI project inventory: **2 projects**, **0 positively identified ServeFlow nonproduction targets**. Linked/frontend/pooler references matched; no values were printed.
- Read-only linked-project secret-name inventory: **9 names**, **3 standard Supabase names present**, **0 of 7 printer-specific names present**. Values and rotation state were not inspected.
- Linked-project PostgreSQL `BEGIN READ ONLY` probe: **3/3 versions 271–273 recorded; 0/2 versions 274–275 recorded; claim table absent**. No tenant rows were read.
- Current file integrity: **5/5 SHA-256 hashes calculated**; 273–275 match the prior expected hashes. No migration was edited.
- Confidential-value scan: **7 values compared; 0/1,270 tracked text files, 0/988 built files, and 0 matches in up to 1,000 local Edge log lines**. This is local/static evidence only.
- Local denial-response check: **3/3 passed** (Owner 401, public pair 400, reconcile 403; zero known confidential literals in bodies). No hosted request was made.
- Deployed-function listing: **0 verified; 2 read-only CLI attempts failed with `EUNKNOWN: uv_spawn`**.
- Newly run hosted JWT/CORS/browser tests: **0**. Newly run rotation or scheduler/recovery drills: **0**. P3.2.5's 35/35 Vitest, 15/15 PostgreSQL audits, and 7/7 local integration are carried forward, not rerun.
- `git diff --check`: **PASS**. P3.2.6 changed exactly this report: `docs/PRINTER_P3_2_6_HOSTED_OPERATIONAL_READINESS.md`.

P3.2.6 INCOMPLETE — HOSTED/OPERATIONAL BLOCKERS REMAIN

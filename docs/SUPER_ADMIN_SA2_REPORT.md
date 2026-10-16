# ServeFlow Super Admin SA2 — implementation and verification

Date: 2026-10-16. Baseline: clean `main`, `f55974a55ebbefa599881b1f62fe2b3b04b7f623`.

Sections 1–8 record the initial implementation checkpoint. Section 9 is the later verification addendum and supersedes their statements that disposable database integration had not run.

**Current assessment:** Local implementation and focused disposable database/Auth/API verification passed for the enabled slices. Hosted integration and operational rollout remain UNVERIFIED/BLOCKED. Migrations 276–278 were applied only to a removed disposable database; no hosted deployment, real administrator provisioning or tenant mutation occurred. This is not production/security certification.

## 1. Implemented

- Dedicated `/platform-admin/login` and all 14 requested section routes, with a separate lazy-loaded workspace, responsive navigation, focus-managed dialogs/drawer, loading/error/empty/unavailable states and keyset pagination.
- Dedicated administrator session storage namespace, password/TOTP flow, verified-recovery gate and explicit MFA refresh. No public administrator registration, promotion, recovery bypass or service-role browser client.
- Authorized control-plane overview; searchable business/member/application/payment/audit/diagnostic views; invitation-intent view; contract/outbox/admin-identity views. Missing entitlement counts are Unavailable. Queue counts describe new control-plane records, not paying customers. No mixed-currency financial totals.
- Reviewed demo/live/unclassified classification with expected-version conflict detection. No bulk labeling or deletion. Classification never grants entitlement.
- Atomic application decision and delivery-disabled invitation intent, and subscription payment recording/rejection. Reasons, confirmations and stable request IDs are required. Payment rejection is Sensitive; classifications/application decisions/payment recording are Manage. Application approval grants no account or access.
- Database query health has a timestamp, source and narrow meaning. Other health/integration/backup information remains Unknown/Not configured. Diagnostics collect only whitelisted new admin-interface failure codes, not historical tenant/Edge logs. Raw errors/bodies/tokens are not ingested.
- Old `/admin/...` routes explicitly retired, without deriving platform authority from tenant roles.
- Closed unreviewed owner signup locally: no registration credential collection, Edge POST denies, and candidate trigger rejects metadata-based owner provisioning. Existing sign-in/recovery code and memberships remain unchanged.
- Candidate global URL setter is unavailable and tenant execution grants are revoked. Existing URL reads and tenant QR helpers are not rewritten.

The saved SA1 report was not present in the repository. The completed SA1 conversation report and confirmed relevant source were used. `PUBLIC_WEBSITE_PRE_REDESIGN_AUDIT.md` was read as requested, with current F2 implementation treated as newer evidence.

## 2. Security and backend implementation

Migration 276 creates nine private, RLS-enabled control-plane tables: administrators, audit events, business controls, applications, invitation intents, contracts, payment reviews, notification outbox and diagnostics. Normal client and service-role direct schema/table privileges are revoked; no tenant-access policies expose those tables. No private tables are added to Realtime and no payment-evidence Storage bucket is exposed.

Exposed RPCs:

- `get_platform_admin_context()` — minimal authorization state for the authenticated identity itself, including the MFA/recovery gate.
- `platform_admin_read(...)` — whitelisted, bounded section projections, status/search/date filters and keyset cursors.
- `platform_admin_classify(...)` — reviewed label with version and request checks.
- `platform_admin_decide_application(...)` — row-locked, single decision and unique invitation intent.
- `platform_admin_record_payment(...)` — validated unverified subscription review; unique request and normalized channel/reference identity.
- `platform_admin_reject_payment(...)` — row-locked Sensitive rejection without creating a contract.
- `platform_admin_record_diagnostic(...)` — whitelisted category/environment/request identity only.
- `platform_admin_record_access(...)` — server-derived administrator-access audit.

All protected reads/mutations require private active authorization, verified recovery attestation, AAL2, a live Auth session, a verified TOTP factor and an active verified Auth identity. Manage and Sensitive are separate flags. Sensitive actions additionally require a TOTP AMR timestamp within five minutes, using server time; refresh-token issuance is not fresh MFA. Minimal own-context lookup precedes MFA and exposes no cross-tenant data. Relevant primary documentation: [Supabase JWT claims](https://supabase.com/docs/guides/auth/jwt-fields), [Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa).

Definer functions pin an empty search path and qualify noncatalog objects. Audit actor comes from `auth.uid()`, not request fields. Success audit insertion is in the mutation transaction and has no swallowed failure. Unique request IDs, target row locks, expected versions and unique decision/review identifiers address replay/conflict risks in source. These mechanisms have NOT been exercised in Postgres.

The ledger is not cryptographically immutable. Database owners remain trusted operators. Failed transactions cannot persist their own audit insert; denied RPC/Auth events are not claimed as centralized platform history. Client failure ingestion is best effort and is unavailable if authorization/database connectivity fails. Recovery attestation is not proof of a completed recovery drill.

## 3. Tests and verification

### Final checks

| Check | Result | Evidence boundary |
| --- | --- | --- |
| Final `npm run build` | PASS: TypeScript + Vite, 2,359 modules | Local compilation/bundle only |
| Focused final Vitest | PASS: 8 files / 92 tests | Unit, executed signup handler, source contracts; no database |
| Broad Playwright regression | PASS: 92/92 in 7.0 minutes | 30 synthetic admin UI cases, 48 public footer/legal, 8 public theme behavior and 6 existing public workflows |
| Final targeted Playwright | PASS: 10/10 in 2.2 minutes | Closed signup plus admin layout/heading contrast at 320/390/768/1440, both Chromium projects |
| `git diff --check` | PASS | Whitespace only |
| Database/RLS/concurrency/real MFA | NOT RUN / BLOCKED | No approved disposable baseline |
| Lint | Not run | No lint script configured; no dependency added |

Earlier checks: 72 tests across five unit files passed, then 78 across six. The first build failed on TypeScript inference, route typing and ES2020 string API issues; these were fixed and subsequent builds passed. The first admin browser run passed 23/24; one ambiguous success/loading status locator was corrected. Screenshot review caught a white heading inherited from global CSS; scoped heading colors were fixed and final computed contrast checks passed. All prior failure evidence is preserved in temporary artifacts.

Exact final commands:

```text
npm run build
npx vitest run tests/unit/platform-admin.test.ts tests/unit/final-staff-auth-contract.test.ts tests/unit/auth-isolation.test.ts tests/unit/staff-creation-authorization.test.ts tests/unit/password-recovery-redirect.test.ts tests/unit/public-legal-pages.test.tsx tests/unit/inventory-officer-role.test.ts tests/unit/manager-staff-workspace-redesign.test.ts
npx playwright test tests/e2e/platform-admin.spec.ts tests/e2e/public-footer-legal.spec.ts tests/e2e/public-theme.spec.ts tests/e2e/public-workflows.spec.ts --grep 'unauthenticated admin|tenant authorization|unverified recovery|MFA verification|classification requires|missing service|missing entitlement|keyset pagination|all admin sections|application approval|failed mutation|payment review cannot|shared footer|legal route|footer internal|public footer|footer keyboard|public pages reflow|observe fresh|keyboard switching|system preference|theme initializes|denied theme|landing page production|mobile navigation remains|Phase B public pages' --workers=2 --reporter=line --output=test-results/sa2-regression
npx playwright test tests/e2e/platform-admin.spec.ts --grep 'all admin sections|closed application intake' --workers=2 --reporter=line --output=test-results/sa2-final-ui
git diff --check
```

The initial admin command was `npx playwright test tests/e2e/platform-admin.spec.ts --workers=2 --reporter=line --output=test-results/sa2-ui` (23 passed / one failed before the locator correction).

Admin browser cases use explicitly synthetic, intercepted Auth/RPC responses. All nonlocal requests are intercepted/blocked; no test credentials or data reach a hosted service. These checks prove UI request/response behavior, confirmation, retries retaining request identity, route gates and layouts. They do NOT prove real JWT verification, authorization, RLS, SQL execution, database idempotency or actual MFA. The signup handler itself was executed in unit tests with the Deno entrypoint captured; it denies even forged owner/admin metadata.

Public checks cover eight widths from 320 to 1440px, direct legal routes/refresh, footer anchors, theme persistence and keyboard behavior. Admin checks cover every section at four widths, menu focus/Escape, no document overflow, and selected heading contrast >=4.5:1. Tables intentionally scroll within labeled regions. Screenshots were reviewed at 320 and 1440px; the final mobile heading fix was visually reviewed. No physical-device, Safari/Firefox, screen-reader, real tenant-login or full tenant-workflow certification is claimed.

### Database tests still unexecuted

1. Migration replay, PL/pgSQL compilation and effective catalog/grant comparison.
2. Anonymous/owner/staff direct RPC, REST, Storage and Realtime denial; no self-promotion through metadata or profile writes.
3. Active versus revoked/banned/unverified admin, removed sessions/factors, missing recovery, AAL1, stale/future/malformed TOTP AMR rejection.
4. Inspect/Manage/Sensitive separation, transactional audit failure rollback and actual actor identity.
5. Concurrent/replayed/conflicting application decisions and classification versions; unique invitation-intent creation.
6. Payment reference/request deduplication, rejection concurrency and no entitlement after rejected/failed review.
7. Direct Auth metadata signup bypass denial and existing-account/staff-creation compatibility with the replacement trigger.
8. Effective global setter denial without breaking approved QR reads.
9. Any future trial/contract activation, seven-day/fixed-365-day boundary tests, renewal/reversal, historical reads and cross-surface expiry enforcement.
10. Future invitation expiry/resend/acceptance/provisioning failures and notification worker concurrency/provider outcomes.

## 4. Database state and migration inventory

Created locally only:

| Candidate | SHA-256 |
| --- | --- |
| `276_platform_admin_foundation.sql` | `724715A4B66C9AF3363B34E7D3609B6E61BC81F232D1C1ECA2E1025B516C3432` |
| `277_platform_admin_boundary_hardening.sql` | `1DC975EEC82ADC729F1E4F7FEC8E538CFB031368422060419A9C831724466B30` |

**Applied: none, locally or hosted.** These are unverified migration candidates, not deployed backend guarantees. Migration 276 depends on the existing restaurants/staff foundations and standard Supabase Auth users/sessions/MFA catalogs. Forward indexes aid bounded directory/audit queries; actual query plans are unverified.

Read-only `docker ps` identified the existing persistent `workspace` services and `p322` Edge runtime, with published ports on `0.0.0.0`. That is not evidence of a separate disposable SA2 baseline. No database connection, migration, fixture, Docker configuration or printer operation was performed. No SQL parser dependency was installed; database compilation remains unverified.

## 5. Worktree and files

Modified:

- `src/app/router/AppRouter.tsx`
- `src/modules/owner-signup/pages/OwnerSignupPage.tsx`
- `src/modules/super-admin/README.md`
- `supabase/functions/owner-signup/index.ts`
- `tests/unit/final-staff-auth-contract.test.ts`

Added:

- `src/modules/super-admin/PlatformAdminPage.tsx`
- `src/modules/super-admin/platformAdmin.css`
- `src/modules/super-admin/platformAdminClient.ts`
- `src/modules/super-admin/platformAdminService.ts`
- `supabase/migrations/276_platform_admin_foundation.sql`
- `supabase/migrations/277_platform_admin_boundary_hardening.sql`
- `tests/unit/platform-admin.test.ts`
- `tests/e2e/platform-admin.spec.ts`
- `docs/SUPER_ADMIN_SA2_CHECKLIST.md`
- `docs/SUPER_ADMIN_PROVISIONING_AND_RECOVERY.md`
- `docs/SUPER_ADMIN_SA2_REPORT.md`

All public marketing/legal/theme/footer source and F2 reports are preserved. Signup entry changed only to close the approval/retention bypass. Existing staff login/recovery, operational dashboards, tenant payment handlers, printer files and migrations 001–275 are untouched. No packages added. No commits/push. Generated build metadata is restored; task-created browser artifacts are moved outside the repository to `C:\Users\user\AppData\Local\Temp\ServeFlow-SA2-evidence`.

## 6. Blocked functionality

| Workflow | Exact blocker / current behavior |
| --- | --- |
| Actual administrator use | Candidates not applied; no privately provisioned/recovery-verified administrator; hosted MFA/session catalogs unverified |
| New application intake/reapplication submission | Applicant-retention decision unresolved; no intake endpoint or credential collection enabled |
| Invitation token issue/resend/acceptance/provisioning | Provider/retention/provisioning prerequisites unresolved; intent has no token/expiry/consumption and cannot be used |
| Trial activation | Readiness authority and trial-expiry historical policy unresolved; no activation endpoint |
| Contract/payment approval and renewal/reversal | Full operational capability enforcement/reconciliation and renewal policy incomplete; no approval/activation endpoint |
| Expiry restrictions/historical access/wind-down | Cross-surface enforcement not implemented; existing access unchanged; no cutover toggle |
| Tenant suspension/restoration | No safe cross-surface enforcement; action unavailable, not represented as an effective status |
| Reminders | Outbox foundation only; no scheduler, recipient resolver, provider, retry policy or delivery worker enabled |
| Historical error/Edge logs | No centralized ingestion; diagnostics are new admin UI categories only |
| Backup/recovery automation | No verified backup/restore source or approved destructive operation; Unknown with readiness guidance |

No generic recovery, impersonation, arbitrary SQL, shell, global configuration or administrator-management mutation is exposed. Existing tenant activity logger was not repurposed or modified; its SA1 risks remain outside this private ledger.

## 7. Founder decisions

Still needed only for the disabled workflows: readiness authority; trial-expiry historical access; exact paid-expiry wind-down; application/applicant retention; notification channel/provider/send/retry policy; early/lapsed renewal and reversed-payment rules. Named administrator/recovery verification follows the separate provisioning runbook. None was silently decided or repeatedly requested.

## 8. Next action

Authorize creation/use of one separately verified disposable SA2 baseline and a synthetic administrator recovery/MFA fixture, preserving the printer stack, so candidates 276/277 and the listed direct authorization/concurrency tests can be executed. This is the specific implementation verification dependency, not another broad audit phase.

No frontend/Edge deployment, hosted migration, production configuration/secret change, live administrator provisioning, deletion or external-system mutation occurred.

## 9. Verification addendum — 2026-10-16

**PASS: focused disposable database, Auth/MFA, API authorization, audit rollback and concurrency verification. Production readiness is not established.** Sections 1–8 and the original checklist describe the earlier implementation checkpoint; the database execution results below supersede their local verification blocker only.

### Target, provenance and isolation

Started on clean `main`, commit `e2a4c0a472c70725e978591b719e2608f8a9ca98`. Existing implementation and public website work were already committed. No existing work was discarded.

Final complete run: `0d7dd319-0e7c-4f22-bc4d-807519def184`.

| Resource | Recorded identity |
| --- | --- |
| PostgreSQL container | `serveflow-sa2-0d7dd319-db`, `749e9aee742af927545c6845b7746df189d55091d8ea5a317c28d5c739070902` |
| Auth container | `serveflow-sa2-0d7dd319-auth`, `7c93d68948c1bfd8be6c54315e27aeecc5052274240c730378c2fabd0c29e423` |
| PostgREST container | `serveflow-sa2-0d7dd319-rest`, `6aded0239afc53af9c78c3c7a64521ded28814d62eb619e51dcaf79c27c60846` |
| Network | `serveflow-sa2-0d7dd319-net`, `1e8189d4d0f09010f115dbbb619e18d8d55a37c2429ccea859f7024e4fc93c90` |
| Actual database | `sa2_disposable`; PostgreSQL `17.6`; system identifier `7697304520942637093`; data directory `/sa2/data`; SQL connection through container socket `/tmp`; internal server port `5432` |

Existing images were used by inspected immutable image ID; no images or packages were installed:

| Component | Version / image ID |
| --- | --- |
| Supabase PostgreSQL | `17.6.1.141`, `sha256:ba10e934f0a59990379f78ab9ed93926f1c291dd61a12fe4026f4202f1b89770` |
| GoTrue | `v2.193.0`, `sha256:ac6d4b1e961ae5a1a24d283967485f8195b767a8476e1044959d7a250c2da3f0` |
| PostgREST | `v14.13`, `sha256:488093de819567422bc1d37cb79da6e84bca3726bac321daeed618f0ed957888` |

Before database initialization, the harness recorded and inspected container IDs, a unique run label, exact network membership, read-only root filesystems, dropped capabilities, no-new-privileges, **zero published ports, zero bind mounts and zero persistent volumes**. Database files existed only in the new container's tmpfs. The new network had Docker `Internal=true`. Auth and API connections used generated internal container names and the new database. HTTP requests ran inside the new database container with proxy bypass; there was no host HTTP endpoint. No `.env`, linked project URL, production key or hosted target was used. All passwords, signing material and service-role JWTs were newly generated synthetic credentials.

The actual SQL database identity was also read and saved during the run. Cleanup removed only the recorded, uniquely labeled containers and their empty network; no volume deletion or prune command was used. Final Docker inventory found no remaining SA2 containers or networks. Before/after comparisons of every previously running container's ID, image, start time, mounts, published ports and network membership passed. No SQL connection to the persistent workspace/printer database occurred.

### Baseline reconstruction and migrations

This was a **focused SA2 prerequisite baseline**, not a replay or equivalence certification of all operational migrations through 275.

1. Initialized a fresh PostgreSQL cluster; created local API/Auth roles and the Auth schema. Public API default grants followed the inspected PostgreSQL image's initial-schema role/grant pattern. Authenticator membership was limited to the three API roles.
2. Executed the actual GoTrue image's `auth migrate`. Its migrations supplied real Auth tables, session/MFA catalogs and `auth.uid()` / `auth.jwt()` helpers; these were not stubbed. Granted API roles usage of the Auth helper schema.
3. Applied the complete repository prerequisites **001, 006, 017, 018, 020 and 024**, in that order. They provide the restaurants, legacy users, staff, tenant RLS and attached Auth signup trigger needed here.
4. Executed only Migration 028's first `ALTER TABLE public.restaurants ...;` as an explicitly saved prerequisite projection. No complete 028 replay is claimed; its unrelated menu/table dependencies were not guessed or reordered.
5. Applied **276, then 277** unchanged, each with `psql -X`, `ON_ERROR_STOP=1`, verbose SQLSTATE errors and its existing transaction. Both committed successfully.
6. Reproduced the defects below on 276/277, then applied forward migration **278** in the same disposable baseline. It committed successfully. All final behavior checks ran after this repair.

| Migration | SHA-256 | Actual result |
| --- | --- | --- |
| 276 | `724715A4B66C9AF3363B34E7D3609B6E61BC81F232D1C1ECA2E1025B516C3432` | PASS; unchanged from implementation checkpoint |
| 277 | `1DC975EEC82ADC729F1E4F7FEC8E538CFB031368422060419A9C831724466B30` | PASS; unchanged from implementation checkpoint |
| 278 | `3DC450C56A845EF6287BD9D19BD776190828231D9D274734880153DD75F289D7` | PASS; new forward repair, applied only to disposable database |

### Defects found and fixed

| Defect on 276/277 | Observed evidence | Repair / regression |
| --- | --- | --- |
| Business conflicts use retryable SQLSTATE `40001` | Direct SQL returned `40001`; a real PostgREST classification conflict timed out after five seconds instead of returning a response | 278 changes the four mutation functions' explicit business conflicts to `PT409`; actual HTTP conflict tests now return 409 promptly. The frontend maps `PT409` to its existing refresh/review message. |
| Payment recording accepts changed audit reason on replay | Original request followed by the same request ID/payload with another valid reason returned HTTP 200, `replayed=true` | 278 also checks the original payment audit event's action, actor, target and normalized reason. Changed reason now returns HTTP 409 / `PT409`. |
| Payment rejection accepts changed audit reason on replay | Same rejection ID with a changed valid reason returned HTTP 200, `replayed=true` | 278 requires the stored rejection audit reason to match. Changed reason now returns HTTP 409 / `PT409`. |

The latter defects did not overwrite the original ledger; they incorrectly acknowledged a request whose audit rationale differed. Correct matching requests remain idempotent. Signatures, authorization, empty definer search paths, row locks and transactional audit calls were retained. No migration history was rewritten. `PTxyz` status mapping is documented by [PostgREST](https://docs.postgrest.org/en/v14/references/errors.html#raise-errors-with-http-status-codes); the [upstream changelog](https://github.com/PostgREST/postgrest/blob/main/CHANGELOG.md) also records the later automatic-`40001`-retry fix. No platform upgrade was attempted.

### Exact verification and coverage

| Check executed | Result |
| --- | --- |
| `node supabase/audits/sa2-disposable-verify.cjs --confirm-disposable` | **106 PASS, 0 FAIL**: three migration-application checks, one Auth catalog check and 102 behavior/security/concurrency checks |
| `npx vitest run tests/unit/platform-admin.test.ts tests/unit/final-staff-auth-contract.test.ts` | **34 tests PASS, 2 files PASS** |
| `npm run build` | PASS: TypeScript project build and Vite production build; generated tracked build metadata restored |
| `node --check supabase/audits/sa2-disposable-verify.cjs` | PASS |
| `git diff --check` | PASS |

The 106 checks include compound assertions; the number is named harness checks, not HTTP request count. Synthetic fixtures were seven Auth identities, two restaurants, three tenant memberships and four private administrator rows. Users/password sessions and verified TOTP factors were created through actual GoTrue HTTP APIs. Recovery timestamps were synthetic attestations, not evidence of a real recovery drill.

| Security boundary | Result / scope actually exercised |
| --- | --- |
| Anonymous, owner A, owner B, staff | PASS: each denied all eight public administrator RPCs (32 checks), including mutations targeting another tenant |
| User-controlled metadata / legacy role | PASS: Auth metadata and even a synthetic `public.users.role='super_admin'` did not authorize platform reads |
| Inspect / Manage / Sensitive | PASS: 14 named read sections; Inspect denied Manage; Manage denied Sensitive; actual freshly verified TOTP permitted payment rejection |
| MFA / active authorization | PASS: real AAL1 denied; inactive admin, banned identity, unconfirmed email, unverified factor and missing recovery attestation denied with otherwise valid tokens |
| JWT / freshness negatives | PASS: invalid signature rejected by PostgREST; validly signed synthetic token with nonexistent session denied by SQL; missing, stale and future TOTP timestamps denied Sensitive. Signed negative tokens used only the disposable signing secret. |
| Audit actor / direct access | PASS: committed actor matches real JWT user; extra caller-supplied actor argument has no RPC overload; anon/authenticated/service_role each denied direct private audit SELECT/INSERT/UPDATE/DELETE and private guard invocation |
| Private API schema | PASS: PostgREST rejects selecting `platform_private` via profile header |
| Tenant regression | PASS: owner A can read restaurant A; restaurant B is invisible and cross-tenant PATCH leaves B unchanged |
| Global setting boundary | PASS: owner and administrator both denied `set_app_url`; no global-setting write path was enabled. This is setter authorization evidence, not a complete historical global-settings baseline. |
| Signup/login regression | PASS: actual Auth owner-metadata signup fails transactionally with no residual user/restaurant; existing synthetic owner password login succeeds |
| State / payment integrity | PASS: stale classification versions, payload/actor reuse, decided applications, invalid transitions, negative payments and case-insensitive duplicate references rejected; exact retries handled safely |
| Disabled lifecycle | PASS within tested scope: approved application creates one unusable invitation intent; recording payment creates no contract. No invitation delivery, provisioning or entitlement activation was represented as working. |

**Audit rollback: 4/4 PASS.** A temporary test-only trigger raised SQLSTATE `P0001` for a selected audit request. Classification/version, application decision plus invitation intent, payment insertion, and payment rejection each rolled back completely, with no audit event. The temporary trigger/function was removed after each case; no production backdoor was added.

**Concurrency: 3/3 PASS.** Separate PostgreSQL connections invoked the real RPCs as `authenticated`, using claims from an actual synthetic Auth token. One transaction deliberately held the relevant row lock; a third observer recorded positive `pg_blocking_pids()` before completion. These are SQL concurrency tests; JWT validation was independently exercised through HTTP, not simulated by these SQL connections.

- Conflicting classifications: blocker PID `2274`, waiting PID `2304`; one mutation/audit committed, other returned `PT409`.
- Identical classification request: blocker `2384`, waiting `2413`; one mutation/audit and one replay; version advanced once.
- Conflicting application decisions: blocker `2484`, waiting `2512`; one approval/audit/invitation intent committed, rejection returned `PT409`.

Earlier attempts are not added to the final pass total: `3b8f7398` stopped at Auth connection SQLSTATE `28000` before SA2 application (isolated network HBA prerequisite corrected); `8550e70b` passed its three preparation checks; `6caf23f8` was interrupted during harness development (44 completed checks and one resource-removal failure; discarded as a verification run); `70d022fb` had 88 completed checks followed by the real conflict timeout that motivated 278. Their disposable resources were also removed. A mount-order-only comparison false alarm was corrected by sorting mount identities. These setup/interruption outcomes do not establish product failures or passes.

### Evidence, files and remaining gates

Evidence directory: `C:\Users\user\AppData\Local\Temp\serveflow-sa2-0d7dd319`. It contains isolation plan and pre-initialization inspection, image identities, applied prerequisite hashes, exact 028 projection, GoTrue migration log, actual SQL identity, pre-fix defect observations, 106 named results, three lock-evidence files, persistent before/after snapshots and cleanup confirmation. Secrets and tokens are excluded from the saved results. The earlier HTTP timeout is retained in sibling directory `serveflow-sa2-70d022fb`.

Reproduction requires existing inspected Docker images and explicit `--confirm-disposable`. The harness creates a new label/network/containers, never reuses a database, never reads linked hosted configuration, checks isolation before SQL/HTTP operations and cleans only its own recorded resources. It also records actual database identity and rejects replacement container IDs. No dependency installation is needed.

Exactly five repository files changed in this verification task:

- Added `supabase/audits/sa2-disposable-verify.cjs`.
- Added `supabase/migrations/278_platform_admin_conflict_and_replay_integrity.sql`.
- Modified `src/modules/super-admin/platformAdminService.ts` for the new conflict code.
- Modified `tests/unit/platform-admin.test.ts` for that frontend error mapping.
- Updated `docs/SUPER_ADMIN_SA2_REPORT.md` with this addendum.

**UNVERIFIED:** hosted schema/policy/configuration equivalence; hosted JWT issuer/key rotation/session settings; real recovery/revocation operations; gateway and Edge runtime behavior; Storage/Realtime policies; browser integration against these real disposable services; full operational migration replay, production query plans and cross-surface entitlement enforcement. The existing unit test executes the owner-signup handler in a stubbed Deno host; it does not certify an actual Edge runtime. No new browser/device verification is claimed here.

**BLOCKED workflows:** the founder decisions and unavailable intake/delivery/provisioning/trial/contract/expiry/suspension/reminder/recovery workflows in sections 6–7 remain blocked. This task did not silently enable them. The next environment gate is a separately authorized nonproduction target with verified full schema/platform configuration and review of the 276 → 277 → 278 sequence; local success is not hosted or production certification.

**Safety confirmation:** persistent local Supabase, printer resources and migrations, hosted Supabase, production settings/secrets, real accounts/data and deployment state were untouched. No deployment, commit, push, package/image installation or live administrator provisioning occurred.

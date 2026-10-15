# ServeFlow Phase C.3 verification report

Date: 2026-10-16. Branch: `main`. Overall status: **NOT READY**. This is a local source and planning report, not a hosted or production certification. The canonical decisions and open items are in [PHASE_C3_POLICY_REGISTER.md](PHASE_C3_POLICY_REGISTER.md).

## Baseline and changed files

The worktree was clean before this task. Recent commits were inspected; no Phase C.3 policy document existed in `docs/`. The latest Phase C.3 planning report was supplied in the conversation, not found as a repository file. The local inventory contains 275 migration SQL files; that number does not establish hosted migration state.

| File | Change |
|---|---|
| `docs/PHASE_C3_POLICY_REGISTER.md` | Records all supplied founder decisions, server authority, audit evidence, tests, open gates, and an unapproved Ethiopia/Kenya retention proposal. |
| `docs/PHASE_C3_VERIFICATION_REPORT.md` | Records verified gaps, tests, limitations, and the next-phase gate. |
| `src/modules/owner-signup/pages/OwnerSignupPage.tsx` | Replaces the misleading “workspace is ready” and “Create my workspace” claims with account-creation language. This changes wording only. |
| `tests/unit/final-staff-auth-contract.test.ts` | Adds one assertion protecting against the misleading readiness claim returning. |

No application, invitation, trial, contract, entitlement, reminder, restoration, retention, or expiry workflow was implemented. In particular, the wording change does **not** block current operational access or fix the underlying signup path.

## Verified local gaps and disposition

| Severity | Local evidence | Policy gap | Disposition |
|---|---|---|---|
| **BLOCKER** | `OwnerSignupPage.tsx:29` invokes `owner-signup`; `supabase/functions/owner-signup/index.ts:122-133` creates a confirmed Auth user with owner metadata. | No application review or accepted invitation before account creation. | Requires a reviewed server workflow and trigger transition. No security-only frontend workaround was made. |
| **BLOCKER** | `supabase/migrations/024_owner_staff_creation_production_hardening.sql:110-158` creates restaurant and active owner membership from Auth trigger. | Provisioning precedes verified invitation acceptance and setup. | Requires isolated replacement testing and separately approved migration/cutover; current trigger untouched. |
| **BLOCKER** | `ProtectedOwnerRoute.tsx:56-82,118-139` uses active owner membership and setup completion to reach dashboard. `006_phase4_step1_restaurant_staff_foundation.sql:121-163` defines role/membership helpers. | No server-authoritative trial or contract capability. | Needs schema, RLS/RPC/Edge enforcement and historical-read design; route-only fix would be bypassable. |
| **HIGH** | `staffAuthService.ts:110-190` returns active staff memberships and signs out authenticated users without one. | Pending/rejected applicants need authenticated status access without operational membership. | Design separate applicant state and login routing in next phase. |
| **HIGH** | `028_owner_reports_settings_tables.sql:3-12` defaults `billing_status` to `trial`; Owner dashboard reads it. | Informational fields could be mistaken for entitlement. | Do not use them as authority; reconcile existing tenants. |
| **HIGH** | `209_phase11_3_runtime_configuration.sql:109-136` wraps anonymous public QR order creation without a contract check; `260_owner_tables_phase1_correctness_security.sql:61-91` keeps public menu access. | New orders need server-side expiry rejection while menu stays visible. | Review all effective overloads/base calls and implement guarded order creation only in an approved migration. |
| **HIGH** | `204_phase9_15d_exact_published_menu_snapshot.sql:69-77` marks setup complete on publish. | Setup completion is not readiness confirmation or trial activation. | Preserve setup meaning; add separate trusted states later. |
| **HIGH** | `001_phase1_saas_backbone.sql:6-10` has a `super_admin` enum; `src/modules/super-admin/README.md` says the module is locked. | No demonstrated MFA-protected platform-admin control plane. | Named-account/MFA/recovery design and isolated tests required. |
| **HIGH** | `142_phase5_feedback_storage_tenant_isolation.sql:10-22` uses role-based Storage reads; `restaurantEventService.ts:107-116` has client Realtime filters. | Expiry capability must be checked at server boundaries, with historical access preserved. | Include Storage, signed URL and Realtime effective state in next-phase inventory. |
| **HIGH** | `supabase/functions/manage-staff/index.ts:335-428` authenticates an actor and checks membership, but can repair a missing owner membership from a legacy `public.users` row with service role at lines 375-419. | Membership repair may restore active owner status without application/entitlement review; later staff mutations have no Phase C entitlement decision. | Review legacy repair and every service-role action in an isolated transition plan. Do not remove it without compatibility evidence. |
| **HIGH** | `supabase/functions/menu-publish/index.ts:42-59` checks Auth and owner membership, then uses service role for Storage work; `publish_ai_menu_draft_exact` records setup completion. | The path needs explicit setup versus operation classification and trusted entitlement/capability checks. | Preserve permitted onboarding publish while denying unrelated operational publishing after expiry; test all delegated calls. |
| **HIGH** | `supabase/functions/submit-public-payment-proof/index.ts:20-48` checks a QR session and invoice, then uploads evidence and updates an invoice with service role. | Post-expiry payment-proof submissions could affect existing obligations; eligibility and 72-hour rules are not represented. | Add to the approved wind-down action matrix, with invoice creation-time and deadline checks. |
| **HIGH** | `src/modules/owner/components/settings/OwnerSettingsPage.tsx:66-74` calls a configuration RPC and directly updates restaurant currency fields. | Owner corrections need a field allowlist and audit; direct table mutation must not reach protected identity or entitlement fields. | Review effective RLS and restrict permitted columns in a trusted path. |
| **MEDIUM** | Signup success and submit wording claimed workspace readiness before approval/activation. | Misleading customer-facing claim. | Fixed locally; focused source contract test added. |

These findings concern inspected local source and migration intent. Historical migration files may have been replaced by later migrations, and effective hosted definitions remain **UNVERIFIED**. The public QR wrapper cited above is the latest inspected local wrapper; all overloads and delegated functions still require a complete effective-state inventory. A source search found at least 105 direct `supabase.rpc(...)` call sites across Owner, Manager, Cashier, Kitchen, Inventory, Waiter order, and public ordering modules. This report samples sensitive paths; it does not claim that every operational action has been individually certified.

## Tests and checks executed

| Command | Result | Limit |
|---|---|---|
| `npx vitest run tests/unit/final-staff-auth-contract.test.ts` | **PASS:** 1 file, 16 tests. | Checks local auth contracts and wording, not database entitlement. |
| `npm run build` | **PASS:** `tsc -b` and Vite production build. | Build is not hosted, browser, RLS or RPC evidence. |
| `git diff --check` | **PASS:** no whitespace errors in tracked changes. | Whitespace only. |

No isolated Supabase project was available for invitation, provisioning, trial, annual contract, expiry, wind-down, refund, reminder, RLS, RPC or Edge tests. Those scenarios are **not passed**. A full unit suite or destructive hosted smoke test was not run because it would not establish the missing security boundaries and may touch shared state.

## Unresolved policy and operational decisions

- **BLOCKER:** Approve the Ethiopia/Kenya retention schedule, legal exceptions, backup handling, and data-controller responsibilities before application intake. The register's periods are researched planning proposals, not approved values or legal-compliance claims.
- **BLOCKER:** Approve the exact post-expiry wind-down action allowlist, eligibility edge cases, refund/reversal authority and handling after 72 hours.
- **BLOCKER:** Define and verify named platform administrators, MFA enforcement, account recovery and emergency access.
- **BLOCKER:** Review every existing tenant's ownership and entitlement evidence; zero unresolved tenants before enforcement cutover. No automatic grace period or legacy-date rewrite is allowed.
- **OPEN:** Approve a fixed UTC reminder send time. Verify provider, recipient contact details, consent and costs before enabling delivery.
- **UNVERIFIED:** Hosted project identity, migration history, Auth trigger, RLS, grants, effective RPC definitions, Edge deployment/JWT settings, Storage, Realtime, MFA/recovery and tenant records. A service-role key is not a read-only audit credential; none was used.

The approved contract term is precisely **365 × 24 hours** from a trusted UTC start. The earlier calendar-anniversary February 29 → March 1 convention does not apply to new fixed-term contracts. Existing dates require individual review, not recalculation.

## Required migration and hosted work — not executed

The next implementation requires additive application/invitation/provisioning/audit records; a privileged administrator control plane; authoritative trial and contract decisions; a restaurant-scoped capability resolver; distinct historical-read and operational permissions; guarded anonymous QR order creation; carefully scoped wind-down RPCs; and RLS/Storage/Realtime/Edge enforcement. It also needs a plan to transition from the current Auth trigger without duplicate provisioning or loss of legitimate access. These are conceptual changes only; no migration file was created or applied.

Read-only hosted inspection must first compare the effective catalog, grants, triggers, policies, functions and applied migrations against local source. Use a named read-only database role and read-only project-management access, aggregate/redacted tenant results, and a recorded project identity. Do not use service-role writes or a provisioning endpoint as inspection shortcuts.

## Next phase proposal: C.4 isolated security implementation

**Scope:** After the policy/hosted gates, build the application/invitation and privileged decision model in a disposable Supabase project. Implement and test server capabilities, then stage the trigger transition and per-surface enforcement. No production cutover is part of C.4 by default.

**Dependencies:** Approved retention schedule; wind-down allowlist; admin MFA/recovery procedure; fixed reminder time before reminder delivery; read-only hosted inventory; reviewed migration plan; synthetic isolated environment. Existing-tenant reconciliation must be complete before any later enforcement cutover.

**Acceptance:** Tests must prove invitation expiry/replay/resend, partial-failure idempotency, exact seven-day trial, exact fixed 365-day contract (including leap/year boundaries), authorized activation/renewal/restoration, tenant-specific expiry, historical viewing, public menu/new-order split, 72-hour eligible wind-down, safe refund/reversal audit, no new sales after expiry, reminder idempotency and supersession, RLS/RPC/Edge/Storage/Realtime bypass rejection, no expiry-driven deletion, and multi-restaurant isolation. Compare effective database definitions and grants after isolated migrations. A local build alone cannot satisfy these gates.

**Rollback:** Preserve current trigger until the isolated replacement is proven and separately approved. Use additive records and reversible feature activation; rehearse rollback with synthetic data and verify historical reads and in-progress financial obligations. Any later production rollback needs an approved runbook and effective-state snapshots.

**Gate:** Phase C.3 is **NOT READY** for server implementation or deployment approval while the blockers above remain. The planning documents and wording correction can be reviewed independently.

## Restricted-action attestation

No database migration was created or executed. No hosted Supabase system, database records, Auth settings, RLS policies, Storage/Realtime configuration, secrets, environment variables, production access, tenant entitlements, users, invitations, payments, or reminders were changed. No deployment, publication, push, commit or Git-history rewrite occurred. No real onboarding or payment workflow was triggered.

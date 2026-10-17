# SA3.3B — reproducible fresh-install migration remediation design

Date: 2026-10-17. Status: **DESIGN ONLY — implementation and database verification require further approval.** This report was absent before creation. No migration, application source, configuration or database was changed.

## Executive summary and correction to earlier reports

Recommend **Option B implemented as two explicitly approved historical replay corrections under Option A's compatibility safeguards**: conditionally revoke PUBLIC privileges on the exact optional helper in 015, and introduce nullable `public.menu_items.description text` before its first use in 028. Preserve every other migration statement, version and filename. Record original and corrected hashes and verify fresh and upgrade paths before calling this repair safe. Do not rerun corrected historical migrations on existing installations.

This is narrower than the full baseline initially recommended in SA3.3A. A baseline would require proving the fidelity of hundreds of objects, data initialization and platform settings; these two known blockers have specific compatibility corrections that retain chronological execution. Keep Option C as a fallback if further replay evidence demonstrates broader missing provenance that cannot be resolved safely. No successful full replay is claimed now.

**Source correction:** prior reports say 055 first adds `menu_items.description`. Actual source shows **054**, lines 8–9, first adds it; 055 line 7 repeats the compatible addition. The independent 028 blocker remains real. 032 and 037 also read the column before 054. Earlier reports are left untouched under this phase's one-file restriction; this report supersedes their first-addition claim.

## Verified source, error and history evidence

- `015_phase4_function_execute_grant_hardening.sql:30` contains `revoke all on function public.rls_auto_enable() from public;`. Searching the migration SQL finds no creation of this function. The full 38-line migration changes ACLs only. Existing SA3.3A/P3.2.1/P3.2.2 reports record missing-function SQLSTATE 42883; the original raw 015 error log remains unavailable in inspected artifacts.
- `028_owner_reports_settings_tables.sql:700` is its sole reference to `menu_items.description`, inside the SQL-language `get_public_qr_menu(text)` definition beginning at line 651. Retained `C:\Users\user\AppData\Local\Temp\serveflow-p321-stack-start.log:141` reads `ERROR: column menu_items.description does not exist (SQLSTATE 42703)`; line 143 identifies statement 39. It is a schema dependency error, not evidence of invalid SQL syntax.
- The retained temporary 015 replaced the revoke with a comment; temporary 028 matches current source. This diagnostic run explains reaching 028, but is not an approved replay path.
- Git path history shows 015 and 028 added at `35ff3a2` on 2026-06-25 and no subsequent changes. 054 and 055 were added at `f96ae22` on 2026-07-06. Earlier catalog reports record hosted history containing 015/028 and the developed schema containing the missing objects. Exact originally applied bytes, deployment timestamps and how those objects originally arrived are not proven by Git or the reports.
- Original SHA-256: 015 `D36C8FD0A8CB325D414A152365DA6C7ECED6DA3CA77402846023888B01928F24`; 028 `5A855869CD4CCCE2128FA3410F39D609625A927CC9480D17C68FB0317A280C73`. These matched this inspection. Future corrected hashes must be computed from actual implementation, never invented in this design.

Read SA3.1, SA3.2, SA3.3A and SA2 reports, actual relevant migrations, the SA2 harness, package scripts and Supabase configuration. The current configuration contains only printer Edge JWT entries and supplies no complete fresh-install contract. No hosted query, CLI migration command or existing database audit script was run.

## 015: security purpose and proposed exact behavior

The signature is **`public.rls_auto_enable()` with zero arguments**. The revoke removes any PUBLIC privileges on that function (function privilege is EXECUTE). It does not create or enable RLS, create an event trigger, revoke independently granted privileges from individual roles, or disable an existing trigger.

Supabase's official [event-trigger guide](https://supabase.com/docs/guides/database/postgres/event-triggers) presents `rls_auto_enable()` as an example users can create to enable RLS for new tables, with a separately created event trigger. It documents support for such triggers, not a guarantee that this particular function exists in every new project. This supports conditional existence handling; it does **not** prove that ServeFlow's historical hosted function matches the example. Do not copy the example into the migration or invent a stub. The deployed body/trigger provenance remains unknown and need not be changed to preserve the existing revoke's effect.

Proposed replacement for that single statement, for later review and implementation only:

```sql
do $migration_015_optional_helper$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public;
  end if;
end;
$migration_015_optional_helper$;
```

Required properties:

- Lookup is schema-qualified and exact-signature; overloads and similarly named functions in other schemas do not satisfy it. Other 015 GRANT/REVOKE statements remain unconditional and unchanged.
- If present, execute the original revoke; any ownership/permission/type/race error propagates and fails the migration. No `WHEN OTHERS`, privilege-error catch or generic skip list.
- If absent, no EXECUTE privilege exists on that object to revoke. Do not create a function or claim automatic RLS is installed. Record presence/absence in the verification evidence.
- Table security must be enforced independently. For example, 001 explicitly enables RLS on its tenant tables, and 276 explicitly enables RLS and revokes private-table/schema privileges. Before release, inventory and test **all intended exposed tables** at the final migration head, including tables created when the optional helper is absent. If a table relies on automatic RLS with no explicit protection, stop and propose a separately reviewed correction; the conditional revoke does not prove that broad security gate.
- Test with both helper absent and a synthetic helper present, including retained definition/owner/trigger linkage and PUBLIC grant removal. An unexpected non-function object or inability to revoke must fail rather than be treated as absence. Effective role access must consider direct grants as well as PUBLIC privileges.

## 028: column provenance, semantics and proposed correction

The relevant history through 055 is:

| Migration | Relevant menu behavior |
| --- | --- |
| 001 | Creates `menu_items` with tenant/category FKs, price check, image/availability fields and RLS; no description column. |
| 003, 026 | Public menu JSON uses a literal null description, so these functions do not require the column. |
| 028 | First physical-column read, in the public menu function. |
| 032 | Adds archive columns/index and restricts deletion; replacement public menu still reads description. |
| 037 | Public-menu branding replacement also reads description. |
| 041, 042 | Add/reconcile station assignment, same-tenant FK and index; do not supply description. |
| 054 | Adds nullable `description text` to menu items (and a separate category description). Starter-template functions copy descriptions into menu rows. |
| 055 | Repeats `ADD COLUMN IF NOT EXISTS description text` and adds other menu/nutrition metadata and related constraints. |

Later menu/localization/publish migrations consume descriptions; 190 also introduces **separate** localization-table descriptions and constraints. Those are not defaults or NOT NULL changes to `public.menu_items.description`. No scoped source evidence was found that the menu column should be nonnullable, have a default, or lose existing content.

Propose adding this statement near the beginning of 028, before its function definitions:

```sql
alter table public.menu_items
  add column if not exists description text;
```

This adopts the same nullable/no-default column contract already declared by 054/055. Existing rows receive NULL if the column is newly introduced. If it already exists, no values are overwritten; tests must assert the expected type, nullability and default rather than treating `IF NOT EXISTS` as a schema check. An incompatible pre-existing column must cause the guarded verification path to stop for review, not be coerced or replaced automatically. Do not change price, availability, FKs, policies, archive fields or descriptions in other tables.

This is preferable to returning NULL in 028: that would discard descriptions from developed databases and leave 032/037 broken. Reordering or moving all of 054/055 ahead of 028 would pull in template/station and other dependencies, enlarging the change. Introducing just the already-intended column fixes the ordering without moving migrations. It changes column availability between 028 and 053 on a fresh installation, which is intentional and must be recorded. Fresh column ordinal position may differ from developed installations; compare names/types/semantics and check any positional inserts or composite/`SELECT *` consumers rather than assuming physical order equality.

## Option comparison and existing-install compatibility

| Option | Assessment |
| --- | --- |
| A: directly rewrite original SQL without a compatibility record | Reject. Existing ledgers may contain original SQL; applied versions would not be rerun automatically and Git changes alone cannot certify equivalent behavior. |
| B: two narrow guards/early prerequisite with controlled historical replay revision | **Recommended**, conditional on explicit approval to edit these two historical sources and passing the verification gates below. Preserves all migration versions and actual execution of the complete sequence. |
| C: explicit fresh-install baseline/snapshot | Feasible in principle, not ready in this repository. Requires complete catalog/security/configuration and necessary seed-data fidelity, a dedicated installation/upgrade strategy and independently verified source of truth. Larger scope than the known fixes. |
| D: guards now and snapshot immediately | Defer snapshot. First establish that the corrected chronological path runs; only then consider a derived baseline as a separately versioned optimization. Otherwise two unverified installation paths increase drift risk. |

The recommended compatibility strategy deliberately permits **documented old and revised hashes for versions 015 and 028**. Preserve original sources through Git commit/blob identity and record them in a reviewable manifest. Do not rename versions, delete files, rewrite hosted history, force migrations to rerun, or mark anything applied without execution.

On an existing installation with 015/028 recorded, the revised source must not be replayed. Existing data and function definitions remain as they were; later migrations remain the upgrade mechanism. If an existing schema has an actual missing column or privilege defect, handle that with a new forward migration after investigation, not by rerunning 028 and its backfills/policies. No new forward migration is currently justified solely to repair fresh replay: later files cannot fix an earlier stop, and no current hosted defect was inspected in this phase.

Supabase [migration list documentation](https://supabase.com/docs/reference/cli/supabase-migration-list) states that its comparison is by migration version/timestamp. Consequently CLI agreement alone cannot validate historical bytes. The proposed manifest/harness must check source hashes, known old/new variants, recorded execution evidence where available and actual catalog assertions. Unknown history content or schema drift must be reported, not repaired automatically. CLI compatibility with the installed 2.107.0 and repository three-digit versions must be exercised in the approved disposable environment; current web documentation is not proof of that runtime.

## Baseline fallback and future drift management

Supabase supports schema squashing, but its [CLI documentation](https://supabase.com/docs/reference/cli/v0/supabase-orgs) warns that squashes omit data manipulation such as bucket/cron initialization. Squashing also requires a usable source schema and can overwrite migration files. Do not run it here or treat the earlier printer-focused schema archive as a complete baseline. The repo has no supported baseline runner today; its old schema export verified only a limited printer contract and needed settings/grant adjustments.

If further failures require C, design a separate versioned baseline with its own truthful installation identity and an upgrade manifest above its cutoff. Capture types, defaults, constraints, indexes, functions, definer paths, triggers/event triggers, RLS/policies, explicit/default grants, required nonsecret settings and Storage initialization; use platform-provided Auth infrastructure and explicitly preserve application Auth triggers. Never copy tenant data or Auth identities. Future migrations must be tested against both baseline-built and historical-upgrade disposable fixtures and catalog differences reviewed. Do not insert fictitious 001–275 ledger entries. This fallback is not part of the proposed small implementation.

## Remaining chain and SA2 limitations

The prior inventory found 278 uniquely numbered files, 001–278 without gaps. The missing helper and early description reference are independent. The standalone 023 `storage.buckets` failure establishes a platform prerequisite: use full Supabase Auth/Storage/API infrastructure, not bare PostgreSQL. Full replay beyond the documented failures remains unverified; none of the additional field consumers above is claimed as a separately reproduced error.

Migrations 276–278 require restaurants/staff objects, real Auth users/sessions/factors/helpers and API roles. 277's replacement signup function needs the intended trigger attachment; its unavailable global setter supersedes earlier 061/064 behavior. 278 depends on 276's private tables/guards and preserves the repair order. No direct 276 dependency on `rls_auto_enable()` or menu descriptions was found. The SA2 harness applies 001/006/017/018/020/024 and only the first restaurant ALTER from 028 before 276/277/278. It proves that focused scenario, not the full historical schema or all workflow security. Final-head catalog and integration tests are required.

Historical full replay also executes data initialization and obsolete intermediate policies/functions before later replacements. Keep the disposable target inaccessible to real app users during replay; do not stop at an intermediate version and call it ready. Review data-changing migrations and required settings during implementation. Existing printer migrations remain unchanged; no printer service or physical test is authorized by this design.

## Exact proposed implementation files

These are **future** changes requiring explicit approval; none was made:

1. Modify `supabase/migrations/015_phase4_function_execute_grant_hardening.sql` — replace only the orphan revoke with the exact existence guard and explanatory comment.
2. Modify `supabase/migrations/028_owner_reports_settings_tables.sql` — add only the nullable description prerequisite before first use, with ordering comment.
3. Add `supabase/audits/fresh-install-migration-manifest.json` — revision ID, Git provenance, original/candidate hashes, all migration order/hashes, platform requirements, permitted variants and verification assertions. Recheck each proposed path for conflicts before creating it.
4. Add `supabase/audits/fresh-install-migration-verify.cjs` — explicit disposable-target input and identity guards, source/ledger checks, exact error capture, per-migration execution/outcome records, catalog/security assertions, and synthetic fresh/upgrade verification. No fallback to `.env.local`, current CLI link or workspace ports; no silent SQL substitutions or automated repairs.
5. Add `tests/unit/fresh-install-migration-manifest.test.ts` — meaningful tests of target rejection, manifest/hash drift and unsupported history handling, not tests that merely search for the proposed SQL text.
6. Add `docs/FRESH_DATABASE_INSTALL.md` — revised historical-source policy, precise platform prerequisites, fresh/upgrade procedures, unsupported states, evidence requirements and cleanup/recovery boundaries.

No changes proposed to 054, 055, 276–278, printer files, app code, package dependencies or active environment configuration. The harness should reuse established SA2 test cases conceptually without invoking scripts hardcoded to old isolated targets or copying their temporary substitutions.

## Staged verification and acceptance

**Stage 1 — approved source implementation:** make only the proposed two SQL edits plus manifest/harness/docs/tests. Review exact diffs, hashes and non-target-file preservation. Confirm the original raw-log limitation and 054 correction remain documented. Run target/manifest unit tests, SQL-file diff review and `git diff --check`. This stage makes no database or hosted changes.

**Stage 2 — separately approved empty disposable target:** record organization/project reference or isolated database/container identity, platform versions, roles, expected API/JWT issuer and cleanup scope. Require an allowlisted target distinct from existing hosted and workspace resources; verify empty application schema and ledger. No real founder account. Capture all source hashes and fail before SQL if any identity/hash preflight differs. Creating a hosted project also needs the founder's separate creation/cost approval.

**Stage 3 — full corrected chronological replay:** execute 001 through current approved head with exact stdout/stderr, SQLSTATE, statement context, per-file transaction/commit outcome and actual ledger evidence. Respect explicit transaction blocks and enum/DDL transaction requirements; do not blindly wrap the whole chain in one transaction. Stop on the first new failure without auto-remediation. Migration files 015/028 have no internal transaction block, so define atomic runner behavior for them. Do not use the historical shim runner. A passing exit code is necessary but insufficient.

**Stage 4 — behavioral and catalog acceptance:**

- Verify helper-absent path creates no substitute helper/trigger and all final intended tables still have required RLS/policies/grants. In a separate disposable fixture, verify helper-present path removes PUBLIC EXECUTE without changing the helper body/owner/trigger; insufficient authority must fail. Check exact zero-argument matching and separately granted role privileges without falsely claiming their revocation.
- Immediately after 028, inspect nullable `text` description with no default; query the public-menu function with synthetic data, testing NULL and nonempty descriptions. After 032, 037, 054 and 055 confirm correct functions, unchanged existing descriptions, intended constraints and no accidental default/backfill. Verify named-column consumers and any positional/composite assumptions.
- Inventory expected schemas/types/tables/columns/constraints/indexes/functions/triggers, owners/definer search paths, explicit/default grants, Auth integration and private-schema nonexposure. Validate both tenant isolation and intended public QR reads through actual RPC/API calls.
- Verify 276 → 277 → 278 effects, inactive/nonadmin/AAL1 denials, synthetic Inspect/Manage/Sensitive separation, recovery gate and actual Auth TOTP AAL2/freshness. Preserve disabled signup/activation features. Synthetic identity/factor writes require explicit test authorization; no founder identity.
- Run audit rollback, idempotency/conflicting request tests and real multi-client lock/concurrency checks from the SA2 scope. Use rollback evidence and positive lock observation, not mocked success.
- Exercise representative Owner settings/tables/menu/reports, staff login, tenant order/payment and kitchen paths on synthetic fixtures; use the real approved API for the Super Admin browser login/MFA test. Run focused existing unit/browser suites and `npm run build`; build success does not prove database readiness.

**Stage 5 — upgrade fixture:** on a separate disposable target establish a representative old schema with original historical migrations genuinely executed under documented platform prerequisites (not a falsified ledger), or use a provenance-verified isolated preexisting fixture. Seed only synthetic existing menu descriptions, tenants and history. Capture original 015/028 history/ACL/schema, then run the normal pending-only upgrade path using revised repository source. Prove 015/028 are not re-executed, descriptions/history are retained, only actual pending versions run, and resulting intended catalogs/security behavior agree with the fresh path. Include an intermediate pre-028 fixture and both helper states where relevant. If a representative fixture cannot be established without unknown prerequisites, report this gate blocked; do not claim production compatibility from the fresh test.

**Stage 6 — cleanup and closure:** retain redacted evidence and exact created resource IDs. Cleanup requires explicit disposable-resource authorization and an identity recheck; never use wildcard project/volume deletion or current linked defaults. Verify only recorded disposable resources disappeared and persistent identities/settings were untouched. A failed fresh install can be discarded/recreated under that scope; rolling back committed schema/data changes on an existing database requires a reviewed restore/forward-repair strategy. Reverting Git does not roll back a database. Dropping description would destroy data and is not an approved rollback.

## Decision and authorization boundary

The chain has a narrowly repairable design for the two known failures, **not a certified complete repair**. Unknown helper provenance, full-chain replay, exact current hosted state, platform/CLI compatibility and representative upgrade evidence remain open. The guard does not require copying the unknown helper, but final RLS behavior must pass independently.

Before creating a hosted disposable project, approve the historical-source compatibility policy and review the concrete source patch, manifest and target-guard harness. Source implementation and offline tests can happen first under explicit approval; database verification necessarily follows on an approved disposable target and cannot be required to pass before such a target exists. This report authorizes neither step.

Only this new design report was created. No migrations, application sources, databases, Auth users, administrators, projects, environment variables, credentials, hosted settings, printer resources, dependencies or Git history were modified. Existing SA3.2 and SA3.3A untracked reports were preserved.

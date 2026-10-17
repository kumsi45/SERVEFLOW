# SA3.3A — fresh-database migration investigation

Date: 2026-10-16. Source checkpoint: `6e70dc3`. Investigation only; no database connections, migration executions, remediation, or environment changes. The pre-existing untracked SA3.2 setup plan was preserved. This report was absent before creation.

## Executive summary

The recorded fresh replay is blocked by two independent missing prerequisites. Migration 015 revokes access to `public.rls_auto_enable()`, which no checked-in migration creates. Migration 028 defines a SQL function that reads `menu_items.description`, although the checked-in chain first adds that column in 055. Stopping at 015 prevents an unmodified replay from reaching 028. A retained temporary replay copy replaced the 015 revoke with a comment and then failed at 028; this was diagnostic evidence, not a successful or approved installation path.

**The original complete chain is not demonstrated to replay successfully; the available evidence demonstrates failures.** No failure was reproduced in this phase. The raw 028 log survives; the original raw 015 error output was not located in the inspected repository and retained replay logs. Its SQLSTATE and missing function are documented in prior reports and corroborated by current source.

Recommend designing a versioned fresh-install baseline (Option C) with explicit provenance, actual execution records and separate upgrade handling. Do not rewrite deployed migration files, silently skip statements, or label unexecuted historical migrations applied. A later-numbered corrective migration alone cannot fix an earlier replay failure. **Wait to create the hosted development project until the proposed baseline scope, manifest and verification approach are reviewed.** An approved disposable target will then be needed to validate the candidate; source review alone cannot certify it.

## Evidence and provenance

Reviewed the SA3.1 readiness report, SA3.2 setup plan, SA2 report and harness, provisioning/recovery runbook, complete SQL of 015 and 028, relevant predecessor/successor migrations, Git history, current configuration and retained replay artifacts. No existing audit script was executed.

| Evidence | What it establishes | Limit |
| --- | --- | --- |
| `docs/PRINTER_P3_2_1_CERTIFICATION_REPORT.md:49–63` | Original full-stack replay stopped at 015 with SQLSTATE 42883; temporary modified copy proceeded to 028 and SQLSTATE 42703. Standalone Postgres also lacked Storage at 023. | Prior recorded results; no fresh execution here. |
| `docs/PRINTER_P3_2_2_CERTIFICATION_REPORT.md:10–14` | Earlier hosted read-only catalog found the function/column and ledger entries, while their source prerequisites were missing/out of order. | Historical catalog evidence, not a current hosted query or proof of original deployment bytes. |
| `C:\Users\user\AppData\Local\Temp\serveflow-p321-stack-start.log` | Line 119 announces 028; line 141 contains the exact error below; line 143 identifies statement 39; line 145 begins the SQL function definition; line 243 references the missing column. | This retained run passed the modified 015; it is not the untouched-chain 015 failure log. |
| Retained `serveflow-p321-stack\supabase\migrations\015_phase4_function_execute_grant_hardening.sql` | A read-only diff shows exactly one SQL change: the orphan revoke was replaced with `-- isolated compatibility shim: absent legacy function`. | Must not be promoted into an install path. |
| Retained temporary 028 | SHA-256 matches current repository 028. | Confirms source used for that failure, not all environment settings. |
| `supabase/audits/printer-p321-local-schema.cjs` | Historical standalone harness uses per-file transactions and emits filename/SQLSTATE/error. It explicitly strips the 015 revoke and only selects versions through 274. | Not an unmodified replay runner, not suitable to execute against today's persistent resources; not run here. |

Repository SHA-256 fingerprints:

- 015: `D36C8FD0A8CB325D414A152365DA6C7ECED6DA3CA77402846023888B01928F24`.
- 028: `5A855869CD4CCCE2128FA3410F39D609625A927CC9480D17C68FB0317A280C73`.

Git is not shallow. Path-specific history shows both files added in `35ff3a2` (2026-06-25), with no subsequent path changes; diff from that commit to HEAD is empty. Thus no post-commit edits to these two files were found. Deployment timing, any pre-commit SQL versions and exact applied bytes remain unknown; a successful ledger entry cannot resolve them.

## Migration 015 — complete dependency and behavior analysis

File: `supabase/migrations/015_phase4_function_execute_grant_hardening.sql`, 38 lines. It contains only GRANT/REVOKE statements. It creates no table, column, enum, function, trigger, policy, index, extension or seed row. It requires the executing role to have authority to change the named function ACLs and requires `anon`/`authenticated` roles from Supabase. `public` in these grants is the PUBLIC pseudo-role.

| Named function/signature | Earlier source prerequisite |
| --- | --- |
| `current_user_restaurant_id()`, `current_user_role()`, `is_restaurant_member(uuid)`, `has_any_role(public.user_role[])` | 001; helpers read `public.users` and use `auth.uid()`. `user_role` also comes from 001. |
| `current_restaurant_staff_role(uuid)`, `has_staff_role(uuid, public.restaurant_staff_role[])`, `is_active_restaurant_staff_member(uuid)` | 006; first two replaced in 010. Staff enum/table originate in 006; membership depends on Auth UUID and active staff rows at runtime. |
| `approve_order_payment(uuid)` | 007, using staff/order foundations in 001/006. |
| `start_order_preparation(uuid)`, `mark_order_ready(uuid)` | 009. |
| `update_order_status(uuid, public.order_status)` | 001, replaced in 002 and restricted by 008; enum originates in 001 and grows in 006. |
| `get_public_qr_menu(text)` | 003. |
| `create_public_qr_order(text,text,text,text,jsonb)` | 004 and replacement 005. |
| `rls_auto_enable()` | **No defining migration found anywhere in the current migration directory.** Only 015 references this name. |

015 revokes PUBLIC access to the internal helpers and staff actions, grants authenticated execution to the listed helpers and three staff actions, and preserves public QR RPC access through explicit anon/authenticated grants. It revokes PUBLIC execution on `update_order_status` without adding a fresh authenticated grant there. These ACL effects must be inspected independently in a future test; REVOKE from PUBLIC does not remove an independently held role grant. The missing helper's body and possible event-trigger attachment are not present in migration source, so its name alone cannot establish what it does.

**Failure:** the reports record SQLSTATE `42883` and absent `public.rls_auto_enable()`. The implicated statement is line 30:

```sql
revoke all on function public.rls_auto_enable() from public;
```

The original exact server message/caret output for 015 was not recovered. Do not treat a reconstructed PostgreSQL message as a verbatim transcript. Confirmed from source plus historical failure evidence: this unconditional revoke assumes a zero-argument public function that the recorded clean target did not have. It is not a seed-data problem. The reports record that the developed hosted database had the function; possible origins include manual SQL, platform-specific bootstrap, or an omitted earlier change. None of those origins is established. Distinguishing them requires old setup records or read-only definition/dependency/provenance evidence under a separately authorized scope; this investigation did not connect to hosted SQL.

Repeated GRANT/REVOKE operations generally converge on the same privileges when the exact objects/roles exist. They do not fail merely because an object already exists. Missing signatures/types/roles or insufficient ownership can fail; only the missing helper is evidenced as this replay's failure. No explicit transaction surrounds this file; partial ACL changes would be possible with a statement-by-statement autocommit runner. The future runner must document transaction behavior. An otherwise fresh Supabase database without ServeFlow 001–014 is not a valid target for 015, and even with those predecessors the orphan prerequisite blocks the recorded replay.

## Migration 028 — complete dependency and behavior analysis

File: `supabase/migrations/028_owner_reports_settings_tables.sql`, 714 lines. It uses existing tenant, menu, order, staff and Auth foundations; it does not create an extension or require a pre-existing Auth user to apply DDL.

### Objects and statements changed

- Adds restaurant fields: `total_tables`, `profile`, `business_hours`, `ordering_settings`, `branding`, `notification_settings`, `security_settings`, `subscription_plan`, `billing_status`. Updates restaurant table-count data and adds `restaurants_total_tables_bounds`.
- Creates or extends `restaurant_tables` with `id`, `restaurant_id`, `table_number`, `label`, `qr_path`, `active`, `created_at`, `updated_at`. Backfills missing labels/paths, sets required columns NOT NULL, and conditionally adds primary key, restaurant foreign key, bounds check, `(restaurant_id,id)` uniqueness and `(restaurant_id,table_number)` uniqueness. Adds `restaurant_tables_restaurant_id_idx`.
- Recreates `restaurant_tables_set_updated_at` using existing `public.set_updated_at()`. Enables RLS, grants authenticated CRUD and anonymous SELECT, replaces named SELECT/manage policies. Historical public-active policy allows active table metadata reads; later schema/security must be validated at the final migration head, not certified from this intermediate state.
- Defines `sync_restaurant_tables(uuid,integer)` and `update_restaurant_configuration(uuid,text,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)`, with Owner membership checks. Sync writes restaurant counts, upserts requested tables and deactivates excess tables. The migration also inserts initial table rows for existing restaurants using `generate_series`, with conflict-do-nothing.
- Replaces `get_owner_reporting_center(uuid,timestamptz,timestamptz)`, returning order/menu/staff/table/customer aggregates; replaces `enforce_order_table_number_bounds()` used by the existing orders trigger; replaces `create_public_qr_order(text,text,text,text,jsonb)`; replaces SQL-language `get_public_qr_menu(text)`. Grants/revokes their execution as written. It neither creates nor calls `rls_auto_enable()`.

### External object/column dependencies

| Object | Columns/functions/types needed by 028 | Origin |
| --- | --- | --- |
| `restaurants` | `id`, `name`, `slug`; existing `table_count`; newly added configuration fields above | 001; `table_count` added in 018. |
| `restaurant_staff` | `id`, `restaurant_id`, `display_name`, `role`; Owner helper runtime also uses `user_id`, `active` | 006 and later membership hardening 010/017/020/024. |
| `orders` | `id`, `restaurant_id`, `customer_user_id`, `status`, `total_price`, `created_at`, `customer_name`, `table_number`, `payment_method`, `order_source`, `payment_verified_at`, `payment_verified_by`, `completed_by` | 001; public-order fields/nullability in 004; payment method in 005; staff audit fields in 006/016 and FK corrections 021/022. |
| `order_items` | `restaurant_id`, `order_id`, `menu_item_id`, `quantity`, `price` | 001. |
| `menu_items` | `id`, `restaurant_id`, `category_id`, `name`, `price`, `image_url`, `available`, **`description`** | All listed fields except description originate in 001; description first added by 055. |
| `categories` | `id`, `restaurant_id`, `name` | 001. |
| Functions/types/roles | `auth.uid()`, `has_staff_role(uuid,restaurant_staff_role[])`, `set_updated_at()`; enum values including Owner and pending-payment; anon/authenticated/service_role; UUID generator and standard JSON/aggregate/time functions | Supabase Auth/roles, 001 pgcrypto/type foundations, 006/010 helpers, 004–006 lifecycle changes. |
| Orders trigger | `enforce_order_table_number_bounds` attachment on orders | 026 creates attachment; 028 replaces its function body rather than attaching a new orders trigger. |

Its application-time backfills work with zero restaurant rows; no particular seed restaurant or Auth identity is required. Existing dirty rows can fail NOT NULL, bounds, FK or uniqueness enforcement; these are **potential upgrade risks, not the observed missing-column failure**. Name-only `IF NOT EXISTS` and conditional constraint checks do not prove existing objects have the intended definitions. Re-execution can rewrite policies/functions and backfill missing table rows, so this is not a general no-op or a safe unrestricted rerun. `CREATE OR REPLACE FUNCTION` can also fail against an incompatible existing signature/return contract. Neither 015 nor 028 wraps itself in an explicit transaction; runner-level rollback must be verified.

### Exact observed failure and explanation

Retained raw log line 141:

```text
ERROR: column menu_items.description does not exist (SQLSTATE 42703)
At statement: 39
```

The failing statement begins `create or replace function public.get_public_qr_menu(target_restaurant_slug text)` (repository line 651). Its SQL-language body references `menu_items.description` at line 700. Migration 001's menu table lacks that column. Migration 026's earlier QR menu explicitly emits `'description', null`, whereas 028 reads the column. Migration `055_menu_data_foundation_phase4d1.sql:7` eventually adds `description text`, too late for 028. A zero-row database still fails when this function definition is validated: missing schema cannot be supplied by seed data.

The log proves this is a column-resolution failure on the recorded stack, not a demonstrated SQL grammar/PostgreSQL-version incompatibility. Different function-body validation settings could change when a missing reference fails; disabling validation would defer a broken dependency and is not a remediation. A manually pre-added column or different earlier source could explain success on an old developed database, but its historical origin is unknown. No current hosted equivalence is asserted.

## Chain inventory, history and connection to Super Admin

Inventory: exactly 278 SQL migration files, versions 001–278 inclusive, all names match `NNN_description.sql`, no missing numeric version, no duplicate version. Lexicographic order matches numeric order within this inventory. Three-digit versions are the repository convention; actual CLI-ledger compatibility still needs target-specific verification. A complete filename list does not mean all schema prerequisites are represented.

001 assumes a Supabase platform with Auth objects and API roles; it creates enums/tables/indexes without universal existence guards and is not a safe upgrade replay on a populated schema. `supabase/config.toml` only lists two printer Edge settings. The README's claimed empty `supabase/seed.sql` is absent from this checkout, so it is not a usable clean-install contract. No reviewed complete clean-install manifest was found. Earlier standalone replay's `storage.buckets` failure at 023 demonstrates the need for a real Supabase platform baseline, not a plain PostgreSQL image.

Git shows later edits to some other migration files (006, 094, 176, 178, 193, 241, 256). This proves repository edits after their initial commits, **not** edits after deployment: deployment timestamps/original applied bytes were not inspected. Current hosted ledger/file/schema consistency remains unverified. The prior printer schema-only baseline compared a limited printer contract and required settings/grant adjustments; it is not a certified complete fresh-install baseline.

Dependency chain:

```text
Supabase roles/Auth + 001 tenant/menu/order foundations
  -> 004/005 public ordering -> 006/007/009/010 staff/helpers
  -> 015 ACL hardening (blocked: missing rls_auto_enable)
  -> 016/017/018/020/021/022 staff/Auth/table-count foundations
  -> 023 Storage integration + 026 table trigger + 027 uploads
  -> 028 tables/settings/reporting/QR (blocked: description absent)
  -> 033/036/039 later table/settings replacements
  -> 055 menu description addition; 061/064 app_url settings
  -> later operational/security changes, including 260 table protections
  -> prerequisites through intended 275 baseline
  -> 276 private admin foundation -> 277 boundary hardening -> 278 replay repair
```

015 creates no schema object needed by 028; the two blockers are independent even though replay order masks the second. Later functions replace many 028 definitions; reconstructing a baseline from 028 alone would lose subsequent security and lifecycle changes.

SA2's actual harness `sa2-disposable-verify.cjs:146–180` creates real isolated Auth infrastructure, applies complete files 001/006/017/018/020/024, extracts **only the first restaurant ALTER** from 028, then applies 276/277 and later 278. This agrees with SA2 report section 9. 276 directly needs restaurants/staff identity columns plus Auth users/sessions/factors/helpers; it does not directly reference `menu_items.description` or require 015's orphan function. The 028 projection is part of that tested fixture, not proof that all of 028 is needed or works. 277 replaces signup/global-setting functions; the intended signup trigger must already be attached. 278 relies on 276's private tables and guards. These candidates can reasonably be tested once a valid target baseline exists, as the narrow prior run demonstrates; full workflow compatibility remains a separate gate.

Distinguish four claims: fresh replay executes every required migration on an empty platform; an upgrade executes only unapplied changes on an established schema; ledger comparison checks recorded versions but not effects; catalog/security verification checks actual definitions and behavior. None substitutes for the others.

## Remediation choices — proposals only

| Option | Files and approach | Existing installs / limits / recovery |
| --- | --- | --- |
| A: repair original chain | Would require reviewing 015 and 028 plus a fresh-install test harness/manifest. Candidate concepts: guard a revoke only if the function is genuinely optional, or establish its authentic definition; provide description before its first use. Neither choice is approved or yet semantically resolved. | Editing deployed historical bytes produces divergent histories; existing installations do not automatically rerun them. Do not invent a no-op security helper or remove intended revocation. Any actual installed-schema correction needs a separate forward migration. Verify clean replay and upgrade equivalence before adoption. Revert of a source edit does not undo already committed DDL/data changes. |
| B: forward-only correction | New numbered migration after current head plus tests, only if a live-schema defect needs correction. | Cannot repair a clean replay that stops before reaching it. Useful for upgrades, insufficient by itself here. Rollback depends on actual effects and must preserve tenant/history data. |
| C: explicit fresh-install baseline — recommended | Proposed new `supabase/baselines/<version>/` SQL/manifest and provenance, a dedicated bootstrap/verification harness, and installation/upgrade documentation. Keep historical migrations unchanged. Define full intended catalog and platform prerequisites, not an unreviewed dump or the SA2 subset. | Use only on a newly approved empty target. Record the baseline's actual execution distinctly; do not mark 001–275 executed when only a baseline ran. Specify how the runner applies subsequent migrations without false ledger entries. Existing projects keep their historical upgrade path and are untouched. Cleanup/recreation of the disposable target is the practical failed-bootstrap recovery; not a production rollback strategy. |

For C, first prepare a catalog manifest including tables/columns/types/defaults, constraints/indexes, roles/ownership, policies/RLS, explicit/default grants, definer search paths, functions/triggers/event triggers, Auth dependencies, Storage configuration and necessary nonsecret settings. Establish the unknown helper's purpose before deciding inclusion; restore no tenant rows, Auth users, tokens or printer credentials. The old schema-only archive may be evidence, but its scope and omissions prevent automatic approval. The baseline cutoff (preferably reviewed state before 276) and subsequent 276→277→278 application must be explicit. No new forward migration is inherently required merely to introduce a fresh-install baseline; any intentional change to existing intended schema requires a separately reviewed forward migration.

Compare actual catalogs and behavior between a baseline installation and a representative isolated upgrade installation, not only exit codes. If the requirement remains literal replay of all original files, C alone does not satisfy it: an approved A candidate also needs full chronological replay tests, and the untouched chain's failure must remain documented. This is a decision to make before implementation, not permission to skip the historical sequence.

## Future verification on an explicitly approved disposable target

Read-only preparation: approve target reference and expected URL/database identity; compare against the existing hosted denylist and persistent workspace identities; inspect a fresh platform's versions, empty application schema, Auth/Storage infrastructure, roles and ledger; pin source hashes and runner transaction behavior; review baseline/upgrade manifest and recovery scope. No test should infer safety from localhost, a friendly name or the current CLI link. Neither current `.env.local` nor current CLI linkage should supply test defaults.

Later approved writes:

1. Capture the untouched-chain first failure using exact source and full Supabase infrastructure, saving migration name/hash, SQLSTATE/message/statement, transaction outcome and database identity with secrets redacted. Do not continue by silent skips. For an approved repaired-chain candidate, replay all 001–278 from clean state and stop at every additional failure. For C, separately execute the baseline plus later migrations and label that evidence accurately.
2. Compare catalog manifest and function signatures/security attributes; verify Auth trigger attachment, required settings, constraints/indexes and both explicit/default privileges. Do not import production data or manufacture ledger success.
3. Test anon, tenant A/B owner/staff, inactive administrator and AAL1 denials through actual API paths. Validate private-schema nonexposure, direct-table denial, RLS tenant isolation, and 276/277/278 effective RPC behavior.
4. Create only approved synthetic Auth identities, enroll/verify synthetic TOTP through real Auth, validate AAL2 and freshness, absent/revoked session/factor, recovery gate and minimal Inspect permissions. No real founder account. Keep factor seeds/passwords out of logs.
5. Repeat meaningful SA2 audit rollback/replay/conflict cases, real separate-client concurrency with observed blocking, and payment audit integrity. Inject failures only inside disposable harnesses. Test valid and rejected operations, not just SQL compilation.
6. Test representative existing signup-denial/login/staff, Owner settings/tables/QR, Cashier/Waiter/Kitchen order lifecycle and menu/report reads against synthetic data; immutable financial/tenant boundaries must remain intact. No printer device, live Edge deployment or production interaction. Broader printer tests need separately approved scope.
7. Run browser email/password + TOTP against that exact isolated API, verify the returned Auth UUID and server context/access audit/read; builds/mocked browser responses are insufficient. Compare isolated upgrade-from-prior-schema results with fresh-baseline results, including retained synthetic history.
8. Save redacted command outputs, migration and baseline identities, catalog/behavior assertions and cleanup inventory. Restrict cleanup to the approved immutable disposable project/container IDs, recheck immediately before deletion, and obtain required deletion approval. Never reset the persistent workspace or existing hosted project.

## Decision and safety confirmation

Project creation should wait for review of this source-level remediation direction and the baseline-versus-literal-replay acceptance criterion. It cannot itself fix missing historical prerequisites. Next work should prepare a concrete baseline/runner design and provenance review under new approval, followed by a separately approved disposable verification run. No current full-schema readiness or hosted deployment claim is supported.

Only `docs/SUPER_ADMIN_SA3_3A_MIGRATION_INVESTIGATION.md` was created. No database was connected to, no SQL/migration was executed, no account/project was created, and no configuration, secrets, migration files, printer resources, website code, dependencies or Git history were changed. Source/log review and inventory checks are the evidence for this phase; no new runtime tests are claimed.

# ServeFlow Super Admin SA3.3C migration fix report

Date: 2026-10-17  
Status: **SOURCE FIXES COMPLETE; DATABASE VERIFICATION NOT EXECUTED**

## Scope and result

This phase made the two approved historical migration source corrections and added a guarded verification harness plus one source-contract test. It did not execute SQL, start or stop Supabase, create a database or project, access a hosted target, create an Auth identity, change configuration or secrets, deploy, commit, or push.

The changes repair the two known source-level replay blockers. They do not prove that migrations 001–278 now replay successfully. That claim remains blocked until the exact files run on an approved disposable full Supabase environment and the catalog and privilege assertions pass.

## Migration 015 correction

File: `supabase/migrations/015_phase4_function_execute_grant_hardening.sql`

The unconditional statement:

```sql
revoke all on function public.rls_auto_enable() from public;
```

was replaced with:

```sql
-- This helper is optional. Restrict its exact zero-argument signature when it
-- exists, while allowing fresh projects that never installed it to continue.
do $migration_015_optional_helper$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public;
  end if;
end;
$migration_015_optional_helper$;
```

`to_regprocedure('public.rls_auto_enable()')` names the schema and the zero-argument signature. A different schema, overload, or similarly named object cannot satisfy the check. When the exact function exists, the original PUBLIC privilege restriction still runs. The block has no exception handler, so ownership, permission, race, and unrelated migration failures continue to abort the migration.

Skipping the revoke when the function is absent is safe within this statement's purpose because no EXECUTE privilege exists on a nonexistent function. The guard does not create the helper, create an event trigger, enable RLS, or establish that every table has correct RLS. Final-head RLS and grant verification remains a separate database acceptance gate.

## Migration 028 correction

File: `supabase/migrations/028_owner_reports_settings_tables.sql`

The following prerequisite now appears near the beginning, before the first `menu_items.description` reference:

```sql
-- Public menu functions below read this column. Introduce the same nullable,
-- no-default contract that migrations 054 and 055 later reaffirm.
alter table public.menu_items
  add column if not exists description text;
```

Repository history supports `text`, nullable, with no default. Migration 054 first repeats `ADD COLUMN IF NOT EXISTS description text`; migration 055 repeats the same compatible operation. Neither later historical operation was changed or removed.

On a fresh installation, the column now exists before the SQL function in 028 is parsed. Existing rows receive `NULL`. On a database that already applied 028, editing the historical source does nothing by itself and the file must not be replayed. Such a database normally acquired this column from 054/055. If an existing database is missing it or has an incompatible definition, investigate and use a new reviewed forward migration; do not rerun 028.

## Hash and history record

SHA-256 values are over the exact file bytes in this checkout.

| Migration | Original SHA-256 | SA3.3C SHA-256 |
| --- | --- | --- |
| 015 | `D36C8FD0A8CB325D414A152365DA6C7ECED6DA3CA77402846023888B01928F24` | `EC6DBCAE2BDC6948DEE9E60D5599495AA0963E49E55DF1A15983B662970A4B7A` |
| 028 | `5A855869CD4CCCE2128FA3410F39D609625A927CC9480D17C68FB0317A280C73` | `DF7B9C731F631937EE6E08166827B97393D37E734A3E0019338F30AFC62848E1` |

Git history confirms both files were introduced in commit `35ff3a2df308087c066d54dde29e1bcd5894b6ab` on 2026-06-25. Their version numbers and filenames remain unchanged. Static inventory found exactly 278 uniquely ordered versions from 001 through 278 with no gap.

Migrations 276–278 were not edited. Their observed SHA-256 values after this work are:

- 276: `724715A4B66C9AF3363B34E7D3609B6E61BC81F232D1C1ECA2E1025B516C3432`
- 277: `1DC975EEC82ADC729F1E4F7FEC8E538CFB031368422060419A9C831724466B30`
- 278: `3DC450C56A845EF6287BD9D19BD776190828231D9D274734880153DD75F289D7`

## Prepared verification harness

Added `supabase/audits/sa33c-fresh-install-verify.cjs`.

Its read-only `--check-source` mode verifies the reviewed hashes, exact 015 guard, absence of exception suppression, 028 ordering and column semantics, compatible 054/055 operations, and the complete numbered migration inventory.

Its database mode is intentionally gated by both `--run-disposable` and `--confirm-disposable`. When separately approved, it is designed to:

1. Generate a unique project ID and temporary work directory without copying `.env.local` or linked-project metadata.
2. Allocate separate high ports and snapshot pre-existing running Docker container identities.
3. Start only a new local Supabase CLI project and reject an unexpected project identity, bind mount, database URL, or non-loopback published port.
4. Reset only that target through 014, then execute the actual 015 file in transactions with the helper absent, with the exact helper and event-trigger linkage present, and with an unrelated required function renamed.
5. Verify absence does not invent a helper, presence removes PUBLIC EXECUTE while preserving body, owner, OID, and event-trigger linkage, and the unrelated failure remains SQLSTATE 42883.
6. Reset the same disposable target through 278, then assert the real migration ledger, the `text`/nullable/no-default description catalog, and successful application of 054 and 055.
7. Stop only the exact generated project, remove its volumes with `--no-backup`, verify all pre-existing running container identities are unchanged, and reject any leftover container bearing the generated identity.

No database branch was run in this phase. The harness does not contain a hosted database URL, read `.env.local`, use the repository's CLI link, call `--linked`, or target the persistent `workspace` ports.

## Local disposable feasibility

Read-only tooling checks found Docker Desktop server 29.6.1 on the local `desktop-linux` context and Supabase CLI 2.107.0. The previously verified SA2 harness demonstrates that unique, internally networked, tmpfs-backed Docker resources can run without touching the persistent stack. The persistent `workspace` Supabase stack is currently running on ports 55321–55327 and was inspected only with `docker ps`.

A separate CLI project can be assigned a unique project identity and ports, but one safety issue remains unresolved before database execution: the current persistent CLI stack publishes several ports on `0.0.0.0` and `[::]`. The new harness rejects non-loopback publication. Supabase CLI 2.107.0 exposes no bind-address option in `supabase start --help`, and this phase did not start a second stack to test its effective bindings. Therefore a complete local full-stack disposable run is **feasible in structure but not yet verified safe on this host**. If the CLI publishes the new stack on all interfaces, the harness must stop and clean it rather than continue. A separate internal-network full Supabase strategy or another reviewed loopback-only mechanism would then be required.

The existing SA2 harness cannot simply be reused for full replay. It applies selected prerequisites and migrations 276–278, and its manual database does not establish the complete Auth, Storage, extension, and migration history required by 001–278. Its isolation and cleanup checks were reused as design requirements.

## Verification performed

All checks below were non destructive and made no database connection:

| Check | Result |
| --- | --- |
| `node --check supabase/audits/sa33c-fresh-install-verify.cjs` | PASS |
| `node supabase/audits/sa33c-fresh-install-verify.cjs --check-source` | PASS; 278 versions, range 001–278, reviewed hashes, `databaseExecuted: false` |
| `npx vitest run tests/unit/sa33c-migration-fix-source.test.ts tests/unit/platform-admin.test.ts --reporter=default` | PASS; 2 files, 19 tests |
| `npm run build` | PASS; `tsc -b` and Vite production build, 2,359 modules transformed |
| `git diff --check` | PASS |

The production build changed the tracked incremental compiler cache `tsconfig.tsbuildinfo`; it was restored to its pre-checkout content after verification and is not part of this phase.

## Files changed

- `supabase/migrations/015_phase4_function_execute_grant_hardening.sql`
- `supabase/migrations/028_owner_reports_settings_tables.sql`
- `supabase/audits/sa33c-fresh-install-verify.cjs`
- `tests/unit/sa33c-migration-fix-source.test.ts`
- `docs/SUPER_ADMIN_SA3_3C_MIGRATION_FIX_REPORT.md`

No other migration, application source, dependency, environment file, printer resource, or existing SA3 report was changed.

## Remaining blockers and next approval

- The revised SQL has not executed against PostgreSQL. The 015 procedural block's runtime behavior is therefore unverified.
- The corrected chronological chain 001–278 has not replayed. The next failure, if any, is unknown.
- Migration 028's function creation and 054/055 compatibility are source-verified only.
- The prepared CLI path's effective host bindings and Windows runtime behavior are unverified. Any all-interface publication is a stop condition.
- Final RLS, grants, Auth/TOTP, platform-admin authorization, full application behavior, and upgrade compatibility remain outside this phase's evidence.

The next approval should authorize **SA3.3D disposable local execution only**: permit Codex to run the prepared harness against newly generated disposable resources after a preflight review, capture the first exact failure and SQLSTATE, and clean up only the recorded generated project. The approval must continue to forbid the persistent `workspace` stack, hosted projects, real Auth users, founder provisioning, `.env.local`, linked targets, migration-history manipulation, deployments, commits, and pushes. If loopback-only isolation cannot be established, SA3.3D must stop after cleanup and return a smaller isolation remediation proposal.

No database, Auth service, hosted project, hosted configuration, or persistent local Supabase resource was modified during SA3.3C.

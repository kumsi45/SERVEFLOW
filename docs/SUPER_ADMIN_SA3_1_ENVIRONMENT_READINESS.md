# Super Admin SA3.1 — isolated environment readiness

Date: 2026-10-16. Scope: read-only investigation. This report does not authorize SA3.2 or any account, migration, environment, or hosted change.

## 1. Executive summary

**Current frontend target: hosted Supabase, not local. No verified isolated first-administrator target is available.** The local Vite server answered `/platform-admin/login` on port 5173, but its browser client uses `.env.local` values and that file specifies an HTTPS `*.supabase.co` URL. The CLI link reference matches the frontend URL's project reference. Matching references establish routing identity only; they do not establish ownership, safety, migration state, or disposability. Do not enter founder credentials or create an Auth user against the present target as an SA3 test.

The `workspace` local Supabase stack is running on the 55321–55327 port family and is a persistent printer/workspace resource, not an approved SA3 disposable environment. The focused SA2 disposable Auth/PostgreSQL/PostgREST run passed 106 checks and was removed. It used a selected prerequisite baseline, not a complete 001–275 migration replay or a standing login target. See `SUPER_ADMIN_SA2_REPORT.md`, section 9.

**Recommended option: B, a separately created disposable hosted development project**, subject to the founder's target-specific approval and a verified schema onboarding path. It provides an independent full Supabase platform without touching the persistent local stack. This is a recommendation to plan SA3.2, not permission to create a project. Option A remains a useful local fallback once the full migration baseline and CLI isolation issues are resolved.

## 2. Current target and safe identity evidence

| Evidence | Read-only observation | Limit |
| --- | --- | --- |
| `src/modules/super-admin/platformAdminClient.ts` | Uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; session is stored under a separate per-tab namespace. | Separate storage does not change the backend target. |
| `.env.local` | Both `VITE_` variables are present. URL is HTTPS with a `*.supabase.co` host, not loopback. | URL and key values were not printed or tested against the service. |
| `supabase/.temp/project-ref` | A CLI link reference is present and equals the project reference parsed from the frontend host. | No hosted API/database query or project ownership/isolation check was made. |
| Vite | A local Node listener on 5173 returned HTTP 200 for `/platform-admin/login`. | Frontend availability is not Auth or database readiness. |

The frontend and CLI currently appear to point to the same hosted project. They **can** diverge later: Vite reads `.env.local`, while Supabase CLI linkage comes from `supabase/.temp/project-ref`. Every later operation must compare both to the separately approved target before execution. A linked project reference is not evidence that it is disposable. The actual reference is intentionally omitted here.

## 3. CLI, Docker, and local services

- Supabase CLI 2.107.0 is installed on PATH. Docker Desktop's `desktop-linux` context responded; client and server were both 29.6.1. Docker reported Linux containers, 8 CPUs, and about 8.2 GB total memory. No CLI command that starts, stops, resets, or connects to a database was run.
- `docker ps` showed the existing `supabase_*_workspace` services (database, Auth, REST, Kong, Studio, Storage, Realtime and supporting services) plus `supabase_edge_runtime_p322`. The workspace API/database/Studio bindings use ports 55321/55322/55323. These resources are persistent and excluded from SA3 setup.
- Ports 54321–54330 were not listening during inspection, but an unused port does not prove an isolated stack exists or that another full stack can start safely. Existing workspace resource use and project/container identity must be checked again immediately before any later setup.
- Earlier `PRINTER_P3_2_SECURITY_REMEDIATION.md` records a Windows CLI `uv_spawn` failure for `supabase start`/`status`; a Linux-container CLI reached Docker. This is historical evidence, not a fresh retry. Earlier full-chain local replays stopped at migration 015 and, after isolated compatibility adjustment, at 028 (`PRINTER_P3_2_1_CERTIFICATION_REPORT.md`). Do not alter historical migrations or apply undocumented shims to make SA3 appear ready.
- The official [Supabase local-development guide](https://supabase.com/docs/guides/local-development) requires a container runtime and advises loopback-only exposure on untrusted networks. Its current guidance says default-port `supabase start` runs one project per machine. An isolated second project needs a separately reviewed CLI/worktree/port strategy; do not run `start`, `stop`, or `db reset` from this linked worktree.

## 4. Schema, migrations, and configuration inventory

The repository has 278 SQL migration files under `supabase/migrations` (plus one README), including candidate 276, 277 and 278. Their SHA-256 values in this checkout are:

| Migration | SHA-256 |
| --- | --- |
| 276 | `724715A4B66C9AF3363B34E7D3609B6E61BC81F232D1C1ECA2E1025B516C3432` |
| 277 | `1DC975EEC82ADC729F1E4F7FEC8E538CFB031368422060419A9C831724466B30` |
| 278 | `3DC450C56A845EF6287BD9D19BD776190828231D9D274734880153DD75F289D7` |

Files and hashes prove source identity, **not applied state**. No current hosted or persistent-local migration ledger, effective function definition, grant, policy, Auth setting, or schema was queried. Migration 276 creates `platform_private.administrators`, private RLS-protected tables, and `get_platform_admin_context` / guarded public RPCs. Its `require_admin` requires an active row, recovery attestation, AAL2, an existing Auth session, a verified TOTP factor, and a confirmed/unbanned Auth identity. Migration 277 closes the metadata-driven Owner signup and global-setting setter paths. Migration 278 is the forward-only conflict/replay repair and must follow 276 and 277. `SUPER_ADMIN_PROVISIONING_AND_RECOVERY.md` describes a trusted manual process, not an executable bootstrap tool.

The narrow SA2 disposable baseline applied real Auth migrations and selected repository prerequisites before 276–278. Full 001–275 compatibility and equivalence to any hosted schema are unverified. **Resolve the prerequisite baseline before SA3.3 attempts 276 → 277 → 278.**

Configuration inspection revealed these names without displaying values:

| File | Present names relevant to SA3 |
| --- | --- |
| `.env.local` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| `.env.example` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

`SUPABASE_SERVICE_ROLE_KEY` is server-only and must never be copied into a `VITE_` variable or browser code. `supabase/config.toml` exists but currently contains only two printer Edge Function JWT settings; it does not define an SA3 project ID, ports, or local Auth/MFA policy. `supabase/README.md` documents the two Vite variable names and a project base URL. `package.json` has Vite dev/build and test scripts but no SA3 environment/bootstrap script. To point the frontend at an approved target later, preserve the current `.env.local` securely outside the repository change, then change only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to that target's browser-safe values in an approved phase; restart Vite and verify the effective URL. Do not place service-role, database, or JWT secrets in frontend variables.

## 5. Isolation options

| Option | Fit and prerequisites | Current limitation |
| --- | --- | --- |
| **A. Separate local Supabase stack** | No hosted cost or live project mutation; Docker and CLI binaries are available. Requires a separately named worktree/project, verified independent containers/volumes, loopback bindings, distinct ports, Auth/API/DB availability, and a reviewed migration baseline. | Existing persistent `workspace` stack must be preserved. Historical Windows CLI failure and migration 015/028 replay failures remain; a second full stack's memory headroom is unverified. Not ready today. |
| **B. New disposable hosted development project — recommended** | Independent PostgreSQL, Auth, API, and platform services; clear project reference and separate credentials. Founder would create/name it manually after approval, verify organization/ownership and isolation, and provide only nonsecret target identity for review. | Project does not exist in verified evidence. Full schema onboarding, migration compatibility, Auth/MFA settings and costs/quotas must be checked before writes. No new project was created. See current [pricing](https://supabase.com/pricing) and [billing FAQ](https://supabase.com/docs/guides/platform/billing-faq) for plan/project limits and potential charges; no cost is assumed here. |
| **C. Existing environment** | Only suitable if independently documented as disposable, isolated, and authorized for SA3. | None was established. Current hosted link and local `workspace` stack must not be relabeled disposable. |

Option B avoids interfering with the known persistent local stack and provides the platform components needed for a real founder login. It still cannot skip full-schema reconciliation or target-bound authorization. If a fresh hosted project cannot support the historical migration chain as-is, stop and review a safe baseline plan rather than modifying 276–278 or assuming the disposable SA2 test covers it.

## 6. Verification gates for the approved target

**Read-only before any test write:**

1. Record the founder-approved target's organization, project reference, purpose, creation/expiry plan, and exact database/API identity outside secret-bearing logs. Independently compare the frontend URL's reference, CLI link, intended dashboard project and database connection target. Stop on any mismatch.
2. Confirm the target is isolated from production and `workspace` printer resources. Inventory its project/stack identity, network exposure, services, and backup/cleanup boundaries. Do not use the current `.env.local` as proof of approval.
3. Inspect migration history and effective prerequisites, including Auth catalogs, `restaurants`, `restaurant_staff`, owner-signup trigger, function signatures, and required schemas/extensions. Compare with repository migrations; document gaps before any application. Files alone do not prove application.
4. Inspect effective 276–278 ledger state, function definitions, grants, `platform_private` schema exposure/RLS, public RPC grants, and Auth/JWT issuer/session/TOTP settings. Compare hashes and effective definitions; no claim of hosted equivalence until checked.
5. Confirm a browser-safe anon/publishable credential belongs to that same target, without printing it. Confirm server-only credentials are absent from Vite variables. Confirm local Vite points to the approved isolated URL after a separately authorized config change.
6. Read-only authorization inventory may verify that no private administrator row has been provisioned and that no public signup/bootstrap endpoint is available. Without a provisioned identity, **successful authorized login cannot be demonstrated**; a negative unauthenticated RPC check alone is limited evidence.

**Requires separately approved writes on the verified disposable target:** complete/prerequisite schema setup; migration 276 → 277 → 278 application; creation or selection of an individually verified Auth identity; TOTP enrollment and verification; recovery review/drill and attestation; an initially inactive Inspect-only administrator row, activation after gates; AAL2 login; positive/negative direct RPC, audit and rollback tests. Never perform these on an unknown or persistent target. The dashboard supports email/password and an existing verified TOTP challenge, not factor enrollment or recovery.

## 7. Staged plan and approval gates

- **SA3.1 — now:** read-only inventory and this report. Stop here.
- **SA3.2 — approval required:** establish the separately approved isolated project. Capture target identity, isolation, ownership, spend/retention and cleanup plan. Keep current hosted and `workspace` targets untouched.
- **SA3.3 — approval required:** first verify full prerequisite schema and migration compatibility. Resolve the historical replay blocker through a separately reviewed baseline plan if needed. Only then apply 276 → 277 → 278 on the verified target, and inspect effective grants/RLS/RPCs.
- **SA3.4 — approval required:** prepare target-bound TOTP enrollment, out-of-band recovery verification and revocation/drill procedure. No public enrollment or recovery bypass.
- **SA3.5 — approval required:** use a verified named Auth identity, provision an inactive Inspect-only private row, attest recovery and activate only after evidence, then test AAL2 login, authorized reads, audit and denials. Do not grant Manage/Sensitive merely to make first login work.

The prerequisite schema review is a hard gate before SA3.3 migration writes. SA3.4's recovery procedure must be agreed before activating the first administrator; factor enrollment itself requires an Auth identity on the approved target. The stages may overlap in preparation, but no account creation or activation should outrun these gates.

## 8. Unresolved questions and no-change confirmation

The founder must choose and approve a specific isolated project for SA3.2. The current hosted project's purpose/production status, full migration ledger, effective schema, MFA settings and costs were not queried. The local CLI's historical `uv_spawn` issue was not retested, the second-stack resource budget is unmeasured, and no full 001–275 replay is certified. No current isolated environment, first Auth identity, TOTP factor, recovery drill, or administrator authorization has been verified.

This investigation created only this new report. It did not create/change accounts, factors, database rows, migrations, `.env` files, CLI links, Docker containers, secrets, hosted settings, printer resources, public website files, Git history, or deployments. The two pre-existing SA2 documentation edits in the worktree were left untouched.

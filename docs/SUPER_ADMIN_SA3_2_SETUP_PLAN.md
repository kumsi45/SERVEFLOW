# ServeFlow Super Admin — SA3.2 disposable-project setup plan

Date: 2026-10-16. **Planning only.** SA3.1 is recorded in `SUPER_ADMIN_SA3_1_ENVIRONMENT_READINESS.md`. This plan does not authorize creating a project, incurring charges, changing configuration, applying SQL, or provisioning an account.

## 1. Decision and stop boundary

Use a **new, explicitly named disposable Supabase development project** for the later first-administrator test, separate from the current hosted project and the persistent local `workspace` stack. The current `.env.local` frontend target and `supabase/.temp/project-ref` CLI link match the *existing* hosted project. Neither will be switched in SA3.2. No existing project is classified as disposable from its name or reference alone.

**Do not create the new project yet.** The founder's SA3.2 approval covers this plan only; project creation and any billing decision require separate explicit approval. Even after creation, database use is blocked until the historical migration baseline is resolved and a later SA3.3 scope is approved.

## 2. Founder's manual Dashboard steps — only after project-creation approval

1. Sign in to the official [Supabase Dashboard](https://supabase.com/dashboard) with your own Dashboard account. Confirm the intended organization and current subscription before selecting **New project**. A Dashboard account is distinct from a ServeFlow Auth user; creating a project does not provision the founder inside ServeFlow.
2. Choose an organization you control and can identify unambiguously. Prefer a dedicated development organization if its plan and project quota allow it; a separate organization does **not** automatically grant another free-project allowance. Record the organization name and project purpose in a private operator record. Do not use a production organization merely because it is selected by default.
3. Set a distinctive name such as `serveflow-sa3-disposable-YYYYMMDD`. Include “disposable” in the name and record the creation date, owner, intended lifetime, and eventual cleanup approval. The name is a warning label, not proof of isolation; the generated project reference is the actual technical identifier.
4. Select a region deliberately. Supabase stores the primary project data in its selected region. For synthetic-only testing, choose a location close to the founder/test clients or the same region as the intended production comparison if latency is relevant; document the choice. Do not infer the present hosted project's region. Changing region later requires a new project and migration, so review data-residency needs before creation. See [available regions](https://supabase.com/docs/guides/platform/regions) and [region-change guidance](https://supabase.com/docs/guides/troubleshooting/change-project-region-eWJo5Z).
5. Review the displayed plan, compute size, add-ons, project count, and any billing confirmation **before** clicking Create. Use only an eligible no-charge option unless you separately approve charges. Do not enable paid add-ons, upgrades, custom domains, PITR, paid MFA methods, or extra compute for this test. If the Dashboard requires payment or a paid plan, stop and ask for a separate decision.
6. If creation is separately approved, set a strong unique database password in your password manager. Do not paste it into chat, commit it, put it in Vite variables, or reuse an existing project password. Create the project through the Dashboard and wait for its healthy state. Do not import data, invite Auth users, or enable extra services during this setup step.
7. In the new project's Dashboard, record its organization, **project reference**, project name, selected region, and API base URL (`https://<new-ref>.supabase.co`). Compare the reference with the *existing* project's reference privately and confirm they differ. The Dashboard's **Connect** dialog / **Settings → API Keys** identifies the browser-safe publishable key (or legacy `anon` key). Store any copied values privately; do not send keys or connection strings to Codex. See [Supabase API key guidance](https://supabase.com/docs/guides/getting-started/api-keys).

The current [Supabase billing guide](https://supabase.com/docs/guides/platform/billing-on-supabase) describes two active Free projects across organizations where the user is Owner/Admin; paused projects do not count. The [pricing page](https://supabase.com/pricing) lists the current Free database/egress/MAU/storage limits and paid-plan/additional-project charges. Free projects can pause after low activity; verify [pause behavior](https://supabase.com/docs/guides/platform/free-project-pausing) before depending on the test environment. **Actual eligibility, organization billing, expected usage, and any charge remain unverified until the founder checks the Dashboard.** No plan or price is assumed for this account.

## 3. Identity and credential handling after creation

| Item | Use | Share with Codex? |
| --- | --- | --- |
| Organization and project **name**, project **reference**, selected region, and API URL | Nonsecret identity evidence for target matching. | Yes, only after creation; the reference is an identifier, not authorization. |
| Browser publishable key, or legacy `anon` key | A later dedicated Vite test configuration may use it with the new URL. RLS and server authorization still enforce access. | **No need to paste into chat**; enter locally in a separately approved step. |
| Database password, database URI, secret key, legacy `service_role` key, JWT signing material, personal passwords, TOTP seed/recovery material | Trusted server/operator tooling only, if later needed. Secret/`service_role` keys bypass RLS. | **Never paste into chat, frontend variables, source files, screenshots, or reports.** |

The code currently reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `src/modules/super-admin/platformAdminClient.ts`. The second variable's legacy name can hold the approved **browser-safe** publishable or `anon` key if compatibility is validated in the later phase; it must never hold a secret/service-role key. The existing `.env.local` also has a server-only `SUPABASE_SERVICE_ROLE_KEY` entry; its value was not read for this plan and must not be copied to a `VITE_` name. Supabase distinguishes [publishable and secret API keys](https://supabase.com/docs/guides/getting-started/api-keys); Auth user sessions are separate from those project keys.

## 4. Migration-readiness findings and blocker

Repository configuration: `supabase/config.toml` contains only two printer Edge Function JWT settings, not an SA3 project ID or complete local Auth policy. `supabase/README.md` documents the Vite URL/key names; `package.json` has no SA3 bootstrap script. The repository has migration files 001–278; their presence does **not** prove application on a target. The existing SA2 disposable harness applied real Auth migrations and selected repository prerequisites **001, 006, 017, 018, 020, 024, plus only the first `ALTER TABLE` from 028**, then 276 → 277 → 278. It passed focused behavior tests, but it was not a complete ServeFlow schema replay.

The direct SA2 prerequisites are real Supabase `auth.users`, `auth.sessions`, `auth.mfa_factors`, `auth.uid()` / `auth.jwt()`; the restaurants foundation (001); restaurant staff (006 and later staff/tenant foundations 017, 020, 024); the attached owner-signup trigger (018); and the restaurant columns projected from 028. Migration 276 references `public.restaurants` and `public.restaurant_staff`, creates private authorization tables/RPCs, and expects these Auth objects. Migration 277 replaces the existing signup trigger function and `set_app_url` (introduced by historical migrations 061/064); 278 replaces four 276 mutation functions. **For a complete ServeFlow development project, the whole effective prerequisite schema and migration history through 275 need reconciliation before 276 → 277 → 278.** The focused SA2 subset is not a supported fresh-project installation recipe.

Known fresh-chain failures from `PRINTER_P3_2_1_CERTIFICATION_REPORT.md` and the root-cause review in `PRINTER_P3_2_2_CERTIFICATION_REPORT.md`:

| Migration | Observed failure | Source-backed cause |
| --- | --- | --- |
| 015 | SQLSTATE `42883`, missing `public.rls_auto_enable()` | 015 revokes EXECUTE on that function, but no earlier checked-in migration creates it. It existed in the earlier hosted catalog; its original DDL/provenance is unknown. |
| 028 | SQLSTATE `42703`, missing `public.menu_items.description` | 028 reads the column; 001 creates `menu_items` without it, and 055 first adds it in the checked-in sequence. The replay reached 028 only after an isolated-only 015 omission. |
| Standalone PostgreSQL replay at 023 | SQLSTATE `42P01`, missing `storage.buckets` | That standalone image did not provide the full Supabase Storage schema. This does not by itself show a failure of a properly initialized full Supabase project. |

No checked-in fresh-project baseline or documented end-to-end setup path resolves 015 and 028. An earlier schema-only export from the existing hosted database was used for a **printer-focused** disposable audit; it was not a reviewed general SA3 baseline and cannot be silently imported into a new project. No historical migration may be edited, skipped, marked applied, or papered over with an undocumented shim. A hosted project's standard Auth/Storage services may resolve the standalone-023 limitation; they do not explain the source-order defects at 015/028.

**Smallest safe remediation plan, not implemented:** (1) determine the provenance and exact desired definition of `rls_auto_enable()` and the intended pre-028 `menu_items.description` schema from source and read-only catalog evidence; (2) design a versioned, reviewable fresh-install baseline/compatibility path without changing deployed historical migration bytes or claiming a migration ran when it did not; (3) test that path on an isolated empty full Supabase target with exact SQLSTATE/effective-schema evidence and a complete migration ledger; (4) compare the resulting relevant catalog, grants, policies, trigger/function definitions and Auth/API configuration to the intended ServeFlow contract. Stop at any additional chain failure and review it explicitly. This remediation needs its own approval before a new development project receives ServeFlow migrations.

## 5. Frontend isolation plan — no switch in SA3.2

- Preserve `.env.local` byte-for-byte as the normal application's current configuration. Do not put a new URL/key there in this phase.
- In a later approved phase, use a **dedicated, ignored, local-only test configuration or separate worktree** with a distinct launch script/process for SA3. The approved test process must read only the new project's `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; use a browser profile/tab dedicated to that target. Do not run the normal Vite process with overwritten shell-wide variables.
- Before opening the test login, compare the test URL's project reference, the selected Dashboard project, any CLI link, and the database migration target. Require a match to the approved new reference and a mismatch to the current hosted reference. Treat a missing or ambiguous reference as a stop condition.
- The present CLI link must remain unchanged. If CLI work is later approved, use a separately named worktree/configuration and an explicit target guard; do not run migration commands from this linked working tree or rely on the current link's default.
- Restart only the dedicated test Vite process after its config is set, and verify its effective target without printing keys. `localhost:5173` by itself is not evidence of local or disposable Supabase.

## 6. Evidence checklist and later approval boundary

**Read-only checks after a new project exists:**

1. Save nonsecret founder approval and project identity: organization, reference, region, project URL, intended lifetime, plan and usage expectations. Confirm reference differs from existing hosted and no `workspace` resource is targeted.
2. Compare Dashboard identity, frontend test URL, CLI link/worktree and any database connection target before each operation. Verify the current `.env.local` and current CLI link were preserved.
3. Inventory an empty target's Auth, PostgreSQL and API versions/settings; TOTP enrollment/challenge availability; email/password sign-in policy; public versus private exposed schemas; and required extensions. Supabase says [TOTP is available by default](https://supabase.com/docs/guides/auth/auth-mfa/totp), but its effective project settings and real AAL2 flow still require target-specific verification.
4. Read the target migration ledger and inspect prerequisite objects and effective function definitions, grants and RLS. Before application, 276–278 should be absent; after an approved SA3.3 application, their effects, order and hashes must be verified. A file, build, or mocked browser test is not deployment evidence.
5. Confirm a reviewed fresh baseline or stop on the 015/028 blockers. Do not turn a selective SA2 fixture into a full-schema claim.
6. Before any first-admin test, inspect that `platform_private` is excluded from API exposure and has appropriate table/schema grants and RLS; that public RPCs require authenticated actor checks; and that no public signup/admin-bootstrap path grants privilege.

**Later approved writes/active tests only on the verified disposable target:** creation/import of schema; migration execution; synthetic Auth users; TOTP enrollment/challenge; recovery attestation and private administrator row; positive/negative RPCs, concurrency and rollback cases; actual browser login. A read-only check can prove a missing authorization row or inspect policy code, but **cannot prove successful first-admin authorization without a provisioned test identity and active requests**. No such actions are approved in SA3.2.

**Cleanup guard:** record the new project's immutable reference and resource inventory before use; prepare a target-specific cleanup plan that compares this identity immediately before any future deletion. Never use broad `supabase stop`, `db reset`, project-delete, or resource-prune commands against the current linked worktree, existing hosted project, or persistent `workspace` stack. Cleanup/deletion requires separate explicit approval.

## 7. What the founder should provide after separately approved creation

Provide only **nonsecret** details: the new project's name, organization name, project reference or Dashboard project URL, selected region, plan type and whether the Dashboard warned of charges, plus confirmation that it is intended to be disposable and different from the existing hosted project. Do **not** send API keys, DB password/URI, Auth credentials, JWT tokens, TOTP QR/seed, or recovery material. Codex can then perform a target-identity and migration-readiness review before proposing any writes.

**Unresolved gates:** free-project eligibility and charges for the founder's account; actual target creation/identity; full historical migration replay and 015/028 remediation; effective Auth/MFA configuration; and the reviewed first-admin enrollment/recovery procedure. The exact next approval is **permission to create or select one specifically named disposable Supabase development project under stated plan/billing limits**. That approval would cover project establishment only. SA3.3 migration or account work requires another explicit approval after its target and baseline are reviewable.

This phase created only this plan. It did not create a project, charge an account, alter `.env.local` or CLI linkage, execute SQL, apply/repair migrations, create Auth users or administrators, change MFA/secrets/policies/settings, deploy code, or touch printer/public-site work. No package installation, commit, or push occurred.

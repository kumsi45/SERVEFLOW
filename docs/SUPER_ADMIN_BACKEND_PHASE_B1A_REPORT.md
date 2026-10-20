# ServeFlow Super Admin Phase B1A: isolated replay gate

**Final status: BLOCKED before resource creation and before any database write.** Run ID `2ab84513-9417-4108-8032-a3fd90df3f35` identifies this audit only. It created **no** disposable container, network, volume, database, account, or migration ledger. There are therefore no B1A Docker resource IDs or cleanup targets. The full 001–278 chain did not run; migration 278 was not applied in B1A. No database assertions or security SQL ran.

## 1. Initial state and scope

At the initial Git check, branch was `main`, HEAD was `b2970271ffd188f0e60c98ac9aa5bb324fd4c690`, and `git status --short` showed only `?? docs/SUPER_ADMIN_BACKEND_PHASE_B0_AUDIT.md`. That B0 report is pre-existing user work for this phase and was preserved. This report is the only B1A file addition. No application page, backend contract, dashboard, test, harness, migration, configuration, dependency or environment file was edited.

Read `docs/SUPER_ADMIN_BACKEND_PHASE_B0_AUDIT.md`; the SA3.3C, SA3.3D, SA3.3E, and SA3.3F reports; `supabase/audits/sa33c-fresh-install-verify.cjs`; `tests/unit/sa33e-harness-safety.test.ts`; `tests/unit/sa33c-migration-fix-source.test.ts`; `package.json`; `supabase/config.toml`; and focused migration source. The reports' actual filenames are `SUPER_ADMIN_SA3_3C_MIGRATION_FIX_REPORT.md`, `SUPER_ADMIN_SA3_3D_DISPOSABLE_EXECUTION_REPORT.md`, `SUPER_ADMIN_SA3_3E_HARNESS_SAFETY_REMEDIATION_REPORT.md`, and `SUPER_ADMIN_SA3_3F_INERT_START_STOP_REPORT.md`. The B0 report's abbreviated 3D/3E/3F filenames are descriptive references, not real file paths.

## 2. Environment strategy and stop decision

A genuinely isolated full replay would require a **new**, run-labeled target whose stopped container/image/network/storage/credential metadata are proven before any database-capable process starts, plus a reviewed bootstrap for all Supabase platform prerequisites. A plain PostgreSQL image alone is insufficient: migration 001 references `auth.users` and `auth.uid()` and installs `pgcrypto`; migration 023 writes `storage.buckets` and creates policies on `storage.objects` using `storage.foldername`; migration 149 invokes `realtime.broadcast_changes`; later migrations invoke `realtime.send`; migration 276 relies on `auth.sessions`, `auth.mfa_factors`, `auth.jwt()`, and Supabase roles. These are concrete platform objects, not optional application tables. `supabase/config.toml` does not supply a safe standalone full-schema initializer. The SA2 harness covers selected prerequisites and 276–278, not a replay of 001–278.

Local commands found `docker.exe`, the Supabase CLI shim, Node and local Vitest. `psql`, `pg_ctl`, and `initdb` were not found on PATH. The Docker client reported version 29.6.1, but `docker version --format '{{.Client.Version}}|{{.Server.Version}}'` exited **1** because `npipe:////./pipe/dockerDesktopLinuxEngine` did not exist. No daemon, image, stopped-container or network inspection was possible in this run. CLI presence is not evidence of usable services or a safe target; no package or image was installed or pulled.

**Gate 1 cannot pass.** The current harness can prepare a stopped, internal-network **inert** container and validate exact IDs/labels, no published ports, no binds or volumes, and expected tmpfs configuration. It has no `initdb`, PostgreSQL startup, platform bootstrap, SQL runner or migration replay path. Its real SA3.3F inert start was rejected when Docker inspect returned `Mounts=[]` despite configured `HostConfig.Tmpfs`; the exact container was stopped and retained in that earlier phase. That prior retained resource was not inspected or reused here. There is no verified runtime storage assertion for a new database-capable start and no proof of the selected image's current immutable identity with the daemon unavailable. The existing `supabase start` approach was rejected in SA3.3D because it starts database-capable services before identity/network inspection. It remains unsuitable for this gate.

| Mandatory pre-write fact | B1A evidence / result |
|---|---|
| New run ID | `2ab84513-9417-4108-8032-a3fd90df3f35`; generated locally for evidence only. |
| New stopped container and network did not pre-exist | No resource was created; unavailable to inspect with the daemon down. **Not proven for any target.** |
| Exact container/network IDs, matching run labels, immutable image digest | None assigned; Docker API unavailable. Earlier SA3 IDs are expressly excluded. **Not proven.** |
| Storage: no workspace/named volume/secret bind; ephemeral data | Source validator rejects these for its inert container. No actual B1A target or database data directory exists. **Not proven at runtime.** |
| Network: dedicated internal, no host ports, no other members, no external route | Source validator requires internal/nonattachable bridge and empty host ports. No actual B1A target exists and external isolation before first DB write cannot be observed. **Not proven at runtime.** |
| Credentials: no hosted URL, token, key, password injection | Harness source rejects known credential variables and hosted fallback. No B1A container exists. No secret or environment file was read. **Source-only.** |
| Harness ordering and cleanup | Inert harness validates stopped exact-ID resources before `docker start`; exact-ID cleanup applies only to its own stopped manifest resources. It contains no DB initialization/replay path. **Insufficient for B1A.** |

Because the gate fails, no alternative target was attempted. In particular, neither the persistent `workspace` stack nor the retained SA3.3F container/network was inspected, started, stopped or cleaned. No hosted project or printer resource was accessed.

## 3. Ordered migration source review

`node supabase/audits/sa33c-fresh-install-verify.cjs --check-source` passed: exactly **278** uniquely numbered `.sql` files, contiguous 001–278, with migration-set SHA-256 `2c42913b4332c6b530d5fcc6a2f349ad9580f2218ebc4723623bbee7c1fc7399`. This is a source fingerprint, not a database ledger. The complete per-file SHA-256 inventory is in the appendix.

The source-only checks verified the exact-signature optional `public.rls_auto_enable()` revoke guard in 015, and that 028 adds nullable `menu_items.description text` before its first reference. Migrations 054 and 055 repeat compatible `ADD COLUMN IF NOT EXISTS description text`. Candidate 276 defines private admin tables, revoked direct access, and Inspect/Manage/Sensitive checks; 277 blocks the historical owner-signup trigger path; 278 replaces four mutation functions with row-lock/conflict/replay behavior. No SQL compilation, full dependency resolution, policy execution, RLS catalog state, function security context or runtime behavior was established here. The SA2 selected-prerequisite 106/106 test result is historical, scoped evidence, not this run's full replay.

**Migration-by-migration result:** each file 001 through 278 in the appendix is `NOT RUN`; start/end SQL execution time, SQLSTATE and applied ledger row are **not applicable**. Last successfully applied migration in B1A: **none**. Final checked-in migration 278: **not applied in B1A**. No failing SQL migration is asserted; the blocker precedes SQL. No migration source correction was justified or made. The historical 015/028 fix hashes match the reviewed SA3.3C candidates; no old/new B1A source hashes exist because no source changed.

## 4. Database/security assertions and tests

No disposable database was initialized, so **none** of the requested schema, grant, anonymous denial, non-admin denial, Inspect/Manage/Sensitive separation, tenant isolation, classification, approval-before-access, audit rollback or concurrency assertions ran in B1A. No Auth/TOTP/MFA or platform-specific service was exercised. No synthetic fixture or real account was created. Source-level authorization design and prior SA2 evidence cannot be promoted to B1A runtime verification.

| Actual command | Result |
|---|---|
| `git branch --show-current; git rev-parse HEAD; git status --short` | Initial state above. |
| `node --check supabase/audits/sa33c-fresh-install-verify.cjs` | PASS, exit 0. |
| `node supabase/audits/sa33c-fresh-install-verify.cjs --check-source` | PASS, 278 contiguous versions; `databaseExecuted:false`; aggregate fingerprint above. |
| `Get-Command docker,psql,pg_ctl,initdb,supabase,node,npx -ErrorAction SilentlyContinue` | Docker, Supabase shim, Node, npx found; three PostgreSQL executables absent from PATH. |
| `docker version --format '{{.Client.Version}}|{{.Server.Version}}'` | FAIL, exit 1: Docker Desktop Linux-engine named pipe missing; client 29.6.1. Read-only tooling check, no resource inspection. |
| `Get-FileHash -Algorithm SHA256` on 015, 028, 054, 055, 276, 277, 278 | PASS; values in appendix. |
| `./node_modules/.bin/vitest.cmd run tests/unit/sa33e-harness-safety.test.ts tests/unit/sa33c-migration-fix-source.test.ts --reporter=default` | PASS, 2 files, 22 tests. These use mocked Docker inspections and source contracts only. |

The Vitest tests establish validator behavior against fixtures, not actual isolation on this host. No package install or network fetch was used. No test failure was hidden by attempting another database target.

## 5. Cleanup and persistent-resource safety

No B1A Docker resource, database, SQL artifact, or synthetic account was created, so there was **nothing to clean** and no B1A-specific volume or storage artifact to remove. Cleanup is verified only by this command history and the fact that the pre-write stop occurred before creation; Docker API absence prevents an independent post-run resource listing. The retained SA3.3F identities and persistent workspace were not queried or modified in this phase. Their live state cannot be certified unchanged by a current Docker snapshot. No destructive command or wildcard cleanup was run. No hosted or production operation occurred.

## 6. Prerequisites for B1B

B1B should **not** start from this report as if a full-schema baseline exists. First restore a reachable local Docker engine (or propose another target under the same safety gate) without reusing the workspace or SA3.3F resources. Resolve the SA3.3F tmpfs runtime-evidence failure without weakening the storage check. Build and test a complete, reviewed bootstrap for Auth, Storage, Realtime, extensions, roles and migration ledger in new stopped, run-labeled resources; prove internal network/no ports/no external route, exact image identity, no secret mounts/injection, and exact-ID cleanup **before** DB startup. Then run all 278 migrations from empty state, record each result, run final catalog/authorization/tenant assertions and clean only exact B1A-created IDs. Only a separate successful verification can authorize B1B's read contract implementation. Public intake, provisioning, contract/dashboard changes and hosted deployment remain separate decisions.

## Appendix: complete checked-in migration inventory

This is the ordered source inventory and each file's SHA-256, computed locally. All rows have replay status **NOT RUN** in B1A. No database application result is implied.

| Version | File | SHA-256 |
|---|---|---|
| 001 | `001_phase1_saas_backbone.sql` | `59958504c9ed3423023fa6211e2bd36e008dcde795daaa9fcd7e6073386f46e9` |
| 002 | `002_phase1_security_corrections.sql` | `43bb9e772e6d263db3aad773e6428622e5eed857d9cc9527de84d2bcd7d604d1` |
| 003 | `003_phase2_public_qr_menu_rpc.sql` | `896d387da6dbaadf302b13b3a7ea8631817ea6376ba54efecc120a324dd506ee` |
| 004 | `004_phase3_public_qr_ordering_rpc.sql` | `da5830b4bbc7f473565ab73051a957e7b2dced5b49335e59156f0d009d80e010` |
| 005 | `005_phase35_payment_method_support.sql` | `c143ce6fe507b7e0fe5bc6a52b9447e9657fc4a92b654ee747300ddc07a22545` |
| 006 | `006_phase4_step1_restaurant_staff_foundation.sql` | `323b5ca640b0aeda42ca4a057dd5fcf547ddf8be092badd79fdf7c1e094df5ac` |
| 007 | `007_phase4_step2_cashier_payment_approval.sql` | `260083649a8f61b06ff87b7cbbec12ee49e0457bd1941a52fa911f94bf47b97b` |
| 008 | `008_phase4_step3_deprecate_legacy_status_update.sql` | `68fd57e14e7bb13214dc6879d7b0ccbbbba52526040bca3c7281da2695142b80` |
| 009 | `009_phase4_step3_kitchen_dashboard.sql` | `c7101a4647a53db377ff54a73399d300d8e5badbde426aef21e437f296a17251` |
| 010 | `010_phase4_staff_url_authoritative_rls.sql` | `84f36ef5f8d8931a63424f22aedb6e9ddc8aab27f01294668f587bd364d3e796` |
| 011 | `011_phase4_staff_dashboard_related_select_rls.sql` | `3b7efea275e2d8122b91dbea4b9014a482b2663d14a973c38076ad0cffa8d6a6` |
| 012 | `012_fix_workflow_and_analytics.sql` | `b1a80465fa5aa5781902a6223777c251d1916d565fd518ee353f4b6c4c795c89` |
| 013 | `013_phase4_remove_legacy_staff_order_visibility.sql` | `1355bad81afec15f06c3fd51c9bdda017eea8c6bb0010fe9cd84c81303732828` |
| 014 | `014_phase4_cashier_order_visibility_matches_dashboard.sql` | `0e30725a7f6c168c8e634fc8b11ec5c6b08a16b8d055d7f15f1137c4045eef65` |
| 015 | `015_phase4_function_execute_grant_hardening.sql` | `ec6dbcae2bdc6948dee9e60d5599495aa0963e49e55df1a15983b662970a4b7a` |
| 016 | `016_phase4_completed_status_reporting_foundation.sql` | `f5783541751d76913a917775f5ca79540bae18c052989e58ed15e7ba6d94783c` |
| 017 | `017_phase5_staff_management_system.sql` | `77f97cc558bebcb83e1bff88999bee7c1b9c1b6971c808573b2764c2aa41a748` |
| 018 | `018_phase5_owner_signup_bootstrap.sql` | `f2b5a8071f3073966868a6c7af57a7400ffaf5b103be11cea2dbf25e70b2098e` |
| 019 | `019_phase5_owner_signup_bootstrap_hardening.sql` | `4a975874c65a78bb3ac48839e1bf951a2cbcb7083a81dfe895ac113a40554813` |
| 020 | `020_phase4_rls_multi_tenant_isolation_audit.sql` | `af4e7f3c2bc2c18b745700adaa391a9f177e4208d9dfa73d82a9b321c464d8d8` |
| 021 | `021_fix_approve_order_payment_staff_fk.sql` | `9f943df35118bbae46a438ab53aa1cfb8913c4e638a9bee87f8d3b77aa63aace` |
| 022 | `022_fix_kitchen_order_staff_audit_fks.sql` | `87cb1d87cf4eec184550dced403d3c887fdaa2b1f1d088ed0d3a28154f2c3745` |
| 023 | `023_phase5_owner_menu_management_and_storage.sql` | `28abaf26a7a1a4e97039b598038772f448544560fc04ecf3f169db9346d48b0e` |
| 024 | `024_owner_staff_creation_production_hardening.sql` | `f4e116aeb78474fa5a59dd0f81bcb508a761c9560bfdb8bc2a804035de87e0c8` |
| 025 | `025_restaurant_staff_anon_grant_hardening.sql` | `aec974fde6f65d1a1561488978bb8465b2bb4cab446e9329a30710a5964b1a93` |
| 026 | `026_public_order_table_number_validation.sql` | `4c3981c2ac0c5a40ddea286eab4f17c35c090e451c8cefe98634e04fca53e9f2` |
| 027 | `027_owner_menu_file_uploads.sql` | `91307cb9580eadb0e00aa3a8e26cc1a464e5e013869130bf32d7416d0f442ec7` |
| 028 | `028_owner_reports_settings_tables.sql` | `df7b9c731f631937ee6e08166827b97393d37e734a3e0019338f30afc62848e1` |
| 029 | `029_cashier_shift_management.sql` | `87cba9860639c9f814b1246694720ce25a36d1cbd255090f637165376ab37b76` |
| 030 | `030_database_reproducibility_schema_drift_repair.sql` | `6e528e6c01f2ff493b14e3aab744b82fea400909765e00e3dbc73ced914f664e` |
| 031 | `031_cashier_pos_order_entry.sql` | `0b9a27c07ca0de4e075173b2ae6456f915de89c5a52f491c86c569baea5a4038` |
| 032 | `032_owner_menu_delete_and_revenue_filters.sql` | `0bcb8e6c95dd7c08caaf9736f7158ff9353b675435561728b50ed4d3388091c1` |
| 033 | `033_auto_table_qr_generation.sql` | `b0f48508d23d01f684348a41acea0f2320bd7930534a0d2f5564ed4bb6c16e2f` |
| 034 | `034_owner_qr_management.sql` | `24527039d91d95e3b6422922230b0c20fc45ea5a366dd3e496ca255297fd944f` |
| 035 | `035_restaurant_setup_wizard.sql` | `b26342814bc10cec9b7787ce66ee501b30a88d24ec6880c91b7b9002a45465c7` |
| 036 | `036_owner_settings_setup_wizard_integration.sql` | `59bf876a57d9cfff0c4f728d49da7e847557fe019368251590004e8e16f20f58` |
| 037 | `037_public_menu_cover_branding.sql` | `6960ca752a067cc990911dede079cdd8452e9040e3b491b58eb8bcbc1305ee39` |
| 038 | `038_cashier_dashboard_shift_statistics_fix.sql` | `4d2196bf85b9dd97153d62663e206521768c8115eb08838f1ed8851af8cbdb67` |
| 039 | `039_single_source_restaurant_table_creation.sql` | `cc7fcc32b2592cc1c45d4671cef617239d9626a480eae7426f825973ac1254ed` |
| 040 | `040_owner_dashboard_operational_staff_reports.sql` | `7c211df0f5d781c6230068ed4421df9f7b21215499ea73a52a2ed556f2605af3` |
| 041 | `041_kitchen_station_foundation.sql` | `e889577a5abe793444f7b225679ce6f9e02a9df0b88bd54f20584cfad412c9c0` |
| 042 | `042_kitchen_station_menu_assignment.sql` | `515c3e59ac0fb5b0906c1273241f9fa4fccaa66dbca78d9be56ee6440f68875c` |
| 043 | `043_kitchen_routing_engine.sql` | `760153c4a48908733c40b6864b6f88aef4869fb3d5e43b5b649230626c174033` |
| 044 | `044_kitchen_dashboard_station_awareness.sql` | `62bfd0f58a477e6f3067d9334e0e4b63093dbd50c8149f0b46e5e05a5596ccb4` |
| 045 | `045_kitchen_staff_station_assignment_ui.sql` | `e003a20813350cae88021b8cfb193b3fb82ebad709c3d5cb1f45bad62c67210e` |
| 046 | `046_kitchen_routing_station_queue_totals_bugfix.sql` | `87cbb9ff9cf9476fd02e29106f86d08088ca3fc80e803ecbb16479be991d6010` |
| 047 | `047_kitchen_station_item_status_isolation.sql` | `43dc6985a82a8f9d35efb71712b63caba9224df33634100094fc90bf0a944adf` |
| 048 | `048_kitchen_station_collaboration_phase4b.sql` | `e259a2f1be132a7356cbaac1e4261f5f9634ab4d2122b63457365c5c52d8b63e` |
| 049 | `049_kitchen_station_audit_actor_compatibility.sql` | `64be1ebe9ae9025e39de5980d46fc9c4234381d6ce7fc0497f0eafeebbc2e121` |
| 050 | `050_qr_payment_kitchen_routing_fix.sql` | `66327dc03fc3e76379fed0fcdc2a66ae223647db8bfcc919c32dbe2d0c8b34c1` |
| 051 | `051_public_order_session_phase4c.sql` | `8eb8993f95223c17034f45b745afd8a872857bfb6a5ae6ff20c8e4d226c3ae0b` |
| 052 | `052_kitchen_incremental_ticket_batches_phase4c1.sql` | `008e72102c4da11c0b8b2146e6e76c7829fd745f8bb50dc084e60317de712baf` |
| 053 | `053_invoice_based_billing.sql` | `3af6317060ebff32b2353243a66338475781a2664be3f080c63b3fd0ad10868a` |
| 054 | `054_restaurant_starter_templates_phase4d.sql` | `80a11f5eb1b50fb74b9e698cdbb5a4b868e2c29b147c6a567470db6f70990841` |
| 055 | `055_menu_data_foundation_phase4d1.sql` | `8b0d26791a2ba3b67a9b88291e610bcb014fc2aa27bd52708813322cdba1bd24` |
| 056 | `056_starter_template_upgrade_phase4d2.sql` | `971afe80d0504462b7ef21e0165db0e7f5823ba0f8f1ee980e1ca6476a9ab0e0` |
| 057 | `057_category_hero_images_phase4d3.sql` | `bc73a4848af3724015086f8e2c58fd1de4b2bc0e45d0274e5a9d473e074ced6b` |
| 058 | `058_nutrition_support_phase4d4.sql` | `7b50af78260fb3a19640627794228931a5ce628d0d2a95d82c4c980fcdfb2570` |
| 059 | `059_ingredient_presentation_phase4d5.sql` | `c758d1c03b894ef486370d43a0adc0f72848d85bb99301f0f62a3a824a9c3874` |
| 060 | `060_menu_item_auto_station_assignment_phase4d7m.sql` | `4457866e56057815f83833d270ab8887b1a73edf6e57afab08eeaa67c0de5d59` |
| 061 | `061_app_url_configuration.sql` | `943361c4320d3eeceed4c8bda7ebd55a610adca3c2fe961b366e235c1f08750e` |
| 062 | `062_restaurant_table_client_grant_hardening_phase4e.sql` | `858763b99aa1232d1c7f0f6764119c670965a527a35e6c7aec67bb60d4e5ce8e` |
| 063 | `063_public_qr_dining_session_lifecycle_phase4e1.sql` | `94fe6cd8a9511537c2d9d9ef3135c11bce23496fe17243f377674ca5d604ecb1` |
| 064 | `064_public_qr_reliability_phase5.sql` | `f6d31c89c3fa908f63b185d349d7480e747f0e4a10ddba84170ea9472d170031` |
| 065 | `065_public_qr_menu_direct_phase5_fix.sql` | `b830976d250ee372bf8f3a881a5e61a7227d47b32bfd301ae166d04aba80d5dc` |
| 066 | `066_public_qr_customer_tracking_invoice_context.sql` | `6d4ab56e4641bf27e13959ae241b27f86295614e5d2a7542ee078afac2571c9a` |
| 067 | `067_public_order_feedback.sql` | `3e6dc7a51765be3da9e8efc6a39d8a046916ecf3793c2d74d0e154c1f6a84de7` |
| 068 | `068_public_menu_feedback_settings.sql` | `608419341482742c0d91651fbeee1132f19b5bc03b61af703fc7b6c02cad75d4` |
| 069 | `069_waiter_auth_phasew1.sql` | `e39a4ae7cd52c2f92681582833476922528dcc2f60aea4314bb6b9e33dff7ae8` |
| 070 | `070_owner_waiter_staff_management_phasew0.sql` | `780e54b230fe0b9fb913263f41f725b3fcc65a1af9426d47883401fe6e7f6d7d` |
| 071 | `071_waiter_dashboard_table_management_phasew2.sql` | `d1600ab3fa2ed606c4881d58a16c46c2fad71a0b8dc94c530fa43b6be6a2a2d1` |
| 072 | `072_waiter_terminal_identifier_normalization.sql` | `623d3358c59ce48c75e3a6bf2f2991be5015f365a3b6c95ab33f2f87f4410e3a` |
| 073 | `073_waiter_dashboard_identifier_normalization.sql` | `42f579096d4a6d28b233ccf02dc91f47af90e6baaca88d36106c74917446adb0` |
| 074 | `074_public_qr_order_invoice_repair.sql` | `6254a42ac6e3a195999f477a98771737107bbbdbc8891affa60dbd4b50cd49d7` |
| 075 | `075_strict_cashier_payment_gate.sql` | `3c56f6954e38e9726fce253a62a6d68d1450f291522eacb15a9795f6d0b161ec` |
| 076 | `076_waiter_order_creation_phasew3.sql` | `51c40b33b15f77131c5971436eb240b4ca4f5830458075b8fa5bc9daf985c606` |
| 077 | `077_phase_p6_payment_verification_architecture.sql` | `82bace3e668218df8a4ddf3e60c72091a5254a07b2ada2540e71762aed105d52` |
| 078 | `078_phase_p7_dining_session_finalization.sql` | `ecfdb2201cc709f1ec4f23bb5b0be1bafc05e85017d96f81850478780beed847` |
| 079 | `079_payment_queue_and_served_feedback_repair.sql` | `f8348b539e560ea13dc34aa8989d726fac5f7506401e6b26e36d9140a1b8181e` |
| 080 | `080_owner_manager_feedback_reporting.sql` | `f9281d7c37c656259bfbb31649bb1cd3cf63b90b1f31057580c4f192815db48a` |
| 081 | `081_final_dining_bill_phasep8.sql` | `dd51734374ca0b2cfe6a044710766fbdb52934fd6b63c000e2016e22e491c963` |
| 082 | `082_phase_p75_final_dining_session_lifecycle.sql` | `50413b8f84f994863688e0a30ddcd86c2f5fc599244d52a0fd02e678062d7413` |
| 083 | `083_phase_p76_business_numbering.sql` | `d4da4c3a112835a510088d7afe39de151138271eedec158d71acc6aed2613cee` |
| 084 | `084_phase_p77_invoice_lifecycle_ownership.sql` | `102d09ce7e6daa65adb49735a3f1068740ae70a8e415c88544ffad105fe2dff1` |
| 085 | `085_phase_p78_payment_to_kitchen_hardening.sql` | `14bea9420eeefcade97609e86af7bdc9c5148dfe8532bda3394f243df4ab7ddb` |
| 086 | `086_phase_p78_authoritative_invoice_creator.sql` | `c97ec0c42f89f1abbc2d35089e4e5c11fe3e03cb8a720cacee9ff1adbef91c8a` |
| 087 | `087_phase_w94_waiter_service_workflow.sql` | `29d692823d4ef3f586fb3898eb93d0d9be6dc915cb498808264305e4b3ad15b2` |
| 088 | `088_phase_w95_move_dining_session_table.sql` | `da893eb8d6ad3b95e5a4865ac3ac5c4b6713df09a99eb2c2a79d90569d37edd6` |
| 089 | `089_phase_w95_merge_dining_sessions.sql` | `2e0defaa2a99d3e6bf2101fc28e1f7965a333c9dc62666419040671301924e04` |
| 090 | `090_phase_w97_split_party.sql` | `3f8eaaf81723cdb1cd0cbd4c789ac0da25a94e1a71abcc23d2ef1f57f392a7da` |
| 091 | `091_phase_o93_independent_module_reporting.sql` | `22f20976f23ff92e4c5dd787220ac6feda9ec77629355c5239d3b5e3d8015ae9` |
| 092 | `092_phase_o94_reports_center_module_services.sql` | `eecf3a8de6ad174bb091be3a0abd2587bb1d8f873f27174305647e977e24efa7` |
| 093 | `093_phase_o101_staff_management_reporting.sql` | `b3c62a4b68bec72421953042cb82abf1cfdeeb225d1f8d422bcbb482d6c16bf1` |
| 094 | `094_phase_o102_ai_business_intelligence.sql` | `64e22ef1a34db5f439c455c3cf805765e9c1588d089141b1d5230fee84a1e47a` |
| 095 | `095_phase_w10_waiter_final_stabilization.sql` | `eb5b245098fc5039b58c0803f1ab82fa8cb6c107410091c056d5255f0570a4d1` |
| 096 | `096_phase_w10_single_open_table_session.sql` | `d5e0d2c41c68b963c9febb334111a3f945bec646f07b43a64f9576ed799e7481` |
| 097 | `097_phase_w10_waiter_rpc_coercion_fix.sql` | `774c25acaab59dcf31366390fb1865cc7ac14dbd99f0bcbeaec0b814832540fd` |
| 098 | `098_phase_w101_additional_order_reuse.sql` | `2e95d51bdc6ac47fa1cc021c6538e2a41eca1e33450d2c12f8b1355f9793d612` |
| 099 | `099_phase_w101_waiter_batch_detail.sql` | `9e540c87ac08d04acb044924fe8804f800345f2c31d3739bbe63d9dc2570f2f7` |
| 100 | `100_phase_w101_pending_item_edits.sql` | `9ee63c6c128d68ac3c331b9fe6bdecb11230afdc568555896077a0159804a6c0` |
| 101 | `101_phase_w101_pending_item_invoice_guard.sql` | `7f03674ab2ebdbf9d9d21845a31e44ba47cf68e679d2366993a712a58d534ec0` |
| 102 | `102_phase_w102_state_driven_waiter_pos.sql` | `48e52c6616b3dfaadcc732cc727e316252bc7b72215cd4fcebca0df1d737457c` |
| 103 | `103_phase_w102_open_session_table_occupancy.sql` | `61da4237336547918241f9af4b22bc3eeea72272a07f56740f1dd10eb183aef8` |
| 104 | `104_phase_w103_waiter_final_polish.sql` | `b256a21a7db35cab9e614ab867267286349a0829a988f837388bab924c93ec78` |
| 105 | `105_phase_w103_waiter_note_schema_fix.sql` | `a2b6fef250ac40b2836cad26f3b79f4381cb17b1f202fbfe78ed0a2b3b510783` |
| 106 | `106_phase_w104_enable_waiter_split_bill.sql` | `bf1301c073b2b61e489ac55e9db6d8ff9cf65d632cf65685df1bd4f805624d6d` |
| 107 | `107_phase_w104_quantity_split_and_paid_session_cleanup.sql` | `0e8b502434ac80ac810c3887956458c51cfcf1c7ec92f1bf079a9990051f44d7` |
| 108 | `108_phase_payment_gate_restore_and_enforce.sql` | `625693dfde26ab9616e9239e16b922c6224e0effc410c4aa9d397d633be662cd` |
| 109 | `109_phase_open_session_independent_payment_batches.sql` | `1571d4b9f5c2776dc5b81829a0e6189ae028ac9d036badaa5a60d4d7c596707a` |
| 110 | `110_phase_manager_staff_role_foundation.sql` | `0cbba52178635e8a6eb4d6b6e9315a9132b2eef0f82e56abd3166cb1176b571f` |
| 111 | `111_phase_manager_owner_boundary_hardening.sql` | `627dee7b0e622d3dd373f069cb6a350318bfeebef44ebca669f7a58d518781db` |
| 112 | `112_phase_manager_staff_operations_m3.sql` | `77350b1071b026d2b6d374523948a277702e1dc959106222f5c93bb5c290291c` |
| 113 | `113_phase_manager_kitchen_supervision.sql` | `98d5529a4e552c9818fd243b882b01419d9f47795aac788ecd0ea73665f374be` |
| 114 | `114_phase_manager_staff_final_security_hardening.sql` | `22c7718052e48a99566681950c10c84721a6611b41a9af8332a74a953aba2cde` |
| 115 | `115_phase_manager_kitchen_supervision_m4.sql` | `ef591ee6e9ec183a35a719c7eacc47ad00724bbf934558671447599b8908b683` |
| 116 | `116_phase_manager_customer_experience_m5.sql` | `e554d9f3cbfc3f5c0dc259fb2bf000d6f85b3a6859485a3c062597bdceb99105` |
| 117 | `117_phase_manager_operational_reporting_m6.sql` | `d31dd2139b257fe7e9c604712e44a2b8986bd59d325a8b092b65ecee3d5c35e0` |
| 118 | `118_phase_manager_ai_operations_assistant_m7.sql` | `3bba349b1bed8a6254cc4c12bac6f2f3412d9d725c111fbb6e50bc3ed707ba32` |
| 119 | `119_multi_tenant_currency_settings.sql` | `61ae590381633a365cb1c4a33306311882f45e75ec924b0185e0e7da9a0d0838` |
| 120 | `120_public_qr_menu_currency_settings.sql` | `27ca25bfa7d7ae30c436a76d47a1ada794fa53ffd64d5ca687d9eb71e06ba96b` |
| 121 | `121_waiter_terminal_currency_settings.sql` | `db800391f9b56b36612c567be79acb1d278711298206d6444c0391eec66889da` |
| 122 | `122_kitchen_inventory_request_workflow.sql` | `66d312a38f35ca0da446a9ae63238266a5a72d3d82a1ee3e76c7666d65df1f31` |
| 123 | `123_inventory_intelligence.sql` | `014b76f0cfcb918afdf2d3076ca83d0ac55908ad13437c21d5f13204be0ebe6d` |
| 124 | `124_kitchen_queue_invoice_batch_visibility.sql` | `e8d1b12e318b471bf1edf88696a7bae7a9d0a28c528f6b1d27e677dcd9b31b97` |
| 125 | `125_normalized_order_payment_lifecycle.sql` | `88b5c417a5ae50cd917eea019baf6de0dc6a1d6b1e2d0f7f1ad8ad800337a987` |
| 126 | `126_canonical_payment_queue.sql` | `b31a695a6ee223e56833df7ef5a86519b90e396a83d86cb4b3dd96719451c03a` |
| 127 | `127_hold_payment_kitchen_and_session_guards.sql` | `5c97ee6465ef89531b6e2523a7909b37bbe346546f6587934684245cd7cbb765` |
| 128 | `128_public_qr_canonical_lifecycle.sql` | `64a95628a49b00861a4edd1f0fe86f9a5f933e170a6fe928cc3abb93e7921653` |
| 129 | `129_fix_restaurant_payment_policy_update.sql` | `5c8d499c9a9d2d854216a890875fda274037e7affc57f099e544802b5d4b442f` |
| 130 | `130_canonical_kitchen_start_authorization.sql` | `5f5e1694941fa879ed5dedf2b0f8df468d480cb156faa58e9c8214930832f275` |
| 131 | `131_canonical_kitchen_ready_complete_guards.sql` | `b585cc92e86c174dbdc66a23261dd37920cdee672244dd691e4dc5ec3625553f` |
| 132 | `132_canonical_kitchen_queue_ui.sql` | `ca58a4d1c4d4ac20e1f3a3e4e93d7fbe016edfb358c746ad8c8dbe9265a21457` |
| 133 | `133_canonical_payment_methods.sql` | `1cc7a90ce926d5563d9ff32d40d542ca25e85c0c591f1f6f5dcf22e799d60cc8` |
| 134 | `134_payment_policy_source_enforcement.sql` | `2fe9931401728d26700017834f29b4233556f960850942449d7363b9dff3c315` |
| 135 | `135_release_table_completion_audit.sql` | `ac48561f91b4447181e76503a419ba79efa964af48bfc89cfb20d1cd060f746b` |
| 136 | `136_normalize_legacy_qr_payment_timing.sql` | `aa88b3c64be84d947884d21522f02541e7ac863be7d11f5b6428a9199ce0824b` |
| 137 | `137_independent_kitchen_station_queue_status.sql` | `6bd32d366f86713bc593f3c5aecd886aaf20ca2649600549573cd8cef11c84df` |
| 138 | `138_multi_tenant_integrity_hardening.sql` | `6bb5ac1be42bcf50e46abb8f037ca0da256aaf63bbd62d8bf879fa2d2fea2fda` |
| 139 | `139_canonical_historical_analytics.sql` | `90d7b7c6ec9a3301a9ed62d4404f3f2305226b42f651f76c82999e82319be8f9` |
| 140 | `140_phase5_database_function_stabilization.sql` | `be1d6f44b0192a0525bdd0db53f1e96484fa804757e39b9a5c2d01f75556123a` |
| 141 | `141_phase5_waiter_assignment_upsert_stabilization.sql` | `da764272e57394f81946c74ecb3c22ab55b966b47a0b0c14c6c028d5ed6777a4` |
| 142 | `142_phase5_feedback_storage_tenant_isolation.sql` | `440671204b566e65f75381d5b510aa9d54bca6faa25a14bf21d1387356b8f9f7` |
| 143 | `143_phase6_safe_ai_insight_formatting.sql` | `284649c7e46423167540ac7ab95b792f8adef4288412a66a52652e796bb5c2bf` |
| 144 | `144_phase7a1_runtime_session_stabilization.sql` | `736d68af8e8c0f2665205676d05639579216be66e4d16cb8e716885a89a95b9d` |
| 145 | `145_phase7a1_payment_independent_kitchen.sql` | `ef13d74d5451cc0673a477d0de99043acf8e80c13a65096a4d82331b8e95ee5e` |
| 146 | `146_phase7a1_kitchen_station_action_alignment.sql` | `e22515178192df07f69209fc94e6654218f7a18c1296ba4fcdaff0770e5f6b92` |
| 147 | `147_phase7a2_kitchen_waiter_rpc_stabilization.sql` | `a2e769574afd182ad5b20144990b23384c85d54a93c1173fa8f57cb20877d233` |
| 148 | `148_phase7a2_role_realtime_visibility.sql` | `4e450e929176863cf6c99e045ee90b82226211c8298c4cec5fe8c18b60563e6a` |
| 149 | `149_phase7a2_customer_tracking_broadcast.sql` | `4298ac0f79d39fad286e386cbb27463e244569a5090894418a7b6b77ed460814` |
| 150 | `150_phase7a3_canonical_lifecycle_finalization.sql` | `4a38e76d4c2da917ab0906dfbbcced2b4966cdd404229b126e9a892a153b7441` |
| 151 | `151_phase7a4_canonical_kitchen_ui_contract.sql` | `8b98bb4cdc6a0d70bdc829c62aa3f617d539bb6a0b83ac2f0e7e64d9dce4746e` |
| 152 | `152_phase7a4_kitchen_transition_audit_pairs.sql` | `757b2c8d5c0c27a8ca182194c83ee19c94ca9d1acd4dbbd6aabec4ee59896393` |
| 153 | `153_cashier_shift_and_financial_canonicalization.sql` | `94f302e158764a936e5761846c0642e786e8c3f6c2eaa62033898b32d852386c` |
| 154 | `154_cashier_order_payment_timing_fix.sql` | `f53110a86f803005868f21734bdfbf4ec25af8c156e791149d475baa809c0574` |
| 155 | `155_waiter_appended_batch_identity_and_policy.sql` | `e01cd1bb4cb0923622d7e6a06f60d9f493551db83036ee9a60feed7e673deb52` |
| 156 | `156_cashier_invoice_creator_identity.sql` | `a0523e6f53e95c99b3bd96dc6ddfa7441c16cbfd193526e7f8f8dcef8980fd09` |
| 157 | `157_phase_w27_restaurant_staff_identity.sql` | `c0b520ca5f9b99d7b801537acecb4b1ac37e2177fde2c1f6b773eb81c7e309ba` |
| 158 | `158_phase8_1_inventory_administration.sql` | `dafe6d6462192a4a82f44eac4844a4485b7e078f66787a408d3149141b8e8e73` |
| 159 | `159_phase8_2_stock_operations_engine.sql` | `c10f5347c2272e089eb33abac975eccefc63f4523d270bb8ecb0f59614b78362` |
| 160 | `160_inventory_officer_role.sql` | `ebae8adef14bad8445a8853b62275eaa95315c9e10f22efe3668c8197ab85fcb` |
| 161 | `161_waiter_order_lifecycle_engine.sql` | `810862e474724c6586525847c3161b13868ba994df756f296cd3898bc545a041` |
| 162 | `162_waiter_workflow_policy_setter_runtime_fix.sql` | `d1da2223ccdef8f2bd1a8550c1d007d0e0fb5bfe0068e2e7b870d69b291ace07` |
| 163 | `163_waiter_workflow_kitchen_gate_normalization.sql` | `94c09ebe0b4f673755d5c80738e6a4c32d1156e99d4e9efbe67e6849de253a4b` |
| 164 | `164_dining_session_payment_total_fix.sql` | `97f2c5a905f2874e081e1d7535678c1529cc8087773b8324f273104a9fec2f23` |
| 165 | `165_central_order_workflow_engine.sql` | `7c1f483a4c6b64708bbe3572b8c4c855adf3d73f6b7c174599812b80c2cf9b92` |
| 166 | `166_kitchen_station_routing_engine_fix.sql` | `1587c8cdf1acfe675b961fe8af8ace5bf3365a893d346af29eb46a0591e45ebc` |
| 167 | `167_workflow_policy_snapshot_freeze.sql` | `7d65cc320b8a2e1b92ed5c99672358b3e02cd5e39852e22a48552f06897375e2` |
| 168 | `168_phase8_3_1_recipe_management_foundation.sql` | `54390f1eb53d062c6d41eb910a843ebf6be6b1c4b0a311d35be4995287163135` |
| 169 | `169_recipe_management_rpc_tenant_resolution_fix.sql` | `717924a330d5ee8eaab1e1d0bf70428b1d8c11236a0cf7a542b972ddbce95e2b` |
| 170 | `170_inventory_initialization_flag.sql` | `1ae3c4699e0b41912c0a415214a71ec26765528e327133bd24db470994b66288` |
| 171 | `171_phase8_3_2_recipe_ingredients.sql` | `ccaa3e41b24aa0283914a8d27c9c8e2432bef4ea58744123245fe36945eb7d86` |
| 172 | `172_phase8_3_3_recipe_cost_engine.sql` | `ba6d5182e7c0165a0bafe941a9ba9c0c501cdd40798fdbf8ff642afd847bed6e` |
| 173 | `173_phase8_3_4_menu_recipe_linking.sql` | `0d93e6b5f902a4b656f07bc6e112c0339f8520708e3ca57658ac17f75ba836d3` |
| 174 | `174_ready_to_serve_menu_inventory_architecture.sql` | `47d00f5cb053b1b564d2f8f15c78ca70f14bf3b4e52f2f96ae63b3718f5757ee` |
| 175 | `175_inventory_default_master_data_seed.sql` | `9dda178ecbfb81138119836632d525d75a0fb15dae51a848116146027dde9cee` |
| 176 | `176_phase8_4_1_inventory_deduction_decision_engine.sql` | `736268c9a64544a3c5e67ddfae59e007cf62f6fa1b56a175d65c68a060876861` |
| 177 | `177_phase8_4_2_atomic_inventory_deduction_engine.sql` | `34ece7cb67a45b586df37c686159ff62f8794b3271a177a540c1251ec26a5d0b` |
| 178 | `178_phase8_4_3_inventory_movement_audit_engine.sql` | `483f7a7d73fcb8d77adf61ed9927305924a72edf86fcd7c4b3a4185f8d0af19a` |
| 179 | `179_phase8_4_4_inventory_realtime_engine.sql` | `796ebd987dc7904abd36839284e299e6fef628de6fdda87efb3919cd758aadb2` |
| 180 | `180_phase8_4_5_inventory_safety_consistency_recovery_engine.sql` | `e806bf0efd2e11c5ac288f96cfb262db817c389a417ab5140ac7016696292aa6` |
| 181 | `181_phase8_5_1_purchase_order_drafts.sql` | `d2ad705c238625b01970c9e1fc751eb7b7e3a27558f26a928da822549fb1f487` |
| 182 | `182_phase8_5_2_purchase_order_receiving.sql` | `617167269b73889d1854eaae7d001dcf1d951adf7ad8527d9fab937987e42294` |
| 183 | `183_phase8_5_3_inventory_adjustments.sql` | `622213be97a084c65a4417c448ccd2a8988be8605e5fdfeae513556c835011cf` |
| 184 | `184_phase8_5_4_purchase_history.sql` | `8660cbcd48d32b6f64bd3957ecdf9820586239c84ed6f8009e18c55ee652fcff` |
| 185 | `185_phase9_1_menu_theme_engine_foundation.sql` | `bfcd6bd397d6dc4bf14408c52619f1f42cd096c5856df5dad2b5174a20683f72` |
| 186 | `186_setup_wizard_nonblocking_kitchen_assignment.sql` | `bd29a9197e179229de7e82eccb9e725f5b82cb442145e56563f9a7a12319e89a` |
| 187 | `187_phase9_8_1_ai_menu_upload_foundation.sql` | `8c5b99689757e4a9c8d12765cb9f48f6f691500a79242b985422d033a30726db` |
| 188 | `188_phase9_8_2_ai_menu_structured_extraction.sql` | `b4d285a598a0e10deec0d7405495729469209d6a10a6ede4e0282056f980731f` |
| 189 | `189_phase9_8_3_ai_menu_review_studio.sql` | `b755e9299e730d294238fe689df510e044282dfa614fe4aa1da663f43bdc77d6` |
| 190 | `190_phase9_8_4_multilingual_menu_foundation.sql` | `432e79bef75a8bb77b9ab416cd24e2e57213857baf92c7269e95fc010300902c` |
| 191 | `191_phase9_8_5_ai_food_image_drafts.sql` | `4a502ba1d9a66110bad90f929784662c3af9ccf94ff3d93df80d13500ce41ad3` |
| 192 | `192_optional_purchase_order_supplier.sql` | `e9a3f903e64cbf1d605fbf5dde9c67e48e523a5c5ae87605a15a0cda765d3ae5` |
| 193 | `193_phase9_8_6_ai_menu_publish_engine.sql` | `36dd7153732b696824ab5a9d1d04421e7cf9e1ceafc4508afd92f0b70358aca1` |
| 194 | `194_phase9_8_6_publish_draft_restore.sql` | `011a32f715d82d7b5dcf9e99af5a6d726ae2660b46e355695c24f68f7dcdb08e` |
| 195 | `195_production_publish_variable_conflict_fix.sql` | `3e053a264fc891ee7d2c6df9c2b55ac33e9560ea73c17b430b2a7ec8d42dc5ee` |
| 196 | `196_phase9_11_ai_menu_import_sources.sql` | `e10da9809d20177ba62d6e20103b92107e6599c0bf7bf3f4fd3875fdee0bfe59` |
| 197 | `197_phase9_12_serveflow_smart_menu_library.sql` | `ed34a9db2258120b5308a95533a69f7e59bb36bbf69b865ff69a74e603885cb6` |
| 198 | `198_phase9_12_1_master_category_architecture.sql` | `495e47f1106f8c23afaa64c9249e1f7ce29c15322b9c4ce2a0e61b14febc48a1` |
| 199 | `199_phase9_12_2_master_menu_library.sql` | `16f5743cf397148cf2299a67a12f1f06cd7380d9f95b8700dd53f525caf18a3d` |
| 200 | `200_phase9_13_1_global_smart_image_library.sql` | `3b0a84d1924cee0a2ba271a074d92f381dab0a175d0cb6ccb38e3d294ac44b33` |
| 201 | `201_phase9_12_2_6_master_description_library.sql` | `f85bb8860508cff6acaddadbe512b33e01335c50b59a4f513c4212244b3e650a` |
| 202 | `202_cashier_receipt_frozen_financial_totals.sql` | `82e0e90d4c3c0998736c82ae17a35ab603fff530d01c906207e97668e9602fa0` |
| 203 | `203_optional_review_images_do_not_block_publish.sql` | `b46863203be0f87f4ff48c07caa0ee50c5f0873d85ee5370b4a47af226b34c56` |
| 204 | `204_phase9_15d_exact_published_menu_snapshot.sql` | `67f8aad4dc5e150cc957d3297f412922d95e08bd9129a2bdbff215dbf7864831` |
| 205 | `205_phase9_15d_reconcile_existing_published_snapshots.sql` | `13f6bd0d26ee2f1695b31e6d1e01315dc33a7563433d259aac5af78bab6771a8` |
| 206 | `206_phase9_15e_promote_selected_master_images.sql` | `f792204af086d1af9c6d91d6cc72702559a07173450952af0735a7d9b6f97414` |
| 207 | `207_phase11_1_printing_payment_foundation.sql` | `f05a9241463a056fd1b3df2c16e980e2e2a767d94e4f10d580429f04edbde835` |
| 208 | `208_phase11_1a_printing_payment_database_hardening.sql` | `aba997566b6a6d6e9dbbfa27169ceaba918e2032e3945ac34551f36b5a02c235` |
| 209 | `209_phase11_3_runtime_configuration.sql` | `5c7cd4c6d5e7e2d58a0d8e4cc3a36a64f5812b6ba2cb28d413c58efabd115498` |
| 210 | `210_phase11_3_staff_print_runtime_projection.sql` | `68ebb27182b29e09c22738825a422751b95c117e28e009bee48ef7dc257844b4` |
| 211 | `211_phase11_2_1_atomic_default_printer.sql` | `ea54c97fa3464f09d2eaa3fb72ce5f69e82ecf2ab8061a1fb7d357c17c2a5b30` |
| 212 | `212_phase11_3a_customer_payment_projection.sql` | `30c830ba3df984ebcf3f3a2a28f6aa6204d15ecac927abf9ee44b0f71509a0b0` |
| 213 | `213_phase11_3a_remove_public_internal_id.sql` | `b70d86a0d834f634074dca1a54b91861b80055acf6ea91fbf5b78fa496c5534d` |
| 214 | `214_phase11_3d_customer_realtime_broadcast_fix.sql` | `32f72dc68b9d180303a9453acf1cfae5e0cdbac52b4b1143d9e9cdb92a3c0918` |
| 215 | `215_phase11_3d_feedback_served_lifecycle_fix.sql` | `ac7413aae5721f801963d7ebb364df1a3ac591a3770588d8754720ad6b6e648a` |
| 216 | `216_phase12_1_smart_qr_waiter_portal.sql` | `6d52eb13cefb9b0fe8a014e421fff8837bc00bff60a04b6b0a5fa584a415d137` |
| 217 | `217_phase12_1_waiter_assistance_realtime.sql` | `d60701f89a51bce25754a149f276b70c85653b16a35d53a1059b03490af9a2a5` |
| 218 | `218_phase12_1_qr_decision_engine_hotfix.sql` | `87b7d3b5eba7ad80971615ec35da8546632c1c38976422d3b339a092f24a9a63` |
| 219 | `219_phase12_1_smart_qr_rpc_ambiguity_fix.sql` | `9a612b26a2dbd83659ae2ffc6dab9ccbc9fb9ed9505137c6a438f2cc8aea7e65` |
| 220 | `220_phase12_1_smart_qr_invalid_diagnostic_field_fix.sql` | `a6e85b8260531055954ea92496f903784c6ee11da1cf35b5ebe4d0f0df608513` |
| 221 | `221_phase12_2_cashier_workflow_foundation.sql` | `8fface250ef5de301a921d4987a97ad688425fdfc57895ff68135fbb4b55a245` |
| 222 | `222_phase12_2a_cashier_workflow_finalization.sql` | `cfbfc40ea5ebab5b2513d49bd64844b16d264f5776b7a224bb8d0181c792fbb6` |
| 223 | `223_phase13_4d_optional_receipt_settlement.sql` | `7d95e50cb57f9b1686ffac5478f1f6044f2d0f84560a4ec34ac3682185497228` |
| 224 | `224_cashier_payment_method_and_automatic_table_release.sql` | `9c67aa0b57194a994a8b6459a7ef7af3a25b876f68142309c35a007c1034c34a` |
| 225 | `225_nullable_order_payment_method.sql` | `349561ca5b2f9e854e790a5d14cb0dc556c0cb512acfeb5653d9d82a3ff056c4` |
| 226 | `226_settled_service_location_auto_release.sql` | `2ac4340c2b888cee048d4081426f1785578b0959415a38430e2d451ba3117ace` |
| 227 | `227_appended_item_invoice_integrity.sql` | `3b05ff4bf4f09146f7e273b78164fe8410e0d05cc4dbb00ef45b31e71dc1da80` |
| 228 | `228_phasea1_waiter_pin_authentication.sql` | `c92117fb04dd1534fc16da3ff8204c334fa30e74484d1ace492481db9bbbcfb1` |
| 229 | `229_phasea2_waiter_assigned_tables_only.sql` | `e1021cbacb6a5a28c34fc3dedbc584ad42a6c3dad21fc21a73d1452b4720e858` |
| 230 | `230_phase_cancellation_waiter_request.sql` | `0e5642f76ce054912aee7c29d60f61a8a1be8967a9a07637595f723335ea8483` |
| 231 | `231_phase_cancellation_cashier_review.sql` | `3e8cb84b58c472ae07cba2ec57a32afc484dc259cbea42b916f44dfe2b22e6de` |
| 232 | `232_phase_cancellation_cashier_invoice_loop_fix.sql` | `b8514f6f48a28447bfb24aa92f2904520b4ecb4dd7bfc9044bb1bc8e2e06a0fc` |
| 233 | `233_waiter_assistance_authoritative_resolution.sql` | `8b29390a276adf7446e061fae82d2a2e026445fa003a007f95fa3c5eeb24850d` |
| 234 | `234_mastered_service_location_auto_release.sql` | `37b3970275a48b57de54fc69416d86e74b67ff5f9a8293190c655ae717879f22` |
| 235 | `235_cashier_add_on_release_race.sql` | `878758732fcbb9a72c11cf36211a8f01e8598a62a871b8c3305b2ff4d035a910` |
| 236 | `236_manager_cashier_operations.sql` | `4631f16044c73df4a46ba5f193977bba336597ec6fab3a63253df9ba9988edc5` |
| 237 | `237_manager_reports_r2_financial_read_model.sql` | `446d52a8e3fc441eaa5b990d9c43d627c43f73c8a95340bd77d2222656045e28` |
| 238 | `238_manager_reports_r3_menu_cashier.sql` | `97614f9b503fe26a73c7c4f9e706ad4c6830a2aabe6b1667895becbc38103e97` |
| 239 | `239_manager_reports_r4_operational_reporting.sql` | `74ba21801bdad855ce6e9be33c74d50d99a8dbd324644ed1f6b04b726ff1c7c7` |
| 240 | `240_live_operations_kitchen_request_review.sql` | `7ff012eb76e16e6899a99da35031d497e3372dd295c2c0ba15ac4076c4299efa` |
| 241 | `241_manager_chef_creation_without_station.sql` | `d1e1b6b2a1f4f89bcda867d487cdcd7f35c89b38e2c62eeb6deed5e0b9bc9589` |
| 242 | `242_kitchen_request_inventory_handoff.sql` | `cce292e5a42e4b94be32289b7667e91154b470778aadefb4e8cae718404fd3f4` |
| 243 | `243_staff_credential_readiness.sql` | `a2ae7ab43e565ca84c64e7ac48597e537b66257c362053eb279de3ec67421b5b` |
| 244 | `244_isolate_legacy_privileged_terminal_login.sql` | `a33ff495491590ca4cfecfcdcd62cff7ee13de2b0d016be69d87612a16a517d1` |
| 245 | `245_waiter_table_assignment_backend.sql` | `85e3336e90db3601afd9e65d08db9ce53e3d85cce2ecdcc1c462ebfa9ee1774f` |
| 246 | `246_waiter_table_assignment_least_privilege.sql` | `a390b72e956ebcf267b314ad265f13d01b25de907a72a0ac2a2384a48d1eb5e6` |
| 247 | `247_kitchen_stock_receipt_confirmation.sql` | `db64f73b0e7d69a2720ce817ee6712e61d6f0c383e8285ff7f011b3b3835bd7b` |
| 248 | `248_kitchen_stock_receipt_history_quantity.sql` | `8eb7b315f98dae5138426c6e4a8d7619831853ba4cbb53ce6e51f1988a11e289` |
| 249 | `249_kitchen_material_request_expansion.sql` | `6eabee572452efdf1dfd349f029817cad0549b311e0bc05b617f765c9fa51cb1` |
| 250 | `250_inventory_kitchen_request_identity_context.sql` | `03bd3fb8f4fa649763be4d072a50520e95103fe44c7be676f28a321b0e192647` |
| 251 | `251_inventory_destructive_authority_hardening.sql` | `fee3926b607441b170c50cc6551c34367bdd5cb008099e1add7c8ac4029c0d65` |
| 252 | `252_inventory_storage_aware_adjustments.sql` | `b9573fd1f930011a0652a8b8ec0c1f2c18a10f3678eb467115674a68dde823d5` |
| 253 | `253_inventory_operation_concurrency_idempotency.sql` | `e0b5410273054ebf63b4da51b4ebc4a70e40208f2382776c96bacce3553d91d4` |
| 254 | `254_inventory_internal_seed_execution_hardening.sql` | `01541957722d781b09f3c72e883deaabfc8458eeac2129f8b9453381907ca353` |
| 255 | `255_waiter_pin_attempt_concurrency.sql` | `ce36abb5e86a79b20adfb109af1b71acf15b421fc8a21097214d2690ca3ea87b` |
| 256 | `256_waiter_terminal_table_status_context.sql` | `c93b51e22539c888b65aa50717d07a033273a2db55ab46402626903182c107f2` |
| 257 | `257_cashier_settlement_integrity.sql` | `5933495a9b99af92570d158ab9c5568efd4e9c5ef6e7bb8c925577ebed600488` |
| 258 | `258_cashier_persistent_obligation_visibility.sql` | `a1a84f43c6262c46ea2e4e46aa19369f078fddf8d6816106f9e1e34884bf53fe` |
| 259 | `259_retire_obsolete_generic_customer_order_rpc.sql` | `6e9fa7999c7737011d5a7709c74285abebfe30dd9e7c5348d26d92206eab9a7b` |
| 260 | `260_owner_tables_phase1_correctness_security.sql` | `ec49be04ef8bc6d81a490f60ae60121631dac5771c1affd4af87fab346c68ef2` |
| 261 | `261_public_qr_session_lookup_occupancy_side_effect_free.sql` | `eb0eb0b570734ea3c149d125040cce7a7fd9c81aaa032186bb96d6334dbcb549` |
| 262 | `262_owner_menu_files_private.sql` | `7e541d3509a845aaa405d91ed4ad44e1adb2483414f449c20668b060aec3e1b4` |
| 263 | `263_order_time_inventory_deduction_basis.sql` | `0d0a61bd257c2cb1665fa5dfcb15ce4641e1c4f71434f9b2191895f316f8ea27` |
| 264 | `264_kitchen_station_unresolved_routing_obligation_safety.sql` | `9e493b7dda216fe79749727f0be770375977ec96048a4f1e952852595d9f4c84` |
| 265 | `265_explicit_kitchen_station_disable_no_foundation_side_effect.sql` | `0c5c45505886667ee779b0444e6a06c84d60f9ea2c386166ddd522515c91e193` |
| 266 | `266_owner_finance_f2_authoritative_read_model.sql` | `7f94a9403a6b9e54e10ce217c304c22d4b8f1a128c7f8ce18bff758ac7649320` |
| 267 | `267_owner_reports_v1_authoritative_read_model.sql` | `974b6dedf3dbd3e05133d01563f4c29b920fe5484bbb5e12993e40c4c8076dbe` |
| 268 | `268_owner_menu_sales_report.sql` | `4f4a07a6472895efac237d351b4797939a86b0366ee558a6e3c40767d9e73d87` |
| 269 | `269_owner_reports_inventory_cashier_details.sql` | `6c73abab1890e2b7d62f4b6b8e880bb75c504701473cd547be4d2413b6e6c61b` |
| 270 | `270_owner_reports_performance.sql` | `964271ae8e7223d95cf9c454b3aa066e40bf3ba52dbbfe2988705a1af571deea` |
| 271 | `271_staff_kitchen_release_and_cashier_table_orders.sql` | `e0f4870a8eeebf4178b0b97a267e7dcd8b8c2473b92aeee997a5584abb3f304b` |
| 272 | `272_durable_print_job_queue.sql` | `8a032a7010bad8a720d4acfdacea6adbdb0914a834e98d72999597e11ed53a0c` |
| 273 | `273_print_bridge_lifecycle.sql` | `1ac98cd9c7974dd269f20955865129f6980aeb1b802aebebb06ebb64284b5cd5` |
| 274 | `274_print_bridge_durable_setup_claim.sql` | `a3674085db54a2c54c6a52565901ec5d6206c1e86b542894889c77eac6956c81` |
| 275 | `275_print_bridge_claim_bound_approval.sql` | `add0b094d0c1e3fb2dbb79808acff96130c295a1dfa7e4fa99ddba630887c0d8` |
| 276 | `276_platform_admin_foundation.sql` | `724715a4b66c9af3363b34e7d3609b6e61bc81f232d1c1eca2e1025b516c3432` |
| 277 | `277_platform_admin_boundary_hardening.sql` | `1dc975eec82adc729f1e4f7fec8e538cfb031368422060419a9c831724466b30` |
| 278 | `278_platform_admin_conflict_and_replay_integrity.sql` | `3dc450c56a845ef6287bd9d19bd776190828231d9d274734880153dd75f289d7` |

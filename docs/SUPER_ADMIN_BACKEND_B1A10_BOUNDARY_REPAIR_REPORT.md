# ServeFlow Super Admin Backend B1A.10 — Production Boundary and Pre-Creation Validation Repair

**Date:** 2026-10-21  
**Authority:** source-only harness and pure-test changes.  
**Decisions:** preparation source-level boundary **GO for independent source review**; real preparation **NO-GO**; startup **NO-GO**; writes **NO-GO**; B1B **NO-GO**.

## Evidence and original findings

Read the B1A.9, B1A.8, B1A.7, B1A.6, B1A.5, B1A.4, SA3.3E, and SA3.3F reports and inspected the current harness, focused tests, callers, exports, CLI dispatch, and `package.json`. All requested reports were present. The B1A.9 findings were:

1. `prepareStoppedResources(services)` was exported (`supabase/audits/sa33c-fresh-install-verify.cjs:621-629, :642-649, :764-768` in the B1A.9 snapshot). A caller could substitute image/context/inventory evidence while omitted creation adapters defaulted to real Docker.
2. The pre-creation binding omitted `image.Config.Env` (`:309-311`), and `authorizePreparation` did not validate it (`:337-349`). The first credential/hosted-endpoint check used the created container's environment after creation (`:109-117, :652-655`).

No other source path calls this harness's preparation function. The `package.json` scripts do not invoke it. Separate SA2 and printer audit scripts are distinct tools; this phase did not modify or run them.

## Production and test call graph

**Before:** CLI `--prepare-stopped` → exported `prepareStoppedResources(services = {})` → individually overridden evidence services or defaults → `runPreparationCreation` → overridden or default real Docker create adapters. A direct module caller could mix forged safety evidence with default real actions.

**After:** CLI `--prepare-stopped` (`harness:796-804`) → private, zero-argument `prepareStoppedResources()` (`:708-721`) → complete production adapter bundle built in that function → `orchestratePreparation` (`:646-706`) → production metadata acquisition → initial authorization → `runPreparationCreation` (`:425-453`) → exact network and container argument arrays → production synchronous Docker adapters (`:715-716`). `prepareStoppedResources` is not exported (`:810-814`) and accepts no caller services.

Pure tests call exported `orchestratePreparation` with a **complete explicit adapter bundle** (`:646-652`). It has no Docker fallback or partial adapter default. A missing, extra, or nonfunction adapter fails before metadata lookup or creation. The helper `runPreparationCreation` remains pure with supplied callbacks and retains its mandatory internal authorizer; neither exported helper exposes a production Docker adapter. The injected test seam can only perform effects that its caller explicitly supplies. The production CLI never takes the injected bundle as an argument. `--check-source` is source-only; `--start-verified`, `--stop-verified`, and `--cleanup-prepared` use their existing separate paths and cannot create a container. No new startup or write grant was added.

## Pre-creation image metadata and binding

The future production source is the existing local Docker **image inspect** result selected by `databaseImageTag` (`harness:708-712`). The CLI does not use container inspection to discover inherited environment before creation. It takes the inspected full `image.Id`, matching `RepoDigests`, `Config.Volumes`, and now `Config.Env`. The source-level design assumes Docker image inspection supplies a complete `Config.Env`; this phase did not call Docker to verify that assumption. Missing or malformed data therefore fails closed.

`validateEnvironment` (`:104-119`) requires an array of `KEY=value` strings with valid, unique names. It rejects forbidden credential names and hosted `supabase.co` references without including values in errors. `validatePrestartImageIdentity` invokes it (`:253-260`), and `authorizePreparation` invokes that stage before evidence-directory, network, or container creation (`:352-364, :655-676`). Missing image metadata, missing `Config.Env`, malformed entries, duplicates, forbidden credentials, invalid image ID, and mismatched digest reject before the first create adapter. Metadata acquisition that throws or returns a rejected promise is rejected before any creation; promise rejections are consumed to avoid unhandled rejection (`:455-462, :655-660`).

The preparation SHA-256 binding now includes the exact inspected `Config.Env` along with image ID, repository digests, declared volumes, plan, persistent inventory, and both exact creation argument arrays (`:323-327`). `runPreparationCreation` recomputes that binding immediately before network creation and again before container creation (`:425-453`); mutation of nested environment values or image identity invalidates the next action. The container create command adds no `--env`, so its intended final environment is the image environment. After creation, `validateStoppedTarget` validates both environment arrays and requires their hashes to match (`:150-171`); it keeps the existing hosted-fallback check. The mismatch error does not print environment values. This is a source-level equality check, not runtime proof of Docker's behavior.

The pre-creation command builder still fixes the internal bridge, no published ports/binds/volumes/socket mounts, read-only root, dropped capabilities, inert command, and configured tmpfs (`:329-338`). The full image ID is used for container creation; a syntactically matching repository digest remains metadata association rather than a reviewed provenance policy.

## Tests and verification

`tests/unit/sa33e-harness-safety.test.ts` now supplies `Config.Env` in its image fixture and exercises the **actual** `orchestratePreparation` route with synthetic source/context/inventory/image/inspection/evidence/write/create adapters (`:547-623`). It proves one valid synthetic route reaches exactly one mock network and one mock container create, then a manifest write. On missing image metadata, absent/nonarray/malformed environment, duplicate names, forbidden credential or hosted endpoint, a thrown metadata adapter, a rejected-promise metadata adapter, and an incomplete adapter bundle, both create action counters remain zero. Dispatcher tests mutate image identity and nested `Config.Env` during the mock network call and prove the mock container create stays at zero (`:494-506`). Existing tests cover rejected, thrown, missing, malformed, unknown, and rejected-promise extra gates, exact creation arguments, unsafe stopped-target configurations, absent startup proof, and write denial. A source/export assertion checks that the production preparation function is private and zero-argument (`:536-545`).

These are pure injected tests. They do not invoke the production CLI or Docker, verify registry provenance, prove runtime tmpfs behavior, or establish atomicity against external Docker changes. The tests demonstrate the supported module surface and control flow; they cannot prevent arbitrary unrelated Node code from importing its own Docker client.

| Permitted check | Exact result |
| --- | --- |
| `node --check supabase/audits/sa33c-fresh-install-verify.cjs` | **PASS**, exit 0. |
| `./node_modules/.bin/vitest.cmd run tests/unit/sa33e-harness-safety.test.ts tests/unit/sa33c-migration-fix-source.test.ts --reporter=default` | **PASS: 2 files, 70 tests** (69 harness, 1 migration-source). An initial run found that a raw array assertion exposed environment values in its error; it was changed to validate both arrays and compare hashes, then the complete rerun passed. |
| `git diff --check` | **PASS**, no whitespace errors in tracked changes. Untracked reports are outside this check. |

## Remaining limits and next step

- **Source-level preparation: GO for independent review only.** The two B1A.9 gaps are addressed in source and synthetic tests. Real Docker image metadata shape and effect are unverified.
- **Real preparation: NO-GO.** There is still no reviewed immutable image digest/provenance allowlist. External Docker state can change after inspection. A failed create with an invalid/missing returned ID remains an indeterminate cleanup case; an empty evidence directory may remain after later rejection. No real preparation was run.
- **Startup: NO-GO.** The CLI supplies no authentic runtime proof; SA3.3F's configured tmpfs versus running `Mounts=[]` discrepancy remains unresolved. Static tmpfs configuration is not runtime isolation evidence.
- **Writes: NO-GO.** Write authorization remains unimplemented and no database adapter was added.
- **B1B: NO-GO.** There is no isolated complete Supabase Auth/Storage/Realtime/roles/extensions bootstrap, ordered 001–278 replay, post-replay grant/RLS and tenant-isolation evidence, or independently proven cleanup/rollback procedure. The protected `serveflow-sa33e-*` and persistent `supabase_*_workspace` resources remain excluded.

The next step is an **independent source review** of this B1A.10 repair. Any real preparation, runtime investigation, startup, or migration replay needs separate authorization after its prerequisites are established. This phase grants none.

## Changed files and non-actions

- `supabase/audits/sa33c-fresh-install-verify.cjs`: private production wiring, complete pure adapter seam, pre-creation image environment validation and binding, safe post-creation comparison.
- `tests/unit/sa33e-harness-safety.test.ts`: synthetic production-boundary and environment-failure coverage.
- `docs/SUPER_ADMIN_BACKEND_B1A10_BOUNDARY_REPAIR_REPORT.md`: this report.

The pre-existing untracked B1A.9 report and unrelated work were preserved. No Docker command/API call, live image or resource inspection, container/network creation/start/stop/removal, database or Supabase connection, SQL, migration, hosted or protected-resource access, dependency installation, system configuration change, deployment, commit, or push occurred.

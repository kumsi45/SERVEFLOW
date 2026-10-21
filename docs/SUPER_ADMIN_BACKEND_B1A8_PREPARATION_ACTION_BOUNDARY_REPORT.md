# ServeFlow Super Admin Backend B1A.8 — Preparation Action-Boundary Repair

**Date:** 2026-10-21  
**Authority:** source-only harness repair, synthetic tests, and this report.  
**Decision:** preparation source-level creation boundary **GO for independent source review**; real preparation/runtime execution **NO-GO**; startup **NO-GO**; writes **NO-GO**; B1B **NO-GO**.

## Evidence and original finding

Read `docs/SUPER_ADMIN_BACKEND_B1A7_INDEPENDENT_REVIEW_REPORT.md`, B1A.6, B1A.5, B1A.4, B1A.3B, and the SA3.3E/SA3.3F reports, plus the current harness, tests, direct-call search, and package scripts. All named reports were present. The B1A.7 finding was that `--prepare-stopped` called a no-op guarded callback, then issued `docker network create` and `docker create` directly. It also made an evidence directory before authorization. The old preparation path was at `supabase/audits/sa33c-fresh-install-verify.cjs:560-617` in the B1A.7 snapshot; current line numbers follow below.

## Call graph and entry points

**Before:** CLI `--prepare-stopped` → confirmation/source/context/inventory/image → evidence directory → intent gate with no-op action → direct network creation → direct container creation → inspect → stopped-target gate with no-op action → manifest write. Failure recovery directly removed exact stopped resources when their IDs and labels matched.

**After:** CLI dispatch (`supabase/audits/sa33c-fresh-install-verify.cjs:750-758`) → `prepareStoppedResources` (`:621-676`) → confirmation, source/context/inventory/image, and initial `authorizePreparation` before evidence-directory creation (`:621-645`) → `runPreparationCreation` (`:646-649`) → mandatory internal authorization and exact command binding (`:410-436`) → injected network creation → binding recheck → injected container creation → exact-ID stopped inspection and B1A.4 lifecycle gate (`:650-656`) → manifest write. The exact Docker adapters are supplied by the CLI at `:647-648`. There is no separate direct `docker(['create', ...])` or `docker(['network', 'create', ...])` call.

The only container-creation entry point found is that CLI preparation path. The exported `prepareStoppedResources` uses the same dispatcher, including when pure test adapters are injected. The exported `runPreparationCreation` requires its own production authorizer even when an optional test gate is supplied; it has no built-in Docker adapter. `--check-source` is source-only. `--start-verified` has a separate guarded start callback (`:685-701`) and still supplies no runtime proof. `--stop-verified` and `--cleanup-prepared` are exact-ID legacy paths, without container creation. The retired `--run-disposable` has no dispatch branch. `package.json` has no harness lifecycle script. No fallback, retry, or other direct creation caller was found in repository source. Recovery cleanup (`:662-673`) removes only a recorded ID after matching its current ID, run label, and stopped state; it cannot create a container.

## Authorization contract and binding

`preparationCommands` constructs the **only** network and container argument arrays (`:314-323`): internal bridge, disposable run label, no published ports or binds, read-only root, dropped capabilities, `no-new-privileges`, disabled healthcheck, user `postgres`, only `/sa33e` and `/tmp` configured as `nosuid,nodev,noexec` tmpfs, local image ID, and inert `/bin/sh -c sleep infinity`. The tests assert the complete arrays. No caller-supplied port, network-driver, mount, socket, command, or privileged option is interpolated. Plan names, run ID, and image ID are the only target-specific arguments.

`authorizePreparation` checks the plan, persistent inventory, protected/workspace names, full image ID, absence of declared image volumes, and an immutable `public.ecr.aws/supabase/postgres@sha256:<64 hex>` reference present in the inspected image's `RepoDigests` (`:325-351`). The CLI still looks up a cached image by its existing tag, but then records the matching repository digest and creates the stopped container by full local image ID (`:625-636`). This establishes a content-addressed reference in the supplied image inspection; it does **not** independently certify the publisher, signature, or a reviewed allowlisted digest.

`preparationBinding` hashes the plan, inspected image ID/digests/declared volumes, persistent inventory, and exact network/container command arrays (`:309-323`). `runPreparationCreation` validates an internal authorization before either create adapter, rejects malformed/unknown/incomplete optional results and promises, freezes exact command arrays, and rechecks the binding immediately before network creation and again before container creation (`:410-439`). A plan/image/configuration change after the first call blocks the second. A caller-supplied `authorized: true` is insufficient. Preparation authorization requires the exact schema, `ok: true`, operation `prepare`, matching binding, `preparationAuthorized: true`, and explicit `startupAuthorized: false` / `writeAuthorized: false`, with no extra or missing fields (`:389-396`). No runtime proof is claimed for a stopped target; startup still needs separate proof.

The new injected CLI test also exposed an existing post-creation mismatch: `authorizeLifecycle` bound the complete inspected target while `executeLifecycleAction` compared a preparation-intent binding for every `prepare` operation. That made the post-creation gate reject even a valid synthetic target. `executeLifecycleAction` now selects the full target binding when a container snapshot is present (`:398-407`). This does not expand startup or write authorization.

## Tests and exact verification

`tests/unit/sa33e-harness-safety.test.ts:424-579` adds pure tests for the actual `runPreparationCreation` dispatcher and an injected `prepareStoppedResources` CLI orchestration. They assert exact network/container arguments, successful mock-only dispatch, zero creation calls for rejected, thrown, missing, malformed, unknown, and rejected-promise optional gates, zero calls for missing/wrong repository digest or invalid image ID/name, invalidation on pre-dispatch mutation, and zero container calls after a network adapter mutates the plan. They verify the newly created network ID is recorded before a container adapter failure. The injected CLI test exercises the same route with synthetic source/context/image/inspection/file adapters and proves a rejected image reaches neither creation adapter. Earlier pure tests continue to cover unsafe network, ports, binds/socket mounts, tmpfs configuration, absent startup proof, and write denial on inspected stopped targets. Exact command-array equality proves these unsafe creation options cannot be supplied through the preparation dispatcher as written.

These mocks prove source control flow and arguments, not Docker behavior or an adversarial adapter's honesty. The real CLI branch was not executed. No runtime tmpfs observation, full provenance policy, external-state atomicity, or actual cleanup was verified.

| Check | Result |
| --- | --- |
| `node --check supabase/audits/sa33c-fresh-install-verify.cjs` | **PASS**; exit 0. |
| `./node_modules/.bin/vitest.cmd run tests/unit/sa33e-harness-safety.test.ts tests/unit/sa33c-migration-fix-source.test.ts --reporter=default` | **PASS:** 2 files, 68 tests (67 harness, 1 migration-source). An intermediate run failed on the existing post-creation binding mismatch; after correcting it, the complete focused rerun passed. |
| `git diff --check` | **PASS**; no whitespace errors in tracked changes. The new report and pre-existing untracked B1A.7 report are outside this check. |

## Remaining limits and decisions

- **Preparation source-level boundary: GO for independent review.** Every creation call in this harness now uses the internal fail-closed dispatcher and bound exact argument arrays. This is a source/mock conclusion only.
- **Real preparation: NO-GO.** A matching repository digest in a supplied inspection is not a reviewed trust/provenance policy; external Docker state can change between inspection and action. The evidence directory is created after initial authorization but before the creation dispatcher, and a later rejection can leave an empty evidence directory. If Docker creates a resource but fails to return a valid ID, automatic exact-ID cleanup cannot identify it; that failure must be investigated without wildcard cleanup.
- **Startup: NO-GO.** `--start-verified` still supplies no runtime-proof object. SA3.3F's configured tmpfs with `Mounts=[]` remains unresolved. A configured tmpfs is not evidence that the running mount is tmpfs. No startup gate was relaxed or enabled.
- **Writes: NO-GO.** Write authorization has no implemented branch and no database/write adapter was added.
- **B1B: NO-GO.** There is still no disposable full Supabase Auth/Storage/Realtime/roles/extensions bootstrap, complete ordered 001–278 migration replay, post-replay tenant/RLS/grant verification, or proven cleanup/rollback procedure isolated from persistent `supabase_*_workspace` and protected `serveflow-sa33e-*` resources.

**Next phase recommendation:** independent source review of this preparation repair, then a separately scoped provenance and runtime-proof design. This report authorizes no runtime action or B1A.9/B1B work.

## Changed files and non-actions

- `supabase/audits/sa33c-fresh-install-verify.cjs`: bound preparation command builder/dispatcher, immutable repository-digest requirement, injected pure orchestration seam, post-creation binding correction.
- `tests/unit/sa33e-harness-safety.test.ts`: focused dispatcher and injected CLI orchestration tests.
- `docs/SUPER_ADMIN_BACKEND_B1A8_PREPARATION_ACTION_BOUNDARY_REPORT.md`: this report.

The pre-existing untracked B1A.7 report and all unrelated files were preserved. No Docker command or API access, resource creation/inspection/start/stop/removal, database/Supabase connection, SQL, migration, hosted or protected-resource access, package installation, system change, deployment, commit, or push occurred.

# ServeFlow Super Admin B1A.6 — Mandatory Lifecycle Gate Repair

**Date:** 2026-10-21  
**Authority:** B1A.6 source-only safety repair  
**Decision:** **NO-GO for B1B and runtime verification.**

## Scope and initial findings

B1A.5 correctly identified that B1A.4's pure gate was exported and unit-tested but did not guard lifecycle commands. The initial B1A.6 working tree contained the existing modified harness and test files; all prior reports and changes were preserved.

This phase read B1A.2, B1A.3B, B1A.4, B1A.5, SA3.3E, and SA3.3F; the harness; its direct callers; package scripts; and the related unit tests. No package script invokes this harness. Repository search found no direct lifecycle caller outside the harness CLI dispatch and historical reports.

No Docker command, resource inspection, service/database connection, SQL, migration, hosted request, protected-resource access, package installation, deployment, commit, or system change occurred.

## Call graph before repair

| Lifecycle entry point | Previous path | Bypass |
| --- | --- | --- |
| `--prepare-stopped` | confirmation → source/context/inventory/image → Docker network/container creation → `buildManifest` / legacy validator | B1A.4 gate was not called before or after creation. |
| `--start-verified` | confirmation → manifest/context/image → `verifyStartGate` → `docker start` → runtime validator | B1A.4 gate was not called. |
| `--stop-verified` | manifest/context → running-target validator → exact `docker stop` | Does not prepare/start/write a verification environment. |
| `--cleanup-prepared` | manifest → exact stopped-ID cleanup commands | Does not prepare/start/write a verification environment. |
| exported B1A.4 functions | pure result only | No production caller. |

There is no database write or replay function in the harness. The only current start target is the inert `/bin/sh -c sleep infinity` process.

## Mandatory authorization boundary

The harness now has one lifecycle contract: `serveflow.sa33e.lifecycle-authorization.v1`.

1. `authorizePreparation` validates generated preparation intent before any creation action: explicit plan, persistent inventory, protected/workspace name exclusion, exact content-addressed image ID, and no declared writable image volume.
2. `authorizeLifecycle` evaluates the complete B1A.4 stopped-target gate and creates a SHA-256 binding over the plan, container, network, image, and persistent snapshot.
3. `requireLifecycleAuthorization` accepts only an explicit, schema-valid, successful authorization for the requested operation and exact binding.
4. `runMandatoryLifecycle` is the single injected action boundary. It rejects thrown exceptions, thenables including rejected promises, missing results, malformed results, rejected results, operation mismatch, and binding mismatch before invoking an action.
5. `executeLifecycleAction` recomputes the binding immediately before the injected action. A changed target invalidates the authorization.

Preparation uses the boundary twice: once before creation for plan intent, then again after exact stopped-resource inspection before writing a manifest. Startup continues to run the legacy manifest revalidation as an additional check, but it cannot independently authorize `docker start`: the mandatory boundary runs immediately before that action.

The startup authorization branch additionally requires a future `serveflow.sa33e.runtime-proof.v1` object with a matching binding and `runtimeStorageVerified: true`. No CLI path supplies such an object in B1A.6. Therefore `--start-verified` currently fails closed before `docker start`. Write authorization has no implemented branch and is always rejected.

## Target binding and safety controls

- The stopped-target binding includes exact container and network IDs, names, labels/configuration, image inspection data, and persistent inventory. An authorization from one snapshot cannot execute an action on a changed snapshot.
- B1A.4 checks remain in force for identity, persistent/workspace/protected names, image content ID, internal/nonattachable/noningress network, ports, binds, mounts, Docker socket evidence, tmpfs configuration, privilege restrictions, credentials, and inert command.
- Lifecycle image validation now requires a full `sha256:<64 hex>` local image ID rather than accepting a shortened identifier. The mutable source tag remains provenance input only; a repository digest binding is still unavailable.
- A static passing result remains `runtimeStorageVerified: false`. It never authorizes startup without separate runtime evidence.
- The check-to-action interval remains a Docker runtime limitation. The binding is recomputed immediately before the injected action, but no source-only change can prove an external Docker actor cannot mutate state after that check. The future action remains blocked unless runtime proof exists.

## Tests added and retained

`tests/unit/sa33e-harness-safety.test.ts` now exercises the real injected lifecycle boundary rather than unused callbacks. The new tests prove with synthetic objects and spies that:

- preparation and startup call sites route through `runMandatoryLifecycle`;
- only a complete, target-bound synthetic runtime proof reaches its injected start action;
- configuration-only preflight reaches neither start nor write actions;
- a thrown gate, rejected promise, malformed result, and rejected result each call neither start nor write;
- invalid ID, image, network, port, Docker socket mount, and tmpfs configuration each call no start action;
- target mutation after authorization makes the action fail before its start callback;
- preparation/start do not grant write authorization.

These are pure unit tests. They do not inspect Docker, prove runtime mount behavior, or exercise a real start/write operation.

## Full replay boundary assessment

A full Supabase bootstrap and migration replay procedure still does not exist in source. The harness has no PostgreSQL initialization, service bootstrap, SQL executor, migration ledger application path, Auth/Storage/Realtime prerequisite setup, environment-variable policy, role/extension preparation, or rollback implementation. Migrations 276–278 were not changed and no replay mechanism includes them.

Any future replay design must identify every database-capable write point, isolate it from the `supabase_*_workspace` stack and protected `serveflow-sa33e-*` resources, establish a durable evidence/rollback strategy, and bind startup/write authorization to fresh runtime proof.

## Remaining blockers

1. The SA3.3F Docker Desktop discrepancy remains unresolved: configured `HostConfig.Tmpfs` did not appear in runtime `Mounts`. Runtime tmpfs is not proven.
2. No runtime-proof producer or separately authorized inert runtime investigation exists. The CLI is therefore intentionally unable to start a target.
3. Image provenance is bound to a local content-addressed image ID, but a reviewed repository digest/provenance policy remains needed.
4. A full Supabase bootstrap and ordered migration replay design/implementation remains absent.
5. The source-level binding reduces but cannot eliminate external Docker TOCTOU risk without a separately designed runtime protocol.

## Files changed

- `supabase/audits/sa33c-fresh-install-verify.cjs`
  - Added target-bound lifecycle authorization, fail-closed action execution, full local image-ID requirement, and mandatory preparation/start call sites.
  - Changed the legacy validator result from start approval to inert-target revalidation; it is now an additional check only.
- `tests/unit/sa33e-harness-safety.test.ts`
  - Added lifecycle-boundary tests with injected action spies and failure cases.
- `docs/SUPER_ADMIN_BACKEND_B1A6_LIFECYCLE_GATE_REPAIR_REPORT.md`
  - This report.

## Verification

| Command | Result |
| --- | --- |
| `node --check supabase/audits/sa33c-fresh-install-verify.cjs` | Passed |
| `npx vitest run tests/unit/sa33e-harness-safety.test.ts tests/unit/sa33c-migration-fix-source.test.ts` | Passed: 2 files, 51 tests |
| `git diff --check` | Passed |

## Final status and next step

Final Git status preserves the modified harness and unit test, and adds only this B1A.6 report. No source outside the authorized harness/test scope was changed.

**B1B remains NO-GO** unless independently authorized after runtime tmpfs evidence, immutable image provenance policy, a runtime-proof protocol, and a complete isolated Supabase bootstrap/migration replay design are proven. The smallest safe next step is an independent read-only review of this source repair; it must not start a resource or begin B1B.

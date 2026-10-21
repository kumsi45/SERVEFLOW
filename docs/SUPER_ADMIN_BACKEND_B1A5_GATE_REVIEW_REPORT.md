# ServeFlow Super Admin B1A.5 — Read-Only B1A.4 Gate Review

**Date:** 2026-10-21  
**Scope:** static repository review only  
**Decision:** **NO-GO for any runtime verification or B1B authorization.**

## Scope, paths, and non-actions

Verified and read the requested paths:

- `docs/SUPER_ADMIN_BACKEND_B1A4_PRESTART_SAFETY_DESIGN_REPORT.md`
- `docs/SUPER_ADMIN_BACKEND_B1A3B_DOCKER_TOPOLOGY_REPORT.md`
- `docs/SUPER_ADMIN_BACKEND_B1A2_ENVIRONMENT_RECOVERY_REPORT.md`
- `docs/SUPER_ADMIN_SA3_3E_HARNESS_SAFETY_REMEDIATION_REPORT.md`
- `docs/SUPER_ADMIN_SA3_3F_INERT_START_STOP_REPORT.md`
- `supabase/audits/sa33c-fresh-install-verify.cjs`
- `tests/unit/sa33e-harness-safety.test.ts`

No Docker command or resource inspection occurred. No service, database, PostgreSQL, Supabase endpoint, SQL, migration, hosted resource, dependency, or configuration was accessed or changed. Source and tests were not changed. This report is the only B1A.5 addition.

## Initial Git status

```text
 M supabase/audits/sa33c-fresh-install-verify.cjs
 M tests/unit/sa33e-harness-safety.test.ts
?? docs/SUPER_ADMIN_BACKEND_B1A3B_DOCKER_TOPOLOGY_REPORT.md
?? docs/SUPER_ADMIN_BACKEND_B1A4_PRESTART_SAFETY_DESIGN_REPORT.md
```

## Static review commands

```text
git status --short
git rev-parse --show-toplevel
Test-Path <each requested path>
Get-Content <requested reports, harness, and test>
rg -n <harness entry points, Docker calls, gate calls, and test assertions>
rg -n <harness references outside the harness and test>
git diff --check
```

These commands inspect local repository text and Git metadata only. No test was run in this review; the prior 35-test result is historical evidence, not a fresh B1A.5 execution result.

## Gate integration and execution-path trace

| Entry point | Calls | Can reach a state-changing operation | B1A.4 gate invoked? |
| --- | --- | --- | --- |
| `--check-source` | `checkSource` | No | No |
| `--prepare-stopped` | `prepareStoppedResources` → `buildManifest` → `validateStoppedTarget` | Yes: network/container creation and automatic exact-ID failure cleanup | **No** |
| `--start-verified` | `startVerifiedResources` → `verifyStartGate` → `validateStoppedTarget` | Yes: `docker start`, and exact-stop fallback | **No** |
| `--stop-verified` | `validateStartedTarget` | Yes: `docker stop` | No |
| `--cleanup-prepared` | `exactCleanupCommands` | Yes: exact container/network removal | No |
| exported `evaluatePrestartGate` / `runPrestartGate` | pure snapshot validation | No | No production call site found |

The old manifest-bound validators remain meaningful defenses for the current inert harness: exact IDs are re-inspected before start, configuration fingerprints are compared, and a post-start rejection attempts an exact stop. They do not make the B1A.4 gate an enforced prerequisite.

## Findings

### High — B1A.4 gate is not integrated into any lifecycle path

- **Evidence:** `evaluatePrestartGate` and `runPrestartGate` are defined and exported at `supabase/audits/sa33c-fresh-install-verify.cjs:256-285,584-587`. `prepareStoppedResources` directly calls `buildManifest` at `:453-488`; `startVerifiedResources` directly calls `verifyStartGate` then `docker start` at `:512-521`. The CLI dispatcher exposes only the legacy paths at `:570-577`. Repository search found no caller outside the test.
- **Behavior:** a user of the harness can reach creation, start, stop, or cleanup without evaluating the new result object. The `startupAuthorized` and `writeAuthorized` fields therefore cannot block any execution.
- **Status:** confirmed by source inspection.
- **Smallest safe next action:** before any runtime authorization, design a single manifest-bound executor contract that requires an accepted gate result and revalidates exact IDs immediately before the permitted operation. Do not wire it into Docker execution without separate approval and focused tests.

### High — the callback test does not prove a rejected preflight blocks a real startup or write path

- **Evidence:** `runPrestartGate` ignores `_callbacks` and only returns `evaluatePrestartGate(input)` at harness `:281-284`. The test passes three spies and asserts zero calls at test `:311-320`.
- **Behavior:** the assertion passes because no callback can ever be called on either pass or rejection. It does not connect to `docker(['start', ...])` at harness `:521`, any write function, or an executor decision.
- **Status:** confirmed by source inspection.
- **Smallest safe next action:** after an executor contract exists, add an injected executor test proving a rejected result reaches neither its start nor write adapter; retain a separate test proving a passing result still does not authorize database initialization.

### High — full Supabase bootstrap and migration replay are neither implemented nor ready to authorize

- **Evidence:** the harness header states it contains no PostgreSQL initialization, SQL, migration, Supabase CLI, or hosted path (`supabase/audits/sa33c-fresh-install-verify.cjs:1-8`). Its only image process is `/bin/sh -c sleep infinity` (`:474-479`), and all manifest database/SQL/migration flags are false (`:305-306`). B1A.2 identifies missing platform prerequisites and replay design (`docs/SUPER_ADMIN_BACKEND_B1A2_ENVIRONMENT_RECOVERY_REPORT.md:36-40`); SA3.3E records the same boundary (`docs/SUPER_ADMIN_SA3_3E_HARNESS_SAFETY_REMEDIATION_REPORT.md:215-231`).
- **Behavior:** no design or executable path establishes the PostgreSQL cluster, Supabase roles/extensions/services, migration ledger, credentials policy, or validation/rollback plan for migrations 001–278.
- **Status:** confirmed by source and report inspection.
- **Smallest safe next action:** prepare a separate source-only bootstrap/replay specification with explicit prerequisites, isolated inputs, validation checkpoints, and rollback boundaries. It must receive independent review before implementation.

### High — validation-to-start has an unavoidable mutable-state window

- **Evidence:** `startVerifiedResources` inspects and validates at harness `:518-520`, then starts at `:521`; post-start validation follows at `:524-532`.
- **Behavior:** Docker state can change after the pre-start inspection and before `docker start`. Exact ID prevents name-based replacement, and post-start validation attempts a fail-safe stop, but an altered target can still run briefly. The current command is inert, so this is bounded for the current harness; it would be unacceptable as proof for a future database-capable executor.
- **Status:** confirmed source-level TOCTOU window; no runtime race was attempted.
- **Smallest safe next action:** retain exact-ID checks and add a future executor design that minimizes the interval, binds an immutable manifest/result digest to the request, and treats post-start verification failure as no authorization for any database operation.

### Medium — target protection is narrow and is not enforced by the legacy start path

- **Evidence:** protected-name exclusion is only a two-name set at harness `:32-35,214-221`; workspace exclusion is only `/^supabase_.*_workspace$/` at `:217`. The exact ID inventory checks are sound when supplied, but `prepareStoppedResources` does not call this new identity stage (`:453-488`) and `verifyStartGate` reconstructs a plan without it (`:334-342`).
- **Behavior:** the B1A.4 utility rejects the currently documented names and persistent IDs in a supplied snapshot. It does not independently identify a renamed protected resource, a different persistent project naming convention, or enforce those exclusions before legacy start.
- **Status:** confirmed scope limitation. The current B1A.3B evidence does identify the documented workspace stack by labels and exact IDs; this review did not inspect its present runtime state.
- **Smallest safe next action:** use a reviewed persistent-resource snapshot plus exact IDs and run labels as the authoritative exclusion set for a future executor; do not rely on name patterns alone.

### Medium — image reference is required but is neither immutable nor bound to the inspected image identity

- **Evidence:** configuration accepts any nonempty string `imageRef` (`:208-209`); preparation records the mutable tag `public.ecr.aws/supabase/postgres:17.6.1.141` (`:21,466`). Image-ID equality is checked separately (`:224-229`), but neither the manifest nor gate records and verifies an image repository digest associated with the reference.
- **Behavior:** an inspected image ID provides an identity at validation time, but `imageRef` itself is not a pinned provenance assertion. This falls short of the report's stronger phrasing that the source reference is meaningfully recorded separately from identity.
- **Status:** confirmed by source inspection.
- **Smallest safe next action:** future design should require and persist a repository digest or other immutable provenance evidence along with the image ID, then verify both before an execution phase.

### Medium — mount/socket validation trusts an incomplete supplied snapshot shape

- **Evidence:** `containerSecuritySnapshot` reads `HostConfig.Binds`, `HostConfig.Tmpfs`, and top-level `Mounts` (`:113-130`); the pre-start storage stage uses those fields (`:242-253`). Tests inject a socket only through top-level `Mounts` (`tests/unit/sa33e-harness-safety.test.ts:289-300`).
- **Behavior:** a contradictory synthetic inspection object with a prohibited mount represented only in an uninspected mount field could pass this pure validator. Actual Docker inspection behavior for such a contradiction was not tested and is not claimed here.
- **Status:** confirmed as a static input-validation gap; real Docker impact is uncertain.
- **Smallest safe next action:** document the required Docker inspect schema for every mount-bearing field and add negative fixtures for contradictory/missing fields before relying on this gate in an executor.

### Medium — tmpfs remains configured evidence, not runtime isolation proof

- **Evidence:** stopped validation permits an empty `Mounts` array while checking `HostConfig.Tmpfs` (`harness :177-181`); the pure gate reports `runtimeStorageVerified: false` even on success (`:276-278`). `validateStartedTarget` demands two runtime tmpfs mount destinations (`:379-382`). SA3.3F recorded `HostConfig.Tmpfs` with `Mounts=[]` and failed closed (`docs/SUPER_ADMIN_SA3_3F_INERT_START_STOP_REPORT.md:69-80,120-122`).
- **Behavior:** static validation demonstrates requested configuration only. It does not demonstrate realized tmpfs mounts, a running process, exclusive runtime network membership, or absence of a Docker Desktop representation issue.
- **Status:** confirmed; runtime evidence remains absent by design in this review.
- **Smallest safe next action:** resolve the discrepancy only in a separately authorized inert runtime investigation using independent mount-namespace evidence correlated to exact resource IDs. Do not weaken the running mount assertion to `HostConfig.Tmpfs` alone.

### Medium — legacy preparation performs automatic failure cleanup outside B1A.4 control

- **Evidence:** after an error, `prepareStoppedResources` re-inspects and removes exact stopped IDs at harness `:489-500`. The B1A.4 gate has no involvement.
- **Behavior:** the cleanup is exact-ID and label checked, which is safer than wildcard cleanup, but it is automatic and therefore conflicts with any future contract requiring a separate cleanup decision. No B1A.4 test covers this error path.
- **Status:** confirmed by source inspection.
- **Smallest safe next action:** keep existing behavior unchanged under the current boundary; require an explicit decision in any future executor design whether automatic cleanup is allowed and test its failure semantics.

### Low — UUID claim is broader than the implemented regex

- **Evidence:** B1A.4 describes a UUID requirement (`docs/SUPER_ADMIN_BACKEND_B1A4_PRESTART_SAFETY_DESIGN_REPORT.md:41`), but both validation sites accept any 36-character combination of hexadecimal characters and hyphens (`harness :205,314`).
- **Behavior:** generated plans use `crypto.randomUUID()` (`:461`), but externally supplied malformed UUID-shaped strings can pass this part of validation.
- **Status:** confirmed by source inspection.
- **Smallest safe next action:** if an external plan/result becomes executable, use a canonical UUID validation rule and test malformed placement of hyphens.

### Low — one B1A.4 ownership statement is weaker than B1A.3B's recorded evidence

- **Evidence:** B1A.4 says B1A.3A/B did not prove the `*_workspace` stack was the ordinary workspace (`docs/SUPER_ADMIN_BACKEND_B1A4_PRESTART_SAFETY_DESIGN_REPORT.md:17`). B1A.3B concludes the eleven resources are the current persistent local Supabase development stack based on matching labels, topology, and IDs (`docs/SUPER_ADMIN_BACKEND_B1A3B_DOCKER_TOPOLOGY_REPORT.md:3-8,52-60`).
- **Behavior:** B1A.3B does not prove a human/operator owner or database contents, but it does provide stronger local-workspace evidence than B1A.4 acknowledges. Both reports correctly exclude the stack from B1B.
- **Status:** confirmed documentary wording issue.
- **Smallest safe next action:** correct the historical wording only in a separately authorized documentation update; preserve the B1B exclusion.

## Test coverage assessment

The 35 tests are meaningful for pure validator behavior. They cover fixture acceptance, persistent IDs, volumes, ports, bind strings, internal networking, hosted fallback values, malformed basic snapshots, manifest checks, exact ID rechecks, mocked post-start mounts, cleanup command construction, and absence of obvious database orchestration strings. B1A.4 adds useful negative cases for workspace/protected names, explicit image reference, image identity, network isolation, ports, bind/socket mounts, missing tmpfs config, stage ordering, generic errors, and unused callbacks.

They do **not** prove:

- invocation of B1A.4 by any CLI lifecycle path;
- a rejected B1A.4 result blocks `docker start` or any future write adapter;
- complete validation of actual Docker inspect mount schemas;
- Docker Desktop runtime tmpfs realization;
- races between inspection and start;
- a real full Supabase bootstrap or migration replay.

The callback assertion specifically proves only that the current pure function ignores callbacks. It must not be described as proof that a failed preflight prevents real startup or writes.

## Exceptions and asynchronous behavior

The gate is synchronous and catches every synchronous stage exception, returning a frozen rejection result with authorization fields false (`harness :256-279`). The harness uses synchronous `spawnSync` for Docker (`:406-410`), so no promise rejection path exists in the reviewed code. This is a static property only. It does not solve the integration and TOCTOU findings above.

## Exact blockers before a future authorization request

1. Integrate a single fail-closed, manifest-bound pre-start decision into every proposed start/write executor path.
2. Add executor-level negative tests that prove rejection calls neither a Docker-start adapter nor a database/write adapter.
3. Define immutable image provenance, comprehensive resource identity exclusion, and required Docker inspection schema.
4. Resolve the Docker Desktop runtime tmpfs discrepancy with separately authorized inert evidence; retain fail-closed behavior if it cannot be proven.
5. Produce and review a full isolated PostgreSQL/Supabase bootstrap and migration-replay design, including roles, extensions, Auth/Storage/Realtime prerequisites, ledger handling, authorization, validation, and rollback.
6. Obtain separate authorization after those design and evidence blockers are closed. B1A.5 authorizes none of them.

## Final Git status

```text
 M supabase/audits/sa33c-fresh-install-verify.cjs
 M tests/unit/sa33e-harness-safety.test.ts
?? docs/SUPER_ADMIN_BACKEND_B1A3B_DOCKER_TOPOLOGY_REPORT.md
?? docs/SUPER_ADMIN_BACKEND_B1A4_PRESTART_SAFETY_DESIGN_REPORT.md
?? docs/SUPER_ADMIN_BACKEND_B1A5_GATE_REVIEW_REPORT.md
```

`git diff --check` completed without reported whitespace errors. It checks tracked changes only; the untracked reports were preserved. No commit, push, deployment, Docker operation, database operation, SQL, migration, hosted access, or B1B activity occurred. Stop for review.

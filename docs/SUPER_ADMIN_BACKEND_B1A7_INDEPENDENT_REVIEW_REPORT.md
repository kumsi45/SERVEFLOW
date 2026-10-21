# ServeFlow Super Admin Backend B1A.7 — Independent Lifecycle Gate Review

**Date:** 2026-10-21  
**Scope:** read-only source review, existing pure unit tests, and this report only.  
**Decision:** **GO for further source-only corrective planning. NO-GO for runtime execution, Docker startup, database replay, or B1B.** B1A.6 has a real startup gate in its current CLI path, but it does not enforce its claimed single action boundary for preparation. The runtime and replay prerequisites remain unproven.

## Evidence reviewed

All requested reports exist at the expected paths: `docs/SUPER_ADMIN_BACKEND_B1A6_LIFECYCLE_GATE_REPAIR_REPORT.md`, `SUPER_ADMIN_BACKEND_B1A5_GATE_REVIEW_REPORT.md`, `SUPER_ADMIN_BACKEND_B1A4_PRESTART_SAFETY_DESIGN_REPORT.md`, `SUPER_ADMIN_BACKEND_B1A3B_DOCKER_TOPOLOGY_REPORT.md`, and `SUPER_ADMIN_BACKEND_B1A2_ENVIRONMENT_RECOVERY_REPORT.md`. Also reviewed `docs/SUPER_ADMIN_SA3_3E_HARNESS_SAFETY_REMEDIATION_REPORT.md` and `docs/SUPER_ADMIN_SA3_3F_INERT_START_STOP_REPORT.md` as historical evidence, not current runtime evidence.

Current source reviewed: `supabase/audits/sa33c-fresh-install-verify.cjs`, `tests/unit/sa33e-harness-safety.test.ts`, `tests/unit/sa33c-migration-fix-source.test.ts`, and `package.json`. A repository text search found no other direct harness caller outside these tests and historical documentation. `package.json:6-17` has no harness lifecycle script. No root or nested `AGENTS.md` appeared in the repository file search; the user-provided instructions governed this review.

## Lifecycle call graph and first side effects

| Entry | Actual path | Mandatory boundary before side effect? |
| --- | --- | --- |
| `--check-source` | CLI dispatch (`:694`) → `checkSource` (`:66-90`) | Source reads only; no lifecycle action. |
| `--prepare-stopped` | dispatch (`:695`) → `prepareStoppedResources` (`:560-617`) → evidence directory creation (`:571`) → `authorizePreparation` / `runMandatoryLifecycle` with a **no-op** action (`:576-579`) → direct `docker network create` and `docker create` (`:583-592`) → stopped inspection → second `runMandatoryLifecycle` with a **no-op** action (`:594-597`) → `buildManifest` and manifest write (`:598-603`) | **No.** Directory creation precedes authorization. Docker creation follows an authorization check, but neither create is the guarded injected action; there is no mandatory recheck at the create call. |
| `--start-verified` | dispatch (`:696`) → manifest/context/image/ID inspection (`:627-639`) → legacy `verifyStartGate` (`:640`) → `runMandatoryLifecycle` with the actual `docker start` callback (`:641-643`) → post-start validation/decision write or exact-stop fallback (`:644-658`) | **Yes for `docker start` in this CLI path.** The legacy validator alone does not start it. No runtime proof is supplied, so the current path rejects before the start callback. |
| `--stop-verified` | dispatch (`:697`) → manifest/context and started-target validation → direct exact-ID `docker stop` and decision write (`:661-679`) | No B1A.6 mandatory boundary; the legacy started-target validator gates this destructive operation. It is not preparation, startup, or database write. |
| `--cleanup-prepared` | dispatch (`:698`) → manifest/exact-ID/label/stopped checks → direct container/network removal (`:682-689`) | No B1A.6 mandatory boundary; exact-ID legacy checks gate removal. |
| Exported functions | `authorizePreparation`, `authorizeLifecycle`, `runMandatoryLifecycle`, `executeLifecycleAction`, pure validators/builders (`:706-710`) | No exported Docker executor. `executeLifecycleAction` can be called with a caller-supplied authorization and action; it checks schema, operation, flags and binding, but cannot attest who produced that object. |

Dispatch uses `process.argv.includes` in priority order (`:692-699`), so extra or combined flags do not select a separate mode. Unknown arguments without a supported flag reject. There is no retry path. Preparation's catch branch can remove exact newly created resources (`:604-616`); startup's post-start catch can stop the exact ID (`:649-654`). Both run outside `runMandatoryLifecycle`. No database initialization, SQL, migration executor, or write-capable callback exists in this harness (`:1-8, :706-710`).

## Findings

### High — preparation's claimed mandatory action boundary is incomplete

**Evidence:** `supabase/audits/sa33c-fresh-install-verify.cjs:571, :576-603, :604-616`. Both preparation gate callbacks return `undefined`; Docker creation, manifest writing and failure cleanup occur outside `executeLifecycleAction`. The B1A.6 report claims a single injected action boundary and authorization before any creation action (`docs/SUPER_ADMIN_BACKEND_B1A6_LIFECYCLE_GATE_REPAIR_REPORT.md:31-37`).

**Observed behavior / impact:** the current synchronous CLI checks a successful preparation result before issuing Docker create, so this is **not evidence that a rejected result currently creates a container**. It does prove the stronger action-boundary and first-side-effect claims false: `mkdtempSync` runs before authorization, and the real create calls are not protected by the executor's immediate binding recheck. A later edit, retry, or separately called function could invalidate the check without the creation adapter enforcing it. The second gate runs only after creation.

**Smallest correction:** put evidence-directory creation and exact network/container creation behind reviewed preparation action boundaries, with fresh validation of the inputs used for each action. Cover rejected, malformed, thrown, and rejected-promise gate results with spies on the **actual creation adapters**, plus partial-creation failure cleanup.

### High — a runtime-proof-shaped object is not authenticated evidence

**Evidence:** harness `:303-309, :329-352, :379-390`; test `tests/unit/sa33e-harness-safety.test.ts:342-357`. `authorizeLifecycle('start')` accepts any object with the schema string, matching hash, and `runtimeStorageVerified === true`. `lifecycleTargetBinding` is exported and computed from caller-supplied snapshots; the test itself constructs a successful proof this way. `runMandatoryLifecycle` also accepts an injected `gate`, and `executeLifecycleAction` accepts an injected authorization and arbitrary action.

**Observed behavior / impact:** missing, malformed, rejected and promise-returning gate results fail closed inside `runMandatoryLifecycle`; exact `true` checks avoid truthiness errors (`:339-361`). The **current CLI supplies no proof** (`:641-642`), so its `docker start` callback is unreachable under the current source. The exported functions nevertheless cannot prove that a successful proof came from an independent runtime observation, was fresh, or was issued by a trusted authority. A future caller that accepts ordinary caller-supplied proof would authorize start on fabricated data. A matching digest provides equality to supplied data, not provenance or freshness.

**Smallest correction:** define a trusted runtime-proof producer and protocol before enabling startup. Bind proof to the exact inspected resource, configuration, operation, issuer, and one-time/freshness context; make the action boundary consume only that trusted result. Keep current CLI startup closed meanwhile.

### Medium — authorization schemas and error results do not fully encode safe execution

**Evidence:** harness `:354-390`. `requireLifecycleAuthorization` checks required positive fields but does not reject unknown fields or conflicting fields such as `writeAuthorized: true` on a start result; an exported caller can fabricate an otherwise matching authorization. `runMandatoryLifecycle` catches action exceptions and returns the same rejection shape as a pre-action gate failure (`:379-390`). It also does not await an action that returns a promise.

**Observed behavior / impact:** the current CLI uses synchronous Docker calls and checks `ok`, so a thrown Docker start does not become a CLI success. For an exported/future executor, a rejection return cannot distinguish “no action invoked” from “action invoked and failed after side effects”; an asynchronous action could later fail after an immediate `ok: true`. An unknown operation cannot invoke a callback without satisfying an authorization check, but the schema is not an exclusive state machine. These are contract risks for future lifecycle use, not proof of a current CLI start bypass.

**Smallest correction:** validate a closed authorization schema with mutually exclusive flags, keep authorization failure separate from action failure, and either forbid thenable actions explicitly or await them in an asynchronous executor. Test side-effect and rejected-promise action cases.

### Medium — exact target binding is limited to supplied snapshots and the last check

**Evidence:** harness `:303-309, :369-376, :627-643`. The binding hashes plan, container, network, image, and persistent inventory and is recomputed before the injected start action. `verifyStartGate` checks the manifest fingerprints first (`:437-455`). Docker is inspected before the gate; `executeLifecycleAction` recomputes a hash of the **same in-memory objects**, without a new Docker inspection. Creation similarly uses the prechecked plan after an unguarded interval (`:576-592`).

**Observed behavior / impact:** mutation of the in-memory input between authorization and `executeLifecycleAction` is detected; the unit test proves that narrow case. External Docker changes after inspection, manifest edits by a local caller, or a changed runtime target between final check and Docker action are not ruled out. Exact IDs and manifest fingerprints constrain the current start path; they do not make external state atomic. Stop/cleanup also use exact IDs and labels, but no B1A.6 boundary. `validateStoppedTarget` rejects binds, non-tmpfs entries in `Mounts`, host ports, extra network membership and Docker socket strings (`:150-203`); this is only as complete as the supplied inspect fields.

**Smallest correction:** specify trusted manifest ownership and a fresh exact-ID inspection immediately before each action, minimize the check-to-action window, and require post-action fail-closed checks. Treat remaining Docker time-of-check/time-of-use risk as a runtime limitation requiring explicit acceptance only for a harmless inert operation.

### Medium — image provenance and runtime storage remain unproved

**Evidence:** harness `:21, :98-101, :240-245, :312-315, :564-576, :633-639`. The lifecycle path requires a full local `sha256:<64 hex>` image ID and uses it for container creation/start inspection. Preparation binding includes `RepoDigests` if supplied, but no reviewed repository digest or signature is required or checked against `imageRef`; the mutable tag is the initial lookup. The static gate checks configured tmpfs destinations and options (`:184-188, :262-266`) while the post-start validator expects two actual `Mounts` (`:484-489`). SA3.3F recorded configured tmpfs with `Mounts=[]` and rejected the start (`docs/SUPER_ADMIN_SA3_3F_INERT_START_STOP_REPORT.md:69-80, :120-122`).

**Observed behavior / impact:** a local content ID binds bytes selected at inspection, but it does not establish reviewed origin. A stopped target's tmpfs configuration is not runtime proof; the cause of SA3.3F's discrepancy remains unknown. The current startup branch stays closed because it receives no proof.

**Smallest correction:** document and verify an immutable repository digest/provenance policy, then design a separately authorized inert runtime investigation using independent mount-namespace evidence correlated with exact IDs and the existing runtime validator. Do not relax the runtime check to configured `HostConfig.Tmpfs` alone.

### Medium — the current tests do not exercise the CLI's real creation or alternate lifecycle paths

**Evidence:** test `tests/unit/sa33e-harness-safety.test.ts:316-325, :346-349, :352-419`; harness `:583-603, :661-699`. The “routes preparation and startup” test searches for two strings. Injected-action tests call `runMandatoryLifecycle` directly; none invokes `prepareStoppedResources`, `startVerifiedResources`, `stopVerifiedResources`, cleanup, or the dispatch function with injected Docker/file adapters. The earlier `runPrestartGate` callback test uses a function that deliberately never calls callbacks (`harness :297-300`).

**Observed behavior / impact:** the suite would still pass if direct `docker network create` / `docker create` remained outside the gated action, as they do now. It proves useful validator behavior and start-callback suppression for tested failures, but does not prove gate coverage of all CLI side effects. There is no test of target mutation through the real CLI, absent runtime proof through the CLI, legacy stop/cleanup gating, or post-creation recovery. The malformed and rejected gate cases, thrown gate, rejected promise, and changed in-memory target are covered only at the exported helper level. No write adapter exists to test beyond a spy.

**Smallest correction:** extract pure injectable orchestration adapters for the real CLI paths, then assert that rejected/malformed/thrown/promise gate outcomes call zero create/start/write adapters and that cleanup can affect only exact resources created by that invocation. Keep these tests free of Docker access.

## Verification performed

| Check | Actual result | Limit |
| --- | --- | --- |
| `./node_modules/.bin/vitest.cmd run tests/unit/sa33e-harness-safety.test.ts tests/unit/sa33c-migration-fix-source.test.ts --reporter=default` | **PASS: 2 files, 51 tests** (50 harness, 1 migration-source). | Pure mocked/synthetic tests; no CLI Docker execution or runtime proof. |
| `git diff --check` | **PASS**, no output. | Does not check this newly untracked report. |
| Static repository source/caller search | Completed; no alternate harness caller or package lifecycle script found. | Repository text only; no external caller assertion. |

The tests read migration **files** for source hashes; they do not execute SQL. The test result supports only the behavior exercised above. No syntax/build or broader suite was needed for this report-only change.

## Remaining blockers and next phase

1. **Preparation boundary:** move real creation and evidence writes into fail-closed, tested action adapters; independently review before runtime use.
2. **Runtime-proof protocol:** define a trusted issuer, fresh exact-target binding, runtime tmpfs observation, and separate startup versus write grants. No startup proof is currently produced.
3. **Image provenance:** pin and verify a reviewed immutable image reference and its relationship to the local image ID.
4. **Runtime tmpfs:** explain SA3.3F's `HostConfig.Tmpfs` versus `Mounts=[]` discrepancy using separately authorized evidence on *new* inert resources; retain rejection until proven.
5. **Disposable Supabase bootstrap and full ordered replay:** specify isolated Auth/Storage/Realtime schemas, roles, extensions, secrets, services, migration ledger, all 001–278 files, stop-on-first-error behavior, and durable rollback/evidence. The current harness has no such path (`:1-8`; `docs/SUPER_ADMIN_BACKEND_B1A2_ENVIRONMENT_RECOVERY_REPORT.md:36-51`).
6. **Post-replay security:** design assertions for effective grants/RLS, platform authorization, tenant isolation, and prerequisite services against the actual disposable database. Source hashes and SA2 partial checks do not prove this.
7. **Cleanup/failure recovery:** specify exact newly created IDs, manifest trust, partial-create cleanup, stop failure handling and evidence retention. Exclude persistent `supabase_*_workspace` and protected `serveflow-sa33e-*` resources by exact identity and ownership evidence, not naming alone.

**Recommended next phase:** source-only B1A.8 corrective design/implementation of the preparation boundary and testable orchestration contract, followed by another independent review. Runtime investigation and B1B require separate authorization after the blockers above are addressed. This report grants neither.

## Non-action confirmation

This review ran no Docker command or Docker API call, inspected no container/network, started/stopped/removed no resource, connected to no database/Supabase/hosted service, executed no SQL or migration, and accessed no protected or persistent resource. It changed no application, harness, test, dependency, system configuration, or prior report; it created only this report. No deployment, commit, or push occurred.

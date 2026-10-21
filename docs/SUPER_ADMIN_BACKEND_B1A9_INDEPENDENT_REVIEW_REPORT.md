# ServeFlow Super Admin Backend B1A.9 — Independent Preparation-Boundary Review

**Date:** 2026-10-21  
**Scope:** repository source review, existing pure tests, and this report only.

## Executive verdict

| Decision | Result |
| --- | --- |
| B1A.8 source-level preparation safety | **NO-GO for an unconditional safety claim.** The normal CLI route guards its two creation calls, but an exported injection seam can substitute safety evidence while retaining real Docker adapters. Image environment safety is also checked only after creation. |
| Real runtime preparation | **NO-GO.** No Docker execution or runtime evidence was authorized in this review. |
| Startup | **NO-GO.** The current CLI supplies no runtime proof; the historical tmpfs discrepancy is unresolved. |
| Database writes | **NO-GO.** No write authorization branch or replay executor exists. |
| B1B | **NO-GO.** Full isolated Supabase replay and security evidence are absent. |

The B1A.8 change improves the ordinary CLI control flow: network and container creation are passed through `runPreparationCreation`. The findings below prevent a conclusion that **every reachable creation path** is safely bound to trustworthy evidence.

## Evidence reviewed

All requested reports were found: `docs/SUPER_ADMIN_BACKEND_B1A8_PREPARATION_ACTION_BOUNDARY_REPORT.md`, `SUPER_ADMIN_BACKEND_B1A7_INDEPENDENT_REVIEW_REPORT.md`, `SUPER_ADMIN_BACKEND_B1A6_LIFECYCLE_GATE_REPAIR_REPORT.md`, `SUPER_ADMIN_BACKEND_B1A5_GATE_REVIEW_REPORT.md`, `SUPER_ADMIN_BACKEND_B1A4_PRESTART_SAFETY_DESIGN_REPORT.md`, `SUPER_ADMIN_BACKEND_B1A3B_DOCKER_TOPOLOGY_REPORT.md`, `SUPER_ADMIN_SA3_3E_HARNESS_SAFETY_REMEDIATION_REPORT.md`, and `SUPER_ADMIN_SA3_3F_INERT_START_STOP_REPORT.md`. Their runtime statements are historical; no current Docker state was inspected.

Current implementation and direct-call evidence reviewed: `supabase/audits/sa33c-fresh-install-verify.cjs`, `tests/unit/sa33e-harness-safety.test.ts`, `tests/unit/sa33c-migration-fix-source.test.ts`, `package.json`, and a repository source search for harness references and Docker creation calls. No `AGENTS.md` was found in the repository file search; the user-provided instructions applied. `package.json:6-17` has no script that invokes this harness.

## Creation-capable call graph and side effects

| Reachable entry | Path to action | Boundary before action |
| --- | --- | --- |
| CLI `--prepare-stopped` (`harness:750-758`) | `prepareStoppedResources()` (`:621-675`) → source/context/inventory/image lookup → initial `authorizePreparation` (`:637-638`) → evidence directory (`:645`) → `runPreparationCreation` (`:646-649`) → `createNetwork(networkArgs)` (`:429`) → `createContainer(containerArgs)` (`:435`) using default `docker(args)` adapters (`:647-648`) → post-creation gate/manifest (`:650-661`) | Internal preparation authorizer and exact command binding run before both Docker create calls. Recheck occurs between the two. Evidence-directory creation follows the initial gate but precedes the dispatcher. |
| Exported `prepareStoppedResources(services)` (`:621, :767`) | Same dispatcher, with individually overrideable source/context/inventory/image/evidence/creation/inspection/removal services (`:624-629, :642-660`) | The dispatcher still runs, but its inputs can be caller-supplied while unspecified creation adapters default to **real Docker**. This is the bypass of trusted evidence, described below. |
| Exported `runPreparationCreation` (`:410-438, :766`) | Internal authorizer → supplied creation callbacks | No built-in Docker call; actual callback effects depend on caller. A supplied extra `gate` cannot replace the internal authorizer. |
| CLI `--start-verified` (`:685-717, :754`) | Legacy manifest check → `runMandatoryLifecycle` → `docker start` callback (`:698-701`) → post-start check, optional exact stop (`:704-715`) | Start callback is guarded and presently unreachable without runtime proof (`:364-369`); post-start recovery stop is a separate direct action. |
| CLI `--stop-verified` (`:719-738, :755`) | Manifest/context/current-target validation → direct exact-ID `docker stop` (`:728`) → decision file | Legacy started-target validator; no B1A.8 preparation authorization. It does not create a resource. |
| CLI `--cleanup-prepared` (`:740-747, :756`) | Manifest/stopped/exact-ID/label checks → `exactCleanupCommands` → direct `docker(args)` removal | Legacy exact-ID cleanup checks; no creation. |
| Preparation exception path (`:662-673`) | Inspect recorded created IDs and run labels; remove exact stopped container/network | Runs outside creation dispatcher; no creation. Partial failures and cleanup exceptions remain relevant below. |
| CLI `--check-source` (`:752`) | File hashing/source checks | Read-only; no Docker creation. Unknown flags reject (`:757`). |

No retry/fallback branch or alternate `docker create`/`docker network create` call exists in this harness. CLI dispatch uses ordered `process.argv.includes` checks (`:750-758`), so combined flags select the first matching mode rather than a new creation route. The separate `supabase/audits/sa2-disposable-verify.cjs:119-132` contains historical direct Docker network/container creation for a **different** SA2 audit; it does not call this harness and is not protected by B1A.8. Repository-wide “every Docker creation path” would therefore be an unsupported claim. Printer audit scripts also contain separate Docker operations and were not treated as SA3.3E preparation callers.

## Findings

### High — exported mixed service injection can replace the evidence used for real creation

**Evidence:** `supabase/audits/sa33c-fresh-install-verify.cjs:621-629, :637-649, :764-768`; `tests/unit/sa33e-harness-safety.test.ts:532-578`.

**Observed behavior:** `prepareStoppedResources` is exported and accepts a `services` object. A caller can override `persistentInventory`, `inspectImage`, `localDockerContext`, or `checkSource` with synthetic values, while leaving `createNetwork` and `createContainer` unspecified. The latter then use the real `docker(args)` defaults. The internal gate validates the supplied snapshot, so the hash and schema may be internally consistent while the actual Docker inventory/image/context were never independently observed. The confirmation flag is only a process argument (`:622-623`), not an attestation of those inputs. The injected CLI test supplies **all** relevant mocks, so it does not catch this mixed-adapter case.

**Safety impact:** a direct module caller can reach real network/container creation on forged safety evidence. Whether Docker would accept a particular fabricated image ID or name depends on runtime state; this review made no such attempt. This defeats the claim that every reachable real creation path uses trustworthy target and provenance evidence.

**Smallest safe correction:** separate pure orchestration from the production entry point so production Docker adapters cannot be combined with caller-supplied safety probes. Keep the test seam entirely in a pure module or require a complete, internally constructed adapter bundle; prevent exported production creation from accepting partial overrides. Add a pure regression test for mixed overrides that proves zero real-adapter invocations.

### High — inherited image environment is not prevalidated or included in the creation binding

**Evidence:** harness `:30, :109-117, :150-203, :309-311, :337-349, :625-649`. `authorizePreparation` validates image ID, `Config.Volumes`, and `RepoDigests`, but does not inspect `image.Config.Env`. `preparationBinding` omits it. The creation command does not override/clear the image environment (`:314-323`). Forbidden credential names and hosted endpoint strings are checked only against the created container's `Config.Env` by `assertNoHostedFallback` during the post-creation stopped-target validation (`:109-117, :202, :652-655`). The B1A.8 tests' image fixture omits image `Config.Env` (`tests/unit/sa33e-harness-safety.test.ts:59`).

**Safety impact:** an image carrying forbidden credential or hosted endpoint environment values can pass the pre-creation authorization and be used to create a stopped container before the post-creation gate rejects it. This does not prove startup or data access, but it violates the stated rule that all existing safety-critical environment information be validated before creation. A change to that nested image field also does not invalidate the preparation binding.

**Smallest safe correction:** validate the inspected image environment and its required shape before either create action, bind it to authorization, and test missing/forbidden values plus mutation before dispatch. Retain the post-creation check as a second defense.

### Medium — partial creation and cleanup are not proved safe for every failure mode

**Evidence:** harness `:429-437, :646-673`; test `tests/unit/sa33e-harness-safety.test.ts:516-523, :532-578`; B1A.8 report `:44`.

**Observed behavior:** a successful network ID is recorded through `onNetworkCreated` before container creation, allowing exact-ID network cleanup if the container adapter throws. A container ID reaches the caller only after `createContainer` returns and `requireId` accepts it. If Docker creates a resource but returns an invalid/missing ID, the caller cannot identify that resource for automatic exact-ID cleanup. Cleanup inspection/removal errors can also interrupt subsequent cleanup and mask the original error. The unit test only proves the callback recorded a mocked network ID; it does not exercise `prepareStoppedResources` recovery after a failed container adapter, a failed network adapter, or cleanup failure.

**Safety impact:** partial resources or an empty evidence directory may remain after failure. Wildcard cleanup would be unsafe; current code does not use it. No real cleanup behavior was verified.

**Smallest safe correction:** add pure tests for network-create failure, container-create failure, malformed returned IDs, post-creation gate rejection, and cleanup exception ordering. Specify an evidence and manual-recovery protocol for indeterminate creation outcomes using newly created run identity and trustworthy exact IDs only.

### Medium — image digest association is not a reviewed provenance policy

**Evidence:** harness `:21, :325-329, :625-635`; B1A.8 report `:23, :44`; B1A.3B report `:105-111`.

**Observed behavior:** the normal path looks up a mutable tag, takes a syntactically valid matching `RepoDigests` entry from the returned image inspection, then creates by full local image ID. This gives a content-addressed identifier from supplied metadata. It does not check a reviewed allowlist, signature, trusted issuer, or expected tag-to-digest policy. A source-only review cannot establish current registry provenance.

**Smallest safe correction:** define and review an immutable image digest and source policy, then compare the observed local image ID/digest against it before any separately authorized real preparation.

### Low — B1A.8 test wording is broader than its assertions

**Evidence:** `tests/unit/sa33e-harness-safety.test.ts:437-457, :459-523, :525-578`; B1A.8 report `:31-33`.

**Observed behavior:** the test proves exact fixed command arrays and callback counts for selected cases. Its CLI test invokes the exported function with every external dependency mocked; the `:525-530` source-string test only checks one call string and absence of two literal Docker-call patterns. It does not execute the CLI dispatcher, model Docker's actual inspect/return shapes, test nested `image.Config.Env` mutation, or prove that a default real adapter cannot be paired with mocked safety evidence. Earlier unsafe network/ports/mount/tmpfs tests target stopped-target validators, not the pre-creation image environment or actual production Docker adapter.

**Smallest safe correction:** add isolated tests at the production/test seam for mixed adapters and nested input mutation. State the source-string test's narrow purpose. Do not use mocked passes as runtime certification.

## What the dispatcher does prove

Within the ordinary CLI path and trusted synchronous adapters, `preparationCommands` constructs exact arrays (`harness:314-323`), including an internal bridge and no `-p`, bind, volume, or socket argument. The arrays passed to callbacks are frozen (`:425-427`). The internal `authorizePreparation` is mandatory even when an extra gate is supplied (`:410-422`). Missing, rejected, malformed, or promise-returning **extra gate** results block both calls. The closed preparation result contract checks required fields, operation, binding, and explicit non-start/non-write flags (`:389-396`). A changed plan/image/persistent snapshot before network creation, or a change caused by the network callback before container creation, changes the digest and blocks the next action (`:428-435`). This does not attest that a supplied snapshot came from Docker, nor that an arbitrary callback obeys its array. The production adapters do forward those arrays to synchronous `docker(args)` (`:647-648, :574-579`). External Docker changes after inspection remain outside source-level atomicity.

The post-creation B1A.4 gate uses the full inspected target binding and a no-op action (`:650-655`). If it rejects, the manifest write does not occur and exact-ID recovery is attempted (`:662-673`). It cannot undo creation, and cleanup success is conditional. Startup is distinct: `--start-verified` supplies no runtime proof (`:698-701`), so its start callback remains blocked. `authorizeLifecycle('write')` throws into rejection (`:364-374`); there is no write adapter in this harness.

## Test results and remaining blockers

| Check run | Result | Meaning |
| --- | --- | --- |
| `./node_modules/.bin/vitest.cmd run tests/unit/sa33e-harness-safety.test.ts tests/unit/sa33c-migration-fix-source.test.ts --reporter=default` | **PASS: 2 files, 68 tests** (67 harness, 1 migration-source). | Pure mocked and source-file tests only; no Docker/database call. |
| `git diff --check` | **PASS**, no output. | Checks tracked differences; this new report is untracked until added. |

Before runtime preparation, close the two High findings, specify immutable reviewed image provenance, and independently review the corrected source. Before startup, establish an authentic fresh runtime-proof protocol bound to exact identity/configuration and resolve SA3.3F's configured `HostConfig.Tmpfs` versus running `Mounts=[]` discrepancy with separately authorized mount-namespace evidence (`docs/SUPER_ADMIN_SA3_3F_INERT_START_STOP_REPORT.md:69-80`). Do not treat configured tmpfs as runtime proof.

Before B1B, design a safe, fresh disposable Supabase bootstrap with Auth/Storage/Realtime prerequisites, roles, extensions, credentials, and ledger; replay **all** migrations in order with stop-on-error evidence; assert post-replay grants/RLS, platform authorization, and tenant isolation on the actual disposable target. Specify exact-ID cleanup and failure recovery that cannot affect protected `serveflow-sa33e-*` or persistent `supabase_*_workspace` resources. The current harness contains no database initialization, SQL executor, or replay path (`harness:1-8`; `docs/SUPER_ADMIN_BACKEND_B1A2_ENVIRONMENT_RECOVERY_REPORT.md:36-51`).

**Recommended next phase:** source-only repair and pure tests for the trusted production/test seam and pre-creation image environment validation, followed by another independent review. This report authorizes no runtime, startup, write, migration, or B1B action.

## Non-action confirmation

This review caused no Docker command/API interaction, resource inspection/creation/start/stop/removal, database or Supabase connection, SQL/migration execution, hosted request, protected/persistent-resource access, system change, package installation, deployment, commit, or push. No source, test, configuration, dependency, or prior report was edited. Only this report was created.

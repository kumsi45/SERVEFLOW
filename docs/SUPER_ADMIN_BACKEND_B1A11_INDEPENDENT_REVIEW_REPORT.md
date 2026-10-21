# ServeFlow Super Admin Backend B1A.11 — Independent Source Review

**Date:** 2026-10-21  
**Scope:** read-only source review, existing pure tests, and this report.

## Executive verdict

| Decision | Verdict |
| --- | --- |
| Source-level preparation safety | **NO-GO for an unconditional claim.** B1A.10 closes the mixed production/test adapter fallback and moves validation of the listed forbidden image environment values before creation. It still accepts arbitrary well-formed environment variables without a reviewed expected-value policy. |
| Real preparation | **NO-GO.** No live image, Docker, or runtime evidence was collected. |
| Startup | **NO-GO.** The CLI provides no runtime proof, and actual tmpfs behavior remains unresolved. |
| Writes | **NO-GO.** Write authorization is unimplemented. |
| B1B | **NO-GO.** Full isolated Supabase bootstrap, migration replay, and security verification do not exist. |

The first B1A.9 High finding is closed for **supported harness entry points**: ordinary callers cannot supply safety evidence to the private production preparation function, and the exported pure seam contains no real Docker adapter. The second is **partially closed**: missing/malformed entries and listed forbidden names/endpoints reject before creation, and the environment is bound to the target, but unexpected or sensitive values under other valid names are accepted.

## Evidence reviewed

All requested reports were present and reviewed: `docs/SUPER_ADMIN_BACKEND_B1A10_BOUNDARY_REPAIR_REPORT.md`, `SUPER_ADMIN_BACKEND_B1A9_INDEPENDENT_REVIEW_REPORT.md`, `SUPER_ADMIN_BACKEND_B1A8_PREPARATION_ACTION_BOUNDARY_REPORT.md`, `SUPER_ADMIN_BACKEND_B1A7_INDEPENDENT_REVIEW_REPORT.md`, `SUPER_ADMIN_BACKEND_B1A6_LIFECYCLE_GATE_REPAIR_REPORT.md`, `SUPER_ADMIN_BACKEND_B1A5_GATE_REVIEW_REPORT.md`, `SUPER_ADMIN_BACKEND_B1A4_PRESTART_SAFETY_DESIGN_REPORT.md`, `SUPER_ADMIN_SA3_3E_HARNESS_SAFETY_REMEDIATION_REPORT.md`, and `SUPER_ADMIN_SA3_3F_INERT_START_STOP_REPORT.md`. Historical runtime reports were treated as historical evidence only.

Current source and tests inspected: `supabase/audits/sa33c-fresh-install-verify.cjs`, `tests/unit/sa33e-harness-safety.test.ts`, `tests/unit/sa33c-migration-fix-source.test.ts`, `package.json`, and repository text searches for direct callers/exports/Docker creation. No repository `AGENTS.md` appeared in the file search; the user-provided instructions applied. `package.json:6-17` has no harness lifecycle script.

## Creation-capable call graph and capability separation

| Entry | Path and source evidence | Can it use this harness's real create adapter? |
| --- | --- | --- |
| CLI `--prepare-stopped` | Dispatch (`harness:796-804`) → private zero-argument `prepareStoppedResources()` (`:708-721`) → complete lexical production adapter bundle → `orchestratePreparation` (`:646-706`) → internal `runPreparationCreation` (`:425-453`) → exact network/container arrays (`:329-338`) → synchronous `docker(args)` callbacks (`:715-716`). | **Yes, only after both preparation authorization checks.** No caller services are accepted by this CLI path. |
| Exported `orchestratePreparation` | Exports (`:810-814`) → complete, exact-key, function-valued adapter bundle check (`:646-652`) → same internal dispatcher (`:677-680`). | **No built-in Docker adapter or partial fallback.** A caller supplies every callback, including any effect it chooses to implement itself. |
| Exported `runPreparationCreation` | Exports (`:812`) → mandatory internal `authorizePreparation`, optional additional gate, target/command binding rechecks → supplied callbacks (`:425-453`). | **No built-in Docker adapter.** A forged optional result cannot replace the internal authorizer. |
| CLI `--check-source` | Dispatch (`:798`) → source inventory/hash checks. | No creation. |
| CLI `--start-verified` | Dispatch (`:800`) → legacy manifest recheck → `runMandatoryLifecycle` → `docker start` callback (`:731-762`). | No creation; current CLI supplies no runtime proof, so its start callback is blocked. |
| CLI `--stop-verified` / `--cleanup-prepared` | Dispatch (`:801-802`) → exact-ID validation and direct stop/removal (`:765-793`). | No creation; these are separate destructive paths with legacy checks. |
| Preparation failure recovery | `orchestratePreparation` catch (`:693-705`) → inspect recorded IDs/labels and exact removal. | No creation or retry. Cleanup success remains conditional. |

The production `prepareStoppedResources` function is absent from `module.exports` (`:810-814`) and takes no parameters (`:708`). The CLI calls the lexical function, not an export property (`:799`), so replacing properties on the CommonJS exports object or using ordinary module caching does not swap its production wiring. No default parameter or partial adapter fallback remains in `orchestratePreparation`; it rejects missing, extra, or nonfunction adapters before metadata acquisition (`:646-652`). `process.argv` remains mutable, but a caller changing the confirmation flag still cannot inject evidence into the private production function. Other independent repository scripts, such as `supabase/audits/sa2-disposable-verify.cjs:119-132`, contain their own Docker creation paths and are **not** covered by this SA3.3E harness claim.

## Source findings

### High — environment policy accepts unreviewed variables before creation

**Evidence:** `supabase/audits/sa33c-fresh-install-verify.cjs:30, :104-118, :253-260, :352-364, :655-680`; tests `tests/unit/sa33e-harness-safety.test.ts:60-73, :591-604`.

**Observed behavior:** `validateEnvironment` requires an array of syntactically valid, unique `KEY=value` strings. It rejects a short regular-expression list of credential names and values containing `supabase.co`; it does not require an expected set of names, reject unreviewed values under otherwise valid names, or recognize other credential/endpoint names. For example, a supplied inspected image with `SUPABASE_URL=https://custom.example` or `AWS_SECRET_ACCESS_KEY=...` satisfies this validator if the rest of the synthetic image passes. The test's `UNEXPECTED=value` mutation (`:497-505`) is rejected **only because it is added after authorization**, changing the binding; the same entry present before authorization is not rejected by policy. The mock image fixture uses two accepted entries, but no test asserts that an unexpected entry initially present causes zero create calls.

**Safety impact:** a well-formed but unauthorized inherited environment can be used to create a stopped container. This does not establish startup or hosted access, but it leaves the pre-creation safety requirement incomplete. The post-creation environment hash check (`harness:159-171`) detects a mismatch only **after** the side effect and accepts an unchanged unexpected value. No runtime Docker test was attempted.

**Smallest safe correction:** define a reviewed, image-specific environment policy for this inert target, including which names and values are permitted or must be absent. Reject unknown or sensitive entries before evidence-directory/network/container creation; bind the accepted exact array and retain post-creation equality. If the expected image environment cannot be specified from trusted evidence, keep preparation blocked. Add a pure test showing an initially present unexpected entry causes zero network/container adapter calls.

### Medium — image provenance and inspect coherence are still assumptions

**Evidence:** harness `:21, :253-260, :323-345, :655-669, :708-716`; B1A.10 report `:21-27`.

**Observed behavior:** the private production adapter requests Docker image inspection by a mutable tag. The plan records one syntactically valid `RepoDigests` entry and the full `image.Id`; creation uses the image ID. The gate checks ID equality, digest membership, absence of declared volumes, and `Config.Env`, but no reviewed digest allowlist, publisher/signature check, or independent attestation that a reported environment belongs to the expected image is present. A single trusted Docker inspect response is the source of those fields. Source inspection proves the values are checked together and hashed; it cannot prove their runtime truth or provenance.

**Safety impact:** source-level target equality is stronger than a mutable-tag-only create, but it does not certify the image supplier or actual cached image metadata. This remains a blocker for real preparation.

**Smallest safe correction:** specify a reviewed immutable image digest and trusted source policy. In a separately authorized phase, compare the live inspected full ID, digest and configuration against that policy before any creation.

### Medium — partial creation and cleanup remain unverified for indeterminate outcomes

**Evidence:** harness `:444-452, :675-705`; tests `tests/unit/sa33e-harness-safety.test.ts:528-535, :547-624`.

**Observed behavior:** a returned network ID is recorded before container creation; a post-creation gate rejection attempts exact-ID cleanup. A Docker create that succeeds but returns an invalid/missing ID leaves no trustworthy ID for automatic cleanup. A failed inspect/removal in the catch block can prevent subsequent network cleanup or mask the original error. The test covers an injected container callback throwing at the pure dispatcher and a successful orchestration path, but not every catch/recovery branch. The evidence directory can remain after later rejection. No real cleanup was performed.

**Safety impact:** partial resources may remain, while indiscriminate cleanup would threaten protected or persistent resources.

**Smallest safe correction:** add pure orchestration tests for network failure, container failure, invalid returned IDs, post-creation rejection, and cleanup exceptions. Document exact-ID/manual recovery for indeterminate creation, without wildcard queries or deletion.

### Low — pure tests do not execute production CLI wiring

**Evidence:** test `tests/unit/sa33e-harness-safety.test.ts:537-545, :547-624`; harness `:708-721, :796-814`.

**Observed behavior:** the production boundary test checks source strings and that `prepareStoppedResources` is not exported; it does not run the CLI. The action-count test invokes exported `orchestratePreparation` with all synthetic adapters. This is appropriate for the no-Docker scope, but it cannot prove Docker's actual argument handling, image inspect shape, module loading across a separate process, or runtime isolation. The complete-adapter rejection is meaningful for the exported pure seam, not a live production execution test.

**Smallest safe correction:** retain the pure tests as source evidence and do an independent static review of the private CLI call graph after every change. Any future runtime test needs its own authority and reviewed target; do not label these tests runtime certification.

## What B1A.10 does prove in source

The production CLI cannot pass caller-supplied services to its private preparation function. The pure seam has no default Docker adapter, and an incomplete adapter bundle rejects before any callback (`harness:646-652`). Image metadata is read before preparation authorization (`:655-669`). A missing/nonarray/malformed/duplicate or **listed-forbidden** `Config.Env` entry fails before creation (`:104-118, :253-260, :352-364`). `preparationBinding` includes image ID, digests, volumes, environment array, plan, persistent inventory, and fixed network/container argument arrays (`:323-338`). The dispatcher rechecks that binding before network creation and after the network callback before container creation (`:425-452`). The full arrays are frozen, and the production adapters forward them directly to synchronous `docker(args)` (`:440-450, :715-716`). A nested environment or image ID mutation in the mock network callback blocks the mock container action (`tests:497-505`). The post-creation comparison is supplemental and cannot prevent creation (`harness:159-171, :681-691`).

Network creation uses an internal bridge with run label. Container arguments contain no published ports, binds, volumes, or Docker socket; they request read-only root, dropped capabilities, configured tmpfs, disabled healthcheck and inert `sleep infinity` (`:329-338`). The stopped-target gate checks IDs, names, network isolation, ports, mounts, credentials and process configuration after creation (`:159-216, :681-691`). Configured tmpfs remains **unproved at runtime**. A passing preparation result grants neither startup nor writes (`:359-364, :379-390`); `--start-verified` provides no runtime-proof object (`:743-747`), and the write branch always rejects.

## Test quality and exact results

The tests call the actual pure dispatcher and orchestration function with mock action counters. They cover missing/malformed image metadata and inherited environment, duplicate names, listed forbidden values, thrown/rejected-promise image metadata acquisition, malformed/rejected optional gate results, altered image ID or environment after network creation, and incomplete adapter bundles (`tests:427-624`). These cases prove zero **mock** network/container actions when rejection occurs before the first create, and zero mock container actions on a mutation caused by the network callback. They do not test initially present unexpected but syntactically valid variables, all recovery failures, or any real CLI/Docker operation. The source-string assertion could pass despite a later bypass expressed in a different syntax, so static call-graph review remains necessary.

| Check | Exact result | Limit |
| --- | --- | --- |
| `./node_modules/.bin/vitest.cmd run tests/unit/sa33e-harness-safety.test.ts tests/unit/sa33c-migration-fix-source.test.ts --reporter=default` | **PASS: 2 files, 70 tests** (69 harness, 1 migration-source). | Pure mocked/source checks; no Docker, service, or SQL execution. |
| `git diff --check` | **PASS**, no whitespace errors in tracked changes. | Does not inspect this newly untracked report. |

## Remaining blockers and next phase

For **source-level preparation**, close the unexpected-environment policy gap and independently review the result. For **real preparation**, require a reviewed immutable image provenance policy, current exact target/context/inventory evidence, and a safe partial-failure recovery procedure. Source hashes cannot prove external Docker state cannot change after validation.

For **startup**, define an authentic fresh runtime-proof protocol bound to the exact target/configuration. Resolve SA3.3F's historical `HostConfig.Tmpfs` versus running `Mounts=[]` discrepancy through separately authorized independent mount-namespace evidence; do not treat configured tmpfs as actual tmpfs. For **writes/B1B**, design and independently verify a disposable Supabase Auth/Storage/Realtime/roles/extensions bootstrap, complete ordered migration 001–278 replay, and post-replay grants/RLS, platform authorization, and tenant-isolation assertions. Protect `serveflow-sa33e-*` and persistent `supabase_*_workspace` identities through exact ownership evidence and cleanup limits. None of those prerequisites was executed or verified here.

**Recommended next step:** a narrowly scoped source-only environment-policy repair with pure rejection tests, followed by another independent source review. This report authorizes no runtime preparation, startup, write, migration replay, or B1B phase.

## Non-action confirmation

This review caused no Docker command/API interaction, live image or Docker resource inspection/creation/start/stop/removal, database or Supabase connection, SQL/migration execution, hosted request, protected or persistent resource access, system/dependency/configuration change, deployment, commit, or push. No source, test, or existing report was edited; only this report was created.

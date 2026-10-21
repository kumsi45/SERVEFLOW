# Super Admin Backend B1A.4 — Isolated Harness Design and Pre-Start Safety Gates

**Date:** 2026-10-21  
**Authority:** B1A.4 static design and pure harness-test scope only  
**Decision:** **NO-GO for B1B.** This phase establishes pre-start validation only. It does not establish a usable isolated PostgreSQL/Supabase replay environment.

## Scope and non-actions

This assessment read the B0, B1A, B1A.1, B1A.2, B1A.3A, B1A.3B, SA3.3E, SA3.3F, and SA2 evidence already in the repository, plus the existing SA3.3E harness and its unit test. It did not run Docker, inspect a Docker resource, connect to PostgreSQL or Supabase, run SQL or migrations, read hosted resources, or access the protected SA3.3F resource.

No Docker, database, SQL, migration, hosted, or protected-resource state was touched.

## Evidence carried forward

The SA3.3E harness is deliberately narrow: it can create a stopped, internal Docker network and a read-only, inert `sleep infinity` container, then verify exact IDs and configuration. It has no PostgreSQL initialization, SQL, migration, Supabase CLI, or hosted fallback path.

The SA3.3F record shows why a static preflight is insufficient: its protected container's `HostConfig.Tmpfs` expressed the intended `/sa33e` and `/tmp` settings, while its running `Mounts` evidence was empty. The started-target validator failed closed and the protected resource was stopped. This is an unresolved Docker Desktop runtime-storage evidence blocker. B1A.3A/B also found that the running `*_workspace` stack was not proven to be the ordinary workspace or isolated from protected infrastructure.

## Baseline and change control

Before B1A.4, the recorded SHA-256 values were:

| File | SHA-256 before |
| --- | --- |
| `supabase/audits/sa33c-fresh-install-verify.cjs` | `09AFEC3F82E01E13FF07B047F6E04D1F2099F58823F1806A43073E235FDB88D1` |
| `tests/unit/sa33e-harness-safety.test.ts` | `F6254A06964B05FB723B4388B64DD95CA446E7ED01A1053FF9C9C181E03C9B2F` |

After the B1A.4 change, SHA-256 values are:

| File | SHA-256 after |
| --- | --- |
| `supabase/audits/sa33c-fresh-install-verify.cjs` | `C41C2C696DF61494B6E668939B2F70E45F6FED8D826679FDA5964DFEC365C2C2` |
| `tests/unit/sa33e-harness-safety.test.ts` | `09A488BC2D5B784830CF9768491071A229B8BB1CCEE48A41F65E2CB86677DF73` |

## Pre-start safety contract

`evaluatePrestartGate` and `runPrestartGate` are pure functions. They consume supplied Docker inspection snapshots and a plan; they do not execute Docker commands or call supplied startup, write, or cleanup callbacks.

The ordered, fail-closed stages are:

1. **Configuration:** require a UUID run ID, explicit container/network names, an explicit image reference, and persistent-resource inventory.
2. **Target identity:** require distinct container and network IDs; reject persistent IDs, `supabase_*_workspace` names, and the exact recorded protected SA3.3F names. There is no fallback adoption path.
3. **Image identity:** require an inspected immutable image ID matching the plan and reject images declaring writable volumes. The explicit source image reference is recorded separately from the inspected image ID; a tag alone never proves identity.
4. **Network isolation:** require the exact planned bridge network, `Internal: true`, `Attachable: false`, and `Ingress: false`.
5. **Storage and restrictions:** reject bind mounts, non-tmpfs runtime mounts, missing or incorrectly protected `/sa33e` and `/tmp` tmpfs configuration, host port publication, hosted credential names, and hosted endpoint evidence.
6. **Stopped-target snapshot:** rerun the established comprehensive stopped-resource validator for exact IDs, state, labels, read-only rootfs, dropped capabilities, no-new-privileges, no devices, exclusive network membership, inert command, disabled healthcheck, and the existing mount/socket checks.

Any exception returns only a generic `PRESTART_REJECTED` result. The result includes the failed stage and already passed stages, but no raw snapshot or exception text, so a malformed environment snapshot cannot disclose credential-like values. A result is successful only after all six stages pass.

Even a passing pre-start result reports `startupAuthorized: false`, `writeAuthorized: false`, and `runtimeStorageVerified: false`. It is therefore a completed static preflight, not permission to start a database or run a replay.

## Tmpfs evidence rule

Stopped inspection data can demonstrate configured `HostConfig.Tmpfs`; it cannot prove the runtime mount view on this Docker Desktop environment. Missing configured tmpfs evidence, a bind mount, a non-tmpfs mount, or incorrect tmpfs destinations fails preflight. An empty stopped `Mounts` array remains a pending runtime fact rather than proof of isolation.

Before any future inert start, the executor must preserve the exact manifest identity and then collect a runtime inspection that satisfies the existing `validateStartedTarget` requirement for exactly two tmpfs mounts at `/sa33e` and `/tmp`. The SA3.3F contradiction means this criterion is currently unresolved and must not be weakened.

## Regression coverage

`tests/unit/sa33e-harness-safety.test.ts` now proves, using synthetic fixtures only:

- a valid specification can complete pure preflight while authorizing neither startup nor writes;
- workspace, protected SA3.3F, and persistent identities are rejected;
- missing image reference, image-ID change, external networking, host ports, bind/socket mounts, and missing tmpfs evidence are rejected;
- validation stops at the first failed stage and a partial result is not success;
- startup, write, and cleanup callbacks remain uncalled on both pass and rejection;
- generic rejection output does not expose a credential-like synthetic value.

## Future replay contract and B1B evidence required

No future replay may run merely because this preflight passes. A separately authorized B1B run must first provide:

1. Fresh, read-only Docker topology evidence proving the candidate IDs and names are newly created for the run and distinct from every `*_workspace` resource and protected SA3.3F identity.
2. The exact selected local Docker context and immutable inspected image ID, plus evidence that the image has no declared writable volumes.
3. An approved lifecycle plan with no automatic cleanup, retry, adoption, or fallback. Any cleanup must target only recorded exact IDs after separate review.
4. A stopped-resource manifest that passes all stages, followed by an inert start only after explicit authorization.
5. Runtime inspection evidence that resolves the tmpfs discrepancy and passes the unchanged runtime mount validator.
6. A separately approved PostgreSQL initialization and migration-replay design, credentials policy, schema/role/RLS verification plan, and rollback evidence. None is authorized by B1A.4.

## Checks performed

| Check | Result |
| --- | --- |
| `node --check supabase/audits/sa33c-fresh-install-verify.cjs` | Passed |
| `npx vitest run tests/unit/sa33e-harness-safety.test.ts` | Passed: 1 file, 35 tests |
| Static forbidden-execution search in harness | No `supabase start`, `supabase db reset`, `docker compose up`, `psql`, `initdb`, or `pg_ctl` match |
| `git diff --check` | Passed |

## Exact Git changes

Modified by B1A.4:

- `supabase/audits/sa33c-fresh-install-verify.cjs`: added the exported pure pre-start gate and explicit image-reference capture when a future stopped plan is prepared.
- `tests/unit/sa33e-harness-safety.test.ts`: added B1A.4 synthetic regression coverage and the fixture image reference.
- `docs/SUPER_ADMIN_BACKEND_B1A4_PRESTART_SAFETY_DESIGN_REPORT.md`: this report.

Pre-existing and preserved, not changed by B1A.4:

- `docs/SUPER_ADMIN_BACKEND_B1A3B_DOCKER_TOPOLOGY_REPORT.md` remains untracked in the working tree.

No commit, push, deployment, Docker operation, database operation, SQL, migration, hosted access, or protected-resource access occurred. Stop here for review.

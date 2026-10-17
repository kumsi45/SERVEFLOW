# ServeFlow Super Admin SA3.3F manifest-bound inert start/stop report

Date: 2026-10-18  
Status: **BLOCKED — POST-START VALIDATION REJECTED; EXACT CONTAINER SAFELY STOPPED**

## Authorized objective

SA3.3F authorized one narrowly scoped Docker runtime test of the stopped disposable resource retained by SA3.3E. It did not authorize PostgreSQL startup, database initialization, SQL, migrations, hosted access, account creation, resource cleanup, or changes to the persistent `workspace` stack.

## Exact authorized identities

| Item | Identity |
| --- | --- |
| Manifest | `C:\Users\user\AppData\Local\Temp\serveflow-sa33e-b88095f8-4d0-evidence-I4wA0h\preflight-manifest.json` |
| Manifest schema/run | `serveflow.sa33e.preflight.v1` / `b88095f8-4d02-4b40-8f19-edbb4043f42c` |
| Container | `cb93e8c11b46a5807997da7321bdd49876b4dadbb19ec9a0d6710103f5476f1f` |
| Network | `26b0f7d16fe814287101e86f5b85a63af9b10153fbea0a73e702196b1db8e04d` |
| Image | `sha256:ba10e934f0a59990379f78ab9ed93926f1c291dd61a12fe4026f4202f1b89770` |
| Docker context | `desktop-linux` / `npipe:////./pipe/dockerDesktopLinuxEngine` |

The manifest path was absolute, outside the repository, present, and parseable. Its resource IDs matched the SA3.3E report and live Docker inspection.

## Gate 1: read-only preflight

Result: **PASS**.

Before startup, the exact container was `created` with `Running=false`. The harness recomputed the container and network security snapshots and returned `START_APPROVED_FOR_EXACT_INERT_CONTAINER`.

The effective process configuration was:

```text
Entrypoint: ["/bin/sh"]
Command:    ["-c", "sleep infinity"]
User:       postgres
Healthcheck:["NONE"]
```

This explicitly replaces the PostgreSQL image's normal entrypoint. Neither the effective entrypoint nor command invokes `postgres`, `initdb`, `pg_ctl`, an image entrypoint script, or an initialization directory. The disabled healthcheck cannot invoke `pg_isready`. The retained image environment contains PostgreSQL-related variable names, but environment variables do not execute programs; the harness also rejected hosted credential variables and endpoints.

The remaining preflight properties passed:

- immutable container, network, and image identities matched the manifest;
- read-only root filesystem;
- `privileged=false`, all Linux capabilities dropped, and `no-new-privileges` enabled;
- no host port bindings and `PublishAllPorts=false`;
- no bind mounts, Docker volumes, devices, links, host aliases, or restart policy;
- only `/sa33e` and `/tmp` configured as disposable tmpfs, both with `nosuid,nodev,noexec`;
- the container was attached only to the expected internal, nonattachable, noningress bridge;
- the stopped network had no members;
- all recorded persistent `workspace` container IDs were present and running.

## Gate 2: actual manifest-bound start

The exact command executed was:

```text
node supabase/audits/sa33c-fresh-install-verify.cjs --start-verified --confirm-start-verified-resources --manifest "C:\Users\user\AppData\Local\Temp\serveflow-sa33e-b88095f8-4d0-evidence-I4wA0h\preflight-manifest.json"
```

The gate re-inspected the manifest resources and then issued `docker start` for the exact manifest container ID. It did not invoke Supabase orchestration or select a resource by name, prefix, or label.

Docker recorded:

| Event | UTC time |
| --- | --- |
| Started | `2026-10-17T21:10:19.835440702Z` |
| Fail-safe stop completed | `2026-10-17T21:10:21.889924891Z` |

The post-start validator confirmed the same running container and image identity, `/bin/sh -c "sleep infinity"`, user, disabled healthcheck, hosted-target exclusion, read-only root, privilege and capability restrictions, no ports, no binds, no devices or host aliases, the expected network mode, and both configured `HostConfig.Tmpfs` entries.

It then failed closed on the runtime mount assertion:

```text
Expected runtime mount destinations: ["/sa33e", "/tmp"]
Docker inspect Mounts returned:       []
```

The configured `HostConfig.Tmpfs` still contained both exact tmpfs definitions. This may be a Docker Desktop inspection representation difference, but SA3.3F does not establish that explanation. The check was not weakened and the start was not retried.

Because the validator failed at this assertion, SA3.3F did not independently capture a live `docker top` process listing and did not reach its live exclusive-network-membership assertion. Effective process configuration was proven before and during start, but direct live process evidence remains **UNVERIFIED**.

## Gate 3: fail-safe exact stop

The start gate's failure handler issued:

```text
docker stop --time 1 cb93e8c11b46a5807997da7321bdd49876b4dadbb19ec9a0d6710103f5476f1f
```

The recorded exact stop status was `0`. Docker events recorded `start`, `kill`, `stop`, and `die` for that exact container. Final inspection showed:

- state `exited`, `Running=false`;
- exit code `137`, consistent with the one-second forced stop;
- unchanged container, image, entrypoint, command, healthcheck, tmpfs configuration, ports, and network-mode identities;
- the disposable network remained internal and contained no running member;
- no disposable Docker volume existed.

The separate `--stop-verified` command was not invoked because the failure handler had already stopped the exact container. It would have rejected an already stopped resource. No container, network, manifest, or evidence file was removed.

## Verification evidence

### Mocked tests

```text
npx vitest run tests/unit/sa33e-harness-safety.test.ts tests/unit/sa33c-migration-fix-source.test.ts --reporter=default
```

Result: **PASS — 2 files, 22 tests**.

These tests validate mocked inspection decisions and exact command construction. They are not runtime proof.

### Syntax

```text
node --check supabase/audits/sa33c-fresh-install-verify.cjs
```

Result: **PASS**.

### Actual Docker result

Result: **FAIL CLOSED**. Exact start occurred, post-start validation rejected Docker's empty runtime `Mounts` array, and the exact fail-safe stop succeeded. The final resource is stopped and retained.

## Persistent workspace identities

The following running IDs were identical before and after the attempt:

| Service | Before | After |
| --- | --- | --- |
| Database | `617bc30b56f5` | `617bc30b56f5` |
| Kong/API | `72a3dcac9844` | `72a3dcac9844` |
| Studio | `a74f3da68bbf` | `a74f3da68bbf` |
| Auth | `161f33a528b3` | `161f33a528b3` |
| REST | `3feb24941492` | `3feb24941492` |
| Storage | `d6c69d0f69f8` | `d6c69d0f69f8` |
| Realtime | `247b4e6e848c` | `247b4e6e848c` |
| PostgreSQL metadata | `98d3afb2860c` | `98d3afb2860c` |
| Inbucket | `9c9c7adcce8e` | `9c9c7adcce8e` |
| Analytics | `ab7f344187ab` | `ab7f344187ab` |
| Vector | `9a83e1cad696` | `9a83e1cad696` |
| P3.2.2 Edge Runtime | `596f6696636c` | `596f6696636c` |

No persistent resource was stopped, restarted, removed, renamed, or modified.

## Explicit boundary confirmation

- PostgreSQL invoked: **NO**
- Database storage initialized: **NO**
- SQL, seeds, or migrations executed: **NO**
- Supabase CLI orchestration used: **NO**
- Database client or health probe used: **NO**
- Hosted Supabase project or credentials accessed: **NO**
- Account, administrator, invitation, tenant, or application data created: **NO**
- Environment, secret, Auth, or MFA setting changed: **NO**
- Disposable container or network removed: **NO**
- Persistent `workspace` resource changed: **NO**

## Blocker and next approval

SA3.3F is **not complete as a successful inert runtime verification**. The harness correctly failed closed, but the required runtime tmpfs evidence and direct live process/network evidence remain unverified.

The next approval should authorize a narrow **SA3.3F harness investigation and remediation**:

1. determine, without starting the retained container, how this Docker Desktop engine represents tmpfs runtime mounts;
2. design and test a non-weakened runtime check, potentially using container-namespace mount information rather than assuming tmpfs appears in Docker's `Mounts` array;
3. make only the minimal harness and mocked-test changes needed;
4. stop for independent review before any second real start.

A second start/stop attempt, PostgreSQL initialization, migration replay, and SA3.3G each require separate explicit approval.

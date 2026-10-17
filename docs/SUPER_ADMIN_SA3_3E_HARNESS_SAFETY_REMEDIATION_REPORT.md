# ServeFlow Super Admin SA3.3E harness safety remediation report

Date: 2026-10-18  
Status: **HARNESS SAFETY REMEDIATION COMPLETE — READY FOR INDEPENDENT REVIEW, NOT DATABASE EXECUTION**

## Original SA3.3D failure

The prior harness invoked `supabase start` before validating the generated containers, writable storage, network membership, and port bindings. Startup could initialize PostgreSQL and apply migrations before the target passed the safety gate. Its loopback check also occurred after service startup even though the persistent local CLI stack publishes several ports on all host interfaces.

SA3.3D correctly stopped before running that branch. No database was created or written. The historical report `docs/SUPER_ADMIN_SA3_3D_DISPOSABLE_EXECUTION_REPORT.md` was preserved.

## Files changed

- `supabase/audits/sa33c-fresh-install-verify.cjs`
  - Removed the Supabase CLI startup/reset path and all PostgreSQL, SQL, migration, Auth, and hosted-target execution code.
  - Added separate stopped-resource preparation, manifest verification, inert start, post-start verification, and exact cleanup gates.
  - Retained the read-only migration source/hash inventory.
- `tests/unit/sa33e-harness-safety.test.ts`
  - Added mocked Docker inspection tests for the required allow and deny cases.
- `docs/SUPER_ADMIN_SA3_3E_HARNESS_SAFETY_REMEDIATION_REPORT.md`
  - Records the architecture, tests, evidence, limitations, and next authorization boundary.

No migration, application source, dependency, environment file, printer resource, or existing SA3 report was changed.

## Revised two-phase architecture

### Phase A: stopped-resource preparation

The executed command was:

```text
node supabase/audits/sa33c-fresh-install-verify.cjs --prepare-stopped --confirm-stopped-resource-creation
```

It was run only after the mocked safety tests passed. The retained preflight resources are:

| Resource | Exact identity |
| --- | --- |
| Container | `cb93e8c11b46a5807997da7321bdd49876b4dadbb19ec9a0d6710103f5476f1f` |
| Container name/state | `serveflow-sa33e-b88095f8-4d0-db` / `Created` (`Running=false`) |
| Network | `26b0f7d16fe814287101e86f5b85a63af9b10153fbea0a73e702196b1db8e04d` |
| Network name | `serveflow-sa33e-b88095f8-4d0-net` |
| Image | `sha256:ba10e934f0a59990379f78ab9ed93926f1c291dd61a12fe4026f4202f1b89770` |
| Manifest | `C:\Users\user\AppData\Local\Temp\serveflow-sa33e-b88095f8-4d0-evidence-I4wA0h\preflight-manifest.json` |

The manifest-bound validator was rerun against live read-only `docker inspect` results after creation and returned `START_APPROVED_FOR_EXACT_INERT_CONTAINER`. This was a decision calculation only; the real start command was not invoked.

When separately authorized, it will:

1. Verify migration source hashes and the gap-free 001–278 inventory.
2. Require a local `npipe:` or `unix:` Docker context and snapshot every existing container ID, network ID, and volume name.
3. Inspect the already available `public.ecr.aws/supabase/postgres:17.6.1.141` image and record its immutable content ID. It does not pull an image.
4. Generate a UUID-based prefix for one dedicated network and one database-image container.
5. Create an internal, nonattachable bridge network with a run-specific label.
6. Create one **stopped** container by exact image ID. Its entrypoint is `/bin/sh`, command is `sleep infinity`, user is `postgres`, inherited healthcheck is disabled, root filesystem is read-only, every Linux capability is dropped, `no-new-privileges` is enabled, and automatic restart is disabled.
7. Configure only two writable tmpfs destinations, `/sa33e` and `/tmp`, with `nosuid`, `nodev`, and `noexec`. No Docker volume or bind mount is used.
8. Publish no host ports and add no host aliases, host gateway route, device, Docker socket, repository mount, user-profile mount, or linked container.
9. Inspect the stopped container, network, and immutable image by exact IDs. Any missing or ambiguous identity/configuration fails closed.
10. Write a nonsecret `serveflow.sa33e.preflight.v1` manifest into a unique OS temporary evidence directory. It includes exact resource IDs, security fingerprints, Docker context, persistent-resource snapshot, all 278 migration file names/hashes, and explicit false values for database initialization, SQL, and migration authorization.

The first real preflight exposed a relative `TEMP` value (`venv\Scripts\activate`). Its stopped container and network were removed using their exact manifest IDs, and the misplaced nonsecret evidence directory was removed after an absolute-path boundary check. The harness was then changed to require an absolute OS temporary directory outside the repository. It also disables and verifies the inherited image healthcheck so a future inert start cannot run `pg_isready`. The corrected real preflight produced the retained identities above.

Preparation uses Docker directly. It never calls the Supabase CLI, reads `.env` files or linked-project metadata, or accepts a URL or database credential.

If preparation fails after creating a stopped resource, its failure cleanup re-inspects the exact ID and run label before removing that exact stopped container or network. It never prunes or selects resources by prefix or label alone.

### Phase B: manifest-bound inert start gate

The separately gated future command is:

```text
node supabase/audits/sa33c-fresh-install-verify.cjs --start-verified --confirm-start-verified-resources --manifest <absolute-manifest-path>
```

It was implemented but **not run in SA3.3E**.

The gate requires a valid manifest and the same local Docker context. It re-inspects the container, network, and image by their exact immutable IDs and recomputes their security fingerprints. It rejects replacement, configuration drift, added networks, another attached container, any port or bind, hosted credential variables, or an altered image.

Only after that comparison does it issue `docker start <exact-container-id>`. The configured process remains `sleep infinity`; PostgreSQL is not its command. Immediately after start, it rechecks the exact ID, image, command, user, label, read-only root, capabilities, security options, host ports, tmpfs destinations, mounts, host routes, network identity, internal flag, and exclusive membership. It writes a nonsecret start decision stating that database initialization, SQL, and migrations remain false.

This phase has no function that initializes PostgreSQL or applies migrations. A later database initializer cannot be inferred from start approval and requires separate design and authorization.

### Exact cleanup gate

Cleanup requires the manifest and explicit `--confirm-exact-cleanup`. It refuses a running container and constructs only:

```text
docker container rm <exact-manifest-container-id>
docker network rm <exact-manifest-network-id>
```

It rechecks each exact ID and run label. There is no wildcard, prefix, label query, prune, broad stop, volume deletion, or `--force` path.

A separate exact stop gate was added for a future approved inert start. It validates the running resource and manifest, then can issue only `docker stop --time 1 <exact-manifest-container-id>`. If post-start verification fails, the start gate attempts the same exact-ID stop and records the result. Neither start nor stop gate was invoked in SA3.3E.

## Verification rules

### Identity

- Container, network, and image IDs must exist and match strict Docker ID formats.
- Created IDs must differ from the persistent preflight inventory.
- Names and run labels must match the UUID-derived plan.
- The container must reference the inspected immutable image ID.
- The manifest stores security hashes and exact cleanup IDs.

### Writable storage and host access

- Bind mounts and Docker volumes are rejected.
- Only `/sa33e` and `/tmp` tmpfs mounts are allowed.
- Docker socket, Windows Docker pipe, repository, profile, host device, host-gateway, and extra-host access are rejected.
- The root filesystem is read-only; the two tmpfs mounts are the only intended writable locations.
- Reusing a persistent/pre-existing volume as database storage is rejected. No disposable volume name is generated because this design deliberately uses tmpfs and creates no Docker volume object.

### Network and ports

- The network must be a newly created internal bridge with `attachable=false` and `ingress=false`.
- The container may belong only to that network.
- The network may contain no unrelated container before start and exactly the manifest container afterward.
- `PortBindings` must be empty and `PublishAllPorts=false`. Loopback publication is rejected along with wildcard publication.

An internal network is one control, not the complete safety claim. The harness also rejects host ports, binds, devices, Docker socket access, host aliases, added capabilities, privilege escalation, alternate networks, and hosted credential sources. A Docker administrator on the host can still inspect or alter Docker resources; protecting against a concurrent malicious host administrator is outside this local harness threat model. Drift immediately before and after start is checked.

### Hosted-target exclusion

- The file contains no `supabase start`, `db reset`, migration command, `--linked`, PostgreSQL client, or database initialization command.
- The runner accepts no database URL.
- The plan and manifest require `supabaseCliUsed=false`, `linkedProjectRead=false`, `environmentFilesRead=false`, and an empty credential-source list.
- Known Supabase/database credential environment-variable names and `supabase.co` endpoints are rejected from the container configuration.

## Tests and actual results

### Mocked/unit evidence

Command:

```text
npx vitest run tests/unit/sa33e-harness-safety.test.ts tests/unit/sa33c-migration-fix-source.test.ts --reporter=default
```

Result: **PASS — 2 files, 22 tests**.

The mocked tests cover:

- safe stopped target acceptance;
- persistent `workspace` container ID rejection;
- persistent/pre-existing volume rejection;
- wildcard and loopback host-port rejection;
- repository, user profile, Docker socket, and Windows Docker-pipe bind rejection;
- missing/noninternal network rejection;
- unexpected container network membership, another network member, and host-gateway rejection;
- linked-project and hosted-credential fallback rejection;
- missing IDs, image identity, mount data, and network data rejection;
- malformed manifest rejection;
- exact unchanged pre-start approval;
- altered/replaced resource rejection;
- mocked post-start mount, port, identity, and exclusive-network verification;
- exact-ID-only cleanup construction and replacement rejection;
- absence of implicit Supabase/database execution commands.

These are mocked Docker inspection objects. They prove validator decisions and command construction, not actual Docker runtime isolation.

### Source and fail-closed checks

- `node --check supabase/audits/sa33c-fresh-install-verify.cjs`: **PASS**.
- `node ... --check-source`: **PASS**; 278 migrations, range 001–278, migration-set SHA-256 `2C42913B4332C6B530D5FCC6A2F349AD9580F2218EBC4723623BBEE7C1FC7399`, `databaseExecuted=false`.
- `--prepare-stopped` without its confirmation: **PASS (rejected before Docker access)** with exit 1.
- `--start-verified` without its confirmation: **PASS (rejected before manifest/Docker access)** with exit 1.
- Retired `--run-disposable --confirm-disposable`: **PASS (rejected; no matching command mode)** with exit 1.
- `git diff --check`: **PASS**.

No build was needed for this isolated CommonJS harness and Vitest source-test change. The focused Vitest run compiled the new TypeScript test.

### Real stopped-resource and read-only Docker evidence

Phase A created the retained stopped container and internal network identified above. No Docker volume was created. `docker ps` does not list the disposable container because it has never started; `docker ps -a` reports it as `Created`.

Live manifest-bound reinspection confirmed:

- exact container, network, and image IDs match the manifest;
- the network is internal, nonattachable, noningress, and has no running member;
- host port bindings, bind mounts, devices, extra hosts, and Docker volumes are absent;
- only the two configured tmpfs destinations are writable after a future start;
- the effective command is `sleep infinity` and the inherited healthcheck is disabled;
- database initialization, SQL, and migration authorization remain false.

The cached database image identity is:

```text
sha256:ba10e934f0a59990379f78ab9ed93926f1c291dd61a12fe4026f4202f1b89770
```

Its read-only image inspection exposed no declared Docker volume key. The real stopped-container inspection confirmed that the harness overrides its normal PostgreSQL entrypoint/command with `/bin/sh -c "sleep infinity"` and disables the image healthcheck.

## Persistent workspace identities

The SA3.3D closing snapshot supplied the before-remediation baseline. Read-only inspection after Phase A found the same persistent running identities:

| Service | Before ID | After ID |
| --- | --- | --- |
| Database | `617bc30b56f5` | `617bc30b56f5` |
| Kong/API | `72a3dcac9844` | `72a3dcac9844` |
| Studio | `a74f3da68bbf` | `a74f3da68bbf` |
| Auth | `161f33a528b3` | `161f33a528b3` |
| REST | `3feb24941492` | `3feb24941492` |
| Storage | `d6c69d0f69f8` | `d6c69d0f69f8` |
| Realtime | `247b4e6e848c` | `247b4e6e848c` |
| PostgreSQL metadata | `98d3afb2860c` | `98d3afb2860c` |
| Inbucket | `9c9c7adcce8c` | `9c9c7adcce8c` |
| Analytics | `ab7f344187ab` | `ab7f344187ab` |
| Vector | `9a83e1cad696` | `9a83e1cad696` |
| P3.2.2 Edge Runtime | `596f6696636c` | `596f6696636c` |

The existing stack remained running. No Docker mutation command was executed during verification.

## Limitations and unproven assumptions

- Phase A executed against real Docker and validated the stopped inspection shapes. The first attempt's exact-ID cleanup was exercised successfully. The corrected retained resource has not been cleaned up.
- Phase B was tested with mocked inspection objects only. No container was started.
- The stopped configuration proves the selected image and command metadata, but `/bin/sh -c "sleep infinity"` has not executed in this retained container.
- tmpfs disappears with the container and has no stable Docker volume ID. This is intentional; it avoids persistent writable storage and makes database state disposable, but later evidence must be copied out before cleanup if needed.
- Docker's host administrator can access bridge networks and mutate resources. There are no published ports or container routes to the host/internet, but this does not defend against a malicious or compromised Docker host administrator.
- The harness now provides a safe resource boundary only. It does not initialize full Supabase Auth/Storage roles or schemas, execute 001–278, test migrations 015/028/054/055, or test 276–278 authorization.
- A complete platform-prerequisite/bootstrap design is still required before migration execution can be proposed.

## Review readiness and next approval

The harness is **ready for independent source and safety review**. It is **not ready or authorized to execute migrations**.

The exact next approval should be **SA3.3F manifest-bound inert start/stop verification only**. It would permit running `--start-verified` with the retained absolute manifest, confirming the container executes only `sleep infinity`, then running the exact manifest-bound stop gate and, if requested, exact-ID cleanup. It must continue to forbid PostgreSQL initialization, SQL, migrations, Supabase CLI startup/reset, hosted access, real accounts, and persistent `workspace` changes.

Database/platform initialization and migration replay require further, separate design and approval after Phase B evidence passes independent review.

## Explicit execution confirmation

- Database-capable container started: **NO**
- PostgreSQL/Supabase started: **NO**
- SQL or migrations executed: **NO**
- Docker network/container created: **YES, stopped Phase A resources only**
- Docker volume created: **NO**
- Initial stopped Phase A resources removed: **YES, exact manifest IDs after evidence-path rejection**
- Corrected stopped Phase A resources retained: **YES, exact identities recorded above**
- Hosted project or credential accessed: **NO**
- Persistent `workspace` resource changed: **NO**
- Auth user, administrator, invitation, or founder account created: **NO**
- Environment/secrets changed: **NO**

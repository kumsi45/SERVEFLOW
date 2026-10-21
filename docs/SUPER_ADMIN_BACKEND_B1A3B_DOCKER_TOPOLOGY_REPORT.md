# B1A.3B: read-only Docker topology and ownership inventory

## Result

**The eleven inspected `supabase_*_workspace` containers are the current persistent local Supabase development stack. They are not the protected SA3.3F environment and cannot be used for B1B.** Docker metadata shows a common `workspace` Compose/Supabase CLI project label, shared `supabase_network_workspace` network, all-interface published ports, persistent writable volumes, and host bind mounts. This report is an ownership/topology assessment, not a database or security certification.

## Scope and repository state

- Docker context: `desktop-linux`; client/server both reported version 29.6.1.
- Initial branch: `main`; HEAD: `394d2ebb704e61b559f2f073063235ed7c6f843a`; initial working tree was clean.
- Required reports were present, except the requested B0 alias: the actual existing B0 report is `docs/SUPER_ADMIN_BACKEND_PHASE_B0_AUDIT.md`; `docs/SUPER_ADMIN_BACKEND_B0_AUDIT.md` does not exist.
- Inspected only the eleven explicitly named running `workspace` containers, their one positively identified network, and images referenced by those containers. No stopped-container enumeration occurred.
- The protected SA3.3F container/network were not inspected, queried by ID/name, started, stopped or otherwise touched.

## Exact read-only metadata commands

The following commands used Docker metadata APIs only. They did not execute a process inside a container, read logs, list environment values, access filesystems, connect to PostgreSQL, invoke Supabase, or modify state.

```text
docker context show
docker version --format 'client={{.Client.Version}} server={{.Server.Version}}'
docker inspect --format <field-only template> <each explicit workspace container name>
docker port <each explicit workspace container name>
docker network inspect --format <field-only template> supabase_network_workspace
docker image inspect --format <field-only template> <each image ID used by those containers>
```

The container templates requested IDs, state, image reference, selected non-sensitive labels, mounts, tmpfs, port bindings, security configuration, and network membership. They omitted `Config.Env`, logs, filesystem contents, database files and command arguments that could expose credentials. The first attempted composite template had a Docker template parsing error before returning container metadata; it made no state change. Corrected field-only queries produced the inventory below.

## Observed ownership and service inventory

Every inspected container was `running`, was created on 2026-10-09 between 14:52:18 and 14:52:46 UTC, and carries both:

```text
com.docker.compose.project=workspace
com.supabase.cli.project=workspace
```

| Service container | ID prefix | Image reference | Immutable image ID prefix |
|---|---:|---|---:|
| `supabase_studio_workspace` | `a74f3da68bbf` | `public.ecr.aws/supabase/studio:2026.06.15-sha-a412298` | `2fd70fa8c1f4` |
| `supabase_pg_meta_workspace` | `98d3afb2860c` | `public.ecr.aws/supabase/postgres-meta:v0.96.6` | `a84cc713585e` |
| `supabase_storage_workspace` | `d6c69d0f69f8` | `public.ecr.aws/supabase/storage-api:v1.60.20` | `21433097b2b1` |
| `supabase_rest_workspace` | `3feb24941492` | `public.ecr.aws/supabase/postgrest:v14.13` | `488093de8195` |
| `supabase_realtime_workspace` | `247b4e6e848c` | `public.ecr.aws/supabase/realtime:v2.107.5` | `86096c6d7fa` |
| `supabase_inbucket_workspace` | `9c9c7adcce8e` | `public.ecr.aws/supabase/mailpit:v1.22.3` | `f7f7c31de4de` |
| `supabase_auth_workspace` | `161f33a528b3` | `public.ecr.aws/supabase/gotrue:v2.190.0` | `f106c022ebb1` |
| `supabase_kong_workspace` | `72a3dcac9844` | `public.ecr.aws/supabase/kong:2.8.1` | `1b53405d8680` |
| `supabase_vector_workspace` | `9a83e1cad696` | `public.ecr.aws/supabase/vector:0.53.0-alpine` | `ca92d617e905` |
| `supabase_analytics_workspace` | `ab7f344187ab` | `public.ecr.aws/supabase/logflare:1.44.3` | `24479cdeba25` |
| `supabase_db_workspace` | `617bc30b56f5` | `public.ecr.aws/supabase/postgres:17.6.1.136` | `f371b5f3f2ac` |

Each inspected image was locally available by immutable ID and reported a corresponding `public.ecr.aws/supabase/...@sha256:...` repository digest. No image was pulled. Full digests are available from the command evidence but are omitted here because the image-ID prefixes above uniquely distinguish the locally inspected set for this report.

### Ownership conclusion

The matching names, project labels, service aliases, shared network, container IDs consistent with earlier SA2/SA3 reports, and image set provide strong current evidence that these are the ordinary persistent `workspace` development stack. This supports, but does not prove, the human/operator identity that owns the stack. It proves neither database contents nor that the stack was produced by a particular repository checkout.

The protected SA3.3F reports identify an entirely different resource family: a single `serveflow-sa33e-b88095f8-4d0-db` container and `serveflow-sa33e-b88095f8-4d0-net` network, labeled for run `b88095f8-4d02-4b40-8f19-edbb4043f42c`. Their documented IDs/names do not match any inspected resource. This is positive identity separation from SA3.3F without querying it.

## Network topology and exposure

All eleven inspected containers are attached to exactly one network:

| Network | ID prefix | Driver | Internal | Attachable | Ingress | IPAM |
|---|---:|---|---|---|---|---|
| `supabase_network_workspace` | `5b950c0d4ec7` | bridge | false | false | false | `172.18.0.0/16`, gateway `172.18.0.1` |

The network's Compose/Supabase CLI project labels are both `workspace`. Its membership contained exactly the eleven inspected workspace containers at inventory time. That establishes a coherent service topology, but `Internal=false` means this is not an internal-only network and does not provide the dedicated no-external-route isolation required by B1B.

The following ports are published on all IPv4 and IPv6 interfaces:

| Container | Container port | Host bindings |
|---|---|---|
| Studio | `3000/tcp` | `0.0.0.0:55323`, `[::]:55323` |
| Inbucket | `8025/tcp` | `0.0.0.0:55324`, `[::]:55324` |
| Kong/API | `8000/tcp` | `0.0.0.0:55321`, `[::]:55321` |
| Analytics | `4000/tcp` | `0.0.0.0:55327`, `[::]:55327` |
| PostgreSQL | `5432/tcp` | `0.0.0.0:55322`, `[::]:55322` |

The other six inspected service containers had no published host port. No network, host or database connectivity test was performed, so this metadata does not establish actual reachability from a LAN or internet source; it establishes configured all-interface Docker publication.

## Storage, mounts and security-relevant metadata

| Container | Observed host-backed/persistent storage | Consequence |
|---|---|---|
| Database | Writable local Docker volume `supabase_db_workspace` at `/var/lib/postgresql/data` | Persistent database storage; disqualifies it as a new ephemeral replay target. |
| Storage | Writable local Docker volume `supabase_storage_workspace` at `/mnt` | Persistent storage-service data. |
| Studio | Read-write bind `/workspace/supabase/snippets`; read-only bind `/workspace/supabase/functions`; writable Deno-cache volume `supabase_edge_runtime_workspace` | Host/repository-adjacent and persistent data are exposed to this service. |
| Vector | Read-only bind of `/var/run/docker.sock` | Docker-engine control-plane visibility is available to this container; even read-only, it is incompatible with the proposed isolated test boundary. |
| Other inspected services | No mounts reported | Absence of mounts does not establish an immutable root filesystem or an isolated system. |

No container reported tmpfs configuration. All reported `Privileged=false`, default/private IPC mode, no host PID mode, and no added/dropped capability lists. All reported `ReadonlyRootfs=false`; Vector additionally had `SecurityOpt=["label:disable"]`. These are descriptive metadata, not a full threat-model review. In particular, the Docker socket bind and writable host/persistent resources mean this stack must remain excluded from disposable migration testing.

## What this inventory does and does not prove

**Observed facts:** project labels, container and image identities, service states, one bridge network and its membership, published port configuration, and listed mounts/security fields as reported by Docker at inventory time.

**Supported conclusion:** the resources form the persistent local `workspace` Supabase development stack and are distinct from the documented SA3.3F resource family.

**Unknowns:** database schema/data/migration ledger; runtime application behavior; actual credentials; LAN/firewall reachability; why the workspace stack was started; external network traffic; complete Docker-host security; and the present state of protected SA3.3F resources. None was inspected or inferred.

## Remaining B1B blockers and required next authorization

This inventory reinforces the B1A/B1A.2 findings:

1. Do not reuse this persistent stack, its network, named volumes, binds, images by mutable tag, ports, credentials or project identity.
2. A new run must first create only fresh stopped resources with immutable image IDs, a unique run label, an internal nonattachable network, no published ports, no Docker socket/bind/named-volume reuse, explicitly disposable storage, and exact-ID cleanup.
3. Before any database-capable process starts, inspect those new resources by exact ID and fail closed on identity, port, mount, storage, credential-source or network mismatch.
4. Resolve SA3.3F's runtime tmpfs ambiguity using independent mount-namespace evidence in a separately authorized harmless inert run. Do not replace the runtime check with `HostConfig.Tmpfs` alone.
5. Design and review a full Supabase prerequisite bootstrap for Auth, Storage, Realtime, roles, extensions and migration ledger. The current inert harness has no database initialization or full 001–278 migration-replay path.
6. Only then authorize a separate database initialization/replay phase. Stop immediately if any pre-start or runtime isolation/storage check fails.

The recommended next phase is a source/design-only B1A.4 pre-write runner specification and test plan, or an explicitly authorized fresh stopped-resource preflight after that design is reviewed. Neither action authorizes database startup, SQL, migrations or B1B implementation.

## Final verification

No Docker resource was modified; no database, PostgreSQL, Supabase, SQL, migration, hosted resource, account, environment or protected SA3.3F resource was accessed or changed. No package was installed, and no commit, push or deployment occurred. `git diff --check` and final Git status are recorded after this report is written.

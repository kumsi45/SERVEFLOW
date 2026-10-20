# B1A.3A: running Supabase stack ownership assessment

## Result

**The listed `*_workspace` containers are documented as the ordinary persistent local development workspace stack, not the protected SA3.3F environment. They must not be used for B1B.** This conclusion is based on repository reports and configuration references only. No Docker command or service connection was made in this phase, so it is not a current runtime ownership certification.

## Scope and initial state

- Branch: `main`; HEAD: `81827d08c12bde8976fe4ed456cb0541ebb53c89`.
- Initial `git status --short` was clean.
- Read and preserved B1A.2, B1A, B1A.1, B0, SA3.3E and SA3.3F reports, relevant harness source, `supabase/config.toml`, and static repository references.
- No Docker, Supabase, PostgreSQL, SQL, migration, hosted, account, environment or system command was run. In particular, this phase did not inspect the listed containers, protected SA3.3F container/network, volumes, images, networks or any database service.

## Evidence from prior reports

### Protected SA3.3F resource

SA3.3E records one deliberately separate, run-labeled inert resource set:

| Item | Recorded identity |
|---|---|
| Run label family | `serveflow.sa33e` / run `b88095f8-4d02-4b40-8f19-edbb4043f42c` |
| Container name | `serveflow-sa33e-b88095f8-4d0-db` |
| Container ID | `cb93e8c11b46a5807997da7321bdd49876b4dadbb19ec9a0d6710103f5476f1f` |
| Network name | `serveflow-sa33e-b88095f8-4d0-net` |
| Network ID | `26b0f7d16fe814287101e86f5b85a63af9b10153fbea0a73e702196b1db8e04d` |

Its design used an internal, nonattachable bridge, no published host ports, no bind or Docker-volume mount, an inert `/bin/sh -c 'sleep infinity'` process, and configured tmpfs at `/sa33e` and `/tmp`. It was intentionally not a Supabase stack and had no database initialization or migration capability.

SA3.3F started that exact container once, failed closed after Docker reported empty runtime `Mounts` despite configured tmpfs, and issued an exact-ID stop. It records the container as stopped and retained, the network as retained, no PostgreSQL/SQL/migration execution, and no changes to persistent `workspace` resources. The protected resource names/IDs do not match the user-provided `supabase_*_workspace` names.

### Persistent workspace stack

Repository reports independently identify a persistent local Supabase stack whose project is `workspace`:

- SA3.3D says it was identifiable as project `workspace`, and that database, Auth, REST, Storage, Realtime, metadata, vector, Studio, Kong, Inbucket, analytics and a P3.2 Edge Runtime remained running.
- SA3.3C calls it the persistent `workspace` Supabase stack and records published ports `55321`–`55327`.
- SA2 says a read-only Docker inventory found persistent `workspace` services and a P3.2 Edge runtime, with ports exposed on all host interfaces; it explicitly says this is not a separate disposable SA2 baseline.
- Repository audit scripts refer directly to `supabase_db_workspace`, `supabase_edge_runtime_workspace`, and `supabase_network_workspace`, showing that `workspace` is the established local development/printer workspace naming convention. Those scripts are not evidence that the currently running containers have unchanged configuration or safe contents.

The supplied container names cover the expected application services from those reports: Studio, pg-meta, Storage, REST, Realtime, Inbucket, Auth, Kong, Vector, Analytics and PostgreSQL. The absence of the P3.2 Edge Runtime from the supplied list is not proof it is absent; this assessment did not run Docker inventory or inspect containers.

## Finding by requested question

| Question | Finding | Evidence strength |
|---|---|---|
| Are the listed containers associated with ordinary development? | **Yes, by documented naming and service inventory.** They match the persistent `workspace` Supabase stack described in SA2, SA3.3C and SA3.3D. | Strong repository-report evidence; not current live inspection. |
| Are they the SA3.3F environment? | **No.** SA3.3F has a single separately named `serveflow-sa33e-…-db` container and a `serveflow-sa33e-…-net` network, with exact nonmatching IDs. | Strong documented identity separation. |
| Could they be another environment? | Current container labels, compose/project labels, image digests, mount/network configuration, creation times and database identity were deliberately not inspected. Their exact present-day ownership/state therefore remains unverified. | Unknown at runtime. |
| Can the stack be used for B1B? | **No.** It is documented as persistent workspace infrastructure, not a new isolated disposable target. It also has historically exposed ports and lacks the new-run identity, pre-write isolation proof, safe storage proof and full-replay authorization. | Conclusive against use within B1B scope. |

`supabase/config.toml` only contains two Edge Function JWT settings. It does not establish a local project identity, compose ownership, current container labels, a safe full-stack bootstrap, or B1B isolation. The current inert harness uses a distinct `serveflow-sa33e-*` naming/label scheme and has no database replay branch.

## Evidence versus assumptions

**Evidence:** the historical report identities above; documented persistent-project name `workspace`; matching `supabase_*_workspace` service convention; the separate SA3.3F naming/ID family; and the absence of a full replay capability in the harness.

**Not inferred as fact:** that the currently observed containers retain the same IDs/configuration as earlier reports; their current network, ports, labels, mounts, volumes, database contents, exact start time or owner; whether an Edge Runtime is currently running; and whether any individual `workspace` container was recreated in the last six hours. The user's `docker ps` inventory is accepted as the current observation, but this phase did not independently query it.

## Evidence required for a safe ownership/isolation proof

A separately authorized read-only Docker assessment would need to collect, without connecting to a database:

1. Exact current container IDs, names, labels including Compose project/service labels, image digests, creation/start timestamps, command and healthcheck state.
2. Exact network IDs, members, internal/attachable settings and published-port bindings.
3. Mount/volume/bind identities and whether any volume is persistent or shared.
4. Docker context endpoint confirmation and a baseline of pre-existing container/network/volume IDs.
5. A comparison against the recorded SA3.3F exact IDs and run label, without inspecting or modifying the protected resources beyond what a separately approved ownership audit permits.

That evidence could identify the stack's current Docker ownership. It would still not make it eligible for B1B. B1B requires new resources with a fresh run ID, pre-start inspection, isolated network/storage/credential proof, a resolved runtime-tmpfs gate, a reviewed Supabase prerequisite bootstrap, and a separately authorized complete replay.

## Recommended next action

Do not use, attach to, or modify the `*_workspace` stack. The next safe action is a separately authorized **read-only Docker ownership and topology inventory** that explicitly excludes database connections and all mutations, then compare current metadata to the earlier report identities. After that, keep the workspace stack excluded and design a new create-inspect-start environment for B1B.

## Verification and final Git state

Static source/report inspection and `git diff --check` were used. No test, Docker, Supabase, PostgreSQL or migration command ran. `git diff --check` returned no errors. The only intended change is this new report; no prior report or working-tree change was overwritten.

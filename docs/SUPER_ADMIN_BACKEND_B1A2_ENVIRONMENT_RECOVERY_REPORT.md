# Super Admin backend B1A.2: local recovery and pre-write gate review

**Status: BLOCKED before recovery, Docker resource creation, or database execution.** Docker Desktop is installed but not running at the time of this audit. The configured local Linux-engine pipe is unavailable. Starting Desktop would change Windows/WSL/Docker state and may automatically resume existing containers, so the requested explicit confirmation gate applies. No recovery action was performed. The current harness remains an inert-resource safety harness, not a full Supabase replay runner; its runtime tmpfs discrepancy is unresolved.

## 1. Initial repository state and preserved evidence

- Initial branch: `main`; HEAD: `81827d08c12bde8976fe4ed456cb0541ebb53c89`; initial `git status --short` was empty.
- The requested B0 document exists as `docs/SUPER_ADMIN_BACKEND_PHASE_B0_AUDIT.md`. `docs/SUPER_ADMIN_BACKEND_B0_AUDIT.md` does **not** exist; no replacement was created. The B1A and B1A.1 reports and SA3.3E/SA3.3F reports exist at the requested paths. All prior reports were read and preserved.
- SHA-256 before this investigation: `supabase/audits/sa33c-fresh-install-verify.cjs` = `09AFEC3F82E01E13FF07B047F6E04D1F2099F58823F1806A43073E235FDB88D1`; `tests/unit/sa33e-harness-safety.test.ts` = `F6254A06964B05FB723B4388B64DD95CA446E7ED01A1053FF9C9C181E03C9B2F`. No harness or test edit was justified, so these are also the expected final hashes.
- The retained SA3.3F container/network are protected. Their historical identities appear in earlier reports, but this phase did not query either resource or use them as a target. The persistent `workspace` stack was not queried or used.

## 2. Read-only Docker/WSL findings

| Exact diagnostic command or method | Result | What it establishes |
|---|---|---|
| `docker --version` | Docker CLI 29.6.1 responded. | Client installed; says nothing about the engine. |
| `docker context show` | `desktop-linux`. | Active context name. |
| `docker context inspect <active-context> --format '{{json .Endpoints.docker.Host}}'` | Succeeded; endpoint scheme `npipe:`. The local pipe path was redacted in collected output. | A local Docker Desktop endpoint is configured; no remote target was selected. This is context metadata, not engine access. |
| `docker version --format 'client={{.Client.Version}} server={{.Server.Version}}'` | Client 29.6.1, no server version, exit **1**; the configured Docker Desktop Linux-engine named pipe was missing. | Engine unreachable at this time. |
| `Test-Path 'C:\Program Files\Docker\Docker\Docker Desktop.exe'` | `True`. | Desktop executable installed. |
| `Get-Service -Name com.docker.service` | `Stopped`, start type `Manual`. | Desktop service was not running. |
| `Get-Process -Name 'Docker Desktop','com.docker.backend','com.docker.service' -ErrorAction SilentlyContinue` | Zero matching processes. | No matching Desktop/backend process at this point in time. |
| `wsl --status` | Default distribution `docker-desktop`; default version 2. | WSL responds and is configured for version 2. |
| `wsl --list --verbose` | `docker-desktop` registered, `Stopped`, version 2. | A suitable Linux distribution is registered but was not running. |

**Fact:** the CLI's local pipe is absent while the Desktop service, Desktop processes and `docker-desktop` WSL distribution are stopped. **Supported immediate diagnosis:** Docker Desktop's Linux engine is not running, explaining the failed Docker API call. **Unknown:** why Desktop stopped and whether it would start successfully; no event log, Desktop settings, permission failure or startup attempt was examined. A context issue after engine startup is also untested. WSL 2 presence does not prove working Docker networking or storage. The historical SA3.3E/3.3F internal network and stopped container creation is evidence of past capability only, not current readiness.

No `docker ps`, `docker inspect` on a resource, `docker start`, Docker Desktop launch, WSL distribution launch, service action or configuration change occurred. No credential, token, password, secret file or connection string was read or printed.

### Proposed system-changing recovery action — **not performed**

In a **separately approved** step, an operator could launch the installed Docker Desktop application using its normal UI and wait for it to report a running Linux engine, then repeat only read-only context/version, service and WSL checks. Launching Desktop may start `com.docker.service`, the `docker-desktop` WSL distribution, networking, and containers that Desktop is configured to restart, including persistent local resources. Its exact effects on this machine are not established. Therefore this report does not authorize or perform the launch, service start, WSL start, context switch, reset, reinstall or settings change. Before any such action, the operator should review the expected auto-start behavior and explicitly approve the state change; afterward, verify resource identities without touching the protected SA3.3F objects.

## 3. Harness execution order and first-write boundary

The checked-in `supabase/audits/sa33c-fresh-install-verify.cjs` supports only `--check-source`, `--prepare-stopped`, `--start-verified`, `--stop-verified`, and `--cleanup-prepared` (source dispatch near its end). It does **not** contain a database initialization, Supabase platform bootstrap, SQL execution or migration replay command. The test `sa33e-harness-safety.test.ts` asserts this absence. The old unsafe `supabase start` database path was removed in SA3.3E because service startup preceded target/port validation.

For its **inert** path, preparation first checks migration source, local `npipe:`/`unix:` context, pre-existing container/network/volume ID inventory, and cached image identity. It generates a run UUID; creates only a new internal network and stopped container; inspects both by exact IDs; validates labels, immutable image ID, stopped state, disabled healthcheck, `/bin/sh -c 'sleep infinity'`, read-only root, dropped capabilities, no host ports/binds/devices/host aliases, exact tmpfs configuration, single internal network, no unrelated member and forbidden credential variables. It writes a manifest with `databaseInitializationAuthorized`, `sqlAuthorized` and `migrationExecutionAuthorized` all false. `--start-verified` rechecks context, exact resource/image identities and security fingerprints **before** `docker start` of that inert container. Post-start checks occur after start; stop/cleanup commands use manifest IDs and labels, reject changed identities and avoid wildcard/prune operations. This supports only the documented inert boundary. It does not establish a pre-write gate for a future database-capable process, because that process, storage initialization inputs, platform prerequisites and migration runner have not been designed or validated.

**Runtime storage failure:** in SA3.3F, pre-start `HostConfig.Tmpfs` named `/sa33e` and `/tmp`, but running `docker inspect` returned `Mounts=[]`. `validateStartedTarget` requires the two runtime `Mounts` entries and therefore failed closed; the exact inert container was stopped. The earlier report did not inspect the live mount namespace or prove how Docker Desktop reports tmpfs mounts. The actual root cause is **unknown**. A Docker API representation difference is a hypothesis, not proof that tmpfs existed. The passing mocked test supplies explicit tmpfs `Mounts` entries and thus cannot settle the real discrepancy. Replacing the runtime assertion with a check of `HostConfig.Tmpfs` alone would weaken the gate. No safe source-only correction to the validator follows from current evidence; no harness/test source was changed. A future separately gated inert test on **new** resources must independently verify mount filesystem type and destination from inside that container's namespace, correlate it with exact Docker ID/configuration, then prove no bind/volume or extra writable destination. If that cannot be shown, fail closed.

The full checked-in migration chain also requires actual Supabase objects: migration 001 references `auth.users`/`auth.uid()` and `pgcrypto`; migration 023 uses `storage.buckets`, `storage.objects` and `storage.foldername`; migration 149 and later migrations call Realtime functions; 276 depends on `auth.sessions`, `auth.mfa_factors` and JWT helpers. Plain PostgreSQL without compatible Auth/Storage/Realtime schemas, roles, extensions and functions would verify only a partial SQL subset. The current harness has no complete prerequisite bootstrap, migration ledger, or 001–278 replay path. SA2's selected-prerequisite checks do not fill that gap.

## 4. Readiness gates for a later phase

1. **Recovery approval and read-only confirmation:** explicitly approve a defined Docker Desktop launch, considering possible auto-restart of existing resources. Once performed by an authorized operator, confirm the same local context, reachable daemon, WSL state and resource baseline. Do not select hosted or persistent workspace endpoints.
2. **Design review before resource creation:** inventory exact cached image digests and Supabase prerequisite versions; specify a complete official-equivalent Auth/Storage/Realtime/roles/extensions/bootstrap and full migration ledger, exact runner/command sequence, credential sources and log sanitization. Prove any orchestrator can create stopped resources without database startup or host publication. No unreviewed `supabase start` fallback.
3. **Separate stopped-resource authorization:** create only new run-labeled containers/network/storage, record IDs before startup and inspect exact IDs, image, ports, mounts, Docker socket exposure, network/route, labels, credentials and cleanup scope. Exclude the retained SA3.3F and `workspace` resources.
4. **Separate inert runtime approval:** start only a new harmless process, prove actual tmpfs mount types/destinations, exclusive internal network membership, no host ports or external path, and exact fail-safe stop. Resolve the `Mounts=[]` ambiguity with independent evidence; a failed check prevents database startup.
5. **Separate database/replay approval:** design a new fail-closed pre-write gate for the database-capable process and all inputs. Only after all prior gates pass, initialize a fresh disposable target and replay **all** checked-in migrations in order. Record per-file hash, outcome and sanitized error; stop on first failure. B1A.2 provides no such approval.
6. **Post-replay evidence and cleanup:** verify ledger/final catalog, RLS/grants, platform authorization, tenant isolation and relevant Auth/Storage/Realtime behavior at the layer actually run. Revalidate exact run ID/labels before stopping/removing only newly created resources, then verify absence and unchanged pre-existing identities where safe read-only evidence is available.

**B1B prerequisite:** a separately authorized, successful full-schema isolated replay and security evidence. Neither Docker recovery alone nor passing mocked harness tests establishes it. B1B implementation remains out of scope.

## 5. Tests, changes and final safety status

| Check actually run | Result |
|---|---|
| `Get-FileHash -Algorithm SHA256` on the harness and focused test | PASS; hashes in section 1. |
| `node --check supabase/audits/sa33c-fresh-install-verify.cjs` | PASS, exit 0. |
| `node supabase/audits/sa33c-fresh-install-verify.cjs --check-source` | PASS, source-only, `databaseExecuted:false`, 278 contiguous migrations, set hash `2c42913b4332c6b530d5fcc6a2f349ad9580f2218ebc4723623bbee7c1fc7399`. |
| `./node_modules/.bin/vitest.cmd run tests/unit/sa33e-harness-safety.test.ts tests/unit/sa33c-migration-fix-source.test.ts --reporter=default` | PASS: 2 files, 22 tests; mocked Docker objects/source checks, no real runtime proof. |
| `git diff --check` | PASS: no errors. Git does not check untracked files; a separate read-only whitespace check found zero trailing-whitespace lines in this report. |

Final branch and HEAD remained `main` and `81827d08c12bde8976fe4ed456cb0541ebb53c89`. Final `git status --short` showed only `?? docs/SUPER_ADMIN_BACKEND_B1A2_ENVIRONMENT_RECOVERY_REPORT.md`. The harness and test hashes remained identical to section 1; no pre-existing work was overwritten.

No source, migration, harness, test, application, configuration or environment file was changed. This report is the sole intended B1A.2 change. No SQL/migration ran; no database or Supabase/PostgreSQL service was initialized, started or reset. No hosted service, account, Windows service, WSL configuration, Docker setting, printer resource, persistent `workspace` resource or retained SA3.3F resource was accessed or changed. No package installation, commit, push or deployment occurred.

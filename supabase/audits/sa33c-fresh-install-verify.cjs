/*
 * SA3.3E disposable migration harness safety boundary.
 *
 * --check-source is read-only.
 * --prepare-stopped creates stopped, inert Docker resources only.
 * --start-verified requires a preflight manifest and starts only its exact
 * container ID. The container command is `sleep infinity`; this file contains
 * no PostgreSQL initialization, SQL, migration, Supabase CLI, or hosted path.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const manifestSchema = 'serveflow.sa33e.preflight.v1';
const labelKey = 'serveflow.sa33e.disposable';
const databaseImageTag = 'public.ecr.aws/supabase/postgres:17.6.1.141';
const expectedHashes = {
  '015_phase4_function_execute_grant_hardening.sql': 'ec6dbcae2bdc6948dee9e60d5599495aa0963e49e55df1a15983b662970a4b7a',
  '028_owner_reports_settings_tables.sql': 'df7b9c731f631937ee6e08166827b97393d37e734a3e0019338f30afc62848e1',
};
const originalHashes = {
  '015_phase4_function_execute_grant_hardening.sql': 'd36c8fd0a8cb325d414a152365da6c7eced6da3ca77402846023888b01928f24',
  '028_owner_reports_settings_tables.sql': '5a855869cd4ccce2128fa3410f39d609625a927cc9480d17c68fb0317a280c73',
};
const forbiddenCredentialNames = /^(?:SUPABASE_ACCESS_TOKEN|SUPABASE_DB_URL|DATABASE_URL|DB_URL|PGPASSWORD|POSTGRES_PASSWORD|VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)$/i;
const forbiddenMountFragments = ['/var/run/docker.sock', '\\\\.\\pipe\\docker_engine'];
const protectedSa33fNames = new Set([
  'serveflow-sa33e-b88095f8-4d0-db',
  'serveflow-sa33e-b88095f8-4d0-net',
]);
const prestartGateOrder = Object.freeze([
  'configuration', 'target_identity', 'image_identity', 'network_isolation',
  'storage_and_restrictions', 'stopped_target_snapshot',
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function sha256(value) {
  const bytes = typeof value === 'string' ? value : JSON.stringify(stable(value));
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readMigration(name) {
  return fs.readFileSync(path.join(migrationsDir, name), 'utf8');
}

function migrationInventory() {
  return fs.readdirSync(migrationsDir)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .map((name) => ({ name, version: Number(name.match(/^(\d+)_/)[1]), sha256: sha256(readMigration(name)) }))
    .sort((a, b) => a.version - b.version || a.name.localeCompare(b.name));
}

function checkSource() {
  const inventory = migrationInventory();
  assert.equal(inventory.length, 278, 'Expected exactly 278 numbered migrations.');
  assert.deepEqual(inventory.map(({ version }) => version), Array.from({ length: 278 }, (_, index) => index + 1),
    'Migration versions must remain unique and gap-free from 001 through 278.');
  for (const [name, hash] of Object.entries(expectedHashes)) {
    assert.equal(sha256(readMigration(name)), hash, `${name} differs from the reviewed SA3.3C candidate.`);
  }
  const migration015 = readMigration('015_phase4_function_execute_grant_hardening.sql');
  assert.equal(migration015.split("to_regprocedure('public.rls_auto_enable()')").length - 1, 1);
  assert.match(migration015, /if\s+to_regprocedure\('public\.rls_auto_enable\(\)'\)\s+is not null then[\s\S]*?revoke all on function public\.rls_auto_enable\(\) from public;[\s\S]*?end if;/i);
  assert.doesNotMatch(migration015, /when\s+others|exception\s+when/i);
  const migration028 = readMigration('028_owner_reports_settings_tables.sql');
  const addDescription = /alter table public\.menu_items\s+add column if not exists description text;/i.exec(migration028);
  assert(addDescription && addDescription.index < migration028.indexOf('menu_items.description'));
  assert.doesNotMatch(addDescription[0], /not null|default/i);
  for (const name of ['054_restaurant_starter_templates_phase4d.sql', '055_menu_data_foundation_phase4d1.sql']) {
    assert.match(readMigration(name), /alter table public\.menu_items[\s\S]*?add column if not exists description text/i);
  }
  return {
    mode: 'source-only', databaseExecuted: false, migrationCount: inventory.length,
    range: [inventory[0].version, inventory.at(-1).version], migrationSetSha256: sha256(inventory),
    originalHashes, candidateHashes: expectedHashes,
  };
}

function requireId(value, description) {
  assert.equal(typeof value, 'string', `${description} ID is missing.`);
  assert.match(value, /^(?:sha256:)?[0-9a-f]{12,64}$/i, `${description} ID is malformed.`);
  return value;
}

function environmentNames(env = []) {
  assert(Array.isArray(env), 'Container environment data is missing.');
  return env.map((entry) => String(entry).split('=', 1)[0]);
}

function assertNoHostedFallback(plan, container) {
  assert.equal(plan.hostedFallback?.supabaseCliUsed, false, 'Supabase CLI fallback is forbidden.');
  assert.equal(plan.hostedFallback?.linkedProjectRead, false, 'Linked project fallback is forbidden.');
  assert.equal(plan.hostedFallback?.environmentFilesRead, false, 'Environment-file fallback is forbidden.');
  assert.deepEqual(plan.hostedFallback?.credentialSources, [], 'Hosted credential sources are forbidden.');
  for (const name of environmentNames(container.Config?.Env)) {
    assert(!forbiddenCredentialNames.test(name), `Hosted/database credential environment is forbidden: ${name}`);
  }
  assert(!JSON.stringify(container.Config?.Env || []).includes('supabase.co'), 'Hosted Supabase endpoints are forbidden.');
}

function containerSecuritySnapshot(container) {
  const host = container.HostConfig;
  assert(host && typeof host === 'object', 'Container HostConfig data is missing.');
  assert(container.Config && typeof container.Config === 'object', 'Container Config data is missing.');
  assert(container.NetworkSettings && typeof container.NetworkSettings === 'object', 'Container network data is missing.');
  assert(Array.isArray(container.Mounts), 'Container mount data is missing.');
  return {
    id: requireId(container.Id, 'Container'), name: container.Name, image: requireId(container.Image, 'Image'),
    labels: container.Config.Labels || {}, command: container.Config.Cmd || [], entrypoint: container.Config.Entrypoint || [],
    user: container.Config.User || '', healthcheck: container.Config.Healthcheck || null,
    environmentSha256: sha256(container.Config.Env || []),
    readonlyRootfs: host.ReadonlyRootfs, privileged: host.Privileged,
    capAdd: host.CapAdd || [], capDrop: host.CapDrop || [], securityOpt: host.SecurityOpt || [],
    portBindings: host.PortBindings || {}, publishAllPorts: host.PublishAllPorts,
    binds: host.Binds || [], mounts: container.Mounts, tmpfs: host.Tmpfs || {}, devices: host.Devices || [],
    networkMode: host.NetworkMode, networks: Object.keys(container.NetworkSettings.Networks || {}).sort(),
    extraHosts: host.ExtraHosts || [], links: host.Links || [], restartPolicy: host.RestartPolicy || {},
  };
}

function networkSecuritySnapshot(network) {
  assert(network && typeof network === 'object', 'Network inspection data is missing.');
  return {
    id: requireId(network.Id, 'Network'), name: network.Name, driver: network.Driver,
    internal: network.Internal, attachable: network.Attachable, ingress: network.Ingress,
    labels: network.Labels || {}, options: network.Options || {},
    members: Object.keys(network.Containers || {}).sort(),
  };
}

function validateStoppedTarget({ plan, container, network, image, persistent }) {
  assert(plan && typeof plan === 'object', 'Disposable plan is missing.');
  assert(persistent && Array.isArray(persistent.containerIds) && Array.isArray(persistent.networkIds)
    && Array.isArray(persistent.volumeNames), 'Persistent resource inventory is missing.');
  requireId(plan.imageId, 'Planned image');
  requireId(image?.Id, 'Inspected image');
  assert.equal(image.Id, plan.imageId, 'Image identity changed.');
  assert(!image.Config?.Volumes || Object.keys(image.Config.Volumes).length === 0,
    'Images with declared writable volumes are forbidden.');
  const c = containerSecuritySnapshot(container);
  const n = networkSecuritySnapshot(network);
  assert(!persistent.containerIds.includes(c.id), 'A persistent container ID cannot be reused.');
  assert(!persistent.networkIds.includes(n.id), 'A pre-existing network cannot be reused.');
  assert.equal(c.id, plan.containerId, 'Container ID differs from the created resource.');
  assert.equal(n.id, plan.networkId, 'Network ID differs from the created resource.');
  assert.equal(c.name, `/${plan.names.container}`, 'Container name mismatch.');
  assert.equal(n.name, plan.names.network, 'Network name mismatch.');
  assert.equal(c.image, plan.imageId, 'Container image identity mismatch.');
  assert.equal(container.State?.Running, false, 'Preflight requires a stopped container.');
  assert(['created', 'exited'].includes(container.State?.Status), 'Container state is not safely stopped.');
  assert.equal(c.labels[labelKey], plan.runId, 'Container disposable label mismatch.');
  assert.equal(n.labels[labelKey], plan.runId, 'Network disposable label mismatch.');
  assert.equal(n.driver, 'bridge');
  assert.equal(n.internal, true, 'Network must be internal.');
  assert.equal(n.attachable, false, 'Network must not be attachable.');
  assert.equal(n.ingress, false, 'Ingress networks are forbidden.');
  assert.deepEqual(c.portBindings, {}, 'All host port bindings are forbidden.');
  assert.equal(c.publishAllPorts, false, 'Automatic host port publication is forbidden.');
  assert.equal(c.readonlyRootfs, true, 'Container root filesystem must be read-only.');
  assert.equal(c.privileged, false, 'Privileged containers are forbidden.');
  assert.deepEqual(c.capAdd, [], 'Added Linux capabilities are forbidden.');
  assert(c.capDrop.map(String).includes('ALL'), 'All Linux capabilities must be dropped.');
  assert(c.securityOpt.map(String).some((value) => value.includes('no-new-privileges')),
    'no-new-privileges is required.');
  assert.deepEqual(c.binds, [], 'Bind mounts are forbidden.');
  assert(c.mounts.every((mount) => mount.Type === 'tmpfs'), 'Only tmpfs mounts are permitted.');
  assert.deepEqual(Object.keys(c.tmpfs).sort(), ['/sa33e', '/tmp'], 'Exact disposable tmpfs mounts are required.');
  assert(Object.values(c.tmpfs).every((options) => /\bnosuid\b/.test(options) && /\bnodev\b/.test(options)),
    'tmpfs mounts require nosuid and nodev.');
  assert.deepEqual(c.devices, [], 'Host devices are forbidden.');
  assert.equal(c.networkMode, plan.names.network, 'Container network mode mismatch.');
  assert.deepEqual(c.networks, [plan.names.network], 'Unexpected network membership.');
  assert(n.members.every((id) => id === c.id), 'Dedicated network contains an unexpected container.');
  assert.deepEqual(c.extraHosts, [], 'Host aliases and host-gateway routes are forbidden.');
  assert.deepEqual(c.links, [], 'Container links are forbidden.');
  assert.equal(c.restartPolicy.Name || '', 'no', 'Automatic restart is forbidden.');
  assert.deepEqual(c.entrypoint, ['/bin/sh']);
  assert.deepEqual(c.command, ['-c', 'sleep infinity'], 'Stopped target must remain inert before later initialization approval.');
  assert.equal(c.user, 'postgres');
  assert.deepEqual(c.healthcheck?.Test, ['NONE'], 'Image healthchecks must be disabled for the inert start gate.');
  const mountText = JSON.stringify({ binds: c.binds, mounts: c.mounts, tmpfs: c.tmpfs }).toLowerCase();
  for (const fragment of forbiddenMountFragments) assert(!mountText.includes(fragment.toLowerCase()), `Forbidden mount: ${fragment}`);
  assertNoHostedFallback(plan, container);
  return { container: c, network: n };
}

// This gate intentionally consumes supplied inspection snapshots only.  It never
// calls Docker, starts a container, writes data, or invokes supplied callbacks.
function validatePrestartConfiguration(input) {
  assert(input && typeof input === 'object', 'Pre-start input is missing.');
  const { plan, persistent } = input;
  assert(plan && typeof plan === 'object', 'Disposable plan is missing.');
  assert.match(plan.runId || '', /^[0-9a-f-]{36}$/i, 'Pre-start run ID is malformed.');
  assert(plan.names && typeof plan.names.container === 'string' && typeof plan.names.network === 'string',
    'Pre-start resource names are missing.');
  assert.equal(typeof plan.imageRef, 'string', 'Explicit image reference is required.');
  assert(plan.imageRef.length > 0, 'Explicit image reference is required.');
  assert(persistent && Array.isArray(persistent.containerIds) && Array.isArray(persistent.networkIds)
    && Array.isArray(persistent.volumeNames), 'Persistent resource inventory is missing.');
}

function validatePrestartTargetIdentity({ plan, persistent }) {
  assert.notEqual(plan.containerId, plan.networkId, 'Container and network identities must be distinct.');
  for (const name of [plan.names.container, plan.names.network]) {
    assert(!/^supabase_.*_workspace$/i.test(name), 'Persistent workspace resource names are forbidden.');
    assert(!protectedSa33fNames.has(name), 'Protected SA3.3F resource identity is forbidden.');
  }
  assert(!persistent.containerIds.includes(plan.containerId), 'A persistent container ID cannot be adopted.');
  assert(!persistent.networkIds.includes(plan.networkId), 'A persistent network ID cannot be adopted.');
}

function validatePrestartImageIdentity({ plan, image }) {
  requireId(plan.imageId, 'Planned image');
  requireId(image?.Id, 'Inspected image');
  assert.equal(image.Id, plan.imageId, 'Image identity changed.');
  assert(!image.Config?.Volumes || Object.keys(image.Config.Volumes).length === 0,
    'Images with declared writable volumes are forbidden.');
}

function validatePrestartNetworkIsolation({ plan, network }) {
  const n = networkSecuritySnapshot(network);
  assert.equal(n.id, plan.networkId, 'Network ID differs from the created resource.');
  assert.equal(n.name, plan.names.network, 'Network name mismatch.');
  assert.equal(n.driver, 'bridge');
  assert.equal(n.internal, true, 'Network must be internal.');
  assert.equal(n.attachable, false, 'Network must not be attachable.');
  assert.equal(n.ingress, false, 'Ingress networks are forbidden.');
}

function validatePrestartStorageAndRestrictions({ plan, container }) {
  const c = containerSecuritySnapshot(container);
  assert.equal(c.id, plan.containerId, 'Container ID differs from the created resource.');
  assert.equal(c.name, `/${plan.names.container}`, 'Container name mismatch.');
  assert.deepEqual(c.binds, [], 'Bind mounts are forbidden.');
  assert(c.mounts.every((mount) => mount.Type === 'tmpfs'), 'Only tmpfs mounts are permitted.');
  assert.deepEqual(Object.keys(c.tmpfs).sort(), ['/sa33e', '/tmp'], 'Exact disposable tmpfs mounts are required.');
  assert(Object.values(c.tmpfs).every((options) => /\bnosuid\b/.test(options) && /\bnodev\b/.test(options)),
    'tmpfs mounts require nosuid and nodev.');
  assert.deepEqual(c.portBindings, {}, 'All host port bindings are forbidden.');
  assert.equal(c.publishAllPorts, false, 'Automatic host port publication is forbidden.');
  assertNoHostedFallback(plan, container);
}

function evaluatePrestartGate(input) {
  const stages = {
    configuration: () => validatePrestartConfiguration(input),
    target_identity: () => validatePrestartTargetIdentity(input),
    image_identity: () => validatePrestartImageIdentity(input),
    network_isolation: () => validatePrestartNetworkIsolation(input),
    storage_and_restrictions: () => validatePrestartStorageAndRestrictions(input),
    stopped_target_snapshot: () => validateStoppedTarget(input),
  };
  const passed = [];
  for (const stage of prestartGateOrder) {
    try {
      stages[stage]();
      passed.push(stage);
    } catch {
      return Object.freeze({ ok: false, decision: 'PRESTART_REJECTED', passed, failed: stage,
        message: 'Pre-start validation rejected the proposed target.', startupAuthorized: false,
        writeAuthorized: false, runtimeStorageVerified: false });
    }
  }
  return Object.freeze({ ok: true, decision: 'PRESTART_VALIDATED_NO_STARTUP', passed, failed: null,
    message: 'Pre-start validation is complete; inert runtime storage validation remains required.',
    startupAuthorized: false, writeAuthorized: false, runtimeStorageVerified: false });
}

function runPrestartGate(input, _callbacks = {}) {
  // Deliberately do not call callbacks. A later, separately authorized executor
  // must revalidate the exact target before any inert start or write action.
  return evaluatePrestartGate(input);
}

function buildManifest({ plan, container, network, image, persistent, repository }) {
  const verified = validateStoppedTarget({ plan, container, network, image, persistent });
  return {
    schema: manifestSchema, runId: plan.runId, createdAt: plan.createdAt,
    decision: 'PREFLIGHT_PASS_STOPPED_RESOURCES_ONLY', dockerContext: plan.dockerContext,
    hostedFallback: plan.hostedFallback,
    resources: {
      container: { id: verified.container.id, name: plan.names.container, imageId: plan.imageId,
        securitySha256: sha256(verified.container), expectedState: 'stopped' },
      network: { id: verified.network.id, name: plan.names.network,
        securitySha256: sha256(verified.network), internal: true },
      volumes: [], storage: { kind: 'tmpfs', destinations: ['/sa33e', '/tmp'] },
    },
    persistentSnapshot: {
      containerIds: [...persistent.containerIds].sort(), networkIds: [...persistent.networkIds].sort(),
      volumeNames: [...persistent.volumeNames].sort(), sha256: sha256(persistent),
    },
    repository,
    startGate: { command: 'sleep infinity', databaseInitializationAuthorized: false,
      sqlAuthorized: false, migrationExecutionAuthorized: false },
    cleanup: { containerIds: [verified.container.id], networkIds: [verified.network.id], volumeNames: [] },
  };
}

function validateManifest(manifest) {
  assert(manifest && typeof manifest === 'object', 'Preflight manifest is missing.');
  assert.equal(manifest.schema, manifestSchema, 'Preflight manifest schema is invalid.');
  assert.match(manifest.runId || '', /^[0-9a-f-]{36}$/i, 'Preflight run ID is malformed.');
  assert.equal(manifest.decision, 'PREFLIGHT_PASS_STOPPED_RESOURCES_ONLY');
  assert.equal(manifest.hostedFallback?.supabaseCliUsed, false);
  assert.equal(manifest.hostedFallback?.linkedProjectRead, false);
  assert.deepEqual(manifest.hostedFallback?.credentialSources, []);
  requireId(manifest.resources?.container?.id, 'Manifest container');
  requireId(manifest.resources?.container?.imageId, 'Manifest image');
  requireId(manifest.resources?.network?.id, 'Manifest network');
  assert.match(manifest.resources.container.securitySha256 || '', /^[0-9a-f]{64}$/);
  assert.match(manifest.resources.network.securitySha256 || '', /^[0-9a-f]{64}$/);
  assert.deepEqual(manifest.resources.volumes, []);
  assert.equal(manifest.startGate?.databaseInitializationAuthorized, false);
  assert.equal(manifest.startGate?.sqlAuthorized, false);
  assert.equal(manifest.startGate?.migrationExecutionAuthorized, false);
  assert.deepEqual(manifest.cleanup?.containerIds, [manifest.resources.container.id]);
  assert.deepEqual(manifest.cleanup?.networkIds, [manifest.resources.network.id]);
  assert.deepEqual(manifest.cleanup?.volumeNames, []);
  return manifest;
}

function verifyStartGate({ manifest, container, network, image }) {
  validateManifest(manifest);
  const plan = {
    runId: manifest.runId, imageId: manifest.resources.container.imageId,
    containerId: manifest.resources.container.id, networkId: manifest.resources.network.id,
    names: { container: manifest.resources.container.name, network: manifest.resources.network.name },
    hostedFallback: manifest.hostedFallback,
  };
  const verified = validateStoppedTarget({ plan, container, network, image, persistent: manifest.persistentSnapshot });
  assert.equal(sha256(verified.container), manifest.resources.container.securitySha256,
    'Container security configuration changed after preflight.');
  assert.equal(sha256(verified.network), manifest.resources.network.securitySha256,
    'Network security configuration changed after preflight.');
  return { decision: 'START_APPROVED_FOR_EXACT_INERT_CONTAINER', containerId: verified.container.id,
    networkId: verified.network.id, checkedAt: new Date().toISOString() };
}

function validateStartedTarget({ manifest, container, network, image }) {
  validateManifest(manifest);
  const expectedContainer = manifest.resources.container;
  const expectedNetwork = manifest.resources.network;
  assert.equal(container.Id, expectedContainer.id, 'Started container identity changed.');
  assert.equal(container.Image, expectedContainer.imageId, 'Started image identity changed.');
  assert.equal(image?.Id, expectedContainer.imageId, 'Inspected image identity changed.');
  assert.equal(container.Name, `/${expectedContainer.name}`, 'Started container name changed.');
  assert.equal(container.Config?.Labels?.[labelKey], manifest.runId, 'Started container label changed.');
  assert.equal(container.State?.Running, true, 'Expected exact inert container to be running.');
  assert.deepEqual(container.Config?.Entrypoint || [], ['/bin/sh']);
  assert.deepEqual(container.Config?.Cmd || [], ['-c', 'sleep infinity']);
  assert.equal(container.Config?.User, 'postgres');
  assert.deepEqual(container.Config?.Healthcheck?.Test, ['NONE'], 'Image healthcheck became active after start.');
  assertNoHostedFallback(manifest, container);
  const host = container.HostConfig;
  assert(host && typeof host === 'object', 'Started HostConfig data is missing.');
  assert.deepEqual(host.PortBindings || {}, {}, 'Host port binding appeared after start.');
  assert.equal(host.PublishAllPorts, false, 'Automatic port publication appeared after start.');
  assert.deepEqual(host.Binds || [], [], 'Bind mount appeared after start.');
  assert.equal(host.ReadonlyRootfs, true);
  assert.equal(host.Privileged, false);
  assert.deepEqual(host.CapAdd || [], []);
  assert((host.CapDrop || []).map(String).includes('ALL'));
  assert((host.SecurityOpt || []).map(String).some((value) => value.includes('no-new-privileges')));
  assert.deepEqual(host.Devices || [], []);
  assert.deepEqual(host.ExtraHosts || [], []);
  assert.equal(host.NetworkMode, expectedNetwork.name);
  assert.deepEqual(Object.keys(host.Tmpfs || {}).sort(), ['/sa33e', '/tmp']);
  assert(Array.isArray(container.Mounts), 'Started mount data is missing.');
  assert(container.Mounts.every((mount) => mount.Type === 'tmpfs'), 'Non-tmpfs mount appeared after start.');
  assert.deepEqual(container.Mounts.map((mount) => mount.Destination).sort(), ['/sa33e', '/tmp']);
  assert.deepEqual(Object.keys(container.NetworkSettings?.Networks || {}), [expectedNetwork.name]);
  const n = networkSecuritySnapshot(network);
  assert.equal(n.id, expectedNetwork.id, 'Started network identity changed.');
  assert.equal(n.name, expectedNetwork.name);
  assert.equal(n.internal, true);
  assert.equal(n.attachable, false);
  assert.equal(n.ingress, false);
  assert.deepEqual(n.members, [expectedContainer.id], 'Unexpected network membership appeared after start.');
  return { decision: 'POST_START_INERT_RESOURCE_VERIFIED', containerId: expectedContainer.id, networkId: expectedNetwork.id };
}

function exactCleanupCommands(manifest, { container, network }) {
  validateManifest(manifest);
  assert.equal(container.Id, manifest.resources.container.id, 'Cleanup container identity changed.');
  assert.equal(network.Id, manifest.resources.network.id, 'Cleanup network identity changed.');
  assert.equal(container.Config?.Labels?.[labelKey], manifest.runId, 'Cleanup container label mismatch.');
  assert.equal(network.Labels?.[labelKey], manifest.runId, 'Cleanup network label mismatch.');
  return [
    ['container', 'rm', manifest.resources.container.id],
    ['network', 'rm', manifest.resources.network.id],
  ];
}

function docker(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0 && !options.allowFailure) throw new Error(`docker ${args[0]} failed: ${result.stderr || result.stdout}`);
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function dockerJson(args) {
  return JSON.parse(docker(args).stdout);
}

function inspectExact(id) {
  const items = dockerJson(['inspect', id]);
  assert.equal(items.length, 1, `Expected one Docker resource for ${id}.`);
  return items[0];
}

function dockerIds(args) {
  return docker(args).stdout.trim().split(/\s+/).filter(Boolean);
}

function persistentInventory() {
  return {
    containerIds: dockerIds(['ps', '-aq']), networkIds: dockerIds(['network', 'ls', '-q']),
    volumeNames: dockerIds(['volume', 'ls', '-q']),
  };
}

function localDockerContext() {
  const name = docker(['context', 'show']).stdout.trim();
  const context = dockerJson(['context', 'inspect', name])[0];
  const endpoint = context?.Endpoints?.docker?.Host;
  assert(/^(?:npipe|unix):/.test(endpoint || ''), 'Remote Docker contexts are forbidden.');
  return { name, endpoint };
}

function absoluteEvidenceRoot() {
  const candidates = [os.tmpdir(), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Temp')]
    .filter(Boolean);
  const selected = candidates.find((candidate) => path.isAbsolute(candidate));
  assert(selected, 'No absolute OS temporary directory is available.');
  const resolved = path.resolve(selected);
  assert(!resolved.toLowerCase().startsWith((root + path.sep).toLowerCase()),
    'Evidence directory must be outside the repository.');
  assert(fs.existsSync(resolved) && fs.statSync(resolved).isDirectory(), 'Absolute OS temporary directory is unavailable.');
  return resolved;
}

function prepareStoppedResources() {
  assert(process.argv.includes('--confirm-stopped-resource-creation'),
    'Stopped resource creation requires --confirm-stopped-resource-creation.');
  const source = checkSource();
  const context = localDockerContext();
  const persistent = persistentInventory();
  const image = dockerJson(['image', 'inspect', databaseImageTag])[0];
  requireId(image?.Id, 'Database image');
  const runId = crypto.randomUUID();
  const prefix = `serveflow-sa33e-${runId.slice(0, 12)}`;
  const names = { network: `${prefix}-net`, container: `${prefix}-db` };
  const evidenceDir = fs.mkdtempSync(path.join(absoluteEvidenceRoot(), `${prefix}-evidence-`));
  const plan = {
    runId, createdAt: new Date().toISOString(), imageRef: databaseImageTag, imageId: image.Id, names, dockerContext: context,
    hostedFallback: { supabaseCliUsed: false, linkedProjectRead: false, environmentFilesRead: false, credentialSources: [] },
  };
  let networkId;
  let containerId;
  try {
    networkId = docker(['network', 'create', '--driver', 'bridge', '--internal', '--label', `${labelKey}=${runId}`, names.network]).stdout.trim();
    requireId(networkId, 'Created network');
    containerId = docker(['create', '--name', names.container, '--label', `${labelKey}=${runId}`,
      '--network', names.network, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--no-healthcheck',
      '--user', 'postgres', '--tmpfs', '/sa33e:rw,nosuid,nodev,noexec,size=1024m,mode=0700',
      '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777', '--entrypoint', '/bin/sh', image.Id,
      '-c', 'sleep infinity']).stdout.trim();
    requireId(containerId, 'Created container');
    plan.networkId = networkId;
    plan.containerId = containerId;
    const manifest = buildManifest({ plan, container: inspectExact(containerId), network: inspectExact(networkId), image,
      persistent, repository: { migrationCount: source.migrationCount, migrationSetSha256: source.migrationSetSha256,
        migrations: migrationInventory() } });
    const manifestPath = path.join(evidenceDir, 'preflight-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`PREFLIGHT PASS. Resources remain stopped. Manifest: ${manifestPath}`);
  } catch (error) {
    if (containerId) {
      const current = inspectExact(containerId);
      if (current.Id === containerId && current.Config?.Labels?.[labelKey] === runId && !current.State?.Running) {
        docker(['container', 'rm', containerId]);
      }
    }
    if (networkId) {
      const current = inspectExact(networkId);
      if (current.Id === networkId && current.Labels?.[labelKey] === runId) docker(['network', 'rm', networkId]);
    }
    throw error;
  }
}

function readManifestArgument() {
  const index = process.argv.indexOf('--manifest');
  assert(index >= 0 && process.argv[index + 1], 'Pass --manifest <absolute-path>.');
  assert(path.isAbsolute(process.argv[index + 1]), 'Manifest path must be absolute.');
  const manifestPath = path.resolve(process.argv[index + 1]);
  return { manifestPath, manifest: validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))) };
}

function startVerifiedResources() {
  assert(process.argv.includes('--confirm-start-verified-resources'),
    'Start gate requires --confirm-start-verified-resources.');
  const { manifestPath, manifest } = readManifestArgument();
  const context = localDockerContext();
  assert.deepEqual(context, manifest.dockerContext, 'Docker context changed after preflight.');
  const image = dockerJson(['image', 'inspect', manifest.resources.container.imageId])[0];
  const decision = verifyStartGate({ manifest, container: inspectExact(manifest.resources.container.id),
    network: inspectExact(manifest.resources.network.id), image });
  docker(['start', decision.containerId]);
  const decisionPath = path.join(path.dirname(manifestPath), 'start-decision.json');
  let postStart;
  try {
    postStart = validateStartedTarget({ manifest, container: inspectExact(decision.containerId),
      network: inspectExact(manifest.resources.network.id), image });
  } catch (error) {
    const stopped = docker(['stop', '--time', '1', decision.containerId], { allowFailure: true });
    fs.writeFileSync(decisionPath, JSON.stringify({ ...decision, result: 'POST_START_REJECTED',
      error: error.message, exactStopStatus: stopped.status, databaseInitialized: false,
      sqlExecuted: false, migrationsExecuted: false }, null, 2));
    throw error;
  }
  fs.writeFileSync(decisionPath, JSON.stringify({ ...decision, postStart, result: 'STARTED_INERT_CONTAINER_ONLY',
    databaseInitialized: false, sqlExecuted: false, migrationsExecuted: false }, null, 2));
  console.log(`START GATE PASS. Inert container only. Decision: ${decisionPath}`);
}

function stopVerifiedResources() {
  assert(process.argv.includes('--confirm-stop-verified-resources'),
    'Stop gate requires --confirm-stop-verified-resources.');
  const { manifestPath, manifest } = readManifestArgument();
  const context = localDockerContext();
  assert.deepEqual(context, manifest.dockerContext, 'Docker context changed after preflight.');
  const image = dockerJson(['image', 'inspect', manifest.resources.container.imageId])[0];
  validateStartedTarget({ manifest, container: inspectExact(manifest.resources.container.id),
    network: inspectExact(manifest.resources.network.id), image });
  docker(['stop', '--time', '1', manifest.resources.container.id]);
  const after = inspectExact(manifest.resources.container.id);
  assert.equal(after.Id, manifest.resources.container.id);
  assert.equal(after.State?.Running, false, 'Exact inert container did not stop.');
  assert.equal(after.Config?.Labels?.[labelKey], manifest.runId);
  const decisionPath = path.join(path.dirname(manifestPath), 'stop-decision.json');
  fs.writeFileSync(decisionPath, JSON.stringify({ decision: 'EXACT_INERT_CONTAINER_STOPPED',
    containerId: after.Id, stoppedAt: new Date().toISOString(), databaseInitialized: false,
    sqlExecuted: false, migrationsExecuted: false }, null, 2));
  console.log(`STOP GATE PASS. Exact inert container stopped. Decision: ${decisionPath}`);
}

function cleanupPreparedResources() {
  assert(process.argv.includes('--confirm-exact-cleanup'), 'Cleanup requires --confirm-exact-cleanup.');
  const { manifest } = readManifestArgument();
  const container = inspectExact(manifest.resources.container.id);
  assert.equal(container.State?.Running, false, 'Cleanup refuses a running container. Stop authorization is separate.');
  const network = inspectExact(manifest.resources.network.id);
  for (const args of exactCleanupCommands(manifest, { container, network })) docker(args);
  console.log('Exact stopped-resource cleanup completed.');
}

if (require.main === module) {
  try {
    if (process.argv.includes('--check-source')) console.log(JSON.stringify(checkSource(), null, 2));
    else if (process.argv.includes('--prepare-stopped')) prepareStoppedResources();
    else if (process.argv.includes('--start-verified')) startVerifiedResources();
    else if (process.argv.includes('--stop-verified')) stopVerifiedResources();
    else if (process.argv.includes('--cleanup-prepared')) cleanupPreparedResources();
    else throw new Error('Choose --check-source, --prepare-stopped, --start-verified, --stop-verified, or --cleanup-prepared.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  buildManifest, checkSource, containerSecuritySnapshot, exactCleanupCommands, expectedHashes,
  evaluatePrestartGate, manifestSchema, migrationInventory, networkSecuritySnapshot, originalHashes, prestartGateOrder, runPrestartGate, sha256,
  validateManifest, validateStartedTarget, validateStoppedTarget, verifyStartGate,
};

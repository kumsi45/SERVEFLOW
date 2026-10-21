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
const lifecycleAuthorizationSchema = 'serveflow.sa33e.lifecycle-authorization.v1';

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

function requireImageDigest(value, description) {
  assert.equal(typeof value, 'string', `${description} image digest is missing.`);
  assert.match(value, /^sha256:[0-9a-f]{64}$/i, `${description} image digest is malformed.`);
  return value;
}

function validateEnvironment(env) {
  assert(Array.isArray(env), 'Environment metadata is missing.');
  const seen = new Set();
  for (const entry of env) {
    assert.equal(typeof entry, 'string', 'Environment entry is malformed.');
    const separator = entry.indexOf('=');
    assert(separator > 0, 'Environment entry is malformed.');
    const name = entry.slice(0, separator);
    assert.match(name, /^[A-Za-z_][A-Za-z0-9_]*$/, 'Environment name is malformed.');
    assert(!seen.has(name.toUpperCase()), 'Duplicate environment name is forbidden.');
    seen.add(name.toUpperCase());
    assert(!forbiddenCredentialNames.test(name), `Hosted/database credential environment is forbidden: ${name}`);
    assert(!entry.toLowerCase().includes('supabase.co'), 'Hosted Supabase endpoints are forbidden.');
  }
  return env;
}

function assertNoHostedFallback(plan, container) {
  assert.equal(plan.hostedFallback?.supabaseCliUsed, false, 'Supabase CLI fallback is forbidden.');
  assert.equal(plan.hostedFallback?.linkedProjectRead, false, 'Linked project fallback is forbidden.');
  assert.equal(plan.hostedFallback?.environmentFilesRead, false, 'Environment-file fallback is forbidden.');
  assert.deepEqual(plan.hostedFallback?.credentialSources, [], 'Hosted credential sources are forbidden.');
  validateEnvironment(container.Config?.Env);
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
  const imageEnv = validateEnvironment(image.Config?.Env);
  const containerEnv = validateEnvironment(container.Config?.Env);
  assert(sha256(containerEnv) === sha256(imageEnv),
    'Created container environment differs from the inspected image environment.');
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

function validatePreparationIdentity({ plan, persistent }) {
  for (const name of [plan.names.container, plan.names.network]) {
    assert(!/^supabase_.*_workspace$/i.test(name), 'Persistent workspace resource names are forbidden.');
    assert(!protectedSa33fNames.has(name), 'Protected SA3.3F resource identity is forbidden.');
  }
  assert(!persistent.containerIds.includes(plan.containerId), 'A persistent container ID cannot be adopted.');
  assert(!persistent.networkIds.includes(plan.networkId), 'A persistent network ID cannot be adopted.');
}

function validatePrestartImageIdentity({ plan, image }) {
  requireImageDigest(plan.imageId, 'Planned');
  requireImageDigest(image?.Id, 'Inspected');
  assert.equal(image.Id, plan.imageId, 'Image identity changed.');
  assert(!image.Config?.Volumes || Object.keys(image.Config.Volumes).length === 0,
    'Images with declared writable volumes are forbidden.');
  validateEnvironment(image.Config?.Env);
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

function lifecycleTargetBinding(input) {
  assert(input && typeof input === 'object', 'Lifecycle target input is missing.');
  return sha256({ plan: input.plan, container: input.container, network: input.network, image: input.image,
    persistent: input.persistent });
}

function preparationBinding({ plan, image, persistent }) {
  return sha256({ plan, image: { Id: image?.Id, RepoDigests: image?.RepoDigests || [], Volumes: image?.Config?.Volumes,
    Env: image?.Config?.Env }, persistent,
    commands: preparationCommands(plan) });
}

function preparationCommands(plan) {
  return {
    network: ['network', 'create', '--driver', 'bridge', '--internal', '--label', `${labelKey}=${plan.runId}`, plan.names.network],
    container: ['create', '--name', plan.names.container, '--label', `${labelKey}=${plan.runId}`,
      '--network', plan.names.network, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--no-healthcheck', '--user', 'postgres', '--tmpfs', '/sa33e:rw,nosuid,nodev,noexec,size=1024m,mode=0700',
      '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777', '--entrypoint', '/bin/sh', plan.imageId,
      '-c', 'sleep infinity'],
  };
}

function validatePreparationProvenance(plan, image) {
  assert.match(plan.imageRef, /^public\.ecr\.aws\/supabase\/postgres@sha256:[0-9a-f]{64}$/i,
    'An immutable repository image reference is required.');
  assert(Array.isArray(image.RepoDigests) && image.RepoDigests.includes(plan.imageRef),
    'Inspected image repository digest does not match the planned reference.');
}

function rejectedLifecycleAuthorization(operation, binding) {
  return Object.freeze({ schema: lifecycleAuthorizationSchema, ok: false, operation, binding,
    startupAuthorized: false, writeAuthorized: false, preparationAuthorized: false });
}

function authorizePreparation({ plan, image, persistent }) {
  const binding = preparationBinding({ plan, image, persistent });
  try {
    validatePrestartConfiguration({ plan, persistent });
    validatePreparationIdentity({ plan, persistent });
    validatePrestartImageIdentity({ plan, image });
    validatePreparationProvenance(plan, image);
    return Object.freeze({ schema: lifecycleAuthorizationSchema, ok: true, operation: 'prepare', binding,
      startupAuthorized: false, writeAuthorized: false, preparationAuthorized: true });
  } catch {
    return rejectedLifecycleAuthorization('prepare', binding);
  }
}

function authorizeLifecycle({ operation, input, runtimeProof } = {}) {
  let binding = '';
  try {
    assert(['prepare', 'start', 'write'].includes(operation), 'Lifecycle operation is invalid.');
    binding = lifecycleTargetBinding(input);
    const preflight = evaluatePrestartGate(input);
    assert(preflight && preflight.ok === true && preflight.decision === 'PRESTART_VALIDATED_NO_STARTUP'
      && preflight.startupAuthorized === false && preflight.writeAuthorized === false
      && preflight.runtimeStorageVerified === false, 'Static preflight is incomplete.');
    if (operation === 'prepare') {
      return Object.freeze({ schema: lifecycleAuthorizationSchema, ok: true, operation, binding,
        startupAuthorized: false, writeAuthorized: false, preparationAuthorized: true });
    }
    if (operation === 'start') {
      assert(runtimeProof && runtimeProof.schema === 'serveflow.sa33e.runtime-proof.v1', 'Runtime proof is missing.');
      assert.equal(runtimeProof.binding, binding, 'Runtime proof target changed.');
      assert.equal(runtimeProof.runtimeStorageVerified, true, 'Runtime tmpfs proof is missing.');
      return Object.freeze({ schema: lifecycleAuthorizationSchema, ok: true, operation, binding,
        startupAuthorized: true, writeAuthorized: false, preparationAuthorized: false });
    }
    throw new Error('Database/write authorization is not implemented.');
  } catch {
    return rejectedLifecycleAuthorization(operation || 'unknown', binding);
  }
}

function requireLifecycleAuthorization(authorization, operation, binding) {
  assert(authorization && typeof authorization === 'object', 'Lifecycle authorization is missing.');
  assert.equal(authorization.schema, lifecycleAuthorizationSchema, 'Lifecycle authorization schema is invalid.');
  assert.equal(authorization.ok, true, 'Lifecycle authorization was rejected.');
  assert.equal(authorization.operation, operation, 'Lifecycle authorization operation mismatch.');
  assert.equal(authorization.binding, binding, 'Lifecycle authorization target changed.');
  if (operation === 'prepare') assert.equal(authorization.preparationAuthorized, true, 'Preparation is not authorized.');
  if (operation === 'start') assert.equal(authorization.startupAuthorized, true, 'Startup is not authorized.');
  if (operation === 'write') assert.equal(authorization.writeAuthorized, true, 'Write is not authorized.');
  return authorization;
}

function requirePreparationAuthorization(authorization, binding) {
  requireLifecycleAuthorization(authorization, 'prepare', binding);
  assert.deepEqual(Object.keys(authorization).sort(), [
    'binding', 'ok', 'operation', 'preparationAuthorized', 'schema', 'startupAuthorized', 'writeAuthorized',
  ].sort(), 'Preparation authorization has unknown or missing fields.');
  assert.equal(authorization.startupAuthorized, false, 'Preparation cannot authorize startup.');
  assert.equal(authorization.writeAuthorized, false, 'Preparation cannot authorize writes.');
}

function executeLifecycleAction({ operation, input, authorization, actions }) {
  const binding = operation === 'prepare' && !input?.container
    ? preparationBinding(input)
    : lifecycleTargetBinding(input);
  requireLifecycleAuthorization(authorization, operation, binding);
  const action = actions?.[operation];
  assert.equal(typeof action, 'function', 'Lifecycle action is missing.');
  return action();
}

// The only creation dispatcher. The CLI supplies Docker adapters; pure tests supply spies.
// The production authorizer is always required, even when a test supplies an extra gate.
function runPreparationCreation({ plan, image, persistent, gate, createNetwork, createContainer, onNetworkCreated }) {
  const input = { plan, image, persistent };
  const authorization = authorizePreparation(input);
  const binding = preparationBinding(input);
  requirePreparationAuthorization(authorization, binding);
  if (gate) {
    const additional = gate(input);
    if (additional && typeof additional.then === 'function') {
      Promise.resolve(additional).catch(() => undefined);
      throw new Error('Asynchronous preparation gates are forbidden.');
    }
    requirePreparationAuthorization(additional, binding);
  }
  assert.equal(typeof createNetwork, 'function', 'Network creation adapter is missing.');
  assert.equal(typeof createContainer, 'function', 'Container creation adapter is missing.');
  const commands = preparationCommands(plan);
  const networkArgs = Object.freeze([...commands.network]);
  const containerArgs = Object.freeze([...commands.container]);
  requirePreparationAuthorization(authorization, preparationBinding(input));
  const networkId = createNetwork(networkArgs);
  requireId(networkId, 'Created network');
  if (onNetworkCreated) onNetworkCreated(networkId);
  // Recheck after the first side effect. A mutated plan never reaches container creation.
  requirePreparationAuthorization(authorization, preparationBinding(input));
  assert.deepEqual(preparationCommands(plan).container, containerArgs, 'Container creation configuration changed.');
  const containerId = createContainer(containerArgs);
  requireId(containerId, 'Created container');
  return { networkId, containerId };
}

function requireSynchronousMetadata(value, name) {
  if (value && typeof value.then === 'function') {
    Promise.resolve(value).catch(() => undefined);
    throw new Error(`${name} must be synchronous.`);
  }
  return value;
}

function runMandatoryLifecycle({ operation, input, runtimeProof, gate = authorizeLifecycle, actions }) {
  let authorization;
  try {
    authorization = gate({ operation, input, runtimeProof });
    if (authorization && typeof authorization.then === 'function') {
      Promise.resolve(authorization).catch(() => undefined);
      return rejectedLifecycleAuthorization(operation, '');
    }
    const value = executeLifecycleAction({ operation, input, authorization, actions });
    return Object.freeze({ ok: true, authorization, value });
  } catch {
    return rejectedLifecycleAuthorization(operation, '');
  }
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
  return { decision: 'EXACT_INERT_TARGET_REVALIDATED', containerId: verified.container.id,
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

// Pure orchestration seam: every dependency is explicit and required. It has no
// Docker fallback. The production adapter bundle is constructed only by the CLI.
function orchestratePreparation(services) {
  const required = ['checkSource', 'localDockerContext', 'persistentInventory', 'inspectImage', 'runId',
    'inspectExact', 'remove', 'createEvidenceDir', 'createNetwork', 'createContainer',
    'migrationInventory', 'writeManifest', 'log'];
  assert(services && typeof services === 'object', 'Preparation adapters are missing.');
  assert.deepEqual(Object.keys(services).sort(), [...required].sort(), 'Preparation adapters must be complete.');
  for (const name of required) assert.equal(typeof services[name], 'function', `Preparation adapter ${name} is missing.`);
  assert(process.argv.includes('--confirm-stopped-resource-creation'),
    'Stopped resource creation requires --confirm-stopped-resource-creation.');
  const source = requireSynchronousMetadata(services.checkSource(), 'Source check');
  const context = requireSynchronousMetadata(services.localDockerContext(), 'Docker context');
  const persistent = requireSynchronousMetadata(services.persistentInventory(), 'Persistent inventory');
  const image = requireSynchronousMetadata(services.inspectImage(), 'Image metadata');
  requireId(image?.Id, 'Database image');
  const runId = requireSynchronousMetadata(services.runId(), 'Run ID');
  const prefix = `serveflow-sa33e-${runId.slice(0, 12)}`;
  const names = { network: `${prefix}-net`, container: `${prefix}-db` };
  const plan = {
    runId, createdAt: new Date().toISOString(), imageRef: image?.RepoDigests?.find((value) =>
      /^public\.ecr\.aws\/supabase\/postgres@sha256:[0-9a-f]{64}$/i.test(value)), imageId: image.Id, names, dockerContext: context,
    hostedFallback: { supabaseCliUsed: false, linkedProjectRead: false, environmentFilesRead: false, credentialSources: [] },
  };
  const preparationAuthorization = authorizePreparation({ plan, image, persistent });
  requirePreparationAuthorization(preparationAuthorization, preparationBinding({ plan, image, persistent }));
  let networkId;
  let containerId;
  let evidenceDir;
  const inspect = services.inspectExact;
  const remove = services.remove;
  try {
    evidenceDir = services.createEvidenceDir(prefix);
    ({ networkId, containerId } = runPreparationCreation({ plan, image, persistent,
      createNetwork: services.createNetwork,
      createContainer: services.createContainer,
      onNetworkCreated: (id) => { networkId = id; } }));
    plan.networkId = networkId;
    plan.containerId = containerId;
    const lifecycleInput = { plan, container: inspect(containerId), network: inspect(networkId), image, persistent };
    const targetLifecycle = runMandatoryLifecycle({ operation: 'prepare', input: lifecycleInput,
      actions: { prepare: () => undefined } });
    assert.equal(targetLifecycle.ok, true, 'Prepared target lifecycle authorization was rejected.');
    const manifest = buildManifest({ ...lifecycleInput,
      persistent, repository: { migrationCount: source.migrationCount, migrationSetSha256: source.migrationSetSha256,
        migrations: services.migrationInventory() } });
    const manifestPath = path.join(evidenceDir, 'preflight-manifest.json');
    services.writeManifest(manifestPath, JSON.stringify(manifest, null, 2));
    services.log(`PREFLIGHT PASS. Resources remain stopped. Manifest: ${manifestPath}`);
  } catch (error) {
    if (containerId) {
      const current = inspect(containerId);
      if (current.Id === containerId && current.Config?.Labels?.[labelKey] === runId && !current.State?.Running) {
        remove(['container', 'rm', containerId]);
      }
    }
    if (networkId) {
      const current = inspect(networkId);
      if (current.Id === networkId && current.Labels?.[labelKey] === runId) remove(['network', 'rm', networkId]);
    }
    throw error;
  }
}

function prepareStoppedResources() {
  return orchestratePreparation({
    checkSource, localDockerContext, persistentInventory,
    inspectImage: () => dockerJson(['image', 'inspect', databaseImageTag])[0],
    runId: crypto.randomUUID, inspectExact,
    remove: (args) => docker(args),
    createEvidenceDir: (prefix) => fs.mkdtempSync(path.join(absoluteEvidenceRoot(), `${prefix}-evidence-`)),
    createNetwork: (args) => docker(args).stdout.trim(),
    createContainer: (args) => docker(args).stdout.trim(),
    migrationInventory,
    writeManifest: (file, contents) => fs.writeFileSync(file, contents),
    log: (message) => console.log(message),
  });
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
  const lifecycleInput = { plan: {
    runId: manifest.runId, imageId: manifest.resources.container.imageId, imageRef: manifest.resources.container.imageId,
    containerId: manifest.resources.container.id, networkId: manifest.resources.network.id,
    names: { container: manifest.resources.container.name, network: manifest.resources.network.name }, hostedFallback: manifest.hostedFallback,
  }, container: inspectExact(manifest.resources.container.id), network: inspectExact(manifest.resources.network.id), image,
  persistent: manifest.persistentSnapshot };
  const decision = verifyStartGate({ manifest, container: lifecycleInput.container, network: lifecycleInput.network, image });
  const startLifecycle = runMandatoryLifecycle({ operation: 'start', input: lifecycleInput,
    actions: { start: () => docker(['start', decision.containerId]) } });
  assert.equal(startLifecycle.ok, true, 'Startup lifecycle authorization was rejected.');
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
  authorizeLifecycle, authorizePreparation, buildManifest, checkSource, containerSecuritySnapshot, executeLifecycleAction, exactCleanupCommands, expectedHashes,
  evaluatePrestartGate, lifecycleAuthorizationSchema, lifecycleTargetBinding, manifestSchema, migrationInventory, networkSecuritySnapshot, originalHashes, prestartGateOrder, runMandatoryLifecycle, runPrestartGate, runPreparationCreation, sha256,
  orchestratePreparation, validateManifest, validateStartedTarget, validateStoppedTarget, verifyStartGate,
};

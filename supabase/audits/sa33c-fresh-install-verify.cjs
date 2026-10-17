/*
 * SA3.3C fresh-install verification.
 *
 * The --check-source mode is read-only. Database execution requires both
 * --run-disposable and
 * --confirm-disposable and creates a uniquely named Supabase CLI workdir in
 * the OS temporary directory. It never reads this checkout's .env files or
 * linked-project metadata.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const expectedHashes = {
  '015_phase4_function_execute_grant_hardening.sql': 'ec6dbcae2bdc6948dee9e60d5599495aa0963e49e55df1a15983b662970a4b7a',
  '028_owner_reports_settings_tables.sql': 'df7b9c731f631937ee6e08166827b97393d37e734a3e0019338f30afc62848e1',
};
const originalHashes = {
  '015_phase4_function_execute_grant_hardening.sql': 'd36c8fd0a8cb325d414a152365da6c7eced6da3ca77402846023888b01928f24',
  '028_owner_reports_settings_tables.sql': '5a855869cd4ccce2128fa3410f39d609625a927cc9480d17c68fb0317a280c73',
};

function readMigration(name) {
  return fs.readFileSync(path.join(migrationsDir, name), 'utf8');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function migrationInventory() {
  return fs.readdirSync(migrationsDir)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .map((name) => ({ name, version: Number(name.match(/^(\d+)_/)[1]) }))
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
  const exactLookup = "to_regprocedure('public.rls_auto_enable()')";
  assert.equal(migration015.split(exactLookup).length - 1, 1, '015 must make one exact zero-argument helper lookup.');
  assert.match(migration015, /if\s+to_regprocedure\('public\.rls_auto_enable\(\)'\)\s+is not null then[\s\S]*?revoke all on function public\.rls_auto_enable\(\) from public;[\s\S]*?end if;/i);
  assert.doesNotMatch(migration015, /when\s+others|exception\s+when/i, '015 must not suppress unrelated errors.');

  const migration028 = readMigration('028_owner_reports_settings_tables.sql');
  const addDescription = /alter table public\.menu_items\s+add column if not exists description text;/i.exec(migration028);
  assert(addDescription, '028 must add the nullable text description column.');
  assert(addDescription.index < migration028.indexOf('menu_items.description'), '028 must add description before its first read.');
  assert.doesNotMatch(addDescription[0], /not null|default/i, 'The 028 description column must remain nullable with no default.');

  for (const name of ['054_restaurant_starter_templates_phase4d.sql', '055_menu_data_foundation_phase4d1.sql']) {
    assert.match(readMigration(name), /alter table public\.menu_items[\s\S]*?add column if not exists description text/i,
      `${name} must retain its compatible idempotent column operation.`);
  }

  return {
    mode: 'source-only',
    migrationCount: inventory.length,
    range: [inventory[0].version, inventory.at(-1).version],
    originalHashes,
    candidateHashes: expectedHashes,
    databaseExecuted: false,
  };
}

function command(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: options.cwd || root,
    encoding: 'utf8',
    input: options.input,
    windowsHide: true,
    maxBuffer: 30 * 1024 * 1024,
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${program} ${args[0] || ''} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result;
}

function dockerInspect(id) {
  return JSON.parse(command('docker', ['inspect', id]).stdout)[0];
}

function runningDockerIdentities() {
  const ids = command('docker', ['ps', '-q']).stdout.trim().split(/\s+/).filter(Boolean);
  return ids.map((id) => {
    const item = dockerInspect(id);
    return { id: item.Id, name: item.Name, image: item.Image };
  });
}

function replaceTomlScalar(source, section, key, value) {
  const lines = source.split(/(\r?\n)/);
  const contentIndexes = lines.map((_, index) => index).filter((index) => index % 2 === 0);
  if (!section) {
    const index = contentIndexes.find((item) => new RegExp(`^${key}\\s*=`).test(lines[item]));
    assert(index !== undefined, `Generated config is missing ${key}.`);
    lines[index] = `${key} = ${value}`;
    return lines.join('');
  }
  const header = contentIndexes.find((item) => lines[item].trim() === `[${section}]`);
  assert(header !== undefined, `Generated config is missing [${section}].`);
  const nextHeader = contentIndexes.find((item) => item > header && /^\s*\[/.test(lines[item]));
  const index = contentIndexes.find((item) => item > header && (nextHeader === undefined || item < nextHeader)
    && new RegExp(`^${key}\\s*=`).test(lines[item]));
  assert(index !== undefined, `Generated config is missing [${section}] ${key}.`);
  lines[index] = `${key} = ${value}`;
  return lines.join('');
}

async function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

async function allocatePorts(count) {
  const start = 57000 + crypto.randomInt(0, 1500);
  for (let base = start; base < 62000 - count; base += count) {
    const ports = Array.from({ length: count }, (_, index) => base + index);
    if ((await Promise.all(ports.map(portIsFree))).every(Boolean)) return ports;
  }
  throw new Error('Could not reserve a free loopback port range for the disposable stack.');
}

function assertDisposableContainers(projectId, before) {
  const beforeIds = new Set(before.map(({ id }) => id));
  const all = command('docker', ['ps', '-aq']).stdout.trim().split(/\s+/).filter(Boolean).map(dockerInspect);
  const created = all.filter((item) => !beforeIds.has(item.Id) && JSON.stringify(item.Config?.Labels || {}).includes(projectId));
  assert(created.length > 0, 'No uniquely labeled disposable Supabase containers were found.');
  for (const item of created) {
    assert(item.Name.includes(projectId), `Unexpected disposable container name: ${item.Name}`);
    assert.equal(item.Mounts.some((mount) => mount.Type === 'bind' && !mount.Source.includes(projectId)), false,
      `Disposable container has an unexpected bind mount: ${item.Name}`);
    for (const bindings of Object.values(item.HostConfig?.PortBindings || {})) {
      for (const binding of bindings || []) {
        assert(['127.0.0.1', '::1'].includes(binding.HostIp), `Non-loopback port binding detected on ${item.Name}.`);
      }
    }
  }
  return created.map(({ Id, Name, Image }) => ({ id: Id, name: Name, image: Image }));
}

async function runDisposable() {
  assert(process.argv.includes('--run-disposable'), 'Database execution requires --run-disposable.');
  assert(process.argv.includes('--confirm-disposable'), 'Database execution requires --confirm-disposable.');
  const source = checkSource();
  const runId = crypto.randomUUID();
  const projectId = `serveflow-sa33c-${runId.slice(0, 8)}`;
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), `${projectId}-evidence-`));
  const workdir = path.join(evidenceDir, projectId);
  fs.mkdirSync(workdir);
  const before = runningDockerIdentities();
  let started = false;
  let createdContainers = [];

  const save = (name, value) => fs.writeFileSync(path.join(evidenceDir, name),
    typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  save('source-preflight.json', source);
  save('persistent-before.json', before);

  try {
    command('supabase', ['init', '--workdir', workdir, '--yes']);
    const generatedConfig = path.join(workdir, 'supabase', 'config.toml');
    let config = fs.readFileSync(generatedConfig, 'utf8');
    const ports = await allocatePorts(10);
    config = replaceTomlScalar(config, '', 'project_id', JSON.stringify(projectId));
    for (const [section, key, port] of [
      ['api', 'port', ports[0]], ['db', 'port', ports[1]], ['db', 'shadow_port', ports[2]],
      ['studio', 'port', ports[3]], ['inbucket', 'port', ports[4]], ['inbucket', 'smtp_port', ports[5]],
      ['inbucket', 'pop3_port', ports[6]], ['analytics', 'port', ports[7]],
    ]) config = replaceTomlScalar(config, section, key, String(port));
    config = replaceTomlScalar(config, 'db.seed', 'enabled', 'false');
    fs.writeFileSync(generatedConfig, config);
    fs.cpSync(migrationsDir, path.join(workdir, 'supabase', 'migrations'), { recursive: true });
    assert.equal(fs.existsSync(path.join(workdir, 'supabase', '.temp', 'project-ref')), false,
      'Disposable workdir must not contain linked-project metadata.');
    assert.equal(fs.readdirSync(workdir, { recursive: true }).some((entry) => path.basename(String(entry)).startsWith('.env')), false,
      'Disposable workdir must not contain environment files.');
    save('isolation-plan.json', { runId, projectId, workdir, ports, linkedProject: false, sourceCheckoutEnvRead: false });

    started = true; // Enables exact-project cleanup even when CLI start only partially succeeds.
    const startedResult = command('supabase', ['start', '--workdir', workdir, '--exclude',
      'analytics,edge-runtime,functions,imgproxy,inbucket,realtime,studio,vector', '--yes']);
    save('start.log', startedResult.stdout + startedResult.stderr);
    createdContainers = assertDisposableContainers(projectId, before);
    save('disposable-containers.json', createdContainers);

    const status = JSON.parse(command('supabase', ['status', '--workdir', workdir, '--output', 'json']).stdout);
    const databaseUrl = status.DB_URL || status.db_url;
    assert(databaseUrl, 'Supabase status did not return the disposable database URL.');
    const parsedUrl = new URL(databaseUrl);
    assert(['127.0.0.1', 'localhost', '[::1]'].includes(parsedUrl.hostname), 'Disposable DB URL must use loopback.');
    assert(ports.includes(Number(parsedUrl.port)), 'Disposable DB URL used an unallocated port.');

    const focusedReset = command('supabase', ['db', 'reset', '--local', '--no-seed', '--version', '014', '--workdir', workdir, '--yes']);
    save('reset-through-014.log', focusedReset.stdout + focusedReset.stderr);
    const { Client } = require('pg');
    let client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const migration015 = readMigration('015_phase4_function_execute_grant_hardening.sql');
      await client.query('begin');
      const absentBefore = await client.query("select to_regprocedure('public.rls_auto_enable()') is not null as present");
      assert.equal(absentBefore.rows[0].present, false, 'The helper-absent fixture was not established.');
      await client.query(migration015);
      const absentAfter = await client.query("select to_regprocedure('public.rls_auto_enable()') is not null as present");
      assert.equal(absentAfter.rows[0].present, false, '015 must not invent the optional helper.');
      await client.query('rollback');

      await client.query('begin');
      await client.query(`create function public.rls_auto_enable() returns event_trigger language plpgsql as $$ begin null; end $$;
        create event trigger sa33c_rls_auto_enable on ddl_command_end execute function public.rls_auto_enable();
        grant execute on function public.rls_auto_enable() to public`);
      const beforeHelper = await client.query("select p.oid, p.prosrc, p.proowner from pg_proc p where p.oid=to_regprocedure('public.rls_auto_enable()')");
      const beforeTrigger = await client.query("select evtfoid from pg_event_trigger where evtname='sa33c_rls_auto_enable'");
      await client.query(migration015);
      const afterHelper = await client.query(`select p.oid, p.prosrc, p.proowner,
        not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
          where acl.grantee=0 and acl.privilege_type='EXECUTE') as public_execute_revoked
        from pg_proc p where p.oid=to_regprocedure('public.rls_auto_enable()')`);
      const afterTrigger = await client.query("select evtfoid from pg_event_trigger where evtname='sa33c_rls_auto_enable'");
      assert.deepEqual(afterHelper.rows[0].oid, beforeHelper.rows[0].oid);
      assert.deepEqual(afterHelper.rows[0].prosrc, beforeHelper.rows[0].prosrc);
      assert.deepEqual(afterHelper.rows[0].proowner, beforeHelper.rows[0].proowner);
      assert.equal(afterHelper.rows[0].public_execute_revoked, true);
      assert.deepEqual(afterTrigger.rows, beforeTrigger.rows, '015 must preserve event-trigger linkage.');
      await client.query('rollback');

      await client.query('begin');
      await client.query('alter function public.current_user_restaurant_id() rename to sa33c_missing_current_user_restaurant_id');
      let unrelatedError;
      try { await client.query(migration015); } catch (error) { unrelatedError = { code: error.code, message: error.message }; }
      await client.query('rollback');
      assert.equal(unrelatedError?.code, '42883', '015 must surface an unrelated missing-function error.');
      save('migration-015-assertions.json', { helperAbsent: true, helperPresentPublicExecuteRevoked: true,
        helperBodyOwnerAndTriggerPreserved: true, unrelatedError });
    } finally {
      await client.end();
    }

    const fullReset = command('supabase', ['db', 'reset', '--local', '--no-seed', '--workdir', workdir, '--yes']);
    save('reset-001-through-278.log', fullReset.stdout + fullReset.stderr);
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const column = await client.query(`select data_type, is_nullable, column_default from information_schema.columns
        where table_schema='public' and table_name='menu_items' and column_name='description'`);
      assert.deepEqual(column.rows, [{ data_type: 'text', is_nullable: 'YES', column_default: null }]);
      const ledger = await client.query("select version from supabase_migrations.schema_migrations order by version::bigint");
      assert.equal(ledger.rows.length, 278);
      assert.deepEqual(ledger.rows.slice(-3).map(({ version }) => Number(version)), [276, 277, 278]);
      save('database-assertions.json', {
        fullReplay: '001-278 passed', description: column.rows[0], ledgerCount: ledger.rows.length,
        migrations054And055Applied: ledger.rows.some(({ version }) => Number(version) === 54)
          && ledger.rows.some(({ version }) => Number(version) === 55),
      });
    } finally {
      await client.end();
    }
    console.log(`PASS disposable verification. Evidence: ${evidenceDir}`);
  } finally {
    if (started) {
      const stopped = command('supabase', ['stop', '--project-id', projectId, '--no-backup', '--workdir', workdir, '--yes'], { allowFailure: true });
      save('stop.log', stopped.stdout + stopped.stderr);
      if (stopped.status !== 0) process.exitCode = 1;
    }
    const after = runningDockerIdentities();
    for (const identity of before) {
      const current = after.find(({ id }) => id === identity.id);
      assert.deepEqual(current, identity, `Pre-existing Docker resource changed: ${identity.name}`);
    }
    for (const created of createdContainers) {
      assert.equal(after.some(({ id }) => id === created.id), false, `Disposable container remains: ${created.name}`);
    }
    const leftovers = command('docker', ['ps', '-aq']).stdout.trim().split(/\s+/).filter(Boolean)
      .map(dockerInspect).filter((item) => item.Name.includes(projectId)
        || JSON.stringify(item.Config?.Labels || {}).includes(projectId));
    assert.deepEqual(leftovers, [], `Disposable resources remain for ${projectId}.`);
    save('persistent-after.json', after);
    const resolvedWorkdir = path.resolve(workdir);
    assert(resolvedWorkdir.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert(path.basename(resolvedWorkdir).startsWith('serveflow-sa33c-'));
    fs.rmSync(resolvedWorkdir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  if (process.argv.includes('--check-source')) {
    console.log(JSON.stringify(checkSource(), null, 2));
  } else {
    runDisposable().catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}

module.exports = { checkSource, expectedHashes, migrationInventory, originalHashes };

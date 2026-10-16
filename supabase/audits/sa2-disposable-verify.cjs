/* Focused SA2 verification. Never reads .env or connects through host/linked-project URLs. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const runId = crypto.randomUUID();
const prefix = `serveflow-sa2-${runId.slice(0, 8)}`;
const evidence = path.join('C:/Users/user/AppData/Local/Temp', prefix);
const label = 'serveflow.sa2.disposable';
const database = 'sa2_disposable';
const names = { db: `${prefix}-db`, auth: `${prefix}-auth`, rest: `${prefix}-rest`, network: `${prefix}-net` };
const secrets = [];
const results = [];
const resources = [];
let persistentBefore = [];
let networkId;
assert(process.argv.includes('--confirm-disposable'), 'Pass --confirm-disposable to authorize new isolated resources and synthetic writes.');
fs.mkdirSync(evidence, { recursive: false });
function redact(text) { for (const s of secrets) text = text.split(s).join('<synthetic-secret>'); return text; }
function docker(args, input, allowFailure = false) {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0 && !allowFailure) throw new Error(redact(`docker ${args[0]} failed: ${r.stderr || r.stdout}`));
  return { ...r, stdout: r.stdout || '', stderr: r.stderr || '' };
}
function json(args) { return JSON.parse(docker(args).stdout); }
function image(tag) { const i = json(['image', 'inspect', tag])[0]; return { id: i.Id, tag, entrypoint: i.Config?.Entrypoint, cmd: i.Config?.Cmd, volumes: i.Config?.Volumes }; }
function inspect(name) { return json(['inspect', name])[0]; }
function safeIdentity(i) { return { id: i.Id, name: i.Name, image: i.Image, startedAt: i.State.StartedAt, mounts: [...i.Mounts].sort((a,b) => a.Destination.localeCompare(b.Destination)), ports: i.HostConfig.PortBindings, networks: Object.keys(i.NetworkSettings.Networks).sort() }; }
function assertDisposable(name) {
  const i = inspect(name);
  const expected=resources.find(r=>r.name===name);
  if(expected) assert.equal(i.Id,expected.id,'Disposable container identity drift.');
  assert.equal(i.Config.Labels[label], runId);
  assert(i.Name.startsWith(`/${prefix}-`));
  assert.deepEqual(i.HostConfig.PortBindings || {}, {});
  assert.equal(i.HostConfig.ReadonlyRootfs, true);
  assert(i.Mounts.every(m => m.Type === 'tmpfs'), 'No bind or persistent volume is permitted.');
  assert.deepEqual(Object.keys(i.NetworkSettings.Networks), [names.network]);
  assert.equal(json(['network', 'inspect', names.network])[0].Internal, true);
  return safeIdentity(i);
}
function dbExec(args, input, allowFailure = false) {
  assertDisposable(names.db);
  return docker(['exec', '-i', '--user', 'postgres', names.db, ...args], input, allowFailure);
}
function sql(statement, allowFailure = false) {
  return dbExec(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', '/tmp', '-U', 'postgres', '-d', database], statement, allowFailure);
}
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function save(file, data) { fs.writeFileSync(path.join(evidence, file), redact(typeof data === 'string' ? data : JSON.stringify(data, null, 2))); }
function record(name, fn) {
  try { const detail = fn(); results.push({ name, status: 'PASS', detail }); console.log(`PASS ${name}`); }
  catch (e) { results.push({ name, status: 'FAIL', error: redact(e.message) }); console.log(`FAIL ${name}: ${redact(e.message)}`); throw e; }
}
async function check(name, fn) {
  try { await fn(); results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`); }
  catch (e) { results.push({ name, status: 'FAIL', error: redact(e.message) }); console.log(`FAIL ${name}: ${redact(e.message)}`); throw e; }
}
const quote = v => "'" + String(v).replaceAll("'", "''") + "'";
function http(service, route, body, token, method = 'POST', headers = []) {
  assertDisposable(names.db); assertDisposable(names[service]);
  const args = ['exec','-i',names.db,'curl','--noproxy','*','--silent','--show-error','--max-time','5','-X',method,
    '-H','Content-Type: application/json',...headers.flatMap(h => ['-H',h])];
  if (token) args.push('-H',`Authorization: Bearer ${token}`);
  if (body !== undefined) args.push('--data-binary','@-');
  args.push('-w','\n%{http_code}',`http://${names[service]}:${service === 'auth' ? 9999 : 3000}${route}`);
  const r = docker(args, body === undefined ? undefined : JSON.stringify(body));
  const lines = r.stdout.trim().split('\n'); const status = Number(lines.pop()); const raw = lines.join('\n');
  let data; try { data = JSON.parse(raw); } catch { data = raw; }
  return { status, data };
}
function expect(response, status, code) {
  assert.equal(response.status, status, redact(JSON.stringify(response)));
  if (code) assert.equal(response.data.code, code, redact(JSON.stringify(response)));
  return response.data;
}
function jwt(payload, secret) {
  const head = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const value = `${head}.${body}.${crypto.createHmac('sha256',secret).update(`${head}.${body}`).digest('base64url')}`;
  secrets.push(value); return value;
}
function claims(token) { return JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()); }
function totp(secret) {
  let bits = ''; for (const c of secret.toUpperCase().replace(/=+$/,'')) bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0');
  const bytes = []; for(let i=0;i+8<=bits.length;i+=8) bytes.push(parseInt(bits.slice(i,i+8),2));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const h = crypto.createHmac('sha1',Buffer.from(bytes)).update(counter).digest(); const o=h[19]&15;
  return ((h.readUInt32BE(o)&0x7fffffff)%1000000).toString().padStart(6,'0');
}

async function main() {
  const contextName = docker(['context', 'show']).stdout.trim();
  const context = json(['context', 'inspect', contextName])[0];
  assert(/^(npipe|unix):/.test(context.Endpoints.docker.Host), 'Remote Docker contexts are forbidden.');
  const persistentIds = docker(['ps', '-q']).stdout.trim().split(/\s+/).filter(Boolean);
  persistentBefore = persistentIds.map(id => safeIdentity(inspect(id)));
  save('persistent-before.json', persistentBefore);
  const images = {
    db: image('public.ecr.aws/supabase/postgres:17.6.1.141'),
    auth: image('public.ecr.aws/supabase/gotrue:v2.193.0'),
    rest: image('public.ecr.aws/supabase/postgrest:v14.13'),
  };
  for (const i of Object.values(images)) assert(!i.volumes || Object.keys(i.volumes).length === 0, 'Image-declared persistent volumes are forbidden.');
  const password = crypto.randomBytes(32).toString('hex');
  const jwtSecret = crypto.randomBytes(40).toString('hex'); secrets.push(password, jwtSecret);
  const dbUrl = `postgres://supabase_auth_admin:${password}@${names.db}:5432/${database}`;
  const restUrl = `postgres://authenticator:${password}@${names.db}:5432/${database}`;
  const planned = { runId, prefix, database, context: contextName, dockerEndpoint: context.Endpoints.docker.Host, images, names,
    target: `container=${names.db}; database=${database}; SQL socket=/tmp; role=postgres`,
    publishedPorts: [], persistentVolumes: [], bindMounts: [], outboundNetwork: 'new internal-only Docker network',
    databaseStorage: 'new /sa2 tmpfs; removed with uniquely labeled containers',
    cleanup: 'only containers/network with this exact run label and recorded IDs; never prune or remove volumes',
    baselineScope: 'selected repository prerequisites plus actual GoTrue migrations; not the complete 275-migration operational schema' };
  save('isolation-plan.json', planned);
  console.log(`EVIDENCE ${evidence}`);
  networkId = docker(['network', 'create', '--internal', '--label', `${label}=${runId}`, names.network]).stdout.trim();
  const common = ['--label', `${label}=${runId}`, '--network', names.network, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges'];
  const dbId = docker(['create', '--name', names.db, ...common, '--user', 'postgres', '--tmpfs', '/sa2:rw,nosuid,nodev,size=768m,mode=1777', '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m,mode=1777', '--entrypoint', '/bin/sh', images.db.id, '-c', 'sleep infinity']).stdout.trim();
  resources.push({ name: names.db, id: dbId });
  const authEnvironment = {
    GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: dbUrl, GOTRUE_DB_NAMESPACE: 'auth',
    GOTRUE_API_HOST: '0.0.0.0', GOTRUE_API_PORT: '9999', API_EXTERNAL_URL: `http://${names.auth}:9999`, GOTRUE_SITE_URL: 'http://synthetic.invalid',
    GOTRUE_JWT_SECRET: jwtSecret, GOTRUE_JWT_EXP: '3600', GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_JWT_ADMIN_ROLES: 'service_role',
    GOTRUE_DISABLE_SIGNUP: 'false', GOTRUE_MAILER_AUTOCONFIRM: 'true', GOTRUE_MFA_ENABLED: 'true', GOTRUE_MFA_TOTP_ENROLL_ENABLED: 'true', GOTRUE_MFA_TOTP_VERIFY_ENABLED: 'true',
  };
  const authArgs = Object.entries(authEnvironment).flatMap(([k, v]) => ['--env', `${k}=${v}`]);
  const authId = docker(['create', '--name', names.auth, ...common, '--tmpfs', '/tmp:rw,nosuid,nodev,size=32m,mode=1777', ...authArgs, '--entrypoint', '/bin/sh', images.auth.id, '-c', 'sleep infinity']).stdout.trim();
  resources.push({ name: names.auth, id: authId });
  const restId = docker(['create', '--name', names.rest, ...common, '--env', `PGRST_DB_URI=${restUrl}`, '--env', 'PGRST_DB_SCHEMAS=public', '--env', 'PGRST_DB_ANON_ROLE=anon', '--env', `PGRST_JWT_SECRET=${jwtSecret}`, '--env', 'PGRST_SERVER_PORT=3000', images.rest.id]).stdout.trim();
  resources.push({ name: names.rest, id: restId });
  const verified = resources.map(r => assertDisposable(r.name));
  save('isolation-verified-before-init.json', { ...planned, verified });
  console.log('ISOLATION VERIFIED: no ports, volumes or bind mounts; internal network; recorded target before database initialization.');
  docker(['start', names.db, names.auth]);
  const paths = dbExec(['/bin/sh', '-c', 'command -v initdb; command -v pg_ctl; command -v psql; command -v curl; find /docker-entrypoint-initdb.d -type f 2>/dev/null | head -25']).stdout;
  save('image-tools-and-bootstrap-paths.txt', paths);
  save('prepared.json', { resources, images, names, runId, database });
  dbExec(['/bin/sh', '-c', 'cat > /sa2/password; chmod 600 /sa2/password'], password);
  dbExec(['initdb', '-D', '/sa2/data', '--auth-local=trust', '--auth-host=scram-sha-256', '--pwfile=/sa2/password']);
  const subnet = json(['network', 'inspect', networkId])[0].IPAM.Config[0].Subnet;
  assert(/^172\.\d+\.\d+\.\d+\/\d+$/.test(subnet), 'Unexpected disposable network subnet.');
  dbExec(['/bin/sh', '-c', 'cat >> /sa2/data/pg_hba.conf'], `\nhost all all ${subnet} scram-sha-256\n`);
  dbExec(['pg_ctl', '-D', '/sa2/data', '-l', '/sa2/postgres.log', '-o', '-k /tmp -h 0.0.0.0 -p 5432', 'start']);
  dbExec(['createdb', '-h', '/tmp', '-U', 'postgres', database]);
  sql(`create role anon nologin noinherit; create role authenticated nologin noinherit;
    create role service_role nologin noinherit bypassrls;
    create role supabase_auth_admin login noinherit createrole password '${password}';
    create schema auth authorization supabase_auth_admin;
    alter role supabase_auth_admin set search_path=auth;
    create role authenticator login noinherit password '${password}';
    grant anon,authenticated,service_role to authenticator;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
    alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;`);
  assertDisposable(names.auth);
  const migrated = docker(['exec', names.auth, 'auth', 'migrate']);
  save('gotrue-migrate.log', migrated.stdout + migrated.stderr);
  sql('grant usage on schema auth to anon,authenticated,service_role;');
  record('Actual GoTrue migrations provide Auth helpers and MFA/session catalogs', () => {
    assert.equal(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='auth' and p.proname in ('uid','jwt')").stdout.trim(), '2');
    assert.equal(sql("select count(*) from information_schema.tables where table_schema='auth' and table_name in ('users','sessions','mfa_factors')").stdout.trim(), '3');
  });
  const prerequisites = ['001_phase1_saas_backbone.sql','006_phase4_step1_restaurant_staff_foundation.sql','017_phase5_staff_management_system.sql','018_phase5_owner_signup_bootstrap.sql','020_phase4_rls_multi_tenant_isolation_audit.sql','024_owner_staff_creation_production_hardening.sql'];
  for (const file of prerequisites) {
    sql(read(`supabase/migrations/${file}`));
    save(`applied-${file}.json`, { sha256: crypto.createHash('sha256').update(read(`supabase/migrations/${file}`)).digest('hex'), result: 'applied' });
  }
  const migration028 = fs.readdirSync(path.join(root, 'supabase/migrations')).find(f => f.startsWith('028_'));
  const projection = read(`supabase/migrations/${migration028}`).match(/alter table public\.restaurants[\s\S]*?;/)[0];
  sql(projection);
  save('028-projection.sql', projection);
  for (const file of ['276_platform_admin_foundation.sql','277_platform_admin_boundary_hardening.sql']) {
    record(`Apply ${file}`, () => sql(read(`supabase/migrations/${file}`)) && 'transaction committed');
  }
  save('database-identity.json',JSON.parse(sql("select json_build_object('database',current_database(),'systemIdentifier',(select system_identifier::text from pg_control_system()),'dataDirectory',current_setting('data_directory'),'version',current_setting('server_version'),'serverAddress',inet_server_addr(),'port',current_setting('port'))").stdout));
  docker(['exec', '-d', names.auth, 'auth']);
  docker(['start', names.rest]);
  await verifyDatabase({ password, jwtSecret });
}

async function verifyDatabase({ password, jwtSecret }) {
  // HTTP stays inside the isolated Docker network; no host URL or API-key fallback exists.
  for (let i=0;i<6;i++) {
    try { if(http('auth','/health',undefined,undefined,'GET').status===200 && http('rest','/',undefined,undefined,'GET').status===200) break; }
    catch { /* services may still be starting */ }
    if(i===5) throw new Error('Disposable HTTP services did not become ready.');
    await new Promise(r=>setTimeout(r,200));
  }
  const adminToken = jwt({role:'service_role',aud:'authenticated',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600},jwtSecret);
  const users = {};
  for(const name of ['ownerA','ownerB','staff','inspect','manage','sensitive','unverified']) {
    const email = `${name.toLowerCase()}@synthetic.invalid`;
    const u=expect(http('auth','/admin/users',{email,password,email_confirm:true,user_metadata:{display_name:`Synthetic ${name}`}},adminToken),200);
    const login=expect(http('auth','/token?grant_type=password',{email,password}),200);
    secrets.push(login.access_token,login.refresh_token);
    users[name]={id:u.id,aal1:login.access_token,token:login.access_token,email};
    if(['inspect','manage','sensitive','unverified'].includes(name)) {
      const factor=expect(http('auth','/factors',{factor_type:'totp',friendly_name:'Synthetic disposable TOTP'},login.access_token),200);
      secrets.push(factor.totp.secret,factor.totp.qr_code,factor.totp.uri);
      const challenge=expect(http('auth',`/factors/${factor.id}/challenge`,{},login.access_token),200);
      const verified=expect(http('auth',`/factors/${factor.id}/verify`,{challenge_id:challenge.id,code:totp(factor.totp.secret)},login.access_token),200);
      secrets.push(verified.access_token,verified.refresh_token);
      users[name].token=verified.access_token; users[name].factor=factor.id; users[name].totpSecret=factor.totp.secret;
    }
  }
  const a=crypto.randomUUID(), b=crypto.randomUUID();
  sql(`insert into public.restaurants(id,name,slug) values (${quote(a)},'Synthetic A','synthetic-a'),(${quote(b)},'Synthetic B','synthetic-b');
    insert into public.users(id,restaurant_id,role) values (${quote(users.ownerA.id)},${quote(a)},'admin'),(${quote(users.ownerB.id)},${quote(b)},'admin'),(${quote(users.staff.id)},${quote(a)},'kitchen');
    insert into public.restaurant_staff(restaurant_id,user_id,role,display_name) values (${quote(a)},${quote(users.ownerA.id)},'owner','Synthetic Owner A'),(${quote(b)},${quote(users.ownerB.id)},'owner','Synthetic Owner B'),(${quote(a)},${quote(users.staff.id)},'kitchen','Synthetic Staff');`);
  for(const name of ['inspect','manage','sensitive','unverified']) sql(`insert into platform_private.administrators(user_id,display_name,active,can_manage,can_sensitive,recovery_verified_at) values (${quote(users[name].id)},'Synthetic ${name}',true,${name==='manage'||name==='sensitive'},${name==='sensitive'},${name==='unverified'?'null':'clock_timestamp()'});`);
  const rpc = (name, body, user='sensitive') => http('rest',`/rpc/${name}`,body,user ? users[user]?.token || user : undefined);
  const classify = (tenant=a,version=0) => ({target_restaurant_id:tenant,classification:'live',expected_version:version,reason:'Synthetic classification review',request_id:crypto.randomUUID()});
  const application = () => sql("insert into platform_private.applications(business_name,contact_name,contact_email,business_type) values('Synthetic Venue','Synthetic Contact','app@synthetic.invalid','restaurant') returning id").stdout.trim();
  const payment = () => ({target_restaurant_id:a,amount:100,currency:'KES',channel:'Synthetic bank',paid_at:'2026-01-01T00:00:00Z',reference:crypto.randomUUID(),reason:'Synthetic payment review',request_id:crypto.randomUUID()});
  const operations = () => [
    ['get_platform_admin_context',{}],['platform_admin_read',{section:'businesses'}],['platform_admin_classify',classify(b)],
    ['platform_admin_decide_application',{application_id:crypto.randomUUID(),decision:'approved',reason:'Synthetic decision',request_id:crypto.randomUUID()}],
    ['platform_admin_record_payment',payment()],['platform_admin_reject_payment',{payment_id:crypto.randomUUID(),reason:'Synthetic rejection',request_id:crypto.randomUUID()}],
    ['platform_admin_record_diagnostic',{code:'ADMIN_READ_FAILED',environment:'local',request_id:crypto.randomUUID()}],['platform_admin_record_access',{request_id:crypto.randomUUID()}]
  ];
  // Reproduce historical defects on 276/277 before the forward repair. These are
  // defect observations, not passing security guarantees for the original SQL.
  const actorClaims=quote(JSON.stringify(claims(users.sensitive.token)));
  const originalConflict=sql(`begin; set local role authenticated; select set_config('request.jwt.claims',${actorClaims},true); select public.platform_admin_classify(${quote(b)},'live',999,'Synthetic conflict',${quote(crypto.randomUUID())}); commit;`,true);
  assert.notEqual(originalConflict.status,0); assert(originalConflict.stderr.includes('40001'));
  const originalPayment=payment();
  const originalPaymentId=expect(rpc('platform_admin_record_payment',originalPayment,'manage'),200).id;
  assert.equal(expect(rpc('platform_admin_record_payment',{...originalPayment,reason:'Changed original audit rationale'},'manage'),200).replayed,true);
  const originalReject={payment_id:originalPaymentId,reason:'Original synthetic rejection',request_id:crypto.randomUUID()};
  expect(rpc('platform_admin_reject_payment',originalReject),200);
  assert.equal(expect(rpc('platform_admin_reject_payment',{...originalReject,reason:'Changed original rejection'},'sensitive'),200).replayed,true);
  save('pre-fix-defects.json', { conflictSqlstate:'40001', conflictHttpTimeoutEvidence:'serveflow-sa2-70d022fb/failure.json', changedPaymentReasonAccepted:true, changedRejectionReasonAccepted:true });
  record('Apply 278_platform_admin_conflict_and_replay_integrity.sql',()=>sql(read('supabase/migrations/278_platform_admin_conflict_and_replay_integrity.sql')) && 'transaction committed');
  await check('Real Auth password sessions and TOTP produce AAL1/AAL2 JWTs',()=>{
    assert.equal(claims(users.sensitive.aal1).aal,'aal1'); assert.equal(claims(users.sensitive.token).aal,'aal2');
    assert(claims(users.sensitive.token).amr.some(x=>x.method==='totp'));
  });
  for(const actor of [null,'ownerA','ownerB','staff']) for(const [name,args] of operations())
    await check(`${actor||'anon'} denied ${name}`,()=>expect(rpc(name,args,actor),actor?403:401,'42501'));
  await check('Metadata role and legacy public profile super_admin cannot authorize platform access',()=>{
    expect(http('auth','/user',{data:{role:'super_admin',is_super_admin:true,platform_admin:true}},users.ownerA.token,'PUT'),200);
    sql(`update public.users set role='super_admin' where id=${quote(users.ownerA.id)}`);
    expect(rpc('platform_admin_read',{section:'administrators'},'ownerA'),403,'42501');
    sql(`update public.users set role='admin' where id=${quote(users.ownerA.id)}`);
  });
  for(const section of ['businesses','applications','users','invitations','contracts','payments','notifications','audit-logs','administrators','diagnostics','system-health','integrations','backups','security'])
    await check(`Inspect reads ${section}`,()=>expect(rpc('platform_admin_read',{section},'inspect'),200));
  for(const user of ['inspect','unverified']) await check(`${user} cannot manage`,()=>expect(rpc('platform_admin_classify',classify(),user),403,'42501'));
  await check('AAL1 administrator cannot read',()=>expect(rpc('platform_admin_read',{section:'businesses'},users.sensitive.aal1),403,'42501'));
  await check('Manage cannot perform Sensitive action',()=>expect(rpc('platform_admin_reject_payment',{payment_id:crypto.randomUUID(),reason:'Synthetic deny',request_id:crypto.randomUUID()},'manage'),403,'42501'));
  await check('Recovery verification required for Inspect',()=>expect(rpc('platform_admin_read',{section:'businesses'},'unverified'),403,'42501'));
  for(const [description,change,restore] of [
    ['Inactive administrator',`update platform_private.administrators set active=false where user_id=${quote(users.sensitive.id)}`,`update platform_private.administrators set active=true where user_id=${quote(users.sensitive.id)}`],
    ['Banned identity',`update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=${quote(users.sensitive.id)}`,`update auth.users set banned_until=null where id=${quote(users.sensitive.id)}`],
    ['Unverified email',`update auth.users set email_confirmed_at=null where id=${quote(users.sensitive.id)}`,`update auth.users set email_confirmed_at=clock_timestamp() where id=${quote(users.sensitive.id)}`],
    ['Unverified TOTP factor',`update auth.mfa_factors set status='unverified' where id=${quote(users.sensitive.factor)}`,`update auth.mfa_factors set status='verified' where id=${quote(users.sensitive.factor)}`]
  ]) await check(`${description} denied with existing AAL2 token`,()=>{ sql(change); try {expect(rpc('platform_admin_read',{section:'businesses'}),403,'42501');} finally{sql(restore);} });
  await check('Invalid JWT signature rejected before RPC',()=>{
    const forged=jwt({...claims(users.sensitive.token),sub:users.ownerA.id},'invalid-disposable-signing-key');
    expect(rpc('platform_admin_read',{section:'businesses'},forged),401);
  });
  await check('Validly signed synthetic token with missing session denied',()=>{
    const token=jwt({...claims(users.sensitive.token),session_id:crypto.randomUUID()},jwtSecret);
    expect(rpc('platform_admin_read',{section:'businesses'},token),403,'42501');
  });
  for(const [desc,amr] of [['stale',[{method:'totp',timestamp:Math.floor(Date.now()/1000)-3600}]],['missing',[]],['future',[{method:'totp',timestamp:Math.floor(Date.now()/1000)+3600}]]])
    await check(`${desc} TOTP denies Sensitive operation`,()=>expect(rpc('platform_admin_reject_payment',{payment_id:crypto.randomUUID(),reason:'Synthetic rejection',request_id:crypto.randomUUID()},jwt({...claims(users.sensitive.token),amr},jwtSecret)),403,'42501'));
  for(const role of ['anon','authenticated','service_role']) for(const command of ["select * from platform_private.audit_events", "insert into platform_private.audit_events default values", "update platform_private.audit_events set action='forged'", "delete from platform_private.audit_events", "select platform_private.require_admin('inspect')"])
    await check(`${role} direct private access denied: ${command.split(' ')[0]} ${command.includes('require_admin')?'helper':'audit'}`,()=>{
      const r=sql(`begin; set local role ${role}; ${command}; rollback;`,true); assert.notEqual(r.status,0); assert(r.stderr.includes('42501'));
    });
  await check('Private schema cannot be selected through PostgREST',()=>expect(http('rest','/audit_events',undefined,users.sensitive.token,'GET',['Accept-Profile: platform_private']),406,'PGRST106'));
  await check('Owner tenant read succeeds; cross-tenant read/update denied',()=>{
    const own=expect(http('rest',`/restaurants?id=eq.${a}&select=id`,undefined,users.ownerA.token,'GET'),200); assert.equal(own.length,1);
    assert.deepEqual(expect(http('rest',`/restaurants?id=eq.${b}&select=id`,undefined,users.ownerA.token,'GET'),200),[]);
    expect(http('rest',`/restaurants?id=eq.${b}`,{name:'Forged cross-tenant'},users.ownerA.token,'PATCH'),204);
    assert.equal(sql(`select name from public.restaurants where id=${quote(b)}`).stdout.trim(),'Synthetic B');
  });
  await check('Global app URL setter denies owners and administrator',()=>{
    for(const actor of ['ownerA','sensitive']) expect(rpc('set_app_url',{requested_app_url:'https://synthetic.invalid'},actor),403,'42501');
  });
  await check('Auth owner metadata provisioning blocked transactionally',()=>{
    const before=sql('select count(*) from auth.users; select count(*) from public.restaurants;').stdout;
    expect(http('auth','/signup',{email:'forged-owner@synthetic.invalid',password,data:{signup_kind:'owner',restaurant_name:'Forbidden Venue'}}),500);
    assert.equal(sql('select count(*) from auth.users; select count(*) from public.restaurants;').stdout,before);
  });
  await check('Existing synthetic owner password login still succeeds',()=>expect(http('auth','/token?grant_type=password',{email:users.ownerA.email,password}),200));
  await check('Extra caller-supplied actor ID is not an RPC overload',()=>expect(rpc('platform_admin_classify',{...classify(),actor_id:users.ownerB.id}),404,'PGRST202'));
  const c=classify();
  await check('Manage classification; audit actor derives from real JWT',()=>{
    expect(rpc('platform_admin_classify',c,'manage'),200);
    assert.equal(sql(`select actor_id from platform_private.audit_events where request_id=${quote(c.request_id)}`).stdout.trim(),users.manage.id);
  });
  await check('Classification same-request replay writes once',()=>{
    assert.equal(expect(rpc('platform_admin_classify',c,'manage'),200).replayed,true);
    assert.equal(sql(`select version from platform_private.business_controls where restaurant_id=${quote(a)}`).stdout.trim(),'1');
  });
  await check('Classification key payload/actor reuse and stale version rejected',()=>{
    expect(rpc('platform_admin_classify',{...c,classification:'demo'},'manage'),409,'PT409');
    expect(rpc('platform_admin_classify',c,'sensitive'),409,'PT409');
    expect(rpc('platform_admin_classify',classify(a,0),'manage'),409,'PT409');
  });
  const app=application(); const decision={application_id:app,decision:'approved',reason:'Synthetic approval',request_id:crypto.randomUUID()};
  await check('Application approval records only unusable invitation intent',()=>{
    expect(rpc('platform_admin_decide_application',decision,'manage'),200);
    assert.equal(sql(`select count(*) from platform_private.invitations where application_id=${quote(app)} and token_digest is null and expires_at is null and consumed_at is null and delivery_status='not_configured'`).stdout.trim(),'1');
    assert.equal(sql('select count(*) from platform_private.contracts').stdout.trim(),'0');
  });
  await check('Application idempotency and conflicting decision enforced',()=>{
    assert.equal(expect(rpc('platform_admin_decide_application',decision,'manage'),200).replayed,true);
    expect(rpc('platform_admin_decide_application',{...decision,decision:'rejected',request_id:crypto.randomUUID()},'manage'),409,'PT409');
    expect(rpc('platform_admin_decide_application',{...decision,decision:'pending'},'manage'),400,'22023');
  });
  const p=payment(); let paymentId;
  await check('Manage records payment without activating a contract',()=>{paymentId=expect(rpc('platform_admin_record_payment',p,'manage'),200).id; assert.equal(sql('select count(*) from platform_private.contracts').stdout.trim(),'0');});
  await check('Payment replay and payload/actor reuse restrictions',()=>{
    assert.equal(expect(rpc('platform_admin_record_payment',p,'manage'),200).replayed,true);
    expect(rpc('platform_admin_record_payment',{...p,amount:101},'manage'),409,'PT409');
    expect(rpc('platform_admin_record_payment',p,'sensitive'),409,'PT409');
  });
  await check('Invalid payment and case-insensitive duplicate reference rejected',()=>{
    expect(rpc('platform_admin_record_payment',{...payment(),amount:-1},'manage'),400,'22023');
    expect(rpc('platform_admin_record_payment',{...p,channel:p.channel.toUpperCase(),reference:p.reference.toUpperCase(),request_id:crypto.randomUUID()},'manage'),409,'23505');
  });
  const reject={payment_id:paymentId,reason:'Synthetic sensitive rejection',request_id:crypto.randomUUID()};
  // Refresh via actual Auth verification; a long test run is not fresh MFA.
  const challenge=expect(http('auth',`/factors/${users.sensitive.factor}/challenge`,{},users.sensitive.token),200);
  const fresh=expect(http('auth',`/factors/${users.sensitive.factor}/verify`,{challenge_id:challenge.id,code:totp(users.sensitive.totpSecret)},users.sensitive.token),200);
  secrets.push(fresh.access_token,fresh.refresh_token); users.sensitive.token=fresh.access_token;
  await check('Fresh real TOTP permits Sensitive payment rejection',()=>expect(rpc('platform_admin_reject_payment',reject),200));
  await check('Rejection replay and changed transition restrictions',()=>{
    assert.equal(expect(rpc('platform_admin_reject_payment',reject),200).replayed,true);
    expect(rpc('platform_admin_reject_payment',{...reject,request_id:crypto.randomUUID()}),409,'PT409');
  });
  await check('Payment record replay rejects changed audit reason',()=>expect(rpc('platform_admin_record_payment',{...p,reason:'Changed audit rationale'},'manage'),409,'PT409'));
  await check('Payment rejection replay rejects changed audit reason',()=>expect(rpc('platform_admin_reject_payment',{...reject,reason:'Changed rejection rationale'}),409,'PT409'));
  await verifyRollbackAndConcurrency({rpc,classify,application,payment,users,a,b});
}

async function verifyRollbackAndConcurrency({rpc,classify,application,payment,users,a,b}) {
  for(const kind of ['classification','application','payment','rejection']) await check(`Critical audit failure rolls back ${kind}`,()=>{
    const request=crypto.randomUUID(); let call; let state;
    if(kind==='classification') {
      const version=Number(sql(`select coalesce((select version from platform_private.business_controls where restaurant_id=${quote(a)}),0)`).stdout.trim());
      call=()=>rpc('platform_admin_classify',{...classify(a,version),classification:'demo',request_id:request},'manage');
      state=`select row_to_json(c) from platform_private.business_controls c where restaurant_id=${quote(a)}`;
    } else if(kind==='application') {
      const app=application(); call=()=>rpc('platform_admin_decide_application',{application_id:app,decision:'approved',reason:'Synthetic rollback',request_id:request},'manage');
      state=`select row_to_json(x) from (select status,decided_at,decided_by,decision_request_id,(select count(*) from platform_private.invitations where application_id=${quote(app)}) invitations from platform_private.applications where id=${quote(app)}) x`;
    } else if(kind==='payment') {
      const p={...payment(),request_id:request}; call=()=>rpc('platform_admin_record_payment',p,'manage');
      state=`select count(*) from platform_private.payment_reviews where request_id=${quote(request)}`;
    } else {
      const p=expect(rpc('platform_admin_record_payment',payment(),'manage'),200);
      call=()=>rpc('platform_admin_reject_payment',{payment_id:p.id,reason:'Synthetic rollback',request_id:request});
      state=`select row_to_json(p) from platform_private.payment_reviews p where id=${quote(p.id)}`;
    }
    const before=sql(state).stdout;
    sql(`create function platform_private.synthetic_audit_failure() returns trigger language plpgsql as $$ begin if new.request_id=${quote(request)}::uuid then raise exception 'Synthetic critical audit failure' using errcode='P0001'; end if; return new; end $$;
      create trigger synthetic_audit_failure before insert on platform_private.audit_events for each row execute function platform_private.synthetic_audit_failure();`);
    try {
      expect(call(),400,'P0001');
      assert.equal(sql(state).stdout,before);
      assert.equal(sql(`select count(*) from platform_private.audit_events where request_id=${quote(request)}`).stdout.trim(),'0');
    } finally { sql('drop trigger synthetic_audit_failure on platform_private.audit_events; drop function platform_private.synthetic_audit_failure();'); }
  });
  function asyncSql(statement) {
    assertDisposable(names.db);
    const child=spawn('docker',['exec','-i','--user','postgres',names.db,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h','/tmp','-U','postgres','-d',database],{windowsHide:true});
    let stdout='',stderr=''; child.stdout.on('data',x=>stdout+=x); child.stderr.on('data',x=>stderr+=x);
    const result=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',status=>resolve({status,stdout,stderr}));});
    child.stdin.end(statement); return result;
  }
  function actorSql(statement, tag) {
    return `begin; set local application_name=${quote(tag)}; set local role authenticated;
      select set_config('request.jwt.claims',${quote(JSON.stringify(claims(users.sensitive.token)))},true); ${statement}; commit;`;
  }
  for(const kind of ['conflicting classifications','duplicate classification request','conflicting application decisions']) await check(`Concurrent ${kind}: actual blocking and single mutation/audit`,async()=>{
    const tag=`${prefix}-${crypto.randomUUID().slice(0,6)}`;
    let lock, first, second, countSql, versionSql;
    if(kind==='conflicting application decisions') {
      const id=application(), r1=crypto.randomUUID(),r2=crypto.randomUUID();
      lock=`select id from platform_private.applications where id=${quote(id)} for update`;
      // Lock acquisition uses the database owner; the actual RPCs run as authenticated.
      first=`select public.platform_admin_decide_application(${quote(id)},'approved','Synthetic concurrency',${quote(r1)})`;
      second=`select public.platform_admin_decide_application(${quote(id)},'rejected','Synthetic concurrency',${quote(r2)})`;
      countSql=`select count(*) from platform_private.audit_events where target_id=${quote(id)}; select count(*) from platform_private.invitations where application_id=${quote(id)}`;
    } else {
      const version=Number(sql(`select coalesce((select version from platform_private.business_controls where restaurant_id=${quote(b)}),0)`).stdout.trim());
      const r1=crypto.randomUUID(),r2=kind==='duplicate classification request'?r1:crypto.randomUUID();
      lock=`select id from public.restaurants where id=${quote(b)} for update`;
      first=`select public.platform_admin_classify(${quote(b)},'live',${version},'Synthetic concurrency',${quote(r1)})`;
      second=`select public.platform_admin_classify(${quote(b)},${quote(kind==='duplicate classification request'?'live':'demo')},${version},'Synthetic concurrency',${quote(r2)})`;
      countSql=`select count(*) from platform_private.audit_events where request_id in (${quote(r1)},${quote(r2)})`;
      versionSql=`select version from platform_private.business_controls where restaurant_id=${quote(b)}`;
    }
    const firstPromise=asyncSql(`begin; set local application_name=${quote(tag+'-first')}; ${lock}; select pg_sleep(8); set local role authenticated; select set_config('request.jwt.claims',${quote(JSON.stringify(claims(users.sensitive.token)))},true); ${first}; commit;`);
    let firstLocked=false;
    for(let i=0;i<8;i++) {
      if(sql(`select count(*) from pg_stat_activity where application_name=${quote(tag+'-first')} and wait_event='PgSleep'`).stdout.trim()==='1') {firstLocked=true;break;}
      await new Promise(r=>setTimeout(r,100));
    }
    assert(firstLocked,'First connection must hold its row lock before starting second.');
    const secondPromise=asyncSql(actorSql(second,tag+'-second'));
    let blocking=[];
    for(let i=0;i<8;i++) {
      const raw=sql(`select json_build_object('pid',pid,'blockers',pg_blocking_pids(pid)) from pg_stat_activity where application_name=${quote(tag+'-second')} and cardinality(pg_blocking_pids(pid))>0`).stdout.trim();
      if(raw) {blocking.push(JSON.parse(raw));break;}
      await new Promise(r=>setTimeout(r,100));
    }
    const [r1,r2]=await Promise.all([firstPromise,secondPromise]);
    assert(blocking.length>0,'Positive pg_blocking_pids evidence required.');
    assert.equal(r1.status,0,redact(r1.stderr));
    if(kind==='duplicate classification request') { assert.equal(r2.status,0,redact(r2.stderr)); assert(r2.stdout.includes('"replayed": true')); }
    else {assert.notEqual(r2.status,0);assert(r2.stderr.includes('PT409'));}
    assert.equal(sql(countSql).stdout.trim(),kind==='conflicting application decisions'?'1\n1':'1');
    if(versionSql) {
      const initial=Number(first.match(/,'live',(\d+),/)[1]); assert.equal(Number(sql(versionSql).stdout.trim()),initial+1);
    }
    save(`concurrency-${kind.replaceAll(' ','-')}.json`,{blocking,firstStatus:r1.status,secondStatus:r2.status,sqlstate:r2.status?'PT409':null});
  });
}

function cleanup() {
  for (const r of [...resources].reverse()) {
    const i = inspect(r.id);
    assert.equal(i.Config.Labels[label], runId);
    assert.equal(i.Name, `/${r.name}`);
    docker(['rm', '-f', r.id]);
  }
  if (networkId) {
    const n = json(['network', 'inspect', networkId])[0];
    assert.equal(n.Labels[label], runId);
    assert.equal(Object.keys(n.Containers || {}).length, 0);
    docker(['network', 'rm', networkId]);
  }
  const after = persistentBefore.map(i => safeIdentity(inspect(i.id)));
  assert.deepEqual(after, persistentBefore, 'Persistent Docker resource identities changed.');
  save('persistent-after.json', after);
  save('cleanup.json', { removed: resources, networkId, persistentIdentitiesUnchanged: true });
  console.log('CLEANUP verified; persistent container identities unchanged.');
}
main().catch(e => { save('failure.json', { error: redact(e.message), results }); console.error(redact(e.message)); process.exitCode = 1; })
  .finally(() => { save('results.json', results); try { cleanup(); } catch (e) { console.error(redact(e.message)); process.exitCode = 1; } });

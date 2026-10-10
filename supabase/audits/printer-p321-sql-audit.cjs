// Disposable local PostgreSQL only; fixed loopback target and synthetic rows.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const url = 'postgresql://postgres:p321isolated@127.0.0.1:54397/postgres';
const id = () => crypto.randomUUID();
const bytes = () => crypto.randomBytes(32);
const db = () => new Client({ connectionString: url, connectionTimeoutMillis: 10000 });
const owner = id(), otherOwner = id(), tenantA = id(), tenantB = id();
let passed = 0;
function check(label, actual) { assert.ok(actual, label); console.log(`PASS ${label}`); passed++; }
async function rejection(client, code, args) {
  try { await client.query(call, args); assert.fail('Expected SQL rejection'); }
  catch (error) { assert.equal(error.code, code); }
}
const call = `select public.begin_print_bridge_pairing_with_setup(
  $1::bytea,$2::bytea,$3::text,$4::integer,$5::bytea,$6::uuid,$7::uuid,$8::timestamptz) id`;
const args = (setup = bytes(), tenant = tenantA, user = owner,
  expiry = new Date(Date.now() + 240000), code = bytes(), proof = bytes()) =>
  [code, proof, 'P321 synthetic bridge', 300, setup, user, tenant, expiry];

async function run() {
  const admin = db(), first = db(), second = db();
  await Promise.all([admin.connect(), first.connect(), second.connect()]);
  try {
    const safety = (await admin.query(`select
      to_regclass('public.print_jobs') as jobs,
      (select count(*)::int from public.restaurants
        where slug not like 'p321-%') as unrelated_restaurants`)).rows[0];
    assert.equal(safety.jobs, null, 'Expected pre-printer disposable fixture');
    assert.equal(safety.unrelated_restaurants, 0, 'Unrelated restaurant data exists');
    await admin.query(`drop function if exists public.begin_print_bridge_pairing_with_setup(
        bytea,bytea,text,integer,bytea,uuid,uuid,timestamptz);
      drop table if exists public.print_bridge_setup_claims cascade;
      drop table if exists public.print_bridge_pairing_events cascade;
      drop table if exists public.print_bridge_pairings cascade;
      drop function if exists public.begin_print_bridge_pairing(bytea,bytea,text,integer)`);
    await admin.query(`create table public.print_bridge_pairings (
      id uuid primary key default gen_random_uuid(), code_digest bytea not null unique,
      proof_digest bytea not null unique, bridge_name text not null,
      status text not null default 'pending', restaurant_id uuid references public.restaurants(id),
      expires_at timestamptz not null,
      constraint print_bridge_pairings_digest_shape check
        (octet_length(code_digest)=32 and octet_length(proof_digest)=32)
    )`);
    await admin.query(`create table public.print_bridge_pairing_events (
      id bigint generated always as identity primary key,
      pairing_id uuid not null references public.print_bridge_pairings(id),
      event_type text not null, occurred_at timestamptz not null default clock_timestamp()
    )`);
    await admin.query(`create function public.begin_print_bridge_pairing(bytea,bytea,text,integer)
      returns uuid language sql as 'select gen_random_uuid()'`);
    await admin.query(`revoke all on function public.begin_print_bridge_pairing(
      bytea,bytea,text,integer) from public,anon,authenticated`);
    await admin.query(`grant execute on function public.begin_print_bridge_pairing(bytea,bytea,text,integer)
      to service_role`);
    await admin.query(`insert into auth.users
      (id,instance_id,aud,role,email,encrypted_password,confirmed_at,created_at,updated_at)
      values ($1,'00000000-0000-0000-0000-000000000000','authenticated',
        'authenticated',$2,'',now(),now(),now()),
        ($3,'00000000-0000-0000-0000-000000000000','authenticated',
        'authenticated',$4,'',now(),now(),now())`,
      [owner,`p321-${owner}@example.test`,otherOwner,`p321-${otherOwner}@example.test`]);
    await admin.query(`insert into public.restaurants(id,name,slug) values
      ($1,'P321 A',$2),($3,'P321 B',$4)`,
      [tenantA,`p321-a-${tenantA}`,tenantB,`p321-b-${tenantB}`]);
    await admin.query(`insert into public.restaurant_staff
      (restaurant_id,user_id,role,display_name,active) values
      ($1,$2,'owner','P321 Owner',true),($3,$4,'owner','P321 Other',true)`,
      [tenantA,owner,tenantB,otherOwner]);

    const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations',
      '274_print_bridge_durable_setup_claim.sql'), 'utf8');
    await admin.query(migration);
    check('exact Migration 274 applies to fixture', true);
    const catalog = (await admin.query(`select c.relrowsecurity, c.relforcerowsecurity,
      has_table_privilege('anon','public.print_bridge_setup_claims','select') anon_select,
      has_table_privilege('authenticated','public.print_bridge_setup_claims','insert') auth_insert,
      has_table_privilege('service_role','public.print_bridge_setup_claims','insert') service_insert,
      has_function_privilege('anon',
        'public.begin_print_bridge_pairing_with_setup(bytea,bytea,text,integer,bytea,uuid,uuid,timestamptz)',
        'execute') anon_execute,
      has_function_privilege('authenticated',
        'public.begin_print_bridge_pairing_with_setup(bytea,bytea,text,integer,bytea,uuid,uuid,timestamptz)',
        'execute') auth_execute,
      has_function_privilege('service_role',
        'public.begin_print_bridge_pairing_with_setup(bytea,bytea,text,integer,bytea,uuid,uuid,timestamptz)',
        'execute') service_execute,
      has_function_privilege('service_role',
        'public.begin_print_bridge_pairing(bytea,bytea,text,integer)', 'execute') legacy_execute,
      p.prosecdef, p.proconfig
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      cross join pg_proc p
      where n.nspname='public' and c.relname='print_bridge_setup_claims'
        and p.oid='public.begin_print_bridge_pairing_with_setup(bytea,bytea,text,integer,bytea,uuid,uuid,timestamptz)'::regprocedure`)).rows[0];
    check('forced RLS, grants, security definer, fixed search_path',
      catalog.relrowsecurity && catalog.relforcerowsecurity &&
      !catalog.anon_select && !catalog.auth_insert && catalog.service_insert &&
      !catalog.anon_execute && !catalog.auth_execute && catalog.service_execute &&
      !catalog.legacy_execute && catalog.prosecdef &&
      catalog.proconfig.includes('search_path=public, pg_temp'));
    for (const role of ['anon','authenticated']) {
      await admin.query('begin');
      await admin.query(`set local role ${role}`);
      try {
        await admin.query('select * from public.print_bridge_setup_claims');
        assert.fail(`${role} unexpectedly read setup claims`);
      } catch (error) { assert.equal(error.code,'42501'); }
      await admin.query('rollback');
      await admin.query('begin');
      await admin.query(`set local role ${role}`);
      try {
        await admin.query(call,args());
        assert.fail(`${role} unexpectedly executed privileged setup RPC`);
      } catch (error) { assert.equal(error.code,'42501'); }
      await admin.query('rollback');
    }
    check('anon and authenticated direct access is denied by PostgreSQL',true);

    const setup = bytes();
    const created = (await admin.query(call, args(setup))).rows[0].id;
    check('first claim creates one pending pairing and event',
      (await admin.query(`select count(*)::int n from public.print_bridge_setup_claims
        where setup_digest=$1`,[setup])).rows[0].n===1 &&
      (await admin.query(`select count(*)::int n from public.print_bridge_pairing_events
        where pairing_id=$1 and event_type='started'`,[created])).rows[0].n===1);
    await rejection(admin, '23505', args(setup));
    check('replay remains rejected without Redis', true);
    // Rotation retains the token's signing version, so the Edge adapter sends
    // the same setup digest. PostgreSQL rejects it independent of Redis state.
    await rejection(admin, '23505', args(Buffer.from(setup)));
    check('same digest remains consumed across signing-key rotation', true);
    await rejection(admin, 'P0001', args(bytes(),tenantB,owner));
    await rejection(admin, 'P0001', args(bytes(),tenantA,owner,
      new Date(Date.now()-1000)));
    check('wrong tenant and expiry reject before claim', true);
    const expiring=bytes();
    await new Promise((resolve)=>setTimeout(resolve,100));
    await rejection(admin,'P0001',args(expiring,tenantA,owner,
      new Date(Date.now()-1)));
    check('claim after expiry does not create a claim',
      (await admin.query(`select count(*)::int n from public.print_bridge_setup_claims
        where setup_digest=$1`,[expiring])).rows[0].n===0);

    const failedSetup=bytes(), duplicateCode=bytes();
    await admin.query(call,args(bytes(),tenantA,owner,undefined,duplicateCode));
    await rejection(admin,'23505',args(failedSetup,tenantA,owner,undefined,duplicateCode));
    const retry=(await admin.query(call,args(failedSetup))).rows[0].id;
    check('failed transaction leaves setup claim retryable',Boolean(retry));

    const raced=bytes();
    await first.query('begin');
    const firstResult=await first.query(call,args(raced));
    await second.query('begin');
    const secondPid=(await second.query('select pg_backend_pid() pid')).rows[0].pid;
    const pending=second.query(call,args(raced)).then(() => null, (error) => error);
    let blocked=false;
    for(let i=0;i<30;i++) {
      await new Promise((resolve)=>setTimeout(resolve,50));
      const pids=(await admin.query('select pg_blocking_pids($1) pids',[secondPid])).rows[0].pids;
      if(pids.length){blocked=true;break;}
    }
    check('independent second session blocks on first claim',blocked);
    await first.query('commit');
    const loser=await pending;
    check('second claim loses with SQLSTATE 23505',loser?.code==='23505');
    await second.query('rollback');
    check('concurrent claim leaves one pairing and event',
      (await admin.query(`select count(*)::int n from public.print_bridge_setup_claims
        where setup_digest=$1`,[raced])).rows[0].n===1 &&
      (await admin.query(`select count(*)::int n from public.print_bridge_pairing_events
        where pairing_id=$1 and event_type='started'`,[firstResult.rows[0].id])).rows[0].n===1);
    console.log(`RESULT ${passed} PostgreSQL fixture checks passed`);
  } finally { await Promise.allSettled([admin.end(),first.end(),second.end()]); }
}
run().catch((error)=>{ console.error(`FAIL ${error.code??''} ${error.message}`); process.exitCode=1; });

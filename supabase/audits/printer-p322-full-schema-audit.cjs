// Runs only against the disposable P3.2.2 loopback Supabase stack.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');

const url = 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';
const statusPath = `${process.env.LOCALAPPDATA}\\Temp\\serveflow-p322-baseline-status.json`;
const raw = fs.readFileSync(statusPath).toString('utf16le');
const config = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
assert.match(config.API_URL, /^http:\/\/127\.0\.0\.1:55321$/);
const auth = createClient(config.API_URL, config.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const db = () => new Client({ connectionString: url, connectionTimeoutMillis: 10000, query_timeout: 15000 });
const id = () => crypto.randomUUID();
const bytes = () => crypto.randomBytes(32);
const call = `select public.begin_print_bridge_pairing_with_setup($1::bytea,$2::bytea,
 $3::text,$4::integer,$5::bytea,$6::uuid,$7::uuid,$8::timestamptz) id`;
let checks = 0;
function ok(label, condition) { assert.ok(condition, label); console.log(`PASS ${label}`); checks++; }
async function rejects(client, query, args, sqlstate) {
  try { await client.query(query, args); assert.fail(`Expected ${sqlstate}`); }
  catch (e) { assert.equal(e.code, sqlstate, e.message); }
}
async function run() {
  const admin = db(), one = db(), two = db();
  await Promise.all([admin.connect(), one.connect(), two.connect()]);
  const users = [];
  try {
    const count = (await admin.query(`select (select count(*)::int from auth.users) users,
      (select count(*)::int from public.restaurants) restaurants,
      (select count(*)::int from public.print_bridge_pairings) pairings`)).rows[0];
    assert.deepEqual(count, { users: 0, restaurants: 0, pairings: 0 },
      'Local schema baseline must have no application or Auth rows');
    const [tenantA, tenantB] = [id(), id()];
    for (let i = 0; i < 2; i++) {
      const email = `p322-${id()}@example.test`;
      const result = await auth.auth.admin.createUser({ email, password: `P322-${id()}!`, email_confirm: true });
      if (result.error || !result.data.user) throw result.error ?? new Error('Auth createUser returned no user');
      users.push(result.data.user.id);
    }
    // The schema-only export intentionally omits hosted application_settings rows.
    // Restaurant URL triggers require an isolated, nonsensitive app_url seed.
    await admin.query(`insert into public.application_settings(key,value)
      values ('app_url','http://localhost:5173')`);
    await admin.query(`insert into public.restaurants(id,name,slug) values
      ($1,'P322 isolated A',$2),($3,'P322 isolated B',$4)`,
      [tenantA, `p322-a-${tenantA}`, tenantB, `p322-b-${tenantB}`]);
    await admin.query(`insert into public.restaurant_staff
      (restaurant_id,user_id,role,display_name,active) values
      ($1,$2,'owner','P322 Owner A',true),($3,$4,'owner','P322 Owner B',true)`,
      [tenantA, users[0], tenantB, users[1]]);
    ok('real isolated Auth created two Owner identities', users.length === 2);
    const args = (setup = bytes(), tenant = tenantA, owner = users[0],
      expiry = new Date(Date.now() + 240000), code = bytes(), proof = bytes()) =>
      [code, proof, 'P322 isolated bridge', 300, setup, owner, tenant, expiry];
    const grant = (await admin.query(`select c.relrowsecurity rls,c.relforcerowsecurity force,
      has_table_privilege('anon','public.print_bridge_setup_claims','select') anon_read,
      has_table_privilege('authenticated','public.print_bridge_setup_claims','insert') auth_write,
      has_function_privilege('anon','public.begin_print_bridge_pairing_with_setup(bytea,bytea,text,integer,bytea,uuid,uuid,timestamptz)','execute') anon_rpc,
      has_function_privilege('authenticated','public.begin_print_bridge_pairing_with_setup(bytea,bytea,text,integer,bytea,uuid,uuid,timestamptz)','execute') auth_rpc,
      has_function_privilege('service_role','public.begin_print_bridge_pairing_with_setup(bytea,bytea,text,integer,bytea,uuid,uuid,timestamptz)','execute') service_rpc,
      has_function_privilege('service_role','public.begin_print_bridge_pairing(bytea,bytea,text,integer)','execute') legacy_rpc
      from pg_class c where c.oid='public.print_bridge_setup_claims'::regclass`)).rows[0];
    ok('forced RLS and service-only setup RPC', grant.rls && grant.force && !grant.anon_read &&
      !grant.auth_write && !grant.anon_rpc && !grant.auth_rpc && grant.service_rpc && !grant.legacy_rpc);
    for (const role of ['anon','authenticated']) {
      await admin.query('begin'); await admin.query(`set local role ${role}`);
      await rejects(admin, call, args(), '42501'); await admin.query('rollback');
    }
    ok('anon and authenticated cannot call setup RPC directly', true);
    const setup = bytes(), firstArgs = args(setup);
    const pair = (await admin.query(call, firstArgs)).rows[0].id;
    ok('first atomic claim creates pairing and event',
      (await admin.query(`select count(*)::int n from public.print_bridge_setup_claims where setup_digest=$1`,[setup])).rows[0].n === 1 &&
      (await admin.query(`select count(*)::int n from public.print_bridge_pairing_events where pairing_id=$1 and event_type='started'`,[pair])).rows[0].n === 1);
    await rejects(admin, call, firstArgs, '23505');
    ok('replay rejected independently of Redis', true);
    await rejects(admin, call, args(Buffer.from(setup)), '23505');
    ok('same digest rejected across signing key rotation', true);
    await rejects(admin, call, args(bytes(), tenantB, users[0]), 'P0001');
    await rejects(admin, call, args(bytes(), tenantA, users[0], new Date(Date.now()-1000)), 'P0001');
    ok('cross tenant and expired claims denied', true);
    const badSetup=bytes(), duplicateCode=bytes();
    await admin.query(call,args(bytes(),tenantA,users[0],undefined,duplicateCode));
    await rejects(admin,call,args(badSetup,tenantA,users[0],undefined,duplicateCode),'23505');
    const recovered=(await admin.query(call,args(badSetup))).rows[0].id;
    ok('failed transaction leaves claim retryable', Boolean(recovered));
    const race=bytes(); await one.query('begin');
    const winner=(await one.query(call,args(race))).rows[0].id;
    await two.query('begin');
    const secondPid=(await two.query('select pg_backend_pid() pid')).rows[0].pid;
    const pending=two.query(call,args(race)).then(()=>null,e=>e);
    let blocked=false;
    for(let i=0;i<40;i++) {
      await new Promise(resolve=>setTimeout(resolve,50));
      if((await admin.query('select pg_blocking_pids($1) pids',[secondPid])).rows[0].pids.length){blocked=true;break;}
    }
    ok('independent claim session visibly blocked on first transaction',blocked);
    await one.query('commit'); const loser=await pending;
    ok('second claim loses with unique violation',loser?.code==='23505');
    await two.query('rollback');
    ok('claim race leaves one durable pairing',
      (await admin.query('select count(*)::int n from public.print_bridge_setup_claims where setup_digest=$1',[race])).rows[0].n===1 && Boolean(winner));
    const code=firstArgs[0], proof=firstArgs[1];
    await admin.query('select public.approve_print_bridge_pairing($1,$2,$3,$4)',[pair,code,tenantA,users[0]]);
    const redeemed=(await admin.query('select * from public.begin_print_bridge_redemption($1,$2)',[pair,proof])).rows[0];
    ok('approved pairing redeems into correct tenant',redeemed.restaurant_id===tenantA);
    await rejects(admin,'select * from public.begin_print_bridge_redemption($1,$2)',[pair,proof],'P0001');
    ok('second redemption rejected',true);
    const cancelled=(await admin.query(call,args())).rows[0].id;
    const cancelArgs=(await admin.query('select code_digest,proof_digest from public.print_bridge_pairings where id=$1',[cancelled])).rows[0];
    await admin.query('select public.approve_print_bridge_pairing($1,$2,$3,$4)',[cancelled,cancelArgs.code_digest,tenantA,users[0]]);
    await admin.query('begin');
    await admin.query(`select set_config('request.jwt.claim.sub',$1,true)`,[users[0]]);
    await admin.query('select public.cancel_print_bridge_pairing($1,$2)',[cancelled,tenantA]);
    await admin.query('commit');
    await rejects(admin,'select * from public.begin_print_bridge_redemption($1,$2)',[cancelled,cancelArgs.proof_digest],'P0001');
    ok('cancelled pairing cannot redeem',true);
    console.log(`RESULT ${checks} full-schema PostgreSQL checks passed`);
  } finally {
    await Promise.allSettled([admin.end(),one.end(),two.end()]);
  }
}
run().catch(e=>{ console.error(`FAIL ${e.code??''} ${e.message}`); process.exitCode=1; });

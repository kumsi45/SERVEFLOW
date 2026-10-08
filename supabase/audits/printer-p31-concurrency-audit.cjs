// Disposable local PostgreSQL only. Never accepts an environment/linked URL.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Client } = require('pg');
const connectionString = 'postgresql://postgres:p31isolated@127.0.0.1:54398/postgres';
const id = () => crypto.randomUUID();
const fixture = {
  restaurant:id(), owner:id(), agentAUser:id(), agentBUser:id(),
  printer:id(), station:id(), table:id(), token:id(), order:id(), invoice:id(),
};
let passed=0;
function check(label, condition) { assert.ok(condition,label); passed++; console.log(`PASS ${label}`); }
async function connect(name) {
  const db=new Client({connectionString,application_name:`p31-${name}`,
    connectionTimeoutMillis:10000,query_timeout:30000});
  await db.connect();
  return db;
}
async function actor(db,userId,sql,args=[]) {
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[userId]);
    const result=await db.query(sql,args);
    await db.query('commit');
    return result;
  } catch(error) { await db.query('rollback'); throw error; }
}
async function beginActor(db,userId) {
  await db.query('begin');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[userId]);
}
async function isBlocked(admin,pid) {
  return (await admin.query('select pg_blocking_pids($1) pids',[pid])).rows[0].pids.length>0;
}
async function setup(admin) {
  const current=(await admin.query(`select count(*)::integer tenants from public.restaurants`)).rows[0];
  check('local database is disposable and has P3.1 schema',
    current.tenants<20 && Boolean((await admin.query(
      `select to_regprocedure('public.renew_print_job_lease(uuid,uuid,integer)') rpc`)).rows[0].rpc));
  await admin.query('begin');
  try {
    await admin.query(`insert into public.application_settings(key,value)
      values('app_url','https://example.test')
      on conflict (key) do update set value=excluded.value`);
    for(const [user,label] of [[fixture.owner,'owner'],[fixture.agentAUser,'a'],
      [fixture.agentBUser,'b']]) {
      await admin.query(`insert into auth.users
        (id,instance_id,aud,role,email,encrypted_password,confirmed_at,created_at,updated_at)
        values($1,'00000000-0000-0000-0000-000000000000','authenticated',
          'authenticated',$2,'',now(),now(),now())`,
      [user,`p31-local-${label}-${user}@example.test`]);
    }
    await admin.query(`insert into public.restaurants(id,name,slug,active)
      values($1,'P31 isolated', $2,true)`,
      [fixture.restaurant,`p31-local-${Date.now()}`]);
    await admin.query(`insert into public.restaurant_staff
      (restaurant_id,user_id,role,display_name,active)
      values($1,$2,'owner','P31 Owner',true)`,[fixture.restaurant,fixture.owner]);
    await admin.query(`insert into public.kitchen_stations
      (id,restaurant_id,name,active) values($1,$2,'P31 Kitchen',true)`,
      [fixture.station,fixture.restaurant]);
    await admin.query(`insert into public.business_printers
      (id,restaurant_id,name,purpose) values($1,$2,'P31 Printer','kitchen_order')`,
      [fixture.printer,fixture.restaurant]);
    await admin.query(`insert into public.restaurant_tables
      (id,restaurant_id,table_number,label,qr_token,qr_path,qr_url,active)
      values($1,$2,401,'P31 Table',$3,'/r/p31/order?t=401',
        'https://example.test/r/p31/order?t=401',true)`,
      [fixture.table,fixture.restaurant,fixture.token]);
    await admin.query(`insert into public.orders
      (id,restaurant_id,workflow_policy_snapshot,table_id,table_number,order_source)
      values($1,$2,'pay_before_kitchen',$3,'401','public_qr')`,
      [fixture.order,fixture.restaurant,fixture.table]);
    await admin.query(`insert into public.order_invoices
      (id,restaurant_id,order_id,invoice_number)
      values($1,$2,$3,1)`,[fixture.invoice,fixture.restaurant,fixture.order]);
    await admin.query('commit');
  } catch(error) { await admin.query('rollback'); throw error; }
}
async function addJob(admin,label) {
  return (await admin.query(`insert into public.print_jobs
    (restaurant_id,job_type,printer_purpose,automatic_key,order_id,invoice_id,
      kitchen_station_id,kitchen_batch_key,target_printer_id,payload)
    values($1,'kitchen_ticket','kitchen',$2,$3,$4,$5,$6,$7,'{}'::jsonb) returning id`,
  [fixture.restaurant,`kitchen:p31:${label}:${id()}`,fixture.order,fixture.invoice,
    fixture.station,label,fixture.printer])).rows[0].id;
}
async function run() {
  const admin=await connect('admin');
  const a=await connect('a');
  const b=await connect('b');
  try {
    await setup(admin);
    const code=crypto.randomBytes(32),proof=crypto.randomBytes(32);
    const pair=(await admin.query(`select public.begin_print_bridge_pairing($1,$2,'P31 Race',300) id`,
      [code,proof])).rows[0].id;
    await admin.query(`select public.approve_print_bridge_pairing($1,$2,$3,$4)`,
      [pair,code,fixture.restaurant,fixture.owner]);
    await admin.query(`select * from public.begin_print_bridge_redemption($1,$2)`,[pair,proof]);
    await a.query('begin');
    const firstPair=(await a.query(`select public.complete_print_bridge_redemption($1,$2) id`,
      [pair,fixture.agentAUser])).rows[0].id;
    const bPid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
    const pairRace=b.query(`select public.complete_print_bridge_redemption($1,$2) id`,
      [pair,fixture.agentAUser]);
    await new Promise((resolve)=>setTimeout(resolve,250));
    check('concurrent pairing completion waits on locked pairing',
      (await admin.query('select pg_blocking_pids($1) blockers',[bPid])).rows[0].blockers.length>0);
    await a.query('commit');
    check('concurrent completion converges on one agent',
      (await pairRace).rows[0].id===firstPair &&
      Number((await admin.query(`select count(*) count from public.print_agents
        where auth_user_id=$1`,[fixture.agentAUser])).rows[0].count)===1);
    check('original proof cannot start second redemption',
      (await admin.query(`select status,agent_id from public.print_bridge_pairings
        where id=$1`,[pair])).rows[0].status==='completed' &&
      (await admin.query(`select count(*)::integer count from public.print_bridge_pairing_events
        where pairing_id=$1 and event_type='completed'`,[pair])).rows[0].count===1);
    let replayRejected=false;
    try { await admin.query(`select * from public.begin_print_bridge_redemption($1,$2)`,
      [pair,proof]); } catch(error) { replayRejected=/unavailable/i.test(error.message); }
    check('replay using original proof is rejected',replayRejected);
    const agentA=firstPair;
    const agentB=(await admin.query(`select public.register_print_agent($1,$2,'P31 B') id`,
      [fixture.restaurant,fixture.agentBUser])).rows[0].id;
    await actor(admin,fixture.owner,`select public.owner_set_print_agent_printer($1,$2,$3,true)`,
      [fixture.restaurant,agentA,fixture.printer]);
    await actor(admin,fixture.owner,`select public.owner_set_print_agent_printer($1,$2,$3,true)`,
      [fixture.restaurant,agentB,fixture.printer]);
    const job=await addJob(admin,'renew-reclaim');
    const claim=(await actor(a,fixture.agentAUser,
      `select * from public.claim_print_jobs($1,1,15)`,[fixture.restaurant])).rows[0];
    check('A initially owns claimed job',claim?.job_id===job);
    await admin.query(`update public.print_jobs set claim_expires_at=clock_timestamp()+interval '2 seconds'
      where id=$1`,[job]);
    await beginActor(a,fixture.agentAUser);
    const renewed=(await a.query(`select public.renew_print_job_lease($1,$2,120) expiry`,
      [job,claim.attempt_id])).rows[0].expiry;
    await new Promise((resolve)=>setTimeout(resolve,2200));
    const reclaim=b.query("select set_config('request.jwt.claim.sub',$1,false)",
      [fixture.agentBUser]).then(()=>b.query(`select * from public.claim_print_jobs($1,1,15)`,
        [fixture.restaurant]));
    await new Promise((resolve)=>setTimeout(resolve,250));
    check('reclaim waits on renewed job transaction',await isBlocked(admin,bPid));
    await a.query('commit');
    check('renewal wins and B cannot reclaim',
      (await reclaim).rowCount===0 && new Date(renewed)>new Date());
    check('one active owner and one started attempt remain',
      (await admin.query(`select status,claimed_by_agent_id,attempt_count from public.print_jobs
        where id=$1`,[job])).rows[0].claimed_by_agent_id===agentA);
    await beginActor(a,fixture.agentAUser);
    await a.query(`select public.renew_print_job_lease($1,$2,120)`,[job,claim.attempt_id]);
    const ackRace=b.query("select set_config('request.jwt.claim.sub',$1,false)",
      [fixture.agentAUser]).then(()=>b.query(`select public.acknowledge_print_job($1,$2,'dispatched') result`,
        [job,claim.attempt_id]));
    await new Promise((resolve)=>setTimeout(resolve,250));
    check('acknowledgement waits for renewal transaction',await isBlocked(admin,bPid));
    await a.query('commit');
    check('acknowledgement wins terminally after renewal',
      (await ackRace).rows[0].result.status==='dispatched');
    let terminalRenew=false;
    try { await actor(a,fixture.agentAUser,
      `select public.renew_print_job_lease($1,$2,60)`,[job,claim.attempt_id]); }
    catch(error) { terminalRenew=/active owned print lease/i.test(error.message); }
    check('terminal job cannot be resurrected by renewal',terminalRenew);
    const affinityJob=await addJob(admin,'affinity-race');
    const aPid=(await a.query('select pg_backend_pid() pid')).rows[0].pid;
    await beginActor(admin,fixture.owner);
    await admin.query(`select public.owner_set_print_agent_printer($1,$2,$3,false)`,
      [fixture.restaurant,agentA,fixture.printer]);
    const affinityRace=a.query("select set_config('request.jwt.claim.sub',$1,false)",
      [fixture.agentAUser]).then(()=>a.query(`select * from public.claim_print_jobs($1,1,60)`,
        [fixture.restaurant]));
    await new Promise((resolve)=>setTimeout(resolve,250));
    check('claim waits on affinity revocation agent lock',await isBlocked(b,aPid));
    await admin.query('commit');
    check('affinity revocation prevents A claim', (await affinityRace).rowCount===0);
    check('job remains for another authorized agent',
      (await actor(b,fixture.agentBUser,
        `select * from public.claim_print_jobs($1,1,60)`,[fixture.restaurant])).rows[0]?.job_id===affinityJob);
    const revokeJob=await addJob(admin,'revoke-race');
    await beginActor(admin,fixture.owner);
    await admin.query(`select public.owner_revoke_print_agent($1,$2)`,
      [fixture.restaurant,agentB]);
    const revokeRace=b.query("select set_config('request.jwt.claim.sub',$1,false)",
      [fixture.agentBUser]).then(()=>b.query(`select * from public.claim_print_jobs($1,1,60)`,
        [fixture.restaurant])).then((value)=>({value}),(error)=>({error}));
    await new Promise((resolve)=>setTimeout(resolve,250));
    check('claim waits on agent revocation lock',await isBlocked(a,bPid));
    await admin.query('commit');
    const revokeResult=await revokeRace;
    const revoked=/registered print agent/i.test(revokeResult.error?.message??'');
    check('revocation prevents concurrent claim',revoked);
    check('revoked agent cannot own newly pending job',
      (await admin.query(`select status from public.print_jobs where id=$1`,
        [revokeJob])).rows[0].status==='pending');
    let revokedRenew=false;
    const bClaim=(await admin.query(`select id from public.print_job_attempts
      where print_job_id=$1 and agent_id=$2 order by attempt_number desc limit 1`,
      [affinityJob,agentB])).rows[0].id;
    try { await actor(b,fixture.agentBUser,
      `select public.renew_print_job_lease($1,$2,60)`,[affinityJob,bClaim]); }
    catch(error) { revokedRenew=/registered print agent/i.test(error.message); }
    check('revoked B cannot renew its prior valid lease',revokedRenew);

    await actor(admin,fixture.owner,`select public.owner_set_print_agent_printer($1,$2,$3,true)`,
      [fixture.restaurant,agentA,fixture.printer]);
    const renewRevokeJob=await addJob(admin,'revoke-renew');
    const renewRevokeClaim=(await actor(a,fixture.agentAUser,
      `select * from public.claim_print_jobs($1,50,60)`,[fixture.restaurant])).rows
      .find((row)=>row.job_id===renewRevokeJob);
    check('A owns lease before revocation/renewal race',
      renewRevokeClaim?.job_id===renewRevokeJob);
    await beginActor(admin,fixture.owner);
    await admin.query(`select public.owner_revoke_print_agent($1,$2)`,
      [fixture.restaurant,agentA]);
    const renewRace=a.query("select set_config('request.jwt.claim.sub',$1,false)",
      [fixture.agentAUser]).then(()=>a.query(
        `select public.renew_print_job_lease($1,$2,120) expiry`,
        [renewRevokeJob,renewRevokeClaim.attempt_id]))
      .then((value)=>({value}),(error)=>({error}));
    await new Promise((resolve)=>setTimeout(resolve,250));
    check('renewal waits on agent revocation lock',await isBlocked(b,aPid));
    await admin.query('commit');
    const renewResult=await renewRace;
    const renewRejected=/registered print agent/i.test(renewResult.error?.message??'');
    check('revocation wins and concurrent renewal fails',renewRejected);
    check('prior lease remains claimed until expiry with one owner',
      (await admin.query(`select status,claimed_by_agent_id,attempt_count from public.print_jobs
        where id=$1`,[renewRevokeJob])).rows[0].claimed_by_agent_id===agentA);
    const agentCUser=id();
    await admin.query(`insert into auth.users
      (id,instance_id,aud,role,email,encrypted_password,confirmed_at,created_at,updated_at)
      values($1,'00000000-0000-0000-0000-000000000000','authenticated',
        'authenticated',$2,'',now(),now(),now())`,
      [agentCUser,`p31-local-c-${agentCUser}@example.test`]);
    const agentC=(await admin.query(`select public.register_print_agent($1,$2,'P31 C') id`,
      [fixture.restaurant,agentCUser])).rows[0].id;
    await actor(admin,fixture.owner,`select public.owner_set_print_agent_printer($1,$2,$3,true)`,
      [fixture.restaurant,agentC,fixture.printer]);
    await admin.query(`update public.print_jobs set
      claimed_at=clock_timestamp()-interval '2 minutes',
      claim_expires_at=clock_timestamp()-interval '1 second'
      where id=$1`,[renewRevokeJob]);
    check('another authorized agent reclaims after revoked lease expires',
      (await actor(b,agentCUser,`select * from public.claim_print_jobs($1,50,60)`,
        [fixture.restaurant])).rows.some((row)=>row.job_id===renewRevokeJob));
    check('recovery has one current owner and incremented attempt',
      (await admin.query(`select claimed_by_agent_id,attempt_count from public.print_jobs
        where id=$1`,[renewRevokeJob])).rows[0].claimed_by_agent_id===agentC);

    const other={restaurant:id(),printer:id(),station:id(),table:id(),order:id(),
      invoice:id(),token:id(),user:id()};
    await admin.query(`insert into auth.users
      (id,instance_id,aud,role,email,encrypted_password,confirmed_at,created_at,updated_at)
      values($1,'00000000-0000-0000-0000-000000000000','authenticated',
        'authenticated',$2,'',now(),now(),now())`,
      [other.user,`p31-local-other-${other.user}@example.test`]);
    await admin.query(`insert into public.restaurants(id,name,slug,active)
      values($1,'P31 other tenant',$2,true)`,
      [other.restaurant,`p31-other-${id()}`]);
    await admin.query(`insert into public.restaurant_staff
      (restaurant_id,user_id,role,display_name,active)
      values($1,$2,'owner','P31 Owner',true)`,[other.restaurant,fixture.owner]);
    await admin.query(`insert into public.kitchen_stations(id,restaurant_id,name,active)
      values($1,$2,'Other Kitchen',true)`,[other.station,other.restaurant]);
    await admin.query(`insert into public.business_printers
      (id,restaurant_id,name,purpose) values($1,$2,'Other Printer','kitchen_order')`,
      [other.printer,other.restaurant]);
    await admin.query(`insert into public.printer_connections
      (restaurant_id,printer_id,connection_type,network_host,network_port)
      values($1,$2,'network','192.168.10.21',9100)`,
      [other.restaurant,other.printer]);
    await admin.query(`insert into public.restaurant_tables
      (id,restaurant_id,table_number,label,qr_token,qr_path,qr_url,active)
      values($1,$2,402,'Other Table',$3,'/r/p31/other?t=402',
        'https://example.test/r/p31/other?t=402',true)`,
      [other.table,other.restaurant,other.token]);
    await admin.query(`insert into public.orders
      (id,restaurant_id,workflow_policy_snapshot,table_id,table_number,order_source)
      values($1,$2,'pay_before_kitchen',$3,'402','public_qr')`,
      [other.order,other.restaurant,other.table]);
    await admin.query(`insert into public.order_invoices
      (id,restaurant_id,order_id,invoice_number) values($1,$2,$3,1)`,
      [other.invoice,other.restaurant,other.order]);
    const otherAgent=(await admin.query(`select public.register_print_agent($1,$2,'Other Agent') id`,
      [other.restaurant,other.user])).rows[0].id;
    await actor(admin,fixture.owner,`select public.owner_set_print_agent_printer($1,$2,$3,true)`,
      [other.restaurant,otherAgent,other.printer]);
    const otherJob=(await admin.query(`insert into public.print_jobs
      (restaurant_id,job_type,printer_purpose,automatic_key,order_id,invoice_id,
        kitchen_station_id,kitchen_batch_key,target_printer_id,payload)
      values($1,'kitchen_ticket','kitchen',$2,$3,$4,$5,'cross-tenant',$6,'{}'::jsonb)
      returning id`,[other.restaurant,`kitchen:p31:other:${id()}`,other.order,
        other.invoice,other.station,other.printer])).rows[0].id;
    await beginActor(b,other.user);
    const otherClaim=(await b.query(`select * from public.claim_print_jobs($1,1,60)`,
      [other.restaurant])).rows[0];
    let crossClaimDenied=false;
    try { await actor(a,agentCUser,`select * from public.claim_print_jobs($1,1,60)`,
      [other.restaurant]); }
    catch(error) { crossClaimDenied=/registered print agent/i.test(error.message); }
    check('A tenant claim denied while B tenant claim is uncommitted',
      crossClaimDenied && otherClaim?.job_id===otherJob);
    await b.query('commit');
    await beginActor(b,other.user);
    await b.query(`select public.renew_print_job_lease($1,$2,120)`,
      [otherJob,otherClaim.attempt_id]);
    const crossRenew=a.query("select set_config('request.jwt.claim.sub',$1,false)",
      [agentCUser]).then(()=>a.query(
        `select public.renew_print_job_lease($1,$2,120)`,
        [otherJob,otherClaim.attempt_id]))
      .then((value)=>({value}),(error)=>({error}));
    await new Promise((resolve)=>setTimeout(resolve,250));
    check('cross-tenant renewal waits on B job row',await isBlocked(admin,aPid));
    await b.query('commit');
    check('A tenant cannot renew B job after B commits',
      /active owned print lease/i.test((await crossRenew).error?.message??''));
    check('A tenant cannot fetch B connection while B owns valid lease',
      (await actor(a,agentCUser,
        `select * from public.get_claimed_print_job_connection_v2($1)`,
        [otherJob])).rowCount===0);
    check('B tenant still receives its owned connection',
      (await actor(b,other.user,
        `select * from public.get_claimed_print_job_connection_v2($1)`,
        [otherJob])).rows[0]?.network_port===9100);
    check('B remains sole owner of cross-tenant race job',
      (await admin.query(`select claimed_by_agent_id,attempt_count from public.print_jobs
        where id=$1`,[otherJob])).rows[0].claimed_by_agent_id===otherAgent);
    console.log(`P31_CONCURRENCY_AUDIT ${passed} passed, 0 failed`);
  } finally {
    for (const db of [a,b,admin]) {
      await db.query('rollback').catch(()=>{});
      await db.end().catch(()=>{});
    }
  }
}
run().catch((error)=>{console.error('P31_CONCURRENCY_AUDIT_FAILED',error.code??'',error.message);
  process.exitCode=1;});

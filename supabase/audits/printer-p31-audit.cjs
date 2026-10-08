// P3.1 candidate or deployed schema is exercised in one rollback-only transaction.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Client } = require('pg');

const envLine = fs.readFileSync(path.join(__dirname, '..', 'connection.env'), 'utf8')
  .split(/\r?\n/).find((line) => /^\s*SUPABASE_DB_URL\s*=/.test(line));
if (!envLine) throw new Error('SUPABASE_DB_URL missing');
const connectionString = envLine.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, '')
  .trim().replace(/^['"]|['"]$/g, '');
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false },
  query_timeout: 20000, connectionTimeoutMillis: 10000, keepAlive: true });
client.on('error', (error) => console.error('P31_CLIENT_ERROR', error.message));
const id = () => crypto.randomUUID();
let passed = 0;
function check(label, condition) {
  assert.ok(condition, label);
  passed += 1;
  console.log(`PASS ${label}`);
}
async function asActor(role, userId, sql, args = []) {
  await client.query(`set local role ${role}`);
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId ?? '']);
  try { return await client.query(sql, args); }
  finally { await client.query('reset role'); }
}
async function rejected(label, role, userId, sql, args, pattern) {
  await client.query('savepoint p31_rejected');
  let error;
  try {
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId ?? '']);
    await client.query(sql, args);
  }
  catch (caught) { error = caught; }
  await client.query('rollback to savepoint p31_rejected');
  check(label, Boolean(error && pattern.test(error.message)));
}
async function addUser(userId, label) {
  await client.query(`insert into auth.users
    (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
    values($1,'00000000-0000-0000-0000-000000000000','authenticated',
      'authenticated',$2,'',now(),now(),now())`,
  [userId, `p31-${label}-${userId}@example.test`]);
}

async function run() {
  await client.connect();
  try {
    const history = (await client.query(`select version,name from supabase_migrations.schema_migrations
      where version >= '271' order by version`)).rows;
    const versions=history.map((row) => row.version);
    assert.ok(JSON.stringify(versions)===JSON.stringify(['271','272']) ||
      JSON.stringify(versions)===JSON.stringify(['271','272','273']),
      `Unexpected migration history: ${versions.join(',')}`);
    const deployed=versions.includes('273');
    console.log(deployed ? 'PASS remote history ends at deployed 273' :
      'PASS remote history ends at 272');
    await client.query('begin');
    await client.query("set local statement_timeout='20s'");
    await client.query("set local lock_timeout='5s'");
    if (deployed) {
      console.log('PASS migration 273 installed; testing live schema without reapplication');
    } else {
      await client.query(fs.readFileSync(path.join(__dirname, '..', 'migrations',
        '273_print_bridge_lifecycle.sql'), 'utf8'));
      console.log('PASS migration 273 applies in rollback transaction');
    }
    const tenantA = (await client.query(`select i.restaurant_id,i.id invoice_id,i.order_id,
      oi.kitchen_station_id station_id,
      (select user_id from public.restaurant_staff s where s.restaurant_id=i.restaurant_id
        and s.active and s.role::text='owner' and s.user_id is not null limit 1) owner_id
      from public.order_invoices i join public.order_items oi
        on oi.restaurant_id=i.restaurant_id and oi.invoice_id=i.id
      where oi.kitchen_station_id is not null order by i.created_at limit 1`)).rows[0];
    assert.ok(tenantA?.owner_id);
    const tenantB = (await client.query(`select i.restaurant_id,i.id invoice_id,i.order_id,
      oi.kitchen_station_id station_id,
      (select user_id from public.restaurant_staff s where s.restaurant_id=i.restaurant_id
        and s.active and s.role::text='owner' and s.user_id is not null limit 1) owner_id
      from public.order_invoices i join public.order_items oi
        on oi.restaurant_id=i.restaurant_id and oi.invoice_id=i.id
      where oi.kitchen_station_id is not null and i.restaurant_id<>$1
      order by i.created_at limit 1`, [tenantA.restaurant_id])).rows[0];
    assert.ok(tenantB?.owner_id);
    const p1=id(),p2=id(),pb=id();
    await client.query(`insert into public.business_printers
      (id,restaurant_id,name,purpose) values
      ($1,$4,'P31 Audit A1','kitchen_order'),
      ($2,$4,'P31 Audit A2','kitchen_order'),
      ($3,$5,'P31 Audit B','kitchen_order')`,
    [p1,p2,pb,tenantA.restaurant_id,tenantB.restaurant_id]);
    await client.query(`insert into public.printer_connections
      (restaurant_id,printer_id,connection_type,network_host,network_port)
      values($1,$2,'network','192.168.10.20',9100)`,[tenantA.restaurant_id,p1]);
    const userA=id(),userA2=id(),userB=id();
    await addUser(userA,'a'); await addUser(userA2,'a2'); await addUser(userB,'b');
    const digest = () => crypto.randomBytes(32);
    const code=digest(),proof=digest();
    const pairId=(await client.query(`select public.begin_print_bridge_pairing($1,$2,$3,300) id`,
      [code,proof,'P31 Agent A'])).rows[0].id;
    check('pairing starts pending with digest only',
      (await client.query(`select status from public.print_bridge_pairings where id=$1`,
        [pairId])).rows[0].status==='pending');
    check('pairing schema persists only fixed-size digest fields',
      (await client.query(`select octet_length(code_digest) code_bytes,
        octet_length(proof_digest) proof_bytes from public.print_bridge_pairings
        where id=$1`,[pairId])).rows[0].proof_bytes===32 &&
      Number((await client.query(`select count(*) count from information_schema.columns
        where table_schema='public' and table_name='print_bridge_pairings'
          and column_name in ('raw_proof','raw_code','proof','code')`)).rows[0].count)===0);
    await rejected('anonymous cannot start pairing','anon',null,
      `select public.begin_print_bridge_pairing($1,$2,'bad',300)`,[digest(),digest()],
      /permission denied/i);
    await rejected('wrong owner cannot approve A pairing','service_role',null,
      `select public.approve_print_bridge_pairing($1,$2,$3,$4)`,
      [pairId,code,tenantA.restaurant_id,tenantB.owner_id],/active restaurant owner/i);
    await rejected('wrong code cannot approve','service_role',null,
      `select public.approve_print_bridge_pairing($1,$2,$3,$4)`,
      [pairId,digest(),tenantA.restaurant_id,tenantA.owner_id],/unavailable/i);
    await client.query(`select public.approve_print_bridge_pairing($1,$2,$3,$4)`,
      [pairId,code,tenantA.restaurant_id,tenantA.owner_id]);
    check('owner authorizes exactly restaurant A',
      (await client.query(`select status,restaurant_id from public.print_bridge_pairings
        where id=$1`,[pairId])).rows[0].restaurant_id===tenantA.restaurant_id);
    await rejected('wrong proof cannot redeem','service_role',null,
      `select * from public.begin_print_bridge_redemption($1,$2)`,
      [pairId,digest()],/unavailable/i);
    const redeem=(await client.query(`select * from public.begin_print_bridge_redemption($1,$2)`,
      [pairId,proof])).rows[0];
    check('proof redemption retains authorized tenant',redeem.restaurant_id===tenantA.restaurant_id);
    await rejected('second redemption cannot replay','service_role',null,
      `select * from public.begin_print_bridge_redemption($1,$2)`,
      [pairId,proof],/unavailable/i);
    const agentA=(await client.query(`select public.complete_print_bridge_redemption($1,$2) id`,
      [pairId,userA])).rows[0].id;
    check('dedicated Auth user bound to restaurant A',
      (await client.query(`select restaurant_id,auth_user_id from public.print_agents
        where id=$1`,[agentA])).rows[0].auth_user_id===userA);
    check('completion retry returns same agent',
      (await client.query(`select public.complete_print_bridge_redemption($1,$2) id`,
        [pairId,userA])).rows[0].id===agentA);
    await rejected('completion with another user cannot replay','service_role',null,
      `select public.complete_print_bridge_redemption($1,$2)`,
      [pairId,userA2],/cannot be completed/i);
    check('pairing event trail has one completion',
      Number((await client.query(`select count(*) count from public.print_bridge_pairing_events
        where pairing_id=$1 and event_type='completed'`,[pairId])).rows[0].count)===1);
    await rejected('original proof cannot redeem completed pairing','service_role',null,
      `select * from public.begin_print_bridge_redemption($1,$2)`,
      [pairId,proof],/unavailable/i);
    const cancelCode=digest(),cancelProof=digest();
    const cancelPair=(await client.query(`select public.begin_print_bridge_pairing($1,$2,'Cancel',300) id`,
      [cancelCode,cancelProof])).rows[0].id;
    await client.query(`select public.approve_print_bridge_pairing($1,$2,$3,$4)`,
      [cancelPair,cancelCode,tenantA.restaurant_id,tenantA.owner_id]);
    await asActor('authenticated',tenantA.owner_id,
      `select public.cancel_print_bridge_pairing($1,$2)`,[cancelPair,tenantA.restaurant_id]);
    await rejected('cancelled pairing cannot redeem','service_role',null,
      `select * from public.begin_print_bridge_redemption($1,$2)`,
      [cancelPair,cancelProof],/unavailable/i);
    const expireCode=digest(),expireProof=digest();
    const expirePair=(await client.query(`select public.begin_print_bridge_pairing($1,$2,'Expire',60) id`,
      [expireCode,expireProof])).rows[0].id;
    await client.query(`update public.print_bridge_pairings
      set created_at=clock_timestamp()-interval '5 minutes',
        expires_at=clock_timestamp()-interval '4 minutes' where id=$1`,[expirePair]);
    await rejected('expired pairing cannot authorize','service_role',null,
      `select public.approve_print_bridge_pairing($1,$2,$3,$4)`,
      [expirePair,expireCode,tenantA.restaurant_id,tenantA.owner_id],/unavailable/i);
    await client.query(`select public.expire_print_bridge_pairing($1)`,[expirePair]);
    check('expired pairing state is recorded',
      (await client.query(`select status from public.print_bridge_pairings where id=$1`,
        [expirePair])).rows[0].status==='expired');
    console.log('P31_STEP register extra agents');
    const agentA2=(await client.query(`select public.register_print_agent($1,$2,'P31 Agent A2') id`,
      [tenantA.restaurant_id,userA2])).rows[0].id;
    const agentB=(await client.query(`select public.register_print_agent($1,$2,'P31 Agent B') id`,
      [tenantB.restaurant_id,userB])).rows[0].id;
    console.log('P31_STEP set affinity');
    await asActor('authenticated',tenantA.owner_id,
      `select public.owner_set_print_agent_printer($1,$2,$3,true)`,
      [tenantA.restaurant_id,agentA,p1]);
    await asActor('authenticated',tenantA.owner_id,
      `select public.owner_set_print_agent_printer($1,$2,$3,true)`,
      [tenantA.restaurant_id,agentA2,p1]);
    await asActor('authenticated',tenantA.owner_id,
      `select public.owner_set_print_agent_printer($1,$2,$3,true)`,
      [tenantA.restaurant_id,agentA,p2]);
    check('many-to-many affinity supports shared and multiple printers',
      Number((await client.query(`select count(*) count from public.print_agent_printers
        where restaurant_id=$1`,[tenantA.restaurant_id])).rows[0].count)===3);
    check('repeat affinity grant keeps one row',
      (await asActor('authenticated',tenantA.owner_id,
        `select public.owner_set_print_agent_printer($1,$2,$3,true)`,
        [tenantA.restaurant_id,agentA,p1])).rowCount===1 &&
      Number((await client.query(`select count(*) count from public.print_agent_printers
        where restaurant_id=$1 and agent_id=$2 and printer_id=$3`,
        [tenantA.restaurant_id,agentA,p1])).rows[0].count)===1);
    await rejected('direct pairing table access denied','authenticated',tenantA.owner_id,
      `select * from public.print_bridge_pairings where id=$1`,
      [pairId],/permission denied/i);
    await rejected('owner B cannot manage A affinity','authenticated',tenantB.owner_id,
      `select public.owner_set_print_agent_printer($1,$2,$3,true)`,
      [tenantA.restaurant_id,agentA,p1],/active restaurant owner/i);
    await rejected('cross-tenant affinity rejected','authenticated',tenantA.owner_id,
      `select public.owner_set_print_agent_printer($1,$2,$3,true)`,
      [tenantA.restaurant_id,agentA,pb],/active printer not found/i);
    await rejected('anonymous cannot manage affinity','anon',null,
      `select public.owner_set_print_agent_printer($1,$2,$3,true)`,
      [tenantA.restaurant_id,agentA,p1],/permission denied/i);
    const jobA=(await client.query(`insert into public.print_jobs
      (restaurant_id,job_type,printer_purpose,automatic_key,order_id,invoice_id,
       kitchen_station_id,kitchen_batch_key,target_printer_id,payload)
      values($1,'kitchen_ticket','kitchen',$2,$3,$4,$5,'p31-batch',$6,'{}'::jsonb)
      returning id`,[tenantA.restaurant_id,`kitchen:p31:${id()}`,
      tenantA.order_id,tenantA.invoice_id,tenantA.station_id,p1])).rows[0].id;
    const jobA2=(await client.query(`insert into public.print_jobs
      (restaurant_id,job_type,printer_purpose,automatic_key,order_id,invoice_id,
       kitchen_station_id,kitchen_batch_key,target_printer_id,payload)
      values($1,'kitchen_ticket','kitchen',$2,$3,$4,$5,'p31-batch2',$6,'{}'::jsonb)
      returning id`,[tenantA.restaurant_id,`kitchen:p31:${id()}`,
      tenantA.order_id,tenantA.invoice_id,tenantA.station_id,p2])).rows[0].id;
    await asActor('authenticated',tenantA.owner_id,
      `select public.owner_set_print_agent_printer($1,$2,$3,false)`,
      [tenantA.restaurant_id,agentA,p2]);
    const claim=(await asActor('authenticated',userA,
      `select * from public.claim_print_jobs($1,10,60)`,[tenantA.restaurant_id])).rows;
    check('claim selects only currently authorized printer',
      claim.length===1 && claim[0].job_id===jobA);
    check('unauthorized printer job remains pending',
      (await client.query(`select status from public.print_jobs where id=$1`,
        [jobA2])).rows[0].status==='pending');
    await rejected('cross-tenant agent cannot claim A jobs','authenticated',userB,
      `select * from public.claim_print_jobs($1,1,60)`,
      [tenantA.restaurant_id],/registered print agent/i);
    const connection=(await asActor('authenticated',userA,
      `select * from public.get_claimed_print_job_connection_v2($1)`,[jobA])).rows[0];
    check('owned connection v2 retains configured network destination',
      connection?.printer_id===p1 && connection.network_port===9100);
    check('cross-tenant agent receives no A connection detail',
      (await asActor('authenticated',userB,
        `select * from public.get_claimed_print_job_connection_v2($1)`,
        [jobA])).rowCount===0);
    const before=(await client.query(`select claim_expires_at from public.print_jobs
      where id=$1`,[jobA])).rows[0].claim_expires_at;
    const renewal=(await asActor('authenticated',userA,
      `select public.renew_print_job_lease($1,$2,120) expiry`,
      [jobA,claim[0].attempt_id])).rows[0].expiry;
    check('lease renewal uses later server expiry',new Date(renewal)>new Date(before));
    await rejected('other agent cannot renew','authenticated',userA2,
      `select public.renew_print_job_lease($1,$2,60)`,
      [jobA,claim[0].attempt_id],/active owned print lease/i);
    await rejected('cross-tenant agent cannot renew','authenticated',userB,
      `select public.renew_print_job_lease($1,$2,60)`,
      [jobA,claim[0].attempt_id],/active owned print lease/i);
    await rejected('renewal is bounded','authenticated',userA,
      `select public.renew_print_job_lease($1,$2,301)`,
      [jobA,claim[0].attempt_id],/15 to 300/i);
    const heartbeat=(await asActor('authenticated',userA,
      `select public.heartbeat_print_agent($1,'1.2.3','windows') observed`,
      [tenantA.restaurant_id])).rows[0].observed;
    check('heartbeat version and server timestamp stored',
      Boolean(heartbeat) &&
      (await client.query(`select bridge_version from public.print_agents where id=$1`,
        [agentA])).rows[0].bridge_version==='1.2.3');
    await rejected('invalid bridge version rejected','authenticated',userA,
      `select public.heartbeat_print_agent($1,'fake','windows')`,
      [tenantA.restaurant_id],/valid bridge version/i);
    await rejected('cross-tenant heartbeat rejected','authenticated',userA,
      `select public.heartbeat_print_agent($1,'1.2.3','windows')`,
      [tenantB.restaurant_id],/registered print agent/i);
    const observed=(await asActor('authenticated',userA,
      `select public.report_print_printer_observation($1,'reachable',null,true) observed`,
      [p1])).rows[0].observed;
    check('printer observation uses server timestamp without config mutation',
      Boolean(observed) &&
      (await client.query(`select status from public.business_printers where id=$1`,
        [p1])).rows[0].status==='not_configured');
    check('observation does not dispatch a claimed job',
      (await client.query(`select status from public.print_jobs where id=$1`,
        [jobA])).rows[0].status==='claimed');
    await rejected('unauthorized printer observation denied','authenticated',userA,
      `select public.report_print_printer_observation($1,'reachable',null,false)`,
      [p2],/authorized printer/i);
    await rejected('cross-tenant printer observation denied','authenticated',userA,
      `select public.report_print_printer_observation($1,'reachable',null,false)`,
      [pb],/authorized printer/i);
    await rejected('invalid observation status denied','authenticated',userA,
      `select public.report_print_printer_observation($1,'ready',null,false)`,
      [p1],/structured printer observation/i);
    await asActor('authenticated',tenantA.owner_id,
      `select public.owner_set_print_agent_printer($1,$2,$3,false)`,
      [tenantA.restaurant_id,agentA,p1]);
    check('affinity removal hides existing claimed connection',
      (await asActor('authenticated',userA,
        `select * from public.get_claimed_print_job_connection($1)`,[jobA])).rowCount===0);
    await rejected('affinity removal blocks lease renewal','authenticated',userA,
      `select public.renew_print_job_lease($1,$2,60)`,
      [jobA,claim[0].attempt_id],/authorization is no longer active/i);
    const ack=(await asActor('authenticated',userA,
      `select public.acknowledge_print_job($1,$2,'dispatched') result`,
      [jobA,claim[0].attempt_id])).rows[0].result;
    check('valid prior lease may acknowledge after affinity removal',
      ack.status==='dispatched');
    await rejected('terminal job cannot renew','authenticated',userA,
      `select public.renew_print_job_lease($1,$2,60)`,
      [jobA,claim[0].attempt_id],/active owned print lease/i);
    await asActor('authenticated',tenantA.owner_id,
      `select public.owner_revoke_print_agent($1,$2)`,
      [tenantA.restaurant_id,agentA]);
    await rejected('revoked agent cannot claim','authenticated',userA,
      `select * from public.claim_print_jobs($1,1,60)`,
      [tenantA.restaurant_id],/registered print agent/i);
    await rejected('revoked agent cannot renew','authenticated',userA,
      `select public.renew_print_job_lease($1,$2,60)`,
      [jobA,claim[0].attempt_id],/registered print agent/i);
    await rejected('revoked agent cannot heartbeat','authenticated',userA,
      `select public.heartbeat_print_agent($1,'1.2.3','windows')`,
      [tenantA.restaurant_id],/registered print agent/i);
    await rejected('revoked agent cannot report observation','authenticated',userA,
      `select public.report_print_printer_observation($1,'unknown',null,false)`,
      [p1],/registered print agent/i);
    await rejected('revoked agent cannot fetch connection','authenticated',userA,
      `select * from public.get_claimed_print_job_connection_v2($1)`,
      [jobA],/registered print agent/i);
    await rejected('revoked agent cannot acknowledge','authenticated',userA,
      `select public.acknowledge_print_job($1,$2,'dispatched')`,
      [jobA,claim[0].attempt_id],/registered print agent/i);
    check('revocation is auditable',
      Number((await client.query(`select count(*) count from public.print_agent_lifecycle_events
        where agent_id=$1 and event_type='revoked'`,[agentA])).rows[0].count)===1);
    check('different agent may share printer authorization',
      (await client.query(`select enabled from public.print_agent_printers
        where agent_id=$1 and printer_id=$2`,[agentA2,p1])).rows[0].enabled===true);
    check('tenant B agent remains separate',
      (await client.query(`select restaurant_id from public.print_agents where id=$1`,
        [agentB])).rows[0].restaurant_id===tenantB.restaurant_id);
    console.log(`P31_ROLLBACK_AUDIT ${passed} passed, 0 failed`);
  } finally {
    try { await client.query('rollback'); } finally { await client.end(); }
  }
}
run().catch((error) => { console.error('P31_AUDIT_FAILED', error.code ?? '', error.message);
  process.exitCode = 1; });

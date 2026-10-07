// Runs only against the disposable localhost PostgreSQL container.
// Never accepts a linked or environment-supplied database URL.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Client } = require('pg');

const connectionString = 'postgresql://postgres:p2isolated@127.0.0.1:54399/postgres';
const id = () => crypto.randomUUID();
const fixture = {
  restaurant: id(), slug: `p2-local-${Date.now()}`,
  cashierUser: id(), cashierStaff: id(), waiterUser: id(), waiterStaff: id(),
  agentAUser: id(), agentBUser: id(), station: id(), category: id(), menu: id(),
  printer: id(), table: id(), token: id(),
};
let passed = 0;
function check(label, condition, detail = '') {
  assert.ok(condition, `${label}: ${detail}`);
  passed += 1;
  console.log(`PASS ${label}`);
}
async function connect(name) {
  const db = new Client({ connectionString, application_name: `p2-${name}`,
    connectionTimeoutMillis: 10000, query_timeout: 30000 });
  await db.connect();
  return db;
}
async function actor(db, userId, sql, args = []) {
  await db.query('begin');
  try {
    await db.query('set local role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
    const result = await db.query(sql, args);
    await db.query('commit');
    return result;
  } catch (error) { await db.query('rollback'); throw error; }
}
async function anonymous(db, sql, args = []) {
  await db.query('begin');
  try {
    await db.query('set local role anon');
    const result = await db.query(sql,args);
    await db.query('commit');
    return result;
  } catch (error) { await db.query('rollback'); throw error; }
}
async function rejectedActor(db, userId, sql, args, pattern) {
  try { await actor(db, userId, sql, args); }
  catch (error) { return pattern.test(error.message); }
  return false;
}
async function beginAgent(db, userId) {
  await db.query('begin');
  await db.query('set local role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
}
async function setup(admin) {
  const effective = (await admin.query(`select to_regclass('public.print_jobs') jobs,
    to_regprocedure('public.invoice_is_kitchen_eligible(uuid,uuid)') eligibility,
    (select count(*) from public.restaurants) tenant_count`)).rows[0];
  check('isolated schema has Migration 271 predicate and Migration 272 queue',
    effective.jobs === 'print_jobs' && Boolean(effective.eligibility)
    && Number(effective.tenant_count) < 20);
  await admin.query('begin');
  try {
    await admin.query(`insert into public.application_settings(key,value)
      values('app_url','https://example.test') on conflict (key) do update set value=excluded.value`);
    for (const [userId, label] of [
      [fixture.cashierUser, 'cashier'], [fixture.waiterUser, 'waiter'],
      [fixture.agentAUser, 'agent-a'], [fixture.agentBUser, 'agent-b'],
    ]) {
      await admin.query(`insert into auth.users
        (id,instance_id,aud,role,email,encrypted_password,confirmed_at,created_at,updated_at)
        values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
          $2,'',now(),now(),now())`, [userId, `${fixture.slug}-${label}@example.test`]);
    }
    await admin.query(`insert into public.restaurants(id,name,slug,active,payment_policy)
      values($1,'P2 Local Concurrency',$2,true,'pay_before_kitchen')`,
    [fixture.restaurant, fixture.slug]);
    await admin.query(`insert into public.restaurant_staff
      (id,restaurant_id,user_id,role,display_name,active) values
      ($1,$3,$4,'cashier','P2 Cashier',true),
      ($2,$3,$5,'waiter','P2 Waiter',true)`, [fixture.cashierStaff, fixture.waiterStaff,
      fixture.restaurant, fixture.cashierUser, fixture.waiterUser]);
    await admin.query(`insert into public.kitchen_stations
      (id,restaurant_id,name,display_color,icon,priority,active,is_default)
      values($1,$2,'P2 Main','#2563eb','PM',1,true,true)`,
    [fixture.station, fixture.restaurant]);
    await admin.query(`insert into public.categories(id,restaurant_id,name)
      values($1,$2,'P2 Local')`, [fixture.category, fixture.restaurant]);
    await admin.query(`insert into public.menu_items
      (id,restaurant_id,category_id,name,price,available,kitchen_station_id)
      values($1,$2,$3,'P2 Item',10,true,$4)`,
    [fixture.menu, fixture.restaurant, fixture.category, fixture.station]);
    await admin.query(`insert into public.restaurant_tables
      (id,restaurant_id,table_number,label,qr_token,qr_path,qr_url,active)
      values($1,$2,401,'P2 Table',$3,$4,$5,true)`, [fixture.table,
      fixture.restaurant, fixture.token, `/r/${fixture.slug}/order?t=401`,
      `https://example.test/r/${fixture.slug}/order?t=401`]);
    await admin.query(`insert into public.restaurant_table_waiter_assignments
      (restaurant_id,table_id,waiter_staff_id,active) values($1,$2,$3,true)`,
    [fixture.restaurant, fixture.table, fixture.waiterStaff]);
    await admin.query(`insert into public.business_payment_methods
      (restaurant_id,method_code,display_name,enabled,display_order)
      values($1,'cash','Cash',true,1)
      on conflict (restaurant_id,method_code) do update set enabled=true`, [fixture.restaurant]);
    await admin.query(`insert into public.business_printing_settings
      (restaurant_id,kitchen_output_mode,default_print_behaviour)
      values($1,'single_kitchen_printer','automatic')
      on conflict (restaurant_id) do update set
        kitchen_output_mode=excluded.kitchen_output_mode,
        default_print_behaviour=excluded.default_print_behaviour`, [fixture.restaurant]);
    await admin.query(`insert into public.business_printers
      (id,restaurant_id,name,purpose,is_default,enabled)
      values($1,$2,'P2 Local Printer','kitchen_order',true,true)`,
    [fixture.printer, fixture.restaurant]);
    await admin.query(`select public.register_print_agent($1,$2,'P2 agent A')`,
      [fixture.restaurant, fixture.agentAUser]);
    await admin.query(`select public.register_print_agent($1,$2,'P2 agent B')`,
      [fixture.restaurant, fixture.agentBUser]);
    await admin.query('commit');
  } catch (error) { await admin.query('rollback'); throw error; }
}

async function run() {
  const admin = await connect('admin');
  const a = await connect('a');
  const b = await connect('b');
  try {
    await setup(admin);
    // Keep the canonical release from enqueueing until both race clients are ready.
    await admin.query(`update public.print_queue_activations
      set activated_at=clock_timestamp()+interval '1 day' where restaurant_id=$1`,
      [fixture.restaurant]);
    const created = (await actor(admin, fixture.cashierUser,
      `select public.submit_cashier_order_batch($1,'401','Cash',$2::jsonb,'create',null,$3) payload`,
      [fixture.restaurant, JSON.stringify([{ menu_item_id: fixture.menu, quantity: 1 }]), id()]
    )).rows[0].payload;
    check('canonical Cashier order exists before enqueue race', Boolean(created.invoice_id));
    check('future cutoff prevented premature automatic ticket',
      Number((await admin.query(`select count(*) count from public.print_jobs
        where invoice_id=$1`, [created.invoice_id])).rows[0].count) === 0);
    await admin.query(`update public.print_queue_activations
      set activated_at=clock_timestamp()-interval '1 day' where restaurant_id=$1`,
      [fixture.restaurant]);

    await a.query('begin');
    const first = (await a.query(`select public.enqueue_kitchen_print_jobs($1,$2) count`,
      [fixture.restaurant, created.invoice_id])).rows[0].count;
    check('first independent enqueue creates ticket', first === 1);
    const bPid = (await b.query('select pg_backend_pid() pid')).rows[0].pid;
    const competingEnqueue = b.query(`select public.enqueue_kitchen_print_jobs($1,$2) count`,
      [fixture.restaurant, created.invoice_id]);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const blocked = (await admin.query(`select pg_blocking_pids($1) blockers`, [bPid])).rows[0].blockers;
    check('second enqueue really waits on first transaction', blocked.length > 0,
      JSON.stringify(blocked));
    await a.query('commit');
    const second = (await competingEnqueue).rows[0].count;
    const ticket = (await admin.query(`select * from public.print_jobs
      where restaurant_id=$1 and invoice_id=$2 and job_type='kitchen_ticket'`,
      [fixture.restaurant, created.invoice_id])).rows;
    const memberships = (await admin.query(`select order_item_id from public.print_job_order_items
      where print_job_id=$1`, [ticket[0]?.id])).rows;
    check('concurrent enqueue converges on one complete ticket',
      second === 0 && ticket.length === 1 && memberships.length === 1);
    const firstJob = ticket[0];
    check('ticket is automatically claimable',
      firstJob.target_printer_id === fixture.printer && firstJob.dispatch_mode === 'automatic');

    await beginAgent(a, fixture.agentAUser);
    await beginAgent(b, fixture.agentBUser);
    const claimA = (await a.query(`select * from public.claim_print_jobs($1,1,60)`,
      [fixture.restaurant])).rows;
    const claimB = (await b.query(`select * from public.claim_print_jobs($1,1,60)`,
      [fixture.restaurant])).rows;
    check('two agents racing one job have one winner',
      claimA.length === 1 && claimA[0].job_id === firstJob.id && claimB.length === 0);
    await a.query('commit');
    await b.query('commit');
    const claimedState = (await admin.query(`select claimed_by_agent_id,claimed_at,
      claim_expires_at,attempt_count from public.print_jobs where id=$1`,
      [firstJob.id])).rows[0];
    check('one active owner and one durable attempt after claim race',
      Boolean(claimedState.claimed_by_agent_id) && Boolean(claimedState.claimed_at)
      && Boolean(claimedState.claim_expires_at) && claimedState.attempt_count === 1
      && Number((await admin.query(`select count(*) count from public.print_job_attempts
        where print_job_id=$1`, [firstJob.id])).rows[0].count) === 1);

    // Let B reclaim after an explicitly expired, test-only lease.
    await admin.query(`update public.print_jobs set claimed_at=clock_timestamp()-interval '2 minutes',
      claim_expires_at=clock_timestamp()-interval '1 second' where id=$1`, [firstJob.id]);
    const reclaimed = (await actor(b, fixture.agentBUser,
      `select * from public.claim_print_jobs($1,1,60)`, [fixture.restaurant])).rows;
    check('agent B reclaims expired A lease', reclaimed.length === 1
      && reclaimed[0].job_id === firstJob.id && reclaimed[0].attempt_number === 2);
    check('expired attempt remains durable',
      (await admin.query(`select outcome from public.print_job_attempts where id=$1`,
        [claimA[0].attempt_id])).rows[0].outcome === 'lease_expired');

    // Race B's expired lease reclaim by A against B's stale acknowledgement.
    await admin.query(`update public.print_jobs set claimed_at=clock_timestamp()-interval '2 minutes',
      claim_expires_at=clock_timestamp()-interval '1 second' where id=$1`, [firstJob.id]);
    await beginAgent(a, fixture.agentAUser);
    const third = (await a.query(`select * from public.claim_print_jobs($1,1,60)`,
      [fixture.restaurant])).rows[0];
    check('agent A obtains new lease after B expires', third.attempt_number === 3);
    await beginAgent(b, fixture.agentBUser);
    const bPid2 = (await b.query('select pg_backend_pid() pid')).rows[0].pid;
    const staleAck = b.query(`select public.acknowledge_print_job($1,$2,'dispatched')`,
      [firstJob.id, reclaimed[0].attempt_id]).then(() => null, (error) => error);
    await new Promise((resolve) => setTimeout(resolve, 250));
    check('stale acknowledgement waits on reclaim lock',
      (await admin.query(`select cardinality(pg_blocking_pids($1)) blocked`,
        [bPid2])).rows[0].blocked > 0);
    await a.query('commit');
    const staleError = await staleAck;
    check('acknowledgement cannot win after reclaim',
      staleError && /active lease|active print attempt/i.test(staleError.message));
    await b.query('rollback');
    const actualOwner = (await admin.query(`select status,attempt_count,
      claimed_by_agent_id from public.print_jobs where id=$1`, [firstJob.id])).rows[0];
    check('reclaim leaves exactly one active claim', actualOwner.status === 'claimed'
      && actualOwner.attempt_count === 3);

    // Agent A acknowledges its valid third lease. Terminal jobs stay closed.
    const acknowledged = (await actor(a, fixture.agentAUser,
      `select public.acknowledge_print_job($1,$2,'dispatched') value`,
      [firstJob.id, third.attempt_id])).rows[0].value;
    check('valid acknowledgement is terminal with no paper claim',
      acknowledged.status === 'dispatched' && acknowledged.paper_output_confirmed === false);
    check('dispatched job cannot be reclaimed', (await actor(b, fixture.agentBUser,
      `select * from public.claim_print_jobs($1,1,60)`, [fixture.restaurant])).rowCount === 0);

    const newJob = async (label) => (await admin.query(`insert into public.print_jobs
      (restaurant_id,job_type,printer_purpose,automatic_key,order_id,invoice_id,
       kitchen_station_id,kitchen_batch_key,target_printer_id,payload,dispatch_mode)
      values($1,'kitchen_ticket','kitchen',$2,$3,$4,$5,$6,$7,$8::jsonb,'automatic')
      returning id`, [fixture.restaurant, `p2-concurrency:${label}:${id()}`,
        created.order_id, created.invoice_id, fixture.station, label, fixture.printer,
        JSON.stringify({ schema: 'serveflow.kitchen_ticket.v1', items: [] })])).rows[0].id;
    const parallelJobA = await newJob('parallel-a');
    const parallelJobB = await newJob('parallel-b');
    await beginAgent(a, fixture.agentAUser);
    const parallelClaimA = (await a.query(`select * from public.claim_print_jobs($1,1,60)`,
      [fixture.restaurant])).rows[0];
    await beginAgent(b, fixture.agentBUser);
    const parallelClaimB = (await b.query(`select * from public.claim_print_jobs($1,1,60)`,
      [fixture.restaurant])).rows[0];
    check('SKIP LOCKED assigns distinct jobs in parallel',
      new Set([parallelClaimA.job_id, parallelClaimB.job_id]).size === 2
      && [parallelJobA,parallelJobB].includes(parallelClaimA.job_id)
      && [parallelJobA,parallelJobB].includes(parallelClaimB.job_id));
    await a.query('commit');
    await b.query('commit');
    await actor(a, fixture.agentAUser,
      `select public.acknowledge_print_job($1,$2,'dispatched')`,
      [parallelClaimA.job_id, parallelClaimA.attempt_id]);
    await actor(b, fixture.agentBUser,
      `select public.acknowledge_print_job($1,$2,'dispatched')`,
      [parallelClaimB.job_id, parallelClaimB.attempt_id]);

    const retryJob = await newJob('retry-race');
    const retryClaim = (await actor(a, fixture.agentAUser,
      `select * from public.claim_print_jobs($1,1,60)`,
      [fixture.restaurant])).rows[0];
    check('retry fixture claimed by A', retryClaim.job_id === retryJob);
    await beginAgent(a, fixture.agentAUser);
    await a.query(`select public.acknowledge_print_job($1,$2,
      'retryable_failure','PRINTER_UNAVAILABLE','retry race',30)`,
    [retryJob, retryClaim.attempt_id]);
    const retryConcurrentClaim = (await actor(b, fixture.agentBUser,
      `select * from public.claim_print_jobs($1,1,60)`,
      [fixture.restaurant])).rows;
    check('parallel claim cannot take in-flight retry transition', retryConcurrentClaim.length === 0);
    await a.query('commit');
    const retryState = (await admin.query(`select status,available_at,attempt_count
      from public.print_jobs where id=$1`, [retryJob])).rows[0];
    check('retry closes attempt and schedules backoff',
      retryState.status === 'pending' && new Date(retryState.available_at) > new Date()
      && retryState.attempt_count === 1
      && (await admin.query(`select outcome from public.print_job_attempts
        where id=$1`, [retryClaim.attempt_id])).rows[0].outcome === 'retryable_failure');
    check('retry remains unclaimable during backoff', (await actor(b, fixture.agentBUser,
      `select * from public.claim_print_jobs($1,1,60)`, [fixture.restaurant])).rowCount === 0);
    await admin.query(`update public.print_jobs set available_at=clock_timestamp()-interval '1 second'
      where id=$1`, [retryJob]);
    const retrySecond = (await actor(b, fixture.agentBUser,
      `select * from public.claim_print_jobs($1,1,60)`, [fixture.restaurant])).rows[0];
    check('retry becomes claimable after backoff', retrySecond.job_id === retryJob
      && retrySecond.attempt_number === 2);
    await actor(b, fixture.agentBUser,
      `select public.acknowledge_print_job($1,$2,'terminal_failure','PAPER_JAM','audit')`,
      [retryJob, retrySecond.attempt_id]);
    check('terminal failure cannot be reclaimed', (await actor(a, fixture.agentAUser,
      `select * from public.claim_print_jobs($1,1,60)`, [fixture.restaurant])).rowCount === 0);

    const cancelledJob = await newJob('cancelled');
    await admin.query(`update public.print_jobs set status='cancelled' where id=$1`,
      [cancelledJob]);
    check('cancelled job cannot be claimed', (await actor(a, fixture.agentAUser,
      `select * from public.claim_print_jobs($1,1,60)`, [fixture.restaurant])).rowCount === 0);

    const ackWinJob = await newJob('ack-wins');
    const ackWinClaim = (await actor(a, fixture.agentAUser,
      `select * from public.claim_print_jobs($1,1,60)`, [fixture.restaurant])).rows[0];
    check('acknowledgement-race fixture claimed', ackWinClaim.job_id === ackWinJob);
    await admin.query(`update public.print_jobs set claim_expires_at=clock_timestamp()+interval '1 second'
      where id=$1`, [ackWinJob]);
    await beginAgent(a, fixture.agentAUser);
    await a.query(`select public.acknowledge_print_job($1,$2,'dispatched')`,
      [ackWinJob, ackWinClaim.attempt_id]);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await beginAgent(b, fixture.agentBUser);
    const bPid3 = (await b.query('select pg_backend_pid() pid')).rows[0].pid;
    const reclaimAfterAck = b.query(`select * from public.claim_print_jobs($1,1,60)`,
      [fixture.restaurant]);
    await new Promise((resolve) => setTimeout(resolve, 250));
    check('expiry sweep waits behind acknowledgement row lock',
      (await admin.query(`select cardinality(pg_blocking_pids($1)) blocked`,
        [bPid3])).rows[0].blocked > 0);
    await a.query('commit');
    const afterAck = (await reclaimAfterAck).rows;
    await b.query('commit');
    check('acknowledged job never gains a second active claim', afterAck.length === 0
      && (await admin.query(`select status,attempt_count from public.print_jobs
        where id=$1`, [ackWinJob])).rows[0].status === 'dispatched'
      && Number((await admin.query(`select count(*) count from public.print_job_attempts
        where print_job_id=$1`, [ackWinJob])).rows[0].count) === 1);

    const other = { restaurant: id(), slug: `p2-other-${Date.now()}`,
      cashierUser: id(), cashierStaff: id(), agentUser: id(), station: id(),
      category: id(), menu: id(), table: id(), token: id(), printer: id() };
    await admin.query('begin');
    try {
      for (const [userId,label] of [[other.cashierUser,'cashier'],[other.agentUser,'agent']]) {
        await admin.query(`insert into auth.users
          (id,instance_id,aud,role,email,encrypted_password,confirmed_at,created_at,updated_at)
          values($1,'00000000-0000-0000-0000-000000000000','authenticated',
            'authenticated',$2,'',now(),now(),now())`,
        [userId, `${other.slug}-${label}@example.test`]);
      }
      await admin.query(`insert into public.restaurants(id,name,slug,active,payment_policy)
        values($1,'P2 Other Tenant',$2,true,'pay_before_kitchen')`,
      [other.restaurant, other.slug]);
      await admin.query(`insert into public.restaurant_staff
        (id,restaurant_id,user_id,role,display_name,active)
        values($1,$2,$3,'cashier','Other Cashier',true)`,
      [other.cashierStaff, other.restaurant, other.cashierUser]);
      await admin.query(`insert into public.kitchen_stations
        (id,restaurant_id,name,display_color,icon,priority,active,is_default)
        values($1,$2,'Other Kitchen','#2563eb','OK',1,true,true)`,
      [other.station, other.restaurant]);
      await admin.query(`insert into public.categories(id,restaurant_id,name)
        values($1,$2,'Other Category')`, [other.category, other.restaurant]);
      await admin.query(`insert into public.menu_items
        (id,restaurant_id,category_id,name,price,available,kitchen_station_id)
        values($1,$2,$3,'Other Item',10,true,$4)`,
      [other.menu, other.restaurant, other.category, other.station]);
      await admin.query(`insert into public.restaurant_tables
        (id,restaurant_id,table_number,label,qr_token,qr_path,qr_url,active)
        values($1,$2,402,'Other Table',$3,$4,$5,true)`,
      [other.table,other.restaurant,other.token,
        `/r/${other.slug}/order?t=402`,`https://example.test/r/${other.slug}/order?t=402`]);
      await admin.query(`update public.business_printing_settings set
        kitchen_output_mode='single_kitchen_printer',default_print_behaviour='automatic'
        where restaurant_id=$1`, [other.restaurant]);
      await admin.query(`insert into public.business_printers
        (id,restaurant_id,name,purpose,is_default,enabled)
        values($1,$2,'Other Printer','kitchen_order',true,true)`,
      [other.printer,other.restaurant]);
      await admin.query(`insert into public.printer_connections
        (restaurant_id,printer_id,connection_type,network_host,network_port,
         connection_options,active)
        values($1,$2,'network','127.0.0.1',9100,$3::jsonb,true)`,
      [other.restaurant,other.printer,JSON.stringify({ token: 'local-secret' })]);
      await admin.query(`select public.register_print_agent($1,$2,'Other agent')`,
        [other.restaurant,other.agentUser]);
      await admin.query(`update public.print_queue_activations
        set activated_at=clock_timestamp()-interval '1 day' where restaurant_id=$1`,
      [other.restaurant]);
      await admin.query('commit');
    } catch (error) { await admin.query('rollback'); throw error; }
    const otherOrder = (await actor(admin,other.cashierUser,
      `select public.submit_cashier_order_batch($1,'402','Cash',$2::jsonb,'create',null,$3) payload`,
      [other.restaurant,JSON.stringify([{menu_item_id:other.menu,quantity:1}]),id()]
    )).rows[0].payload;
    const otherJob = (await admin.query(`select id,payload from public.print_jobs
      where invoice_id=$1 and job_type='kitchen_ticket'`,[otherOrder.invoice_id])).rows[0];
    check('other tenant has independent claimable job without connection secrets in payload',
      Boolean(otherJob?.id) && !JSON.stringify(otherJob.payload).includes('local-secret'));
    check('restaurant A agent cannot claim B queue', await rejectedActor(a,fixture.agentAUser,
      `select * from public.claim_print_jobs($1,1,60)`,[other.restaurant],
      /registered print agent/i));
    check('restaurant A agent cannot inspect B jobs', await rejectedActor(a,fixture.agentAUser,
      `select * from public.get_print_jobs($1,10)`,[other.restaurant],
      /authorized print operations staff/i));
    check('restaurant A agent cannot acknowledge B job', await rejectedActor(a,fixture.agentAUser,
      `select public.acknowledge_print_job($1,$2,'dispatched')`,[otherJob.id,id()],
      /not found for this agent tenant/i));
    check('restaurant A agent cannot fail B job', await rejectedActor(a,fixture.agentAUser,
      `select public.acknowledge_print_job($1,$2,'terminal_failure','PAPER_JAM')`,
      [otherJob.id,id()],/not found for this agent tenant/i));
    const otherClaim = (await actor(b,other.agentUser,
      `select * from public.claim_print_jobs($1,1,60)`,[other.restaurant])).rows[0];
    check('tenant B agent owns only B job',otherClaim.job_id===otherJob.id);
    check('restaurant A agent cannot fetch B printer connection',
      (await actor(a,fixture.agentAUser,
        `select * from public.get_claimed_print_job_connection($1)`,
        [otherJob.id])).rowCount===0);
    const otherConnection = (await actor(b,other.agentUser,
      `select * from public.get_claimed_print_job_connection($1)`,
      [otherJob.id])).rows[0];
    check('tenant B owner can fetch own printer connection under lease',
      otherConnection.printer_id===other.printer
      && otherConnection.connection_options.token==='local-secret');

    const makeQRTable = async (number) => {
      const tableId=id(); const token=id();
      await admin.query(`insert into public.restaurant_tables
        (id,restaurant_id,table_number,label,qr_token,qr_path,qr_url,active)
        values($1,$2,$3,$4,$5,$6,$7,true)`,
      [tableId,fixture.restaurant,number,`P2 QR ${number}`,token,
        `/r/${fixture.slug}/order?t=${number}`,
        `https://example.test/r/${fixture.slug}/order?t=${number}`]);
      return { number, token };
    };
    const qrEarly = await makeQRTable(403);
    const early = (await anonymous(admin,
      `select public.create_public_qr_order($1,$2,$3,'P2 Early QR','Cash',$4::jsonb) payload`,
      [fixture.slug,String(qrEarly.number),qrEarly.token,
        JSON.stringify([{menu_item_id:fixture.menu,quantity:1}])])).rows[0].payload;
    check('unpaid QR before activation has zero Kitchen jobs',
      Number((await admin.query(`select count(*) count from public.print_jobs
        where invoice_id=$1 and job_type='kitchen_ticket'`,[early.invoice_id])).rows[0].count)===0);
    await admin.query(`update public.print_queue_activations
      set activated_at=clock_timestamp() where restaurant_id=$1`,[fixture.restaurant]);
    await actor(admin,fixture.cashierUser,
      `select public.open_cashier_shift($1,0,'P2 activation audit')`,[fixture.restaurant]);
    await actor(admin,fixture.cashierUser,
      `select public.verify_dining_session_payment($1,'Cash',null,null,null,false)`,
      [early.order_id]);
    check('QR created before activation prints when paid after cutoff',
      Number((await admin.query(`select count(*) count from public.print_jobs
        where invoice_id=$1 and job_type='kitchen_ticket'`,
        [early.invoice_id])).rows[0].count)===1);
    const qrLate = await makeQRTable(404);
    await admin.query(`update public.print_queue_activations
      set activated_at=clock_timestamp()+interval '1 day' where restaurant_id=$1`,
      [fixture.restaurant]);
    const late = (await anonymous(admin,
      `select public.create_public_qr_order($1,$2,$3,'P2 Historical QR','Cash',$4::jsonb) payload`,
      [fixture.slug,String(qrLate.number),qrLate.token,
        JSON.stringify([{menu_item_id:fixture.menu,quantity:1}])])).rows[0].payload;
    await actor(admin,fixture.cashierUser,
      `select public.verify_dining_session_payment($1,'Cash',null,null,null,false)`,
      [late.order_id]);
    await admin.query(`update public.print_queue_activations
      set activated_at=clock_timestamp() where restaurant_id=$1`,[fixture.restaurant]);
    await admin.query(`select public.enqueue_kitchen_print_jobs($1,$2)`,
      [fixture.restaurant,late.invoice_id]);
    await admin.query(`select public.enqueue_receipt_print_job($1,$2)`,
      [fixture.restaurant,late.invoice_id]);
    check('historical paid QR and receipt stay excluded after activation',
      Number((await admin.query(`select count(*) count from public.print_jobs
        where invoice_id=$1`,[late.invoice_id])).rows[0].count)===0);
    console.log(`P2_CONCURRENCY_AUDIT ${passed} passed, 0 failed`);
  } finally {
    for (const db of [a,b,admin]) {
      await db.query('rollback').catch(() => {});
      await db.end().catch(() => {});
    }
  }
}
run().catch((error) => { console.error('P2_CONCURRENCY_AUDIT FAILED', error.message);
  process.exitCode = 1; });

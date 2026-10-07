// Printer P2 candidate audit. All candidate DDL and fixtures remain in one
// transaction and are always rolled back.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Client } = require('pg');
const runWorkflowMatrix = require('./printer-p2-workflow-matrix.cjs');

const envLine = fs.readFileSync(path.join(__dirname, '..', 'connection.env'), 'utf8')
  .split(/\r?\n/).find((line) => /^\s*SUPABASE_DB_URL\s*=/.test(line));
if (!envLine) throw new Error('SUPABASE_DB_URL missing');
const connectionString = envLine.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, '')
  .trim().replace(/^['"]|['"]$/g, '');
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000, query_timeout: 120000, keepAlive: true });
const id = () => crypto.randomUUID();
function pendingCondition(job) {
  if (job.status !== 'pending') return job.status;
  if (job.target_printer_id === null) return 'unrouted';
  if (job.dispatch_mode === 'on_demand') return 'on_demand';
  if (new Date(job.available_at) > new Date(job.db_now)) return 'backoff';
  return 'routed_available';
}
async function asActor(role, userId, sql, params = []) {
  await client.query(`set local role ${role}`);
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId ?? '']);
  const result = await client.query(sql, params);
  await client.query('reset role');
  return result;
}
async function rejected(label, role, userId, sql, params, pattern) {
  await client.query('savepoint expected_rejection');
  let error;
  try {
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId ?? '']);
    await client.query(sql, params);
  }
  catch (caught) { error = caught; }
  await client.query('rollback to savepoint expected_rejection');
  assert.ok(error && pattern.test(error.message), `${label}: ${error?.message ?? 'unexpected success'}`);
  console.log(`PASS ${label}`);
}

async function run() {
  await client.connect();
  try {
    const before = (await client.query(`select p.oid::regprocedure::text signature,
      has_function_privilege('anon',p.oid,'EXECUTE') anon,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
      has_function_privilege('service_role',p.oid,'EXECUTE') service_role,
      pg_get_functiondef(p.oid) definition
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='print_final_dining_bill'`)).rows;
    console.log('receipt_rpc_before', JSON.stringify(before.map(({ definition, ...row }) => row)));
    assert.equal(before.length, 1);
    console.log('receipt_inner_auth_checks', before[0].definition.match(/auth\.uid\(\)|active|role|cashier/gi));
    const chain = (await client.query(`select p.proname, pg_get_functiondef(p.oid) definition,
      has_function_privilege('anon',p.oid,'EXECUTE') anon_execute
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like 'print_final_dining_bill%'`)).rows;
    console.log('receipt_chain', JSON.stringify(chain.map((row) => ({
      name: row.proname, anon_execute: row.anon_execute,
      auth_checks: row.definition.match(/.{0,75}(auth\.uid\(\)|has_staff_role|active.*cashier|cashier.*active).{0,75}/gi),
    }))));
    const status = (await client.query(`select version from supabase_migrations.schema_migrations
      where version in ('271','272') order by version`)).rows;
    console.log('migration_status_before', JSON.stringify(status));
    const fixtures = (await client.query(`select r.id restaurant_id,
      (select count(*) from public.business_printers p where p.restaurant_id=r.id) printers,
      (select count(*) from public.order_invoices i where i.restaurant_id=r.id) invoices,
      (select count(*) from public.restaurant_staff s where s.restaurant_id=r.id and s.active and s.role::text='owner') owners
      from public.restaurants r order by r.created_at limit 8`)).rows;
    console.log('fixture_inventory', JSON.stringify(fixtures));

    await client.query('begin');
    await client.query("set local statement_timeout='90s'");
    if (process.env.P2_DEPLOYED === '1') {
      assert.deepEqual(status.map((row) => row.version), ['271', '272']);
      console.log('PASS deployed migration 272 present; using live schema');
    } else {
      await client.query(fs.readFileSync(path.join(__dirname, '..', 'migrations',
        '272_durable_print_job_queue.sql'), 'utf8'));
      console.log('PASS migration 272 applies in rollback transaction');
    }
    const after = (await client.query(`select p.oid::regprocedure::text signature,
      has_function_privilege('anon',p.oid,'EXECUTE') anon,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
      has_function_privilege('service_role',p.oid,'EXECUTE') service_role
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='print_final_dining_bill'`)).rows;
    console.log('receipt_rpc_after', JSON.stringify(after));
    assert.equal(after[0].anon, false);
    assert.equal(after[0].authenticated, true);
    assert.equal(after[0].service_role, true);
    console.log('PASS receipt RPC grants');
    await rejected('anon final bill invocation denied', 'anon', null,
      `select public.print_final_dining_bill($1,'80mm')`, [id()], /permission denied/i);
    const billFixture = (await client.query(`select o.id order_id,s.user_id cashier_user_id
      from public.orders o join public.restaurant_staff s on s.restaurant_id=o.restaurant_id
        and s.active and s.role::text='cashier' and s.user_id is not null
      where o.restaurant_id=$1 and o.dining_session_status in ('open','closed','checked_out')
        and exists(select 1 from public.order_invoices i where i.order_id=o.id
          and i.restaurant_id=o.restaurant_id and i.status='verified'
          and i.verified_at is not null)
        and not exists(select 1 from public.order_invoices i where i.order_id=o.id
          and i.restaurant_id=o.restaurant_id
          and i.status not in ('verified','cancelled','refunded'))
        and not exists(select 1 from public.order_items x where x.order_id=o.id
          and x.restaurant_id=o.restaurant_id and x.kitchen_status<>'completed')
      limit 1`, [fixtures[0].restaurant_id])).rows[0];
    if (billFixture) {
      const bill = (await asActor('authenticated', billFixture.cashier_user_id,
        `select public.print_final_dining_bill($1,'80mm') payload`,
        [billFixture.order_id])).rows[0].payload;
      assert.ok(bill?.bill?.id && bill?.totals);
      console.log('PASS authorized Cashier final bill RPC remains functional');
      for (const role of ['manager','owner']) {
        const roleUser=(await client.query(`select user_id from public.restaurant_staff
          where restaurant_id=$1 and active and role::text=$2 and user_id is not null
          limit 1`,[fixtures[0].restaurant_id,role])).rows[0]?.user_id;
        assert.ok(roleUser,`${role} actor required for receipt grant regression`);
        const roleBill=(await asActor('authenticated',roleUser,
          `select public.print_final_dining_bill($1,'80mm') payload`,
          [billFixture.order_id])).rows[0].payload;
        assert.ok(roleBill?.bill?.id && roleBill?.totals);
        console.log(`PASS authorized ${role} final bill RPC remains functional`);
      }
      await client.query("select set_config('request.jwt.claim.sub','',true)");
    } else {
      console.log('LIMITED authorized final bill: no fully settled fixture available');
    }
    await client.query('savepoint p2_workflow_matrix');
    await runWorkflowMatrix({ client, asActor, id, check(label, condition) {
      assert.ok(condition, label);
      console.log(`PASS ${label}`);
    } });
    await client.query('rollback to savepoint p2_workflow_matrix');
    console.log('PASS canonical workflow matrix rolled back independently');
    const candidates = (await client.query(`select
      count(*) filter (where o.dining_session_status='open'
        and o.operational_status in ('accepted','preparing','ready')
        and public.invoice_is_kitchen_eligible(i.restaurant_id,i.id)) open_kitchen,
      count(*) filter (where i.payment_status='paid' and i.paid_at is not null) paid,
      count(*) filter (where i.payment_status='paid' and i.paid_at is not null
        and exists(select 1 from public.receipt_generation_events e
          where e.restaurant_id=i.restaurant_id and e.invoice_id=i.id)) paid_with_receipt_event
      from public.order_invoices i join public.orders o
        on o.restaurant_id=i.restaurant_id and o.id=i.order_id
      where i.restaurant_id=$1`, [fixtures[0].restaurant_id])).rows[0];
    console.log('candidate_inventory', JSON.stringify(candidates));
    const tenant = (await client.query(`select i.restaurant_id, i.id invoice_id, i.order_id,
      s.id station_id, p.id printer_id,
      (select user_id from public.restaurant_staff staff where staff.restaurant_id=i.restaurant_id
        and staff.active and staff.role::text='owner' and staff.user_id is not null limit 1) owner_user_id
      from public.order_invoices i
      join public.order_items oi on oi.restaurant_id=i.restaurant_id and oi.invoice_id=i.id
      join public.kitchen_stations s on s.restaurant_id=oi.restaurant_id and s.id=oi.kitchen_station_id
      join public.business_printers p on p.restaurant_id=i.restaurant_id
        and p.enabled and p.deleted_at is null
      where i.restaurant_id=$1 limit 1`, [fixtures[0].restaurant_id])).rows[0];
    assert.ok(tenant?.owner_user_id, 'Queue fixture requires invoice, station, printer, and owner');
    const agentUserId = id();
    await client.query(`insert into auth.users
      (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
      values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now(),now())`,
    [agentUserId, `printer-p2-${agentUserId}@example.test`]);
    const agentId = (await client.query(`select public.register_print_agent($1,$2,'Rollback audit agent') id`,
      [tenant.restaurant_id, agentUserId])).rows[0].id;
    assert.ok(agentId);
    console.log('PASS dedicated agent registration');
    const jobId = (await client.query(`insert into public.print_jobs
      (restaurant_id,job_type,printer_purpose,automatic_key,order_id,invoice_id,
       kitchen_station_id,kitchen_batch_key,target_printer_id,payload)
      values ($1,'kitchen_ticket','kitchen',$2,$3,$4,$5,'p2-audit',$6,$7::jsonb)
      returning id`, [tenant.restaurant_id, `kitchen:p2-audit:${id()}`,
        tenant.order_id, tenant.invoice_id, tenant.station_id, tenant.printer_id,
        JSON.stringify({ schema: 'serveflow.kitchen_ticket.v1', items: [] })])).rows[0].id;
    const initialPending = (await client.query(`select status,target_printer_id,
      dispatch_mode,available_at,clock_timestamp() db_now
      from public.print_jobs where id=$1`,[jobId])).rows[0];
    assert.equal(pendingCondition(initialPending),'routed_available');
    console.log('PASS routed available pending state is explicit');
    const claimed = (await asActor('authenticated', agentUserId,
      `select * from public.claim_print_jobs($1,1,60)`, [tenant.restaurant_id])).rows;
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].job_id, jobId);
    console.log('PASS agent scoped claim');
    const noSecondClaim = (await asActor('authenticated', agentUserId,
      `select * from public.claim_print_jobs($1,1,60)`, [tenant.restaurant_id])).rows;
    assert.equal(noSecondClaim.length, 0);
    console.log('PASS active lease not reclaimed');
    const retry = (await asActor('authenticated', agentUserId,
      `select public.acknowledge_print_job($1,$2,'retryable_failure','PRINTER_UNAVAILABLE','audit',5) value`,
      [jobId, claimed[0].attempt_id])).rows[0].value;
    assert.equal(retry.status, 'pending');
    assert.equal((await client.query(`select outcome from public.print_job_attempts where id=$1`,
      [claimed[0].attempt_id])).rows[0].outcome, 'retryable_failure');
    assert.equal((await asActor('authenticated', agentUserId,
      `select * from public.claim_print_jobs($1,1,60)`, [tenant.restaurant_id])).rowCount, 0);
    const backoff = (await client.query(`select status,target_printer_id,
      dispatch_mode,available_at,clock_timestamp() db_now
      from public.print_jobs where id=$1`,[jobId])).rows[0];
    assert.equal(pendingCondition(backoff),'backoff');
    console.log('PASS retry history and backoff');
    await client.query(`update public.print_jobs set available_at=clock_timestamp()-interval '1 second'
      where id=$1`, [jobId]);
    const second = (await asActor('authenticated', agentUserId,
      `select * from public.claim_print_jobs($1,1,60)`, [tenant.restaurant_id])).rows[0];
    assert.equal(second.attempt_number, 2);
    await client.query(`update public.print_jobs set claimed_at=clock_timestamp()-interval '2 minutes',
      claim_expires_at=clock_timestamp()-interval '1 second'
      where id=$1`, [jobId]);
    const third = (await asActor('authenticated', agentUserId,
      `select * from public.claim_print_jobs($1,1,60)`, [tenant.restaurant_id])).rows[0];
    assert.equal(third.attempt_number, 3);
    assert.equal((await client.query(`select outcome from public.print_job_attempts
      where id=$1`, [second.attempt_id])).rows[0].outcome, 'lease_expired');
    console.log('PASS expired lease recovery and durable attempts');
    await rejected('stale acknowledgement rejected', 'authenticated', agentUserId,
      `select public.acknowledge_print_job($1,$2,'dispatched')`,
      [jobId, second.attempt_id], /active print attempt|active lease/i);
    const dispatched = (await asActor('authenticated', agentUserId,
      `select public.acknowledge_print_job($1,$2,'dispatched') value`,
      [jobId, third.attempt_id])).rows[0].value;
    assert.equal(dispatched.status, 'dispatched');
    assert.equal(dispatched.paper_output_confirmed, false);
    assert.equal((await asActor('authenticated', agentUserId,
      `select * from public.claim_print_jobs($1,1,60)`, [tenant.restaurant_id])).rowCount, 0);
    console.log('PASS terminal dispatch not reclaimed');
    const reprint1 = (await asActor('authenticated', tenant.owner_user_id,
      `select public.request_print_job_reprint($1,'Audit reprint') id`, [jobId])).rows[0].id;
    const reprint2 = (await asActor('authenticated', tenant.owner_user_id,
      `select public.request_print_job_reprint($1,'Second audit reprint') id`, [jobId])).rows[0].id;
    assert.notEqual(reprint1, reprint2);
    assert.equal((await client.query(`select count(*)::integer count from public.print_jobs
      where original_job_id=$1`, [jobId])).rows[0].count, 2);
    console.log('PASS separate audited manual reprints');
    const terminalClaim = (await asActor('authenticated', agentUserId,
      `select * from public.claim_print_jobs($1,1,60)`, [tenant.restaurant_id])).rows[0];
    assert.ok([reprint1, reprint2].includes(terminalClaim.job_id));
    const cancelledId = terminalClaim.job_id === reprint1 ? reprint2 : reprint1;
    const terminalResult = (await asActor('authenticated', agentUserId,
      `select public.acknowledge_print_job($1,$2,'terminal_failure','PAPER_JAM','audit') value`,
      [terminalClaim.job_id, terminalClaim.attempt_id])).rows[0].value;
    assert.equal(terminalResult.status, 'failed');
    await client.query(`update public.print_jobs set status='cancelled',updated_at=clock_timestamp()
      where id=$1`, [cancelledId]);
    assert.equal((await asActor('authenticated', agentUserId,
      `select * from public.claim_print_jobs($1,10,60)`, [tenant.restaurant_id])).rowCount, 0);
    console.log('PASS terminal failure and cancellation excluded from claims');
    await rejected('anon queue execution denied', 'anon', null,
      `select * from public.claim_print_jobs($1,1,60)`, [tenant.restaurant_id], /permission denied/i);
    await rejected('staff cannot claim agent queue', 'authenticated', tenant.owner_user_id,
      `select * from public.claim_print_jobs($1,1,60)`, [tenant.restaurant_id], /registered print agent/i);
    await rejected('agent cannot claim another restaurant', 'authenticated', agentUserId,
      `select * from public.claim_print_jobs($1,1,60)`, [fixtures[4].restaurant_id],
      /registered print agent/i);
    await rejected('agent cannot acknowledge another restaurant job', 'authenticated', agentUserId,
      `select public.acknowledge_print_job($1,$2,'dispatched')`, [id(), id()],
      /not found for this agent tenant/i);
    assert.equal((await asActor('authenticated', agentUserId,
      `select * from public.get_claimed_print_job_connection($1)`, [jobId])).rowCount, 0);
    console.log('PASS agent cannot read unclaimed connection');
    await rejected('automatic job key unique', 'service_role', null,
      `insert into public.print_jobs
      (restaurant_id,job_type,printer_purpose,automatic_key,order_id,invoice_id,
       kitchen_station_id,kitchen_batch_key,target_printer_id,payload)
       select restaurant_id,job_type,printer_purpose,automatic_key,order_id,invoice_id,
       kitchen_station_id,kitchen_batch_key,target_printer_id,payload
       from public.print_jobs where id=$1`, [jobId], /duplicate key/i);
    await rejected('job payload immutable', 'service_role', null,
      `update public.print_jobs set payload='{}'::jsonb where id=$1`, [jobId],
      /immutable/i);
    await rejected('anon cannot read queue table', 'anon', null,
      `select * from public.print_jobs limit 1`, [], /permission denied/i);
    const tenantB = (await client.query(`select i.restaurant_id, i.id invoice_id, i.order_id,
      oi.kitchen_station_id station_id
      from public.order_invoices i
      join public.order_items oi on oi.restaurant_id=i.restaurant_id and oi.invoice_id=i.id
      where i.restaurant_id <> $1 and oi.kitchen_station_id is not null limit 1`,
      [tenant.restaurant_id])).rows[0];
    if (tenantB) {
      const tenantBJobId = (await client.query(`insert into public.print_jobs
        (restaurant_id,job_type,printer_purpose,automatic_key,order_id,invoice_id,
         kitchen_station_id,kitchen_batch_key,payload)
        values ($1,'kitchen_ticket','kitchen',$2,$3,$4,$5,$6,'{}'::jsonb)
        returning id`, [tenantB.restaurant_id, `kitchen:p2-security:${id()}`,
        tenantB.order_id, tenantB.invoice_id, tenantB.station_id,
        `p2-security-${id()}`])).rows[0].id;
      await rejected('agent cannot acknowledge real tenant B fixture job',
        'authenticated', agentUserId,
        `select public.acknowledge_print_job($1,$2,'dispatched')`,
        [tenantBJobId, id()], /not found for this agent tenant/i);
      await rejected('agent cannot fail real tenant B fixture job',
        'authenticated', agentUserId,
        `select public.acknowledge_print_job($1,$2,'terminal_failure','PAPER_JAM')`,
        [tenantBJobId, id()], /not found for this agent tenant/i);
      assert.equal((await asActor('authenticated', agentUserId,
        `select * from public.get_claimed_print_job_connection($1)`,
        [tenantBJobId])).rowCount, 0);
      console.log('PASS agent cannot fetch tenant B printer connection');
      await rejected('cross tenant printer FK rejected', 'service_role', null,
        `insert into public.print_jobs
        (restaurant_id,job_type,printer_purpose,automatic_key,order_id,invoice_id,
         kitchen_station_id,kitchen_batch_key,target_printer_id,payload)
        values ($1,'kitchen_ticket','kitchen',$2,$3,$4,$5,'p2-cross-printer',$6,'{}'::jsonb)`,
        [tenantB.restaurant_id, `kitchen:p2-cross-printer:${id()}`, tenantB.order_id,
          tenantB.invoice_id, tenantB.station_id, tenant.printer_id], /foreign key/i);
      await rejected('cross tenant station FK rejected', 'service_role', null,
        `insert into public.print_jobs
        (restaurant_id,job_type,printer_purpose,automatic_key,order_id,invoice_id,
         kitchen_station_id,kitchen_batch_key,payload)
        values ($1,'kitchen_ticket','kitchen',$2,$3,$4,$5,'p2-cross-station','{}'::jsonb)`,
        [tenant.restaurant_id, `kitchen:p2-cross-station:${id()}`, tenant.order_id,
          tenant.invoice_id, tenantB.station_id], /foreign key/i);
      await rejected('tenant A owner cannot read tenant B jobs', 'authenticated', tenant.owner_user_id,
        `select * from public.get_print_jobs($1,10)`, [tenantB.restaurant_id],
        /authorized print operations staff/i);
    } else {
      console.log('LIMITED cross tenant FK checks: second tenant with station and invoice unavailable');
    }
    const historical = (await asActor('authenticated', tenant.owner_user_id,
      `select public.reconcile_print_jobs($1,$2) result`,
      [tenant.restaurant_id, tenant.invoice_id])).rows[0].result;
    assert.equal(historical.kitchen_jobs_created, 0);
    assert.equal(historical.receipt_jobs_created, 0);
    console.log('PASS activation boundary excludes historical invoice');
    const kitchenInvoice = (await client.query(`select i.id from public.order_invoices i
      join public.orders o on o.restaurant_id=i.restaurant_id and o.id=i.order_id
      where i.restaurant_id=$1 and o.dining_session_status='open'
        and o.table_released_at is null
        and o.operational_status in ('accepted','preparing','ready')
        and public.invoice_is_kitchen_eligible(i.restaurant_id,i.id)
        and exists(select 1 from public.order_items oi
          where oi.restaurant_id=i.restaurant_id and oi.invoice_id=i.id
            and oi.kitchen_status in ('accepted','preparing','ready')
            and oi.kitchen_station_id is not null)
      limit 1`, [tenant.restaurant_id])).rows[0];
    assert.ok(kitchenInvoice, 'An open Kitchen invoice is required');
    const paidInvoice = (await client.query(`select i.id from public.order_invoices i
      where i.restaurant_id=$1 and i.payment_status='paid' and i.paid_at is not null
        and exists(select 1 from public.receipt_generation_events e
          where e.restaurant_id=i.restaurant_id and e.invoice_id=i.id)
      limit 1`, [tenant.restaurant_id])).rows[0];
    assert.ok(paidInvoice, 'A paid receipt event is required');
    await client.query(`update public.print_queue_activations
      set activated_at='2000-01-01'::timestamptz where restaurant_id=$1`,
      [tenant.restaurant_id]);
    const firstKitchen = (await client.query(`select public.enqueue_kitchen_print_jobs($1,$2) count`,
      [tenant.restaurant_id, kitchenInvoice.id])).rows[0].count;
    assert.ok(firstKitchen >= 1);
    const kitchenJobs = (await client.query(`select id, kitchen_station_id, kitchen_batch_key, payload,
      target_printer_id from public.print_jobs where restaurant_id=$1 and invoice_id=$2
      and job_type='kitchen_ticket' and request_kind='automatic'`,
      [tenant.restaurant_id, kitchenInvoice.id])).rows;
    assert.equal(kitchenJobs.length, firstKitchen);
    assert.equal(new Set(kitchenJobs.map((job) =>
      `${job.kitchen_station_id}:${job.kitchen_batch_key}`)).size, kitchenJobs.length);
    assert.ok(kitchenJobs.every((job) => job.payload.items.length >= 1
      && !('grand_total' in job.payload.invoice)
      && !('payment_method' in job.payload.invoice)
      && !('connection_options' in job.payload)));
    assert.equal((await client.query(`select public.enqueue_kitchen_print_jobs($1,$2) count`,
      [tenant.restaurant_id, kitchenInvoice.id])).rows[0].count, 0);
    console.log(`PASS Kitchen grouping and idempotent reconciliation (${kitchenJobs.length} tickets)`);
    const firstReceipt = (await client.query(`select public.enqueue_receipt_print_job($1,$2) count`,
      [tenant.restaurant_id, paidInvoice.id])).rows[0].count;
    assert.equal(firstReceipt, 1);
    assert.equal((await client.query(`select public.enqueue_receipt_print_job($1,$2) count`,
      [tenant.restaurant_id, paidInvoice.id])).rows[0].count, 0);
    const receiptJob = (await client.query(`select * from public.print_jobs
      where restaurant_id=$1 and invoice_id=$2 and job_type='receipt'`,
      [tenant.restaurant_id, paidInvoice.id])).rows[0];
    assert.ok(receiptJob.payload.invoice.grand_total !== undefined);
    assert.equal(receiptJob.kitchen_station_id, null);
    console.log('PASS independent idempotent receipt job');
    await client.query(`update public.print_jobs set dispatch_mode='on_demand'
      where id=$1`, [receiptJob.id]);
    assert.equal(pendingCondition((await client.query(`select status,target_printer_id,
      dispatch_mode,available_at,clock_timestamp() db_now from public.print_jobs where id=$1`,
      [receiptJob.id])).rows[0]),'on_demand');
    console.log('PASS on-demand pending state is explicit');
    assert.equal((await asActor('authenticated', tenant.owner_user_id,
      `select public.request_print_job_dispatch($1) id`, [receiptJob.id])).rows[0].id,
    receiptJob.id);
    await client.query(`select public.enqueue_receipt_print_job($1,$2)`,
      [tenant.restaurant_id, paidInvoice.id]);
    assert.equal((await client.query(`select dispatch_mode from public.print_jobs
      where id=$1`, [receiptJob.id])).rows[0].dispatch_mode, 'automatic');
    console.log('PASS authorized on-demand dispatch release');
    const kdsMode = (await client.query(`select public.resolve_print_job_printer($1,'kitchen_ticket',$2) id`,
      [tenant.restaurant_id, kitchenJobs[0].kitchen_station_id])).rows[0].id;
    console.log('kitchen_route_under_current_settings', kdsMode);
    await client.query(`update public.business_printing_settings
      set kitchen_output_mode='kds' where restaurant_id=$1`, [tenant.restaurant_id]);
    assert.equal((await client.query(`select public.resolve_print_job_printer($1,'kitchen_ticket',$2) id`,
      [tenant.restaurant_id, kitchenJobs[0].kitchen_station_id])).rows[0].id, null);
    console.log('PASS KDS-only mode never resolves physical printer');
    await client.query(`select public.enqueue_kitchen_print_jobs($1,$2)`,
      [tenant.restaurant_id, kitchenInvoice.id]);
    const unresolved = (await client.query(`select count(*)::integer count
      from public.print_jobs where restaurant_id=$1 and invoice_id=$2
      and job_type='kitchen_ticket' and status='pending' and target_printer_id is null`,
      [tenant.restaurant_id, kitchenInvoice.id])).rows[0].count;
    assert.equal(unresolved, kitchenJobs.length);
    const unresolvedJob=(await client.query(`select status,target_printer_id,
      dispatch_mode,available_at,clock_timestamp() db_now from public.print_jobs
      where restaurant_id=$1 and invoice_id=$2 and job_type='kitchen_ticket' limit 1`,
      [tenant.restaurant_id,kitchenInvoice.id])).rows[0];
    assert.equal(pendingCondition(unresolvedJob),'unrouted');
    console.log('PASS unresolved Kitchen intent remains durable without a printer');
    await client.query(`create function public.p2_audit_fail_receipt_enqueue()
      returns trigger language plpgsql as $$ begin
        if new.job_type='receipt' then raise exception 'P2_AUDIT_QUEUE_DOWN'; end if;
        return new;
      end; $$`);
    await client.query(`create trigger p2_audit_fail_receipt_enqueue
      before insert on public.print_jobs for each row
      execute function public.p2_audit_fail_receipt_enqueue()`);
    const paymentUpdate = await client.query(`update public.order_invoices
      set updated_at=updated_at where id=$1 and restaurant_id=$2`,
      [paidInvoice.id, tenant.restaurant_id]);
    assert.equal(paymentUpdate.rowCount, 1);
    await client.query('set constraints order_invoices_enqueue_print_jobs immediate');
    assert.equal((await client.query(`select payment_status from public.order_invoices
      where id=$1`, [paidInvoice.id])).rows[0].payment_status, 'paid');
    console.log('PASS receipt enqueue fault cannot roll back paid invoice update');
  } finally {
    try { await client.query('rollback'); } finally { await client.end(); }
  }
}
run().catch((error) => { console.error(error.code ?? '', error.message); process.exitCode = 1; });

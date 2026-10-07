const assert = require('node:assert/strict');

module.exports = async function runWorkflowMatrix({ client, asActor, id, check }) {
  const tenant = (await client.query(`select id,slug from public.restaurants
    where slug='grand-royal' and active limit 1`)).rows[0];
  assert.ok(tenant, 'Workflow tenant unavailable');
  const staff = (await client.query(`select id,user_id,role::text role,display_name,
    assigned_kitchen_station_id from public.restaurant_staff
    where restaurant_id=$1 and active and user_id is not null`, [tenant.id])).rows;
  const cashier = staff.find((row) => row.role === 'cashier');
  const owner = staff.find((row) => row.role === 'owner');
  assert.ok(cashier && owner, 'Cashier and owner actors required');
  const tables = (await client.query(`select t.id,t.table_number,t.qr_token,a.waiter_staff_id
    from public.restaurant_tables t
    left join public.restaurant_table_waiter_assignments a
      on a.restaurant_id=t.restaurant_id and a.table_id=t.id and a.active
    where t.restaurant_id=$1 and t.active and t.qr_token is not null
      and not exists (select 1 from public.orders o where o.restaurant_id=t.restaurant_id
        and o.table_number=t.table_number::text and o.dining_session_status='open')
    order by t.table_number`, [tenant.id])).rows;
  const assigned = tables.filter((table) => staff.some((person) =>
    person.role === 'waiter' && person.id === table.waiter_staff_id));
  const cashierTable = assigned[0];
  const waiterTable = assigned[1];
  const qrTable = assigned[2];
  assert.ok(cashierTable && waiterTable && qrTable, 'Three free waiter-assigned QR tables required');
  const waiter = staff.find((person) => person.id === waiterTable.waiter_staff_id);
  const cashierTableWaiter = staff.find((person) => person.id === cashierTable.waiter_staff_id);
  const qrWaiter = staff.find((person) => person.id === qrTable.waiter_staff_id);
  const stations = (await client.query(`select id from public.kitchen_stations
    where restaurant_id=$1 and active order by priority,id limit 2`, [tenant.id])).rows;
  const category = (await client.query(`select id from public.categories
    where restaurant_id=$1 order by id limit 1`, [tenant.id])).rows[0];
  assert.ok(stations.length === 2 && category, 'Two active stations and a category required');
  const catalog = (await client.query(`insert into public.menu_items
    (id,restaurant_id,category_id,name,price,available,kitchen_station_id) values
    ($1,$4,$5,'P2 Audit Burger',100,true,$6),
    ($2,$4,$5,'P2 Audit Fries',40,true,$6),
    ($3,$4,$5,'P2 Audit Coffee',25,true,$7)
    returning id,name,price,kitchen_station_id`,
    [id(), id(), id(), tenant.id, category.id, stations[0].id, stations[1].id])).rows;
  const [main, secondMain, bar] = catalog;
  const items = (...entries) => JSON.stringify(entries.map(([menu, quantity]) =>
    ({ menu_item_id: menu.id, quantity })));
  const jobsFor = async (invoiceId) => (await client.query(`select j.id,j.invoice_id,j.order_id,
    j.kitchen_station_id,j.kitchen_batch_key,j.automatic_key,j.status,j.target_printer_id,
    j.payload,j.created_at from public.print_jobs j where j.restaurant_id=$1
      and j.invoice_id=$2 and j.job_type='kitchen_ticket' and j.request_kind='automatic'
    order by j.kitchen_station_id,j.kitchen_batch_key`, [tenant.id, invoiceId])).rows;
  const receiptFor = async (invoiceId) => (await client.query(`select * from public.print_jobs
    where restaurant_id=$1 and invoice_id=$2 and job_type='receipt'
      and request_kind='automatic'`, [tenant.id, invoiceId])).rows;
  const reconcile = async (invoiceId) => asActor('authenticated', owner.user_id,
    `select public.reconcile_print_jobs($1,$2) result`, [tenant.id, invoiceId]);
  const membership = async (job) => (await client.query(`select order_item_id from
    public.print_job_order_items where print_job_id=$1 order by line_position`, [job.id]))
    .rows.map((row) => row.order_item_id);
  const itemsFor = async (invoiceId) => (await client.query(`select id,menu_item_id,
    kitchen_station_id,appended_at from public.order_items where invoice_id=$1
    order by id`, [invoiceId])).rows;

  await client.query(`set constraints order_items_enqueue_print_jobs,
    order_invoices_enqueue_print_jobs,receipt_events_enqueue_print_jobs immediate`);
  // Canonical RPCs use transaction_timestamp() for created_at. In this
  // rollback audit, migration DDL and workflow share a transaction, whereas
  // deployment would commit before a new order transaction begins.
  await client.query(`update public.print_queue_activations
    set activated_at=transaction_timestamp()-interval '1 second'
    where restaurant_id=$1`, [tenant.id]);

  const cashierCreate = (await asActor('authenticated', cashier.user_id,
    `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'create',null,$4) payload`,
    [tenant.id, String(cashierTable.table_number),
      items([main, 2], [secondMain, 1], [bar, 2]), id()])).rows[0].payload;
  const cashierInitialJobs = await jobsFor(cashierCreate.invoice_id);
  const cashierInitialItems = await itemsFor(cashierCreate.invoice_id);
  check('Cashier creates two station tickets', cashierInitialJobs.length === 2);
  check('No agent online leaves routed Kitchen work pending',
    cashierInitialJobs.some((job) => job.target_printer_id && job.status === 'pending')
    && Number((await client.query(`select count(*) count from public.print_agents
      where restaurant_id=$1`,[tenant.id])).rows[0].count) === 0);
  check('Same-station items group into one ticket', cashierInitialJobs.some((job) =>
    job.kitchen_station_id === main.kitchen_station_id && job.payload.items.length === 2));
  check('Different station gets separate ticket', cashierInitialJobs.some((job) =>
    job.kitchen_station_id === bar.kitchen_station_id && job.payload.items.length === 1));
  for (const job of cashierInitialJobs) {
    const expected = cashierInitialItems.filter((item) =>
      item.kitchen_station_id === job.kitchen_station_id).map((item) => item.id).sort();
    check('Kitchen payload and relation retain exact item membership',
      JSON.stringify(job.payload.items.map((item) => item.order_item_id).sort()) === JSON.stringify(expected)
      && JSON.stringify((await membership(job)).sort()) === JSON.stringify(expected));
    check('Kitchen identity, creator, table and financial exclusion',
      job.order_id === cashierCreate.order_id && job.invoice_id === cashierCreate.invoice_id
      && job.kitchen_batch_key === 'initial'
      && job.automatic_key === `kitchen:${cashierCreate.invoice_id}:${job.kitchen_station_id}:initial`
      && job.payload.order.table_number === String(cashierTable.table_number)
      && job.payload.creator.kind === 'cashier'
      && job.payload.creator.display_name === cashier.display_name
      && !('grand_total' in job.payload.invoice)
      && !('payment_method' in job.payload.invoice));
    const expectedRoute=(await client.query(`select public.resolve_print_job_printer($1,
      'kitchen_ticket',$2) printer_id`,[tenant.id,job.kitchen_station_id])).rows[0].printer_id;
    check('Kitchen ticket snapshots configured station route',
      job.target_printer_id===expectedRoute);
  }
  await reconcile(cashierCreate.invoice_id);
  await reconcile(cashierCreate.invoice_id);
  check('Repeated Cashier reconciliation creates no duplicate',
    (await jobsFor(cashierCreate.invoice_id)).length === 2);
  const originalSnapshot = cashierInitialJobs.map((job) => JSON.stringify(job.payload));
  const beforeTotal = Number((await client.query(`select total_price from public.orders
    where id=$1`, [cashierCreate.order_id])).rows[0].total_price);
  const cashierAdd = (await asActor('authenticated', cashier.user_id,
    `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'append',$4,$5) payload`,
    [tenant.id, String(cashierTable.table_number), items([bar, 2]),
      cashierCreate.order_id, id()])).rows[0].payload;
  const cashierAddJobs = await jobsFor(cashierAdd.invoice_id);
  const cashierAddItems = await itemsFor(cashierAdd.invoice_id);
  check('Cashier addition makes a distinct invoice and ticket',
    cashierAdd.invoice_id !== cashierCreate.invoice_id && cashierAddJobs.length === 1
    && cashierAddJobs[0].kitchen_batch_key !== 'initial');
  check('Cashier addition contains only new items',
    cashierAddJobs[0].payload.items.length === 1
    && cashierAddJobs[0].payload.items[0].order_item_id === cashierAddItems[0].id
    && !cashierInitialItems.some((item) => item.id === cashierAddItems[0].id));
  check('Cashier prior tickets immutable after addition',
    JSON.stringify((await jobsFor(cashierCreate.invoice_id)).map((job) => JSON.stringify(job.payload)))
      === JSON.stringify(originalSnapshot));
  const totals = (await client.query(`select o.total_price,
    (select sum(i.grand_total) from public.order_invoices i where i.order_id=o.id) invoice_total
    from public.orders o where o.id=$1`, [cashierCreate.order_id])).rows[0];
  check('Print queue leaves canonical financial total intact',
    Number(totals.total_price) === Number(totals.invoice_total)
    && Number(totals.total_price) > beforeTotal);

  const waiterCreate = (await asActor('authenticated', waiter.user_id,
    `select public.submit_waiter_order_batch($1,$2,'P2 Guest',null,null,$3::jsonb,$4) payload`,
    [tenant.slug, String(waiterTable.table_number), items([main, 1]), id()])).rows[0].payload;
  const waiterInitialJobs = await jobsFor(waiterCreate.invoice_id);
  const waiterInvoice = (await client.query(`select payment_status from public.order_invoices
    where id=$1`, [waiterCreate.invoice_id])).rows[0];
  check('Unpaid Waiter initial release prints one ticket',
    waiterInitialJobs.length === 1 && waiterInvoice.payment_status !== 'paid'
    && waiterInitialJobs[0].payload.creator.kind === 'waiter'
    && waiterInitialJobs[0].payload.creator.display_name === waiter.display_name);
  await reconcile(waiterCreate.invoice_id);
  check('Repeated Waiter reconciliation is idempotent',
    (await jobsFor(waiterCreate.invoice_id)).length === 1);
  const waiterAdd = (await asActor('authenticated', waiter.user_id,
    `select public.submit_waiter_order_batch($1,$2,'P2 Guest',null,null,$3::jsonb,$4) payload`,
    [tenant.slug, String(waiterTable.table_number), items([bar, 2]), id()])).rows[0].payload;
  check('Waiter addition creates only new batch',
    waiterAdd.invoice_id !== waiterCreate.invoice_id
    && (await jobsFor(waiterAdd.invoice_id)).length === 1
    && (await jobsFor(waiterCreate.invoice_id)).length === 1);
  const waiterAddJobs=await jobsFor(waiterAdd.invoice_id);
  const waiterAddItems=await itemsFor(waiterAdd.invoice_id);
  check('Waiter addition ticket contains only new item IDs',
    waiterAddJobs[0].payload.items.length===1
    && waiterAddJobs[0].payload.items[0].order_item_id===waiterAddItems[0].id
    && waiterAddJobs[0].payload.creator.kind==='waiter');
  const waiterThenCashier = (await asActor('authenticated', cashier.user_id,
    `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'append',$4,$5) payload`,
    [tenant.id, String(waiterTable.table_number), items([secondMain, 1]),
      waiterCreate.order_id, id()])).rows[0].payload;
  check('Waiter then Cashier addition gets distinct ticket',
    waiterThenCashier.invoice_id !== waiterCreate.invoice_id
    && (await jobsFor(waiterThenCashier.invoice_id)).length === 1
    && (await jobsFor(waiterCreate.invoice_id)).length === 1
    && (await jobsFor(waiterThenCashier.invoice_id))[0].payload.creator.kind==='cashier');
  const cashierThenWaiter = (await asActor('authenticated', cashierTableWaiter.user_id,
    `select public.submit_waiter_order_batch($1,$2,'P2 Guest',null,null,$3::jsonb,$4) payload`,
    [tenant.slug, String(cashierTable.table_number), items([secondMain, 1]), id()])).rows[0].payload;
  check('Cashier then Waiter addition gets distinct ticket',
    cashierThenWaiter.invoice_id !== cashierCreate.invoice_id
    && (await jobsFor(cashierThenWaiter.invoice_id)).length === 1
    && (await jobsFor(cashierCreate.invoice_id)).length === 2
    && (await jobsFor(cashierThenWaiter.invoice_id))[0].payload.creator.kind==='waiter');

  const qrCreate = (await asActor('anon', null,
    `select public.create_public_qr_order($1,$2,$3,'P2 QR Guest','Cash',$4::jsonb) payload`,
    [tenant.slug, String(qrTable.table_number), qrTable.qr_token,
      items([main, 1], [bar, 1])])).rows[0].payload;
  check('Unpaid QR is not Kitchen eligible',
    (await client.query(`select public.invoice_is_kitchen_eligible($1,$2) eligible`,
      [tenant.id, qrCreate.invoice_id])).rows[0].eligible === false);
  await reconcile(qrCreate.invoice_id);
  await reconcile(qrCreate.invoice_id);
  check('Unpaid QR has zero print jobs after reconciliation',
    (await jobsFor(qrCreate.invoice_id)).length === 0);
  const qrCashier = (await asActor('authenticated', cashier.user_id,
    `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'append',$4,$5) payload`,
    [tenant.id, String(qrTable.table_number), items([secondMain, 1]),
      qrCreate.order_id, id()])).rows[0].payload;
  const qrWaiterAdd = (await asActor('authenticated', qrWaiter.user_id,
    `select public.submit_waiter_order_batch($1,$2,'P2 QR Guest',null,null,$3::jsonb,$4) payload`,
    [tenant.slug, String(qrTable.table_number), items([bar, 1]), id()])).rows[0].payload;
  check('Mixed session prints staff batches before QR payment',
    (await jobsFor(qrCashier.invoice_id)).length === 1
    && (await jobsFor(qrWaiterAdd.invoice_id)).length === 1
    && (await jobsFor(qrCreate.invoice_id)).length === 0);
  const staffSnapshots=[(await jobsFor(qrCashier.invoice_id))[0].payload,
    (await jobsFor(qrWaiterAdd.invoice_id))[0].payload].map((value)=>JSON.stringify(value));
  const shift = (await client.query(`select id from public.cashier_shifts
    where restaurant_id=$1 and opened_by=$2 and closed_at is null limit 1`,
    [tenant.id, cashier.id])).rows[0];
  if (!shift) await asActor('authenticated', cashier.user_id,
    `select public.open_cashier_shift($1,0,'P2 rollback audit')`, [tenant.id]);
  await asActor('authenticated', cashier.user_id,
    `select public.verify_dining_session_payment($1,'Cash',null,null,null,false)`,
    [qrCreate.order_id]);
  const qrPaidJobs = await jobsFor(qrCreate.invoice_id);
  check('QR paid after activation releases one ticket per station',
    qrPaidJobs.length === 2 && qrPaidJobs.every((job) =>
      job.payload.creator.kind === 'customer_qr'));
  await client.query('savepoint p2_repeated_qr_payment');
  try {
    await asActor('authenticated', cashier.user_id,
      `select public.verify_dining_session_payment($1,'Cash',null,null,null,false)`,
      [qrCreate.order_id]);
  } catch (error) {
    await client.query('rollback to savepoint p2_repeated_qr_payment');
    if (!/already|verified|paid|payment/i.test(error.message)) throw error;
  }
  check('repeated QR payment processing creates no Kitchen duplicate',
    (await jobsFor(qrCreate.invoice_id)).length===2
    && (await receiptFor(qrCreate.invoice_id)).length===1);
  await reconcile(qrCreate.invoice_id);
  await reconcile(qrCreate.invoice_id);
  check('Repeated QR reconciliation keeps one station ticket',
    (await jobsFor(qrCreate.invoice_id)).length === 2);
  check('QR release does not recreate staff tickets',
    (await jobsFor(qrCashier.invoice_id)).length === 1
    && (await jobsFor(qrWaiterAdd.invoice_id)).length === 1
    && JSON.stringify([(await jobsFor(qrCashier.invoice_id))[0].payload,
      (await jobsFor(qrWaiterAdd.invoice_id))[0].payload].map((value)=>JSON.stringify(value)))
      ===JSON.stringify(staffSnapshots));
  const paidReceiptJobs = await receiptFor(qrCreate.invoice_id);
  check('QR payment creates one independent receipt job',
    paidReceiptJobs.length === 1 && paidReceiptJobs[0].payload.invoice.grand_total !== undefined);
  await reconcile(qrCreate.invoice_id);
  check('Repeated receipt reconciliation is idempotent',
    (await receiptFor(qrCreate.invoice_id)).length === 1);
  await client.query(`update public.print_jobs set status='failed',
    last_error_code='PRINTER_UNAVAILABLE' where id=$1`,[paidReceiptJobs[0].id]);
  const receiptReprint = (await asActor('authenticated',cashier.user_id,
    `select public.request_print_job_reprint($1,'P2 receipt copy') id`,
    [paidReceiptJobs[0].id])).rows[0].id;
  const receiptReprintRow = (await client.query(`select request_kind,original_job_id,
    automatic_key,payload from public.print_jobs where id=$1`,[receiptReprint])).rows[0];
  check('manual receipt reprint is a new audited job',
    receiptReprint !== paidReceiptJobs[0].id
    && receiptReprintRow.request_kind === 'manual_reprint'
    && receiptReprintRow.original_job_id === paidReceiptJobs[0].id
    && receiptReprintRow.automatic_key === null
    && JSON.stringify(receiptReprintRow.payload) === JSON.stringify(paidReceiptJobs[0].payload));

  const extraTable = async (number) => {
    const tableId=id(); const token=id();
    await client.query(`insert into public.restaurant_tables
      (id,restaurant_id,table_number,label,qr_token,qr_path,qr_url,active)
      values($1,$2,$3,$4,$5,$6,$7,true)`,[tableId,tenant.id,number,
      `P2 ${number}`,token,`/r/${tenant.slug}/order?t=${number}`,
      `https://example.test/r/${tenant.slug}/order?t=${number}`]);
    return { number, token };
  };
  const freeNumbers=(await client.query(`select n from generate_series(500,1,-1) n
    where not exists(select 1 from public.restaurant_tables t
      where t.restaurant_id=$1 and t.table_number=n) limit 2`,[tenant.id])).rows
    .map((row)=>row.n);
  assert.equal(freeNumbers.length,2,'Two unused table numbers are required');
  const noRouteTable=await extraTable(freeNumbers[0]);
  await client.query(`update public.business_printing_settings
    set kitchen_output_mode='kds' where restaurant_id=$1`,[tenant.id]);
  const noRouteOrder=(await asActor('authenticated',cashier.user_id,
    `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'create',null,$4) payload`,
    [tenant.id,String(noRouteTable.number),items([main,1]),id()])).rows[0].payload;
  const noRouteJobs=await jobsFor(noRouteOrder.invoice_id);
  const noRouteInvoice=(await client.query(`select payment_status from public.order_invoices
    where id=$1`,[noRouteOrder.invoice_id])).rows[0];
  check('new Kitchen order succeeds with durable unrouted job',
    noRouteJobs.length===1 && noRouteJobs[0].target_printer_id===null
    && noRouteJobs[0].status==='pending' && noRouteInvoice.payment_status==='held');
  const kds=(await asActor('authenticated',owner.user_id,
    `select * from public.get_canonical_station_kitchen_orders($1,$2,true,false)`,
    [tenant.id,main.kitchen_station_id])).rows.map((row)=>row.get_canonical_station_kitchen_orders);
  check('KDS still sees unrouted Kitchen work',kds.some((row)=>row.id===noRouteOrder.order_id));

  const faultTable=await extraTable(freeNumbers[1]);
  const faultQr=(await asActor('anon',null,
    `select public.create_public_qr_order($1,$2,$3,'P2 Fault QR','Cash',$4::jsonb) payload`,
    [tenant.slug,String(faultTable.number),faultTable.token,items([main,1])])).rows[0].payload;
  await client.query(`create function public.p2_workflow_fail_receipt_enqueue()
    returns trigger language plpgsql as $$ begin
      if new.job_type='receipt' then raise exception 'P2_RECEIPT_QUEUE_FAULT'; end if;
      return new;
    end; $$`);
  await client.query(`create trigger p2_workflow_fail_receipt_enqueue
    before insert on public.print_jobs for each row
    execute function public.p2_workflow_fail_receipt_enqueue()`);
  await asActor('authenticated',cashier.user_id,
    `select public.verify_dining_session_payment($1,'Cash',null,null,null,false)`,
    [faultQr.order_id]);
  const faultPaid=(await client.query(`select payment_status from public.order_invoices
    where id=$1`,[faultQr.invoice_id])).rows[0].payment_status;
  check('canonical QR payment survives receipt queue fault',faultPaid==='paid');
  return { tenant: tenant.id, cashierOrder: cashierCreate.order_id,
    waiterOrder: waiterCreate.order_id, qrOrder: qrCreate.order_id };
};

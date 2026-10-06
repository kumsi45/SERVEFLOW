// Rollback-only hosted verification. Set C1_MIGRATION_CANDIDATE=1 to apply
// migration 271 inside the audit transaction; otherwise test the live schema.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const envLine = fs.readFileSync(path.join(__dirname, '..', 'connection.env'), 'utf8')
  .split(/\r?\n/).find((line) => /^\s*SUPABASE_DB_URL\s*=/.test(line));
if (!envLine) throw new Error('SUPABASE_DB_URL missing');
const connectionString = envLine.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, '')
  .trim().replace(/^['"]|['"]$/g, '');
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000, query_timeout: 120000, keepAlive: true });
const results = [];
function assert(label, condition, detail = '') {
  results.push({ label, ok: Boolean(condition), ...(condition ? {} : { detail }) });
  console.error(`${condition ? 'PASS' : 'FAIL'} ${label}`);
  if (!condition) throw new Error(`${label}: ${detail}`);
}
async function asActor(role, userId, sql, params = []) {
  await client.query(`set local role ${role}`);
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? '']);
  const result = await client.query(sql, params);
  await client.query('reset role');
  return result;
}
async function expectError(label, role, userId, sql, params, pattern) {
  await client.query('savepoint expected_rejection');
  try {
    await asActor(role, userId, sql, params);
    await client.query('rollback to savepoint expected_rejection');
    assert(label, false, 'unexpected success');
  } catch (error) {
    await client.query('rollback to savepoint expected_rejection');
    assert(label, pattern.test(error.message), `${error.code ?? ''} ${error.message}`);
  }
}
async function expectNoMutation(label, role, userId, sql, params) {
  await client.query('savepoint attempted_mutation');
  try {
    const result = await asActor(role, userId, sql, params);
    await client.query('rollback to savepoint attempted_mutation');
    assert(label, result.rowCount === 0, `unexpected ${result.rowCount} changed rows`);
  } catch (error) {
    await client.query('rollback to savepoint attempted_mutation');
    assert(label, /permission denied|row-level security|not permitted|only active|authenticated/i.test(error.message),
      `${error.code ?? ''} ${error.message}`);
  }
}
async function run() {
  await client.connect();
  try {
    const tenant = (await client.query(`
      select r.id, r.slug from public.restaurants r
      where r.slug = 'grand-royal' and r.active limit 1
    `)).rows[0];
    if (!tenant) throw new Error('Audit tenant unavailable');
    const staff = (await client.query(`
      select id, user_id, role::text role, assigned_kitchen_station_id
      from public.restaurant_staff where restaurant_id = $1 and active
      order by role::text, created_at
    `, [tenant.id])).rows;
    const actor = (role) => staff.find((row) => row.role === role);
    const cashiers = staff.filter((row) => row.role === 'cashier');
    const tables = (await client.query(`
      select t.id,t.table_number,t.qr_token,a.waiter_staff_id
      from public.restaurant_tables t
      left join public.restaurant_table_waiter_assignments a
        on a.restaurant_id=t.restaurant_id and a.table_id=t.id and a.active
      where t.restaurant_id=$1 and t.active
        and not exists (select 1 from public.orders o
          where o.restaurant_id=t.restaurant_id
            and o.table_number=t.table_number::text
            and o.dining_session_status='open')
      order by t.table_number
    `, [tenant.id])).rows;
    const cashierTable = tables.find((row) => row.waiter_staff_id === actor('waiter')?.id) ?? tables[0];
    const waiterTable = tables.find((row) => row.waiter_staff_id && row.id !== cashierTable.id);
    const qrTable = tables.find((row) => row.id !== cashierTable.id && row.id !== waiterTable?.id && row.qr_token);
    const waiter = staff.find((row) => row.id === waiterTable?.waiter_staff_id);
    const menu = (await client.query(`
      select id, price, kitchen_station_id from public.menu_items
      where restaurant_id=$1 and available order by id limit 1
    `, [tenant.id])).rows[0];
    if (!cashiers.length || !actor('owner') || !actor('manager') || !actor('kitchen')
      || !cashierTable || !waiterTable || !qrTable || !waiter || !menu) {
      throw new Error('Required tenant staff, menu, or free tables unavailable');
    }
    const otherTenant = (await client.query(`
      select id,slug from public.restaurants where id<>$1 order by id limit 1
    `, [tenant.id])).rows[0];
    const otherTenantActor = (await client.query(`
      select id,user_id,role::text role from public.restaurant_staff
      where restaurant_id=$1 and active and user_id is not null limit 1
    `, [otherTenant.id])).rows[0];
    const otherMenu = (await client.query(`
      select id from public.menu_items where restaurant_id<>$1 and available limit 1
    `, [tenant.id])).rows[0];

    await client.query('begin');
    await client.query("set local lock_timeout='5s'");
    await client.query("set local statement_timeout='25s'");
    if (process.env.C1_MIGRATION_CANDIDATE === '1') {
      await client.query(fs.readFileSync(path.join(__dirname, '..', 'migrations',
        '271_staff_kitchen_release_and_cashier_table_orders.sql'), 'utf8'));
    }
    const functionGrants = (await client.query(`
      select p.proname,p.prosecdef,p.proconfig,
        has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
        has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in
        ('submit_cashier_order_batch','append_cashier_order_batch_v271',
         'invoice_is_kitchen_eligible','submit_waiter_order_batch_phase7a1_base')
    `)).rows;
    assert('Staff release functions use fixed search_path and restricted execution',
      functionGrants.length === 4 && functionGrants.every((row) =>
        row.prosecdef && row.proconfig?.some((setting) => setting === 'search_path=public')
        && !row.anon_execute)
      && functionGrants.find((row) => row.proname === 'submit_cashier_order_batch')?.authenticated_execute
      && !functionGrants.find((row) => row.proname === 'append_cashier_order_batch_v271')?.authenticated_execute
      && !functionGrants.find((row) => row.proname === 'invoice_is_kitchen_eligible')?.authenticated_execute,
      JSON.stringify(functionGrants));
    const item = [{ menu_item_id: menu.id, quantity: 1 }];
    const requestId = crypto.randomUUID();
    const first = (await asActor('authenticated', cashiers[0].user_id,
      `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'create',null,$4) payload`,
      [tenant.id, String(cashierTable.table_number), JSON.stringify(item), requestId])).rows[0].payload;
    const firstRows = (await client.query(`
      select i.id invoice_id,i.payment_status,i.invoice_source,i.created_by_staff_id,
        x.id item_id,x.kitchen_status,x.kitchen_station_id,x.quantity,x.appended_at,o.total_price,o.payment_timing,
        o.table_id,o.restaurant_id
      from public.orders o join public.order_invoices i on i.order_id=o.id
      join public.order_items x on x.invoice_id=i.id
      where o.id=$1
    `, [first.order_id])).rows;
    assert('Cashier free-table creation and attribution', firstRows.length === 1
      && firstRows[0].restaurant_id === tenant.id
      && firstRows[0].table_id === cashierTable.id
      && firstRows[0].created_by_staff_id === cashiers[0].id
      && firstRows[0].invoice_source === 'cashier', JSON.stringify(firstRows));
    assert('Cashier unpaid item released', firstRows[0].payment_status === 'held'
      && firstRows[0].kitchen_status === 'accepted'
      && firstRows[0].payment_timing === 'after_meal');
    const repeat = (await asActor('authenticated', cashiers[0].user_id,
      `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'create',null,$4) payload`,
      [tenant.id, String(cashierTable.table_number), JSON.stringify(item), requestId])).rows[0].payload;
    assert('Cashier create retry is idempotent', repeat.order_id === first.order_id
      && repeat.invoice_id === first.invoice_id);
    await client.query(`update public.restaurant_staff set role='cashier' where id=$1`,
      [actor('manager').id]);
    await expectError('Another Cashier cannot replay a Cashier request ID',
      'authenticated', actor('manager').user_id,
      `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'create',null,$4)`,
      [tenant.id,String(cashierTable.table_number),JSON.stringify(item),requestId],
      /different order request/i);
    await client.query(`update public.restaurant_staff set role='manager' where id=$1`,
      [actor('manager').id]);
    if (otherTenantActor) {
      await expectError('Cross-tenant staff cannot replay a Cashier request ID',
        'authenticated', otherTenantActor.user_id,
        `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'create',null,$4)`,
        [tenant.id,String(cashierTable.table_number),JSON.stringify(item),requestId],
        /Only active cashiers/i);
    }
    await expectError('Anonymous cannot replay a Cashier request ID', 'anon', null,
      `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'create',null,$4)`,
      [tenant.id,String(cashierTable.table_number),JSON.stringify(item),requestId],
      /permission denied|Authentication is required/i);
    await expectError('Open table returns domain conflict', 'authenticated', cashiers[0].user_id,
      `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'create',null,$4)`,
      [tenant.id, String(cashierTable.table_number), JSON.stringify(item), crypto.randomUUID()],
      /already has an active order/i);

    const appendId = crypto.randomUUID();
    const addition = (await asActor('authenticated', cashiers[0].user_id,
      `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'append',$4,$5) payload`,
      [tenant.id, String(cashierTable.table_number), JSON.stringify(item), first.order_id, appendId])).rows[0].payload;
    const additionRetry = (await asActor('authenticated', cashiers[0].user_id,
      `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'append',$4,$5) payload`,
      [tenant.id, String(cashierTable.table_number), JSON.stringify(item), first.order_id, appendId])).rows[0].payload;
    const afterAppend = (await client.query(`
      select o.total_price, i.id invoice_id,i.payment_status,i.invoice_source,
        i.created_by_staff_id,x.id item_id,x.kitchen_status,x.appended_at,x.quantity
      from public.orders o join public.order_invoices i on i.order_id=o.id
      join public.order_items x on x.invoice_id=i.id
      where o.id=$1 order by i.invoice_number,x.id
    `, [first.order_id])).rows;
    assert('Cashier addition uses same session and new invoice', addition.order_id === first.order_id
      && addition.invoice_id !== first.invoice_id && afterAppend.length === 2
      && afterAppend[0].invoice_id !== afterAppend[1].invoice_id);
    assert('Only new item set has addition identity', !afterAppend[0].appended_at
      && Boolean(afterAppend[1].appended_at)
      && addition.kitchen_release_item_ids.length === 1
      && addition.kitchen_release_item_ids[0] === afterAppend[1].item_id);
    assert('Addition preserves payment due and totals', afterAppend.every((row) =>
      row.payment_status === 'held' && row.kitchen_status === 'accepted')
      && Number(afterAppend[0].total_price) === Number(firstRows[0].total_price) * 2,
    JSON.stringify(afterAppend));
    assert('Cashier addition retry is idempotent', additionRetry.invoice_id === addition.invoice_id);
    const financial = (await client.query(`
      select o.total_price order_total, i.id, i.subtotal, i.vat_amount,
        i.service_charge_amount, i.discount_amount, i.grand_total,
        i.payment_status, coalesce(sum(x.price*x.quantity),0) item_subtotal
      from public.orders o join public.order_invoices i on i.order_id=o.id
      join public.order_items x on x.invoice_id=i.id
      where o.id=$1
      group by o.total_price,i.id order by i.id
    `, [first.order_id])).rows;
    const money = (value) => Math.round(Number(value) * 100);
    assert('Each Cashier invoice financial breakdown matches inserted items',
      financial.length === 2 && financial.every((row) =>
        money(row.subtotal) === money(row.item_subtotal)
        && money(row.grand_total) === money(row.subtotal) + money(row.vat_amount)
          + money(row.service_charge_amount) - money(row.discount_amount)),
      JSON.stringify(financial));
    assert('Order grand total sums invoices exactly once',
      money(financial[0].order_total) === financial.reduce((sum, row) =>
        sum + money(row.grand_total), 0), JSON.stringify(financial));
    await expectNoMutation('Anonymous cannot spoof Cashier invoice attribution', 'anon', null,
      `update public.order_invoices set invoice_source='cashier',created_by_staff_id=$2
       where id=$1`, [first.invoice_id,cashiers[0].id]);
    await expectNoMutation('Anonymous cannot spoof Waiter invoice attribution', 'anon', null,
      `update public.order_invoices set invoice_source='waiter',created_by_staff_id=$2
       where id=$1`, [first.invoice_id,waiter.id]);
    await expectNoMutation('Cashier cannot arbitrarily attribute batch to another staff ID',
      'authenticated', cashiers[0].user_id,
      `update public.order_invoices set created_by_staff_id=$2 where id=$1`,
      [first.invoice_id, actor('manager').id]);
    await expectNoMutation('Anonymous cannot change invoice restaurant', 'anon', null,
      `update public.order_invoices set restaurant_id=$2 where id=$1`,
      [first.invoice_id,otherTenant.id]);
    await expectError('Released quantity cannot be silently increased',
      'authenticated', actor('owner').user_id,
      `update public.order_items set quantity=quantity+1 where id=$1`,
      [afterAppend[0].item_id], /immutable|quantity|not permitted|cannot|permission denied/i);

    const ownerQueue = (await asActor('authenticated', actor('owner').user_id,
      `select * from public.get_canonical_station_kitchen_orders($1,$2,true,false)`,
      [tenant.id,firstRows[0].kitchen_station_id])).rows.map((row) => row.get_canonical_station_kitchen_orders);
    const kitchenDebug = (await client.query(`
      select o.operational_status,o.dining_session_status,o.table_released_at,
        i.payment_status,i.invoice_source,i.created_by_staff_id,
        x.kitchen_status,x.kitchen_station_id,
        public.invoice_is_kitchen_eligible(i.restaurant_id,i.id) eligible
      from public.orders o join public.order_invoices i on i.order_id=o.id
      join public.order_items x on x.invoice_id=i.id where o.id=$1
    `, [first.order_id])).rows;
    assert('Unpaid Cashier batches reach canonical Kitchen query', ownerQueue.some((row) =>
      row.id === first.order_id && row.kitchen_batch_key === 'initial')
      && ownerQueue.some((row) => row.id === first.order_id
        && row.kitchen_batch_key === addition.kitchen_batch_key),
    JSON.stringify({ queue: ownerQueue.filter((row) => row.id === first.order_id), kitchenDebug }));
    await asActor('authenticated', actor('owner').user_id,
      `select public.start_order_preparation($1,$2,'initial')`,
      [first.order_id, kitchenDebug[0].kitchen_station_id]);
    const preparing = (await client.query(`
      select i.payment_status,x.kitchen_status from public.order_invoices i
      join public.order_items x on x.invoice_id=i.id where x.id=$1
    `, [afterAppend[0].item_id])).rows[0];
    assert('Unpaid Cashier can start preparation without payment',
      preparing.payment_status === 'held' && preparing.kitchen_status === 'preparing');
    const ownerVisible = (await asActor('authenticated', actor('owner').user_id,
      `select id,restaurant_id,table_number,total_price from public.orders where id=$1`,
      [first.order_id])).rows;
    const managerVisible = (await asActor('authenticated', actor('manager').user_id,
      `select id,restaurant_id,table_number,total_price from public.orders where id=$1`,
      [first.order_id])).rows;
    assert('Owner and Manager RLS order visibility', ownerVisible.length === 1
      && managerVisible.length === 1);
    for (const viewerRole of ['owner','manager']) {
      const viewer = actor(viewerRole);
      const visibleItems = (await asActor('authenticated', viewer.user_id,
        `select id,order_id,quantity,kitchen_status from public.order_items
         where restaurant_id=$1 and order_id=$2`, [tenant.id, first.order_id])).rows;
      const visibleInvoices = (await asActor('authenticated', viewer.user_id,
        `select id,order_id,payment_status,grand_total,invoice_source,created_by_staff_id
         from public.order_invoices where restaurant_id=$1 and order_id=$2`,
        [tenant.id,first.order_id])).rows;
      const visibleTables = (await asActor('authenticated', viewer.user_id,
        `select id,table_number from public.restaurant_tables
         where restaurant_id=$1 and id=$2`, [tenant.id,cashierTable.id])).rows;
      assert(`${viewerRole} actual order read resources include table, items and invoices`,
        visibleItems.length === 2 && visibleInvoices.length === 2
        && visibleTables.length === 1
        && visibleInvoices.some((invoiceRow) =>
          invoiceRow.id === first.invoice_id && invoiceRow.created_by_staff_id === cashiers[0].id),
        JSON.stringify({ visibleItems,visibleInvoices,visibleTables }));
    }
    await expectError('Cross-tenant Cashier create denied', 'authenticated', cashiers[0].user_id,
      `select public.submit_cashier_order_batch($1,'1','Cash',$2::jsonb,'create',null,$3)`,
      [otherTenant.id, JSON.stringify(item), crypto.randomUUID()], /Only active cashiers/);
    if (otherMenu) {
      await expectError('Cross-tenant menu item denied in Cashier append',
        'authenticated', cashiers[0].user_id,
        `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'append',$4,$5)`,
        [tenant.id, String(cashierTable.table_number),
          JSON.stringify([{ menu_item_id: otherMenu.id, quantity: 1 }]),
          first.order_id, crypto.randomUUID()], /invalid or unavailable menu items/i);
    }
    await expectError('Manager cannot call Cashier-only write RPC',
      'authenticated', actor('manager').user_id,
      `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'append',$4,$5)`,
      [tenant.id, String(cashierTable.table_number), JSON.stringify(item),
        first.order_id, crypto.randomUUID()], /Only active cashiers/i);
    await expectError('Anonymous Cashier spoof denied', 'anon', null,
      `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'create',null,$4)`,
      [tenant.id, String(qrTable.table_number), JSON.stringify(item), crypto.randomUUID()],
      /permission denied|Authentication is required/i);

    const waiterRequestId = crypto.randomUUID();
    const waiterPayload = (await asActor('authenticated', waiter.user_id,
      `select public.submit_waiter_order_batch($1,$2,'Audit Guest',null,null,$3::jsonb,$4) payload`,
      [tenant.slug, String(waiterTable.table_number), JSON.stringify(item), waiterRequestId])).rows[0].payload;
    const waiterRepeat = (await asActor('authenticated', waiter.user_id,
      `select public.submit_waiter_order_batch($1,$2,'Audit Guest',null,null,$3::jsonb,$4) payload`,
      [tenant.slug,String(waiterTable.table_number),JSON.stringify(item),waiterRequestId])).rows[0].payload;
    assert('Original Waiter request replay is idempotent',
      waiterRepeat.order_id === waiterPayload.order_id
      && waiterRepeat.invoice_id === waiterPayload.invoice_id);
    await client.query(`update public.restaurant_staff set role='waiter' where id=$1`,
      [actor('manager').id]);
    await expectError('Another Waiter cannot replay a Waiter request ID',
      'authenticated', actor('manager').user_id,
      `select public.submit_waiter_order_batch($1,$2,'Audit Guest',null,null,$3::jsonb,$4)`,
      [tenant.slug,String(waiterTable.table_number),JSON.stringify(item),waiterRequestId],
      /another order request/i);
    await client.query(`update public.restaurant_staff set role='manager' where id=$1`,
      [actor('manager').id]);
    await client.query(`update public.restaurant_staff set active=false where id=$1`,
      [waiter.id]);
    await expectError('Inactive Waiter cannot replay a Waiter request ID',
      'authenticated', waiter.user_id,
      `select public.submit_waiter_order_batch($1,$2,'Audit Guest',null,null,$3::jsonb,$4)`,
      [tenant.slug,String(waiterTable.table_number),JSON.stringify(item),waiterRequestId],
      /Only active waiters/i);
    await client.query(`update public.restaurant_staff set active=true where id=$1`,
      [waiter.id]);
    if (otherTenantActor) {
      await expectError('Cross-tenant staff cannot replay a Waiter request ID',
        'authenticated', otherTenantActor.user_id,
        `select public.submit_waiter_order_batch($1,$2,'Audit Guest',null,null,$3::jsonb,$4)`,
        [tenant.slug,String(waiterTable.table_number),JSON.stringify(item),waiterRequestId],
        /Only active waiters/i);
    }
    await expectError('Anonymous cannot replay a Waiter request ID', 'anon', null,
      `select public.submit_waiter_order_batch($1,$2,'Audit Guest',null,null,$3::jsonb,$4)`,
      [tenant.slug,String(waiterTable.table_number),JSON.stringify(item),waiterRequestId],
      /permission denied|Only active waiters|Authentication is required/i);
    await expectError('Cashier cannot replay Waiter request ID to impersonate its creator',
      'authenticated', cashiers[0].user_id,
      `select public.submit_waiter_order_batch($1,$2,'Audit Guest',null,null,$3::jsonb,$4)`,
      [tenant.slug,String(waiterTable.table_number),JSON.stringify(item),waiterRequestId],
      /Only active waiters|another order request/i);
    const waiterRows = (await client.query(`
      select i.invoice_source,i.payment_status,i.created_by_staff_id,x.kitchen_status
      from public.order_invoices i join public.order_items x on x.invoice_id=i.id
      where i.id=$1
    `, [waiterPayload.invoice_id])).rows;
    assert('Waiter unpaid item released with real RPC', waiterRows.length === 1
      && waiterRows[0].invoice_source === 'waiter'
      && waiterRows[0].payment_status === 'held'
      && waiterRows[0].kitchen_status === 'accepted'
      && waiterRows[0].created_by_staff_id === waiter.id,
    JSON.stringify(waiterRows));
    await expectError('Anonymous Waiter spoof denied', 'anon', null,
      `select public.submit_waiter_order_batch($1,$2,'Guest',null,null,$3::jsonb,$4)`,
      [tenant.slug, String(qrTable.table_number), JSON.stringify(item), crypto.randomUUID()],
      /permission denied|Only active waiters|Authentication is required/i);
    const waiterAddition = (await asActor('authenticated', waiter.user_id,
      `select public.submit_waiter_order_batch($1,$2,'Audit Guest',null,null,$3::jsonb,$4) payload`,
      [tenant.slug, String(waiterTable.table_number), JSON.stringify(item),
        crypto.randomUUID()])).rows[0].payload;
    const waiterAdditionRows = (await client.query(`
      select id,kitchen_status,appended_at from public.order_items
      where invoice_id=$1
    `, [waiterAddition.invoice_id])).rows;
    assert('Waiter addition releases only new item',
      waiterAddition.order_id === waiterPayload.order_id
      && waiterAddition.invoice_id !== waiterPayload.invoice_id
      && waiterAdditionRows.length === 1
      && waiterAdditionRows[0].kitchen_status === 'accepted'
      && Boolean(waiterAdditionRows[0].appended_at));
    const waiterSessionFinancials = (await client.query(`
      select o.total_price,
        coalesce(sum(i.grand_total),0) invoice_total,
        coalesce(sum(i.subtotal),0) invoice_subtotal,
        coalesce(sum(x.price*x.quantity),0) item_subtotal
      from public.orders o join public.order_invoices i on i.order_id=o.id
      join public.order_items x on x.invoice_id=i.id
      where o.id=$1 group by o.total_price
    `, [waiterPayload.order_id])).rows[0];
    assert('Waiter-created session Waiter addition updates order total exactly once',
      money(waiterSessionFinancials.total_price) === money(waiterSessionFinancials.invoice_total)
      && money(waiterSessionFinancials.invoice_subtotal) === money(waiterSessionFinancials.item_subtotal),
      JSON.stringify(waiterSessionFinancials));
    await expectError('Cross-tenant Waiter order denied', 'authenticated', waiter.user_id,
      `select public.submit_waiter_order_batch($1,'1','Audit Guest',null,null,$2::jsonb,$3)`,
      [otherTenant.slug, JSON.stringify(item), crypto.randomUUID()],
      /assigned|waiter|table|restaurant|not found|permission/i);
    const waiterCashierAddition = (await asActor('authenticated', cashiers[0].user_id,
      `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'append',$4,$5) payload`,
      [tenant.id, String(waiterTable.table_number), JSON.stringify(item),
        waiterPayload.order_id, crypto.randomUUID()])).rows[0].payload;
    assert('Waiter then Cashier addition has distinct staff invoice',
      waiterCashierAddition.order_id === waiterPayload.order_id
      && waiterCashierAddition.invoice_id !== waiterPayload.invoice_id
      && waiterCashierAddition.created_by_staff_id === cashiers[0].id
      && waiterCashierAddition.kitchen_release_item_ids.length === 1);
    if (cashierTable.waiter_staff_id) {
      const assignedWaiter = staff.find((row) => row.id === cashierTable.waiter_staff_id);
      const cashierWaiterAddition = (await asActor('authenticated', assignedWaiter.user_id,
        `select public.submit_waiter_order_batch($1,$2,'Audit Guest',null,null,$3::jsonb,$4) payload`,
        [tenant.slug, String(cashierTable.table_number), JSON.stringify(item),
          crypto.randomUUID()])).rows[0].payload;
      const cashierWaiterRows = (await client.query(`
        select i.id invoice_id,i.invoice_source,i.created_by_staff_id,x.id item_id,x.kitchen_status
        from public.order_invoices i join public.order_items x on x.invoice_id=i.id
        where i.order_id=$1
      `, [first.order_id])).rows;
      assert('Cashier then Waiter addition has only one new item and correct actor',
        cashierWaiterAddition.order_id === first.order_id
        && cashierWaiterAddition.invoice_id !== first.invoice_id
        && cashierWaiterRows.filter((row) => row.invoice_id === cashierWaiterAddition.invoice_id).length === 1
        && cashierWaiterRows.some((row) => row.invoice_id === cashierWaiterAddition.invoice_id
          && row.invoice_source === 'waiter' && row.created_by_staff_id === assignedWaiter.id
          && row.kitchen_status === 'accepted'));
      const cashierWaiterFinancials = (await client.query(`
        select o.total_price,
          coalesce(sum(i.grand_total),0) invoice_total,
          coalesce(sum(i.subtotal),0) invoice_subtotal,
          coalesce(sum(x.price*x.quantity),0) item_subtotal
        from public.orders o join public.order_invoices i on i.order_id=o.id
        join public.order_items x on x.invoice_id=i.id
        where o.id=$1 group by o.total_price
      `, [first.order_id])).rows[0];
      assert('Cashier-created session Waiter addition updates order total exactly once',
        money(cashierWaiterFinancials.total_price) === money(cashierWaiterFinancials.invoice_total)
        && money(cashierWaiterFinancials.invoice_subtotal) === money(cashierWaiterFinancials.item_subtotal),
        JSON.stringify(cashierWaiterFinancials));
    }

    await client.query('savepoint qr_staff_spoof');
    const spoofedQr = (await asActor('anon', null,
      `select public.create_public_qr_order($1,$2,$3,$4,'Audit QR','Cash',$5::jsonb) payload`,
      [tenant.slug,String(qrTable.table_number),qrTable.qr_token,crypto.randomUUID(),
        JSON.stringify([{ menu_item_id: menu.id, quantity: 1,
          invoice_source: 'cashier', created_by_staff_id: cashiers[0].id,
          restaurant_id: otherTenant.id }])])).rows[0].payload;
    const spoofedRows = (await client.query(`
      select i.invoice_source,i.created_by_staff_id,i.restaurant_id,x.kitchen_status
      from public.order_invoices i join public.order_items x on x.invoice_id=i.id
      where i.id=$1
    `, [spoofedQr.invoice_id])).rows;
    assert('Public QR payload cannot manufacture staff source, actor or tenant',
      spoofedRows.length === 1 && spoofedRows.every((row) =>
        row.invoice_source === 'public_qr'
        && row.created_by_staff_id === null
        && row.restaurant_id === tenant.id
        && row.kitchen_status === 'held'), JSON.stringify(spoofedRows));
    await client.query('rollback to savepoint qr_staff_spoof');
    const qrBrowserToken = crypto.randomUUID();
    const qrPayload = (await asActor('anon', null,
      `select public.create_public_qr_order($1,$2,$3,$4,'Audit QR','Cash',$5::jsonb) payload`,
      [tenant.slug, String(qrTable.table_number), qrTable.qr_token,
        qrBrowserToken, JSON.stringify(item)])).rows[0].payload;
    const qrRows = (await client.query(`
      select i.invoice_source,i.payment_status,x.id item_id,x.kitchen_status
      from public.order_invoices i join public.order_items x on x.invoice_id=i.id
      where i.id=$1
    `, [qrPayload.invoice_id])).rows;
    assert('Unpaid QR remains held', qrRows.length === 1
      && qrRows[0].invoice_source === 'public_qr'
      && qrRows[0].payment_status !== 'paid'
      && qrRows[0].kitchen_status === 'held', JSON.stringify(qrRows));
    await expectError('Unpaid QR cannot start preparation',
      'authenticated', actor('owner').user_id,
      `select public.start_order_preparation($1,$2,'initial')`,
      [qrPayload.order_id, kitchenDebug[0].kitchen_station_id],
      /not released|cannot|Batch not found|Wrong station|pending|no eligible/i);
    const afterQrQueue = (await asActor('authenticated', actor('owner').user_id,
      `select * from public.get_canonical_station_kitchen_orders($1,$2,true,false)`,
      [tenant.id,firstRows[0].kitchen_station_id])).rows.map((row) => row.get_canonical_station_kitchen_orders);
    assert('Unpaid QR absent from Kitchen query', !afterQrQueue.some((row) =>
      row.id === qrPayload.order_id));
    const qrCashierAddition = (await asActor('authenticated', cashiers[0].user_id,
      `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'append',$4,$5) payload`,
      [tenant.id, String(qrTable.table_number), JSON.stringify(item),
        qrPayload.order_id, crypto.randomUUID()])).rows[0].payload;
    const mixedRows = (await client.query(`
      select i.id,i.invoice_source,i.payment_status,x.kitchen_status
      from public.order_invoices i join public.order_items x on x.invoice_id=i.id
      where i.order_id=$1 order by i.invoice_number
    `, [qrPayload.order_id])).rows;
    assert('Cashier addition to QR session keeps QR held',
      qrCashierAddition.order_id === qrPayload.order_id
      && mixedRows.some((row) => row.id === qrPayload.invoice_id
        && row.invoice_source === 'public_qr' && row.kitchen_status === 'held')
      && mixedRows.some((row) => row.id === qrCashierAddition.invoice_id
        && row.invoice_source === 'cashier' && row.payment_status === 'held'
        && row.kitchen_status === 'accepted'), JSON.stringify(mixedRows));
    const mixedQueue = (await asActor('authenticated', actor('owner').user_id,
      `select * from public.get_canonical_station_kitchen_orders($1,$2,true,false)`,
      [tenant.id,firstRows[0].kitchen_station_id])).rows.map((row) => row.get_canonical_station_kitchen_orders)
      .filter((row) => row.id === qrPayload.order_id);
    assert('Mixed session queue contains only staff addition', mixedQueue.length === 1
      && mixedQueue[0].items.length === 1
      && mixedQueue[0].items[0].id === qrCashierAddition.kitchen_release_item_ids[0],
      JSON.stringify(mixedQueue));
    const qrWaiter = staff.find((row) => row.id === qrTable.waiter_staff_id);
    if (qrWaiter) {
      const qrWaiterAddition = (await asActor('authenticated', qrWaiter.user_id,
        `select public.submit_waiter_order_batch($1,$2,'Audit QR',null,null,$3::jsonb,$4) payload`,
        [tenant.slug, String(qrTable.table_number), JSON.stringify(item),
          crypto.randomUUID()])).rows[0].payload;
      const afterWaiterMixed = (await client.query(`
        select i.id,i.invoice_source,i.payment_status,x.kitchen_status
        from public.order_invoices i join public.order_items x on x.invoice_id=i.id
        where i.order_id=$1 order by i.invoice_number
      `, [qrPayload.order_id])).rows;
      assert('Waiter addition to QR session preserves unpaid QR gate',
        qrWaiterAddition.order_id === qrPayload.order_id
        && afterWaiterMixed.some((row) => row.id === qrPayload.invoice_id
          && row.kitchen_status === 'held')
        && afterWaiterMixed.some((row) => row.id === qrWaiterAddition.invoice_id
          && row.invoice_source === 'waiter' && row.payment_status === 'held'
          && row.kitchen_status === 'accepted'), JSON.stringify(afterWaiterMixed));
    }
    const prePaymentQueue = (await asActor('authenticated', actor('owner').user_id,
      `select * from public.get_canonical_station_kitchen_orders($1,$2,true,false)`,
      [tenant.id,firstRows[0].kitchen_station_id])).rows.map((row) => row.get_canonical_station_kitchen_orders)
      .filter((row) => row.id === qrPayload.order_id);
    const prePaymentStaffIds = new Set(prePaymentQueue.flatMap((row) =>
      row.items.map((entry) => entry.id)));
    const openShift = (await client.query(`
      select id from public.cashier_shifts where restaurant_id=$1
        and opened_by=$2 and closed_at is null limit 1
    `, [tenant.id, cashiers[0].id])).rows[0];
    if (!openShift) {
      await asActor('authenticated', cashiers[0].user_id,
        `select public.open_cashier_shift($1,0,'C1.1 rollback audit')`, [tenant.id]);
    }
    await asActor('authenticated', cashiers[0].user_id,
      `select public.verify_dining_session_payment($1,'Cash',null,null,null,false)`,
      [qrPayload.order_id]);
    const paidQrRows = (await client.query(`
      select i.id,i.payment_status,x.kitchen_status from public.order_invoices i
      join public.order_items x on x.invoice_id=i.id where i.id=$1
    `, [qrPayload.invoice_id])).rows;
    assert('Confirmed QR payment releases QR item', paidQrRows.length === 1
      && paidQrRows[0].payment_status === 'paid'
      && paidQrRows[0].kitchen_status === 'accepted', JSON.stringify(paidQrRows));
    const paidQrQueue = (await asActor('authenticated', actor('owner').user_id,
      `select * from public.get_canonical_station_kitchen_orders($1,$2,true,false)`,
      [tenant.id,firstRows[0].kitchen_station_id])).rows.map((row) => row.get_canonical_station_kitchen_orders);
    assert('Paid QR item enters canonical Kitchen query', paidQrQueue.some((row) =>
      row.id === qrPayload.order_id && row.items.some((itemRow) =>
        itemRow.id === qrRows[0].item_id && itemRow.kitchen_status === 'accepted')));
    const afterPaidIds = paidQrQueue.filter((row) => row.id === qrPayload.order_id)
      .flatMap((row) => row.items.map((entry) => entry.id));
    assert('Paying QR adds only its held item identity to existing staff Kitchen work',
      afterPaidIds.length === prePaymentStaffIds.size + 1
      && afterPaidIds.filter((id) => id === qrRows[0].item_id).length === 1
      && [...prePaymentStaffIds].every((id) => afterPaidIds.filter((seen) => seen === id).length === 1),
      JSON.stringify(afterPaidIds));
    const postPayCashierAddition = (await asActor('authenticated', cashiers[0].user_id,
      `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'append',$4,$5) payload`,
      [tenant.id, String(qrTable.table_number), JSON.stringify(item),
        qrPayload.order_id, crypto.randomUUID()])).rows[0].payload;
    const afterPostPayQueue = (await asActor('authenticated', actor('owner').user_id,
      `select * from public.get_canonical_station_kitchen_orders($1,$2,true,false)`,
      [tenant.id,firstRows[0].kitchen_station_id])).rows.map((row) => row.get_canonical_station_kitchen_orders)
      .filter((row) => row.id === qrPayload.order_id);
    const finalIds = afterPostPayQueue.flatMap((row) => row.items.map((entry) => entry.id));
    assert('Paid QR then Cashier addition creates only one new Kitchen item',
      finalIds.length === afterPaidIds.length + 1
      && finalIds.filter((id) => id === qrRows[0].item_id).length === 1
      && finalIds.filter((id) => id === postPayCashierAddition.kitchen_release_item_ids[0]).length === 1
      && afterPostPayQueue.some((row) => row.kitchen_batch_key === postPayCashierAddition.kitchen_batch_key),
      JSON.stringify(afterPostPayQueue));
    const paidSession = (await client.query(`
      select dining_session_status,table_released_at from public.orders where id=$1
    `, [qrPayload.order_id])).rows[0];
    assert('Payment alone does not release occupied table',
      paidSession.dining_session_status === 'open'
      && paidSession.table_released_at === null, JSON.stringify(paidSession));
    const beforeCollected = (await client.query(`
      select o.total_price, coalesce(sum(i.grand_total) filter
        (where i.payment_status='paid'),0) paid_total
      from public.orders o join public.order_invoices i on i.order_id=o.id
      where o.id=$1 group by o.total_price
    `, [first.order_id])).rows[0];
    await asActor('authenticated', cashiers[0].user_id,
      `select public.verify_dining_session_payment($1,'Cash',null,null,null,false)`,
      [first.order_id]);
    const collectedBeforeAddition = (await client.query(`
      select o.total_price, coalesce(sum(i.grand_total) filter
        (where i.payment_status='paid'),0) paid_total
      from public.orders o join public.order_invoices i on i.order_id=o.id
      where o.id=$1 group by o.total_price
    `, [first.order_id])).rows[0];
    assert('Prior Cashier session collection records exact existing total',
      money(collectedBeforeAddition.paid_total) === money(beforeCollected.total_price),
      JSON.stringify({ beforeCollected,collectedBeforeAddition }));
    const afterCollectionAddition = (await asActor('authenticated', cashiers[0].user_id,
      `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'append',$4,$5) payload`,
      [tenant.id,String(cashierTable.table_number),JSON.stringify(item),
        first.order_id,crypto.randomUUID()])).rows[0].payload;
    const collectedAfterAddition = (await client.query(`
      select o.total_price,
        coalesce(sum(i.grand_total) filter (where i.payment_status='paid'),0) paid_total,
        coalesce(sum(i.grand_total) filter (where i.payment_status in ('pending','held')),0) due_total
      from public.orders o join public.order_invoices i on i.order_id=o.id
      where o.id=$1 group by o.total_price
    `, [first.order_id])).rows[0];
    assert('Adding after collection preserves paid amount and exact new amount due',
      money(collectedAfterAddition.paid_total) === money(collectedBeforeAddition.paid_total)
      && money(collectedAfterAddition.total_price) ===
        money(collectedAfterAddition.paid_total) + money(collectedAfterAddition.due_total)
      && money(collectedAfterAddition.due_total) === money(afterCollectionAddition.invoice_total),
      JSON.stringify(collectedAfterAddition));
    const lifecycleBatches = (await client.query(`
      select distinct case when appended_at is null then 'initial'
        else ((extract(epoch from appended_at)*1000000)::bigint)::text end batch_key,
        kitchen_station_id
      from public.order_items where order_id=$1
    `, [first.order_id])).rows;
    for (const batch of lifecycleBatches) {
      const currentStatuses = (await client.query(`
        select distinct kitchen_status from public.order_items where order_id=$1
          and kitchen_station_id=$2 and
          (case when appended_at is null then 'initial'
            else ((extract(epoch from appended_at)*1000000)::bigint)::text end)=$3
      `, [first.order_id,batch.kitchen_station_id,batch.batch_key])).rows
        .map((row) => row.kitchen_status);
      if (currentStatuses.includes('accepted')) {
        await asActor('authenticated', actor('owner').user_id,
          `select public.start_order_preparation($1,$2,$3)`,
          [first.order_id,batch.kitchen_station_id,batch.batch_key]);
      }
      await asActor('authenticated', actor('owner').user_id,
        `select public.mark_order_ready($1,$2,$3)`,
        [first.order_id,batch.kitchen_station_id,batch.batch_key]);
      await asActor('authenticated', actor('owner').user_id,
        `select public.mark_order_completed($1,$2,$3)`,
        [first.order_id,batch.kitchen_station_id,batch.batch_key]);
    }
    const completedUnpaidSession = (await client.query(`
      select dining_session_status,table_released_at from public.orders where id=$1
    `, [first.order_id])).rows[0];
    assert('Kitchen completion while a later batch remains unpaid keeps table occupied',
      completedUnpaidSession.dining_session_status === 'open'
      && completedUnpaidSession.table_released_at === null,
      JSON.stringify(completedUnpaidSession));
    await asActor('authenticated', cashiers[0].user_id,
      `select public.verify_dining_session_payment($1,'Cash',null,null,null,false)`,
      [first.order_id]);
    const closedSession = (await client.query(`
      select dining_session_status,table_released_at from public.orders where id=$1
    `, [first.order_id])).rows[0];
    assert('Settled completed session releases table through canonical lifecycle',
      closedSession.dining_session_status === 'closed'
      && Boolean(closedSession.table_released_at),JSON.stringify(closedSession));
    const reopened = (await asActor('authenticated', cashiers[0].user_id,
      `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'create',null,$4) payload`,
      [tenant.id,String(cashierTable.table_number),JSON.stringify(item),
        crypto.randomUUID()])).rows[0].payload;
    assert('Released table accepts a distinct new dining session',
      reopened.order_id !== first.order_id);
    await client.query(`update public.restaurant_staff set active=false where id=$1`,
      [cashiers[0].id]);
    await expectError('Inactive Cashier cannot submit a new batch',
      'authenticated', cashiers[0].user_id,
      `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'append',$4,$5)`,
      [tenant.id,String(cashierTable.table_number),JSON.stringify(item),
        first.order_id,crypto.randomUUID()], /Only active cashiers/i);
    await expectError('Inactive Cashier cannot replay a stored request ID',
      'authenticated', cashiers[0].user_id,
      `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,'create',null,$4)`,
      [tenant.id,String(cashierTable.table_number),JSON.stringify(item),requestId],
      /Only active cashiers/i);
    const historicalInvoice = (await client.query(`
      select invoice_source,created_by_staff_id,
        public.invoice_is_kitchen_eligible(restaurant_id,id) eligible
      from public.order_invoices where id=$1
    `, [first.invoice_id])).rows[0];
    assert('Historical Cashier attribution survives deactivation while closed work is ineligible',
      historicalInvoice.invoice_source === 'cashier'
      && historicalInvoice.created_by_staff_id === cashiers[0].id
      && historicalInvoice.eligible === false, JSON.stringify(historicalInvoice));
    console.log(JSON.stringify({ candidate: process.env.C1_MIGRATION_CANDIDATE === '1',
      results, rollback: true }, null, 2));
  } finally {
    await client.query('rollback').catch(() => {});
    await client.end();
  }
}
run().catch((error) => {
  console.error(JSON.stringify({ message: error.message, code: error.code,
    detail: error.detail, where: error.where, completed: results }, null, 2));
  process.exitCode = 1;
});

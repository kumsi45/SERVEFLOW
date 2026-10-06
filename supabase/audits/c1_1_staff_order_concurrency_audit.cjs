const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const { Client } = require('pg');

const envLine = fs.readFileSync(path.join(__dirname, '..', 'connection.env'), 'utf8')
  .split(/\r?\n/).find((line) => /^\s*SUPABASE_DB_URL\s*=/.test(line));
if (!envLine) throw new Error('SUPABASE_DB_URL missing');
const connectionString = envLine.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, '')
  .trim().replace(/^['"]|['"]$/g, '');
const ssl = { rejectUnauthorized: false };
const marker = `c11-concurrency-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const id = () => crypto.randomUUID();
const fixture = {
  restaurant: id(), slug: marker,
  cashierAUser: id(), cashierAStaff: id(),
  cashierBUser: id(), cashierBStaff: id(),
  waiterUser: id(), waiterStaff: id(),
  station: id(), category: id(), menu: id(),
  tables: [401, 402, 403, 404].map((number) => ({ id: id(), number, token: id() })),
};

async function connect(name) {
  const client = new Client({ connectionString, ssl, application_name: `${marker}-${name}`,
    connectionTimeoutMillis: 10000, query_timeout: 45000, keepAlive: true });
  await client.connect();
  return client;
}

async function beginActor(client, userId) {
  await client.query('begin');
  await client.query("set local statement_timeout='35s'");
  await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
}

async function raceUntilFirst(clients, promises) {
  const wrapped = promises.map((promise, index) => promise.then(
    (result) => ({ index, ok: true, result }),
    (error) => ({ index, ok: false, error }),
  ));
  const first = await Promise.race(wrapped);
  if (!first.ok) throw first.error;
  await clients[first.index].query('commit');
  const secondIndex = first.index === 0 ? 1 : 0;
  const second = await wrapped[secondIndex];
  return { first, second, secondIndex };
}

async function cashierCall(client, table, action, orderId, requestId, quantity = 1) {
  return client.query(
    `select public.submit_cashier_order_batch($1,$2,'Cash',$3::jsonb,$4,$5,$6) payload`,
    [fixture.restaurant, String(table), JSON.stringify([{ menu_item_id: fixture.menu, quantity }]),
      action, orderId, requestId],
  );
}

async function waiterCall(client, table, requestId, quantity = 1) {
  return client.query(
    `select public.submit_waiter_order_batch($1,$2,'Concurrency Guest',null,null,$3::jsonb,$4) payload`,
    [fixture.slug, String(table), JSON.stringify([{ menu_item_id: fixture.menu, quantity }]), requestId],
  );
}

async function setup(admin) {
  await admin.query('begin');
  try {
    for (const [userId, label] of [[fixture.cashierAUser, 'cashier-a'], [fixture.cashierBUser, 'cashier-b'], [fixture.waiterUser, 'waiter']]) {
      await admin.query(`insert into auth.users
        (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
        values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now(),now())`,
      [userId, `${marker}-${label}@example.test`]);
    }
    await admin.query(`insert into public.restaurants(id,name,slug,active,payment_policy)
      values($1,'C1.1 Concurrency',$2,true,'pay_before_kitchen')`, [fixture.restaurant, fixture.slug]);
    await admin.query(`insert into public.restaurant_staff
      (id,restaurant_id,user_id,role,display_name,active) values
      ($1,$4,$5,'cashier','Concurrency Cashier A',true),
      ($2,$4,$6,'cashier','Concurrency Cashier B',true),
      ($3,$4,$7,'waiter','Concurrency Waiter',true)`,
    [fixture.cashierAStaff, fixture.cashierBStaff, fixture.waiterStaff, fixture.restaurant,
      fixture.cashierAUser, fixture.cashierBUser, fixture.waiterUser]);
    await admin.query(`insert into public.kitchen_stations
      (id,restaurant_id,name,display_color,icon,priority,active,is_default)
      values($1,$2,'Concurrency Kitchen','#2563eb','CK',1,true,true)`,
    [fixture.station, fixture.restaurant]);
    await admin.query(`insert into public.categories(id,restaurant_id,name)
      values($1,$2,'Concurrency')`, [fixture.category, fixture.restaurant]);
    await admin.query(`insert into public.menu_items
      (id,restaurant_id,category_id,name,price,available,kitchen_station_id)
      values($1,$2,$3,'Concurrency Item',10,true,$4)`,
    [fixture.menu, fixture.restaurant, fixture.category, fixture.station]);
    for (const table of fixture.tables) {
      await admin.query(`insert into public.restaurant_tables
        (id,restaurant_id,table_number,label,qr_token,qr_path,qr_url,active)
        values($1,$2,$3,$4,$5,$6,$7,true)`,
      [table.id, fixture.restaurant, table.number, `Concurrency ${table.number}`, table.token,
        `/r/${fixture.slug}/order?t=${table.number}`, `https://example.test/r/${fixture.slug}/order?t=${table.number}`]);
      await admin.query(`insert into public.restaurant_table_waiter_assignments
        (restaurant_id,table_id,waiter_staff_id,active) values($1,$2,$3,true)`,
      [fixture.restaurant, table.id, fixture.waiterStaff]);
    }
    await admin.query(`insert into public.business_payment_methods
      (restaurant_id,method_code,display_name,enabled,display_order)
      values($1,'cash','Cash',true,1)
      on conflict (restaurant_id,method_code) do update set enabled=true`, [fixture.restaurant]);
    await admin.query('commit');
  } catch (error) {
    await admin.query('rollback');
    throw error;
  }
}

async function cleanup(admin) {
  await admin.query('begin');
  try {
    await admin.query('delete from public.cashier_batch_requests where restaurant_id=$1', [fixture.restaurant]);
    for (const table of ['order_item_inventory_basis','order_items','order_invoices','orders']) {
      await admin.query(`alter table public.${table} disable trigger user`);
    }
    await admin.query('delete from public.order_item_inventory_basis where restaurant_id=$1', [fixture.restaurant]);
    await admin.query('delete from public.restaurants where id=$1', [fixture.restaurant]);
    for (const table of ['orders','order_invoices','order_items','order_item_inventory_basis']) {
      await admin.query(`alter table public.${table} enable trigger user`);
    }
    await admin.query('commit');
    await admin.query('delete from auth.users where id=any($1::uuid[])',
      [[fixture.cashierAUser, fixture.cashierBUser, fixture.waiterUser]]);
  } catch (error) {
    await admin.query('rollback').catch(() => {});
    throw error;
  }
}

async function run() {
  const admin = await connect('admin');
  const a = await connect('a');
  const b = await connect('b');
  const results = [];
  const pass = (label, detail = {}) => { results.push({ label, ok: true, detail }); console.log(`PASS ${label}`); };
  try {
    await setup(admin);

    // A: distinct Cashiers race to create the first session on one table.
    await Promise.all([beginActor(a, fixture.cashierAUser), beginActor(b, fixture.cashierBUser)]);
    const createA = cashierCall(a, 401, 'create', null, id());
    const createB = cashierCall(b, 401, 'create', null, id());
    const firstCreate = await raceUntilFirst([a, b], [createA, createB]);
    assert.equal(firstCreate.second.ok, false);
    assert.match(firstCreate.second.error.message, /already has an active order/i);
    await [a, b][firstCreate.secondIndex].query('rollback');
    const tableOne = (await admin.query(`select count(*)::int count from public.orders
      where restaurant_id=$1 and table_number='401' and dining_session_status='open'`, [fixture.restaurant])).rows[0];
    assert.equal(tableOne.count, 1);
    pass('Two-Cashier first-order race preserves one open session and safe conflict');

    // B: identical request ID submitted concurrently produces one operation.
    const sharedRequest = id();
    await Promise.all([beginActor(a, fixture.cashierAUser), beginActor(b, fixture.cashierAUser)]);
    const retryRace = await raceUntilFirst([a, b], [
      cashierCall(a, 402, 'create', null, sharedRequest),
      cashierCall(b, 402, 'create', null, sharedRequest),
    ]);
    assert.equal(retryRace.second.ok, true, retryRace.second.error?.message);
    await [a, b][retryRace.secondIndex].query('commit');
    const retryPayloads = [retryRace.first.result.rows[0].payload, retryRace.second.result.rows[0].payload];
    assert.equal(retryPayloads[0].order_id, retryPayloads[1].order_id);
    assert.equal(retryPayloads[0].invoice_id, retryPayloads[1].invoice_id);
    const retryCounts = (await admin.query(`select
      (select count(*) from public.orders where id=$1)::int orders,
      (select count(*) from public.order_invoices where order_id=$1)::int invoices,
      (select count(*) from public.order_items where order_id=$1)::int items,
      (select count(*) from public.cashier_batch_requests where id=$2)::int requests`,
    [retryPayloads[0].order_id, sharedRequest])).rows[0];
    assert.deepEqual(retryCounts, { orders: 1, invoices: 1, items: 1, requests: 1 });
    pass('Concurrent identical Cashier request ID creates one logical operation', retryCounts);

    // Create the shared session for append races.
    await beginActor(a, fixture.cashierAUser);
    const base = (await cashierCall(a, 403, 'create', null, id())).rows[0].payload;
    await a.query('commit');

    // C: two distinct Cashier additions serialize and both survive.
    await Promise.all([beginActor(a, fixture.cashierAUser), beginActor(b, fixture.cashierBUser)]);
    const appendRace = await raceUntilFirst([a, b], [
      cashierCall(a, 403, 'append', base.order_id, id(), 2),
      cashierCall(b, 403, 'append', base.order_id, id(), 3),
    ]);
    assert.equal(appendRace.second.ok, true, appendRace.second.error?.message);
    await [a, b][appendRace.secondIndex].query('commit');
    const appendPayloads = [appendRace.first.result.rows[0].payload, appendRace.second.result.rows[0].payload];
    assert.notEqual(appendPayloads[0].invoice_id, appendPayloads[1].invoice_id);
    const afterAppends = (await admin.query(`select count(distinct i.id)::int invoices,
      count(x.id)::int items,count(distinct x.appended_at)::int addition_batches
      from public.order_invoices i join public.order_items x on x.invoice_id=i.id
      where i.order_id=$1`, [base.order_id])).rows[0];
    assert.deepEqual(afterAppends, { invoices: 3, items: 3, addition_batches: 2 });
    pass('Concurrent distinct Cashier additions both survive as separate Kitchen work', afterAppends);

    // D: Cashier and Waiter additions contend on the same session and both survive.
    await Promise.all([beginActor(a, fixture.cashierAUser), beginActor(b, fixture.waiterUser)]);
    const staffRace = await raceUntilFirst([a, b], [
      cashierCall(a, 403, 'append', base.order_id, id(), 4),
      waiterCall(b, 403, id(), 5),
    ]);
    assert.equal(staffRace.second.ok, true, staffRace.second.error?.message);
    await [a, b][staffRace.secondIndex].query('commit');
    const staffPayloads = [staffRace.first.result.rows[0].payload, staffRace.second.result.rows[0].payload];
    const staffInvoices = (await admin.query(`select invoice_source,created_by_staff_id,
      public.invoice_is_kitchen_eligible(restaurant_id,id) eligible
      from public.order_invoices where id=any($1::uuid[]) order by invoice_source`,
    [staffPayloads.map((payload) => payload.invoice_id)])).rows;
    assert.equal(staffInvoices.length, 2);
    assert.ok(staffInvoices.every((row) => row.eligible));
    assert.ok(staffInvoices.some((row) => row.invoice_source === 'cashier'
      && row.created_by_staff_id === fixture.cashierAStaff));
    assert.ok(staffInvoices.some((row) => row.invoice_source === 'waiter'
      && row.created_by_staff_id === fixture.waiterStaff));
    pass('Concurrent Cashier and Waiter additions preserve attribution and eligibility', staffInvoices);

    console.log(JSON.stringify({ marker, results, clients: ['a', 'b'], synthetic: true }, null, 2));
  } finally {
    await Promise.allSettled([a.query('rollback'), b.query('rollback')]);
    await Promise.allSettled([a.end(), b.end()]);
    try { await cleanup(admin); } finally { await admin.end(); }
  }
}

run().catch((error) => {
  console.error(JSON.stringify({ marker, message: error.message, stack: error.stack }, null, 2));
  process.exitCode = 1;
});

// K1.7 hosted behavioural and true-concurrency verification.  This is an audit
// harness only: ordinary checks run inside ROLLBACK transactions; the two
// concurrency checks use a uniquely marked committed fixture which is removed
// and residue-checked in finally.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Client } = require('pg');

const root = path.resolve(__dirname, '../..');
const text = fs.readFileSync(path.join(root, 'supabase/connection.env'), 'utf8');
const url = text.match(/^\s*SUPABASE_DB_URL\s*=\s*(.+)\s*$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!url) throw new Error('SUPABASE_DB_URL missing');
const marker = `k17-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
const uuid = () => crypto.randomUUID();
const connect = async () => { const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } }); await c.connect(); return c; };
const pass = (label, detail = '') => console.log(`PASS ${label}${detail ? ` — ${detail}` : ''}`);
const fail = (label, detail = '') => { throw new Error(`${label}${detail ? ` — ${detail}` : ''}`); };
const expectError = async (label, fn, pattern) => {
  try { await fn(); fail(label, 'unexpected success'); }
  catch (error) { const message = String(error.message || error); if (!pattern.test(message)) fail(label, message); pass(label, message); return message; }
};
let savepointSequence = 0;
const expectDbErrorWithSavepoint = async (db, label, fn, pattern) => {
  const savepoint = `k17_expected_${++savepointSequence}`;
  await db.query(`savepoint ${savepoint}`);
  try {
    await fn();
    await db.query(`release savepoint ${savepoint}`);
    fail(label, 'unexpected success');
  } catch (error) {
    const message = String(error.message || error);
    await db.query(`rollback to savepoint ${savepoint}`);
    if (!pattern.test(message)) fail(label, message);
    pass(label, message);
    return message;
  }
};
const asUser = async (db, userId, fn) => {
  await db.query('set local role authenticated');
  await db.query("select set_config('request.jwt.claim.role','authenticated',true), set_config('request.jwt.claim.sub',$1,true)", [userId]);
  return fn();
};

async function identity(db) {
  const q = await db.query("select version from supabase_migrations.schema_migrations where version in ('264','265') order by version");
  assert.deepEqual(q.rows.map(r => r.version), ['264', '265']);
  const local = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'supabase/migrations/264_kitchen_station_unresolved_routing_obligation_safety.sql'))).digest('hex').toUpperCase();
  assert.equal(local, '9E493B7DDA216FE79749727F0BE770375977EC96048A4F1E952852595D9F4C84');
  const parked = path.join(root, 'supabase/parked-migrations/owner_menu_item_creation_atomic_idempotent.PARKED.sql');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(parked)).digest('hex').toUpperCase(), '06E8234B4E3ACCE277FF81ED14CCDE59704318B365DC995387653A3E05719537');
  const remoteParked = await db.query("select to_regclass('public.menu_item_creation_operations') value");
  assert.equal(remoteParked.rows[0].value, null);
  const management = await db.query("select pg_get_functiondef('public.manage_kitchen_station(uuid,text,uuid,text,text,text,text,integer,boolean)'::regprocedure) definition");
  assert.ok(management.rows[0].definition.includes("if normalized_action <> 'disable' then"));
  pass('production identity, head 265, deployed SHA, no-disable foundation side effect, and parked Menu absence');
}

function ids() { return { restaurant: uuid(), owner: uuid(), chef: uuid(), waiter: uuid(), cashier: uuid(), ownerStaff: uuid(), chefStaff: uuid(), waiterStaff: uuid(), cashierStaff: uuid(), cashierShift: uuid(), category: uuid(), table: uuid(), tableNumber: 400 + Math.floor(Math.random() * 100), a: uuid(), b: uuid(), item: uuid(), order: uuid(), invoice: uuid() }; }
async function seed(db, x, suffix = '') {
  await db.query(`insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
    ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now(),now()),
    ($3,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$4,'',now(),now(),now()),
    ($5,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$6,'',now(),now(),now()),
    ($7,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$8,'',now(),now(),now())`, [x.owner, `${marker}-owner-${suffix}@example.test`, x.chef, `${marker}-chef-${suffix}@example.test`, x.waiter, `${marker}-waiter-${suffix}@example.test`, x.cashier, `${marker}-cashier-${suffix}@example.test`]);
  await db.query("insert into public.restaurants(id,name,slug,active,payment_policy) values($1,$2,$3,true,'pay_before_kitchen')", [x.restaurant, `K1.7 ${marker}`, `${marker}-${suffix}`]);
  await db.query("insert into public.restaurant_staff(id,restaurant_id,user_id,role,display_name,active) values($1,$2,$3,'owner','K1.7 Owner',true),($4,$2,$5,'kitchen','K1.7 Chef',true),($6,$2,$7,'waiter','K1.7 Waiter',true),($8,$2,$9,'cashier','K1.7 Cashier',true)", [x.ownerStaff,x.restaurant,x.owner,x.chefStaff,x.chef,x.waiterStaff,x.waiter,x.cashierStaff,x.cashier]);
  await db.query("insert into public.cashier_shifts(id,restaurant_id,opened_by,opening_cash) values($1,$2,$3,0)",[x.cashierShift,x.restaurant,x.cashierStaff]);
  await db.query("insert into public.categories(id,restaurant_id,name) values($1,$2,'K1.7')", [x.category,x.restaurant]);
  await db.query("insert into public.restaurant_tables(id,restaurant_id,table_number,label,qr_token,qr_path,qr_url,active) values($1,$2,$3,'K1.7 Table',$4,$5,$6,true)", [x.table,x.restaurant,x.tableNumber,uuid(),`/r/${marker}-${suffix}/order?t=${x.tableNumber}`,`https://example.test/r/${marker}-${suffix}/order?t=${x.tableNumber}`]);
  // The restaurant bootstrap can create Main Kitchen; retain it as a third
  // active station.  A/B are the explicit target/fallback stations.
  await db.query("insert into public.kitchen_stations(id,restaurant_id,name,display_color,icon,priority,active,is_default) values($1,$3,'K1.7 A','#0f766e','MK',1,true,true),($2,$3,'K1.7 B','#2563eb','BK',2,true,false)", [x.a,x.b,x.restaurant]);
  await db.query('update public.restaurant_staff set assigned_kitchen_station_id=$1 where id=$2', [x.a,x.chefStaff]);
  await db.query("insert into public.menu_items(id,restaurant_id,category_id,name,price,available,kitchen_station_id) values($1,$2,$3,'K1.7 item',10,true,$4)", [x.item,x.restaurant,x.category,x.a]);
}
async function createPaidItem(db, x, status = 'accepted', orderId = x.order) {
  const invoiceId = orderId === x.order ? x.invoice : uuid();
  await db.query(`insert into public.orders(id,restaurant_id,table_id,table_number,status,total_price,customer_name,order_source,created_by_waiter_id,dining_session_status,dining_session_opened_at,payment_timing,operational_status,workflow_policy_snapshot,workflow_version,workflow_captured_at)
    values($1,$2,$3,$4,'paid',10,'K1.7','waiter',$5,'open',now(),'before_kitchen','accepted','kitchen_before_payment',1,now())`, [orderId,x.restaurant,x.table,String(x.tableNumber),x.waiterStaff]);
  await db.query(`insert into public.order_invoices(id,restaurant_id,order_id,invoice_number,status,total_price,payment_status,grand_total,subtotal,invoice_source,created_by_staff_id,cashier_shift_id,verified_by,verified_at,paid_at)
    values($1,$2,$3,1,'verified',10,'paid',10,10,'waiter',$4,$5,$6,now(),now())`, [invoiceId,x.restaurant,orderId,x.waiterStaff,x.cashierShift,x.cashierStaff]);
  const itemId=uuid();
  await db.query(`insert into public.order_items(id,restaurant_id,order_id,menu_item_id,quantity,price,invoice_id,kitchen_status)
    values($1,$2,$3,$4,1,10,$5,$6)`, [itemId,x.restaurant,orderId,x.item,invoiceId,status]);
  return { itemId, invoiceId, orderId };
}
async function disable(db, x, station = x.a) { return asUser(db,x.owner,()=>db.query("select public.manage_kitchen_station($1,'disable',$2,null,null,'#0f766e','MK',1,false)",[x.restaurant,station])); }
async function active(db,x,station=x.a) { return (await db.query('select active from public.kitchen_stations where id=$1',[station])).rows[0].active; }

async function rollbackBehavior(db) {
  await db.query('begin'); const x=ids();
  try {
    await seed(db,x,'rollback');
    // Last-active is evaluated in its own tenant so bootstrap stations cannot mask it.
    await db.query('update public.kitchen_stations set active=false where id=$1',[x.b]);
    const lastActiveCount = Number((await db.query('select count(*) n from public.kitchen_stations where restaurant_id=$1 and archived_at is null',[x.restaurant])).rows[0].n);
    await expectDbErrorWithSavepoint(db,'last active station protection',()=>disable(db,x,x.a),/LAST_ACTIVE_KITCHEN_STATION/);
    assert.equal(await active(db,x,x.a),true);
    assert.equal(await active(db,x,x.b),false);
    assert.equal(Number((await db.query('select count(*) n from public.kitchen_stations where restaurant_id=$1 and archived_at is null',[x.restaurant])).rows[0].n),lastActiveCount);
    assert.equal(Number((await db.query("select count(*) n from public.kitchen_stations where restaurant_id=$1 and active and name='Main Kitchen' and archived_at is null",[x.restaurant])).rows[0].n),0);
    pass('last-active rejection preserves target/default identity and creates no replacement station');
    await db.query('update public.kitchen_stations set active=true where id=any($1::uuid[])',[ [x.a,x.b] ]);
    for (const status of ['held','accepted','preparing','ready']) {
      const orderId=uuid(); const row=await createPaidItem(db,x,status === 'held' ? 'held' : 'accepted',orderId);
      if (status === 'preparing' || status === 'ready') {
        await asUser(db,x.chef,()=>db.query("select public.start_order_preparation($1,$2,'initial')",[orderId,x.a]));
      }
      if (status === 'ready') {
        await asUser(db,x.chef,()=>db.query("select public.mark_order_ready($1,$2,'initial')",[orderId,x.a]));
      }
      await expectDbErrorWithSavepoint(db,`${status} frozen obligation protection`,()=>disable(db,x),/KITCHEN_STATION_HAS_UNRESOLVED_WORK/);
      assert.equal(await active(db,x),true); assert.equal((await db.query('select kitchen_station_id from public.order_items where id=$1',[row.itemId])).rows[0].kitchen_station_id,x.a);
      await db.query('update public.order_items set kitchen_status=$2 where id=$1',[row.itemId,'completed']);
    }
    const terminal=await createPaidItem(db,x,'completed',uuid()); await disable(db,x); assert.equal(await active(db,x),false); assert.equal((await db.query('select kitchen_station_id from public.order_items where id=$1',[terminal.itemId])).rows[0].kitchen_station_id,x.a); pass('completed is terminal; disable preserves frozen route');
    await db.query('update public.kitchen_stations set active=true where id=$1',[x.a]);
    // Cancellation is terminal at the deployed predicate.  Its official trigger
    // additionally requires a cashier cancellation record, so no direct update is used.
    const cancelled=await createPaidItem(db,x,'cancelled',uuid()); await disable(db,x); assert.equal(await active(db,x),false); pass('cancelled is terminal for station-disable predicate');
    await db.query('update public.kitchen_stations set active=true where id=$1',[x.a]);
    const progress=await createPaidItem(db,x,'accepted',uuid());
    await expectDbErrorWithSavepoint(db,'failed disable leaves chef route active',()=>disable(db,x),/KITCHEN_STATION_HAS_UNRESOLVED_WORK/);
    const context=await asUser(db,x.chef,()=>db.query('select public.resolve_kitchen_action_context($1,$2) c',[progress.orderId,x.a])); assert.equal(context.rows[0].c.station_id,x.a);
    await asUser(db,x.chef,()=>db.query("select public.start_order_preparation($1,$2,'initial')",[progress.orderId,x.a]));
    await asUser(db,x.chef,()=>db.query("select public.mark_order_ready($1,$2,'initial')",[progress.orderId,x.a]));
    await asUser(db,x.chef,()=>db.query("select public.mark_order_completed($1,$2,'initial')",[progress.orderId,x.a]));
    pass('Chef/KDS progression continues after failed disable');
    await db.query('update public.kitchen_stations set active=false where id=$1',[x.a]);
    await expectDbErrorWithSavepoint(db,'inactive station rejects Chef/KDS action context',()=>asUser(db,x.chef,()=>db.query('select public.resolve_kitchen_action_context($1,$2)',[progress.orderId,x.a])),/Wrong station/);
    await db.query('rollback');
  } catch(e) { await db.query('rollback').catch(()=>{}); throw e; }
}

async function cleanup(db) {
  await db.query("delete from public.restaurants where slug like $1", [`${marker}%`]);
  await db.query("delete from auth.users where email like $1", [`${marker}%@example.test`]);
  const residue=await db.query("select (select count(*) from public.restaurants where slug like $1)+(select count(*) from auth.users where email like $1) n", [`${marker}%`,`$`]);
  assert.equal(Number(residue.rows[0].n),0); pass('committed concurrency fixture cleanup proved zero restaurant/auth residue');
}

async function concurrency() {
  const setup=await connect(); const x=ids();
  try {
    await seed(setup,x,'concurrency'); // committed fixture is necessary for independent sessions.
    // Route first: INSERT acquires Migration 264's route lock and retains it until commit.
    const route=await connect(), off=await connect(); const orderId=uuid();
    await route.query('begin'); await createPaidItem(route,x,'accepted',orderId); // deployed trigger routed to A and lock remains held
    const blockedDisable=disable(off,x).then(()=>({ok:true}),e=>({ok:false,message:e.message}));
    await new Promise(r=>setTimeout(r,250));
    const waiting=await setup.query("select count(*)::int n from pg_stat_activity where wait_event_type='Lock' and query ilike '%manage_kitchen_station%'"); assert.ok(waiting.rows[0].n>=1);
    await route.query('commit'); const outcome=await blockedDisable; assert.equal(outcome.ok,false); assert.match(outcome.message,/KITCHEN_STATION_HAS_UNRESOLVED_WORK/); assert.equal(await active(setup,x),true); pass('route-first true overlap: disable waited then denied');
    await route.end(); await off.end();
    // Clean only the unresolved item/order from the first direction, then force
    // disable-first.  The update itself takes both deployed advisory locks.
    await setup.query('delete from public.orders where id=$1',[orderId]);
    const dis=await connect(), insert=await connect(); await dis.query('begin'); await disable(dis,x); // update uncommitted, locks held
    const nextOrder=uuid(); const blockedRoute=createPaidItem(insert,x,'accepted',nextOrder);
    await new Promise(r=>setTimeout(r,250));
    const waiting2=await setup.query("select count(*)::int n from pg_stat_activity where wait_event_type='Lock' and query ilike '%insert into public.order_items%'"); assert.ok(waiting2.rows[0].n>=1);
    await dis.query('commit'); await blockedRoute; const routed=(await setup.query('select kitchen_station_id from public.order_items where order_id=$1',[nextOrder])).rows[0].kitchen_station_id; assert.notEqual(routed,x.a); pass('disable-first true overlap: route waited and chose active fallback');
    await dis.end(); await insert.end();
    // Two simultaneous disables: A has already disabled, re-enable it and make B
    // the only counterpart.  The lifecycle lock allows exactly one commit.
    await setup.query('update public.kitchen_stations set active=true where id=$1',[x.a]);
    await setup.query('delete from public.orders where id=$1',[nextOrder]);
    const da=await connect(), db=await connect(); await da.query('begin'); await disable(da,x,x.a);
    const second=disable(db,x,x.b).then(()=>({ok:true}),e=>({ok:false,message:e.message})); await new Promise(r=>setTimeout(r,250)); await da.query('commit'); const two=await second; assert.equal(two.ok,false); assert.match(two.message,/LAST_ACTIVE_KITCHEN_STATION/); const count=(await setup.query('select count(*)::int n from public.kitchen_stations where restaurant_id=$1 and active and archived_at is null',[x.restaurant])).rows[0].n; assert.ok(count>=1); pass('concurrent disable serializes and retains an active station',`active=${count}`); await da.end(); await db.end();
  } finally { await cleanup(setup).catch(e=>{ console.error('CLEANUP FAILURE',e); throw e; }); await setup.end(); }
}

(async()=>{ const db=await connect(); try { await identity(db); await rollbackBehavior(db); } finally { await db.end(); } await concurrency(); console.log(`K1.7 AUDIT PASS marker=${marker}`); })().catch(e=>{ console.error(`K1.7 AUDIT ERROR ${e.stack||e}`); process.exitCode=1; });

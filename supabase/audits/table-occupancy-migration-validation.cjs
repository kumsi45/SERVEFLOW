const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const { Client } = require('pg');

const root = path.resolve(__dirname, '../..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/261_public_qr_session_lookup_occupancy_side_effect_free.sql'), 'utf8');
function client() {
  const source = fs.readFileSync(path.join(root, 'supabase/connection.env'), 'utf8');
  const line = source.split(/\r?\n/).find(value => /^\s*SUPABASE_DB_URL\s*=/.test(value));
  if (!line) throw new Error('Database connection configuration missing');
  return new Client({ connectionString: line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, '').trim().replace(/^['"]|['"]$/g, ''),
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
}
const check = (label, condition) => { assert.ok(condition, label); console.log('PASS', label); };
async function rpc(db, role, user, sql, args = []) {
  assert.ok(['anon','authenticated'].includes(role));
  await db.query(`savepoint rpc_call; set local role ${role}`);
  try {
    await db.query("select set_config('request.jwt.claim.role',$1,true),set_config('request.jwt.claim.sub',$2,true)", [role,user || '']);
    const result = await db.query(sql,args);
    return result;
  } catch (error) { await db.query('rollback to savepoint rpc_call'); throw error; }
  finally { await db.query('reset role; release savepoint rpc_call'); }
}
async function rejected(db, label, action, pattern) {
  let failure;
  try { await action(); } catch (error) { failure = error; }
  check(label, failure && (!pattern || pattern.test(failure.message)));
}
async function fixtures(db, openShift = true) {
  const f = { restaurant:randomUUID(), other:randomUUID(), owner:randomUUID(), waiter:randomUUID(), cashier:randomUUID(),
    ownerStaff:randomUUID(), waiterStaff:randomUUID(), cashierStaff:randomUUID(), category:randomUUID(), item:randomUUID(), station:randomUUID() };
  f.slug = `occupancy-validation-${f.restaurant}`;
  f.otherSlug = `occupancy-validation-${f.other}`;
  for (const user of [f.owner,f.waiter,f.cashier]) {
    await db.query(`insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
      values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now(),now())`, [user,`occupancy-${user}@example.test`]);
  }
  await db.query(`insert into public.restaurants(id,name,slug,total_tables,table_count,profile)
    values($1,'Occupancy rollback fixture',$2,8,8,'{}'),($3,'Occupancy other fixture',$4,2,2,'{}')`, [f.restaurant,f.slug,f.other,f.otherSlug]);
  for (const [id,user,role] of [[f.ownerStaff,f.owner,'owner'],[f.waiterStaff,f.waiter,'waiter'],[f.cashierStaff,f.cashier,'cashier']]) {
    await db.query(`insert into public.restaurant_staff(id,restaurant_id,user_id,role,display_name,email,active)
      values($1,$2,$3,$4,'Occupancy fixture staff',$5,true)`, [id,f.restaurant,user,role,`occupancy-${user}@example.test`]);
  }
  await db.query("insert into public.categories(id,restaurant_id,name) values($1,$2,'Occupancy fixture menu')", [f.category,f.restaurant]);
  await db.query(`insert into public.kitchen_stations(id,restaurant_id,name,active,is_default)
    values($1,$2,'Occupancy fixture kitchen',true,true)`, [f.station,f.restaurant]);
  await db.query(`insert into public.menu_items(id,restaurant_id,category_id,kitchen_station_id,name,price,available)
    values($1,$2,$3,$4,'Occupancy fixture item',10,true)`, [f.item,f.restaurant,f.category,f.station]);
  f.tables = (await db.query('select id,table_number,qr_token from public.restaurant_tables where restaurant_id=$1 order by table_number', [f.restaurant])).rows;
  f.items = JSON.stringify([{menu_item_id:f.item,quantity:1}]);
  if (openShift) await rpc(db,'authenticated',f.cashier,'select * from public.open_cashier_shift($1,0,$2)',[f.restaurant,'Occupancy rollback fixture']);
  return f;
}
async function tableState(db, f, table) {
  return (await db.query(`select
    (select count(*)::int from public.orders where restaurant_id=$1 and table_id=$2) orders,
    (select count(*)::int from public.orders where restaurant_id=$1 and table_id=$2 and public.is_public_qr_dining_session_open(id)) occupied,
    (select count(*)::int from public.restaurant_table_qr_scans where restaurant_id=$1 and table_id=$2) scans`, [f.restaurant,table.id])).rows[0];
}
const qrArgs = (f,t,browser) => [f.slug,String(t.table_number),t.qr_token,browser];
async function qrOrder(db,f,t,browser,items=f.items) {
  return (await rpc(db,'anon',null,'select public.create_public_qr_order($1,$2,$3,$4,$5,$6,$7::jsonb) payload',
    [...qrArgs(f,t,browser),'Occupancy fixture customer','Cash',items])).rows[0].payload;
}
async function waiterOrder(db,f,t) {
  return (await rpc(db,'authenticated',f.waiter,'select public.create_waiter_order($1,$2,$3,$4,$5,$6::jsonb) payload',
    [f.slug,String(t.table_number),'Occupancy fixture customer',null,null,f.items])).rows[0].payload;
}
async function lookup(db,f,t,browser) {
  return (await rpc(db,'anon',null,'select public.get_public_qr_order_session($1,$2,$3,$4) payload',qrArgs(f,t,browser))).rows[0].payload;
}
async function completeItems(db,f,id) {
  await db.query(`update public.order_items set kitchen_status='completed',
    kitchen_preparation_started_at=now(),kitchen_preparation_started_by=$3,
    kitchen_ready_marked_at=now(),kitchen_ready_marked_by=$3,
    kitchen_completed_at=now(),kitchen_completed_by=$3
    where restaurant_id=$1 and order_id=$2`, [f.restaurant,id,f.cashierStaff]);
}
async function release(db,f,id) {
  // Use canonical settlement, including cashier identity, shift and audit.
  await rpc(db,'authenticated',f.cashier,'select public.verify_dining_session_payment($1,$2,null,null,null,false)',[id,'Cash']);
  check('payment alone leaves unserved fixture occupied', (await db.query('select public.is_public_qr_dining_session_open($1) occupied',[id])).rows[0].occupied);
  await completeItems(db,f,id);
  await rpc(db,'authenticated',f.cashier,'select * from public.close_dining_session($1,$2)',[id,'occupancy_rollback_validation']);
  check('canonical release closes and releases fixture', !(await db.query('select public.is_public_qr_dining_session_open($1) occupied',[id])).rows[0].occupied);
}
async function contend(db,f,t,kind) {
  // Independent connection holds the exact existing location advisory lock.
  // The fixture is private to the rollback transaction: never commit fixture
  // tenants just to make them visible to a second business-order client.
  const blocker = client();
  await blocker.connect();
  let pending;
  try {
    const pid = (await db.query('select pg_backend_pid() pid')).rows[0].pid;
    await blocker.query('begin');
    await blocker.query('select pg_advisory_xact_lock(hashtextextended($1::text||\':\'||$2::text,0))',[f.restaurant,String(t.table_number)]);
    pending = (kind==='QR' ? qrOrder(db,f,t,randomUUID()) : waiterOrder(db,f,t))
      .then(value=>({value}),error=>({error}));
    let waiting = false;
    for (let i=0;i<20;i++) {
      waiting = (await blocker.query("select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted) waiting",[pid])).rows[0].waiting;
      if (waiting) break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    await blocker.query('rollback');
    const result = await pending;
    if (result.error) throw result.error;
    check(`${kind} real first-order RPC waits for independent location lock`,waiting);
    check(`${kind} proceeds with one occupied session after contention`,(await tableState(db,f,t)).occupied===1);
    return result.value;
  } finally {
    try { await blocker.query('rollback'); } finally { await blocker.end(); }
    if (pending) await pending;
  }
}
async function concurrentFixtures(db) {
  // Post-deploy authorization permits removable fixture catalog rows. Only
  // fixture users/tenants/menu/tables are committed for cross-client visibility;
  // every real-order transaction below is rolled back, never committed.
  const f = await fixtures(db,false);
  await db.query('commit');
  const a = client();
  const b = client();
  let pending;
  try {
    await a.connect();
    await b.connect();
    await Promise.all([a.query('begin'),b.query('begin')]);
    const lookups = await Promise.all([lookup(a,f,f.tables[0],randomUUID()),lookup(b,f,f.tables[0],randomUUID())]);
    check('two independent simultaneous lookups return null and create no session',lookups.every(value=>value===null) && (await tableState(db,f,f.tables[0])).orders===0);
    await Promise.all([a.query('rollback'),b.query('rollback')]);
    for (const kind of ['QR','Waiter']) {
      const t = f.tables[kind==='QR' ? 1 : 2];
      await Promise.all([a.query('begin'),b.query('begin')]);
      await a.query('select pg_advisory_xact_lock(hashtextextended($1::text||\':\'||$2::text,0))',[f.restaurant,String(t.table_number)]);
      const pid = (await b.query('select pg_backend_pid() pid')).rows[0].pid;
      const browser = randomUUID();
      pending = qrOrder(b,f,t,randomUUID()).then(value=>({value}),error=>({error}));
      const first = kind==='QR' ? await qrOrder(a,f,t,browser) : await waiterOrder(a,f,t);
      const waiting = (await db.query("select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted) waiting",[pid])).rows[0].waiting;
      check(`${kind}+QR independent first-order attempts serialize at location lock`,waiting && (await tableState(a,f,t)).occupied===1);
      const extra = kind==='QR' ? await qrOrder(a,f,t,browser) : await waiterOrder(a,f,t);
      check(`${kind} holder additional order reuses canonical session during contention`,extra.order_id===first.order_id && (await tableState(a,f,t)).orders===1);
      await a.query('rollback');
      const second = await pending;
      pending = undefined;
      if (second.error) throw second.error;
      check(`${kind}+QR contender proceeds safely after holder aborts`,second.value.order_id!==first.order_id && (await tableState(b,f,t)).occupied===1 && (await tableState(b,f,t)).orders===1);
      await b.query('rollback');
      check(`${kind}+QR contention leaves zero committed test orders`,(await tableState(db,f,t)).orders===0);
    }
  } finally {
    try {
      await Promise.allSettled([a.query('rollback'),b.query('rollback')]);
      if (pending) await pending;
      await Promise.allSettled([a.end(),b.end()]);
    } finally {
      // Delete only the exact newly generated fixture identities, never an
      // existing restaurant or any historical business session.
      await db.query('begin');
      const owned = (await db.query('select count(*)::int n from public.restaurants where (id=$1 and slug=$2) or (id=$3 and slug=$4)',[f.restaurant,f.slug,f.other,f.otherSlug])).rows[0].n;
      assert.equal(owned,2,'Only exact fixture tenants may be removed');
      assert.equal((await db.query('select count(*)::int n from public.orders where restaurant_id=any($1::uuid[])',[[f.restaurant,f.other]])).rows[0].n,0,'No order may be committed by concurrency validation');
      await db.query('delete from public.restaurants where id=any($1::uuid[])',[[f.restaurant,f.other]]);
      await db.query('delete from auth.users where id=any($1::uuid[])',[[f.owner,f.waiter,f.cashier]]);
      await db.query('commit');
      check('committed concurrency fixture tenants and users removed with zero residue',
        (await db.query(`select (select count(*) from public.restaurants where id=any($1::uuid[]))+
          (select count(*) from auth.users where id=any($2::uuid[])) n`,[[f.restaurant,f.other],[f.owner,f.waiter,f.cashier]])).rows[0].n==='0');
    }
  }
}
async function validate(db,f) {
  const [t,waiterTable,reverseTable,failedTable,cashierTable,,,lastTable] = f.tables;
  const browser = randomUUID();
  check('before access Available', (await tableState(db,f,t)).occupied===0);
  const menu = (await rpc(db,'anon',null,'select public.get_public_qr_menu($1) payload',[f.slug])).rows[0].payload;
  check('public menu redacts QR capabilities', !/qr_token|qr_path|qr_url/.test(JSON.stringify(menu)));
  for (const phone of [browser,randomUUID()]) {
    await rpc(db,'anon',null,'select public.log_public_qr_scan($1,$2,$3)',qrArgs(f,t,phone).slice(0,3));
    check('different phones lookup no session', await lookup(db,f,t,phone)===null);
    const portal = (await rpc(db,'anon',null,'select public.get_smart_qr_portal_state($1,$2,$3,$4) payload',qrArgs(f,t,phone))).rows[0].payload;
    check('smart portal stays available',portal.mode==='available');
  }
  const accessState = await tableState(db,f,t);
  check('scan/menu/two-phone access creates no orders and preserves scans',accessState.orders===0 && accessState.occupied===0 && accessState.scans===2);
  check('three-argument lookup overload also returns null', (await rpc(db,'anon',null,'select public.get_public_qr_order_session($1,$2,$3) payload',qrArgs(f,t,browser).slice(0,3))).rows[0].payload===null);
  for (const [label,args] of [ ['wrong token',[f.slug,String(t.table_number),randomUUID(),browser]],
    ['missing token',[f.slug,String(t.table_number),null,browser]], ['cross-tenant token',[f.otherSlug,String(t.table_number),t.qr_token,browser]] ]) {
    await rejected(db,`${label} lookup rejected`,()=>rpc(db,'anon',null,'select public.get_public_qr_order_session($1,$2,$3,$4)',args),/QR code/);
    await rejected(db,`${label} order rejected`,()=>rpc(db,'anon',null,'select public.create_public_qr_order($1,$2,$3,$4,$5,$6,$7::jsonb)',[...args,null,'Cash',f.items]),/QR code/);
  }
  await rejected(db,'invalid item rejected without occupancy',()=>qrOrder(db,f,failedTable,browser,JSON.stringify([{menu_item_id:randomUUID(),quantity:1}])),/invalid|unavailable/);
  check('invalid order leaves no empty row',(await tableState(db,f,failedTable)).orders===0);
  await rejected(db,'failure after successful RPC rolls back new order/invoice/items',()=>rpc(db,'anon',null,
    `with created as materialized(select public.create_public_qr_order($1,$2,$3,$4,$5,$6,$7::jsonb) p)
      select (p->>'order_id')::uuid,1/(length(p::text)-length(p::text)) from created`,
    [...qrArgs(f,failedTable,browser),null,'Cash',f.items]),/division by zero/);
  check('post-order transaction failure leaves no phantom',(await tableState(db,f,failedTable)).orders===0);
  const first = await qrOrder(db,f,t,browser);
  check('first QR real order becomes Occupied',(await tableState(db,f,t)).occupied===1 && first.order_id);
  const before = (await db.query('select to_jsonb(o) row from public.orders o where id=$1',[first.order_id])).rows[0].row;
  const session = await lookup(db,f,t,browser);
  const after = (await db.query('select to_jsonb(o) row from public.orders o where id=$1',[first.order_id])).rows[0].row;
  check('existing-session response retains identity/items/invoices',session.order_id===first.order_id && session.items.length===1 && session.invoices.length===1);
  check('lookup does not refresh/mutate order',JSON.stringify(before)===JSON.stringify(after));
  const additional = await qrOrder(db,f,t,browser);
  check('same browser additional order reuses one session',additional.order_id===first.order_id && (await tableState(db,f,t)).orders===1);
  await rejected(db,'different browser cannot duplicate active QR session',()=>qrOrder(db,f,t,randomUUID()),/active dining session/);
  const waiterFirst = await waiterOrder(db,f,waiterTable);
  check('first Waiter real order becomes Occupied',(await tableState(db,f,waiterTable)).occupied===1);
  check('Waiter append reuses canonical session',(await waiterOrder(db,f,waiterTable)).order_id===waiterFirst.order_id);
  const waiterAfterQr = await waiterOrder(db,f,t);
  check('QR wins then Waiter reuses one session',waiterAfterQr.order_id===first.order_id && (await tableState(db,f,t)).orders===1);
  const reverse = await waiterOrder(db,f,reverseTable);
  await rejected(db,'Waiter wins then unrelated QR cannot duplicate session',()=>qrOrder(db,f,reverseTable,randomUUID()),/active dining session/);
  check('Waiter-first rejection leaves one session',(await tableState(db,f,reverseTable)).orders===1 && reverse.order_id);
  await completeItems(db,f,reverse.order_id);
  check('service completion alone with unpaid invoice does not release',(await tableState(db,f,reverseTable)).occupied===1);
  const cashier = (await rpc(db,'authenticated',f.cashier,'select public.create_cashier_order($1,$2,$3,$4::jsonb) payload',
    [f.restaurant,String(cashierTable.table_number),'Cash',f.items])).rows[0].payload;
  check('cashier first real order occupies',(await tableState(db,f,cashierTable)).occupied===1);
  const appended = (await rpc(db,'authenticated',f.cashier,'select public.append_items_to_order($1,$2::jsonb) payload',[cashier.order_id,f.items])).rows[0].payload;
  check('cashier add-on keeps canonical identity',appended.order_id===cashier.order_id);
  await rejected(db,'cashier cannot bypass unique active-session protection',()=>rpc(db,'authenticated',f.cashier,
    'select public.create_cashier_order($1,$2,$3,$4::jsonb)',[f.restaurant,String(cashierTable.table_number),'Cash',f.items]),/duplicate key|unique/);
  await contend(db,f,f.tables[5],'QR');
  await contend(db,f,f.tables[6],'Waiter');
  await release(db,f,cashier.order_id);
  const afterRelease = (await rpc(db,'authenticated',f.cashier,'select public.append_items_to_order($1,$2::jsonb) payload',[cashier.order_id,f.items])).rows[0].payload;
  check('cashier add-on after release creates one new session and keeps history',afterRelease.order_id!==cashier.order_id &&
    afterRelease.previous_order_id===cashier.order_id && (await tableState(db,f,cashierTable)).occupied===1);
  await rpc(db,'authenticated',f.owner,'select * from public.set_restaurant_table_active($1,$2,false)',[f.restaurant,t.id]);
  check('Disabled + active session remains Occupied',(await tableState(db,f,t)).occupied===1);
  await rejected(db,'inactive lookup rejected',()=>lookup(db,f,t,browser),/QR code/);
  await rejected(db,'inactive QR order rejected',()=>qrOrder(db,f,t,browser),/QR code/);
  await rpc(db,'authenticated',f.owner,'select * from public.set_restaurant_table_active($1,$2,true)',[f.restaurant,t.id]);
  await rejected(db,'anon table enumeration denied',()=>rpc(db,'anon',null,'select * from public.restaurant_tables'),/permission denied/);
  const stats = (await rpc(db,'authenticated',f.owner,'select * from public.get_owner_table_qr_stats($1)',[f.restaurant])).rows;
  check('scan count and last scan remain available',stats.find(row=>row.table_id===t.id)?.scan_count===2 && stats.find(row=>row.table_id===t.id)?.last_scan_at);
  const oldToken = failedTable.qr_token;
  await rpc(db,'authenticated',f.owner,'select * from public.regenerate_restaurant_table_qr($1,$2)',[f.restaurant,failedTable.id]);
  await rejected(db,'old fixture QR rejected after regeneration',()=>lookup(db,f,failedTable,browser),/QR code/);
  failedTable.qr_token = (await db.query('select qr_token from public.restaurant_tables where id=$1',[failedTable.id])).rows[0].qr_token;
  check('regenerated fixture QR works without occupancy',failedTable.qr_token!==oldToken && await lookup(db,f,failedTable,browser)===null && (await tableState(db,f,failedTable)).orders===0);
  await rpc(db,'authenticated',f.owner,'select * from public.set_restaurant_table_active($1,$2,false)',[f.restaurant,failedTable.id]);
  check('Disabled + no session stays Available',(await tableState(db,f,failedTable)).occupied===0);
  await rejected(db,'inactive scan rejected',()=>rpc(db,'anon',null,'select public.log_public_qr_scan($1,$2,$3)',qrArgs(f,failedTable,browser).slice(0,3)),/QR code/);
  await rpc(db,'authenticated',f.owner,'select * from public.set_restaurant_table_active($1,$2,true)',[f.restaurant,failedTable.id]);
  check('new fixture QR accepts a real order',(await qrOrder(db,f,failedTable,browser)).order_id && (await tableState(db,f,failedTable)).occupied===1);
  await release(db,f,first.order_id);
  check('released history lookup returns null',await lookup(db,f,t,browser)===null);
  const replacement = await qrOrder(db,f,t,randomUUID());
  check('released history new order has new identity, one active session',replacement.order_id!==first.order_id && (await tableState(db,f,t)).occupied===1);
  const last = await qrOrder(db,f,lastTable,randomUUID());
  await rejected(db,'count reduction blocks genuine unreleased session',()=>rpc(db,'authenticated',f.owner,'select * from public.sync_restaurant_tables($1,7)',[f.restaurant]),/open, unreleased dining session/);
  await release(db,f,last.order_id);
  await rpc(db,'authenticated',f.owner,'select * from public.sync_restaurant_tables($1,7)',[f.restaurant]);
  const detached = (await db.query('select restaurant_id,table_id from public.orders where id=$1',[last.order_id])).rows[0];
  check('released history permits reduction and preserves tenant',detached.restaurant_id===f.restaurant && detached.table_id===null);
}
async function metadata(db) {
  const columns = await db.query(`select column_name, column_default, is_nullable from information_schema.columns
    where table_schema='public' and table_name='orders' order by ordinal_position`);
  const references = await db.query(`select c.conrelid::regclass::text child, pg_get_constraintdef(c.oid) definition
    from pg_constraint c where c.contype='f' and c.confrelid='public.orders'::regclass order by 1,2`);
  const indexes = await db.query(`select indexname,indexdef from pg_indexes where schemaname='public'
    and tablename='orders' and indexdef ilike '%unique%'`);
  console.log(JSON.stringify({ columns: columns.rows, references: references.rows, indexes: indexes.rows }, null, 2));
}
async function candidates(db) {
  // Fail closed on schema drift: enumerate every public direct order/session
  // reference, including common generic activity keys, instead of assuming
  // that absence of items/invoices is sufficient history protection.
  const refs = (await db.query(`select table_name,column_name from information_schema.columns
    where table_schema='public' and table_name<>'orders'
    and column_name in ('order_id','dining_session_id','entity_id','record_id','target_id')
    order by table_name,column_name`)).rows;
  const quote = value => '"' + value.replaceAll('"','""') + '"';
  const noReferences = refs.map(row => `not exists(select 1 from public.${quote(row.table_name)} r where r.${quote(row.column_name)}::text=o.id::text)`).join('\n and ');
  const predicate = `o.order_source='public_qr' and o.status::text='pending' and o.operational_status='new'
    and o.dining_session_status='open' and o.table_released_at is null and o.table_id is not null
    and o.total_price=0 and o.created_by_waiter_id is null and o.customer_user_id is null
    and o.customer_name is null and o.customer_phone is null and o.order_note is null
    and o.browser_session_token is not null and o.dining_session_qr_scan_at is not null
    and o.payment_method='Cash' and o.payment_verified_by is null and o.payment_verified_at is null
    and o.completed_by is null and o.completed_at is null and o.preparation_started_by is null
    and o.preparation_started_at is null and o.ready_marked_by is null and o.ready_marked_at is null
    and o.dining_session_closed_at is null and o.dining_session_close_reason is null
    and o.bill_requested_at is null and o.billing_started_at is null and o.cleaning_started_at is null
    and o.ordering_locked_at is null and o.ordering_locked_by is null and o.ordering_lock_reason is null
    and o.bill_prepared_at is null and o.bill_prepared_by is null and o.bill_printed_at is null
    and o.bill_printed_by is null and o.bill_request_ignored_at is null and o.bill_request_ignored_by is null
    and exists(select 1 from public.restaurant_tables t where t.restaurant_id=o.restaurant_id
      and t.id=o.table_id and t.table_number::text=trim(o.table_number))
    and not exists(select 1 from public.orders other where other.restaurant_id=o.restaurant_id
      and other.table_id=o.table_id and other.id<>o.id and other.dining_session_status='open'
      and other.table_released_at is null)
    and ${noReferences}`;
  const result = await db.query(`select count(*)::int candidates,count(distinct restaurant_id)::int affected_restaurants,
    min(created_at) oldest,max(created_at) newest from public.orders o where ${predicate}`);
  console.log('RECONCILIATION CANDIDATE SUMMARY',JSON.stringify(result.rows[0]));
  const broad = await db.query(`select count(*)::int empty_public_sessions,
    count(distinct restaurant_id)::int affected_restaurants,min(created_at) oldest,max(created_at) newest
    from public.orders o where o.order_source='public_qr' and o.dining_session_status='open'
    and o.table_released_at is null
    and not exists(select 1 from public.order_items i where i.order_id=o.id)
    and not exists(select 1 from public.order_invoices i where i.order_id=o.id)`);
  console.log('BROAD EMPTY PUBLIC SESSIONS (not cleanup candidates)',JSON.stringify(broad.rows[0]));
  const diagnostic = await db.query(`select o.status::text status,o.operational_status,
    o.payment_method,count(*)::int count,
    bool_and(o.total_price=0) all_zero,
    bool_and(o.created_by_waiter_id is null and o.customer_user_id is null) no_staff_or_user,
    bool_and(o.customer_name is null and o.customer_phone is null and o.order_note is null) no_customer_content,
    bool_and(o.browser_session_token is not null and o.dining_session_qr_scan_at is not null) access_markers,
    bool_and(${noReferences}) no_direct_history
    from public.orders o where o.order_source='public_qr' and o.dining_session_status='open'
      and o.table_released_at is null
      and not exists(select 1 from public.order_items i where i.order_id=o.id)
      and not exists(select 1 from public.order_invoices i where i.order_id=o.id)
    group by o.status::text,o.operational_status,o.payment_method`);
  console.log('ANONYMIZED EMPTY-SESSION SHAPE',JSON.stringify(diagnostic.rows));
  const history = await db.query(refs.map(row => `select '${row.table_name}.${row.column_name}' reference,
      count(*)::int sessions from public.orders o where o.order_source='public_qr'
      and o.dining_session_status='open' and o.table_released_at is null
      and not exists(select 1 from public.order_items i where i.order_id=o.id)
      and not exists(select 1 from public.order_invoices i where i.order_id=o.id)
      and exists(select 1 from public.${quote(row.table_name)} r where r.${quote(row.column_name)}::text=o.id::text)`)
    .join(' union all '));
  console.log('EMPTY SESSION HISTORY COUNTS',JSON.stringify(history.rows.filter(row=>row.sessions>0)));
  console.log('REFERENCE EXCLUSIONS',JSON.stringify(refs));
  console.log('CAUTION candidates are not proven phantom provenance; no cleanup authorized or executed');
}
async function main() {
  const db = client();
  await db.connect();
  try {
    const readOnly = process.argv.includes('--inspect') || process.argv.includes('--candidates') || process.argv.includes('--deployment-preflight') || process.argv.includes('--effective');
    await db.query(readOnly ? 'begin read only' : 'begin');
    await db.query("set local statement_timeout='15s'");
    await db.query("set local lock_timeout='10s'");
    if (process.argv.includes('--inspect')) { await metadata(db); return; }
    if (process.argv.includes('--candidates')) { await candidates(db); return; }
    if (process.argv.includes('--post-deploy-concurrency')) {
      check('concurrency validation requires deployed migration 261',(await db.query("select exists(select 1 from supabase_migrations.schema_migrations where version='261') deployed")).rows[0].deployed);
      await concurrentFixtures(db);
      return;
    }
    if (process.argv.includes('--deployment-preflight')) {
      const head = await db.query('select version from supabase_migrations.schema_migrations order by version desc limit 1');
      const state = await db.query(`with historical as (select * from public.orders o where o.order_source='public_qr'
        and o.dining_session_status='open' and o.table_released_at is null
        and not exists(select 1 from public.order_items i where i.order_id=o.id)
        and not exists(select 1 from public.order_invoices i where i.order_id=o.id))
        select (select count(*)::int from historical) sessions,
          (select count(distinct restaurant_id)::int from historical) restaurants,
          (select md5(coalesce(jsonb_agg(to_jsonb(h) order by id)::text,'[]')) from historical h) orders_hash,
          (select md5(coalesce(jsonb_agg(to_jsonb(l) order by l.id)::text,'[]')) from public.shift_activity_logs l
            where l.order_id in(select id from historical)) activity_hash`);
      const localEnv = fs.readFileSync(path.join(root,'.env.local'),'utf8');
      const url = localEnv.split(/\r?\n/).find(line=>/^\s*VITE_SUPABASE_URL\s*=/.test(line));
      const apiProject = url?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
      const linkedProject = fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim();
      check('app API project matches linked migration project',apiProject===linkedProject);
      const connection = client().connectionParameters;
      check('audit DB connection targets linked project',connection.host.includes(linkedProject) || connection.user.includes(linkedProject));
      console.log('PREFLIGHT',JSON.stringify({project:linkedProject,head:head.rows[0]?.version,
        migration_sha256:require('crypto').createHash('sha256').update(migration).digest('hex'),historical:state.rows[0]}));
      return;
    }
    const signature = 'public.get_public_qr_order_session_p76_base(text,text,text,text)';
    const snapshot = async () => (await db.query(`select pg_get_functiondef($1::regprocedure) definition,
      proacl::text acl, oid::text oid from pg_proc where oid=$1::regprocedure`,[signature])).rows[0];
    const original = await snapshot();
    const postDeploy = process.argv.includes('--post-deploy') || process.argv.includes('--effective');
    if (!postDeploy) await db.query(migration);
    const once = await snapshot();
    if (!postDeploy) await db.query(migration);
    const twice = await snapshot();
    if (!postDeploy) check('migration idempotent and preserves helper OID/ACL',once.definition===twice.definition && once.oid===original.oid && once.acl===original.acl);
    else {
      check('deployed lookup has no occupancy writes/release/refresh',! /\b(insert|update|delete)\b|auto_release|expire_stale|pg_advisory/i.test(original.definition.replace(/--[^\n]*/g,'')));
      const attributes = (await db.query('select prosecdef,proconfig,prosrc from pg_proc where oid=$1::regprocedure',[signature])).rows[0];
      check('deployed body exactly matches validated migration',attributes.prosrc.replace(/\r\n/g,'\n')===migration.match(/as \$\$([\s\S]*?)\$\$/i)[1].replace(/\r\n/g,'\n'));
      check('deployed helper retains security-definer and search_path',attributes.prosecdef && attributes.proconfig.includes('search_path=public'));
      const overloads = (await db.query(`select pg_get_function_identity_arguments(oid) args,pg_get_functiondef(oid) body
        from pg_proc where pronamespace='public'::regnamespace and proname='get_public_qr_order_session'`)).rows;
      check('only expected public lookup overloads with guarded delegation',overloads.length===2 && overloads.every(row=>
        row.args.includes('browser_session_token') ? row.body.includes('public.get_public_qr_order_session_p76_base(')
          : row.body.includes('public.get_public_qr_order_session(target_restaurant_slug, table_number, qr_token, null::text)')));
      const grants = (await db.query(`select
        has_function_privilege('anon','public.get_public_qr_order_session(text,text,text)','execute') anon_three,
        has_function_privilege('anon','public.get_public_qr_order_session(text,text,text,text)','execute') anon_four,
        has_function_privilege('authenticated','public.get_public_qr_order_session(text,text,text,text)','execute') staff_lookup,
        has_function_privilege('anon','public.get_public_qr_menu_phase260_base(text)','execute') hidden_menu,
        has_function_privilege('anon','public.sync_restaurant_tables_internal(uuid)','execute') internal_sync,
        has_function_privilege('anon','public.get_owner_table_qr_stats(uuid)','execute') owner_stats`)).rows[0];
      check('effective public and protected grants remain correct',grants.anon_three && grants.anon_four && grants.staff_lookup && !grants.hidden_menu && !grants.internal_sync && !grants.owner_stats);
      if (process.argv.includes('--effective')) return;
    }
    const f = await fixtures(db);
    await validate(db,f);
    await db.query('rollback');
    const restored = await snapshot();
    check('hosted definition and ACL restored after rollback',restored.definition===original.definition && restored.acl===original.acl);
    check('fixture restaurants removed after rollback',(await db.query('select count(*)::int n from public.restaurants where id=any($1::uuid[])',[[f.restaurant,f.other]])).rows[0].n===0);
    check('fixture auth users removed after rollback',(await db.query('select count(*)::int n from auth.users where id=any($1::uuid[])',[[f.owner,f.waiter,f.cashier]])).rows[0].n===0);
  } finally { await db.query('rollback'); await db.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

// Applies migration 263 and every fixture exclusively inside BEGIN / ROLLBACK.
// No deployment mode, commits, trigger bypasses, or real business-row writes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID: id } = require('node:crypto');
const { Client } = require('pg');
const root = path.resolve(__dirname, '../..');
const migrationFile = fs.readFileSync(path.join(root, 'supabase/migrations/263_order_time_inventory_deduction_basis.sql'), 'utf8');
assert.match(migrationFile, /\nBEGIN;\n/);
assert.match(migrationFile, /\nCOMMIT;\s*$/);
const migration = migrationFile.replace(/\nBEGIN;\n/, '\n').replace(/\nCOMMIT;\s*$/, '\n');
const changedFunctions = ['build_inventory_deduction_plan', 'deduct_inventory_for_order_item',
  'inventory_food_consumption_audit_row', 'inventory_movement_validate_row', 'split_waiter_bill_quantities'];
const results = [];
function check(label, condition) { assert.ok(condition, label); results.push(label); console.log('PASS', label); }
function client() {
  const line = fs.readFileSync(path.join(root, 'supabase/connection.env'), 'utf8').split(/\r?\n/)
    .find(value => /^\s*SUPABASE_DB_URL\s*=/.test(value));
  if (!line) throw new Error('Database connection configuration missing');
  return new Client({ connectionString: line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, '').trim().replace(/^['"]|['"]$/g, ''),
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30000,
    keepAlive: true, keepAliveInitialDelayMillis: 10000 });
}
async function main() {
  const db = client();
  db.on('error', error => { console.error('Database connection interrupted:', error.message); });
  const f = Object.fromEntries(['restaurant', 'other', 'owner', 'waiter', 'cashier', 'outsider',
    'manager', 'kitchen', 'managerStaff', 'kitchenStaff',
    'ownerStaff', 'waiterStaff', 'cashierStaff', 'otherStaff', 'category', 'station', 'unit', 'grams',
    'inventoryCategory', 'storage', 'itemA', 'itemB', 'foreignItem', 'foreignUnit', 'foreignStorage',
    'foreignCategory', 'menu', 'emptyMenu'].map(key => [key, id()]));
  f.slug = `basis-validation-${f.restaurant}`;
  let tableNumber = 1;
  const qrBrowsers = new Map();
  async function actor(user, sql, args = [], role = 'authenticated') {
    assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
    await db.query(`savepoint actor_call; set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)", [user || '', role]);
    try { const result = await db.query(sql, args); await db.query('reset role; release savepoint actor_call'); return result; }
    catch (error) { await db.query('rollback to savepoint actor_call; release savepoint actor_call'); throw error; }
  }
  async function reject(label, action, pattern) {
    await db.query('savepoint expected_failure');
    let failure;
    try { await action(); } catch (error) { failure = error; }
    await db.query('rollback to savepoint expected_failure; release savepoint expected_failure');
    check(label, failure && (!pattern || pattern.test(failure.message)));
  }
  async function snapshot() {
    return (await db.query(`select proname,pg_get_functiondef(oid) definition,proacl::text acl
      from pg_proc where pronamespace='public'::regnamespace and proname=any($1::text[]) order by proname`, [changedFunctions])).rows;
  }
  async function plan(item) { return (await db.query('select public.build_inventory_deduction_plan($1) plan', [item])).rows[0].plan; }
  async function basis(item) { return (await db.query('select * from public.order_item_inventory_basis where order_item_id=$1', [item])).rows[0]; }
  async function stock(item) { return Number((await actor(f.owner, 'select public.get_inventory_storage_balance($1,$2,$3) value',
    [f.restaurant, item, f.storage])).rows[0].value); }
  async function create(pathName = 'Cashier', quantity = 2, menu = f.menu, table = String(++tableNumber)) {
    const requested = JSON.stringify([{ menu_item_id: menu, quantity, tracking_mode: 'recipe',
      deduction_plan: [{ required_quantity: 999999 }] }]);
    let payload;
    let requestId;
    if (pathName === 'QR') {
      const token = (await db.query('select qr_token from public.restaurant_tables where restaurant_id=$1 and table_number=$2', [f.restaurant, Number(table)])).rows[0].qr_token;
      if (!qrBrowsers.has(table)) qrBrowsers.set(table, id());
      payload = (await actor(null, 'select public.create_public_qr_order($1,$2,$3,$4,$5,$6,$7::jsonb) payload',
        [f.slug, table, token, qrBrowsers.get(table), 'Rollback QR fixture', 'Cash', requested], 'anon')).rows[0].payload;
    } else if (pathName === 'WaiterBatch') {
      requestId = id();
      payload = (await actor(f.waiter, 'select public.submit_waiter_order_batch($1,$2,$3,$4,$5,$6::jsonb,$7) payload',
        [f.slug, table, 'Rollback waiter fixture', '', '', requested, requestId])).rows[0].payload;
    } else if (pathName === 'Waiter') {
      payload = (await actor(f.waiter, 'select public.create_waiter_order($1,$2,$3,$4,$5,$6::jsonb) payload',
        [f.slug, table, 'Rollback waiter fixture', null, null, requested])).rows[0].payload;
    } else {
      payload = (await actor(f.cashier, 'select public.create_cashier_order($1,$2,$3,$4::jsonb) payload',
        [f.restaurant, table, 'Cash', requested])).rows[0].payload;
    }
    const items = (await db.query('select id from public.order_items where order_id=$1 and restaurant_id=$2 order by created_at,id',
      [payload.order_id, f.restaurant])).rows.map(row => row.id);
    return { ...payload, item: items[items.length - 1], table, requestId };
  }
  async function setMode(recipe = null, direct = null) {
    await actor(f.owner, 'update public.menu_items set recipe_id=$1,direct_inventory_item_id=$2 where id=$3 and restaurant_id=$4',
      [recipe, direct, f.menu, f.restaurant]);
  }
  async function complete(order) {
    await actor(f.cashier, 'select public.verify_dining_session_payment($1,$2,null,null,null,false)', [order.order_id, 'Cash']);
    // Keep a separate, genuine unpaid appended batch open. Canonical fully
    // settled completion auto-releases a session; the existing deduction
    // eligibility helper declines closed sessions. Never bypass that lifecycle.
    // Use intentional No Tracking for this sentinel batch, restore Menu afterward.
    const config = (await db.query('select recipe_id,direct_inventory_item_id from public.menu_items where id=$1', [f.menu])).rows[0];
    await setMode();
    await actor(f.cashier, 'select public.append_items_to_order($1,$2::jsonb)', [order.order_id, JSON.stringify([{ menu_item_id: f.menu, quantity: 1 }])]);
    await setMode(config.recipe_id, config.direct_inventory_item_id);
    await actor(f.owner, 'select public.start_order_preparation($1,$2,$3)', [order.order_id, f.station, 'initial']);
    await actor(f.owner, 'select public.mark_order_ready($1,$2,$3)', [order.order_id, f.station, 'initial']);
    await actor(f.owner, 'select public.mark_order_completed($1,$2,$3)', [order.order_id, f.station, 'initial']);
  }
  async function deduct(item) { return (await actor(f.owner, 'select public.deduct_inventory_for_order_item($1) value', [item])).rows[0].value; }
  async function receiptCounts(order) {
    return (await db.query(`select
      (select count(*)::int from public.inventory_order_item_deductions where order_id=$1) receipts,
      (select count(*)::int from public.inventory_movements where source_system='automatic_order_item_deduction'
        and order_id=$1) movements`, [order.order_id])).rows[0];
  }
  await db.connect();
  const original = await snapshot();
  check('migration 263 is not deployed and basis tables do not exist',
    (await db.query("select to_regclass('public.order_item_inventory_basis') relation")).rows[0].relation === null);
  const historical = (await db.query(`select count(*)::int total,
    count(*) filter (where receipt.order_item_id is not null)::int completed_receipt,
    count(*) filter (where receipt.order_item_id is null)::int ambiguous_undeducted
    from public.order_items item left join public.inventory_order_item_deductions receipt on receipt.order_item_id=item.id`)).rows[0];
  console.log('HISTORICAL', JSON.stringify({ ...historical, proven_undeducted_basis: 0, proven_no_tracking: 0 }));
  try {
    await db.query('begin');
    await db.query("set local statement_timeout='30s'; set local lock_timeout='10s'");
    for (const user of [f.owner, f.waiter, f.cashier, f.outsider, f.manager, f.kitchen]) {
      await db.query(`insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
        values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now(),now())`,
      [user, `basis-${user}@example.test`]);
    }
    await db.query(`insert into public.restaurants(id,name,slug,total_tables,table_count,profile)
      values($1,'Basis rollback fixture',$2,60,60,'{}'),($3,'Basis other rollback fixture',$4,1,1,'{}')`,
    [f.restaurant, f.slug, f.other, `basis-other-${f.other}`]);
    for (const [staff, user, role, tenant] of [[f.ownerStaff, f.owner, 'owner', f.restaurant],
      [f.waiterStaff, f.waiter, 'waiter', f.restaurant], [f.cashierStaff, f.cashier, 'cashier', f.restaurant],
      [f.managerStaff, f.manager, 'manager', f.restaurant], [f.kitchenStaff, f.kitchen, 'kitchen', f.restaurant],
      [f.otherStaff, f.outsider, 'owner', f.other]]) {
      await db.query(`insert into public.restaurant_staff(id,restaurant_id,user_id,role,display_name,email,active)
        values($1,$2,$3,$4,'Basis fixture staff',$5,true)`, [staff, tenant, user, role, `basis-${user}@example.test`]);
    }
    await db.query("insert into public.categories(id,restaurant_id,name) values($1,$2,'Basis fixture category')", [f.category, f.restaurant]);
    await db.query("insert into public.kitchen_stations(id,restaurant_id,name,active,is_default) values($1,$2,'Basis fixture kitchen',true,true)", [f.station, f.restaurant]);
    for (const [tenant, staff, category, unit, storage] of [[f.restaurant, f.ownerStaff, f.inventoryCategory, f.unit, f.storage],
      [f.other, f.otherStaff, f.foreignCategory, f.foreignUnit, f.foreignStorage]]) {
      await db.query("insert into public.inventory_categories(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'Basis category','active',$3,$3)", [category, tenant, staff]);
      await db.query("insert into public.inventory_units(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'kg','active',$3,$3)", [unit, tenant, staff]);
      await db.query("insert into public.inventory_storage_locations(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'Basis store','active',$3,$3)", [storage, tenant, staff]);
    }
    await db.query("insert into public.inventory_units(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'g','active',$3,$3)", [f.grams, f.restaurant, f.ownerStaff]);
    for (const [item, name, tenant, staff, category, unit, storage] of [
      [f.itemA, 'Basis ingredient A', f.restaurant, f.ownerStaff, f.inventoryCategory, f.unit, f.storage],
      [f.itemB, 'Basis ingredient B', f.restaurant, f.ownerStaff, f.inventoryCategory, f.unit, f.storage],
      [f.foreignItem, 'Basis foreign ingredient', f.other, f.otherStaff, f.foreignCategory, f.foreignUnit, f.foreignStorage]]) {
      await db.query(`insert into public.inventory_items(id,restaurant_id,name,unit,current_quantity,reorder_level,active,category_id,unit_id,storage_location_id,status,created_by_staff_id,updated_by_staff_id)
        values($1,$2,$3,'kg',0,0,true,$4,$5,$6,'active',$7,$7)`, [item, tenant, name, category, unit, storage, staff]);
    }
    await actor(f.owner, 'select public.record_inventory_opening_balance($1,$2,$3,100,null,null,now())', [f.restaurant, f.itemA, f.storage]);
    await actor(f.owner, 'select public.record_inventory_opening_balance($1,$2,$3,100,null,null,now())', [f.restaurant, f.itemB, f.storage]);
    await actor(f.owner, `insert into public.menu_items(id,restaurant_id,category_id,kitchen_station_id,name,price,available)
      values($1,$2,$3,$4,'Basis fixture sale',10,true)`, [f.menu, f.restaurant, f.category, f.station]);
    await actor(f.cashier, 'select * from public.open_cashier_shift($1,0,$2)', [f.restaurant, 'Rollback basis validation']);
    const legacy = await create();
    await setMode(null, f.itemA);
    const legacyReceiptOrder = await create('Cashier', 1);
    await complete(legacyReceiptOrder);
    check('pre-migration canonical deduction writes a genuine immutable receipt', (await deduct(legacyReceiptOrder.item)).deducted);
    const originalReceipt = (await db.query('select * from public.inventory_order_item_deductions where order_item_id=$1', [legacyReceiptOrder.item])).rows[0];
    const originalMovements = (await db.query('select * from public.inventory_movements where order_item_id=$1 order by id', [legacyReceiptOrder.item])).rows;
    await setMode();
    await db.query(migration);
    check('migration SQL applies transactionally', true);
    check('pre-migration undeducted fixture is legacy_review, not guessed No Tracking', (await basis(legacy.item)).tracking_mode === 'legacy_review');
    await reject('ambiguous historical planner fails closed without current-source backfill', () => plan(legacy.item), /ambiguous.*review/);
    check('already-deducted historical fixture is classified from its real receipt', (await basis(legacyReceiptOrder.item)).tracking_mode === 'legacy_receipt');
    check('already-deducted historical retry remains exactly once', (await deduct(legacyReceiptOrder.item)).status === 'already_deducted');
    check('migration and retry leave prior receipt and movements byte-equivalent', JSON.stringify((await db.query('select * from public.inventory_order_item_deductions where order_item_id=$1', [legacyReceiptOrder.item])).rows[0]) === JSON.stringify(originalReceipt)
      && JSON.stringify((await db.query('select * from public.inventory_movements where order_item_id=$1 order by id', [legacyReceiptOrder.item])).rows) === JSON.stringify(originalMovements));
    const recipe = (await actor(f.owner, 'select public.manage_recipe($1,$2::jsonb) value', ['create', JSON.stringify({
      restaurant_id: f.restaurant, name: 'Basis fixture recipe', status: 'active', yield_quantity: 2, yield_unit: 'servings',
    })])).rows[0].value;
    const foreignRecipe = (await actor(f.outsider, 'select public.manage_recipe($1,$2::jsonb) value', ['create', JSON.stringify({
      restaurant_id: f.other, name: 'Foreign basis recipe', status: 'active', yield_quantity: 1, yield_unit: 'serving',
    })])).rows[0].value;
    async function ingredient(item, quantity, unit = f.unit) {
      return (await actor(f.owner, 'select public.manage_recipe_ingredient($1,$2::jsonb) value', ['create', JSON.stringify({
        restaurant_id: f.restaurant, recipe_id: recipe.id, inventory_item_id: item, quantity_required: quantity, unit_id: unit, sort_order: 100,
      })])).rows[0].value;
    }
    const a = await ingredient(f.itemA, 500, f.grams);
    const b = await ingredient(f.itemB, 1);
    await setMode(recipe.id);
    const oldRecipe = await create();
    const originalPlan = await plan(oldRecipe.item);
    check('recipe basis captures converted quantities and original yield', originalPlan.find(x => x.inventory_item_id === f.itemA).required_quantity === 0.5
      && originalPlan.find(x => x.inventory_item_id === f.itemB).required_quantity === 1);
    await actor(f.owner, 'select public.manage_recipe_ingredient($1,$2::jsonb)', ['update', JSON.stringify({
      restaurant_id: f.restaurant, recipe_id: recipe.id, ingredient_id: a.id, inventory_item_id: f.itemA, quantity_required: 3, unit_id: f.unit, sort_order: 100,
    })]);
    await actor(f.owner, 'select public.manage_recipe($1,$2::jsonb)', ['update', JSON.stringify({
      restaurant_id: f.restaurant, recipe_id: recipe.id, name: recipe.name, status: 'active', yield_quantity: 1, yield_unit: 'servings',
    })]);
    check('old recipe basis survives ingredient quantity/unit and yield edits', JSON.stringify(await plan(oldRecipe.item)) === JSON.stringify(originalPlan));
    const newer = await create();
    check('new order uses updated recipe quantities/yield', (await plan(newer.item)).find(x => x.inventory_item_id === f.itemA).required_quantity === 6);
    await actor(f.owner, 'select public.manage_recipe_ingredient($1,$2::jsonb)', ['delete', JSON.stringify({ restaurant_id: f.restaurant, recipe_id: recipe.id, ingredient_id: b.id })]);
    check('old recipe basis survives ingredient removal', (await plan(oldRecipe.item)).length === 2);
    const withoutB = await create();
    check('new recipe basis omits removed ingredient', (await plan(withoutB.item)).length === 1);
    await setMode();
    check('Recipe to No Tracking does not change old recipe basis', JSON.stringify(await plan(oldRecipe.item)) === JSON.stringify(originalPlan));
    const none = await create();
    check('new No Tracking is explicit and empty', (await basis(none.item)).tracking_mode === 'no_tracking' && (await plan(none.item)).length === 0);
    await setMode(recipe.id);
    check('No Tracking to Recipe does not change historical No Tracking', (await plan(none.item)).length === 0);
    check('future order after No Tracking to Recipe uses recipe', (await basis((await create()).item)).tracking_mode === 'recipe');
    await setMode(null, f.itemA);
    check('Recipe to Direct does not change old recipe basis', JSON.stringify(await plan(oldRecipe.item)) === JSON.stringify(originalPlan));
    const oldDirect = await create('Cashier', 3);
    check('direct basis captures one master-unit quantity per sold item', (await plan(oldDirect.item))[0].required_quantity === 3);
    await setMode(null, f.itemB);
    check('old direct source survives source switch', (await plan(oldDirect.item))[0].inventory_item_id === f.itemA);
    const newDirect = await create();
    check('new direct sale uses new source', (await plan(newDirect.item))[0].inventory_item_id === f.itemB);
    await setMode(recipe.id);
    check('Direct to Recipe preserves old direct basis', (await basis(oldDirect.item)).tracking_mode === 'direct');
    for (const pathName of ['QR', 'Waiter', 'WaiterBatch', 'Cashier']) {
      const order = await create(pathName);
      check(`${pathName} canonical creation captures server basis and ignores forged payload plan`,
        (await basis(order.item)).tracking_mode === 'recipe' && (await plan(order.item))[0].required_quantity === 6);
      if (pathName === 'WaiterBatch') {
        const retry = (await actor(f.waiter, 'select public.submit_waiter_order_batch($1,$2,$3,$4,$5,$6::jsonb,$7) payload',
          [f.slug, order.table, 'Rollback waiter fixture', '', '', JSON.stringify([{ menu_item_id: f.menu, quantity: 2 }]), order.requestId])).rows[0].payload;
        check('Waiter canonical batch request retry does not duplicate basis', retry.order_id === order.order_id
          && (await db.query('select count(*)::int n from public.order_items where order_id=$1', [order.order_id])).rows[0].n === 1);
      }
      if (pathName === 'QR' || pathName === 'Waiter' || pathName === 'WaiterBatch') {
        const before = Number((await db.query('select count(*) n from public.order_items where order_id=$1', [order.order_id])).rows[0].n);
        await create(pathName, 1, f.menu, order.table);
        const appended = (await db.query('select id from public.order_items where order_id=$1 and appended_at is not null', [order.order_id])).rows;
        check(`${pathName} append path captures basis`, appended.length === 1 && (await basis(appended[0].id)).tracking_mode === 'recipe' && before === 1);
      }
    }
    const appendOrder = await create();
    await actor(f.cashier, 'select public.append_items_to_order($1,$2::jsonb)', [appendOrder.order_id, JSON.stringify([{ menu_item_id: f.menu, quantity: 1 }])]);
    const appended = (await db.query('select id from public.order_items where order_id=$1 and appended_at is not null', [appendOrder.order_id])).rows[0];
    check('Cashier append captures the same immutable semantics', (await basis(appended.id)).tracking_mode === 'recipe');
    const splitOrder = await create('WaiterBatch', 3);
    const splitOriginal = await plan(splitOrder.item);
    await setMode();
    await actor(f.waiter, 'select public.split_waiter_bill_quantities($1,$2::jsonb)',
      [splitOrder.order_id, JSON.stringify([{ item_id: splitOrder.item, quantity: 1 }])]);
    const splitChild = (await db.query('select order_item_id from public.order_item_inventory_basis where split_parent_order_item_id=$1', [splitOrder.item])).rows[0].order_item_id;
    const parentRemaining = await plan(splitOrder.item), childPlan = await plan(splitChild);
    check('canonical quantity split inherits frozen recipe despite current No Tracking', (await basis(splitChild)).tracking_mode === 'recipe');
    check('bill split conserves exact original ledger quantities', parentRemaining[0].required_quantity + childPlan[0].required_quantity === splitOriginal[0].required_quantity);
    check('bill split leaves original stored snapshot unchanged', JSON.stringify((await basis(splitOrder.item)).deduction_plan) === JSON.stringify(splitOriginal));
    await setMode(recipe.id);
    const mergeSource = await create('WaiterBatch'), mergeDestination = await create('WaiterBatch');
    const beforeMerge = await plan(mergeSource.item);
    await actor(f.waiter, 'select * from public.merge_waiter_dining_sessions($1,$2)', [mergeSource.order_id, mergeDestination.order_id]);
    check('canonical dining-session merge preserves frozen item basis', JSON.stringify(await plan(mergeSource.item)) === JSON.stringify(beforeMerge)
      && (await db.query('select order_id from public.order_items where id=$1', [mergeSource.item])).rows[0].order_id === mergeDestination.order_id);
    await actor(f.owner, 'select public.manage_recipe($1,$2::jsonb)', ['archive', JSON.stringify({ restaurant_id: f.restaurant, recipe_id: recipe.id })]);
    check('recipe archival does not invalidate old plan', JSON.stringify(await plan(oldRecipe.item)) === JSON.stringify(originalPlan));
    await setMode();
    await actor(f.owner, "update public.inventory_items set active=false,status='archived' where id=$1 and restaurant_id=$2", [f.itemA, f.restaurant]);
    check('direct source archival/deactivation does not change frozen basis', (await plan(oldDirect.item))[0].inventory_item_id === f.itemA);
    await reject('manual operation retains inactive-source rejection', () => actor(f.owner,
      "select public.record_inventory_movement_v2($1,$2,$3,$4,'stock_out',1,null,null,null,null,'Manual inactive source probe',null,null)",
      [f.restaurant, id(), f.itemA, f.storage]), /inventory item.*invalid|active/i);
    await reject('forged automatic source_system does not bypass inactive-source validation', () => actor(f.owner,
      `insert into public.inventory_movements(restaurant_id,inventory_item_id,storage_location_id,unit_id,unit_name,
        movement_type,quantity,quantity_effect,reason,source_system,source_record_id,created_by_staff_id)
        values($1,$2,$3,$4,'kg','stock_out',1,'out','Forged automatic probe','automatic_order_item_deduction',$5,$6)`,
      [f.restaurant, f.itemA, f.storage, f.unit, oldDirect.item, f.ownerStaff]), /permission denied|orphaned|match|invalid|frozen/i);
    await complete(oldRecipe);
    const beforeA = await stock(f.itemA), beforeB = await stock(f.itemB);
    check('first recipe deduction succeeds after recipe/source archival and link removal', (await deduct(oldRecipe.item)).deducted);
    check('deduction uses original quantities, not edited recipe', await stock(f.itemA) === beforeA - 0.5 && await stock(f.itemB) === beforeB - 1);
    check('retry returns already_deducted', (await deduct(oldRecipe.item)).status === 'already_deducted');
    await actor(f.owner, 'select public.deduct_inventory_for_service_completion($1,null,null)', [oldRecipe.order_id]);
    check('duplicate completion adapter creates no duplicate receipt/movements', JSON.stringify(await receiptCounts(oldRecipe)) === JSON.stringify({ receipts: 1, movements: 2 }));
    await db.query('savepoint repeated_lifecycle');
    try { await actor(f.owner, 'select public.mark_order_completed($1,$2,$3)', [oldRecipe.order_id, f.station, 'initial']); }
    catch (error) { await db.query('rollback to savepoint repeated_lifecycle'); }
    check('repeated lifecycle completion attempt cannot duplicate existing inventory history', (await receiptCounts(oldRecipe)).receipts === 1 && (await receiptCounts(oldRecipe)).movements === 2);
    await complete(oldDirect);
    check('old direct sale completes using disabled original source', (await deduct(oldDirect.item)).deducted && (await receiptCounts(oldDirect)).movements === 1);
    const directMovement = (await db.query('select recipe_id from public.inventory_movements where order_item_id=$1', [oldDirect.item])).rows[0];
    check('direct ledger provenance does not inherit a later Menu recipe', directMovement.recipe_id === null);
    const beforeSplitStock = await stock(f.itemA);
    await complete(splitOrder);
    check('split parent and child both deduct their allocated frozen quantities', (await deduct(splitOrder.item)).deducted && (await deduct(splitChild)).deducted);
    check('actual split stock consumption equals original frozen total', await stock(f.itemA) === beforeSplitStock - splitOriginal[0].required_quantity
      && (await receiptCounts(splitOrder)).receipts === 2 && (await receiptCounts(splitOrder)).movements === 2);
    await complete(mergeDestination);
    check('merged historical items deduct in their current dining session', (await deduct(mergeSource.item)).deducted && (await deduct(mergeDestination.item)).deducted
      && (await db.query('select order_id from public.inventory_order_item_deductions where order_item_id=$1', [mergeSource.item])).rows[0].order_id === mergeDestination.order_id);
    await complete(none);
    check('explicit No Tracking returns no_tracking and creates no inventory history', (await deduct(none.item)).status === 'no_tracking'
      && (await receiptCounts(none)).receipts === 0 && (await receiptCounts(none)).movements === 0);
    // Exhaust one ingredient through a canonical manual movement, then prove
    // the whole two-line old recipe attempt fails and can be retried safely.
    const failed = await create('Cashier', 1); // Menu remains intentional No Tracking.
    await actor(f.owner, "update public.inventory_items set active=true,status='active' where id=$1", [f.itemA]);
    await actor(f.owner, 'select public.manage_recipe($1,$2::jsonb)', ['restore', JSON.stringify({ restaurant_id: f.restaurant, recipe_id: recipe.id })]);
    await actor(f.owner, 'select public.manage_recipe($1,$2::jsonb)', ['update', JSON.stringify({
      restaurant_id: f.restaurant, recipe_id: recipe.id, name: recipe.name, status: 'active', yield_quantity: 1, yield_unit: 'servings',
    })]);
    await ingredient(f.itemB, 1);
    await setMode(recipe.id);
    const insufficient = await create();
    await complete(insufficient);
    const balanceB = await stock(f.itemB);
    await actor(f.owner, "select public.record_inventory_movement_v2($1,$2,$3,$4,'stock_out',$5,null,null,null,null,'Rollback test exhaust ingredient',null,null)",
      [f.restaurant, id(), f.itemB, f.storage, balanceB]);
    const unchangedA = await stock(f.itemA);
    await reject('insufficient stock rejects entire multi-line deduction', () => deduct(insufficient.item), /negative stock/);
    check('failed deduction leaves zero receipts/movements and first ingredient unchanged', (await stock(f.itemA)) === unchangedA
      && (await receiptCounts(insufficient)).receipts === 0 && (await receiptCounts(insufficient)).movements === 0);
    await actor(f.owner, "select public.record_inventory_movement_v2($1,$2,$3,$4,'stock_in',10,null,null,null,null,'Rollback retry replenishment',null,null)",
      [f.restaurant, id(), f.itemB, f.storage]);
    check('retry after replenishment succeeds once', (await deduct(insufficient.item)).deducted && (await deduct(insufficient.item)).status === 'already_deducted');
    check('retry after failure has one receipt and exactly two movements', (await receiptCounts(insufficient)).receipts === 1 && (await receiptCounts(insufficient)).movements === 2);
    await actor(f.owner, 'select public.set_restaurant_payment_policy($1,$2)', [f.restaurant, 'kitchen_before_payment']);
    const heldServed = await create('WaiterBatch', 3);
    await actor(f.owner, 'select public.start_order_preparation($1,$2,$3)', [heldServed.order_id, f.station, 'initial']);
    await actor(f.owner, 'select public.mark_order_ready($1,$2,$3)', [heldServed.order_id, f.station, 'initial']);
    await actor(f.owner, 'select public.mark_order_completed($1,$2,$3)', [heldServed.order_id, f.station, 'initial']);
    check('canonical after-meal served batch deducts before settlement', (await deduct(heldServed.item)).deducted);
    const accountedReceipt = (await db.query('select * from public.inventory_order_item_deductions where order_item_id=$1', [heldServed.item])).rows[0];
    const accountedMovements = (await db.query('select * from public.inventory_movements where order_item_id=$1 order by id', [heldServed.item])).rows;
    await setMode();
    await actor(f.waiter, 'select public.split_waiter_bill_quantities($1,$2::jsonb)',
      [heldServed.order_id, JSON.stringify([{ item_id: heldServed.item, quantity: 1 }])]);
    const accountedChild = (await db.query('select order_item_id from public.order_item_inventory_basis where split_parent_order_item_id=$1', [heldServed.item])).rows[0].order_item_id;
    check('billing derivative of consumed food is already_deducted_inherited', (await deduct(accountedChild)).status === 'already_deducted_inherited');
    check('post-deduction bill split creates no duplicate history or receipt mutation',
      (await db.query('select count(*)::int n from public.inventory_order_item_deductions where order_item_id=$1', [accountedChild])).rows[0].n === 0
      && (await db.query('select count(*)::int n from public.inventory_movements where order_item_id=$1', [accountedChild])).rows[0].n === 0
      && JSON.stringify((await db.query('select * from public.inventory_order_item_deductions where order_item_id=$1', [heldServed.item])).rows[0]) === JSON.stringify(accountedReceipt)
      && JSON.stringify((await db.query('select * from public.inventory_movements where order_item_id=$1 order by id', [heldServed.item])).rows) === JSON.stringify(accountedMovements));
    await actor(f.owner, 'select public.set_restaurant_payment_policy($1,$2)', [f.restaurant, 'pay_before_kitchen']);
    const emptyRecipe = (await actor(f.owner, 'select public.manage_recipe($1,$2::jsonb) value', ['create', JSON.stringify({
      restaurant_id: f.restaurant, name: 'Invalid empty fixture recipe', status: 'active', yield_quantity: 1, yield_unit: 'serving',
    })])).rows[0].value;
    await setMode(emptyRecipe.id);
    const countBefore = (await db.query(`select (select count(*) from public.orders where restaurant_id=$1)::int orders,
      (select count(*) from public.order_item_inventory_basis where restaurant_id=$1)::int bases,
      (select count(*) from public.order_item_inventory_basis_lines where restaurant_id=$1)::int lines`, [f.restaurant])).rows[0];
    await reject('invalid recipe snapshot rejects canonical order creation', () => create(), /no ingredients/);
    await reject('invalid append snapshot rolls back with its canonical append', () => actor(f.cashier, 'select public.append_items_to_order($1,$2::jsonb)',
      [appendOrder.order_id, JSON.stringify([{ menu_item_id: f.menu, quantity: 1 }])]), /no ingredients/);
    const countAfter = (await db.query(`select (select count(*) from public.orders where restaurant_id=$1)::int orders,
      (select count(*) from public.order_item_inventory_basis where restaurant_id=$1)::int bases,
      (select count(*) from public.order_item_inventory_basis_lines where restaurant_id=$1)::int lines`, [f.restaurant])).rows[0];
    check('failed creation leaves no order/basis/line residue', JSON.stringify(countBefore) === JSON.stringify(countAfter));
    await reject('cross-tenant recipe link rejected', () => setMode(foreignRecipe.id), /recipe|foreign key/i);
    await reject('cross-tenant direct inventory link rejected', () => setMode(null, f.foreignItem), /inventory|foreign key/i);
    await reject('cross-tenant ingredient link rejected', () => ingredient(f.foreignItem, 1), /inventory|restaurant|tenant/i);
    await reject('forged cross-tenant snapshot inventory relation rejected by FK', () => db.query(`insert into public.order_item_inventory_basis_lines
      (restaurant_id,order_item_id,inventory_item_id,storage_location_id,unit_id,required_quantity) values($1,$2,$3,$4,$5,1)`,
    [f.restaurant, failed.item, f.foreignItem, f.storage, f.unit]), /foreign key/i);
    for (const [user, role, label] of [[f.owner, 'authenticated', 'Owner'], [f.manager, 'authenticated', 'Manager'],
      [f.kitchen, 'authenticated', 'Kitchen'], [f.cashier, 'authenticated', 'Cashier'],
      [f.waiter, 'authenticated', 'Waiter'], [f.outsider, 'authenticated', 'Other tenant Owner'], [null, 'anon', 'Anonymous'], [null, 'service_role', 'Service role']]) {
      await reject(`${label} cannot forge basis`, () => actor(user, 'update public.order_item_inventory_basis set deduction_plan=$1 where order_item_id=$2', ['[]', oldRecipe.item], role), /permission denied/i);
    }
    await reject('privileged accidental basis mutation rejected', () => db.query('update public.order_item_inventory_basis set deduction_plan=$1 where order_item_id=$2', ['[]', oldRecipe.item]), /immutable/i);
    await reject('privileged basis-line mutation rejected', () => db.query('delete from public.order_item_inventory_basis_lines where order_item_id=$1', [oldRecipe.item]), /immutable/i);
    await reject('Owner cannot author snapshot lines directly', () => actor(f.owner, `insert into public.order_item_inventory_basis_lines
      (restaurant_id,order_item_id,inventory_item_id,storage_location_id,unit_id,required_quantity) values($1,$2,$3,$4,$5,1)`,
      [f.restaurant, none.item, f.itemA, f.storage, f.unit]), /permission denied/i);
    await reject('Owner cannot forge stored tracking mode', () => actor(f.owner, "update public.order_item_inventory_basis set tracking_mode='recipe' where order_item_id=$1", [none.item]), /permission denied/i);
    await reject('order quantity cannot invalidate frozen basis', () => db.query('update public.order_items set quantity=99 where id=$1', [oldRecipe.item]), /authorized.*split/i);
    await reject('unauthorized tenant cannot deduct another tenant order', () => actor(f.outsider, 'select public.deduct_inventory_for_order_item($1)', [oldRecipe.item]), /access denied/i);
    await reject('Waiter cannot perform inventory deduction', () => actor(f.waiter, 'select public.deduct_inventory_for_order_item($1)', [oldRecipe.item]), /access denied/i);
    await reject('Kitchen cannot directly perform inventory deduction', () => actor(f.kitchen, 'select public.deduct_inventory_for_order_item($1)', [oldRecipe.item]), /access denied/i);
    check('Manager retains canonical same-tenant deduction authority without snapshot-writing authority',
      (await actor(f.manager, 'select public.deduct_inventory_for_order_item($1) value', [oldRecipe.item])).rows[0].value.status === 'already_deducted');
    await reject('private split helper cannot be invoked by a client', () => actor(f.waiter, 'select public.prepare_split_inventory_basis($1,$2,1)', [oldRecipe.item, id()]), /permission denied/i);
    const privateNames = ['build_inventory_deduction_plan', 'build_order_time_inventory_plan', 'capture_order_item_inventory_basis',
      'prepare_split_inventory_basis', 'reject_inventory_basis_mutation', 'protect_order_item_inventory_identity'];
    const surface = (await db.query(`select proname,pg_get_function_identity_arguments(oid) signature,prosecdef,proconfig,
      has_function_privilege('anon',oid,'execute') anonymous,
      has_function_privilege('authenticated',oid,'execute') authenticated,
      exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) grant_row
        where grant_row.grantee=0 and grant_row.privilege_type='EXECUTE') public_execute
      from pg_proc where pronamespace='public'::regnamespace and proname=any($1::text[]) order by proname`,
    [[...privateNames, ...changedFunctions, 'deduct_inventory_for_service_completion']])).rows;
    check('no stale overload exists on the frozen-basis function surface', new Set(surface.map(row => row.proname)).size === surface.length);
    check('all private snapshot/capture/split functions deny PUBLIC, anonymous and authenticated execute',
      surface.filter(row => privateNames.includes(row.proname)).length === privateNames.length
      && surface.filter(row => privateNames.includes(row.proname)).every(row => !row.anonymous && !row.authenticated && !row.public_execute));
    check('snapshot builders/capture/split and canonical deduction/billing retain SECURITY DEFINER and fixed search_path',
      surface.filter(row => ['build_inventory_deduction_plan', 'build_order_time_inventory_plan', 'capture_order_item_inventory_basis',
        'prepare_split_inventory_basis', 'deduct_inventory_for_order_item', 'deduct_inventory_for_service_completion', 'split_waiter_bill_quantities'].includes(row.proname))
        .every(row => row.prosecdef && row.proconfig.includes('search_path=public')));
    console.log('FUNCTION SURFACE', JSON.stringify(surface));
    const indexes = (await db.query(`select indexname,indexdef from pg_indexes where schemaname='public'
      and indexname in ('inventory_order_item_deductions_pkey','inventory_movements_order_item_deduction_unique')`)).rows;
    check('both database exactly-once uniqueness guards remain intact', indexes.length === 2 && indexes.every(row => /UNIQUE INDEX/.test(row.indexdef)));
    await db.query('set constraints all immediate');
    check('deferred split/order relationships validate without orphan contexts', true);
    console.log('CONCURRENCY LIMITATION: same-fixture two-session completion cannot share uncommitted rollback-only fixtures; row locks and uniqueness verified, overlapping completions not claimed.');
    const privateStorage = (await db.query("select public from storage.buckets where id='menu-files'")).rows[0];
    check('262 menu-files privacy remains private', privateStorage.public === false);
    check('261 public session lookup remains side-effect free', !/\b(insert|update|delete)\b|auto_release|expire_stale/i.test(
      (await db.query("select prosrc from pg_proc where oid='public.get_public_qr_order_session_p76_base(text,text,text,text)'::regprocedure")).rows[0].prosrc.replace(/--[^\n]*/g, '')));
  } finally {
    await db.query('rollback');
    try {
      check('all changed function definitions and ACLs restored', JSON.stringify(await snapshot()) === JSON.stringify(original));
      check('basis schema and capture helper rolled back', (await db.query(`select
        to_regclass('public.order_item_inventory_basis') basis,to_regclass('public.order_item_inventory_basis_lines') lines,
        to_regprocedure('public.build_order_time_inventory_plan(uuid)') helper,
        to_regprocedure('public.prepare_split_inventory_basis(uuid,uuid,integer)') split_helper`)).rows.every(row => row.basis === null && row.lines === null && row.helper === null && row.split_helper === null));
      check('zero fixture tenant/user/order/menu/inventory/movement/receipt residue', (await db.query(`select
        (select count(*) from public.restaurants where id=any($1::uuid[])) tenants,
        (select count(*) from auth.users where id=any($2::uuid[])) users,
        (select count(*) from public.orders where restaurant_id=any($1::uuid[])) orders,
        (select count(*) from public.order_items where restaurant_id=any($1::uuid[])) order_items,
        (select count(*) from public.restaurant_staff where restaurant_id=any($1::uuid[])) staff,
        (select count(*) from public.menu_items where restaurant_id=any($1::uuid[])) menu,
        (select count(*) from public.recipes where restaurant_id=any($1::uuid[])) recipes,
        (select count(*) from public.recipe_ingredients where restaurant_id=any($1::uuid[])) ingredients,
        (select count(*) from public.inventory_items where restaurant_id=any($1::uuid[])) inventory,
        (select count(*) from public.inventory_movements where restaurant_id=any($1::uuid[])) movements,
        (select count(*) from public.inventory_order_item_deductions where restaurant_id=any($1::uuid[])) receipts`,
      [[f.restaurant, f.other], [f.owner, f.waiter, f.cashier, f.outsider, f.manager, f.kitchen]])).rows.every(row => Object.values(row).every(value => Number(value) === 0)));
    } finally { await db.end(); }
  }
  console.log(`RESULT ${results.length} checks passed; migration and fixtures rolled back`);
}
main().catch(error => { console.error('FAIL', error.message); process.exitCode = 1; });

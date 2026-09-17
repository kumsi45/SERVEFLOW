// Remaining Phase 3B candidate checks. Every DDL change and fixture is rolled back.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');

const root = path.resolve(__dirname, '../..');
const migration = fs.readFileSync(path.join(root, 'supabase/parked-migrations/owner_menu_item_creation_atomic_idempotent.PARKED.sql'), 'utf8');
const config = fs.readFileSync(path.join(root, 'supabase/connection.env'), 'utf8');
const url = config.match(/^\s*SUPABASE_DB_URL\s*=\s*(.+)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, '');
if (!url) throw new Error('SUPABASE_DB_URL missing');
const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 });
const check = (label, value) => { assert.ok(value, label); console.log(`PASS ${label}`); };
const call = (restaurant, request, payload) => db.query('select public.create_owner_menu_item_v1($1,$2,$3::jsonb) result', [restaurant, request, JSON.stringify(payload)]).then((r) => r.rows[0].result);
async function asUser(userId, action) {
  await db.query('savepoint actor');
  try {
    await db.query('set local role authenticated');
    await db.query("select set_config('request.jwt.claim.role','authenticated',true), set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [userId, JSON.stringify({ sub: userId, role: 'authenticated', iss: 'https://rollback-validation.supabase.co/auth/v1' })]);
    return await action();
  } catch (error) { await db.query('rollback to savepoint actor'); throw error; }
  finally { await db.query('reset role; release savepoint actor'); }
}
async function denied(label, action) { let error; try { await action(); } catch (caught) { error = caught; } check(label, Boolean(error)); }

(async () => {
  const f = Object.fromEntries(['restaurantA','restaurantB','ownerA','ownerB','staffA','staffB','categoryA','stationA','inventoryCategory','inventoryUnit','inventoryStorage','inventoryActive','inventoryInactive'].map((k) => [k, randomUUID()]));
  const payload = { name: 'Residual no tracking', description: null, price: 12.5, category_id: f.categoryA, new_category_name: null, tracking_mode: 'no_tracking', recipe_id: null, direct_inventory_item_id: null, kitchen_station_id: f.stationA, available: true, ingredients: [], preparation_time_minutes: 0, calories: null, protein_g: null, carbohydrates_g: null, fat_g: null, fiber_g: null, sugar_g: null, sodium_mg: null, photo_content_type: null };
  await db.connect();
  try {
    await db.query('begin');
    await db.query("set local lock_timeout='3s'; set local statement_timeout='8s'");
    await db.query(migration);
    await db.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now(),now()),($3,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$4,'',now(),now(),now())", [f.ownerA, `${f.ownerA}@residual.invalid`, f.ownerB, `${f.ownerB}@residual.invalid`]);
    await db.query("insert into public.restaurants(id,name,slug,total_tables,table_count) values($1,'Residual A',$2,1,1),($3,'Residual B',$4,1,1)", [f.restaurantA, `residual-a-${f.restaurantA}`, f.restaurantB, `residual-b-${f.restaurantB}`]);
    await db.query("insert into public.restaurant_staff(id,restaurant_id,user_id,role,display_name,email,active) values($1,$2,$3,'owner','Owner A',$4,true),($5,$6,$7,'owner','Owner B',$8,true)", [f.staffA, f.restaurantA, f.ownerA, `${f.ownerA}@residual.invalid`, f.staffB, f.restaurantB, f.ownerB, `${f.ownerB}@residual.invalid`]);
    await db.query("insert into public.categories(id,restaurant_id,name) values($1,$2,'Residual category')", [f.categoryA, f.restaurantA]);
    await db.query("insert into public.kitchen_stations(id,restaurant_id,name,active,is_default) values($1,$2,'Residual station',true,true)", [f.stationA, f.restaurantA]);
    await db.query("insert into public.inventory_categories(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'Residual inventory category','active',$3,$3)", [f.inventoryCategory, f.restaurantA, f.staffA]);
    await db.query("insert into public.inventory_units(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'Residual unit','active',$3,$3)", [f.inventoryUnit, f.restaurantA, f.staffA]);
    await db.query("insert into public.inventory_storage_locations(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'Residual storage','active',$3,$3)", [f.inventoryStorage, f.restaurantA, f.staffA]);
    for (const [id, active, status, name] of [[f.inventoryActive, true, 'active', 'Active inventory'], [f.inventoryInactive, false, 'archived', 'Inactive inventory']]) {
      await db.query("insert into public.inventory_items(id,restaurant_id,name,unit,current_quantity,reorder_level,active,category_id,unit_id,storage_location_id,minimum_stock,status,created_by_staff_id,updated_by_staff_id) values($1,$2,$3,'unit',1,0,$4,$5,$6,$7,0,$8,$9,$9)", [id, f.restaurantA, name, active, f.inventoryCategory, f.inventoryUnit, f.inventoryStorage, status, f.staffA]);
    }

    await denied('inactive Direct Inventory is denied', () => asUser(f.ownerA, () => call(f.restaurantA, randomUUID(), { ...payload, tracking_mode: 'direct_inventory', direct_inventory_item_id: f.inventoryInactive })));
    const direct = await asUser(f.ownerA, () => call(f.restaurantA, randomUUID(), { ...payload, tracking_mode: 'direct_inventory', direct_inventory_item_id: f.inventoryActive }));
    check('valid Direct Inventory creates a canonical direct item', direct.menu_item.direct_inventory_item_id === f.inventoryActive && direct.tracking_mode === 'direct_inventory');

    await db.query("create function pg_temp.fail_owner_menu_insert() returns trigger language plpgsql as $$ begin raise exception 'forced menu insert failure'; end $$; create trigger residual_force_menu_insert before insert on public.menu_items for each row execute function pg_temp.fail_owner_menu_insert()");
    const categoryRequest = randomUUID();
    await denied('forced failure after category creation is rejected', () => asUser(f.ownerA, () => call(f.restaurantA, categoryRequest, { ...payload, name: 'Forced category item', category_id: null, new_category_name: 'Forced category rollback' })));
    const categoryResidue = await db.query("select count(*)::int n from public.categories where restaurant_id=$1 and name='Forced category rollback'", [f.restaurantA]);
    const categoryOperation = await db.query('select count(*)::int n from public.menu_item_creation_operations where restaurant_id=$1 and request_id=$2', [f.restaurantA, categoryRequest]);
    check('category failure leaves no category or operation-state residue', categoryResidue.rows[0].n === 0 && categoryOperation.rows[0].n === 0);

    const recipeRequest = randomUUID();
    await denied('forced failure after operation-created Recipe is rejected', () => asUser(f.ownerA, () => call(f.restaurantA, recipeRequest, { ...payload, name: 'Forced recipe rollback', tracking_mode: 'recipe', recipe_id: null, kitchen_station_id: null })));
    const recipeResidue = await db.query("select count(*)::int n from public.recipes where restaurant_id=$1 and name='Forced recipe rollback'", [f.restaurantA]);
    const recipeOperation = await db.query('select count(*)::int n from public.menu_item_creation_operations where restaurant_id=$1 and request_id=$2', [f.restaurantA, recipeRequest]);
    check('Recipe failure rolls back Recipe, menu insert, and operation state', recipeResidue.rows[0].n === 0 && recipeOperation.rows[0].n === 0);
    await db.query('drop trigger residual_force_menu_insert on public.menu_items');

    const photoRequest = randomUUID();
    const photo = await asUser(f.ownerA, () => call(f.restaurantA, photoRequest, { ...payload, name: 'Residual photo item', photo_content_type: 'image/webp' }));
    await denied('cross-tenant Owner cannot finalize a photo operation', () => asUser(f.ownerB, () => db.query('select public.finalize_owner_menu_item_photo_v1($1,$2,$3,$4)', [f.restaurantA, photoRequest, photo.menu_item.id, photo.photo_object_path])));
    await denied('foreign tenant path cannot be attached to the operation', () => asUser(f.ownerA, () => db.query('select public.finalize_owner_menu_item_photo_v1($1,$2,$3,$4)', [f.restaurantA, photoRequest, photo.menu_item.id, `${f.restaurantB}/${photo.menu_item.id}/${photoRequest}.webp`])));
    await db.query("insert into storage.objects(bucket_id,name) values('menu-photos',$1)", [photo.photo_object_path]);
    const first = await asUser(f.ownerA, () => db.query('select public.finalize_owner_menu_item_photo_v1($1,$2,$3,$4) result', [f.restaurantA, photoRequest, photo.menu_item.id, photo.photo_object_path]).then((r) => r.rows[0].result));
    const replay = await asUser(f.ownerA, () => db.query('select public.finalize_owner_menu_item_photo_v1($1,$2,$3,$4) result', [f.restaurantA, photoRequest, photo.menu_item.id, photo.photo_object_path]).then((r) => r.rows[0].result));
    check('repeated correct finalization is idempotent', first.replayed === false && replay.replayed === true && replay.image_url === first.image_url);

    const residue = await db.query("select (select count(*)::int from public.menu_item_creation_operations where restaurant_id=$1) operations, (select count(*)::int from public.menu_items where restaurant_id=$1) menu_items, (select count(*)::int from public.recipes where restaurant_id=$1) recipes, (select count(*)::int from public.categories where restaurant_id=$1) categories", [f.restaurantA]);
    check('candidate transaction has only successful canonical rows before outer rollback', residue.rows[0].operations === 2 && residue.rows[0].menu_items === 2 && residue.rows[0].recipes === 0 && residue.rows[0].categories === 1);
    await db.query('rollback');
    const after = await db.query("select to_regclass('public.menu_item_creation_operations') operation_table, to_regprocedure('public.create_owner_menu_item_v1(uuid,uuid,jsonb)') create_rpc, to_regprocedure('public.finalize_owner_menu_item_photo_v1(uuid,uuid,uuid,text)') finalize_rpc");
    check('residual validation outer transaction removed all candidate objects and fixtures', after.rows[0].operation_table === null && after.rows[0].create_rpc === null && after.rows[0].finalize_rpc === null);
  } finally { await db.query('rollback').catch(() => {}); await db.end(); }
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });

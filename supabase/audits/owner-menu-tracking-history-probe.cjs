// Audit only: canonical fixture order, authenticated Menu edit, always rollback.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');

async function main() {
  const line = fs.readFileSync(path.join(__dirname, '../connection.env'), 'utf8')
    .split(/\r?\n/).find(value => /^\s*SUPABASE_DB_URL\s*=/.test(value));
  if (!line) throw new Error('Database connection configuration missing');
  const db = new Client({
    connectionString: line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, '').trim().replace(/^['"]|['"]$/g, ''),
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000,
  });
  const f = Object.fromEntries(['restaurant', 'owner', 'cashier', 'ownerStaff', 'cashierStaff', 'category', 'station', 'menu']
    .map(key => [key, randomUUID()]));
  async function actor(user, sql, args = []) {
    await db.query('savepoint actor_call');
    await db.query('set local role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)", [user]);
    try {
      const result = await db.query(sql, args);
      await db.query('reset role');
      return result;
    } catch (error) {
      await db.query('rollback to savepoint actor_call');
      throw error;
    }
  }
  await db.connect();
  try {
    await db.query('begin');
    for (const user of [f.owner, f.cashier]) {
      await db.query(`insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
        values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now(),now())`,
      [user, `menu-tracking-audit-${user}@example.test`]);
    }
    await db.query(`insert into public.restaurants(id,name,slug,total_tables,table_count,profile)
      values($1,'Menu tracking rollback fixture',$2,1,1,'{}')`, [f.restaurant, `menu-tracking-audit-${f.restaurant}`]);
    for (const [staff, user, role] of [[f.ownerStaff, f.owner, 'owner'], [f.cashierStaff, f.cashier, 'cashier']]) {
      await db.query(`insert into public.restaurant_staff(id,restaurant_id,user_id,role,display_name,active)
        values($1,$2,$3,$4,'Menu tracking fixture staff',true)`, [staff, f.restaurant, user, role]);
    }
    await db.query("insert into public.categories(id,restaurant_id,name) values($1,$2,'Fixture category')", [f.category, f.restaurant]);
    await db.query(`insert into public.kitchen_stations(id,restaurant_id,name,active,is_default)
      values($1,$2,'Fixture kitchen',true,true)`, [f.station, f.restaurant]);
    const recipe = (await actor(f.owner, 'select public.manage_recipe($1,$2::jsonb) result', ['create', JSON.stringify({
      restaurant_id: f.restaurant, name: 'Fixture active recipe', status: 'active', yield_quantity: 1, yield_unit: 'serving',
    })])).rows[0].result;
    assert.ok(recipe.id);
    await actor(f.owner, `insert into public.menu_items(id,restaurant_id,category_id,kitchen_station_id,name,price,available,recipe_id)
      values($1,$2,$3,$4,'Fixture menu item',10,true,$5)`, [f.menu, f.restaurant, f.category, f.station, recipe.id]);
    await actor(f.cashier, 'select * from public.open_cashier_shift($1,0,$2)', [f.restaurant, 'Rollback audit fixture']);
    const order = (await actor(f.cashier, 'select public.create_cashier_order($1,$2,$3,$4::jsonb) result',
      [f.restaurant, '1', 'Cash', JSON.stringify([{ menu_item_id: f.menu, quantity: 1 }])])).rows[0].result;
    assert.ok(order.order_id);
    const item = (await db.query('select id,menu_item_id from public.order_items where order_id=$1 and restaurant_id=$2',
      [order.order_id, f.restaurant])).rows[0];
    assert.ok(item);
    console.log('PASS canonical cashier order accepts an active recipe without ingredients');
    await db.query('savepoint before_plan');
    let beforeError;
    try { await db.query('select public.build_inventory_deduction_plan($1)', [item.id]); }
    catch (error) { beforeError = error.message; await db.query('rollback to savepoint before_plan'); }
    assert.match(beforeError, /no ingredients/i);
    console.log('PASS existing order planner resolves to recipe and rejects missing ingredients');
    assert.equal((await actor(f.owner, 'update public.menu_items set recipe_id=null,direct_inventory_item_id=null where id=$1 and restaurant_id=$2',
      [f.menu, f.restaurant])).rowCount, 1);
    const plan = (await db.query('select public.build_inventory_deduction_plan($1) plan', [item.id])).rows[0].plan;
    assert.deepEqual(plan, []);
    const unchanged = (await db.query('select menu_item_id from public.order_items where id=$1', [item.id])).rows[0];
    assert.equal(unchanged.menu_item_id, item.menu_item_id);
    console.log('CONFIRMED same unchanged order item now resolves to no tracking after authenticated Owner Menu edit');
  } finally {
    await db.query('rollback');
    try {
      const residue = (await db.query(`select
        (select count(*)::int from public.restaurants where id=$1) restaurants,
        (select count(*)::int from auth.users where id=any($2::uuid[])) users`, [f.restaurant, [f.owner, f.cashier]])).rows[0];
      assert.deepEqual(residue, { restaurants: 0, users: 0 });
      console.log('PASS rollback complete; fixture tenant and auth user residue zero');
    } finally { await db.end(); }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

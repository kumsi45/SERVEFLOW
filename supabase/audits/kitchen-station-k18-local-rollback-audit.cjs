// Non-persistent K1.8 validation: apply Migration 265 and all fixture data in
// one hosted transaction, assert behaviour, then ROLLBACK.  This is not a
// deployment and never leaves the migration/function/data committed.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Client } = require('pg');

const root = path.resolve(__dirname, '../..');
const connection = fs.readFileSync(path.join(root, 'supabase/connection.env'), 'utf8').match(/^\s*SUPABASE_DB_URL\s*=\s*(.+)\s*$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
const id = () => crypto.randomUUID();
const check = (ok, label) => { assert.ok(ok, label); console.log(`PASS ${label}`); };

(async () => {
  const db = new Client({ connectionString: connection, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const restaurant = id(), owner = id(), ownerStaff = id(), a = id(), b = id();
  try {
    await db.query('begin');
    await db.query(fs.readFileSync(path.join(root, 'supabase/migrations/265_explicit_kitchen_station_disable_no_foundation_side_effect.sql'), 'utf8'));
    await db.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now(),now())", [owner, `k18-${owner}@example.test`]);
    await db.query("insert into public.restaurants(id,name,slug,active) values($1,'K1.8 rollback',$2,true)", [restaurant, `k18-${restaurant}`]);
    await db.query("insert into public.restaurant_staff(id,restaurant_id,user_id,role,display_name,active) values($1,$2,$3,'owner','K1.8 Owner',true)", [ownerStaff, restaurant, owner]);
    await db.query("insert into public.kitchen_stations(id,restaurant_id,name,display_color,icon,priority,active,is_default) values($1,$3,'A','#0f766e','MK',1,true,true),($2,$3,'B','#2563eb','BK',2,false,false)", [a,b,restaurant]);
    const call = async (action, station) => {
      await db.query('set local role authenticated');
      await db.query("select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub',$1,true)", [owner]);
      try {
        return await db.query("select public.manage_kitchen_station($1,$2,$3,null,null,'#0f766e','MK',1,false)", [restaurant,action,station]);
      } finally {
        await db.query('reset role').catch(() => {});
      }
    };
    const count = async () => Number((await db.query('select count(*) n from public.kitchen_stations where restaurant_id=$1 and archived_at is null',[restaurant])).rows[0].n);
    const before = await count();
    await db.query('savepoint expected_last_active');
    try {
      await call('disable', a);
      throw new Error('sole active Disable unexpectedly succeeded');
    } catch (error) {
      if (!/LAST_ACTIVE_KITCHEN_STATION/.test(String(error.message || error))) throw error;
      await db.query('rollback to savepoint expected_last_active');
    }
    check((await db.query('select active from public.kitchen_stations where id=$1',[a])).rows[0].active === true, 'sole active station remains active');
    check(await count() === before, 'sole-active Disable creates no Main Kitchen or other station');
    await db.query('update public.kitchen_stations set active=true where id=$1',[b]);
    await call('disable',a);
    check((await db.query('select active from public.kitchen_stations where id=$1',[a])).rows[0].active === false, 'multi-active Disable succeeds');
    check(await count() === before, 'multi-active Disable creates no replacement station');
    await call('disable',a);
    check(await count() === before, 'repeated Disable is idempotent and creates no station');
    await db.query('rollback');
    console.log('K1.8 ROLLBACK AUDIT PASS');
  } catch (error) {
    await db.query('rollback').catch(() => {});
    throw error;
  } finally { await db.end(); }
})().catch(error => { console.error(`K1.8 ROLLBACK AUDIT ERROR ${error.stack || error}`); process.exitCode = 1; });

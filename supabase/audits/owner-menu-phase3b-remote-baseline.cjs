// Read-only Phase 3B deployment and historical-protection evidence.
const fs = require('node:fs');
const { Client } = require('pg');

const config = fs.readFileSync('supabase/connection.env', 'utf8');
const url = config.match(/^\s*SUPABASE_DB_URL\s*=\s*(.+)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, '');
if (!url) throw new Error('SUPABASE_DB_URL missing');
const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 });

(async () => {
  await db.connect();
  const result = await db.query(`select
    (select max(version) from supabase_migrations.schema_migrations) remote_head,
    to_regclass('public.menu_item_creation_operations') operation_table,
    to_regprocedure('public.create_owner_menu_item_v1(uuid,uuid,jsonb)') create_rpc,
    to_regprocedure('public.finalize_owner_menu_item_photo_v1(uuid,uuid,uuid,text)') finalize_rpc,
    (select public from storage.buckets where id='menu-photos') menu_photos_public,
    (select public from storage.buckets where id='menu-files') menu_files_public,
    (select count(*)::int from pg_policies where schemaname='storage' and tablename='objects' and policyname ilike '%menu%file%' and roles::text like '%anon%') public_menu_files_policies,
    (select md5(coalesce(string_agg(to_jsonb(b)::text,'|' order by b.order_item_id),'')) from public.order_item_inventory_basis b) frozen_basis_hash,
    (select md5(coalesce(string_agg(to_jsonb(d)::text,'|' order by d.order_item_id),'')) from public.inventory_order_item_deductions d) receipts_hash,
    (select md5(coalesce(string_agg(to_jsonb(m)::text,'|' order by m.id),'')) from public.inventory_movements m) movements_hash,
    (select md5(coalesce(string_agg(to_jsonb(i)::text,'|' order by i.id),'')) from public.order_items i) order_items_hash,
    (select count(*)::int from public.order_item_inventory_basis where tracking_mode='legacy_review') legacy_review_count`);
  console.log(JSON.stringify(result.rows[0]));
  await db.end();
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });

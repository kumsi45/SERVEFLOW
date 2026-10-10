// Catalog-only, read-only probe. Never reads tenant rows or secret values.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const line = fs.readFileSync(path.join(__dirname, '..', 'connection.env'), 'utf8')
  .split(/\r?\n/).find((item) => /^\s*SUPABASE_DB_URL\s*=/.test(item));
if (!line) throw new Error('SUPABASE_DB_URL unavailable');
const connectionString = line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, '')
  .trim().replace(/^['"]|['"]$/g, '');
const db = new Client({ connectionString, ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000, query_timeout: 15000 });
async function run() {
  await db.connect();
  try {
    await db.query('begin read only');
    const catalog = (await db.query(`select
      current_setting('server_version') as postgres_version,
      to_regprocedure('public.rls_auto_enable()')::text as rls_auto_enable,
      exists (select 1 from pg_attribute where attrelid='public.menu_items'::regclass
        and attname='description' and not attisdropped) as menu_description,
      to_regprocedure('public.begin_print_bridge_pairing(bytea,bytea,text,integer)')::text as legacy_start,
      to_regprocedure('public.begin_print_bridge_pairing_with_setup(bytea,bytea,text,integer,bytea,uuid,uuid,timestamptz)')::text as new_start,
      to_regclass('public.print_bridge_setup_claims')::text as claims_table`)).rows[0];
    const history=(await db.query(`select version from supabase_migrations.schema_migrations
      where version in ('015','028','055','271','272','273','274')
      order by version`)).rows.map((row)=>row.version);
    console.log(JSON.stringify({ catalog, history }));
    await db.query('rollback');
  } finally { await db.end(); }
}
run().catch((error)=>{ console.error(`CATALOG_UNAVAILABLE ${error.code??''} ${error.message}`); process.exitCode=1; });

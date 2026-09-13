const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'connection.env'), 'utf8');
  const line = source.split(/\r?\n/).find(value => /^\s*SUPABASE_DB_URL\s*=/.test(value));
  if (!line) throw new Error('Database connection configuration missing');
  const connectionString = line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, '').trim().replace(/^['"]|['"]$/g, '');
  const db = new Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
  await db.connect();
  try {
    const reproduce = process.argv[2] === '--rollback-reproduce';
    await db.query(reproduce ? 'begin' : 'begin read only');
    await db.query("set local statement_timeout = '15s'");
    if (reproduce) {
      const { randomUUID } = require('crypto');
      const business = await db.query('select id, slug from public.restaurants where active=true order by created_at limit 1');
      if (!business.rowCount) throw new Error('No active restaurant for rollback fixture');
      const restaurant = business.rows[0];
      const table = await db.query(`insert into public.restaurant_tables (restaurant_id, table_number, label, active, qr_token, qr_path, qr_url)
        select $1, coalesce(max(table_number),0)+1, 'Rollback occupancy audit', true, $2::uuid,
          '/r/' || $3 || '/order?t=' || (coalesce(max(table_number),0)+1)::text || '&qr=' || $2,
          'https://example.invalid/r/' || $3 || '/order?t=' || (coalesce(max(table_number),0)+1)::text || '&qr=' || $2
        from public.restaurant_tables where restaurant_id=$1 returning id,table_number,qr_token`, [restaurant.id, randomUUID(),restaurant.slug]);
      const fixture = table.rows[0];
      const args = [restaurant.slug, String(fixture.table_number), fixture.qr_token];
      async function counts() {
        const data = await db.query(`select
          (select count(*)::int from public.orders where restaurant_id=$1 and table_id=$2) orders,
          (select count(*)::int from public.orders where restaurant_id=$1 and table_id=$2 and public.is_public_qr_dining_session_open(id)) occupied,
          (select count(*)::int from public.restaurant_table_qr_scans where restaurant_id=$1 and table_id=$2) scans`, [restaurant.id,fixture.id]);
        return data.rows[0];
      }
      console.log('before', await counts());
      await db.query('set local role anon');
      await db.query('select public.get_public_qr_menu($1)', [restaurant.slug]);
      await db.query('select public.log_public_qr_scan($1,$2,$3)', args);
      await db.query('select public.log_public_qr_scan($1,$2,$3)', args);
      await db.query('reset role');
      console.log('after menu and repeated scan', await counts());
      await db.query('set local role anon');
      const portal = await db.query('select public.get_smart_qr_portal_state($1,$2,$3,$4) payload', [...args,randomUUID()]);
      await db.query('reset role');
      console.log('portal mode', portal.rows[0].payload.mode, await counts());
      await db.query('set local role anon');
      const session = await db.query('select public.get_public_qr_order_session($1,$2,$3,$4) payload', [...args,randomUUID()]);
      await db.query('reset role');
      console.log('after session lookup', await counts(), 'items', session.rows[0].payload.items.length, 'invoices', session.rows[0].payload.invoices.length);
      await db.query('rollback');
      const remaining = await db.query('select count(*)::int remaining from public.restaurant_tables where id=$1', [fixture.id]);
      if (remaining.rows[0].remaining !== 0) throw new Error('Rollback fixture remained');
      console.log('PASS rollback removed fixture and all transactional changes');
      return;
    }
    const result = await db.query(`select p.proname, pg_get_function_identity_arguments(p.oid) arguments,
      pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and (p.proname ~ '^(get_public_qr_order_session|get_public_qr_menu|log_public_qr_scan|get_smart_qr_portal_state|is_public_qr_dining_session_open|expire_stale_dining_sessions|create_public_qr_order|create_waiter_order|validate_public_qr|try_auto_release_settled_service_location|auto_release_dining_session_for_new_browser_scan)' )
      order by p.proname, arguments`);
    const selected = process.argv[2];
    for (const row of result.rows) {
      if (!selected || row.proname === selected) console.log(row.definition);
    }
    await db.query('rollback');
  } finally {
    // Also roll back an aborted reproduction if a fixture or RPC fails.
    try { await db.query('rollback'); } finally { await db.end(); }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

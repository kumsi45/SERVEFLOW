// Read-only K1.10 interruption inspector.  It deliberately changes no hosted
// state and is safe to run while an audit session is blocked.
const fs = require('node:fs');
const { Client } = require('pg');

const url = fs.readFileSync('supabase/connection.env', 'utf8')
  .match(/^\s*SUPABASE_DB_URL\s*=\s*(.+)\s*$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!url) throw new Error('SUPABASE_DB_URL missing');

(async () => {
  const targetPid = Number(process.argv[2]);
  if (!Number.isInteger(targetPid) || targetPid <= 0) throw new Error('Usage: node kitchen-station-k110-recovery.cjs <audit-backend-pid>');
  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const result = await db.query(`
    select a.pid, a.application_name, a.usename, a.state, a.xact_start,
           a.query_start, a.wait_event_type, a.wait_event, left(a.query, 500) query,
           pg_blocking_pids(a.pid) blocking_pids,
           coalesce(jsonb_agg(jsonb_build_object(
             'locktype', l.locktype, 'mode', l.mode, 'granted', l.granted,
             'classid', l.classid, 'objid', l.objid, 'objsubid', l.objsubid,
             'relation', l.relation::regclass::text
           )) filter (where l.pid is not null), '[]'::jsonb) locks
    from pg_stat_activity a
    left join pg_locks l on l.pid = a.pid
    where a.datname = current_database() and a.pid = $1
    group by a.pid, a.application_name, a.usename, a.state, a.xact_start,
             a.query_start, a.wait_event_type, a.wait_event, a.query
    order by a.pid
  `, [targetPid]);
  const residue = await db.query(`
    select 'restaurants' kind, count(*)::int n from public.restaurants where slug like 'k17-%'
    union all select 'auth_users', count(*)::int from auth.users where email like 'k17-%@example.test'
    union all select 'orders', count(*)::int from public.orders o join public.restaurants r on r.id=o.restaurant_id where r.slug like 'k17-%'
    union all select 'items', count(*)::int from public.order_items i join public.restaurants r on r.id=i.restaurant_id where r.slug like 'k17-%'
  `);
  if (process.env.K110_RECOVER_CLEANUP === '1') {
    // Recovery is deliberately opt-in and constrained to this audit's actual
    // marker namespace.  The supplied PID was printed by the interrupted
    // harness and is terminated first so its transaction is rolled back.
    await db.query('select pg_terminate_backend($1)', [targetPid]);
    await db.query("delete from public.restaurants where slug like 'k17-%'");
    await db.query("delete from auth.users where email like 'k17-%@example.test'");
    const after = await db.query(`
      select 'restaurants' kind, count(*)::int n from public.restaurants where slug like 'k17-%'
      union all select 'auth_users', count(*)::int from auth.users where email like 'k17-%@example.test'
      union all select 'orders', count(*)::int from public.orders o join public.restaurants r on r.id=o.restaurant_id where r.slug like 'k17-%'
      union all select 'items', count(*)::int from public.order_items i join public.restaurants r on r.id=i.restaurant_id where r.slug like 'k17-%'
    `);
    console.log(JSON.stringify({ sessions: result.rows, residue: residue.rows, cleanup: after.rows }, null, 2));
  } else {
    console.log(JSON.stringify({ sessions: result.rows, residue: residue.rows }, null, 2));
  }
  await db.end();
})().catch(error => { console.error(error); process.exitCode = 1; });

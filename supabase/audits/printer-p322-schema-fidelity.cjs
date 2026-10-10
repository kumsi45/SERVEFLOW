// Catalog-only comparison of hosted and disposable local P3.1 schema.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const line = fs.readFileSync(path.join(__dirname, '..', 'connection.env'), 'utf8')
  .split(/\r?\n/).find((item) => /^\s*SUPABASE_DB_URL\s*=/.test(item));
if (!line) throw new Error('SUPABASE_DB_URL unavailable');
const connectionString = line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, '')
  .trim().replace(/^['"]|['"]$/g, '');
const db = new Client({ connectionString, ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000, query_timeout: 30000 });
const sql = `with signatures(name) as (values
  ('public.begin_print_bridge_pairing(bytea,bytea,text,integer)'),
  ('public.approve_print_bridge_pairing(uuid,bytea,uuid,uuid)'),
  ('public.begin_print_bridge_redemption(uuid,bytea)'),
  ('public.complete_print_bridge_redemption(uuid,uuid)'),
  ('public.fail_print_bridge_redemption(uuid,text)'),
  ('public.expire_print_bridge_pairing(uuid)'),
  ('public.cancel_print_bridge_pairing(uuid,uuid)'),
  ('public.owner_revoke_print_agent(uuid,uuid)')
), targets(name) as (values
  ('print_bridge_pairings'),('print_bridge_pairing_events'),
  ('print_agents'),('print_jobs'))
select jsonb_build_object(
  'functions', (select jsonb_agg(jsonb_build_object('name',s.name,
    'definition',pg_get_functiondef(p.oid),'security',p.prosecdef,
    'config',p.proconfig,'acl',p.proacl::text) order by s.name)
    from signatures s left join pg_proc p on p.oid=to_regprocedure(s.name)),
  'columns', (select jsonb_agg(jsonb_build_object('table',t.name,
    'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),
    'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid))
    order by t.name,a.attnum)
    from targets t join pg_class c on c.oid=to_regclass('public.'||t.name)
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum),
  'tables', (select jsonb_agg(jsonb_build_object('table',t.name,
    'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
    'acl',c.relacl::text) order by t.name)
    from targets t join pg_class c on c.oid=to_regclass('public.'||t.name)),
  'constraints', (select jsonb_agg(jsonb_build_object('table',t.name,
    'name',con.conname,'definition',pg_get_constraintdef(con.oid))
    order by t.name,con.conname)
    from targets t join pg_class c on c.oid=to_regclass('public.'||t.name)
    join pg_constraint con on con.conrelid=c.oid),
  'indexes', (select jsonb_agg(jsonb_build_object('table',t.name,
    'name',i.indexname,'definition',i.indexdef) order by t.name,i.indexname)
    from targets t join pg_indexes i on i.schemaname='public' and i.tablename=t.name),
  'policies', (select jsonb_agg(jsonb_build_object('table',t.name,
    'name',p.policyname,'command',p.cmd,'roles',p.roles,
    'using',p.qual,'check',p.with_check) order by t.name,p.policyname)
    from targets t join pg_policies p on p.schemaname='public' and p.tablename=t.name)
) as contract`;
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function run() {
  await db.connect();
  try {
    await db.query('begin read only');
    const hosted=(await db.query(sql)).rows[0].contract;
    await db.query('rollback');
    const local=spawnSync('docker',['exec','supabase_db_workspace','psql',
      '-U','postgres','-d','postgres','-At','-c',sql],
      {encoding:'utf8',timeout:30000,maxBuffer:20*1024*1024});
    if(local.status!==0) throw new Error(`Local catalog query failed: ${local.stderr.slice(-300)}`);
    const isolated=JSON.parse(local.stdout.trim());
    let all=true;
    for(const key of ['functions','columns','tables','constraints','indexes','policies']) {
      const equal=hash(hosted[key])===hash(isolated[key]);
      all &&= equal;
      console.log(`FIDELITY ${key} hosted=${hosted[key]?.length??0} local=${isolated[key]?.length??0} match=${equal}`);
      if(key==='tables' && !equal) {
        for(let i=0;i<hosted.tables.length;i++) {
          if(JSON.stringify(hosted.tables[i])!==JSON.stringify(isolated.tables[i])) {
            console.log(`TABLE_MISMATCH ${hosted.tables[i].table} hosted=${JSON.stringify(hosted.tables[i])} local=${JSON.stringify(isolated.tables[i])}`);
          }
        }
      }
    }
    const rows=spawnSync('docker',['exec','supabase_db_workspace','psql',
      '-U','postgres','-d','postgres','-At','-c',
      'select (select count(*) from auth.users),(select count(*) from public.restaurants),(select count(*) from public.print_bridge_pairings)'],
      {encoding:'utf8',timeout:10000});
    if(rows.status!==0) throw new Error('Local row-count query failed');
    console.log(`ISOLATED_ROWS auth_restaurants_pairings=${rows.stdout.trim()}`);
    if(!all) process.exitCode=2;
  } finally { await db.end(); }
}
run().catch((error)=>{ console.error(`FIDELITY_UNAVAILABLE ${error.code??''} ${error.message}`);
  process.exitCode=1; });

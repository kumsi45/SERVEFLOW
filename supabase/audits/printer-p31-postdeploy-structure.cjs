// Read-only verification of the linked, deployed P3.1 contract.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {Client}=require('pg');
const envLine=fs.readFileSync(path.join(__dirname,'..','connection.env'),'utf8')
  .split(/\r?\n/).find((line)=>/^\s*SUPABASE_DB_URL\s*=/.test(line));
if(!envLine) throw new Error('SUPABASE_DB_URL missing');
const connectionString=envLine.replace(/^\s*SUPABASE_DB_URL\s*=\s*/,'')
  .trim().replace(/^['"]|['"]$/g,'');
let passed=0;
function check(label,condition){assert.ok(condition,label);passed++;console.log(`PASS ${label}`);}
(async()=>{
  const db=new Client({connectionString,ssl:{rejectUnauthorized:false},
    connectionTimeoutMillis:10000,query_timeout:20000});
  await db.connect();
  try {
    const history=(await db.query(`select version,name from supabase_migrations.schema_migrations
      where version>='271' order by version`)).rows;
    check('history contains exactly 271, 272, 273',
      JSON.stringify(history.map((row)=>row.version))===JSON.stringify(['271','272','273']));
    check('273 history name is exact',history[2].name==='print_bridge_lifecycle');
    const names=['print_bridge_pairings','print_bridge_pairing_events',
      'print_agent_lifecycle_events','print_agent_printers','print_printer_observations'];
    const tables=(await db.query(`select relname,relrowsecurity,relforcerowsecurity
      from pg_class where relnamespace='public'::regnamespace and relname=any($1)`,
      [names])).rows;
    check('five new tables have forced RLS',tables.length===5 &&
      tables.every((row)=>row.relrowsecurity && row.relforcerowsecurity));
    check('new tables deny direct browser and anonymous reads',
      (await db.query(`select bool_and(
          not has_table_privilege('anon',c.oid,'SELECT') and
          not has_table_privilege('authenticated',c.oid,'SELECT')) denied
          from pg_class c where c.relnamespace='public'::regnamespace
            and c.relname=any($1)`,[names])).rows[0].denied===true);
    const columns=(await db.query(`select table_name,column_name,data_type from information_schema.columns
      where table_schema='public' and table_name=any($1)`,
      [['print_agents','printer_connections',...names]])).rows;
    const has=(table,column,type)=>columns.some((row)=>row.table_name===table &&
      row.column_name===column && (!type||row.data_type===type));
    check('agent version/platform/heartbeat fields exist',
      ['bridge_version','platform','last_heartbeat_at'].every((column)=>
        has('print_agents',column)));
    check('Windows queue name has dedicated text field',
      has('printer_connections','windows_queue_name','text'));
    check('pairing stores digest columns and no raw proof column',
      has('print_bridge_pairings','code_digest','bytea') &&
      has('print_bridge_pairings','proof_digest','bytea') &&
      !['proof','code','raw_proof','raw_code'].some((column)=>
        has('print_bridge_pairings',column)));
    const constraints=(await db.query(`select conname,contype,conrelid::regclass::text tab
      from pg_constraint where connamespace='public'::regnamespace
        and conrelid=any($1::regclass[])`,
      [[...names,'printer_connections','print_agents'].map((name)=>`public.${name}`)])).rows;
    check('pairing and affinity tenant foreign keys exist',
      ['print_bridge_pairings_agent_tenant','print_agent_printers_agent_tenant',
        'print_agent_printers_printer_tenant','print_printer_observations_affinity']
        .every((name)=>constraints.some((row)=>row.conname===name&&row.contype==='f')));
    check('Windows queue and pairing shape constraints exist',
      ['printer_connections_windows_queue_shape','print_bridge_pairings_digest_shape',
        'print_bridge_pairings_expiry_shape','print_bridge_pairings_completion_shape']
        .every((name)=>constraints.some((row)=>row.conname===name)));
    const indexes=(await db.query(`select indexname from pg_indexes where schemaname='public'
      and tablename=any($1)`,[[...names,'print_agents']])).rows.map((row)=>row.indexname);
    check('pairing, agent, affinity, observation indexes exist',
      ['print_bridge_pairings_expiry_idx','print_bridge_pairings_restaurant_idx',
        'print_agents_last_seen_idx','print_agent_printers_printer_idx',
        'print_printer_observations_recent_idx'].every((name)=>indexes.includes(name)));
    const service=['begin_print_bridge_pairing','approve_print_bridge_pairing',
      'begin_print_bridge_redemption','complete_print_bridge_redemption',
      'expire_print_bridge_pairing','fail_print_bridge_redemption'];
    const runtime=['cancel_print_bridge_pairing','owner_set_print_agent_printer',
      'owner_revoke_print_agent','renew_print_job_lease','heartbeat_print_agent',
      'report_print_printer_observation','get_claimed_print_job_connection_v2',
      'claim_print_jobs','get_claimed_print_job_connection','acknowledge_print_job'];
    const functions=(await db.query(`select proname,oid::regprocedure::text signature,
      prosecdef,proconfig,pg_get_functiondef(oid) definition,
      has_function_privilege('anon',oid,'EXECUTE') anon,
      has_function_privilege('authenticated',oid,'EXECUTE') authenticated,
      has_function_privilege('service_role',oid,'EXECUTE') service
      from pg_proc where pronamespace='public'::regnamespace and proname=any($1)`,
      [[...service,...runtime]])).rows;
    check('all 16 P3.1 function signatures have one effective definition each',
      functions.length===16 && [...service,...runtime].every((name)=>
        functions.filter((row)=>row.proname===name).length===1));
    check('all P3.1 functions are definer with fixed public, pg_temp search path',
      functions.every((row)=>row.prosecdef &&
        row.proconfig?.some((entry)=>/^search_path=public,\s*pg_temp$/.test(entry))));
    check('provisioning is service only; anon has no P3.1 RPC access',
      functions.every((row)=>!row.anon && row.service) &&
      functions.filter((row)=>service.includes(row.proname))
        .every((row)=>!row.authenticated));
    check('owner and agent runtime RPCs retain authenticated access',
      functions.filter((row)=>runtime.includes(row.proname))
        .every((row)=>row.authenticated));
    const claim=functions.find((row)=>row.proname==='claim_print_jobs').definition;
    const renewal=functions.find((row)=>row.proname==='renew_print_job_lease').definition;
    const connection=functions.find((row)=>
      row.proname==='get_claimed_print_job_connection_v2').definition;
    check('effective claim, renewal and connection definitions enforce affinity',
      [claim,renewal,connection].every((def)=>def.includes('print_agent_printers')));
    check('effective runtime binds agent to auth.uid()',
      [claim,renewal,connection].every((def)=>def.includes('auth.uid()')));
    const p2=['print_queue_activations','print_agents','print_jobs',
      'print_job_order_items','print_job_attempts'];
    check('P2 queue tables remain present',
      (await db.query(`select count(*)::int count from pg_class where
        relnamespace='public'::regnamespace and relname=any($1)`,[p2])).rows[0].count===5);
    const counts=(await db.query(`select
      (select count(*)::int from public.print_jobs) jobs,
      (select count(*)::int from public.print_job_attempts) attempts,
      (select count(*)::int from public.print_queue_activations) activations,
      (select count(*)::int from public.print_bridge_pairings) pairings,
      (select count(*)::int from auth.users where email like 'p31-%@example.test') audit_users,
      (select count(*)::int from public.business_printers
        where name like 'P31 Audit %') audit_printers`)).rows[0];
    check('rollback audit left no hosted fixtures',counts.pairings===0 &&
      counts.audit_users===0 && counts.audit_printers===0);
    console.log('COUNTS',JSON.stringify(counts));
    console.log(`P31_POSTDEPLOY_STRUCTURE ${passed} passed, 0 failed`);
  } finally {await db.end();}
})().catch((error)=>{console.error('P31_POSTDEPLOY_STRUCTURE_FAILED',error.code??'',
  error.message);process.exitCode=1;});

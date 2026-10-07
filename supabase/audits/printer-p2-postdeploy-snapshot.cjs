const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const assert = require('node:assert/strict');

const envLine = fs.readFileSync(path.join(__dirname, '..', 'connection.env'), 'utf8')
  .split(/\r?\n/).find((line) => /^\s*SUPABASE_DB_URL\s*=/.test(line));
if (!envLine) throw new Error('SUPABASE_DB_URL missing');
const connectionString = envLine.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, '')
  .trim().replace(/^['"]|['"]$/g, '');

(async () => {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    for (const [label, sql, params] of [
      ['history', `select version,name from supabase_migrations.schema_migrations
        where version >= $1 order by version`, ['271']],
      ['queue', `select count(*)::integer count,min(created_at) earliest,max(created_at) latest
        from public.print_jobs`, []],
      ['activation', `select count(*)::integer count,min(activated_at) earliest,max(activated_at) latest
        from public.print_queue_activations`, []],
      ['restaurants', `select count(*)::integer count from public.restaurants`, []],
    ]) {
      console.log(label, JSON.stringify((await client.query(sql, params)).rows));
    }
    const tables = ['print_queue_activations', 'print_agents', 'print_jobs',
      'print_job_order_items', 'print_job_attempts'];
    const tableRows = (await client.query(`select relname,relrowsecurity,relforcerowsecurity
      from pg_class where relnamespace='public'::regnamespace and relname=any($1)
      order by relname`, [tables])).rows;
    assert.equal(tableRows.length, tables.length);
    assert.ok(tableRows.every((row) => row.relrowsecurity && row.relforcerowsecurity));
    console.log('tables_rls', JSON.stringify(tableRows));
    const columns = (await client.query(`select table_name,column_name,data_type,is_nullable
      from information_schema.columns where table_schema='public' and table_name=any($1)
      order by table_name,ordinal_position`, [tables])).rows;
    const requiredColumns = {
      print_queue_activations: ['restaurant_id', 'activated_at', 'created_at'],
      print_agents: ['id', 'restaurant_id', 'auth_user_id', 'enabled', 'revoked_at'],
      print_jobs: ['id', 'restaurant_id', 'automatic_key', 'order_id', 'invoice_id',
        'kitchen_station_id', 'target_printer_id', 'template_id', 'template_version',
        'payload_version', 'payload', 'status', 'attempt_count', 'available_at',
        'claimed_at', 'claim_expires_at', 'claimed_by_agent_id', 'original_job_id'],
      print_job_order_items: ['restaurant_id', 'print_job_id', 'order_item_id', 'line_position'],
      print_job_attempts: ['restaurant_id', 'print_job_id', 'agent_id', 'attempt_number',
        'outcome', 'lease_expires_at', 'completed_at'],
    };
    for (const [table, names] of Object.entries(requiredColumns)) {
      const deployed = new Set(columns.filter((row) => row.table_name === table)
        .map((row) => row.column_name));
      for (const name of names) assert.ok(deployed.has(name), `${table}.${name} missing`);
    }
    console.log('required_columns', Object.entries(requiredColumns).map(([table, names]) =>
      `${table}:${names.length}`).join(' '));
    const constraints = (await client.query(`select c.conrelid::regclass::text table_name,
      c.conname,c.contype,pg_get_constraintdef(c.oid) definition
      from pg_constraint c where c.conrelid=any($1::regclass[])
      order by c.conrelid::regclass::text,c.conname`,
    [tables.map((name) => `public.${name}`)])).rows;
    for (const table of tables) {
      assert.ok(constraints.some((row) => row.table_name === table && row.contype === 'p'));
      assert.ok(constraints.some((row) => row.table_name === table && row.contype === 'f'));
    }
    for (const name of ['print_jobs_status_allowed', 'print_jobs_automatic_key_unique',
      'print_jobs_order_same_restaurant', 'print_jobs_invoice_same_restaurant',
      'print_jobs_printer_same_restaurant', 'print_jobs_station_same_restaurant',
      'print_jobs_original_same_restaurant', 'print_jobs_claim_shape',
      'print_jobs_payload_object', 'print_job_attempts_job_number_unique']) {
      assert.ok(constraints.some((row) => row.conname === name), `${name} missing`);
    }
    console.log('constraints', JSON.stringify(constraints.map((row) => row.conname)));
    const indexes = (await client.query(`select tablename,indexname,indexdef
      from pg_indexes where schemaname='public' and tablename=any($1)
      order by tablename,indexname`, [tables])).rows;
    for (const name of ['print_jobs_claim_queue_idx', 'print_jobs_expired_claim_idx',
      'print_jobs_printer_status_idx', 'print_jobs_kitchen_trace_idx',
      'print_jobs_created_idx', 'print_jobs_original_idx',
      'print_job_attempts_trace_idx', 'print_agents_tenant_idx']) {
      assert.ok(indexes.some((row) => row.indexname === name), `${name} missing`);
    }
    console.log('indexes', JSON.stringify(indexes.map((row) => row.indexname)));
    const functions = (await client.query(`select p.oid::regprocedure::text signature,
      p.proname,p.prosecdef,p.proconfig,
      has_function_privilege('anon',p.oid,'EXECUTE') anon,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
      has_function_privilege('service_role',p.oid,'EXECUTE') service_role
      from pg_proc p where p.pronamespace='public'::regnamespace
        and p.proname=any($1) order by p.proname`, [[
        'ensure_print_queue_activation','resolve_print_job_printer',
        'resolve_print_job_template','print_creator_snapshot',
        'enqueue_kitchen_print_jobs','enqueue_receipt_print_job',
        'enqueue_print_jobs_from_change','reconcile_print_jobs',
        'register_print_agent','revoke_print_agent','claim_print_jobs',
        'get_claimed_print_job_connection','acknowledge_print_job',
        'request_print_job_reprint','request_print_job_dispatch',
        'get_print_jobs','protect_print_job_snapshot','print_final_dining_bill',
      ]])).rows;
    assert.equal(functions.length, 18);
    assert.ok(functions.every((row) => row.proconfig?.includes('search_path=public')));
    assert.ok(functions.filter((row) => row.proname !== 'protect_print_job_snapshot')
      .every((row) => row.prosecdef));
    assert.ok(functions.every((row) => !row.anon));
    for (const name of ['reconcile_print_jobs','claim_print_jobs',
      'get_claimed_print_job_connection','acknowledge_print_job',
      'request_print_job_reprint','request_print_job_dispatch','get_print_jobs',
      'print_final_dining_bill']) {
      assert.ok(functions.find((row) => row.proname === name)?.authenticated);
    }
    console.log('functions_grants', JSON.stringify(functions));
    const access = (await client.query(`select c.relname,
      has_table_privilege('anon',c.oid,'SELECT') anon_select,
      has_table_privilege('authenticated',c.oid,'SELECT') authenticated_select,
      has_table_privilege('service_role',c.oid,'SELECT') service_select
      from pg_class c where c.relnamespace='public'::regnamespace
        and c.relname=any($1) order by c.relname`, [tables])).rows;
    assert.ok(access.every((row) => !row.anon_select &&
      !row.authenticated_select && row.service_select));
    console.log('table_grants', JSON.stringify(access));
    const missingActivation = (await client.query(`select count(*)::integer count
      from public.restaurants r left join public.print_queue_activations a
        on a.restaurant_id=r.id where a.restaurant_id is null`)).rows[0].count;
    assert.equal(missingActivation, 0);
    console.log('activation_missing', missingActivation);
  } finally { await client.end(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });

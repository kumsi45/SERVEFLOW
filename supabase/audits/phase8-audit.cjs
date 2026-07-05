const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function readConnectionUrl() {
  const lines = fs.readFileSync(path.join(__dirname, "connection.env"), "utf8").split(/\r?\n/);
  const line = lines.find((l) => /^\s*SUPABASE_DB_URL\s*=/.test(l));
  if (!line) throw new Error("SUPABASE_DB_URL missing");
  let v = line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, "").trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
}

async function main() {
  const c = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  await c.connect();

  // 1. All RLS policies
  const policies = await c.query(`
    SELECT tablename, policyname, cmd, qual, with_check
    FROM pg_policies WHERE schemaname = 'public'
    ORDER BY tablename, cmd, policyname
  `);

  // 2. Tables without RLS
  const noRls = await c.query(`
    SELECT relname FROM pg_class
    WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
    AND NOT relrowsecurity
    ORDER BY relname
  `);

  // 3. All public functions and their security
  const funcs = await c.query(`
    SELECT proname, prosecdef, provolatile
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
    AND prokind = 'f'
    ORDER BY proname
  `);

  // 4. orders table columns
  const orderCols = await c.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orders'
    ORDER BY ordinal_position
  `);

  // 5. staff_activity_log structure
  const logCols = await c.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='staff_activity_log'
    ORDER BY ordinal_position
  `);

  // 6. Existing grants on key tables
  const grants = await c.query(`
    SELECT grantee, table_name, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema='public'
    AND table_name IN ('orders','restaurant_staff','staff_activity_log','restaurants')
    AND grantee IN ('anon','authenticated')
    ORDER BY table_name, grantee, privilege_type
  `);

  // 7. All RPC grants
  const rpcGrants = await c.query(`
    SELECT grantee, routine_name, privilege_type
    FROM information_schema.role_routine_grants
    WHERE routine_schema='public'
    AND grantee IN ('anon','authenticated')
    ORDER BY routine_name, grantee
  `);

  console.log("=== POLICIES ===");
  policies.rows.forEach(r => console.log(`[${r.tablename}][${r.cmd}] ${r.policyname}`));

  console.log("\n=== TABLES WITHOUT RLS ===");
  noRls.rows.forEach(r => console.log(r.relname));

  console.log("\n=== FUNCTIONS ===");
  funcs.rows.forEach(r => console.log(`${r.proname}: SECURITY_DEFINER=${r.prosecdef}`));

  console.log("\n=== ORDERS COLUMNS ===");
  orderCols.rows.forEach(r => console.log(`${r.column_name}: ${r.data_type} nullable=${r.is_nullable}`));

  console.log("\n=== ACTIVITY LOG COLUMNS ===");
  logCols.rows.forEach(r => console.log(`${r.column_name}: ${r.data_type} nullable=${r.is_nullable}`));

  console.log("\n=== TABLE GRANTS ===");
  grants.rows.forEach(r => console.log(`[${r.table_name}] ${r.grantee}: ${r.privilege_type}`));

  console.log("\n=== RPC GRANTS ===");
  rpcGrants.rows.forEach(r => console.log(`${r.routine_name}: ${r.grantee} = ${r.privilege_type}`));

  await c.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });

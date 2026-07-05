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
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();

  console.log("\n=== PHASE 6: AUDIT LOG CONSISTENCY ===\n");

  // 1. Does staff_activity_log table exist?
  const tableCheck = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND (table_name LIKE '%log%' OR table_name LIKE '%audit%' OR table_name LIKE '%activity%')
    ORDER BY table_name
  `);
  console.log("Audit/Activity tables:");
  if (tableCheck.rows.length === 0) console.log("  NONE FOUND — no audit logging table exists");
  else tableCheck.rows.forEach(r => console.log(`  ${r.table_name} | RLS: ${r.row_security}`));

  // 2. Check RLS on key mutation tables
  console.log("\nRLS status on mutation tables:");
  const rls = await client.query(`
    SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE relname IN ('orders','order_items','restaurant_staff','restaurants','menu_items','categories')
    AND relkind = 'r'
    ORDER BY relname
  `);
  rls.rows.forEach(r => console.log(`  ${r.relname}: RLS=${r.relrowsecurity}, FORCE=${r.relforcerowsecurity}`));

  // 3. Check if any triggers exist for audit logging
  console.log("\nTriggers (audit/logging):");
  const triggers = await client.query(`
    SELECT trigger_name, event_object_table, event_manipulation, action_timing
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
    ORDER BY event_object_table, trigger_name
  `);
  if (triggers.rows.length === 0) console.log("  NO TRIGGERS FOUND — mutations are not audited");
  else triggers.rows.forEach(r => console.log(`  [${r.event_object_table}] ${r.trigger_name} ON ${r.event_manipulation} ${r.action_timing}`));

  // 4. Check RPCs that mutate orders — do they log?
  console.log("\nRPC mutation audit check:");
  const rpcs = ["approve_order_payment", "start_order_preparation", "mark_order_ready", "mark_order_completed", "create_public_qr_order"];
  for (const name of rpcs) {
    const r = await client.query(`SELECT prosrc FROM pg_proc WHERE proname = $1 AND pronamespace = 'public'::regnamespace`, [name]);
    if (r.rows.length === 0) { console.log(`  ${name}: NOT FOUND`); continue; }
    const src = r.rows[0].prosrc;
    const hasLog = src.includes("activity_log") || src.includes("audit") || src.includes("INSERT INTO") && src.toLowerCase().includes("log");
    const hasRestaurantIsolation = src.includes("restaurant_id");
    const hasAuthCheck = src.includes("auth.uid()") || src.includes("caller_user_id");
    console.log(`  ${name}: logs=${hasLog ? "YES" : "NO"} | tenant_isolated=${hasRestaurantIsolation ? "YES" : "NO"} | auth_check=${hasAuthCheck ? "YES" : "NO"}`);
  }

  // 5. Check restaurant_staff RLS policies
  console.log("\nrestaurant_staff RLS policies:");
  const staffPolicies = await client.query(`
    SELECT policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'restaurant_staff'
    ORDER BY policyname
  `);
  if (staffPolicies.rows.length === 0) console.log("  NO POLICIES — restaurant_staff is unprotected!");
  else staffPolicies.rows.forEach(r => console.log(`  [${r.cmd}] ${r.policyname}`));

  // 6. Check orders RLS policies
  console.log("\norders RLS policies:");
  const orderPolicies = await client.query(`
    SELECT policyname, cmd, qual
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'orders'
    ORDER BY policyname
  `);
  if (orderPolicies.rows.length === 0) console.log("  NO POLICIES — orders is unprotected!");
  else orderPolicies.rows.forEach(r => console.log(`  [${r.cmd}] ${r.policyname}`));

  // 7. PHASE 7 — Abuse simulation tests
  console.log("\n=== PHASE 7: ABUSE SIMULATION TESTS ===\n");

  // Test: Can anon insert directly into orders?
  console.log("7a. Direct insert bypass test (orders table — anon role simulation):");
  const orderInsertPolicies = await client.query(`
    SELECT policyname, cmd, with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'orders' AND cmd IN ('INSERT','ALL')
  `);
  if (orderInsertPolicies.rows.length === 0) {
    console.log("  WARNING: No INSERT policy on orders — authenticated users may insert arbitrary orders!");
  } else {
    orderInsertPolicies.rows.forEach(r => console.log(`  INSERT policy: ${r.policyname} | with_check: ${r.with_check || "NULL"}`));
  }

  // Test: Can authenticated user insert into restaurant_staff with arbitrary role?
  console.log("\n7b. Role escalation test (restaurant_staff INSERT):");
  const staffInsertPolicies = await client.query(`
    SELECT policyname, cmd, with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'restaurant_staff' AND cmd IN ('INSERT','ALL')
  `);
  if (staffInsertPolicies.rows.length === 0) {
    console.log("  CRITICAL: No INSERT policy on restaurant_staff — any authenticated user can add themselves as owner!");
  } else {
    staffInsertPolicies.rows.forEach(r => console.log(`  INSERT policy: ${r.policyname} | with_check: ${r.with_check?.slice(0,100) || "NULL"}`));
  }

  // Test: Can authenticated user update their own role?
  console.log("\n7c. Self role escalation test (restaurant_staff UPDATE):");
  const staffUpdatePolicies = await client.query(`
    SELECT policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'restaurant_staff' AND cmd IN ('UPDATE','ALL')
  `);
  if (staffUpdatePolicies.rows.length === 0) {
    console.log("  CRITICAL: No UPDATE policy on restaurant_staff — users can change their own role!");
  } else {
    staffUpdatePolicies.rows.forEach(r => console.log(`  UPDATE policy: ${r.policyname}`));
  }

  // Test: Cross-restaurant data access via direct REST
  console.log("\n7d. Cross-restaurant isolation (orders SELECT policy):");
  const orderSelectPolicies = await client.query(`
    SELECT policyname, qual
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'orders' AND cmd IN ('SELECT','ALL')
  `);
  orderSelectPolicies.rows.forEach(r => {
    const isolates = r.qual?.includes("restaurant_id") || false;
    console.log(`  SELECT policy: ${r.policyname} | restaurant_isolated: ${isolates ? "YES" : "NO — RISK!"}`);
  });

  // Test: JWT reuse after role change
  console.log("\n7e. JWT reuse after role change:");
  console.log("  Supabase JWTs are stateless and valid until expiry (~1h by default).");
  console.log("  If a staff member's role is deactivated (active=false), the JWT remains valid.");
  console.log("  Mitigation: RLS policies must check restaurant_staff.active = true, not just JWT claims.");
  const activeCheck = await client.query(`
    SELECT policyname, qual
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('orders','restaurant_staff')
    AND qual LIKE '%active%'
  `);
  if (activeCheck.rows.length === 0) {
    console.log("  WARNING: No policies found checking active=true — deactivated staff may retain access via JWT!");
  } else {
    activeCheck.rows.forEach(r => console.log(`  Policy with active check: ${r.policyname}`));
  }

  // Test: Email signup spam
  console.log("\n7f. Email signup spam protection:");
  const signupLimit = await client.query(`
    SELECT setting_name, setting
    FROM auth.config
    WHERE setting_name IN ('rate_limit_email_sent', 'mailer_autoconfirm', 'enable_signup')
  `).catch(() => ({ rows: [] }));
  if (signupLimit.rows.length === 0) {
    console.log("  Cannot read auth.config — check Supabase Dashboard → Authentication → Rate Limits");
    console.log("  Default: 3 emails/hour per IP. For high-volume: disable email confirmation or use custom SMTP.");
  } else {
    signupLimit.rows.forEach(r => console.log(`  ${r.setting_name}: ${r.setting}`));
  }

  await client.end();
  console.log("\n=== AUDIT COMPLETE ===");
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });

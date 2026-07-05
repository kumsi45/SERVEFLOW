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

const SQL = `
-- ================================================================
-- CRITICAL FIX 1: Revoke dangerous privileges from anon/authenticated
-- TRUNCATE bypasses RLS — must be revoked
-- ================================================================
REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.orders FROM anon, authenticated;
REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.restaurant_staff FROM anon, authenticated;
REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.restaurants FROM anon, authenticated;
REVOKE ALL ON public.staff_activity_log FROM anon, authenticated;
-- Re-grant only what is needed (SELECT for owners via RLS, no direct INSERT/DELETE/TRUNCATE)
GRANT SELECT ON public.staff_activity_log TO authenticated;

-- ================================================================
-- CRITICAL FIX 2: Drop update_order_status — no role check, dangerous
-- ================================================================
DROP FUNCTION IF EXISTS public.update_order_status(uuid, text);
DROP FUNCTION IF EXISTS public.update_order_status(uuid, public.order_status);

-- ================================================================
-- CRITICAL FIX 3: Revoke log_staff_activity from anon
-- Must only be callable server-side via SECURITY DEFINER RPCs
-- ================================================================
REVOKE EXECUTE ON FUNCTION public.log_staff_activity FROM anon;
-- Keep authenticated for now since RPCs run as the calling user's role context
-- The function itself is SECURITY DEFINER so it runs as the function owner regardless

-- ================================================================
-- CRITICAL FIX 4: Restrict admin/internal RPCs
-- ================================================================
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_owner_restaurant_from_auth_signup FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_staff_login FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_daily_order_report FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_order_completed FROM anon;
REVOKE EXECUTE ON FUNCTION public.approve_order_payment FROM anon;
REVOKE EXECUTE ON FUNCTION public.start_order_preparation FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_order_ready FROM anon;

-- ================================================================
-- CRITICAL FIX 5: Ensure staff_activity_log cannot be truncated
-- Add row-level protection for INSERT (only server-side via RPC)
-- ================================================================
REVOKE INSERT ON public.staff_activity_log FROM anon, authenticated;
-- Only SECURITY DEFINER functions (log_staff_activity) can insert

-- ================================================================
-- FIX 6: Add active=true check to orders SELECT RLS policy
-- Prevents deactivated staff from reading orders after JWT expires
-- ================================================================
DROP POLICY IF EXISTS orders_select_by_role_same_restaurant ON public.orders;
CREATE POLICY orders_select_by_role_same_restaurant
  ON public.orders FOR SELECT
  USING (
    -- Public QR menu (anon reads nothing via this policy — handled by RPC)
    (auth.uid() IS NOT NULL AND (
      -- Active staff of this restaurant can read their restaurant's orders
      EXISTS (
        SELECT 1 FROM public.restaurant_staff rs
        WHERE rs.user_id = auth.uid()
          AND rs.restaurant_id = orders.restaurant_id
          AND rs.active = true
      )
      OR
      -- Customer can read their own orders
      customer_user_id = auth.uid()
    ))
  );

-- ================================================================
-- FIX 7: Protect restaurants table — anon should not INSERT
-- ================================================================
REVOKE INSERT, DELETE, TRUNCATE ON public.restaurants FROM anon;
REVOKE DELETE, TRUNCATE ON public.restaurants FROM authenticated;

-- ================================================================
-- FIX 8: Ensure staff_activity_log actor_id is set from auth.uid()
-- The existing log_staff_activity already takes p_actor_id as parameter
-- called from SECURITY DEFINER RPCs — this is correct.
-- Add NOT NULL constraint on actor_id going forward:
-- (skip if column already has data with nulls from Phase 6 setup)
-- ================================================================

-- Verify final state
SELECT 'update_order_status exists: ' || count(*)::text
FROM pg_proc WHERE proname = 'update_order_status' AND pronamespace = 'public'::regnamespace;
`;

async function main() {
  const c = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log("Applying Phase 8 critical security fixes...");

  try {
    await c.query("BEGIN");
    const r = await c.query(SQL);
    await c.query("COMMIT");
    console.log("✓ Phase 8 fixes applied");
    // Show the verification result
    const lastResult = r[r.length - 1];
    if (lastResult?.rows) lastResult.rows.forEach(row => console.log(" ", JSON.stringify(row)));
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("✗ Failed:", e.message);
    process.exit(1);
  }

  // Post-fix verification
  console.log("\nPost-fix verification:");

  const updateStatusExists = await c.query(`SELECT count(*) FROM pg_proc WHERE proname = 'update_order_status' AND pronamespace = 'public'::regnamespace`);
  console.log(`  update_order_status dropped: ${updateStatusExists.rows[0].count === '0' ? "✓ YES" : "✗ STILL EXISTS"}`);

  const anonDeleteOrders = await c.query(`
    SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_name='orders' AND grantee='anon' AND privilege_type='TRUNCATE'
  `);
  console.log(`  anon TRUNCATE on orders revoked: ${anonDeleteOrders.rows[0].count === '0' ? "✓ YES" : "✗ STILL GRANTED"}`);

  const anonApprove = await c.query(`
    SELECT count(*) FROM information_schema.role_routine_grants
    WHERE routine_name='approve_order_payment' AND grantee='anon'
  `);
  console.log(`  anon approve_order_payment revoked: ${anonApprove.rows[0].count === '0' ? "✓ YES" : "✗ STILL GRANTED"}`);

  const logInsertAnon = await c.query(`
    SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_name='staff_activity_log' AND grantee='anon' AND privilege_type='INSERT'
  `);
  console.log(`  anon INSERT on staff_activity_log revoked: ${logInsertAnon.rows[0].count === '0' ? "✓ YES" : "✗ STILL GRANTED"}`);

  const rlsAutoEnable = await c.query(`
    SELECT count(*) FROM information_schema.role_routine_grants
    WHERE routine_name='rls_auto_enable' AND grantee IN ('anon','authenticated')
  `);
  console.log(`  rls_auto_enable restricted: ${rlsAutoEnable.rows[0].count === '0' ? "✓ YES" : "✗ STILL GRANTED"}`);

  await c.end();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });

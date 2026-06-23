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
-- FIX 1: Ensure staff_activity_log has correct structure
-- ================================================================
DO $$
BEGIN
  -- Add missing columns if they don't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='staff_activity_log' AND column_name='restaurant_id') THEN
    ALTER TABLE public.staff_activity_log ADD COLUMN restaurant_id uuid REFERENCES public.restaurants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='staff_activity_log' AND column_name='action') THEN
    ALTER TABLE public.staff_activity_log ADD COLUMN action text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='staff_activity_log' AND column_name='actor_id') THEN
    ALTER TABLE public.staff_activity_log ADD COLUMN actor_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='staff_activity_log' AND column_name='target_id') THEN
    ALTER TABLE public.staff_activity_log ADD COLUMN target_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='staff_activity_log' AND column_name='metadata') THEN
    ALTER TABLE public.staff_activity_log ADD COLUMN metadata jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='staff_activity_log' AND column_name='created_at') THEN
    ALTER TABLE public.staff_activity_log ADD COLUMN created_at timestamptz DEFAULT now();
  END IF;
END $$;

-- RLS on staff_activity_log: only owners can read their own restaurant's logs
ALTER TABLE public.staff_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_activity_log_select_owner ON public.staff_activity_log;
CREATE POLICY staff_activity_log_select_owner
  ON public.staff_activity_log FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.restaurant_staff
      WHERE user_id = auth.uid() AND role = 'owner' AND active = true
    )
  );

-- Prevent direct client inserts — logs must come from server-side functions only
DROP POLICY IF EXISTS staff_activity_log_insert_deny ON public.staff_activity_log;
-- No INSERT policy = no one can insert directly. Only SECURITY DEFINER functions can bypass RLS.

-- ================================================================
-- FIX 2: Helper function to log activity (SECURITY DEFINER — cannot be forged by client)
-- ================================================================
CREATE OR REPLACE FUNCTION public.log_staff_activity(
  p_restaurant_id uuid,
  p_actor_id uuid,
  p_action text,
  p_target_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.staff_activity_log (restaurant_id, actor_id, action, target_id, metadata, created_at)
  VALUES (p_restaurant_id, p_actor_id, p_action, p_target_id, p_metadata, now());
EXCEPTION WHEN OTHERS THEN
  -- Logging must NEVER fail silently and block business operations
  -- Log failure is swallowed but the calling transaction continues
  RAISE WARNING 'Activity logging failed: %', SQLERRM;
END;
$$;

-- ================================================================
-- FIX 3: Update approve_order_payment to log the action
-- ================================================================
CREATE OR REPLACE FUNCTION public.approve_order_payment(target_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_user_id uuid := auth.uid();
  acting_staff public.restaurant_staff;
  updated_order public.orders;
  target_restaurant_id uuid;
BEGIN
  IF caller_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to approve payment.';
  END IF;

  SELECT restaurant_id INTO target_restaurant_id FROM public.orders WHERE id = target_order_id;
  IF target_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Order not found for current restaurant.';
  END IF;

  SELECT * INTO acting_staff
  FROM public.restaurant_staff
  WHERE user_id = caller_user_id AND restaurant_id = target_restaurant_id AND active = true AND role IN ('cashier','owner')
  LIMIT 1;

  IF acting_staff.id IS NULL THEN
    RAISE EXCEPTION 'Only cashiers and owners can approve payments.';
  END IF;

  UPDATE public.orders
  SET status = 'paid', payment_verified_at = now(), payment_verified_by = acting_staff.id
  WHERE id = target_order_id AND restaurant_id = target_restaurant_id AND status = 'pending_payment'
  RETURNING * INTO updated_order;

  IF updated_order IS NULL THEN
    RAISE EXCEPTION 'Order is not in pending_payment status or does not belong to your restaurant.';
  END IF;

  -- Log atomically within the same transaction
  PERFORM public.log_staff_activity(
    target_restaurant_id, caller_user_id, 'approve_payment',
    target_order_id,
    jsonb_build_object('order_total', updated_order.total_price, 'payment_method', updated_order.payment_method, 'table_number', updated_order.table_number)
  );

  RETURN updated_order;
END;
$$;

-- ================================================================
-- FIX 4: Update start_order_preparation to log
-- ================================================================
CREATE OR REPLACE FUNCTION public.start_order_preparation(target_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_user_id uuid := auth.uid();
  acting_staff public.restaurant_staff;
  updated_order public.orders;
  target_restaurant_id uuid;
BEGIN
  IF caller_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to start order preparation.';
  END IF;

  SELECT restaurant_id INTO target_restaurant_id FROM public.orders WHERE id = target_order_id;
  IF target_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;

  SELECT * INTO acting_staff
  FROM public.restaurant_staff
  WHERE user_id = caller_user_id AND restaurant_id = target_restaurant_id AND active = true AND role IN ('kitchen','owner')
  LIMIT 1;

  IF acting_staff.id IS NULL THEN
    RAISE EXCEPTION 'Only kitchen staff and owners can start preparation.';
  END IF;

  UPDATE public.orders
  SET status = 'preparing', preparation_started_at = now(), preparation_started_by = acting_staff.id
  WHERE id = target_order_id AND restaurant_id = target_restaurant_id AND status = 'paid'
  RETURNING * INTO updated_order;

  IF updated_order IS NULL THEN
    RAISE EXCEPTION 'Order is not in paid status or does not belong to your restaurant.';
  END IF;

  PERFORM public.log_staff_activity(
    target_restaurant_id, caller_user_id, 'start_preparation', target_order_id,
    jsonb_build_object('table_number', updated_order.table_number)
  );

  RETURN updated_order;
END;
$$;

-- ================================================================
-- FIX 5: Update mark_order_ready to log
-- ================================================================
CREATE OR REPLACE FUNCTION public.mark_order_ready(target_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_user_id uuid := auth.uid();
  acting_staff public.restaurant_staff;
  updated_order public.orders;
  target_restaurant_id uuid;
BEGIN
  IF caller_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to mark an order ready.';
  END IF;

  SELECT restaurant_id INTO target_restaurant_id FROM public.orders WHERE id = target_order_id;
  IF target_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;

  SELECT * INTO acting_staff
  FROM public.restaurant_staff
  WHERE user_id = caller_user_id AND restaurant_id = target_restaurant_id AND active = true AND role IN ('kitchen','owner')
  LIMIT 1;

  IF acting_staff.id IS NULL THEN
    RAISE EXCEPTION 'Only kitchen staff and owners can mark orders ready.';
  END IF;

  UPDATE public.orders
  SET status = 'ready', ready_marked_at = now(), ready_marked_by = acting_staff.id
  WHERE id = target_order_id AND restaurant_id = target_restaurant_id AND status = 'preparing'
  RETURNING * INTO updated_order;

  IF updated_order IS NULL THEN
    RAISE EXCEPTION 'Order is not in preparing status or does not belong to your restaurant.';
  END IF;

  PERFORM public.log_staff_activity(
    target_restaurant_id, caller_user_id, 'mark_ready', target_order_id,
    jsonb_build_object('table_number', updated_order.table_number)
  );

  RETURN updated_order;
END;
$$;

-- ================================================================
-- FIX 6: Rate limiting helper for public QR orders (table-based)
-- ================================================================
CREATE OR REPLACE FUNCTION public.check_order_rate_limit(p_restaurant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count integer;
BEGIN
  -- Max 10 orders per table per 10 minutes (prevents spam)
  SELECT count(*) INTO recent_count
  FROM public.orders
  WHERE restaurant_id = p_restaurant_id
    AND created_at > now() - interval '10 minutes'
    AND order_source = 'public_qr';

  RETURN recent_count < 50; -- restaurant-level rate limit
END;
$$;

-- Grant execute
GRANT EXECUTE ON FUNCTION public.log_staff_activity TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_order_rate_limit TO anon, authenticated;
`;

async function main() {
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();

  console.log("Applying Phase 6 fixes...");

  // Check staff_activity_log columns first
  const cols = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff_activity_log'
    ORDER BY column_name
  `);
  console.log("Current staff_activity_log columns:", cols.rows.map(r => r.column_name).join(", ") || "EMPTY");

  try {
    await client.query("BEGIN");
    await client.query(SQL);
    await client.query("COMMIT");
    console.log("✓ Phase 6 fixes applied successfully");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("✗ Failed:", e.message);
    process.exit(1);
  }

  // Verify
  console.log("\nVerification:");
  const logFn = await client.query(`SELECT proname FROM pg_proc WHERE proname = 'log_staff_activity' AND pronamespace = 'public'::regnamespace`);
  console.log(`  log_staff_activity function: ${logFn.rows.length > 0 ? "✓ Created" : "✗ MISSING"}`);

  const approveCheck = await client.query(`SELECT prosrc FROM pg_proc WHERE proname = 'approve_order_payment' AND pronamespace = 'public'::regnamespace`);
  const hasLog = approveCheck.rows[0]?.prosrc?.includes("log_staff_activity");
  console.log(`  approve_order_payment logs: ${hasLog ? "✓ YES" : "✗ NO"}`);

  const startCheck = await client.query(`SELECT prosrc FROM pg_proc WHERE proname = 'start_order_preparation' AND pronamespace = 'public'::regnamespace`);
  console.log(`  start_order_preparation logs: ${startCheck.rows[0]?.prosrc?.includes("log_staff_activity") ? "✓ YES" : "✗ NO"}`);

  const readyCheck = await client.query(`SELECT prosrc FROM pg_proc WHERE proname = 'mark_order_ready' AND pronamespace = 'public'::regnamespace`);
  console.log(`  mark_order_ready logs: ${readyCheck.rows[0]?.prosrc?.includes("log_staff_activity") ? "✓ YES" : "✗ NO"}`);

  await client.end();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });

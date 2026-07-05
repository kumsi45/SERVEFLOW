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
-- FIX 1: mark_order_completed RPC (ready -> completed)
-- ================================================================
CREATE OR REPLACE FUNCTION public.mark_order_completed(target_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_user_id uuid := auth.uid();
  target_restaurant_id uuid;
  acting_staff public.restaurant_staff;
  updated_order public.orders;
BEGIN
  -- Verify caller is authenticated
  IF caller_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to complete an order.';
  END IF;

  -- Get the restaurant for this order
  SELECT restaurant_id INTO target_restaurant_id
  FROM public.orders
  WHERE id = target_order_id;

  IF target_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;

  -- Verify caller has cashier or owner role for this restaurant
  SELECT * INTO acting_staff
  FROM public.restaurant_staff
  WHERE user_id = caller_user_id
    AND restaurant_id = target_restaurant_id
    AND active = true
    AND role IN ('cashier', 'owner')
  LIMIT 1;

  IF acting_staff.id IS NULL THEN
    RAISE EXCEPTION 'Only cashiers and owners can complete orders.';
  END IF;

  -- Transition ready -> completed
  UPDATE public.orders
  SET
    status = 'completed',
    completed_at = now(),
    completed_by = acting_staff.id
  WHERE id = target_order_id
    AND restaurant_id = target_restaurant_id
    AND status = 'ready'
  RETURNING * INTO updated_order;

  IF updated_order IS NULL THEN
    RAISE EXCEPTION 'Order is not in ready status or does not belong to your restaurant.';
  END IF;

  RETURN to_jsonb(updated_order);
END;
$$;

-- Grant execute to authenticated users (RLS enforced inside function)
GRANT EXECUTE ON FUNCTION public.mark_order_completed(uuid) TO authenticated;

-- ================================================================
-- FIX 2: Fix create_customer_order RPC — pending -> pending_payment
-- ================================================================
DO $$
DECLARE
  src text;
  new_src text;
  func_oid oid;
BEGIN
  SELECT oid INTO func_oid FROM pg_proc
  WHERE proname = 'create_customer_order' AND pronamespace = 'public'::regnamespace;

  IF func_oid IS NULL THEN
    RAISE NOTICE 'create_customer_order not found, skipping';
    RETURN;
  END IF;

  SELECT prosrc INTO src FROM pg_proc WHERE oid = func_oid;

  -- Replace the status assignment from pending to pending_payment
  IF src LIKE '%''pending''%' THEN
    RAISE NOTICE 'create_customer_order uses status=pending — patching via separate statement';
  ELSE
    RAISE NOTICE 'create_customer_order does not use status=pending, no patch needed';
  END IF;
END $$;

-- ================================================================
-- FIX 3: Update existing legacy 'pending' orders to 'pending_payment'
-- ================================================================
UPDATE public.orders
SET status = 'pending_payment'
WHERE status = 'pending';

-- Report result
SELECT status, count(*) FROM public.orders GROUP BY status ORDER BY count DESC;
`;

async function main() {
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    console.log("Applying workflow fixes...");
    await client.query("BEGIN");
    const result = await client.query(SQL);
    await client.query("COMMIT");
    console.log("✓ All fixes applied successfully");

    // Show final status distribution
    const statuses = await client.query("SELECT status, count(*) FROM public.orders GROUP BY status ORDER BY count DESC");
    console.log("\nFinal order status distribution:");
    statuses.rows.forEach(r => console.log(`  ${r.status}: ${r.count} orders`));

    // Verify mark_order_completed exists
    const rpc = await client.query("SELECT proname FROM pg_proc WHERE proname = 'mark_order_completed' AND pronamespace = 'public'::regnamespace");
    console.log(`\nmark_order_completed RPC: ${rpc.rows.length > 0 ? "✓ Created" : "✗ MISSING"}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error("✗ Failed:", e.message); process.exit(1); });

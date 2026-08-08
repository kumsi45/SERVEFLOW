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

// Fix: use restaurant_staff.id (not auth.uid()) for payment_verified_by
// because the FK constraint orders_payment_verified_by_same_restaurant
// references (restaurant_staff.restaurant_id, restaurant_staff.id) — the staff row PK,
// NOT the auth user UUID.
const SQL = `
CREATE OR REPLACE FUNCTION public.approve_order_payment(target_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_user_id uuid := auth.uid();
  caller_staff_id uuid;   -- restaurant_staff.id (PK) — used for FK constraint
  updated_order public.orders;
  target_restaurant_id uuid;
BEGIN
  IF caller_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to approve payment.';
  END IF;

  SELECT restaurant_id INTO target_restaurant_id
  FROM public.orders
  WHERE id = target_order_id;

  IF target_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Order not found for current restaurant.';
  END IF;

  -- Get the staff row ID (PK) — NOT user_id — because the FK uses restaurant_staff.id
  SELECT id INTO caller_staff_id
  FROM public.restaurant_staff
  WHERE user_id = caller_user_id
    AND restaurant_id = target_restaurant_id
    AND active = true
    AND role IN ('cashier', 'owner')
  LIMIT 1;

  IF caller_staff_id IS NULL THEN
    RAISE EXCEPTION 'Only cashiers and owners can approve payments.';
  END IF;

  -- Use caller_staff_id (restaurant_staff.id) for payment_verified_by
  -- This satisfies the composite FK: (restaurant_id, payment_verified_by) -> (restaurant_staff.restaurant_id, restaurant_staff.id)
  UPDATE public.orders
  SET
    status = 'paid',
    payment_verified_at = now(),
    payment_verified_by = caller_staff_id
  WHERE id = target_order_id
    AND restaurant_id = target_restaurant_id
    AND status = 'pending_payment'
  RETURNING * INTO updated_order;

  IF updated_order IS NULL THEN
    RAISE EXCEPTION 'Order is not in pending_payment status or does not belong to your restaurant.';
  END IF;

  -- Log the action (actor_id = auth user UUID for traceability)
  PERFORM public.log_staff_activity(
    target_restaurant_id,
    caller_user_id,
    'approve_payment',
    target_order_id,
    jsonb_build_object(
      'order_total', updated_order.total_price,
      'payment_method', updated_order.payment_method,
      'table_number', updated_order.table_number,
      'staff_row_id', caller_staff_id
    )
  );

  RETURN updated_order;
END;
$$;
`;

async function main() {
  const c = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log("Fixing approve_order_payment FK issue...");
  try {
    await c.query("BEGIN");
    await c.query(SQL);
    await c.query("COMMIT");
    console.log("✓ approve_order_payment fixed — now uses restaurant_staff.id for payment_verified_by");
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("✗ Failed:", e.message);
    process.exit(1);
  }

  // Verify the fix
  const src = await c.query(`SELECT prosrc FROM pg_proc WHERE proname='approve_order_payment' AND pronamespace='public'::regnamespace`);
  const hasFix = src.rows[0]?.prosrc?.includes("caller_staff_id");
  console.log(`  Uses caller_staff_id (restaurant_staff.id): ${hasFix ? "✓ YES" : "✗ NO"}`);

  await c.end();
}
main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });

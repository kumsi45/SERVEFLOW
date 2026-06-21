-- ============================================================
-- Migration 012: Fix order workflow and analytics
-- 1. Fix create_customer_order: pending -> pending_payment
-- 2. Add mark_order_completed RPC
-- 3. Fix existing 'pending' orders -> 'pending_payment'
-- ============================================================

-- ── Fix legacy 'pending' orders to 'pending_payment' ────────
UPDATE public.orders
SET status = 'pending_payment'
WHERE status = 'pending';

-- ── Fix create_customer_order initial status ─────────────────
-- The function body will be replaced to use 'pending_payment'
-- instead of 'pending' as the initial status.
-- We use CREATE OR REPLACE to preserve all other logic.

CREATE OR REPLACE FUNCTION public.create_customer_order(
  target_restaurant_slug text,
  requested_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
  v_user_id uuid;
  v_order_id uuid;
  v_total numeric(12,2) := 0;
  v_item jsonb;
  v_menu_item record;
  v_order record;
BEGIN
  -- Get authenticated user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to place an order.';
  END IF;

  -- Resolve restaurant
  SELECT id INTO v_restaurant_id
  FROM public.restaurants
  WHERE slug = target_restaurant_slug
  LIMIT 1;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Restaurant not found.';
  END IF;

  -- Validate items
  IF requested_items IS NULL OR jsonb_array_length(requested_items) = 0 THEN
    RAISE EXCEPTION 'Order must include at least one item.';
  END IF;

  -- Calculate total
  FOR v_item IN SELECT * FROM jsonb_array_elements(requested_items) LOOP
    SELECT price INTO v_menu_item
    FROM public.menu_items
    WHERE id = (v_item->>'menu_item_id')::uuid
      AND restaurant_id = v_restaurant_id
      AND available = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Menu item not found or unavailable.';
    END IF;

    v_total := v_total + (v_menu_item.price * (v_item->>'quantity')::int);
  END LOOP;

  -- Create order with correct initial status: pending_payment (not pending)
  INSERT INTO public.orders (
    restaurant_id, customer_user_id, status, total_price, order_source
  )
  VALUES (
    v_restaurant_id, v_user_id, 'pending_payment', v_total, 'qr'
  )
  RETURNING * INTO v_order;

  -- Insert order items
  FOR v_item IN SELECT * FROM jsonb_array_elements(requested_items) LOOP
    SELECT price INTO v_menu_item
    FROM public.menu_items
    WHERE id = (v_item->>'menu_item_id')::uuid
      AND restaurant_id = v_restaurant_id;

    INSERT INTO public.order_items (
      restaurant_id, order_id, menu_item_id, quantity, price
    )
    VALUES (
      v_restaurant_id,
      v_order.id,
      (v_item->>'menu_item_id')::uuid,
      (v_item->>'quantity')::int,
      v_menu_item.price
    );
  END LOOP;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'status', v_order.status,
    'total_price', v_order.total_price,
    'created_at', v_order.created_at
  );
END;
$$;

-- ── Add mark_order_completed RPC ─────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_order_completed(
  target_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_restaurant_id uuid;
  v_order record;
  v_role text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  -- Get the order
  SELECT * INTO v_order FROM public.orders WHERE id = target_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;

  v_restaurant_id := v_order.restaurant_id;

  -- Verify caller has cashier or owner role for this restaurant
  SELECT role INTO v_role
  FROM public.restaurant_staff
  WHERE user_id = v_user_id
    AND restaurant_id = v_restaurant_id
    AND active = true
    AND role IN ('cashier', 'owner')
  LIMIT 1;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Only cashiers and owners can complete orders.';
  END IF;

  -- Validate current status
  IF v_order.status != 'ready' THEN
    RAISE EXCEPTION 'Order must be in ready status to mark as completed. Current status: %', v_order.status;
  END IF;

  -- Transition to completed
  UPDATE public.orders
  SET
    status = 'completed',
    completed_at = now(),
    completed_by = v_user_id
  WHERE id = target_order_id;

  SELECT * INTO v_order FROM public.orders WHERE id = target_order_id;

  RETURN to_jsonb(v_order);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.mark_order_completed(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_completed(uuid) TO service_role;

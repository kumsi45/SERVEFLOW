-- Fix: make customer_name optional in create_public_qr_order
-- Removes the "Customer name is required" check

CREATE OR REPLACE FUNCTION public.create_public_qr_order(
  target_restaurant_slug text,
  table_number text,
  customer_name text,
  selected_payment_method text,
  requested_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_restaurant_id uuid;
  created_order public.orders;
  requested_count integer;
  computed_total numeric(12, 2);
  normalized_table_number text;
  normalized_customer_name text;
  normalized_payment_method text;
BEGIN
  normalized_table_number  := nullif(trim(table_number), '');
  normalized_customer_name := nullif(trim(customer_name), '');
  normalized_payment_method := nullif(trim(selected_payment_method), '');

  IF target_restaurant_slug IS NULL OR length(trim(target_restaurant_slug)) = 0 THEN
    RAISE EXCEPTION 'Restaurant slug is required.';
  END IF;

  -- customer_name is intentionally optional — no validation required

  IF normalized_payment_method IS NULL THEN
    RAISE EXCEPTION 'Payment method is required.';
  END IF;

  IF normalized_payment_method NOT IN (
    'Cash','Telebirr','CBE Birr','Mobile Banking','Chapa','Credit/Debit Card'
  ) THEN
    RAISE EXCEPTION 'Payment method is not supported.';
  END IF;

  IF requested_items IS NULL OR jsonb_typeof(requested_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Order items must be an array.';
  END IF;

  requested_count := jsonb_array_length(requested_items);

  IF requested_count < 1 THEN
    RAISE EXCEPTION 'Order must include at least one item.';
  END IF;

  IF requested_count > 50 THEN
    RAISE EXCEPTION 'Order cannot include more than 50 line items.';
  END IF;

  SELECT id INTO target_restaurant_id
  FROM public.restaurants
  WHERE slug = target_restaurant_slug
  LIMIT 1;

  IF target_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Restaurant not found.';
  END IF;

  WITH normalized_items AS (
    SELECT
      CASE
        WHEN line_item ? 'menu_item_id'
          AND (line_item->>'menu_item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (line_item->>'menu_item_id')::uuid
        ELSE NULL
      END AS menu_item_id,
      CASE
        WHEN line_item ? 'quantity'
          AND (line_item->>'quantity') ~ '^[0-9]+$'
        THEN (line_item->>'quantity')::integer
        ELSE NULL
      END AS quantity
    FROM jsonb_array_elements(requested_items) AS line_item
  ),
  invalid_items AS (
    SELECT 1 FROM normalized_items
    WHERE menu_item_id IS NULL
       OR quantity IS NULL
       OR quantity < 1
       OR quantity > 99
  ),
  valid_items AS (
    SELECT ni.menu_item_id, ni.quantity, mi.price
    FROM normalized_items ni
    JOIN public.menu_items mi
      ON mi.id = ni.menu_item_id
     AND mi.restaurant_id = target_restaurant_id
     AND mi.available = true
  )
  SELECT sum(v.price * v.quantity)::numeric(12, 2)
  INTO computed_total
  FROM valid_items v
  WHERE NOT EXISTS (SELECT 1 FROM invalid_items)
    AND (SELECT count(*) FROM valid_items) = requested_count;

  IF computed_total IS NULL THEN
    RAISE EXCEPTION 'Order contains invalid or unavailable menu items.';
  END IF;

  INSERT INTO public.orders (
    restaurant_id,
    customer_user_id,
    status,
    total_price,
    customer_name,
    table_number,
    payment_method,
    order_source
  )
  VALUES (
    target_restaurant_id,
    NULL,
    'pending_payment',
    computed_total,
    normalized_customer_name,
    normalized_table_number,
    normalized_payment_method,
    'public_qr'
  )
  RETURNING * INTO created_order;

  INSERT INTO public.order_items (
    restaurant_id,
    order_id,
    menu_item_id,
    quantity,
    price
  )
  SELECT
    target_restaurant_id,
    created_order.id,
    mi.id,
    ni.quantity,
    mi.price
  FROM (
    SELECT
      (line_item->>'menu_item_id')::uuid AS menu_item_id,
      (line_item->>'quantity')::integer  AS quantity
    FROM jsonb_array_elements(requested_items) AS line_item
  ) ni
  JOIN public.menu_items mi
    ON mi.id = ni.menu_item_id
   AND mi.restaurant_id = target_restaurant_id
   AND mi.available = true;

  RETURN to_jsonb(created_order);
END;
$$;

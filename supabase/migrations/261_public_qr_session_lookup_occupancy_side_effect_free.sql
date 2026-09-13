-- Preparation only: do not deploy without explicit authorization.
-- The orders row is the canonical dining session. Public lookup must never
-- create an empty session or mutate/release a session during menu access.
-- Real QR/Waiter/Cashier ordering retains its existing transactional creation,
-- location locks, unique indexes, invoice authority and release rules.
-- CREATE OR REPLACE retains the existing helper OID and EXECUTE ACL. Do not
-- rename wrappers, add overloads, broaden grants or reconcile historical rows.
do $$
begin
  if to_regprocedure('public.get_public_qr_order_session_p76_base(text,text,text,text)') is null then
    raise exception 'Expected public QR session lookup helper is missing; abort occupancy migration.';
  end if;
end;
$$;

create or replace function public.get_public_qr_order_session_p76_base(
  target_restaurant_slug text,
  table_number text,
  qr_token text,
  browser_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant_id uuid;
  target_table public.restaurant_tables;
  target_qr_token uuid;
  normalized_table_number_text text := nullif(trim(table_number), '');
  normalized_table_number integer;
  normalized_browser_session_token text := public.normalize_browser_session_token(browser_session_token);
  active_order public.orders;
  session_items jsonb := '[]'::jsonb;
  session_invoices jsonb := '[]'::jsonb;
begin
  if target_restaurant_slug is null or length(trim(target_restaurant_slug)) = 0 then
    raise exception 'Restaurant slug is required.';
  end if;
  if normalized_table_number_text is null then
    return null;
  end if;
  if normalized_table_number_text !~ '^[0-9]+$' then
    raise exception 'Table number must be a whole number.';
  end if;
  normalized_table_number := normalized_table_number_text::integer;
  begin
    target_qr_token := trim(qr_token)::uuid;
  exception when invalid_text_representation then
    raise exception 'A valid table QR code is required to view this order.';
  end;

  select restaurants.id into target_restaurant_id
  from public.restaurants restaurants
  where restaurants.slug = target_restaurant_slug
  limit 1;
  if target_restaurant_id is null then
    raise exception 'Restaurant not found.';
  end if;

  select * into target_table
  from public.restaurant_tables tables
  where tables.restaurant_id = target_restaurant_id
    and tables.table_number = normalized_table_number
    and tables.qr_token = target_qr_token
    and tables.active = true
  limit 1;
  if target_table.id is null then
    raise exception 'Invalid or expired table QR code.';
  end if;

  -- Identity is immutable table_id, not a reusable table-number label.
  -- No INSERT/UPDATE, row lock, expiry refresh or scan-triggered release.
  select * into active_order
  from public.orders orders
  where orders.restaurant_id = target_restaurant_id
    and orders.table_id = target_table.id
    and public.is_public_qr_dining_session_open(orders.id)
  order by orders.created_at desc
  limit 1;
  if active_order.id is null then
    return null;
  end if;
  if normalized_browser_session_token is not null
    and active_order.browser_session_token is distinct from normalized_browser_session_token then
    raise exception 'This table currently has an active dining session.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', items.id,
    'invoice_id', items.invoice_id,
    'invoice_status', invoices.status,
    'menu_item_id', menu_items.id,
    'name', menu_items.name,
    'quantity', items.quantity,
    'unit_price', items.price,
    'line_total', (items.price * items.quantity)::numeric(12, 2),
    'kitchen_status', items.kitchen_status,
    'appended_at', items.appended_at,
    'created_at', items.created_at
  ) order by items.created_at, items.id), '[]'::jsonb)
  into session_items
  from public.order_items items
  join public.order_invoices invoices
    on invoices.restaurant_id = items.restaurant_id and invoices.id = items.invoice_id
  join public.menu_items menu_items
    on menu_items.restaurant_id = items.restaurant_id and menu_items.id = items.menu_item_id
  where items.restaurant_id = active_order.restaurant_id and items.order_id = active_order.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', invoices.id,
    'invoice_number', invoices.invoice_number,
    'status', invoices.status,
    'total_price', invoices.total_price,
    'payment_method', coalesce(public.normalize_payment_method(invoices.payment_method), public.normalize_payment_method(active_order.payment_method)),
    'paid_at', invoices.paid_at,
    'locked_at', invoices.locked_at,
    'created_at', invoices.created_at
  ) order by invoices.invoice_number), '[]'::jsonb)
  into session_invoices
  from public.order_invoices invoices
  where invoices.restaurant_id = active_order.restaurant_id and invoices.order_id = active_order.id;

  return jsonb_build_object(
    'order_id', active_order.id,
    'status', active_order.status,
    'dining_session_status', active_order.dining_session_status,
    'dining_session_expires_at', active_order.dining_session_expires_at,
    'total_price', active_order.total_price,
    'table_number', active_order.table_number,
    'customer_name', active_order.customer_name,
    'payment_method', active_order.payment_method,
    'created_at', active_order.created_at,
    'payment_verified_at', active_order.payment_verified_at,
    'items', session_items,
    'invoices', session_invoices
  );
end;
$$;

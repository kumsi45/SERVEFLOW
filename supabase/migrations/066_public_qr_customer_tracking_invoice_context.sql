-- Phase 5 customer tracking hardening:
-- expose invoice context to the public QR session so later additions track their
-- own payment batch instead of inheriting an older parent order status.

create or replace function public.get_public_qr_order_session(
  target_restaurant_slug text,
  table_number text,
  qr_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant_id uuid;
  target_qr_token uuid;
  normalized_table_number_text text;
  normalized_table_number integer;
  active_order public.orders;
  session_items jsonb := '[]'::jsonb;
  session_invoices jsonb := '[]'::jsonb;
  active_invoice jsonb := null;
begin
  normalized_table_number_text := nullif(trim(table_number), '');

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

  if qr_token is null or length(trim(qr_token)) = 0 then
    return null;
  end if;

  begin
    target_qr_token := trim(qr_token)::uuid;
  exception when invalid_text_representation then
    raise exception 'A valid table QR code is required to view this order.';
  end;

  select r.id
  into target_restaurant_id
  from public.restaurants r
  where r.slug = target_restaurant_slug
  limit 1;

  if target_restaurant_id is null then
    raise exception 'Restaurant not found.';
  end if;

  if not exists (
    select 1
    from public.restaurant_tables rt
    where rt.restaurant_id = target_restaurant_id
      and rt.table_number = normalized_table_number
      and rt.qr_token = target_qr_token
      and rt.active = true
  ) then
    raise exception 'Invalid or expired table QR code.';
  end if;

  select *
  into active_order
  from public.orders orders
  where orders.restaurant_id = target_restaurant_id
    and orders.table_number = normalized_table_number::text
    and public.is_public_qr_dining_session_open(orders.id)
  order by orders.created_at desc
  limit 1;

  if active_order.id is null then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
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
      )
      order by items.created_at, items.id
    ),
    '[]'::jsonb
  )
  into session_items
  from public.order_items items
  join public.order_invoices invoices
    on invoices.restaurant_id = items.restaurant_id
   and invoices.id = items.invoice_id
  join public.menu_items menu_items
    on menu_items.restaurant_id = items.restaurant_id
   and menu_items.id = items.menu_item_id
  where items.restaurant_id = active_order.restaurant_id
    and items.order_id = active_order.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', invoices.id,
        'invoice_number', invoices.invoice_number,
        'status', invoices.status,
        'total_price', invoices.total_price,
        'payment_method', invoices.payment_method,
        'paid_at', invoices.paid_at,
        'locked_at', invoices.locked_at,
        'created_at', invoices.created_at
      )
      order by invoices.invoice_number
    ),
    '[]'::jsonb
  )
  into session_invoices
  from public.order_invoices invoices
  where invoices.restaurant_id = active_order.restaurant_id
    and invoices.order_id = active_order.id;

  select jsonb_build_object(
    'id', invoices.id,
    'invoice_number', invoices.invoice_number,
    'status', invoices.status,
    'total_price', invoices.total_price,
    'payment_method', invoices.payment_method,
    'paid_at', invoices.paid_at,
    'locked_at', invoices.locked_at,
    'created_at', invoices.created_at
  )
  into active_invoice
  from public.order_invoices invoices
  where invoices.restaurant_id = active_order.restaurant_id
    and invoices.order_id = active_order.id
  order by invoices.invoice_number desc
  limit 1;

  return jsonb_build_object(
    'order_id', active_order.id,
    'status', active_order.status,
    'total_price', active_order.total_price,
    'table_number', active_order.table_number,
    'customer_name', active_order.customer_name,
    'payment_method', active_order.payment_method,
    'created_at', active_order.created_at,
    'payment_verified_at', active_order.payment_verified_at,
    'items', session_items,
    'invoices', session_invoices,
    'active_invoice', active_invoice
  );
end;
$$;

revoke all on function public.get_public_qr_order_session(text, text, text) from public;
grant execute on function public.get_public_qr_order_session(text, text, text) to anon;
grant execute on function public.get_public_qr_order_session(text, text, text) to authenticated;

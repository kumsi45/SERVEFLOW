-- SERVEFLOW Phase 4E.1 Dining Session Lifecycle Hardening.
-- A table QR is reusable; the public dining session is only the current open
-- business workflow for that table.

create or replace function public.is_public_qr_dining_session_closed(target_order_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_order public.orders;
begin
  if target_order_id is null then
    return false;
  end if;

  select *
  into target_order
  from public.orders
  where id = target_order_id;

  if target_order.id is null then
    return false;
  end if;

  return (
    target_order.status::text = 'completed'
    and target_order.completed_at is not null
    and target_order.payment_verified_at is not null
    and exists (
      select 1
      from public.order_invoices invoices
      where invoices.restaurant_id = target_order.restaurant_id
        and invoices.order_id = target_order.id
    )
    and not exists (
      select 1
      from public.order_invoices invoices
      where invoices.restaurant_id = target_order.restaurant_id
        and invoices.order_id = target_order.id
        and (
          invoices.status <> 'paid'
          or invoices.paid_at is null
          or invoices.locked_at is null
        )
    )
    and exists (
      select 1
      from public.order_items items
      where items.restaurant_id = target_order.restaurant_id
        and items.order_id = target_order.id
    )
    and not exists (
      select 1
      from public.order_items items
      where items.restaurant_id = target_order.restaurant_id
        and items.order_id = target_order.id
        and items.kitchen_status <> 'completed'
    )
    and not exists (
      select 1
      from public.kitchen_order_station_progress progress
      where progress.restaurant_id = target_order.restaurant_id
        and progress.order_id = target_order.id
        and progress.station_status <> 'completed'
    )
  );
end;
$$;

create or replace function public.is_public_qr_dining_session_open(target_order_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_status text;
begin
  if target_order_id is null then
    return false;
  end if;

  select status::text
  into target_status
  from public.orders
  where id = target_order_id;

  return coalesce(
    target_status in ('pending_payment', 'paid', 'preparing', 'ready')
    and not public.is_public_qr_dining_session_closed(target_order_id),
    false
  );
end;
$$;

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
    'invoices', session_invoices
  );
end;
$$;

create or replace function public.create_public_qr_order(
  target_restaurant_slug text,
  table_number text,
  qr_token text,
  customer_name text,
  selected_payment_method text,
  requested_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant_id uuid;
  target_total_tables integer;
  target_qr_token uuid;
  active_order public.orders;
  updated_order public.orders;
  latest_invoice public.order_invoices;
  current_invoice public.order_invoices;
  next_invoice_number integer;
  requested_count integer;
  computed_total numeric(12, 2);
  normalized_table_number_text text;
  normalized_table_number integer;
  normalized_customer_name text;
  normalized_payment_method text;
  added_at timestamptz := now();
  added_items jsonb := '[]'::jsonb;
begin
  normalized_table_number_text := nullif(trim(table_number), '');
  normalized_customer_name := nullif(trim(customer_name), '');
  normalized_payment_method := nullif(trim(selected_payment_method), '');

  if target_restaurant_slug is null or length(trim(target_restaurant_slug)) = 0 then
    raise exception 'Restaurant slug is required.';
  end if;

  if normalized_table_number_text is null then
    raise exception 'Table number is required to place your order.';
  end if;

  if normalized_table_number_text !~ '^[0-9]+$' then
    raise exception 'Table number must be a whole number.';
  end if;

  normalized_table_number := normalized_table_number_text::integer;

  if qr_token is null or length(trim(qr_token)) = 0 then
    raise exception 'A valid table QR code is required to place this order.';
  end if;

  begin
    target_qr_token := trim(qr_token)::uuid;
  exception when invalid_text_representation then
    raise exception 'A valid table QR code is required to place this order.';
  end;

  if normalized_payment_method is null then
    raise exception 'Payment method is required.';
  end if;

  if normalized_payment_method not in ('Cash', 'Telebirr', 'CBE Birr', 'Mobile Banking', 'Chapa', 'Credit/Debit Card') then
    raise exception 'Payment method is not supported.';
  end if;

  select r.id, r.total_tables
  into target_restaurant_id, target_total_tables
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

  if requested_items is null or jsonb_typeof(requested_items) is distinct from 'array' then
    raise exception 'Order items must be an array.';
  end if;

  requested_count := jsonb_array_length(requested_items);
  if requested_count < 1 then raise exception 'Order must include at least one item.'; end if;
  if requested_count > 50 then raise exception 'Order cannot include more than 50 line items.'; end if;

  with normalized_items as (
    select
      case when line_item ? 'menu_item_id'
        and (line_item->>'menu_item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (line_item->>'menu_item_id')::uuid else null end as menu_item_id,
      case when line_item ? 'quantity' and (line_item->>'quantity') ~ '^[0-9]+$'
        then (line_item->>'quantity')::integer else null end as quantity
    from jsonb_array_elements(requested_items) as line_item
  ),
  invalid_items as (
    select 1 from normalized_items
    where menu_item_id is null or quantity is null or quantity < 1 or quantity > 99
  ),
  valid_items as (
    select normalized_items.menu_item_id, normalized_items.quantity, menu_items.price
    from normalized_items
    join public.menu_items
      on menu_items.id = normalized_items.menu_item_id
     and menu_items.restaurant_id = target_restaurant_id
     and menu_items.available = true
  )
  select sum(valid_items.price * valid_items.quantity)::numeric(12, 2)
  into computed_total
  from valid_items
  where not exists (select 1 from invalid_items)
    and (select count(*) from valid_items) = requested_count;

  if computed_total is null then
    raise exception 'Order contains invalid or unavailable menu items.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_restaurant_id::text || ':' || normalized_table_number::text, 0));

  select *
  into active_order
  from public.orders orders
  where orders.restaurant_id = target_restaurant_id
    and orders.table_number = normalized_table_number::text
    and public.is_public_qr_dining_session_open(orders.id)
  order by orders.created_at desc
  limit 1
  for update;

  if active_order.id is null then
    insert into public.orders (restaurant_id, customer_user_id, status, total_price, customer_name, table_number, payment_method, order_source)
    values (target_restaurant_id, null, 'pending_payment', computed_total, normalized_customer_name, normalized_table_number::text, normalized_payment_method, 'public_qr')
    returning * into updated_order;

    insert into public.order_invoices (restaurant_id, order_id, invoice_number, status, total_price, payment_method, created_at, updated_at)
    values (target_restaurant_id, updated_order.id, 1, 'pending', computed_total, normalized_payment_method, added_at, added_at)
    returning * into current_invoice;
  else
    select *
    into latest_invoice
    from public.order_invoices invoices
    where invoices.restaurant_id = active_order.restaurant_id
      and invoices.order_id = active_order.id
    order by invoices.invoice_number desc
    limit 1
    for update;

    if latest_invoice.id is null or latest_invoice.status = 'paid' then
      select coalesce(max(invoice_number), 0) + 1
      into next_invoice_number
      from public.order_invoices invoices
      where invoices.restaurant_id = active_order.restaurant_id
        and invoices.order_id = active_order.id;

      insert into public.order_invoices (restaurant_id, order_id, invoice_number, status, total_price, payment_method, created_at, updated_at)
      values (active_order.restaurant_id, active_order.id, next_invoice_number, 'pending', computed_total, normalized_payment_method, added_at, added_at)
      returning * into current_invoice;
    else
      update public.order_invoices
      set
        total_price = (latest_invoice.total_price + computed_total)::numeric(12, 2),
        payment_method = coalesce(latest_invoice.payment_method, normalized_payment_method),
        updated_at = added_at
      where id = latest_invoice.id
        and restaurant_id = latest_invoice.restaurant_id
        and status = 'pending'
      returning * into current_invoice;
    end if;

    update public.orders
    set
      total_price = (active_order.total_price + computed_total)::numeric(12, 2),
      customer_name = coalesce(active_order.customer_name, normalized_customer_name),
      payment_method = coalesce(active_order.payment_method, normalized_payment_method),
      updated_at = added_at
    where id = active_order.id
      and restaurant_id = active_order.restaurant_id
    returning * into updated_order;
  end if;

  insert into public.order_items (restaurant_id, order_id, invoice_id, menu_item_id, quantity, price, appended_at, kitchen_status)
  select
    target_restaurant_id,
    updated_order.id,
    current_invoice.id,
    menu_items.id,
    normalized_items.quantity,
    menu_items.price,
    case when active_order.id is null then null else added_at end,
    'held'
  from (
    select (line_item->>'menu_item_id')::uuid as menu_item_id, (line_item->>'quantity')::integer as quantity
    from jsonb_array_elements(requested_items) as line_item
  ) normalized_items
  join public.menu_items
    on menu_items.id = normalized_items.menu_item_id
   and menu_items.restaurant_id = target_restaurant_id
   and menu_items.available = true;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'menu_item_id', menu_items.id,
        'name', menu_items.name,
        'quantity', appended.quantity,
        'unit_price', menu_items.price,
        'line_total', (menu_items.price * appended.quantity)::numeric(12, 2)
      )
      order by menu_items.name
    ),
    '[]'::jsonb
  )
  into added_items
  from (
    select (line_item->>'menu_item_id')::uuid as menu_item_id, (line_item->>'quantity')::integer as quantity
    from jsonb_array_elements(requested_items) as line_item
  ) appended
  join public.menu_items
    on menu_items.id = appended.menu_item_id
   and menu_items.restaurant_id = target_restaurant_id;

  return jsonb_build_object(
    'order_id', updated_order.id,
    'invoice_id', current_invoice.id,
    'invoice_number', current_invoice.invoice_number,
    'invoice_status', current_invoice.status,
    'status', updated_order.status,
    'total_price', updated_order.total_price,
    'invoice_total', current_invoice.total_price,
    'table_number', updated_order.table_number,
    'customer_name', updated_order.customer_name,
    'payment_method', current_invoice.payment_method,
    'created_at', updated_order.created_at,
    'session_action', case when active_order.id is null then 'created' else 'appended' end,
    'appended_at', case when active_order.id is null then null else added_at end,
    'added_total', computed_total,
    'items_added', added_items
  );
end;
$$;

revoke all on function public.is_public_qr_dining_session_closed(uuid) from public, anon, authenticated;
revoke all on function public.is_public_qr_dining_session_open(uuid) from public, anon, authenticated;
grant execute on function public.is_public_qr_dining_session_closed(uuid) to service_role;
grant execute on function public.is_public_qr_dining_session_open(uuid) to service_role;

revoke all on function public.get_public_qr_order_session(text, text, text) from public;
grant execute on function public.get_public_qr_order_session(text, text, text) to anon;
grant execute on function public.get_public_qr_order_session(text, text, text) to authenticated;

revoke all on function public.create_public_qr_order(text, text, text, text, text, jsonb) from public;
grant execute on function public.create_public_qr_order(text, text, text, text, text, jsonb) to anon;
grant execute on function public.create_public_qr_order(text, text, text, text, text, jsonb) to authenticated;

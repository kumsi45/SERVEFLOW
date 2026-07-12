-- ServeFlow Phase P7.5: final dining-session lifecycle hardening.
-- Dining session occupancy is authoritative on orders.dining_session_status.
-- Public QR continuation is tied to a browser session token and no network
-- or device-derived identifier.

alter table public.orders
  add column if not exists browser_session_token text,
  add column if not exists dining_session_last_activity_at timestamptz,
  add column if not exists dining_session_qr_scan_at timestamptz;

update public.orders
set dining_session_last_activity_at = coalesce(dining_session_last_activity_at, updated_at, created_at, now())
where dining_session_last_activity_at is null;

create index if not exists orders_open_dining_session_browser_idx
on public.orders (restaurant_id, table_number, browser_session_token)
where dining_session_status = 'open' and browser_session_token is not null;

create index if not exists orders_open_dining_session_activity_idx
on public.orders (restaurant_id, table_number, dining_session_last_activity_at)
where dining_session_status = 'open';

create or replace function public.normalize_browser_session_token(browser_session_token text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(left(regexp_replace(trim(coalesce(browser_session_token, '')), '[^a-zA-Z0-9:_-]', '', 'g'), 120), '')
$$;

create or replace function public.is_dining_session_auto_releasable(target_order_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_order public.orders;
  inactivity_deadline timestamptz;
begin
  if target_order_id is null then
    return false;
  end if;

  select *
  into target_order
  from public.orders
  where id = target_order_id;

  if target_order.id is null or target_order.dining_session_status <> 'open' or target_order.table_released_at is not null then
    return false;
  end if;

  inactivity_deadline := coalesce(
    target_order.dining_session_expires_at,
    coalesce(target_order.dining_session_last_activity_at, target_order.updated_at, target_order.created_at) + public.get_dining_session_timeout(target_order.restaurant_id)
  );

  if inactivity_deadline >= now() then
    return false;
  end if;

  if exists (
    select 1
    from public.order_invoices invoices
    where invoices.restaurant_id = target_order.restaurant_id
      and invoices.order_id = target_order.id
      and invoices.status in ('pending', 'paid', 'rejected')
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.order_invoices invoices
    where invoices.restaurant_id = target_order.restaurant_id
      and invoices.order_id = target_order.id
      and invoices.status not in ('verified', 'cancelled', 'refunded')
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.order_items items
    where items.restaurant_id = target_order.restaurant_id
      and items.order_id = target_order.id
      and items.kitchen_status <> 'completed'
  ) then
    return false;
  end if;

  return true;
end;
$$;

create or replace function public.auto_release_dining_session_for_new_browser_scan(target_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders;
  updated_order public.orders;
begin
  select *
  into target_order
  from public.orders
  where id = target_order_id
  for update;

  if target_order.id is null then
    raise exception 'Dining session not found.';
  end if;

  if not public.is_dining_session_auto_releasable(target_order.id) then
    raise exception 'This table currently has an active dining session.';
  end if;

  update public.orders
  set
    dining_session_status = 'closed',
    dining_session_closed_at = now(),
    dining_session_close_reason = 'auto_released_for_new_browser_scan',
    table_released_at = now(),
    status = case when orders.status::text = 'cancelled' then orders.status else 'completed'::public.order_status end,
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
  where id = target_order.id
    and restaurant_id = target_order.restaurant_id
  returning * into updated_order;

  return updated_order;
end;
$$;

create or replace function public.get_public_qr_order_session(
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
  normalized_table_number_text text;
  normalized_table_number integer;
  normalized_browser_session_token text := public.normalize_browser_session_token(browser_session_token);
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

  begin
    target_qr_token := trim(qr_token)::uuid;
  exception when invalid_text_representation then
    raise exception 'A valid table QR code is required to view this order.';
  end;

  select restaurants.id
  into target_restaurant_id
  from public.restaurants restaurants
  where restaurants.slug = target_restaurant_slug
  limit 1;

  if target_restaurant_id is null then
    raise exception 'Restaurant not found.';
  end if;

  perform public.expire_stale_dining_sessions(target_restaurant_id);

  select *
  into target_table
  from public.restaurant_tables tables
  where tables.restaurant_id = target_restaurant_id
    and tables.table_number = normalized_table_number
    and tables.qr_token = target_qr_token
    and tables.active = true
  limit 1;

  if target_table.id is null then
    raise exception 'Invalid or expired table QR code.';
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

  if active_order.id is not null
     and normalized_browser_session_token is not null
     and active_order.browser_session_token is distinct from normalized_browser_session_token then
    if public.is_dining_session_auto_releasable(active_order.id) then
      perform public.auto_release_dining_session_for_new_browser_scan(active_order.id);
      active_order := null;
    else
      raise exception 'This table currently has an active dining session.';
    end if;
  end if;

  if active_order.id is null then
    insert into public.orders (
      restaurant_id, customer_user_id, status, total_price, customer_name,
      table_id, table_number, payment_method, order_source,
      dining_session_status, dining_session_opened_at, dining_session_expires_at,
      browser_session_token, dining_session_qr_scan_at, dining_session_last_activity_at
    )
    values (
      target_restaurant_id, null, 'pending', 0, null,
      target_table.id, normalized_table_number::text, 'Cash', 'public_qr',
      'open', now(), now() + public.get_dining_session_timeout(target_restaurant_id),
      normalized_browser_session_token, now(), now()
    )
    returning * into active_order;
  else
    update public.orders
    set
      browser_session_token = coalesce(orders.browser_session_token, normalized_browser_session_token),
      dining_session_qr_scan_at = now(),
      dining_session_last_activity_at = now(),
      dining_session_expires_at = now() + public.get_dining_session_timeout(target_restaurant_id),
      updated_at = now()
    where orders.id = active_order.id
      and orders.restaurant_id = active_order.restaurant_id
    returning * into active_order;
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
        'payment_method', coalesce(public.normalize_payment_method(invoices.payment_method), public.normalize_payment_method(active_order.payment_method)),
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

create or replace function public.get_public_qr_order_session(
  target_restaurant_slug text,
  table_number text,
  qr_token text
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.get_public_qr_order_session(target_restaurant_slug, table_number, qr_token, null::text)
$$;

create or replace function public.create_public_qr_order(
  target_restaurant_slug text,
  table_number text,
  qr_token text,
  browser_session_token text,
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
  target_table public.restaurant_tables;
  target_qr_token uuid;
  active_order public.orders;
  updated_order public.orders;
  current_invoice public.order_invoices;
  next_invoice_number integer;
  requested_count integer;
  computed_total numeric(12, 2);
  normalized_table_number_text text;
  normalized_table_number integer;
  normalized_customer_name text;
  normalized_payment_method text;
  normalized_browser_session_token text := public.normalize_browser_session_token(browser_session_token);
  added_at timestamptz := now();
  added_items jsonb := '[]'::jsonb;
begin
  normalized_table_number_text := nullif(trim(table_number), '');
  normalized_customer_name := nullif(trim(customer_name), '');
  normalized_payment_method := public.normalize_payment_method(selected_payment_method);

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

  begin
    target_qr_token := trim(qr_token)::uuid;
  exception when invalid_text_representation then
    raise exception 'A valid table QR code is required to place this order.';
  end;

  if normalized_payment_method is null or not public.payment_method_is_supported(normalized_payment_method) then
    raise exception 'Payment method is not supported.';
  end if;

  select restaurants.id
  into target_restaurant_id
  from public.restaurants restaurants
  where restaurants.slug = target_restaurant_slug
  limit 1;

  if target_restaurant_id is null then
    raise exception 'Restaurant not found.';
  end if;

  perform public.expire_stale_dining_sessions(target_restaurant_id);

  select *
  into target_table
  from public.restaurant_tables tables
  where tables.restaurant_id = target_restaurant_id
    and tables.table_number = normalized_table_number
    and tables.qr_token = target_qr_token
    and tables.active = true
  limit 1;

  if target_table.id is null then
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

  if active_order.id is not null
     and normalized_browser_session_token is not null
     and active_order.browser_session_token is distinct from normalized_browser_session_token then
    if public.is_dining_session_auto_releasable(active_order.id) then
      perform public.auto_release_dining_session_for_new_browser_scan(active_order.id);
      active_order := null;
    else
      raise exception 'This table currently has an active dining session.';
    end if;
  end if;

  if active_order.id is null then
    insert into public.orders (
      restaurant_id, customer_user_id, status, total_price, customer_name,
      table_id, table_number, payment_method, order_source,
      dining_session_status, dining_session_opened_at, dining_session_expires_at,
      browser_session_token, dining_session_qr_scan_at, dining_session_last_activity_at
    )
    values (
      target_restaurant_id, null, 'pending_payment', computed_total, normalized_customer_name,
      target_table.id, normalized_table_number::text, normalized_payment_method, 'public_qr',
      'open', added_at, added_at + public.get_dining_session_timeout(target_restaurant_id),
      normalized_browser_session_token, added_at, added_at
    )
    returning * into updated_order;

    next_invoice_number := 1;
  else
    update public.orders
    set
      total_price = (active_order.total_price + computed_total)::numeric(12, 2),
      customer_name = coalesce(active_order.customer_name, normalized_customer_name),
      payment_method = coalesce(public.normalize_payment_method(active_order.payment_method), normalized_payment_method),
      table_id = coalesce(active_order.table_id, target_table.id),
      status = 'pending_payment'::public.order_status,
      browser_session_token = coalesce(active_order.browser_session_token, normalized_browser_session_token),
      dining_session_last_activity_at = added_at,
      dining_session_expires_at = added_at + public.get_dining_session_timeout(target_restaurant_id),
      updated_at = added_at
    where id = active_order.id
      and restaurant_id = active_order.restaurant_id
    returning * into updated_order;

    select coalesce(max(invoice_number), 0) + 1
    into next_invoice_number
    from public.order_invoices invoices
    where invoices.restaurant_id = active_order.restaurant_id
      and invoices.order_id = active_order.id;
  end if;

  insert into public.order_invoices (restaurant_id, order_id, invoice_number, status, total_price, payment_method, created_at, updated_at)
  values (target_restaurant_id, updated_order.id, next_invoice_number, 'pending', computed_total, normalized_payment_method, added_at, added_at)
  returning * into current_invoice;

  insert into public.order_items (restaurant_id, order_id, invoice_id, menu_item_id, quantity, price, appended_at, kitchen_status)
  select
    target_restaurant_id,
    updated_order.id,
    current_invoice.id,
    menu_items.id,
    normalized_items.quantity,
    menu_items.price,
    case when next_invoice_number = 1 and active_order.id is null then null else added_at end,
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
    'dining_session_status', updated_order.dining_session_status,
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

create or replace function public.create_public_qr_order(
  target_restaurant_slug text,
  table_number text,
  qr_token text,
  customer_name text,
  selected_payment_method text,
  requested_items jsonb
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.create_public_qr_order(
    target_restaurant_slug,
    table_number,
    qr_token,
    null::text,
    customer_name,
    selected_payment_method,
    requested_items
  )
$$;

revoke all on function public.normalize_browser_session_token(text) from public, anon, authenticated;
revoke all on function public.is_dining_session_auto_releasable(uuid) from public, anon, authenticated;
revoke all on function public.auto_release_dining_session_for_new_browser_scan(uuid) from public, anon, authenticated;
revoke all on function public.get_public_qr_order_session(text, text, text, text) from public;
revoke all on function public.create_public_qr_order(text, text, text, text, text, text, jsonb) from public;

grant execute on function public.normalize_browser_session_token(text) to anon, authenticated, service_role;
grant execute on function public.is_dining_session_auto_releasable(uuid) to service_role;
grant execute on function public.auto_release_dining_session_for_new_browser_scan(uuid) to service_role;
grant execute on function public.get_public_qr_order_session(text, text, text, text) to anon, authenticated;
grant execute on function public.create_public_qr_order(text, text, text, text, text, text, jsonb) to anon, authenticated;

-- ServeFlow Phase P7: production dining-session finalization.
-- A dining session is the table visit. Invoices are independent payment
-- batches inside that visit; order_items belong to exactly one batch.

alter table public.orders
  add column if not exists dining_session_status text not null default 'open',
  add column if not exists dining_session_opened_at timestamptz not null default now(),
  add column if not exists dining_session_closed_at timestamptz,
  add column if not exists dining_session_expires_at timestamptz,
  add column if not exists dining_session_close_reason text,
  add column if not exists table_released_at timestamptz;

alter table public.orders
  drop constraint if exists orders_dining_session_status_allowed,
  add constraint orders_dining_session_status_allowed
    check (dining_session_status in ('open', 'closed', 'abandoned', 'expired', 'checked_out'));

update public.orders
set
  dining_session_opened_at = coalesce(dining_session_opened_at, created_at, now()),
  dining_session_expires_at = coalesce(dining_session_expires_at, created_at + interval '4 hours', now() + interval '4 hours'),
  dining_session_status = case
    when dining_session_status <> 'open' then dining_session_status
    when status::text = 'cancelled' then 'abandoned'
    else dining_session_status
  end,
  dining_session_closed_at = case
    when dining_session_status in ('closed', 'abandoned', 'expired', 'checked_out') then coalesce(dining_session_closed_at, completed_at, updated_at, now())
    else dining_session_closed_at
  end,
  table_released_at = case
    when dining_session_status in ('closed', 'abandoned', 'expired') then coalesce(table_released_at, dining_session_closed_at, completed_at, updated_at, now())
    else table_released_at
  end;

create index if not exists orders_open_dining_session_table_idx
on public.orders (restaurant_id, table_number, created_at desc)
where dining_session_status = 'open';

create index if not exists orders_dining_session_expiry_idx
on public.orders (restaurant_id, dining_session_expires_at)
where dining_session_status = 'open';

create or replace function public.get_dining_session_timeout(target_restaurant_id uuid)
returns interval
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  timeout_minutes integer;
begin
  select least(
    1440,
    greatest(
      15,
      coalesce(nullif(restaurants.security_settings->>'dining_session_timeout_minutes', '')::integer, 240)
    )
  )
  into timeout_minutes
  from public.restaurants restaurants
  where restaurants.id = target_restaurant_id;

  return make_interval(mins => coalesce(timeout_minutes, 240));
exception when invalid_text_representation then
  return interval '4 hours';
end;
$$;

create or replace function public.expire_stale_dining_sessions(target_restaurant_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_count integer := 0;
begin
  with expirable_sessions as (
    select orders.id, orders.restaurant_id
    from public.orders orders
    where orders.dining_session_status = 'open'
      and orders.dining_session_expires_at is not null
      and orders.dining_session_expires_at < now()
      and (target_restaurant_id is null or orders.restaurant_id = target_restaurant_id)
      and not exists (
        select 1
        from public.order_invoices invoices
        where invoices.restaurant_id = orders.restaurant_id
          and invoices.order_id = orders.id
          and invoices.status in ('paid', 'verified')
      )
      and not exists (
        select 1
        from public.order_items items
        where items.restaurant_id = orders.restaurant_id
          and items.order_id = orders.id
          and items.kitchen_status <> 'held'
      )
    for update
  ),
  cancelled_invoices as (
    update public.order_invoices invoices
    set status = 'cancelled', updated_at = now()
    from expirable_sessions sessions
    where invoices.restaurant_id = sessions.restaurant_id
      and invoices.order_id = sessions.id
      and invoices.status in ('pending', 'rejected')
    returning invoices.id
  ),
  expired_orders as (
    update public.orders orders
    set
      dining_session_status = 'expired',
      dining_session_closed_at = now(),
      dining_session_close_reason = 'timeout',
      table_released_at = now(),
      status = case when orders.status::text in ('pending', 'pending_payment') then 'cancelled'::public.order_status else orders.status end,
      updated_at = now()
    from expirable_sessions sessions
    where orders.restaurant_id = sessions.restaurant_id
      and orders.id = sessions.id
    returning orders.id
  )
  select count(*) into expired_count from expired_orders;

  return expired_count;
end;
$$;

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

  return coalesce(target_order.dining_session_status in ('closed', 'abandoned', 'expired', 'checked_out'), false);
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

  return coalesce(
    target_order.dining_session_status = 'open'
    and coalesce(target_order.dining_session_expires_at, now() + interval '1 minute') >= now()
    and target_order.table_released_at is null
    and target_order.status::text <> 'cancelled',
    false
  );
end;
$$;

create or replace function public.close_dining_session(
  target_order_id uuid,
  close_reason text default 'customer_left'
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders;
  updated_order public.orders;
begin
  if target_order_id is null then
    raise exception 'Dining session is required.';
  end if;

  select *
  into target_order
  from public.orders
  where id = target_order_id
  for update;

  if target_order.id is null then
    raise exception 'Dining session not found.';
  end if;

  if target_order.dining_session_status <> 'open' then
    return target_order;
  end if;

  if exists (
    select 1
    from public.order_invoices invoices
    where invoices.restaurant_id = target_order.restaurant_id
      and invoices.order_id = target_order.id
      and invoices.status in ('pending', 'paid', 'rejected')
  ) then
    raise exception 'Dining session cannot close while payment batches are pending verification.';
  end if;

  if exists (
    select 1
    from public.order_invoices invoices
    where invoices.restaurant_id = target_order.restaurant_id
      and invoices.order_id = target_order.id
      and invoices.status not in ('verified', 'cancelled', 'refunded')
  ) then
    raise exception 'Dining session cannot close until all payment batches are verified or cancelled.';
  end if;

  if exists (
    select 1
    from public.order_items items
    where items.restaurant_id = target_order.restaurant_id
      and items.order_id = target_order.id
      and items.kitchen_status <> 'completed'
  ) then
    raise exception 'Dining session cannot close until kitchen has completed all items.';
  end if;

  update public.orders
  set
    dining_session_status = 'closed',
    dining_session_closed_at = now(),
    dining_session_close_reason = coalesce(nullif(left(trim(close_reason), 80), ''), 'customer_left'),
    table_released_at = now(),
    status = 'completed'::public.order_status,
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
  where id = target_order.id
    and restaurant_id = target_order.restaurant_id
  returning * into updated_order;

  return updated_order;
end;
$$;

create or replace function public.close_public_qr_dining_session(
  target_restaurant_slug text,
  table_number text,
  qr_token text,
  target_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant_id uuid;
  target_qr_token uuid;
  normalized_table_number integer;
  updated_order public.orders;
begin
  if target_restaurant_slug is null or length(trim(target_restaurant_slug)) = 0 then
    raise exception 'Restaurant slug is required.';
  end if;

  if nullif(trim(table_number), '') is null or trim(table_number) !~ '^[0-9]+$' then
    raise exception 'Table number must be a whole number.';
  end if;

  normalized_table_number := trim(table_number)::integer;

  begin
    target_qr_token := trim(qr_token)::uuid;
  exception when invalid_text_representation then
    raise exception 'A valid table QR code is required to close this session.';
  end;

  select restaurants.id
  into target_restaurant_id
  from public.restaurants restaurants
  where restaurants.slug = trim(target_restaurant_slug)
  limit 1;

  if target_restaurant_id is null then
    raise exception 'Restaurant not found.';
  end if;

  if not exists (
    select 1
    from public.restaurant_tables tables
    where tables.restaurant_id = target_restaurant_id
      and tables.table_number = normalized_table_number
      and tables.qr_token = target_qr_token
      and tables.active = true
  ) then
    raise exception 'Invalid or expired table QR code.';
  end if;

  select *
  into updated_order
  from public.close_dining_session(target_order_id, 'customer_left');

  if updated_order.restaurant_id <> target_restaurant_id
     or updated_order.table_number <> normalized_table_number::text then
    raise exception 'Dining session does not belong to this table.';
  end if;

  return jsonb_build_object(
    'order_id', updated_order.id,
    'dining_session_status', updated_order.dining_session_status,
    'table_released_at', updated_order.table_released_at
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
  target_table public.restaurant_tables;
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

  if active_order.id is null then
    insert into public.orders (
      restaurant_id, customer_user_id, status, total_price, customer_name,
      table_id, table_number, payment_method, order_source,
      dining_session_status, dining_session_opened_at, dining_session_expires_at
    )
    values (
      target_restaurant_id, null, 'pending', 0, null,
      target_table.id, normalized_table_number::text, 'Cash', 'public_qr',
      'open', now(), now() + public.get_dining_session_timeout(target_restaurant_id)
    )
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

  if active_order.id is null then
    insert into public.orders (
      restaurant_id, customer_user_id, status, total_price, customer_name,
      table_id, table_number, payment_method, order_source,
      dining_session_status, dining_session_opened_at, dining_session_expires_at
    )
    values (
      target_restaurant_id, null, 'pending_payment', computed_total, normalized_customer_name,
      target_table.id, normalized_table_number::text, normalized_payment_method, 'public_qr',
      'open', added_at, added_at + public.get_dining_session_timeout(target_restaurant_id)
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

create or replace function public.get_waiter_order_session(
  target_restaurant_slug text,
  table_number text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant public.restaurants;
  current_waiter public.restaurant_staff;
  target_table public.restaurant_tables;
  normalized_restaurant_identifier text := lower(trim(target_restaurant_slug));
  slugified_restaurant_identifier text := trim(both '-' from regexp_replace(lower(trim(target_restaurant_slug)), '[^a-z0-9]+', '-', 'g'));
  normalized_table_number_text text := nullif(trim(table_number), '');
  normalized_table_number integer;
  has_assignments boolean := false;
  active_order public.orders;
  session_items jsonb := '[]'::jsonb;
  session_invoices jsonb := '[]'::jsonb;
  active_invoice jsonb := null;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to view waiter orders.';
  end if;

  if normalized_table_number_text is null then
    return null;
  end if;

  if normalized_table_number_text !~ '^[0-9]+$' then
    raise exception 'Table number must be a whole number.';
  end if;

  normalized_table_number := normalized_table_number_text::integer;

  select *
  into target_restaurant
  from public.restaurants restaurants
  where restaurants.active = true
    and (
      restaurants.slug = normalized_restaurant_identifier
      or restaurants.id::text = normalized_restaurant_identifier
      or lower(trim(restaurants.name)) = normalized_restaurant_identifier
      or restaurants.slug = slugified_restaurant_identifier
    )
  order by
    case
      when restaurants.slug = normalized_restaurant_identifier then 0
      when restaurants.id::text = normalized_restaurant_identifier then 1
      when lower(trim(restaurants.name)) = normalized_restaurant_identifier then 2
      else 3
    end
  limit 1;

  if target_restaurant.id is null then
    raise exception 'Restaurant not found.';
  end if;

  perform public.expire_stale_dining_sessions(target_restaurant.id);

  select *
  into current_waiter
  from public.restaurant_staff staff
  where staff.restaurant_id = target_restaurant.id
    and staff.user_id = auth.uid()
    and staff.role::text = 'waiter'
    and staff.active = true
  limit 1;

  if current_waiter.id is null then
    raise exception 'Active waiter membership not found for this restaurant.';
  end if;

  select *
  into target_table
  from public.restaurant_tables tables
  where tables.restaurant_id = target_restaurant.id
    and tables.table_number = normalized_table_number
    and tables.active = true
  limit 1;

  if target_table.id is null then
    raise exception 'Table not found.';
  end if;

  select exists (
    select 1
    from public.restaurant_table_waiter_assignments assignments
    where assignments.restaurant_id = target_restaurant.id
      and assignments.active = true
  )
  into has_assignments;

  if has_assignments and not exists (
    select 1
    from public.restaurant_table_waiter_assignments assignments
    where assignments.restaurant_id = target_restaurant.id
      and assignments.table_id = target_table.id
      and assignments.waiter_staff_id = current_waiter.id
      and assignments.active = true
  ) then
    raise exception 'This table is not assigned to the current waiter.';
  end if;

  select *
  into active_order
  from public.orders orders
  where orders.restaurant_id = target_restaurant.id
    and orders.table_number = normalized_table_number::text
    and public.is_public_qr_dining_session_open(orders.id)
  order by orders.created_at desc
  limit 1;

  if active_order.id is null then
    return jsonb_build_object(
      'restaurant_id', target_restaurant.id,
      'restaurant_slug', target_restaurant.slug,
      'restaurant_name', target_restaurant.name,
      'table_id', target_table.id,
      'table_number', target_table.table_number,
      'seats', target_table.seats,
      'waiter_staff_id', current_waiter.id,
      'waiter_display_name', current_waiter.display_name,
      'order_id', null,
      'items', '[]'::jsonb,
      'invoices', '[]'::jsonb
    );
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
        'notes', items.notes,
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

  select jsonb_build_object(
    'id', invoices.id,
    'invoice_number', invoices.invoice_number,
    'status', invoices.status,
    'total_price', invoices.total_price,
    'payment_method', coalesce(public.normalize_payment_method(invoices.payment_method), public.normalize_payment_method(active_order.payment_method)),
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
    'restaurant_id', target_restaurant.id,
    'restaurant_slug', target_restaurant.slug,
    'restaurant_name', target_restaurant.name,
    'table_id', target_table.id,
    'table_number', target_table.table_number,
    'seats', target_table.seats,
    'waiter_staff_id', current_waiter.id,
    'waiter_display_name', current_waiter.display_name,
    'order_id', active_order.id,
    'status', active_order.status,
    'dining_session_status', active_order.dining_session_status,
    'order_source', active_order.order_source,
    'created_by_waiter_id', active_order.created_by_waiter_id,
    'total_price', active_order.total_price,
    'customer_name', active_order.customer_name,
    'customer_phone', active_order.customer_phone,
    'order_note', active_order.order_note,
    'payment_method', active_order.payment_method,
    'created_at', active_order.created_at,
    'payment_verified_at', active_order.payment_verified_at,
    'items', session_items,
    'invoices', session_invoices,
    'active_invoice', active_invoice
  );
end;
$$;

create or replace function public.create_waiter_order(
  target_restaurant_slug text,
  table_number text,
  customer_name text,
  customer_phone text,
  order_note text,
  requested_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant public.restaurants;
  current_waiter public.restaurant_staff;
  target_table public.restaurant_tables;
  normalized_restaurant_identifier text := lower(trim(target_restaurant_slug));
  slugified_restaurant_identifier text := trim(both '-' from regexp_replace(lower(trim(target_restaurant_slug)), '[^a-z0-9]+', '-', 'g'));
  normalized_table_number_text text := nullif(trim(table_number), '');
  normalized_table_number integer;
  normalized_customer_name text := nullif(left(trim(coalesce(customer_name, '')), 80), '');
  normalized_customer_phone text := nullif(left(trim(coalesce(customer_phone, '')), 40), '');
  normalized_order_note text := nullif(left(trim(coalesce(order_note, '')), 500), '');
  has_assignments boolean := false;
  active_order public.orders;
  updated_order public.orders;
  current_invoice public.order_invoices;
  next_invoice_number integer;
  requested_count integer;
  computed_total numeric(12, 2);
  added_at timestamptz := now();
  added_items jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to create waiter orders.';
  end if;

  if normalized_table_number_text is null then
    raise exception 'Table number is required to place this order.';
  end if;

  if normalized_table_number_text !~ '^[0-9]+$' then
    raise exception 'Table number must be a whole number.';
  end if;

  normalized_table_number := normalized_table_number_text::integer;

  select *
  into target_restaurant
  from public.restaurants restaurants
  where restaurants.active = true
    and (
      restaurants.slug = normalized_restaurant_identifier
      or restaurants.id::text = normalized_restaurant_identifier
      or lower(trim(restaurants.name)) = normalized_restaurant_identifier
      or restaurants.slug = slugified_restaurant_identifier
    )
  order by
    case
      when restaurants.slug = normalized_restaurant_identifier then 0
      when restaurants.id::text = normalized_restaurant_identifier then 1
      when lower(trim(restaurants.name)) = normalized_restaurant_identifier then 2
      else 3
    end
  limit 1;

  if target_restaurant.id is null then
    raise exception 'Restaurant not found.';
  end if;

  perform public.expire_stale_dining_sessions(target_restaurant.id);

  select *
  into current_waiter
  from public.restaurant_staff staff
  where staff.restaurant_id = target_restaurant.id
    and staff.user_id = auth.uid()
    and staff.role::text = 'waiter'
    and staff.active = true
  limit 1;

  if current_waiter.id is null then
    raise exception 'Only active waiters may create waiter orders.';
  end if;

  select *
  into target_table
  from public.restaurant_tables tables
  where tables.restaurant_id = target_restaurant.id
    and tables.table_number = normalized_table_number
    and tables.active = true
  limit 1;

  if target_table.id is null then
    raise exception 'Table not found.';
  end if;

  select exists (
    select 1
    from public.restaurant_table_waiter_assignments assignments
    where assignments.restaurant_id = target_restaurant.id
      and assignments.active = true
  )
  into has_assignments;

  if has_assignments and not exists (
    select 1
    from public.restaurant_table_waiter_assignments assignments
    where assignments.restaurant_id = target_restaurant.id
      and assignments.table_id = target_table.id
      and assignments.waiter_staff_id = current_waiter.id
      and assignments.active = true
  ) then
    raise exception 'This table is not assigned to the current waiter.';
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
     and menu_items.restaurant_id = target_restaurant.id
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

  perform pg_advisory_xact_lock(hashtextextended(target_restaurant.id::text || ':' || normalized_table_number::text, 0));

  select *
  into active_order
  from public.orders orders
  where orders.restaurant_id = target_restaurant.id
    and orders.table_number = normalized_table_number::text
    and public.is_public_qr_dining_session_open(orders.id)
  order by orders.created_at desc
  limit 1
  for update;

  if active_order.id is null then
    insert into public.orders (
      restaurant_id, customer_user_id, status, total_price, customer_name,
      customer_phone, order_note, table_id, table_number, payment_method,
      order_source, created_by_waiter_id, dining_session_status,
      dining_session_opened_at, dining_session_expires_at
    )
    values (
      target_restaurant.id, null, 'pending_payment', computed_total, normalized_customer_name,
      normalized_customer_phone, normalized_order_note, target_table.id, normalized_table_number::text, 'Cash',
      'waiter', current_waiter.id, 'open',
      added_at, added_at + public.get_dining_session_timeout(target_restaurant.id)
    )
    returning * into updated_order;

    next_invoice_number := 1;
  else
    update public.orders
    set
      total_price = (active_order.total_price + computed_total)::numeric(12, 2),
      customer_name = coalesce(active_order.customer_name, normalized_customer_name),
      customer_phone = coalesce(active_order.customer_phone, normalized_customer_phone),
      order_note = coalesce(active_order.order_note, normalized_order_note),
      table_id = coalesce(active_order.table_id, target_table.id),
      created_by_waiter_id = coalesce(active_order.created_by_waiter_id, current_waiter.id),
      status = 'pending_payment'::public.order_status,
      dining_session_expires_at = added_at + public.get_dining_session_timeout(target_restaurant.id),
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
  values (target_restaurant.id, updated_order.id, next_invoice_number, 'pending', computed_total, null, added_at, added_at)
  returning * into current_invoice;

  insert into public.order_items (restaurant_id, order_id, invoice_id, menu_item_id, quantity, price, notes, appended_at, kitchen_status)
  select
    target_restaurant.id,
    updated_order.id,
    current_invoice.id,
    menu_items.id,
    normalized_items.quantity,
    menu_items.price,
    nullif(left(trim(coalesce(normalized_items.notes, '')), 500), ''),
    case when active_order.id is null then null else added_at end,
    'held'
  from (
    select
      (line_item->>'menu_item_id')::uuid as menu_item_id,
      (line_item->>'quantity')::integer as quantity,
      line_item->>'notes' as notes
    from jsonb_array_elements(requested_items) as line_item
  ) normalized_items
  join public.menu_items
    on menu_items.id = normalized_items.menu_item_id
   and menu_items.restaurant_id = target_restaurant.id
   and menu_items.available = true;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'menu_item_id', menu_items.id,
        'name', menu_items.name,
        'quantity', appended.quantity,
        'unit_price', menu_items.price,
        'line_total', (menu_items.price * appended.quantity)::numeric(12, 2),
        'notes', appended.notes
      )
      order by menu_items.name
    ),
    '[]'::jsonb
  )
  into added_items
  from (
    select
      (line_item->>'menu_item_id')::uuid as menu_item_id,
      (line_item->>'quantity')::integer as quantity,
      nullif(left(trim(coalesce(line_item->>'notes', '')), 500), '') as notes
    from jsonb_array_elements(requested_items) as line_item
  ) appended
  join public.menu_items
    on menu_items.id = appended.menu_item_id
   and menu_items.restaurant_id = target_restaurant.id;

  return jsonb_build_object(
    'order_id', updated_order.id,
    'invoice_id', current_invoice.id,
    'invoice_number', current_invoice.invoice_number,
    'invoice_status', current_invoice.status,
    'status', updated_order.status,
    'dining_session_status', updated_order.dining_session_status,
    'order_source', updated_order.order_source,
    'total_price', updated_order.total_price,
    'invoice_total', current_invoice.total_price,
    'table_id', updated_order.table_id,
    'table_number', updated_order.table_number,
    'customer_name', updated_order.customer_name,
    'customer_phone', updated_order.customer_phone,
    'order_note', updated_order.order_note,
    'created_by_waiter_id', updated_order.created_by_waiter_id,
    'waiter_display_name', current_waiter.display_name,
    'payment_method', current_invoice.payment_method,
    'created_at', updated_order.created_at,
    'session_action', case when active_order.id is null then 'created' else 'appended' end,
    'appended_at', case when active_order.id is null then null else added_at end,
    'added_total', computed_total,
    'items_added', added_items
  );
end;
$$;

revoke all on function public.get_dining_session_timeout(uuid) from public, anon, authenticated;
revoke all on function public.expire_stale_dining_sessions(uuid) from public, anon, authenticated;
revoke all on function public.close_dining_session(uuid, text) from public, anon;
revoke all on function public.close_public_qr_dining_session(text, text, text, uuid) from public;

grant execute on function public.get_dining_session_timeout(uuid) to service_role;
grant execute on function public.expire_stale_dining_sessions(uuid) to authenticated, service_role;
grant execute on function public.close_dining_session(uuid, text) to authenticated, service_role;
grant execute on function public.close_public_qr_dining_session(text, text, text, uuid) to anon, authenticated;

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

revoke all on function public.get_waiter_order_session(text, text) from public, anon;
revoke all on function public.create_waiter_order(text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.get_waiter_order_session(text, text) to authenticated;
grant execute on function public.create_waiter_order(text, text, text, text, text, jsonb) to authenticated;

-- ServeFlow Phase W3: waiter order creation.
-- Waiters create or append customer orders only; cashier approval still releases
-- held invoice items to kitchen through the existing payment gate.

alter table public.orders
  add column if not exists table_id uuid,
  add column if not exists created_by_waiter_id uuid,
  add column if not exists customer_phone text,
  add column if not exists order_note text;

alter table public.orders
  drop constraint if exists orders_order_source_allowed,
  add constraint orders_order_source_allowed
    check (order_source in ('authenticated', 'public_qr', 'cashier', 'waiter'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_table_same_restaurant'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_table_same_restaurant
      foreign key (restaurant_id, table_id)
      references public.restaurant_tables (restaurant_id, id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_created_by_waiter_same_restaurant'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_created_by_waiter_same_restaurant
      foreign key (restaurant_id, created_by_waiter_id)
      references public.restaurant_staff (restaurant_id, id)
      on delete set null;
  end if;
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
  latest_invoice public.order_invoices;
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
      restaurant_id,
      customer_user_id,
      status,
      total_price,
      customer_name,
      customer_phone,
      order_note,
      table_id,
      table_number,
      payment_method,
      order_source,
      created_by_waiter_id
    )
    values (
      target_restaurant.id,
      null,
      'pending_payment',
      computed_total,
      normalized_customer_name,
      normalized_customer_phone,
      normalized_order_note,
      target_table.id,
      normalized_table_number::text,
      'Cash',
      'waiter',
      current_waiter.id
    )
    returning * into updated_order;

    insert into public.order_invoices (restaurant_id, order_id, invoice_number, status, total_price, payment_method, created_at, updated_at)
    values (target_restaurant.id, updated_order.id, 1, 'pending', computed_total, null, added_at, added_at)
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
      values (active_order.restaurant_id, active_order.id, next_invoice_number, 'pending', computed_total, null, added_at, added_at)
      returning * into current_invoice;
    else
      update public.order_invoices
      set
        total_price = (latest_invoice.total_price + computed_total)::numeric(12, 2),
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
      customer_phone = coalesce(active_order.customer_phone, normalized_customer_phone),
      order_note = coalesce(active_order.order_note, normalized_order_note),
      table_id = coalesce(active_order.table_id, target_table.id),
      created_by_waiter_id = coalesce(active_order.created_by_waiter_id, current_waiter.id),
      updated_at = added_at
    where id = active_order.id
      and restaurant_id = active_order.restaurant_id
    returning * into updated_order;
  end if;

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

drop function if exists public.get_cashier_invoice_queue(uuid);

create function public.get_cashier_invoice_queue(target_restaurant_id uuid)
returns table (
  invoice_id uuid,
  invoice_number integer,
  invoice_status text,
  invoice_paid_at timestamptz,
  invoice_locked_at timestamptz,
  id uuid,
  status text,
  customer_name text,
  customer_phone text,
  table_number text,
  order_source text,
  waiter_name text,
  order_note text,
  payment_method text,
  total_price numeric,
  order_total_price numeric,
  created_at timestamptz,
  payment_verified_at timestamptz,
  items jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  today_start timestamptz := date_trunc('day', now());
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to view cashier invoices.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = auth.uid()
    and restaurant_id = target_restaurant_id
    and active = true
    and role in ('cashier', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers and owners may view cashier invoices.';
  end if;

  return query
  select
    invoices.id as invoice_id,
    invoices.invoice_number,
    invoices.status as invoice_status,
    invoices.paid_at as invoice_paid_at,
    invoices.locked_at as invoice_locked_at,
    orders.id,
    orders.status::text as status,
    orders.customer_name,
    orders.customer_phone,
    orders.table_number,
    orders.order_source,
    waiter_staff.display_name as waiter_name,
    orders.order_note,
    invoices.payment_method,
    invoices.total_price,
    orders.total_price as order_total_price,
    invoices.created_at,
    invoices.paid_at as payment_verified_at,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', items.id,
          'order_id', items.order_id,
          'invoice_id', items.invoice_id,
          'quantity', items.quantity,
          'price', items.price,
          'notes', items.notes,
          'appended_at', items.appended_at,
          'kitchen_status', items.kitchen_status,
          'menu_item_name', menu_items.name
        )
        order by items.created_at, items.id
      ) filter (where items.id is not null),
      '[]'::jsonb
    ) as items
  from public.order_invoices invoices
  join public.orders orders
    on orders.restaurant_id = invoices.restaurant_id
   and orders.id = invoices.order_id
  left join public.restaurant_staff waiter_staff
    on waiter_staff.restaurant_id = orders.restaurant_id
   and waiter_staff.id = orders.created_by_waiter_id
  left join public.order_items items
    on items.restaurant_id = invoices.restaurant_id
   and items.invoice_id = invoices.id
  left join public.menu_items menu_items
    on menu_items.restaurant_id = items.restaurant_id
   and menu_items.id = items.menu_item_id
  where invoices.restaurant_id = target_restaurant_id
    and invoices.created_at >= today_start
    and orders.status::text <> 'cancelled'
  group by invoices.id, orders.id, waiter_staff.display_name
  order by invoices.created_at desc;
end;
$$;

revoke all on function public.get_waiter_order_session(text, text) from public, anon;
revoke all on function public.create_waiter_order(text, text, text, text, text, jsonb) from public, anon;
revoke all on function public.get_cashier_invoice_queue(uuid) from public, anon;
grant execute on function public.get_waiter_order_session(text, text) to authenticated;
grant execute on function public.create_waiter_order(text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.get_cashier_invoice_queue(uuid) to authenticated;

-- Cashier POS order entry.
-- Keeps browser writes server-authoritative through RPCs and preserves RLS.

alter table public.orders
  drop constraint if exists orders_order_source_allowed,
  add constraint orders_order_source_allowed
    check (order_source in ('authenticated', 'public_qr', 'cashier'));

alter table public.orders
  add column if not exists updated_at timestamptz not null default now();

alter table public.order_items
  add column if not exists notes text,
  add column if not exists appended_at timestamptz;

do $$
begin
  alter type public.staff_activity_action add value if not exists 'order_items_appended';
exception
  when undefined_object then null;
end;
$$;

drop policy if exists categories_select_same_restaurant on public.categories;
drop policy if exists categories_select_same_restaurant_or_active_staff on public.categories;

create policy categories_select_same_restaurant_or_active_staff
on public.categories
for select
to authenticated
using (
  public.is_restaurant_member(restaurant_id)
  or public.is_active_restaurant_staff_member(restaurant_id)
);

create or replace function public.create_cashier_order(
  target_restaurant_id uuid,
  table_number text,
  selected_payment_method text,
  requested_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  target_total_tables integer;
  created_order public.orders;
  requested_count integer;
  computed_total numeric(12, 2);
  normalized_table_number_text text;
  normalized_table_number integer;
  normalized_payment_method text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to create cashier orders.';
  end if;

  if target_restaurant_id is null then
    raise exception 'Restaurant is required.';
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
    raise exception 'Only active cashiers and owners may create cashier orders.';
  end if;

  normalized_table_number_text := nullif(trim(table_number), '');
  normalized_payment_method := nullif(trim(selected_payment_method), '');

  if normalized_table_number_text is null then
    raise exception 'Table number is required.';
  end if;

  if normalized_table_number_text !~ '^[0-9]+$' then
    raise exception 'Table number must be a whole number.';
  end if;

  normalized_table_number := normalized_table_number_text::integer;

  select r.total_tables
  into target_total_tables
  from public.restaurants r
  where r.id = target_restaurant_id
  limit 1;

  if not exists (
    select 1
    from public.restaurant_tables rt
    where rt.restaurant_id = target_restaurant_id
      and rt.table_number = normalized_table_number
      and rt.active = true
  ) then
    raise exception 'Invalid table number. Please select a table between 1 and %.', coalesce(target_total_tables, 20);
  end if;

  if normalized_payment_method is null then
    normalized_payment_method := 'Cash';
  end if;

  if normalized_payment_method not in ('Cash', 'Telebirr', 'CBE Birr', 'Mobile Banking', 'Chapa', 'Credit/Debit Card') then
    raise exception 'Payment method is not supported.';
  end if;

  if requested_items is null or jsonb_typeof(requested_items) is distinct from 'array' then
    raise exception 'Order items must be an array.';
  end if;

  requested_count := jsonb_array_length(requested_items);
  if requested_count < 1 then
    raise exception 'Order must include at least one item.';
  end if;
  if requested_count > 50 then
    raise exception 'Order cannot include more than 50 line items.';
  end if;

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

  insert into public.orders (
    restaurant_id,
    customer_user_id,
    status,
    total_price,
    customer_name,
    table_number,
    payment_method,
    order_source
  )
  values (
    target_restaurant_id,
    null,
    'paid',
    computed_total,
    null,
    normalized_table_number::text,
    normalized_payment_method,
    'cashier'
  )
  returning * into created_order;

  insert into public.order_items (restaurant_id, order_id, menu_item_id, quantity, price, notes)
  select
    target_restaurant_id,
    created_order.id,
    menu_items.id,
    normalized_items.quantity,
    menu_items.price,
    nullif(left(trim(coalesce(normalized_items.notes, '')), 500), '')
  from (
    select
      (line_item->>'menu_item_id')::uuid as menu_item_id,
      (line_item->>'quantity')::integer as quantity,
      line_item->>'notes' as notes
    from jsonb_array_elements(requested_items) as line_item
  ) normalized_items
  join public.menu_items
    on menu_items.id = normalized_items.menu_item_id
   and menu_items.restaurant_id = target_restaurant_id
   and menu_items.available = true;

  update public.shift_activity_logs
  set
    actor_staff_id = acting_staff.id,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'table_number', created_order.table_number,
      'status', created_order.status::text,
      'order_source', created_order.order_source,
      'item_count', requested_count,
      'cashier_id', acting_staff.id
    )
  where restaurant_id = target_restaurant_id
    and order_id = created_order.id
    and action = 'order_created';

  if to_regprocedure('public.log_staff_activity(uuid, uuid, text, uuid, jsonb)') is not null then
    perform public.log_staff_activity(
      target_restaurant_id,
      auth.uid(),
      'create_cashier_order',
      created_order.id,
      jsonb_build_object(
        'order_total', created_order.total_price,
        'payment_method', created_order.payment_method,
        'table_number', created_order.table_number,
        'item_count', requested_count,
        'staff_id', acting_staff.id
      )
    );
  end if;

  return jsonb_build_object(
    'order_id', created_order.id,
    'status', created_order.status,
    'total_price', created_order.total_price,
    'table_number', created_order.table_number,
    'payment_method', created_order.payment_method,
    'order_source', created_order.order_source,
    'created_at', created_order.created_at
  );
end;
$$;

revoke all on function public.create_cashier_order(uuid, text, text, jsonb) from public, anon;
grant execute on function public.create_cashier_order(uuid, text, text, jsonb) to authenticated;

create or replace function public.append_items_to_order(
  target_order_id uuid,
  requested_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_user_id uuid := auth.uid();
  acting_staff public.restaurant_staff;
  target_order public.orders;
  requested_count integer;
  computed_addition numeric(12, 2);
  updated_order public.orders;
  active_shift_id uuid;
  added_at timestamptz := now();
  added_items jsonb;
begin
  if caller_user_id is null then
    raise exception 'Authentication is required to append order items.';
  end if;

  select *
  into target_order
  from public.orders
  where id = target_order_id
  for update;

  if target_order.id is null then
    raise exception 'Order not found.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = caller_user_id
    and restaurant_id = target_order.restaurant_id
    and active = true
    and role in ('cashier', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers and owners may append order items.';
  end if;

  if target_order.status::text not in ('pending_payment', 'paid', 'preparing', 'ready') then
    raise exception 'Items may only be appended to active orders.';
  end if;

  if requested_items is null or jsonb_typeof(requested_items) is distinct from 'array' then
    raise exception 'Order items must be an array.';
  end if;

  requested_count := jsonb_array_length(requested_items);
  if requested_count < 1 then
    raise exception 'Order must include at least one item.';
  end if;
  if requested_count > 50 then
    raise exception 'Order cannot include more than 50 line items.';
  end if;

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
     and menu_items.restaurant_id = target_order.restaurant_id
     and menu_items.available = true
  )
  select sum(valid_items.price * valid_items.quantity)::numeric(12, 2)
  into computed_addition
  from valid_items
  where not exists (select 1 from invalid_items)
    and (select count(*) from valid_items) = requested_count;

  if computed_addition is null then
    raise exception 'Order contains invalid or unavailable menu items.';
  end if;

  insert into public.order_items (restaurant_id, order_id, menu_item_id, quantity, price, notes, appended_at)
  select
    target_order.restaurant_id,
    target_order.id,
    menu_items.id,
    normalized_items.quantity,
    menu_items.price,
    nullif(left(trim(coalesce(normalized_items.notes, '')), 500), ''),
    added_at
  from (
    select
      (line_item->>'menu_item_id')::uuid as menu_item_id,
      (line_item->>'quantity')::integer as quantity,
      line_item->>'notes' as notes
    from jsonb_array_elements(requested_items) as line_item
  ) normalized_items
  join public.menu_items
    on menu_items.id = normalized_items.menu_item_id
   and menu_items.restaurant_id = target_order.restaurant_id
   and menu_items.available = true;

  update public.orders
  set
    total_price = (target_order.total_price + computed_addition)::numeric(12, 2),
    updated_at = added_at
  where id = target_order.id
    and restaurant_id = target_order.restaurant_id
  returning * into updated_order;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'menu_item_id', menu_items.id,
        'name', menu_items.name,
        'quantity', appended.quantity,
        'unit_price', menu_items.price,
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
   and menu_items.restaurant_id = target_order.restaurant_id;

  select cs.id
  into active_shift_id
  from public.cashier_shifts cs
  where cs.restaurant_id = target_order.restaurant_id
    and cs.opened_by = acting_staff.id
    and cs.closed_at is null
  order by cs.opened_at desc
  limit 1;

  if active_shift_id is null then
    select cs.id
    into active_shift_id
    from public.cashier_shifts cs
    where cs.restaurant_id = target_order.restaurant_id
      and cs.closed_at is null
    order by cs.opened_at desc
    limit 1;
  end if;

  insert into public.shift_activity_logs (restaurant_id, shift_id, order_id, actor_staff_id, action, message, amount, metadata)
  values (
    target_order.restaurant_id,
    active_shift_id,
    target_order.id,
    acting_staff.id,
    'order_items_appended',
    'Table ' || coalesce(target_order.table_number, '-') || ' added ' || requested_count || ' item(s)',
    computed_addition,
    jsonb_build_object(
      'cashier_id', acting_staff.id,
      'order_id', target_order.id,
      'table_number', target_order.table_number,
      'items_added', added_items,
      'timestamp', added_at
    )
  );

  if to_regprocedure('public.log_staff_activity(uuid, uuid, text, uuid, jsonb)') is not null then
    perform public.log_staff_activity(
      target_order.restaurant_id,
      acting_staff.id,
      'order_items_appended',
      acting_staff.id,
      jsonb_build_object(
        'cashier_id', acting_staff.id,
        'order_id', target_order.id,
        'table_number', target_order.table_number,
        'items_added', added_items,
        'timestamp', added_at
      )
    );
  end if;

  return jsonb_build_object(
    'order_id', updated_order.id,
    'status', updated_order.status,
    'total_price', updated_order.total_price,
    'table_number', updated_order.table_number,
    'payment_method', updated_order.payment_method,
    'order_source', updated_order.order_source,
    'created_at', updated_order.created_at,
    'appended_at', added_at,
    'items_added', added_items
  );
end;
$$;

revoke all on function public.append_items_to_order(uuid, jsonb) from public, anon;
grant execute on function public.append_items_to_order(uuid, jsonb) to authenticated;

create or replace function public.approve_order_payment(target_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_user_id uuid := auth.uid();
  acting_staff public.restaurant_staff;
  target_order public.orders;
  updated_order public.orders;
begin
  if caller_user_id is null then
    raise exception 'Authentication is required to approve payment.';
  end if;

  select *
  into target_order
  from public.orders
  where id = target_order_id;

  if target_order.id is null then
    raise exception 'Order not found.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = caller_user_id
    and restaurant_id = target_order.restaurant_id
    and active = true
    and role in ('cashier', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers and owners may approve payment.';
  end if;

  if target_order.payment_verified_at is not null then
    raise exception 'Order payment is already verified.';
  end if;

  if target_order.status::text = 'pending_payment' then
    update public.orders
    set
      status = 'paid',
      payment_verified_at = now(),
      payment_verified_by = acting_staff.id
    where id = target_order.id
      and restaurant_id = target_order.restaurant_id
      and status::text = 'pending_payment'
      and payment_verified_at is null
    returning * into updated_order;
  elsif target_order.order_source = 'cashier' and target_order.status::text = 'ready' then
    update public.orders
    set
      payment_verified_at = now(),
      payment_verified_by = acting_staff.id
    where id = target_order.id
      and restaurant_id = target_order.restaurant_id
      and order_source = 'cashier'
      and status::text = 'ready'
      and payment_verified_at is null
    returning * into updated_order;
  else
    raise exception 'Only pending payment orders or ready cashier orders may be approved.';
  end if;

  if updated_order.id is null then
    raise exception 'Order payment could not be approved.';
  end if;

  if to_regprocedure('public.log_staff_activity(uuid, uuid, text, uuid, jsonb)') is not null then
    perform public.log_staff_activity(
      target_order.restaurant_id,
      caller_user_id,
      'approve_payment',
      target_order.id,
      jsonb_build_object(
        'order_total', updated_order.total_price,
        'payment_method', updated_order.payment_method,
        'table_number', updated_order.table_number,
        'staff_id', acting_staff.id
      )
    );
  end if;

  return updated_order;
end;
$$;

revoke all on function public.approve_order_payment(uuid) from public;
grant execute on function public.approve_order_payment(uuid) to authenticated;

create or replace function public.log_shift_order_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_shift_id uuid;
  actor_staff_id uuid;
  created_item_count integer := 0;
begin
  if tg_op = 'INSERT' then
    select cs.id, cs.opened_by
    into active_shift_id, actor_staff_id
    from public.cashier_shifts cs
    where cs.restaurant_id = new.restaurant_id
      and cs.closed_at is null
    order by cs.opened_at desc
    limit 1;

    select count(*)
    into created_item_count
    from public.order_items oi
    where oi.restaurant_id = new.restaurant_id
      and oi.order_id = new.id;

    insert into public.shift_activity_logs (restaurant_id, shift_id, order_id, actor_staff_id, action, message, amount, metadata)
    values (
      new.restaurant_id,
      active_shift_id,
      new.id,
      actor_staff_id,
      'order_created',
      'Order ' || left(new.id::text, 6) || ' created',
      new.total_price,
      jsonb_build_object(
        'table_number', new.table_number,
        'status', new.status::text,
        'order_source', new.order_source,
        'item_count', created_item_count,
        'cashier_id', actor_staff_id
      )
    );
  elsif tg_op = 'UPDATE' then
    if old.payment_verified_at is null and new.payment_verified_at is not null then
      select cs.id
      into active_shift_id
      from public.cashier_shifts cs
      where cs.restaurant_id = new.restaurant_id
        and cs.opened_by = new.payment_verified_by
        and cs.closed_at is null
      order by cs.opened_at desc
      limit 1;

      insert into public.shift_activity_logs (restaurant_id, shift_id, order_id, actor_staff_id, action, message, amount, metadata)
      values (
        new.restaurant_id,
        active_shift_id,
        new.id,
        new.payment_verified_by,
        'payment_verified',
        'Table ' || coalesce(new.table_number, '-') || ' paid',
        new.total_price,
        jsonb_build_object('payment_method', new.payment_method, 'table_number', new.table_number)
      );
    end if;

    if old.status is distinct from new.status and new.status::text = 'completed' then
      select cs.id, cs.opened_by
      into active_shift_id, actor_staff_id
      from public.cashier_shifts cs
      where cs.restaurant_id = new.restaurant_id
        and cs.closed_at is null
      order by cs.opened_at desc
      limit 1;

      insert into public.shift_activity_logs (restaurant_id, shift_id, order_id, actor_staff_id, action, message, amount, metadata)
      values (
        new.restaurant_id,
        active_shift_id,
        new.id,
        actor_staff_id,
        'order_completed',
        'Order ' || left(new.id::text, 6) || ' completed',
        new.total_price,
        jsonb_build_object('table_number', new.table_number, 'status', new.status::text)
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists log_shift_order_activity on public.orders;
create trigger log_shift_order_activity
after insert or update of status, payment_verified_at, payment_verified_by
on public.orders
for each row
execute function public.log_shift_order_activity();

revoke all on function public.log_shift_order_activity() from public, anon, authenticated;
grant execute on function public.log_shift_order_activity() to service_role;

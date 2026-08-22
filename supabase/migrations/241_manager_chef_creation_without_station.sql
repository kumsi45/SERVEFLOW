-- Manager-created Chefs begin unassigned. Kitchen access must not silently
-- rewrite Owner kitchen configuration by assigning the main station.
drop trigger if exists assign_default_kitchen_station_to_staff on public.restaurant_staff;

create or replace function public.get_kitchen_dashboard_context(target_restaurant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  restaurant_record public.restaurants;
  assigned_station public.kitchen_stations;
  stations jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to view kitchen dashboard.';
  end if;

  if target_restaurant_id is null then
    raise exception 'Restaurant is required.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where restaurant_id = target_restaurant_id
    and user_id = auth.uid()
    and role in ('kitchen', 'owner')
    and active = true
  order by created_at asc
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active kitchen staff and owners may view the kitchen dashboard.';
  end if;

  select *
  into restaurant_record
  from public.restaurants
  where id = target_restaurant_id;

  if restaurant_record.id is null then
    raise exception 'Restaurant not found.';
  end if;

  if acting_staff.role = 'kitchen' then
    select *
    into assigned_station
    from public.kitchen_stations
    where id = acting_staff.assigned_kitchen_station_id
      and restaurant_id = target_restaurant_id
      and archived_at is null;
  else
    perform public.ensure_main_kitchen_station_for_restaurant(target_restaurant_id);

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', station.id,
        'name', station.name,
        'displayColor', station.display_color,
        'icon', station.icon,
        'active', station.active
      )
      order by station.priority asc, station.name asc
    ), '[]'::jsonb)
    into stations
    from public.kitchen_stations station
    where station.restaurant_id = target_restaurant_id
      and station.archived_at is null;
  end if;

  return jsonb_build_object(
    'restaurant', jsonb_build_object('id', restaurant_record.id, 'name', restaurant_record.name),
    'role', acting_staff.role::text,
    'assignedStation', case
      when assigned_station.id is null then null
      else jsonb_build_object(
        'id', assigned_station.id,
        'name', assigned_station.name,
        'displayColor', assigned_station.display_color,
        'icon', assigned_station.icon,
        'active', assigned_station.active
      )
    end,
    'stations', stations
  );
end;
$$;

-- An unassigned Chef must not receive every station queue or be persisted to
-- Main Kitchen as a side effect of opening the Kitchen workspace.
create or replace function public.get_station_kitchen_orders(
  target_restaurant_id uuid,
  target_station_id uuid default null,
  include_all_stations boolean default false,
  log_queue_view boolean default false
)
returns table (
  id uuid, display_number text, kitchen_ticket_number text, kitchen_batch_key text,
  status text, customer_name text, table_number text, payment_method text,
  total_price numeric, created_at timestamptz, payment_verified_at timestamptz,
  preparation_started_at timestamptz, ready_marked_at timestamptz,
  items jsonb, station_progress jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  effective_station_id uuid;
  selected_station public.kitchen_stations;
begin
  if auth.uid() is null then raise exception 'Authentication is required to view kitchen orders.'; end if;
  if target_restaurant_id is null then raise exception 'Restaurant is required.'; end if;

  select * into acting_staff
  from public.restaurant_staff
  where restaurant_id = target_restaurant_id
    and user_id = auth.uid()
    and role in ('kitchen', 'owner')
    and active = true
  order by created_at asc
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active kitchen staff and owners may view kitchen orders.';
  end if;

  if acting_staff.role = 'kitchen' then
    if acting_staff.assigned_kitchen_station_id is null then
      raise exception 'Kitchen station assignment required.';
    end if;
    effective_station_id := acting_staff.assigned_kitchen_station_id;
  elsif include_all_stations then
    effective_station_id := null;
  elsif target_station_id is not null then
    select * into selected_station
    from public.kitchen_stations
    where id = target_station_id
      and restaurant_id = target_restaurant_id
      and active = true
      and archived_at is null;
    if selected_station.id is null then raise exception 'Kitchen station not found.'; end if;
    effective_station_id := target_station_id;
  else
    effective_station_id := null;
  end if;

  if log_queue_view then
    perform public.log_staff_activity(
      target_restaurant_id,
      acting_staff.id,
      'kitchen_station_queue_viewed',
      null,
      jsonb_build_object('station_id', effective_station_id, 'role', acting_staff.role::text)
    );
  end if;

  return query
  with active_batches as (
    select
      orders.id order_id,
      order_items.invoice_id,
      order_items.kitchen_station_id,
      coalesce(case
        when order_items.appended_at is null then null
        else ((extract(epoch from order_items.appended_at) * 1000000)::bigint)::text
      end, 'initial') kitchen_batch_key
    from public.orders
    join public.order_items
      on order_items.restaurant_id = orders.restaurant_id
     and order_items.order_id = orders.id
    join public.order_invoices
      on order_invoices.restaurant_id = order_items.restaurant_id
     and order_invoices.id = order_items.invoice_id
     and order_invoices.order_id = orders.id
    where orders.restaurant_id = target_restaurant_id
      and orders.operational_status in ('accepted', 'preparing', 'ready')
      and orders.dining_session_status = 'open'
      and orders.table_released_at is null
      and (
        order_invoices.payment_status = 'paid'
        or (
          order_invoices.payment_status = 'held'
          and orders.payment_timing = 'after_meal'
          and orders.order_source <> 'public_qr'
        )
      )
      and order_items.kitchen_status in ('accepted', 'preparing', 'ready')
      and order_items.kitchen_station_id is not null
      and (effective_station_id is null or order_items.kitchen_station_id = effective_station_id)
    group by orders.id, order_items.invoice_id, order_items.kitchen_station_id, order_items.appended_at
  )
  select
    orders.id,
    orders.display_number,
    invoices.kitchen_ticket_number,
    batches.kitchen_batch_key,
    case
      when count(*) filter (where order_items.kitchen_status = 'accepted') = count(*) then 'accepted'
      when count(*) filter (where order_items.kitchen_status = 'ready') = count(*) then 'ready'
      else 'preparing'
    end,
    orders.customer_name,
    orders.table_number,
    orders.payment_method,
    coalesce(sum(order_items.price * order_items.quantity), 0)::numeric,
    orders.created_at,
    invoices.paid_at,
    coalesce(min(order_items.kitchen_preparation_started_at), orders.preparation_started_at),
    coalesce(max(order_items.kitchen_ready_marked_at), orders.ready_marked_at),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', order_items.id,
      'order_id', order_items.order_id,
      'quantity', order_items.quantity,
      'price', order_items.price,
      'notes', order_items.notes,
      'appended_at', order_items.appended_at,
      'kitchen_station_id', order_items.kitchen_station_id,
      'kitchen_station_name', kitchen_stations.name,
      'kitchen_status', order_items.kitchen_status,
      'menu_item_name', menu_items.name
    ) order by order_items.created_at, order_items.id), '[]'::jsonb),
    jsonb_build_array(jsonb_build_object(
      'station_id', batches.kitchen_station_id,
      'station_name', max(kitchen_stations.name),
      'station_status', case
        when count(*) filter (where order_items.kitchen_status = 'accepted') = count(*) then 'accepted'
        when count(*) filter (where order_items.kitchen_status = 'ready') = count(*) then 'ready'
        else 'preparing'
      end,
      'item_count', count(*)::integer,
      'ready_count', count(*) filter (where order_items.kitchen_status = 'ready')::integer,
      'completed_count', count(*) filter (where order_items.kitchen_status = 'completed')::integer,
      'started_at', min(order_items.kitchen_preparation_started_at),
      'ready_at', max(order_items.kitchen_ready_marked_at),
      'completed_at', max(order_items.kitchen_completed_at)
    ))
  from active_batches batches
  join public.orders
    on orders.id = batches.order_id
   and orders.restaurant_id = target_restaurant_id
  join public.order_invoices invoices
    on invoices.restaurant_id = orders.restaurant_id
   and invoices.id = batches.invoice_id
   and invoices.order_id = orders.id
  join public.order_items
    on order_items.restaurant_id = orders.restaurant_id
   and order_items.order_id = orders.id
   and order_items.invoice_id = batches.invoice_id
   and order_items.kitchen_station_id = batches.kitchen_station_id
   and (
     (batches.kitchen_batch_key = 'initial' and order_items.appended_at is null)
     or (batches.kitchen_batch_key <> 'initial' and ((extract(epoch from order_items.appended_at) * 1000000)::bigint)::text = batches.kitchen_batch_key)
   )
   and order_items.kitchen_status in ('accepted', 'preparing', 'ready')
  left join public.menu_items
    on menu_items.restaurant_id = order_items.restaurant_id
   and menu_items.id = order_items.menu_item_id
  left join public.kitchen_stations
    on kitchen_stations.restaurant_id = order_items.restaurant_id
   and kitchen_stations.id = order_items.kitchen_station_id
  group by orders.id, invoices.kitchen_ticket_number, invoices.paid_at, batches.kitchen_station_id, batches.kitchen_batch_key
  order by coalesce(min(order_items.appended_at), invoices.paid_at, orders.created_at), orders.created_at;
end;
$$;

-- All station-dependent action RPCs resolve through this helper. Refuse an
-- unassigned Chef rather than granting an implicit Main Kitchen assignment.
create or replace function public.resolve_kitchen_action_context(
  target_order_id uuid,
  requested_station_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders;
  staff public.restaurant_staff;
  station_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication is required to update kitchen tickets.'; end if;

  select * into target_order
  from public.orders
  where id = target_order_id
  for update;

  if target_order.id is null then raise exception 'Order not found.'; end if;

  select * into staff
  from public.restaurant_staff
  where restaurant_id = target_order.restaurant_id
    and user_id = auth.uid()
    and active
    and role::text in ('kitchen', 'owner')
  order by created_at
  limit 1;

  if staff.id is null then raise exception 'Order belongs to another restaurant.'; end if;

  if staff.role::text = 'kitchen' then
    station_id := staff.assigned_kitchen_station_id;
    if station_id is null then
      raise exception 'Kitchen station assignment required.';
    end if;
  else
    station_id := requested_station_id;
  end if;

  if station_id is null then raise exception 'Kitchen station not found.'; end if;
  if not exists (
    select 1
    from public.kitchen_stations stations
    where stations.id = station_id
      and stations.restaurant_id = target_order.restaurant_id
      and stations.active
      and stations.archived_at is null
  ) then
    raise exception 'Wrong station.';
  end if;

  return jsonb_build_object(
    'restaurant_id', target_order.restaurant_id,
    'staff_id', staff.id,
    'station_id', station_id
  );
end;
$$;

comment on function public.get_kitchen_dashboard_context(uuid) is
  'Returns Kitchen context without assigning an unassigned Chef to a station.';
comment on function public.get_station_kitchen_orders(uuid,uuid,boolean,boolean) is
  'Returns a tenant-scoped station queue and requires Kitchen staff to have an explicit station assignment.';
comment on function public.resolve_kitchen_action_context(uuid,uuid) is
  'Resolves a tenant-scoped Kitchen action and rejects unassigned Chefs without mutating their assignment.';

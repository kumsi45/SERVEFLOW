-- Keep verified invoice batches visible to kitchen even when the same open dining
-- session has a newer invoice waiting for cashier verification.
drop function if exists public.get_station_kitchen_orders(uuid, uuid, boolean, boolean);

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
  if auth.uid() is null then
    raise exception 'Authentication is required to view kitchen orders.';
  end if;
  if target_restaurant_id is null then raise exception 'Restaurant is required.'; end if;

  select * into acting_staff
  from public.restaurant_staff
  where restaurant_id = target_restaurant_id and user_id = auth.uid()
    and role in ('kitchen', 'owner') and active = true
  order by created_at asc limit 1;
  if acting_staff.id is null then
    raise exception 'Only active kitchen staff and owners may view kitchen orders.';
  end if;

  if acting_staff.role = 'kitchen' then
    if acting_staff.assigned_kitchen_station_id is null then
      update public.restaurant_staff
      set assigned_kitchen_station_id = public.ensure_main_kitchen_station_for_restaurant(target_restaurant_id)
      where id = acting_staff.id and restaurant_id = acting_staff.restaurant_id
        and assigned_kitchen_station_id is null
      returning * into acting_staff;
    end if;
    effective_station_id := acting_staff.assigned_kitchen_station_id;
  elsif include_all_stations then
    effective_station_id := null;
  elsif target_station_id is not null then
    select * into selected_station from public.kitchen_stations
    where id = target_station_id and restaurant_id = target_restaurant_id and archived_at is null;
    if selected_station.id is null then raise exception 'Kitchen station not found.'; end if;
    effective_station_id := target_station_id;
  else
    effective_station_id := null;
  end if;

  if log_queue_view then
    perform public.log_staff_activity(target_restaurant_id, acting_staff.id,
      'kitchen_station_queue_viewed', null,
      jsonb_build_object('mode', case when acting_staff.role = 'owner' and effective_station_id is null then 'all_stations' else 'station' end,
        'station_id', effective_station_id, 'role', acting_staff.role::text));
  end if;

  return query
  with active_batches as (
    select orders.id order_id, order_items.invoice_id, order_items.kitchen_station_id,
      case when order_items.appended_at is null then null
        else ((extract(epoch from order_items.appended_at) * 1000000)::bigint)::text end kitchen_batch_key
    from public.orders
    join public.order_items
      on order_items.restaurant_id = orders.restaurant_id and order_items.order_id = orders.id
    join public.order_invoices
      on order_invoices.restaurant_id = order_items.restaurant_id
     and order_invoices.id = order_items.invoice_id
    where orders.restaurant_id = target_restaurant_id
      and order_invoices.status = 'verified'
      and order_invoices.verified_at is not null
      and order_items.kitchen_status in ('paid', 'preparing', 'ready')
      and order_items.kitchen_station_id is not null
      and (effective_station_id is null or order_items.kitchen_station_id = effective_station_id)
    group by orders.id, order_items.invoice_id, order_items.kitchen_station_id, order_items.appended_at
  )
  select orders.id, orders.display_number, invoices.kitchen_ticket_number,
    batches.kitchen_batch_key,
    case when count(*) filter (where order_items.kitchen_status = 'paid') = count(*) then 'paid'
      when count(*) filter (where order_items.kitchen_status = 'ready') = count(*) then 'ready'
      else 'preparing' end,
    orders.customer_name, orders.table_number, orders.payment_method,
    coalesce(sum(order_items.price * order_items.quantity), 0)::numeric,
    orders.created_at, invoices.verified_at,
    coalesce(min(order_items.kitchen_preparation_started_at), orders.preparation_started_at),
    coalesce(max(order_items.kitchen_ready_marked_at), orders.ready_marked_at),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', order_items.id, 'order_id', order_items.order_id,
      'quantity', order_items.quantity, 'price', order_items.price,
      'notes', order_items.notes, 'appended_at', order_items.appended_at,
      'kitchen_station_id', order_items.kitchen_station_id,
      'kitchen_station_name', kitchen_stations.name,
      'kitchen_status', order_items.kitchen_status,
      'menu_item_name', menu_items.name)
      order by order_items.created_at, order_items.id), '[]'::jsonb),
    jsonb_build_array(jsonb_build_object(
      'station_id', batches.kitchen_station_id,
      'station_name', max(kitchen_stations.name),
      'station_status', case
        when count(*) filter (where order_items.kitchen_status = 'paid') = count(*) then 'waiting'
        when count(*) filter (where order_items.kitchen_status = 'ready') = count(*) then 'ready'
        else 'preparing' end,
      'item_count', count(*)::integer,
      'ready_count', count(*) filter (where order_items.kitchen_status = 'ready')::integer,
      'completed_count', 0, 'started_at', min(order_items.kitchen_preparation_started_at),
      'ready_at', max(order_items.kitchen_ready_marked_at), 'completed_at', null))
  from active_batches batches
  join public.orders on orders.id = batches.order_id and orders.restaurant_id = target_restaurant_id
  join public.order_invoices invoices
    on invoices.restaurant_id = orders.restaurant_id and invoices.id = batches.invoice_id
  join public.order_items
    on order_items.restaurant_id = orders.restaurant_id
   and order_items.order_id = orders.id and order_items.invoice_id = batches.invoice_id
   and order_items.kitchen_station_id = batches.kitchen_station_id
   and ((batches.kitchen_batch_key is null and order_items.appended_at is null)
     or (batches.kitchen_batch_key is not null and ((extract(epoch from order_items.appended_at) * 1000000)::bigint)::text = batches.kitchen_batch_key))
   and order_items.kitchen_status in ('paid', 'preparing', 'ready')
  left join public.menu_items on menu_items.restaurant_id = order_items.restaurant_id and menu_items.id = order_items.menu_item_id
  left join public.kitchen_stations on kitchen_stations.restaurant_id = order_items.restaurant_id and kitchen_stations.id = order_items.kitchen_station_id
  group by orders.id, invoices.kitchen_ticket_number, invoices.verified_at,
    batches.kitchen_station_id, batches.kitchen_batch_key
  order by coalesce(min(order_items.appended_at), invoices.verified_at, orders.created_at), orders.created_at;
end;
$$;

revoke all on function public.get_station_kitchen_orders(uuid, uuid, boolean, boolean) from public, anon;
grant execute on function public.get_station_kitchen_orders(uuid, uuid, boolean, boolean) to authenticated;

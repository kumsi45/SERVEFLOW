-- SERVEFLOW Kitchen Stations Phase 4A.
-- Station-aware kitchen dashboard only: staff station assignment, station-filtered
-- queue RPCs, RLS tightening, and non-spammy queue view activity logging.

alter type public.staff_activity_action add value if not exists 'kitchen_station_queue_viewed';

alter table public.restaurant_staff
  add column if not exists assigned_kitchen_station_id uuid;

alter table public.restaurant_staff
  drop constraint if exists restaurant_staff_assigned_kitchen_station_same_restaurant,
  add constraint restaurant_staff_assigned_kitchen_station_same_restaurant
    foreign key (restaurant_id, assigned_kitchen_station_id)
    references public.kitchen_stations (restaurant_id, id)
    on delete restrict;

create index if not exists restaurant_staff_assigned_kitchen_station_idx
on public.restaurant_staff (restaurant_id, assigned_kitchen_station_id)
where role = 'kitchen' and active = true;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'restaurant_staff'
     ) then
    alter publication supabase_realtime add table public.restaurant_staff;
  end if;
end;
$$;

create or replace function public.ensure_main_kitchen_station_for_restaurant(target_restaurant_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  default_station_id uuid;
begin
  if target_restaurant_id is null then
    raise exception 'Restaurant is required.';
  end if;

  select id
  into default_station_id
  from public.kitchen_stations
  where restaurant_id = target_restaurant_id
    and lower(btrim(name)) = 'main kitchen'
    and archived_at is null
  order by created_at asc
  limit 1;

  if default_station_id is not null then
    return default_station_id;
  end if;

  insert into public.kitchen_stations (
    restaurant_id,
    name,
    description,
    display_color,
    icon,
    priority,
    active
  )
  values (
    target_restaurant_id,
    'Main Kitchen',
    'Default kitchen station for this restaurant.',
    '#0f766e',
    'MK',
    1,
    true
  )
  on conflict do nothing
  returning id into default_station_id;

  if default_station_id is null then
    select id
    into default_station_id
    from public.kitchen_stations
    where restaurant_id = target_restaurant_id
      and lower(btrim(name)) = 'main kitchen'
      and archived_at is null
    order by created_at asc
    limit 1;
  end if;

  return default_station_id;
end;
$$;

create or replace function public.assign_default_kitchen_station_to_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'kitchen' and new.assigned_kitchen_station_id is null then
    new.assigned_kitchen_station_id := public.ensure_main_kitchen_station_for_restaurant(new.restaurant_id);
  end if;

  return new;
end;
$$;

drop trigger if exists assign_default_kitchen_station_to_staff on public.restaurant_staff;
create trigger assign_default_kitchen_station_to_staff
before insert or update of role, restaurant_id, assigned_kitchen_station_id
on public.restaurant_staff
for each row
execute function public.assign_default_kitchen_station_to_staff();

insert into public.kitchen_stations (
  restaurant_id,
  name,
  description,
  display_color,
  icon,
  priority,
  active
)
select
  restaurants.id,
  'Main Kitchen',
  'Default kitchen station for this restaurant.',
  '#0f766e',
  'MK',
  1,
  true
from public.restaurants restaurants
where not exists (
  select 1
  from public.kitchen_stations stations
  where stations.restaurant_id = restaurants.id
    and lower(btrim(stations.name)) = 'main kitchen'
    and stations.archived_at is null
)
on conflict do nothing;

update public.restaurant_staff staff
set assigned_kitchen_station_id = stations.id
from public.kitchen_stations stations
where staff.role = 'kitchen'
  and staff.assigned_kitchen_station_id is null
  and stations.restaurant_id = staff.restaurant_id
  and lower(btrim(stations.name)) = 'main kitchen'
  and stations.archived_at is null;

create or replace function public.current_kitchen_staff_station(target_restaurant_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select assigned_kitchen_station_id
  from public.restaurant_staff
  where restaurant_id = target_restaurant_id
    and user_id = auth.uid()
    and role = 'kitchen'
    and active = true
  order by created_at asc
  limit 1
$$;

create or replace function public.kitchen_order_has_assigned_station(
  target_restaurant_id uuid,
  target_order_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.order_items items
    where items.restaurant_id = target_restaurant_id
      and items.order_id = target_order_id
      and items.kitchen_station_id = public.current_kitchen_staff_station(target_restaurant_id)
  )
$$;

create or replace function public.kitchen_can_view_order_item(
  target_restaurant_id uuid,
  target_order_id uuid,
  target_station_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select target_station_id = public.current_kitchen_staff_station(target_restaurant_id)
    and exists (
      select 1
      from public.orders orders
      where orders.restaurant_id = target_restaurant_id
        and orders.id = target_order_id
        and orders.status::text in ('paid', 'preparing', 'ready')
    )
$$;

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

  if acting_staff.role = 'kitchen' and acting_staff.assigned_kitchen_station_id is null then
    update public.restaurant_staff
    set assigned_kitchen_station_id = public.ensure_main_kitchen_station_for_restaurant(target_restaurant_id)
    where id = acting_staff.id
      and restaurant_id = acting_staff.restaurant_id
      and assigned_kitchen_station_id is null
    returning * into acting_staff;
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
        'id', stations.id,
        'name', stations.name,
        'displayColor', stations.display_color,
        'icon', stations.icon,
        'active', stations.active
      )
      order by stations.priority asc, stations.name asc
    ), '[]'::jsonb)
    into stations
    from public.kitchen_stations stations
    where stations.restaurant_id = target_restaurant_id
      and stations.archived_at is null;
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

create or replace function public.get_station_kitchen_orders(
  target_restaurant_id uuid,
  target_station_id uuid default null,
  include_all_stations boolean default false,
  log_queue_view boolean default false
)
returns table (
  id uuid,
  status text,
  customer_name text,
  table_number text,
  payment_method text,
  total_price numeric,
  created_at timestamptz,
  payment_verified_at timestamptz,
  preparation_started_at timestamptz,
  ready_marked_at timestamptz,
  items jsonb
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
    raise exception 'Only active kitchen staff and owners may view kitchen orders.';
  end if;

  if acting_staff.role = 'kitchen' then
    if acting_staff.assigned_kitchen_station_id is null then
      update public.restaurant_staff
      set assigned_kitchen_station_id = public.ensure_main_kitchen_station_for_restaurant(target_restaurant_id)
      where id = acting_staff.id
        and restaurant_id = acting_staff.restaurant_id
        and assigned_kitchen_station_id is null
      returning * into acting_staff;
    end if;

    effective_station_id := acting_staff.assigned_kitchen_station_id;
  elsif include_all_stations then
    effective_station_id := null;
  elsif target_station_id is not null then
    select *
    into selected_station
    from public.kitchen_stations
    where kitchen_stations.id = target_station_id
      and kitchen_stations.restaurant_id = target_restaurant_id
      and kitchen_stations.archived_at is null;

    if selected_station.id is null then
      raise exception 'Kitchen station not found.';
    end if;

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
      jsonb_build_object(
        'mode', case when acting_staff.role = 'owner' and effective_station_id is null then 'all_stations' else 'station' end,
        'station_id', effective_station_id,
        'role', acting_staff.role::text
      )
    );
  end if;

  return query
  select
    orders.id,
    orders.status::text,
    orders.customer_name,
    orders.table_number,
    orders.payment_method,
    orders.total_price,
    orders.created_at,
    orders.payment_verified_at,
    orders.preparation_started_at,
    orders.ready_marked_at,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', items.id,
        'order_id', items.order_id,
        'quantity', items.quantity,
        'price', items.price,
        'notes', items.notes,
        'appended_at', items.appended_at,
        'kitchen_station_id', items.kitchen_station_id,
        'kitchen_station_name', stations.name,
        'menu_item_name', menu_items.name
      )
      order by items.created_at asc, items.id asc
    ), '[]'::jsonb) as items
  from public.orders orders
  join public.order_items items
    on items.restaurant_id = orders.restaurant_id
   and items.order_id = orders.id
   and (effective_station_id is null or items.kitchen_station_id = effective_station_id)
  left join public.menu_items menu_items
    on menu_items.restaurant_id = items.restaurant_id
   and menu_items.id = items.menu_item_id
  left join public.kitchen_stations stations
    on stations.restaurant_id = items.restaurant_id
   and stations.id = items.kitchen_station_id
  where orders.restaurant_id = target_restaurant_id
    and orders.status::text in ('paid', 'preparing', 'ready')
  group by orders.id
  order by orders.created_at asc;
end;
$$;

drop policy if exists orders_select_by_role_same_restaurant on public.orders;
create policy orders_select_by_role_same_restaurant
on public.orders
for select
to authenticated
using (
  customer_user_id = auth.uid()
  or public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])
  or (
    public.has_staff_role(restaurant_id, array['cashier']::public.restaurant_staff_role[])
    and status::text in (
      'pending_payment',
      'paid',
      'preparing',
      'ready',
      'completed',
      'cancelled'
    )
  )
  or (
    public.has_staff_role(restaurant_id, array['kitchen']::public.restaurant_staff_role[])
    and status::text in ('paid', 'preparing', 'ready')
    and public.kitchen_order_has_assigned_station(restaurant_id, id)
  )
);

drop policy if exists order_items_select_by_order_visibility on public.order_items;
create policy order_items_select_by_order_visibility
on public.order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.orders
    where orders.id = order_items.order_id
      and orders.restaurant_id = order_items.restaurant_id
      and (
        orders.customer_user_id = auth.uid()
        or public.has_staff_role(order_items.restaurant_id, array['owner']::public.restaurant_staff_role[])
        or (
          public.has_staff_role(order_items.restaurant_id, array['cashier']::public.restaurant_staff_role[])
          and orders.status::text in (
            'pending_payment',
            'paid',
            'preparing',
            'ready',
            'completed',
            'cancelled'
          )
        )
        or (
          public.has_staff_role(order_items.restaurant_id, array['kitchen']::public.restaurant_staff_role[])
          and public.kitchen_can_view_order_item(
            order_items.restaurant_id,
            order_items.order_id,
            order_items.kitchen_station_id
          )
        )
      )
  )
);

revoke all on function public.ensure_main_kitchen_station_for_restaurant(uuid) from public, anon, authenticated;
revoke all on function public.assign_default_kitchen_station_to_staff() from public, anon, authenticated;
revoke all on function public.current_kitchen_staff_station(uuid) from public, anon, authenticated;
revoke all on function public.kitchen_order_has_assigned_station(uuid, uuid) from public, anon, authenticated;
revoke all on function public.kitchen_can_view_order_item(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_kitchen_dashboard_context(uuid) from public, anon;
revoke all on function public.get_station_kitchen_orders(uuid, uuid, boolean, boolean) from public, anon;

grant execute on function public.get_kitchen_dashboard_context(uuid) to authenticated;
grant execute on function public.get_station_kitchen_orders(uuid, uuid, boolean, boolean) to authenticated;
grant execute on function public.current_kitchen_staff_station(uuid) to authenticated;
grant execute on function public.kitchen_order_has_assigned_station(uuid, uuid) to authenticated;
grant execute on function public.kitchen_can_view_order_item(uuid, uuid, uuid) to authenticated;

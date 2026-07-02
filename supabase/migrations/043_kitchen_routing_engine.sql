-- SERVEFLOW Kitchen Stations Phase 3.
-- Backend-only kitchen routing for order items. This does not split orders or
-- change kitchen dashboard behavior.

alter type public.staff_activity_action add value if not exists 'kitchen_routing_completed';

alter table public.order_items
  add column if not exists kitchen_station_id uuid;

alter table public.order_items
  drop constraint if exists order_items_kitchen_station_same_restaurant,
  add constraint order_items_kitchen_station_same_restaurant
    foreign key (restaurant_id, kitchen_station_id)
    references public.kitchen_stations (restaurant_id, id)
    on delete restrict;

create index if not exists order_items_kitchen_station_idx
on public.order_items (restaurant_id, kitchen_station_id)
where kitchen_station_id is not null;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'order_items'
     ) then
    alter publication supabase_realtime add table public.order_items;
  end if;
end;
$$;

create or replace function public.route_order_item_kitchen_station()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  routed_station_id uuid;
begin
  if new.kitchen_station_id is not null then
    if not exists (
      select 1
      from public.kitchen_stations stations
      where stations.id = new.kitchen_station_id
        and stations.restaurant_id = new.restaurant_id
        and stations.archived_at is null
    ) then
      raise exception 'Kitchen station does not belong to this restaurant.';
    end if;

    return new;
  end if;

  select items.kitchen_station_id
  into routed_station_id
  from public.menu_items items
  join public.kitchen_stations stations
    on stations.restaurant_id = items.restaurant_id
   and stations.id = items.kitchen_station_id
   and stations.archived_at is null
  where items.id = new.menu_item_id
    and items.restaurant_id = new.restaurant_id
  limit 1;

  if routed_station_id is null then
    select stations.id
    into routed_station_id
    from public.kitchen_stations stations
    where stations.restaurant_id = new.restaurant_id
      and lower(btrim(stations.name)) = 'main kitchen'
      and stations.archived_at is null
    order by stations.created_at asc
    limit 1;
  end if;

  if routed_station_id is null then
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
      new.restaurant_id,
      'Main Kitchen',
      'Default kitchen station for this restaurant.',
      '#0f766e',
      'MK',
      1,
      true
    )
    on conflict do nothing
    returning id into routed_station_id;

    if routed_station_id is null then
      select stations.id
      into routed_station_id
      from public.kitchen_stations stations
      where stations.restaurant_id = new.restaurant_id
        and lower(btrim(stations.name)) = 'main kitchen'
        and stations.archived_at is null
      order by stations.created_at asc
      limit 1;
    end if;
  end if;

  new.kitchen_station_id := routed_station_id;
  return new;
end;
$$;

drop trigger if exists route_order_item_kitchen_station on public.order_items;
create trigger route_order_item_kitchen_station
before insert on public.order_items
for each row
execute function public.route_order_item_kitchen_station();

create or replace function public.log_kitchen_routing_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  routed_order record;
begin
  for routed_order in
    select
      inserted.restaurant_id,
      inserted.order_id,
      orders.order_source,
      orders.payment_verified_by,
      count(*)::integer as item_count,
      count(distinct inserted.kitchen_station_id)::integer as station_count,
      jsonb_agg(
        jsonb_build_object(
          'order_item_id', inserted.id,
          'menu_item_id', inserted.menu_item_id,
          'kitchen_station_id', inserted.kitchen_station_id,
          'quantity', inserted.quantity
        )
        order by inserted.created_at, inserted.id
      ) as routed_items
    from new_order_items inserted
    join public.orders orders
      on orders.id = inserted.order_id
     and orders.restaurant_id = inserted.restaurant_id
    group by inserted.restaurant_id, inserted.order_id, orders.order_source, orders.payment_verified_by
  loop
    perform public.log_staff_activity(
      routed_order.restaurant_id,
      routed_order.payment_verified_by,
      'kitchen_routing_completed',
      null,
      jsonb_build_object(
        'order_id', routed_order.order_id,
        'order_source', routed_order.order_source,
        'item_count', routed_order.item_count,
        'station_count', routed_order.station_count,
        'items', routed_order.routed_items
      )
    );
  end loop;

  return null;
end;
$$;

drop trigger if exists log_kitchen_routing_completed on public.order_items;
create trigger log_kitchen_routing_completed
after insert on public.order_items
referencing new table as new_order_items
for each statement
execute function public.log_kitchen_routing_completed();

revoke all on function public.route_order_item_kitchen_station() from public, anon, authenticated;
revoke all on function public.log_kitchen_routing_completed() from public, anon, authenticated;

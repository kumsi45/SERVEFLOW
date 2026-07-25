-- Critical routing correction.
-- Menu/category assignment is configuration; order_items.kitchen_station_id is
-- the immutable, tenant-scoped routing snapshot consumed by station queues.

alter table public.kitchen_stations
  add column if not exists is_default boolean not null default false;

-- Establish one data-driven fallback per tenant without using station names.
with ranked as (
  select id, restaurant_id,
    row_number() over (
      partition by restaurant_id
      order by active desc, priority asc, created_at asc, id asc
    ) as position
  from public.kitchen_stations
  where archived_at is null
), missing as (
  select ranked.id
  from ranked
  where ranked.position = 1
    and not exists (
      select 1 from public.kitchen_stations defaults
      where defaults.restaurant_id = ranked.restaurant_id
        and defaults.is_default
        and defaults.archived_at is null
    )
)
update public.kitchen_stations stations
set is_default = true
from missing
where stations.id = missing.id;

create unique index if not exists kitchen_stations_one_default_per_restaurant
on public.kitchen_stations (restaurant_id)
where is_default and archived_at is null;

drop policy if exists menu_items_update_manager_station_assignment
on public.menu_items;
create policy menu_items_update_manager_station_assignment
on public.menu_items
for update
to authenticated
using (
  public.has_staff_role(
    restaurant_id,
    array['manager']::public.restaurant_staff_role[]
  )
)
with check (
  public.has_staff_role(
    restaurant_id,
    array['manager']::public.restaurant_staff_role[]
  )
);

create or replace function public.resolve_kitchen_station_route(
  target_restaurant_id uuid,
  target_menu_item_id uuid
)
returns uuid
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  assigned_station_id uuid;
begin
  if target_restaurant_id is null or target_menu_item_id is null then
    raise exception 'Restaurant and menu item are required for kitchen routing.';
  end if;

  -- Exact tenant-scoped menu assignment always wins.
  select stations.id into assigned_station_id
  from public.menu_items items
  join public.kitchen_stations stations
    on stations.restaurant_id = items.restaurant_id
   and stations.id = items.kitchen_station_id
   and stations.active
   and stations.archived_at is null
  where items.restaurant_id = target_restaurant_id
    and items.id = target_menu_item_id
    and items.archived_at is null
  limit 1;

  if assigned_station_id is not null then return assigned_station_id; end if;

  -- Missing/inactive assignments go to the explicit tenant default.
  select stations.id into assigned_station_id
  from public.kitchen_stations stations
  where stations.restaurant_id = target_restaurant_id
    and stations.is_default
    and stations.active
    and stations.archived_at is null
  order by stations.priority, stations.created_at, stations.id
  limit 1;

  if assigned_station_id is not null then return assigned_station_id; end if;

  -- Legacy tenants without a marked default retain every item in the first
  -- active station queue. Selection is configuration-driven, never name-driven.
  select stations.id into assigned_station_id
  from public.kitchen_stations stations
  where stations.restaurant_id = target_restaurant_id
    and stations.active
    and stations.archived_at is null
  order by stations.priority, stations.created_at, stations.id
  limit 1;

  if assigned_station_id is null then
    raise exception 'Restaurant has no active kitchen station for routing.';
  end if;
  return assigned_station_id;
end;
$$;

create or replace function public.route_order_item_kitchen_station()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Never trust a caller-supplied/stale station. Resolve from the canonical
  -- menu assignment for this restaurant and snapshot it on the order item.
  new.kitchen_station_id := public.resolve_kitchen_station_route(
    new.restaurant_id,
    new.menu_item_id
  );
  return new;
end;
$$;

-- Menu creation without an explicit assignment uses the same data-driven
-- fallback. Legacy keyword/station-name guessing is retired.
create or replace function public.auto_assign_menu_item_kitchen_station()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kitchen_station_id is null then
    new.kitchen_station_id := public.resolve_kitchen_station_route(
      new.restaurant_id,
      new.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists route_order_item_kitchen_station on public.order_items;
create trigger route_order_item_kitchen_station
before insert or update of restaurant_id, menu_item_id
on public.order_items
for each row execute function public.route_order_item_kitchen_station();

-- Correct currently visible work that was snapshotted to a stale/default
-- station before this fix. Completed history remains immutable.
update public.order_items items
set kitchen_station_id = public.resolve_kitchen_station_route(
  items.restaurant_id,
  items.menu_item_id
)
where items.kitchen_status in ('held', 'accepted', 'preparing', 'ready')
  and items.kitchen_station_id is distinct from public.resolve_kitchen_station_route(
    items.restaurant_id,
    items.menu_item_id
  );

-- Owner and manager are the complete assignment authority. Kitchen staff and
-- every other role are rejected by the existing validation trigger.
create or replace function public.validate_menu_item_kitchen_station()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  matching_station public.kitchen_stations%rowtype;
begin
  if new.kitchen_station_id is null then
    new.kitchen_station_id := public.resolve_kitchen_station_route(
      new.restaurant_id,
      new.id
    );
  end if;

  if tg_op = 'INSERT' or new.kitchen_station_id is distinct from old.kitchen_station_id then
    if auth.uid() is not null and not public.has_staff_role(
      new.restaurant_id,
      array['owner','manager']::public.restaurant_staff_role[]
    ) then
      raise exception 'Only restaurant owners and managers may assign kitchen stations.';
    end if;

    select * into matching_station
    from public.kitchen_stations stations
    where stations.id = new.kitchen_station_id
      and stations.restaurant_id = new.restaurant_id
      and stations.active
      and stations.archived_at is null
    limit 1;
    if matching_station.id is null then
      raise exception 'Choose an active kitchen station for this restaurant.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.resolve_kitchen_station_route(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.route_order_item_kitchen_station()
from public, anon, authenticated;
revoke all on function public.auto_assign_menu_item_kitchen_station()
from public, anon, authenticated;

comment on function public.resolve_kitchen_station_route(uuid, uuid) is
  'Canonical tenant-scoped Kitchen Routing Engine: exact menu assignment, explicit default, then deterministic active-station fallback.';

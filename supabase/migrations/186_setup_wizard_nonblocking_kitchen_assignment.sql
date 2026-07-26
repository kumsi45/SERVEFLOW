-- Restaurant onboarding may create starter menu items before the owner has
-- configured kitchen stations. Menu configuration is allowed to remain
-- unassigned; live order routing remains strict and continues to use
-- resolve_kitchen_station_route().

create or replace function public.auto_assign_menu_item_kitchen_station()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_station_id uuid;
begin
  if new.kitchen_station_id is null then
    select stations.id
    into target_station_id
    from public.kitchen_stations stations
    where stations.restaurant_id = new.restaurant_id
      and stations.active
      and stations.archived_at is null
    order by stations.is_default desc, stations.priority, stations.created_at, stations.id
    limit 1;

    new.kitchen_station_id := target_station_id;
  end if;

  return new;
end;
$$;

create or replace function public.validate_menu_item_kitchen_station()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  matching_station public.kitchen_stations%rowtype;
begin
  if tg_op = 'INSERT'
     or new.kitchen_station_id is distinct from old.kitchen_station_id then
    if auth.uid() is not null and not public.has_staff_role(
      new.restaurant_id,
      array['owner','manager']::public.restaurant_staff_role[]
    ) then
      raise exception 'Only restaurant owners and managers may assign kitchen stations.';
    end if;

    -- An unassigned menu item is valid configuration. The strict order-item
    -- routing trigger still prevents an order until an active station exists.
    if new.kitchen_station_id is null then
      return new;
    end if;

    select *
    into matching_station
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

revoke all on function public.auto_assign_menu_item_kitchen_station()
from public, anon, authenticated;
revoke all on function public.validate_menu_item_kitchen_station()
from public, anon, authenticated;

comment on function public.auto_assign_menu_item_kitchen_station() is
  'Assigns an active station when available and otherwise permits deferred owner configuration.';

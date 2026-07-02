-- SERVEFLOW Kitchen Stations Phase 2.
-- Menu item assignment foundation only: no kitchen routing or dashboard behavior.

alter type public.staff_activity_action add value if not exists 'menu_station_assigned';
alter type public.staff_activity_action add value if not exists 'menu_station_changed';

alter table public.menu_items
  add column if not exists kitchen_station_id uuid;

alter table public.menu_items
  drop constraint if exists menu_items_kitchen_station_same_restaurant,
  add constraint menu_items_kitchen_station_same_restaurant
    foreign key (restaurant_id, kitchen_station_id)
    references public.kitchen_stations (restaurant_id, id)
    on delete restrict;

create index if not exists menu_items_kitchen_station_idx
on public.menu_items (restaurant_id, kitchen_station_id)
where kitchen_station_id is not null;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'menu_items'
     ) then
    alter publication supabase_realtime add table public.menu_items;
  end if;
end;
$$;

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

update public.menu_items items
set kitchen_station_id = stations.id
from public.kitchen_stations stations
where items.kitchen_station_id is null
  and stations.restaurant_id = items.restaurant_id
  and lower(btrim(stations.name)) = 'main kitchen'
  and stations.archived_at is null;

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
    raise exception 'Choose a kitchen station for this menu item.';
  end if;

  if tg_op = 'INSERT' or new.kitchen_station_id is distinct from old.kitchen_station_id then
    if not public.has_staff_role(new.restaurant_id, array['owner']::public.restaurant_staff_role[]) then
      raise exception 'Only restaurant owners may assign kitchen stations.';
    end if;

    select *
    into matching_station
    from public.kitchen_stations
    where id = new.kitchen_station_id
      and restaurant_id = new.restaurant_id
      and active = true
      and archived_at is null
    limit 1;

    if matching_station.id is null then
      raise exception 'Choose an active kitchen station for this restaurant.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_menu_item_kitchen_station on public.menu_items;
create trigger validate_menu_item_kitchen_station
before insert or update on public.menu_items
for each row
execute function public.validate_menu_item_kitchen_station();

create or replace function public.log_menu_item_kitchen_station_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_staff_id uuid;
  station_name text;
  previous_station_name text;
  audit_action text;
begin
  if tg_op = 'UPDATE' and new.kitchen_station_id is not distinct from old.kitchen_station_id then
    return new;
  end if;

  select id
  into actor_staff_id
  from public.restaurant_staff
  where restaurant_id = new.restaurant_id
    and user_id = auth.uid()
    and role = 'owner'
    and active = true
  order by created_at asc
  limit 1;

  if actor_staff_id is null then
    return new;
  end if;

  select name
  into station_name
  from public.kitchen_stations
  where id = new.kitchen_station_id
    and restaurant_id = new.restaurant_id;

  if tg_op = 'UPDATE' then
    select name
    into previous_station_name
    from public.kitchen_stations
    where id = old.kitchen_station_id
      and restaurant_id = old.restaurant_id;
  end if;

  audit_action := case when tg_op = 'INSERT' then 'menu_station_assigned' else 'menu_station_changed' end;

  perform public.log_staff_activity(
    new.restaurant_id,
    actor_staff_id,
    audit_action,
    null,
    jsonb_build_object(
      'menu_item_id', new.id,
      'menu_item_name', new.name,
      'station_id', new.kitchen_station_id,
      'station_name', station_name,
      'previous_station_id', case when tg_op = 'UPDATE' then old.kitchen_station_id else null end,
      'previous_station_name', previous_station_name
    )
  );

  return new;
end;
$$;

drop trigger if exists log_menu_item_kitchen_station_assignment on public.menu_items;
create trigger log_menu_item_kitchen_station_assignment
after insert or update of kitchen_station_id on public.menu_items
for each row
execute function public.log_menu_item_kitchen_station_assignment();

revoke all on function public.validate_menu_item_kitchen_station() from public, anon, authenticated;
revoke all on function public.log_menu_item_kitchen_station_assignment() from public, anon, authenticated;

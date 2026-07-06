-- SERVEFLOW Phase 4D.7m Menu Item Auto Station Assignment.
-- Menu creation must not fail because a station was omitted. Manual station
-- assignment still wins. Kitchen routing/dashboard behavior is unchanged.

create or replace function public.ensure_active_main_kitchen_station_for_restaurant(target_restaurant_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_station_id uuid;
begin
  if target_restaurant_id is null then
    raise exception 'Restaurant is required.';
  end if;

  select id
  into target_station_id
  from public.kitchen_stations
  where restaurant_id = target_restaurant_id
    and active = true
    and archived_at is null
    and (
      lower(btrim(name)) = 'main kitchen'
      or lower(name) like '%main%'
    )
  order by
    case when lower(btrim(name)) = 'main kitchen' then 0 else 1 end,
    priority,
    name
  limit 1;

  if target_station_id is not null then
    return target_station_id;
  end if;

  update public.kitchen_stations
  set active = true
  where id = (
    select id
    from public.kitchen_stations
    where restaurant_id = target_restaurant_id
      and archived_at is null
      and (
        lower(btrim(name)) = 'main kitchen'
        or lower(name) like '%main%'
      )
    order by
      case when lower(btrim(name)) = 'main kitchen' then 0 else 1 end,
      priority,
      name
    limit 1
  )
  returning id into target_station_id;

  if target_station_id is not null then
    return target_station_id;
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
  returning id into target_station_id;

  if target_station_id is null then
    update public.kitchen_stations
    set active = true
    where restaurant_id = target_restaurant_id
      and lower(btrim(name)) = 'main kitchen'
      and archived_at is null
    returning id into target_station_id;
  end if;

  if target_station_id is null then
    raise exception 'Main Kitchen could not be created for this restaurant.';
  end if;

  return target_station_id;
end;
$$;

create or replace function public.menu_item_prefers_beverage_station(
  item_name text,
  category_name text default null
)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(item_name, '') || ' ' || coalesce(category_name, '')) ~
    '(^|[^a-z0-9])(coffee|espresso|macchiato|latte|mocha|cappuccino|tea|juices?|smoothies?|cocktails?|mocktails?|drinks?|beverage|soda|cola|water)([^a-z0-9]|$)';
$$;

create or replace function public.resolve_menu_item_kitchen_station(
  target_restaurant_id uuid,
  item_name text,
  target_category_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  category_name text;
  target_station_id uuid;
begin
  if target_restaurant_id is null then
    raise exception 'Restaurant is required.';
  end if;

  if target_category_id is not null then
    select name
    into category_name
    from public.categories
    where id = target_category_id
      and restaurant_id = target_restaurant_id
    limit 1;
  end if;

  if public.menu_item_prefers_beverage_station(item_name, category_name) then
    select id
    into target_station_id
    from public.kitchen_stations
    where restaurant_id = target_restaurant_id
      and active = true
      and archived_at is null
      and (
        lower(btrim(name)) = 'beverage kitchen'
        or lower(name) like '%beverage%'
        or lower(name) like '%drink%'
        or lower(name) like '%bar%'
      )
    order by
      case when lower(btrim(name)) = 'beverage kitchen' then 0 else 1 end,
      priority,
      name
    limit 1;

    if target_station_id is not null then
      return target_station_id;
    end if;
  end if;

  return public.ensure_active_main_kitchen_station_for_restaurant(target_restaurant_id);
end;
$$;

create or replace function public.auto_assign_menu_item_kitchen_station()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kitchen_station_id is null then
    new.kitchen_station_id := public.resolve_menu_item_kitchen_station(
      new.restaurant_id,
      new.name,
      new.category_id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists auto_assign_menu_item_kitchen_station on public.menu_items;
create trigger auto_assign_menu_item_kitchen_station
before insert or update of restaurant_id, name, category_id, kitchen_station_id
on public.menu_items
for each row
execute function public.auto_assign_menu_item_kitchen_station();

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
    new.kitchen_station_id := public.resolve_menu_item_kitchen_station(
      new.restaurant_id,
      new.name,
      new.category_id
    );
  end if;

  if new.kitchen_station_id is null then
    raise exception 'Choose a kitchen station for this menu item.';
  end if;

  if tg_op = 'INSERT' or new.kitchen_station_id is distinct from old.kitchen_station_id then
    if auth.uid() is not null
       and not public.has_staff_role(new.restaurant_id, array['owner']::public.restaurant_staff_role[]) then
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

update public.menu_items items
set kitchen_station_id = public.resolve_menu_item_kitchen_station(items.restaurant_id, items.name, items.category_id)
where items.kitchen_station_id is null;

revoke all on function public.ensure_active_main_kitchen_station_for_restaurant(uuid) from public, anon, authenticated;
revoke all on function public.menu_item_prefers_beverage_station(text, text) from public, anon, authenticated;
revoke all on function public.resolve_menu_item_kitchen_station(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.auto_assign_menu_item_kitchen_station() from public, anon, authenticated;

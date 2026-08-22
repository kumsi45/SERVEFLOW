-- Manager-created Chefs begin unassigned. Kitchen access must not silently
-- rewrite Owner kitchen configuration by assigning the main station.
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

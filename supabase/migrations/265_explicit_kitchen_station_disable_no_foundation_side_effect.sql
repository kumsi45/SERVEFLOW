-- Explicit station management must not manufacture configuration before a
-- disable.  Foundation creation remains available to its existing bootstrap
-- and read-context callers; only the explicit disable branch bypasses it so
-- the Migration 264 trigger is the sole safety authority.

create or replace function public.manage_kitchen_station(
  target_restaurant_id uuid,
  action text,
  station_id uuid default null,
  station_name text default null,
  station_description text default null,
  station_display_color text default '#0f766e',
  station_icon text default 'MK',
  station_priority integer default 100,
  station_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_staff_id uuid;
  normalized_action text := lower(btrim(action));
  normalized_name text := btrim(coalesce(station_name, ''));
  normalized_icon text := upper(btrim(coalesce(station_icon, 'MK')));
  normalized_color text := coalesce(nullif(btrim(station_display_color), ''), '#0f766e');
  affected_station public.kitchen_stations%rowtype;
  assigned_count integer;
  audit_action text;
begin
  if target_restaurant_id is null then
    raise exception 'Restaurant is required.';
  end if;

  if not public.has_staff_role(target_restaurant_id, array['owner']::public.restaurant_staff_role[]) then
    raise exception 'Only restaurant owners may manage kitchen stations.';
  end if;

  actor_staff_id := public.current_owner_staff_id(target_restaurant_id);
  if actor_staff_id is null then
    raise exception 'Only restaurant owners may manage kitchen stations.';
  end if;

  -- Preserve the legacy foundation behaviour for all existing management
  -- actions except Disable.  Disable must evaluate the current configuration
  -- exactly as it exists, allowing Migration 264 to reject the last active
  -- station or unresolved frozen work without a manufactured replacement.
  if normalized_action <> 'disable' then
    perform public.ensure_default_kitchen_station(target_restaurant_id);
  end if;

  if normalized_action in ('create', 'update') then
    if length(normalized_name) = 0 then raise exception 'Station name is required.'; end if;
    if normalized_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Choose a valid display color.'; end if;
    if normalized_icon not in ('MK', 'HD', 'JB', 'BK', 'DS', 'GR', 'TF', 'BR') then raise exception 'Choose a valid station icon.'; end if;
    if station_priority is null or station_priority < 0 or station_priority > 10000 then
      raise exception 'Priority must be between 0 and 10000.';
    end if;
  end if;

  if normalized_action = 'create' then
    insert into public.kitchen_stations (restaurant_id, name, description, display_color, icon, priority, active)
    values (target_restaurant_id, normalized_name, nullif(btrim(coalesce(station_description, '')), ''), normalized_color, normalized_icon, station_priority, coalesce(station_active, true))
    returning * into affected_station;
    audit_action := 'kitchen_station_created';
  elsif normalized_action = 'update' then
    update public.kitchen_stations
    set name = normalized_name,
        description = nullif(btrim(coalesce(station_description, '')), ''),
        display_color = normalized_color,
        icon = normalized_icon,
        priority = station_priority,
        active = coalesce(station_active, true)
    where id = station_id and restaurant_id = target_restaurant_id and archived_at is null
    returning * into affected_station;
    if not found then raise exception 'Kitchen station not found.'; end if;
    audit_action := 'kitchen_station_updated';
  elsif normalized_action in ('disable', 'enable') then
    update public.kitchen_stations
    set active = normalized_action = 'enable'
    where id = station_id and restaurant_id = target_restaurant_id and archived_at is null
    returning * into affected_station;
    if not found then raise exception 'Kitchen station not found.'; end if;
    audit_action := case when affected_station.active then 'kitchen_station_enabled' else 'kitchen_station_disabled' end;
  elsif normalized_action = 'delete' then
    select count(*)::integer into assigned_count
    from public.menu_items
    where restaurant_id = target_restaurant_id and kitchen_station_id = station_id and archived_at is null;
    if assigned_count > 0 then raise exception 'This station is currently in use.'; end if;
    delete from public.kitchen_stations
    where id = station_id and restaurant_id = target_restaurant_id and archived_at is null
    returning * into affected_station;
    if not found then raise exception 'Kitchen station not found.'; end if;
    audit_action := 'kitchen_station_deleted';
  else
    raise exception 'Unsupported kitchen station action.';
  end if;

  perform public.log_staff_activity(
    target_restaurant_id, actor_staff_id, audit_action, null,
    jsonb_build_object(
      'station_id', affected_station.id,
      'station_name', affected_station.name,
      'active', affected_station.active,
      'priority', affected_station.priority,
      'icon', affected_station.icon,
      'display_color', affected_station.display_color
    )
  );

  return jsonb_build_object('ok', true, 'station_id', affected_station.id, 'action', normalized_action);
exception
  when unique_violation then raise exception 'Station name must be unique inside this restaurant.';
  when foreign_key_violation then raise exception 'This station is currently in use.';
end;
$$;

revoke all on function public.manage_kitchen_station(uuid, text, uuid, text, text, text, text, integer, boolean)
from public, anon;
grant execute on function public.manage_kitchen_station(uuid, text, uuid, text, text, text, text, integer, boolean)
to authenticated;

comment on function public.manage_kitchen_station(uuid, text, uuid, text, text, text, text, integer, boolean) is
  'Owner station management. Explicit Disable preserves existing configuration and relies on Migration 264 safety guards.';

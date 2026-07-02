-- SERVEFLOW Kitchen Stations Phase 1.
-- Foundation only: station CRUD, tenant isolation, default station, and audit logging.
-- This intentionally does not route orders or assign menu items.

alter type public.staff_activity_action add value if not exists 'kitchen_station_created';
alter type public.staff_activity_action add value if not exists 'kitchen_station_updated';
alter type public.staff_activity_action add value if not exists 'kitchen_station_disabled';
alter type public.staff_activity_action add value if not exists 'kitchen_station_enabled';
alter type public.staff_activity_action add value if not exists 'kitchen_station_deleted';

create table if not exists public.kitchen_stations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  description text,
  display_color text not null default '#0f766e',
  icon text not null default 'MK',
  priority integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (restaurant_id, id),
  constraint kitchen_stations_name_not_blank check (length(btrim(name)) > 0),
  constraint kitchen_stations_display_color_hex check (display_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint kitchen_stations_icon_not_blank check (length(btrim(icon)) > 0),
  constraint kitchen_stations_priority_range check (priority >= 0 and priority <= 10000)
);

create unique index if not exists kitchen_stations_restaurant_name_unique
on public.kitchen_stations (restaurant_id, lower(btrim(name)))
where archived_at is null;

create index if not exists kitchen_stations_restaurant_sort_idx
on public.kitchen_stations (restaurant_id, priority asc, name asc)
where archived_at is null;

alter table public.kitchen_stations enable row level security;

revoke all on public.kitchen_stations from anon, authenticated;
grant select on public.kitchen_stations to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'kitchen_stations'
     ) then
    alter publication supabase_realtime add table public.kitchen_stations;
  end if;
end;
$$;

drop policy if exists kitchen_stations_select_owner_same_restaurant on public.kitchen_stations;
create policy kitchen_stations_select_owner_same_restaurant
on public.kitchen_stations
for select
to authenticated
using (
  public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])
);

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

create or replace function public.set_kitchen_stations_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_kitchen_stations_updated_at on public.kitchen_stations;
create trigger set_kitchen_stations_updated_at
before update on public.kitchen_stations
for each row
execute function public.set_kitchen_stations_updated_at();

create or replace function public.ensure_default_kitchen_station(target_restaurant_id uuid)
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

  if not public.has_staff_role(target_restaurant_id, array['owner']::public.restaurant_staff_role[]) then
    raise exception 'Only restaurant owners may manage kitchen stations.';
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

create or replace function public.get_owner_kitchen_stations(target_restaurant_id uuid)
returns table (
  id uuid,
  restaurant_id uuid,
  name text,
  description text,
  display_color text,
  icon text,
  priority integer,
  active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  assigned_menu_items bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_restaurant_id is null then
    raise exception 'Restaurant is required.';
  end if;

  if not public.has_staff_role(target_restaurant_id, array['owner']::public.restaurant_staff_role[]) then
    raise exception 'Only restaurant owners may view kitchen stations.';
  end if;

  perform public.ensure_default_kitchen_station(target_restaurant_id);

  return query
  select
    stations.id,
    stations.restaurant_id,
    stations.name,
    stations.description,
    stations.display_color,
    stations.icon,
    stations.priority,
    stations.active,
    stations.created_at,
    stations.updated_at,
    count(items.id)::bigint as assigned_menu_items
  from public.kitchen_stations stations
  left join public.menu_items items
    on items.restaurant_id = stations.restaurant_id
   and items.kitchen_station_id = stations.id
   and items.archived_at is null
  where stations.restaurant_id = target_restaurant_id
    and stations.archived_at is null
  group by stations.id
  order by stations.priority asc, stations.name asc;
end;
$$;

create or replace function public.current_owner_staff_id(target_restaurant_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id
  from public.restaurant_staff
  where restaurant_id = target_restaurant_id
    and user_id = auth.uid()
    and role = 'owner'
    and active = true
  order by created_at asc
  limit 1
$$;

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

  perform public.ensure_default_kitchen_station(target_restaurant_id);

  if normalized_action in ('create', 'update') then
    if length(normalized_name) = 0 then
      raise exception 'Station name is required.';
    end if;
    if normalized_color !~ '^#[0-9A-Fa-f]{6}$' then
      raise exception 'Choose a valid display color.';
    end if;
    if normalized_icon not in ('MK', 'HD', 'JB', 'BK', 'DS', 'GR', 'TF', 'BR') then
      raise exception 'Choose a valid station icon.';
    end if;
    if station_priority is null or station_priority < 0 or station_priority > 10000 then
      raise exception 'Priority must be between 0 and 10000.';
    end if;
  end if;

  if normalized_action = 'create' then
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
      normalized_name,
      nullif(btrim(coalesce(station_description, '')), ''),
      normalized_color,
      normalized_icon,
      station_priority,
      coalesce(station_active, true)
    )
    returning * into affected_station;

    audit_action := 'kitchen_station_created';
  elsif normalized_action = 'update' then
    update public.kitchen_stations
    set
      name = normalized_name,
      description = nullif(btrim(coalesce(station_description, '')), ''),
      display_color = normalized_color,
      icon = normalized_icon,
      priority = station_priority,
      active = coalesce(station_active, true)
    where id = station_id
      and restaurant_id = target_restaurant_id
      and archived_at is null
    returning * into affected_station;

    if not found then
      raise exception 'Kitchen station not found.';
    end if;

    audit_action := 'kitchen_station_updated';
  elsif normalized_action in ('disable', 'enable') then
    update public.kitchen_stations
    set active = normalized_action = 'enable'
    where id = station_id
      and restaurant_id = target_restaurant_id
      and archived_at is null
    returning * into affected_station;

    if not found then
      raise exception 'Kitchen station not found.';
    end if;

    audit_action := case when affected_station.active then 'kitchen_station_enabled' else 'kitchen_station_disabled' end;
  elsif normalized_action = 'delete' then
    select count(*)::integer
    into assigned_count
    from public.menu_items
    where restaurant_id = target_restaurant_id
      and kitchen_station_id = station_id
      and archived_at is null;

    if assigned_count > 0 then
      raise exception 'This station is currently in use.';
    end if;

    delete from public.kitchen_stations
    where id = station_id
      and restaurant_id = target_restaurant_id
      and archived_at is null
    returning * into affected_station;

    if not found then
      raise exception 'Kitchen station not found.';
    end if;

    audit_action := 'kitchen_station_deleted';
  else
    raise exception 'Unsupported kitchen station action.';
  end if;

  perform public.log_staff_activity(
    target_restaurant_id,
    actor_staff_id,
    audit_action,
    null,
    jsonb_build_object(
      'station_id', affected_station.id,
      'station_name', affected_station.name,
      'active', affected_station.active,
      'priority', affected_station.priority,
      'icon', affected_station.icon,
      'display_color', affected_station.display_color
    )
  );

  return jsonb_build_object(
    'ok', true,
    'station_id', affected_station.id,
    'action', normalized_action
  );
exception
  when unique_violation then
    raise exception 'Station name must be unique inside this restaurant.';
  when foreign_key_violation then
    raise exception 'This station is currently in use.';
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

revoke all on function public.set_kitchen_stations_updated_at() from public, anon, authenticated;
revoke all on function public.current_owner_staff_id(uuid) from public, anon, authenticated;
revoke all on function public.ensure_default_kitchen_station(uuid) from public, anon;
revoke all on function public.get_owner_kitchen_stations(uuid) from public, anon;
revoke all on function public.manage_kitchen_station(uuid, text, uuid, text, text, text, text, integer, boolean) from public, anon;

grant execute on function public.ensure_default_kitchen_station(uuid) to authenticated;
grant execute on function public.get_owner_kitchen_stations(uuid) to authenticated;
grant execute on function public.manage_kitchen_station(uuid, text, uuid, text, text, text, text, integer, boolean) to authenticated;

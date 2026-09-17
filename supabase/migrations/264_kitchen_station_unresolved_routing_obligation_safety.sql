-- Kitchen Station Safety K1.3.
-- A station can be taken out of routing only when no frozen item can still
-- need that station.  This is deliberately broader than the visible KDS queue.

create index if not exists order_items_station_unresolved_routing_idx
on public.order_items (restaurant_id, kitchen_station_id)
where kitchen_station_id is not null
  and kitchen_status not in ('completed', 'cancelled');

-- Every order-item route and a disable of that exact station take this same
-- transaction-scoped lock.  The two-key form scopes it to one tenant/station.
create or replace function public.resolve_kitchen_station_route(
  target_restaurant_id uuid,
  target_menu_item_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  configured_station_id uuid;
  candidate_station_id uuid;
begin
  if target_restaurant_id is null or target_menu_item_id is null then
    raise exception 'Restaurant and menu item are required for kitchen routing.';
  end if;

  select items.kitchen_station_id
  into configured_station_id
  from public.menu_items items
  where items.restaurant_id = target_restaurant_id
    and items.id = target_menu_item_id
    and items.archived_at is null;

  if configured_station_id is not null then
    perform pg_advisory_xact_lock(
      hashtext(target_restaurant_id::text),
      hashtext(configured_station_id::text)
    );
    select stations.id into candidate_station_id
    from public.kitchen_stations stations
    where stations.restaurant_id = target_restaurant_id
      and stations.id = configured_station_id
      and stations.active
      and stations.archived_at is null;
    if candidate_station_id is not null then return candidate_station_id; end if;
  end if;

  select stations.id into candidate_station_id
  from public.kitchen_stations stations
  where stations.restaurant_id = target_restaurant_id
    and stations.is_default
    and stations.active
    and stations.archived_at is null
  order by stations.priority, stations.created_at, stations.id
  limit 1;

  if candidate_station_id is not null then
    perform pg_advisory_xact_lock(
      hashtext(target_restaurant_id::text),
      hashtext(candidate_station_id::text)
    );
    select stations.id into candidate_station_id
    from public.kitchen_stations stations
    where stations.restaurant_id = target_restaurant_id
      and stations.id = candidate_station_id
      and stations.is_default
      and stations.active
      and stations.archived_at is null;
    if candidate_station_id is not null then return candidate_station_id; end if;
  end if;

  select stations.id into candidate_station_id
  from public.kitchen_stations stations
  where stations.restaurant_id = target_restaurant_id
    and stations.active
    and stations.archived_at is null
  order by stations.priority, stations.created_at, stations.id
  limit 1;

  if candidate_station_id is null then
    raise exception 'Restaurant has no active kitchen station for routing.';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(target_restaurant_id::text),
    hashtext(candidate_station_id::text)
  );
  select stations.id into candidate_station_id
  from public.kitchen_stations stations
  where stations.restaurant_id = target_restaurant_id
    and stations.id = candidate_station_id
    and stations.active
    and stations.archived_at is null;
  if candidate_station_id is null then
    return public.resolve_kitchen_station_route(
      target_restaurant_id,
      target_menu_item_id
    );
  end if;
  return candidate_station_id;
end;
$$;

create or replace function public.enforce_kitchen_station_disable_obligations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.active and not new.active then
    -- Serializes concurrent disables inside one restaurant.  Routing does not
    -- take this tenant lock, so ordinary order creation remains station-scoped.
    perform pg_advisory_xact_lock(
      hashtext(old.restaurant_id::text),
      hashtext('kitchen_station_lifecycle')
    );
    perform pg_advisory_xact_lock(
      hashtext(old.restaurant_id::text),
      hashtext(old.id::text)
    );

    if not exists (
      select 1
      from public.kitchen_stations stations
      where stations.restaurant_id = old.restaurant_id
        and stations.id <> old.id
        and stations.active
        and stations.archived_at is null
    ) then
      raise exception 'LAST_ACTIVE_KITCHEN_STATION';
    end if;

    if exists (
      select 1
      from public.order_items items
      where items.restaurant_id = old.restaurant_id
        and items.kitchen_station_id = old.id
        and items.kitchen_status not in ('completed', 'cancelled')
    ) then
      raise exception 'KITCHEN_STATION_HAS_UNRESOLVED_WORK';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_kitchen_station_disable_obligations()
from public, anon, authenticated;

drop trigger if exists enforce_kitchen_station_disable_obligations
on public.kitchen_stations;
create trigger enforce_kitchen_station_disable_obligations
before update of active on public.kitchen_stations
for each row execute function public.enforce_kitchen_station_disable_obligations();

comment on index public.order_items_station_unresolved_routing_idx is
  'K1.3 station-disable lookup: frozen items that are not canonically terminal.';
comment on function public.enforce_kitchen_station_disable_obligations() is
  'Rejects ACTIVE to INACTIVE unless another active station remains and no frozen item is held, accepted, preparing, or ready.';

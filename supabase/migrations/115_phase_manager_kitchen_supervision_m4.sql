-- ServeFlow Manager Dashboard M4: kitchen supervision hardening.
-- Every manager kitchen operation is explicitly restaurant-scoped.

alter type public.staff_activity_action add value if not exists 'manager_kitchen_message_sent';
alter type public.staff_activity_action add value if not exists 'manager_kitchen_staff_called';

insert into public.kitchen_stations (restaurant_id, name, description, display_color, icon, priority, active)
select restaurants.id, defaults.name, defaults.description, defaults.display_color, defaults.icon, defaults.priority, true
from public.restaurants
cross join (
  values
    ('Grill', 'Default grill station', '#dc2626', 'GR', 10),
    ('Fry', 'Default fry station', '#f59e0b', 'FR', 20),
    ('Beverage', 'Default beverage station', '#2563eb', 'BV', 30),
    ('Bakery', 'Default bakery station', '#a16207', 'BK', 40),
    ('Dessert', 'Default dessert station', '#db2777', 'DS', 50)
) as defaults(name, description, display_color, icon, priority)
on conflict do nothing;

create or replace function public.manager_prioritize_kitchen_order(target_restaurant_id uuid, target_order_id uuid, priority_delta integer default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders;
  manager_staff_id uuid;
begin
  manager_staff_id := public.get_manager_staff_id(target_restaurant_id);
  if manager_staff_id is null then raise exception 'Permission denied.'; end if;

  select * into target_order
  from public.orders
  where id = target_order_id
    and restaurant_id = target_restaurant_id
  for update;
  if target_order.id is null then raise exception 'Order not found.'; end if;
  if target_order.status::text in ('completed', 'cancelled') then raise exception 'Completed orders cannot be modified by managers.'; end if;

  update public.orders
  set kitchen_priority = greatest(0, least(100, kitchen_priority + coalesce(priority_delta, 1))),
      updated_at = now()
  where id = target_order.id
    and restaurant_id = target_restaurant_id;

  insert into public.staff_activity_log (restaurant_id, action, performed_by_staff_id, details)
  values (
    target_restaurant_id,
    'manager_kitchen_order_prioritized',
    manager_staff_id,
    jsonb_build_object('order_id', target_order.id, 'priority_delta', priority_delta, 'timestamp', now())
  );
end;
$$;

create or replace function public.manager_reassign_kitchen_batch(target_restaurant_id uuid, target_order_id uuid, source_station_id uuid, destination_station_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders;
  manager_staff_id uuid;
  moved_count integer;
begin
  manager_staff_id := public.get_manager_staff_id(target_restaurant_id);
  if manager_staff_id is null then raise exception 'Permission denied.'; end if;

  select * into target_order
  from public.orders
  where id = target_order_id
    and restaurant_id = target_restaurant_id
  for update;
  if target_order.id is null then raise exception 'Order not found.'; end if;
  if target_order.status::text in ('completed', 'cancelled') then raise exception 'Completed orders cannot be modified by managers.'; end if;

  if not exists (select 1 from public.kitchen_stations where id = source_station_id and restaurant_id = target_restaurant_id and archived_at is null) then
    raise exception 'Source station not found.';
  end if;
  if not exists (select 1 from public.kitchen_stations where id = destination_station_id and restaurant_id = target_restaurant_id and active = true and archived_at is null and paused_at is null) then
    raise exception 'Destination station not available.';
  end if;

  update public.order_items
  set kitchen_station_id = destination_station_id
  where restaurant_id = target_restaurant_id
    and order_id = target_order.id
    and kitchen_station_id = source_station_id
    and kitchen_status in ('paid', 'preparing', 'ready');

  get diagnostics moved_count = row_count;

  insert into public.staff_activity_log (restaurant_id, action, performed_by_staff_id, details)
  values (
    target_restaurant_id,
    'manager_kitchen_batch_reassigned',
    manager_staff_id,
    jsonb_build_object('order_id', target_order.id, 'source_station_id', source_station_id, 'destination_station_id', destination_station_id, 'moved_count', moved_count, 'timestamp', now())
  );
end;
$$;

create or replace function public.manager_set_kitchen_station_paused(target_restaurant_id uuid, target_station_id uuid, requested_paused boolean, reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_station public.kitchen_stations;
  manager_staff_id uuid;
begin
  manager_staff_id := public.get_manager_staff_id(target_restaurant_id);
  if manager_staff_id is null then raise exception 'Permission denied.'; end if;

  select * into target_station
  from public.kitchen_stations
  where id = target_station_id
    and restaurant_id = target_restaurant_id
    and archived_at is null
  for update;
  if target_station.id is null then raise exception 'Kitchen station not found.'; end if;

  update public.kitchen_stations
  set paused_at = case when requested_paused then now() else null end,
      paused_by_staff_id = case when requested_paused then manager_staff_id else null end,
      pause_reason = case when requested_paused then nullif(btrim(reason), '') else null end,
      updated_at = now()
  where id = target_station.id
    and restaurant_id = target_restaurant_id;

  insert into public.staff_activity_log (restaurant_id, action, performed_by_staff_id, details)
  values (
    target_restaurant_id,
    case when requested_paused then 'manager_kitchen_station_paused' else 'manager_kitchen_station_resumed' end,
    manager_staff_id,
    jsonb_build_object('station_id', target_station.id, 'station_name', target_station.name, 'reason', reason, 'timestamp', now())
  );
end;
$$;

create or replace function public.manager_send_kitchen_message(target_restaurant_id uuid, target_station_id uuid, message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_station public.kitchen_stations;
  manager_staff_id uuid;
  normalized_message text;
begin
  manager_staff_id := public.get_manager_staff_id(target_restaurant_id);
  if manager_staff_id is null then raise exception 'Permission denied.'; end if;

  normalized_message := nullif(left(btrim(coalesce(message, '')), 500), '');
  if normalized_message is null then raise exception 'Message is required.'; end if;

  select * into target_station
  from public.kitchen_stations
  where id = target_station_id
    and restaurant_id = target_restaurant_id
    and archived_at is null;
  if target_station.id is null then raise exception 'Kitchen station not found.'; end if;

  insert into public.staff_activity_log (restaurant_id, action, performed_by_staff_id, details)
  values (
    target_restaurant_id,
    'manager_kitchen_message_sent',
    manager_staff_id,
    jsonb_build_object('station_id', target_station.id, 'station_name', target_station.name, 'message', normalized_message, 'timestamp', now())
  );
end;
$$;

create or replace function public.manager_call_additional_kitchen_staff(target_restaurant_id uuid, target_station_id uuid, reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_station public.kitchen_stations;
  manager_staff_id uuid;
begin
  manager_staff_id := public.get_manager_staff_id(target_restaurant_id);
  if manager_staff_id is null then raise exception 'Permission denied.'; end if;

  select * into target_station
  from public.kitchen_stations
  where id = target_station_id
    and restaurant_id = target_restaurant_id
    and archived_at is null;
  if target_station.id is null then raise exception 'Kitchen station not found.'; end if;

  insert into public.staff_activity_log (restaurant_id, action, performed_by_staff_id, details)
  values (
    target_restaurant_id,
    'manager_kitchen_staff_called',
    manager_staff_id,
    jsonb_build_object('station_id', target_station.id, 'station_name', target_station.name, 'reason', nullif(btrim(coalesce(reason, '')), ''), 'timestamp', now())
  );
end;
$$;

revoke all on function public.manager_prioritize_kitchen_order(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.manager_reassign_kitchen_batch(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.manager_set_kitchen_station_paused(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.manager_send_kitchen_message(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.manager_call_additional_kitchen_staff(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.manager_prioritize_kitchen_order(uuid, uuid, integer) to authenticated;
grant execute on function public.manager_reassign_kitchen_batch(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.manager_set_kitchen_station_paused(uuid, uuid, boolean, text) to authenticated;
grant execute on function public.manager_send_kitchen_message(uuid, uuid, text) to authenticated;
grant execute on function public.manager_call_additional_kitchen_staff(uuid, uuid, text) to authenticated;

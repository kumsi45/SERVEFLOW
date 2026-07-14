-- ServeFlow Manager Kitchen Supervision.
-- Manager operational controls only: station pause/resume, order priority, batch reassignment.

alter table public.kitchen_stations
  add column if not exists paused_at timestamptz,
  add column if not exists paused_by_staff_id uuid references public.restaurant_staff(id) on delete set null,
  add column if not exists pause_reason text;

alter table public.orders
  add column if not exists kitchen_priority integer not null default 0;

create index if not exists orders_restaurant_kitchen_priority_idx
on public.orders (restaurant_id, kitchen_priority desc, created_at asc)
where status in ('paid'::public.order_status, 'preparing'::public.order_status, 'ready'::public.order_status);

alter type public.staff_activity_action add value if not exists 'manager_kitchen_order_prioritized';
alter type public.staff_activity_action add value if not exists 'manager_kitchen_batch_reassigned';
alter type public.staff_activity_action add value if not exists 'manager_kitchen_station_paused';
alter type public.staff_activity_action add value if not exists 'manager_kitchen_station_resumed';

create or replace function public.get_manager_staff_id(target_restaurant_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select staff.id
  from public.restaurant_staff staff
  where staff.restaurant_id = target_restaurant_id
    and staff.user_id = auth.uid()
    and staff.active = true
    and staff.role::text = 'manager'
  limit 1
$$;

create or replace function public.manager_prioritize_kitchen_order(target_order_id uuid, priority_delta integer default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders;
  manager_staff_id uuid;
begin
  select * into target_order from public.orders where id = target_order_id;
  if target_order.id is null then raise exception 'Order not found.'; end if;

  manager_staff_id := public.get_manager_staff_id(target_order.restaurant_id);
  if manager_staff_id is null then raise exception 'Only active managers can prioritize kitchen orders.'; end if;

  update public.orders
  set kitchen_priority = greatest(0, least(100, kitchen_priority + coalesce(priority_delta, 1))),
      updated_at = now()
  where id = target_order.id;

  insert into public.staff_activity_log (restaurant_id, action, performed_by_staff_id, details)
  values (target_order.restaurant_id, 'manager_kitchen_order_prioritized', manager_staff_id, jsonb_build_object('order_id', target_order.id, 'priority_delta', priority_delta));
end;
$$;

create or replace function public.manager_reassign_kitchen_batch(target_order_id uuid, source_station_id uuid, destination_station_id uuid)
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
  select * into target_order from public.orders where id = target_order_id;
  if target_order.id is null then raise exception 'Order not found.'; end if;

  manager_staff_id := public.get_manager_staff_id(target_order.restaurant_id);
  if manager_staff_id is null then raise exception 'Only active managers can reassign kitchen batches.'; end if;

  if not exists (select 1 from public.kitchen_stations where id = source_station_id and restaurant_id = target_order.restaurant_id and archived_at is null) then
    raise exception 'Source station not found.';
  end if;
  if not exists (select 1 from public.kitchen_stations where id = destination_station_id and restaurant_id = target_order.restaurant_id and active = true and archived_at is null) then
    raise exception 'Destination station not available.';
  end if;

  update public.order_items
  set kitchen_station_id = destination_station_id
  where restaurant_id = target_order.restaurant_id
    and order_id = target_order.id
    and kitchen_station_id = source_station_id
    and kitchen_status in ('paid', 'preparing', 'ready');

  get diagnostics moved_count = row_count;

  insert into public.staff_activity_log (restaurant_id, action, performed_by_staff_id, details)
  values (target_order.restaurant_id, 'manager_kitchen_batch_reassigned', manager_staff_id, jsonb_build_object('order_id', target_order.id, 'source_station_id', source_station_id, 'destination_station_id', destination_station_id, 'moved_count', moved_count));
end;
$$;

create or replace function public.manager_set_kitchen_station_paused(target_station_id uuid, requested_paused boolean, reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_station public.kitchen_stations;
  manager_staff_id uuid;
begin
  select * into target_station from public.kitchen_stations where id = target_station_id;
  if target_station.id is null then raise exception 'Kitchen station not found.'; end if;

  manager_staff_id := public.get_manager_staff_id(target_station.restaurant_id);
  if manager_staff_id is null then raise exception 'Only active managers can pause or resume kitchen stations.'; end if;

  update public.kitchen_stations
  set paused_at = case when requested_paused then now() else null end,
      paused_by_staff_id = case when requested_paused then manager_staff_id else null end,
      pause_reason = case when requested_paused then nullif(btrim(reason), '') else null end,
      updated_at = now()
  where id = target_station.id;

  insert into public.staff_activity_log (restaurant_id, action, performed_by_staff_id, details)
  values (
    target_station.restaurant_id,
    case when requested_paused then 'manager_kitchen_station_paused' else 'manager_kitchen_station_resumed' end,
    manager_staff_id,
    jsonb_build_object('station_id', target_station.id, 'station_name', target_station.name, 'reason', reason)
  );
end;
$$;

revoke all on function public.get_manager_staff_id(uuid) from public, anon, authenticated;
revoke all on function public.manager_prioritize_kitchen_order(uuid, integer) from public, anon, authenticated;
revoke all on function public.manager_reassign_kitchen_batch(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.manager_set_kitchen_station_paused(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.manager_prioritize_kitchen_order(uuid, integer) to authenticated;
grant execute on function public.manager_reassign_kitchen_batch(uuid, uuid, uuid) to authenticated;
grant execute on function public.manager_set_kitchen_station_paused(uuid, boolean, text) to authenticated;

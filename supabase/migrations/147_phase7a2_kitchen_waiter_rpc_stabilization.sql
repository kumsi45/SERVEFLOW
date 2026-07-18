-- Repair the renamed waiter RPC's self-qualified parameters.
do $$
declare definition text;
begin
  definition := pg_get_functiondef(
    'public.submit_waiter_order_batch_phase7a1_base(text,text,text,text,text,jsonb,uuid)'::regprocedure
  );
  definition := replace(
    definition,
    'submit_waiter_order_batch.',
    'submit_waiter_order_batch_phase7a1_base.'
  );
  execute definition;
end;
$$;

-- One selector owns every kitchen transition. It first honors the exact batch;
-- if an old serialized batch key differs, it falls back inside the same
-- restaurant/order/station only.
create or replace function public.transition_station_kitchen_items(
  target_order_id uuid,
  target_station_id uuid,
  target_batch_key text,
  from_statuses text[],
  to_status text,
  acting_staff_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare changed integer;
begin
  update public.order_items items
  set kitchen_status = to_status,
      kitchen_preparation_started_at = case when to_status = 'preparing' then coalesce(items.kitchen_preparation_started_at, now()) else items.kitchen_preparation_started_at end,
      kitchen_preparation_started_by = case when to_status = 'preparing' then coalesce(items.kitchen_preparation_started_by, acting_staff_id) else items.kitchen_preparation_started_by end,
      kitchen_ready_marked_at = case when to_status = 'ready' then coalesce(items.kitchen_ready_marked_at, now()) else items.kitchen_ready_marked_at end,
      kitchen_ready_marked_by = case when to_status = 'ready' then coalesce(items.kitchen_ready_marked_by, acting_staff_id) else items.kitchen_ready_marked_by end,
      kitchen_completed_at = case when to_status = 'completed' then coalesce(items.kitchen_completed_at, now()) else items.kitchen_completed_at end,
      kitchen_completed_by = case when to_status = 'completed' then coalesce(items.kitchen_completed_by, acting_staff_id) else items.kitchen_completed_by end
  from public.orders orders
  where orders.id = target_order_id
    and orders.restaurant_id = items.restaurant_id
    and items.order_id = orders.id
    and items.kitchen_station_id = target_station_id
    and items.kitchen_status::text = any(from_statuses)
    and (
      target_batch_key is null
      or ((extract(epoch from items.appended_at) * 1000000)::bigint)::text = target_batch_key
    );
  get diagnostics changed = row_count;

  if changed = 0 and target_batch_key is not null then
    update public.order_items items
    set kitchen_status = to_status,
        kitchen_preparation_started_at = case when to_status = 'preparing' then coalesce(items.kitchen_preparation_started_at, now()) else items.kitchen_preparation_started_at end,
        kitchen_preparation_started_by = case when to_status = 'preparing' then coalesce(items.kitchen_preparation_started_by, acting_staff_id) else items.kitchen_preparation_started_by end,
        kitchen_ready_marked_at = case when to_status = 'ready' then coalesce(items.kitchen_ready_marked_at, now()) else items.kitchen_ready_marked_at end,
        kitchen_ready_marked_by = case when to_status = 'ready' then coalesce(items.kitchen_ready_marked_by, acting_staff_id) else items.kitchen_ready_marked_by end,
        kitchen_completed_at = case when to_status = 'completed' then coalesce(items.kitchen_completed_at, now()) else items.kitchen_completed_at end,
        kitchen_completed_by = case when to_status = 'completed' then coalesce(items.kitchen_completed_by, acting_staff_id) else items.kitchen_completed_by end
    from public.orders orders
    where orders.id = target_order_id
      and orders.restaurant_id = items.restaurant_id
      and items.order_id = orders.id
      and items.kitchen_station_id = target_station_id
      and items.kitchen_status::text = any(from_statuses);
    get diagnostics changed = row_count;
  end if;
  return changed;
end;
$$;

revoke all on function public.transition_station_kitchen_items(uuid,uuid,text,text[],text,uuid) from public, anon, authenticated;

create or replace function public.resolve_kitchen_action_context(
  target_order_id uuid,
  requested_station_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare target public.orders; staff public.restaurant_staff; station_id uuid;
begin
  select * into target from public.orders where id=target_order_id for update;
  if target.id is null then raise exception 'Order not found.'; end if;
  select * into staff from public.restaurant_staff
  where restaurant_id=target.restaurant_id and user_id=auth.uid() and active
    and role::text in ('kitchen','owner') order by created_at limit 1;
  if staff.id is null then raise exception 'Only active kitchen staff and owners may update kitchen tickets.'; end if;
  if staff.role::text='kitchen' then
    station_id := staff.assigned_kitchen_station_id;
    if station_id is null then
      station_id := public.ensure_main_kitchen_station_for_restaurant(target.restaurant_id);
      update public.restaurant_staff set assigned_kitchen_station_id=station_id where id=staff.id;
    end if;
  else
    station_id := requested_station_id;
  end if;
  if station_id is null or not exists(select 1 from public.kitchen_stations s where s.id=station_id and s.restaurant_id=target.restaurant_id and s.active and s.archived_at is null)
    then raise exception 'Kitchen station not found.'; end if;
  return jsonb_build_object('staff_id',staff.id,'station_id',station_id);
end;
$$;

revoke all on function public.resolve_kitchen_action_context(uuid,uuid) from public, anon, authenticated;

create or replace function public.start_order_preparation(target_order_id uuid,target_station_id uuid default null,target_batch_key text default null)
returns public.orders language plpgsql security definer set search_path=public as $$
declare context jsonb; changed integer;
begin
  context:=public.resolve_kitchen_action_context(target_order_id,target_station_id);
  changed:=public.transition_station_kitchen_items(target_order_id,(context->>'station_id')::uuid,target_batch_key,array['paid','held'],'preparing',(context->>'staff_id')::uuid);
  if changed=0 then raise exception 'No pending items were found for this station.'; end if;
  return public.derive_order_status_from_items(target_order_id,(context->>'staff_id')::uuid);
end;$$;

create or replace function public.mark_order_ready(target_order_id uuid,target_station_id uuid default null,target_batch_key text default null)
returns public.orders language plpgsql security definer set search_path=public as $$
declare context jsonb; changed integer;
begin
  context:=public.resolve_kitchen_action_context(target_order_id,target_station_id);
  changed:=public.transition_station_kitchen_items(target_order_id,(context->>'station_id')::uuid,target_batch_key,array['preparing'],'ready',(context->>'staff_id')::uuid);
  if changed=0 then raise exception 'No preparing items were found for this station.'; end if;
  return public.derive_order_status_from_items(target_order_id,(context->>'staff_id')::uuid);
end;$$;

create or replace function public.mark_order_completed(target_order_id uuid,target_station_id uuid default null,target_batch_key text default null)
returns public.orders language plpgsql security definer set search_path=public as $$
declare context jsonb; changed integer;
begin
  context:=public.resolve_kitchen_action_context(target_order_id,target_station_id);
  changed:=public.transition_station_kitchen_items(target_order_id,(context->>'station_id')::uuid,target_batch_key,array['ready'],'completed',(context->>'staff_id')::uuid);
  if changed=0 then raise exception 'No ready items were found for this station.'; end if;
  return public.derive_order_status_from_items(target_order_id,(context->>'staff_id')::uuid);
end;$$;

revoke all on function public.start_order_preparation(uuid,uuid,text) from public,anon;
revoke all on function public.mark_order_ready(uuid,uuid,text) from public,anon;
revoke all on function public.mark_order_completed(uuid,uuid,text) from public,anon;
grant execute on function public.start_order_preparation(uuid,uuid,text) to authenticated;
grant execute on function public.mark_order_ready(uuid,uuid,text) to authenticated;
grant execute on function public.mark_order_completed(uuid,uuid,text) to authenticated;

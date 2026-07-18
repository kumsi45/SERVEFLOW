-- Phase 5 production stabilization: repair functions reported invalid by
-- plpgsql_check without changing their public signatures or permissions.

-- These legacy bodies use parameter names that also exist as column names.
-- Compile-time directives are embedded in the existing definitions so no
-- superuser-only database setting and no signature change is required.
do $stabilize$
declare
  target_signature text;
  conflict_mode text;
  definition text;
begin
  for target_signature, conflict_mode in
    select * from (values
      ('public.manager_assign_customer_waiter(uuid,uuid,uuid)', 'use_variable'),
      ('public.request_order_payment_retry(uuid,text)', 'use_variable'),
      ('public.get_station_kitchen_orders(uuid,uuid,boolean,boolean)', 'use_column'),
      ('public.get_public_qr_canonical_lifecycle(text,text,text,uuid)', 'use_column')
    ) as targets(signature, mode)
  loop
    definition := pg_get_functiondef(target_signature::regprocedure);
    definition := replace(
      definition,
      E'AS $function$\n',
      E'AS $function$\n#variable_conflict ' || conflict_mode || E'\n'
    );
    if definition not like '%#variable_conflict%' then
      raise exception 'Could not stabilize function definition for %', target_signature;
    end if;
    execute definition;
  end loop;
end
$stabilize$;

create or replace function public.manager_set_kitchen_station_paused(
  target_station_id uuid,
  requested_paused boolean,
  reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_station public.kitchen_stations;
  manager_staff_id uuid;
  activity_action public.staff_activity_action;
begin
  select * into target_station
  from public.kitchen_stations
  where id = target_station_id;
  if target_station.id is null then raise exception 'Kitchen station not found.'; end if;

  manager_staff_id := public.get_manager_staff_id(target_station.restaurant_id);
  if manager_staff_id is null then raise exception 'Only active managers can pause or resume kitchen stations.'; end if;

  update public.kitchen_stations
  set paused_at = case when requested_paused then now() else null end,
      paused_by_staff_id = case when requested_paused then manager_staff_id else null end,
      pause_reason = case when requested_paused then nullif(btrim(reason), '') else null end,
      updated_at = now()
  where id = target_station.id;

  activity_action := case when requested_paused
    then 'manager_kitchen_station_paused'::public.staff_activity_action
    else 'manager_kitchen_station_resumed'::public.staff_activity_action
  end;
  insert into public.staff_activity_log (restaurant_id, action, performed_by_staff_id, details)
  values (target_station.restaurant_id, activity_action, manager_staff_id,
    jsonb_build_object('station_id', target_station.id, 'station_name', target_station.name, 'reason', reason));
end;
$$;

create or replace function public.manager_set_kitchen_station_paused(
  target_restaurant_id uuid,
  target_station_id uuid,
  requested_paused boolean,
  reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_station public.kitchen_stations;
  manager_staff_id uuid;
  activity_action public.staff_activity_action;
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

  activity_action := case when requested_paused
    then 'manager_kitchen_station_paused'::public.staff_activity_action
    else 'manager_kitchen_station_resumed'::public.staff_activity_action
  end;
  insert into public.staff_activity_log (restaurant_id, action, performed_by_staff_id, details)
  values (target_restaurant_id, activity_action, manager_staff_id,
    jsonb_build_object('station_id', target_station.id, 'station_name', target_station.name, 'reason', reason, 'timestamp', now()));
end;
$$;

revoke all on function public.manager_set_kitchen_station_paused(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.manager_set_kitchen_station_paused(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.manager_set_kitchen_station_paused(uuid, boolean, text) to authenticated;
grant execute on function public.manager_set_kitchen_station_paused(uuid, uuid, boolean, text) to authenticated;

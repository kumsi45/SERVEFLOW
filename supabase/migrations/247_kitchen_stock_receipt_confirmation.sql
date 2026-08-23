-- Kitchen stock receipt read model and station-safe confirmation.
-- Stock remains deducted exactly once by issue_kitchen_inventory_request.

create or replace function public.get_kitchen_stock_receipts(
  target_restaurant_id uuid,
  target_history_limit integer default 20
)
returns table(
  request_id uuid,
  item_name text,
  issued_quantity numeric,
  unit text,
  station_id uuid,
  station_name text,
  storage_location_name text,
  requested_at timestamptz,
  issued_at timestamptz,
  issued_by_name text,
  confirmed_at timestamptz,
  confirmed_by_name text,
  request_status text
)
language plpgsql stable security definer set search_path=public as $$
declare
  actor public.restaurant_staff;
begin
  select * into actor
  from public.restaurant_staff staff
  where staff.restaurant_id=target_restaurant_id
    and staff.user_id=auth.uid()
    and staff.active=true
    and staff.role::text in ('kitchen','owner')
  order by case staff.role::text when 'owner' then 0 else 1 end
  limit 1;

  if actor.id is null then
    raise exception 'Kitchen stock request access denied.';
  end if;

  return query
  select
    request.id,
    request.item_name,
    request.issued_quantity,
    request.unit,
    request.station_id,
    station.name,
    storage.name,
    request.requested_at,
    request.issued_at,
    issuer.display_name,
    request.confirmed_at,
    confirmer.display_name,
    request.status
  from public.kitchen_inventory_requests request
  left join public.kitchen_stations station
    on station.id=request.station_id and station.restaurant_id=request.restaurant_id
  left join public.restaurant_staff issuer
    on issuer.id=request.issued_by_staff_id and issuer.restaurant_id=request.restaurant_id
  left join public.restaurant_staff confirmer
    on confirmer.id=request.confirmed_by_staff_id and confirmer.restaurant_id=request.restaurant_id
  left join public.inventory_movements movement
    on movement.id=request.inventory_movement_id and movement.restaurant_id=request.restaurant_id
  left join public.inventory_storage_locations storage
    on storage.id=movement.storage_location_id and storage.restaurant_id=request.restaurant_id
  where request.restaurant_id=target_restaurant_id
    and request.status in ('issued','delivered','rejected','unable_to_fulfill')
    and (
      actor.role::text='owner'
      or (
        actor.assigned_kitchen_station_id is not null
        and request.station_id=actor.assigned_kitchen_station_id
      )
    )
  order by
    case when request.status='issued' then 0 else 1 end,
    coalesce(request.confirmed_at,request.issued_at,request.requested_at) desc
  limit greatest(1,least(coalesce(target_history_limit,20),100));
end $$;

create or replace function public.confirm_kitchen_inventory_request_receipt(
  target_restaurant_id uuid,
  target_request_id uuid
)
returns void language plpgsql security definer set search_path=public as $$
declare
  actor public.restaurant_staff;
  request public.kitchen_inventory_requests;
  now_at timestamptz:=now();
begin
  select * into actor from public.restaurant_staff
  where restaurant_id=target_restaurant_id
    and user_id=auth.uid()
    and active=true
    and role::text in ('kitchen','owner')
  order by case role::text when 'owner' then 0 else 1 end limit 1;
  if actor.id is null then raise exception 'Kitchen receipt confirmation access denied.'; end if;

  select * into request from public.kitchen_inventory_requests
  where id=target_request_id and restaurant_id=target_restaurant_id for update;
  if request.id is null then raise exception 'Request not found.'; end if;
  if actor.role::text='kitchen' and (
    actor.assigned_kitchen_station_id is null
    or request.station_id is distinct from actor.assigned_kitchen_station_id
  ) then
    raise exception 'Kitchen receipt confirmation access denied for this station.';
  end if;
  if request.status<>'issued' then
    raise exception 'Request was already confirmed or is not awaiting Kitchen confirmation.';
  end if;
  if request.inventory_movement_id is null or request.issued_by_staff_id is null or request.issued_at is null then
    raise exception 'Issued request provenance is incomplete.';
  end if;
  if not exists(
    select 1 from public.inventory_movements movement
    where movement.id=request.inventory_movement_id
      and movement.restaurant_id=target_restaurant_id
      and movement.inventory_item_id=request.inventory_item_id
      and movement.movement_type='stock_out'
      and movement.quantity=request.issued_quantity
  ) then
    raise exception 'Issued inventory movement is invalid.';
  end if;

  update public.kitchen_inventory_requests set
    status='delivered',
    confirmed_by_staff_id=actor.id,
    confirmed_at=now_at,
    delivered_at=now_at,
    updated_at=now_at
  where id=request.id and restaurant_id=target_restaurant_id;

  insert into public.inventory_request_events(
    restaurant_id,request_id,actor_staff_id,event_type,from_status,to_status,details
  ) values(
    target_restaurant_id,request.id,actor.id,'confirmed',request.status,'delivered',
    jsonb_build_object(
      'confirmed_by_staff_id',actor.id,
      'inventory_movement_id',request.inventory_movement_id
    )
  );
end $$;

revoke all on function public.get_kitchen_stock_receipts(uuid,integer) from public,anon,authenticated;
revoke all on function public.confirm_kitchen_inventory_request_receipt(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_kitchen_stock_receipts(uuid,integer) to authenticated,service_role;
grant execute on function public.confirm_kitchen_inventory_request_receipt(uuid,uuid) to authenticated,service_role;

comment on function public.get_kitchen_stock_receipts(uuid,integer) is
  'Returns station-authorized Kitchen stock receipts and recent history.';
comment on function public.confirm_kitchen_inventory_request_receipt(uuid,uuid) is
  'Confirms an authorized Kitchen station receipt without changing inventory stock.';

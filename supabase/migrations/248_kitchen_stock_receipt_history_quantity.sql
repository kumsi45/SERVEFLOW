-- Preserve a truthful quantity in Kitchen request history when no issue occurred.

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
    coalesce(request.issued_quantity,request.quantity),
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

revoke all on function public.get_kitchen_stock_receipts(uuid,integer) from public,anon,authenticated;
grant execute on function public.get_kitchen_stock_receipts(uuid,integer) to authenticated,service_role;

comment on function public.get_kitchen_stock_receipts(uuid,integer) is
  'Returns station-authorized Kitchen stock receipts with authoritative issued or requested history quantity.';

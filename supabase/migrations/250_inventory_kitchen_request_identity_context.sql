-- Give authorized Inventory/Manager users the human context for Kitchen requests without
-- broadening restaurant_staff or kitchen_stations RLS visibility.

create or replace function public.get_inventory_kitchen_request_context(target_restaurant_id uuid)
returns table(request_id uuid,station_name text,requested_by_name text)
language plpgsql stable security definer set search_path=public as $$
declare
  actor_role text;
begin
  select staff.role::text into actor_role
  from public.restaurant_staff staff
  where staff.restaurant_id=target_restaurant_id and staff.user_id=auth.uid() and staff.active=true
    and staff.role::text in ('owner','manager','inventory_officer')
  order by case staff.role::text when 'owner' then 0 when 'manager' then 1 else 2 end
  limit 1;
  if actor_role is null then raise exception 'Inventory request context access denied.'; end if;

  return query
  select request.id,station.name,requester.display_name
  from public.kitchen_inventory_requests request
  left join public.kitchen_stations station
    on station.restaurant_id=request.restaurant_id and station.id=request.station_id
  join public.restaurant_staff requester
    on requester.restaurant_id=request.restaurant_id and requester.id=request.requested_by_staff_id
  where request.restaurant_id=target_restaurant_id
    and (
      actor_role in ('owner','manager')
      or request.status in ('accepted','issued','unable_to_fulfill','delivered')
    )
  order by request.requested_at desc;
end $$;

revoke all on function public.get_inventory_kitchen_request_context(uuid)
  from public,anon,authenticated;
grant execute on function public.get_inventory_kitchen_request_context(uuid)
  to authenticated,service_role;

comment on function public.get_inventory_kitchen_request_context(uuid) is
  'Returns same-tenant station and requester display names for Kitchen requests visible to authorized Inventory, Manager, or Owner staff.';

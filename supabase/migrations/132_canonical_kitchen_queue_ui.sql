-- Canonical kitchen UI projection. The mature station queue continues to own
-- station/batch routing, while this wrapper exposes operational status only.

create or replace function public.get_canonical_station_kitchen_orders(
  target_restaurant_id uuid,
  target_station_id uuid default null,
  include_all_stations boolean default false,
  log_queue_view boolean default true
)
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select
    (to_jsonb(queue_row) - 'payment_method' - 'payment_verified_at')
    || jsonb_build_object(
      'operational_status', orders.operational_status,
      'status', orders.operational_status
    )
  from public.get_station_kitchen_orders(
    target_restaurant_id,
    target_station_id,
    include_all_stations,
    log_queue_view
  ) queue_row
  join public.orders
    on orders.id = queue_row.id
   and orders.restaurant_id = target_restaurant_id;
$$;

revoke all on function public.get_canonical_station_kitchen_orders(uuid, uuid, boolean, boolean)
from public, anon;
grant execute on function public.get_canonical_station_kitchen_orders(uuid, uuid, boolean, boolean)
to authenticated;

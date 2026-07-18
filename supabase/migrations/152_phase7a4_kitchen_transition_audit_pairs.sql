-- Order lifecycle audit timestamps and actors are an inseparable pair.
-- Migration 150 preserved the timestamps but omitted their matching staff IDs.
create or replace function public.derive_order_status_from_items(
  target_order_id uuid,
  acting_staff_id uuid default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders;
  next_operational_status text;
begin
  select * into target_order
  from public.orders
  where orders.id = target_order_id
  for update;

  if target_order.id is null then
    raise exception 'Order not found.';
  end if;

  -- The item reconciliation trigger may set `served` before this function
  -- runs. Re-derive served orders so completion audit fields are populated.
  if target_order.operational_status = 'closed' then
    return target_order;
  end if;

  select case
    when count(*) = 0 then target_order.operational_status
    when bool_and(items.kitchen_status = 'completed') then 'served'
    when bool_and(items.kitchen_status in ('ready', 'completed')) then 'ready'
    when bool_or(items.kitchen_status in ('preparing', 'ready', 'completed')) then 'preparing'
    when bool_or(items.kitchen_status = 'accepted') then 'accepted'
    else target_order.operational_status
  end
  into next_operational_status
  from public.order_items items
  where items.restaurant_id = target_order.restaurant_id
    and items.order_id = target_order.id;

  update public.orders
  set operational_status = next_operational_status,
      preparation_started_at = case
        when next_operational_status = 'preparing'
          then coalesce(preparation_started_at, now())
        else preparation_started_at
      end,
      preparation_started_by = case
        when next_operational_status = 'preparing'
          then coalesce(preparation_started_by, acting_staff_id)
        else preparation_started_by
      end,
      ready_marked_at = case
        when next_operational_status = 'ready'
          then coalesce(ready_marked_at, now())
        else ready_marked_at
      end,
      ready_marked_by = case
        when next_operational_status = 'ready'
          then coalesce(ready_marked_by, acting_staff_id)
        else ready_marked_by
      end,
      completed_at = case
        when next_operational_status = 'served'
          then coalesce(completed_at, now())
        else completed_at
      end,
      completed_by = case
        when next_operational_status = 'served'
          then coalesce(completed_by, acting_staff_id)
        else completed_by
      end,
      updated_at = now()
  where id = target_order.id
    and restaurant_id = target_order.restaurant_id
  returning * into target_order;

  return target_order;
end;
$$;

revoke all on function public.derive_order_status_from_items(uuid, uuid)
from public, anon, authenticated;

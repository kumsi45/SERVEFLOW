-- Complete the location-lock contract for a cashier add-on that was submitted
-- just before another transaction legitimately released the old session.
-- The items become the first batch of a new valid session instead of being
-- attached to the closed session or lost behind a stale-state error.

create or replace function public.append_items_to_order(
  target_order_id uuid,
  requested_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  hint public.orders;
  actor public.restaurant_staff;
  payload jsonb;
begin
  select * into hint from public.orders where id = target_order_id;
  if hint.id is null then raise exception 'Order not found.'; end if;

  select * into actor from public.restaurant_staff staff
  where staff.restaurant_id = hint.restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role = 'cashier'
  limit 1;
  if actor.id is null then raise exception 'Only active cashiers may append order items.'; end if;

  if hint.table_id is not null and nullif(trim(hint.table_number), '') is not null then
    perform pg_advisory_xact_lock(public.service_location_session_lock_key(
      hint.restaurant_id,
      hint.table_number
    ));
  end if;

  select * into hint from public.orders orders
  where orders.id = target_order_id
    and orders.restaurant_id = hint.restaurant_id;

  if hint.dining_session_status <> 'open' or hint.table_released_at is not null then
    payload := public.create_cashier_order_phase234_base(
      hint.restaurant_id,
      hint.table_number,
      hint.payment_method,
      requested_items
    );
    return payload || jsonb_build_object(
      'session_action', 'new_after_release',
      'previous_order_id', target_order_id
    );
  end if;

  return public.append_items_to_order_phase234_base(target_order_id, requested_items);
end;
$$;

revoke all on function public.append_items_to_order(uuid, jsonb)
from public, anon;
grant execute on function public.append_items_to_order(uuid, jsonb)
to authenticated;

comment on function public.append_items_to_order(uuid, jsonb) is
  'Tenant-scoped cashier add-on. Serializes with service-location release and opens a new valid session if release wins the race.';


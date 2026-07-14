-- Phase W9.5: move an entire active dining session to another physical table.
-- Invoices, payments, order items, kitchen tickets, and history remain attached
-- to the same orders.id and therefore are neither copied nor rewritten.

create or replace function public.move_waiter_dining_session(
  target_order_id uuid,
  destination_table_id uuid
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_waiter public.restaurant_staff;
  target_order public.orders;
  destination public.restaurant_tables;
  moved_order public.orders;
  source_table_number integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to move a dining session.';
  end if;
  if target_order_id is null or destination_table_id is null then
    raise exception 'Dining session and destination table are required.';
  end if;

  select * into target_order
  from public.orders orders
  where orders.id = target_order_id
  for update;

  if target_order.id is null then raise exception 'Dining session not found.'; end if;
  if target_order.dining_session_status <> 'open' or target_order.table_released_at is not null then
    raise exception 'Only an active dining session can move tables.';
  end if;

  select * into acting_waiter
  from public.restaurant_staff staff
  where staff.restaurant_id = target_order.restaurant_id
    and staff.user_id = auth.uid()
    and staff.role = 'waiter'
    and staff.active = true
  limit 1;
  if acting_waiter.id is null then raise exception 'Only an active waiter may move this dining session.'; end if;

  select * into destination
  from public.restaurant_tables tables
  where tables.restaurant_id = target_order.restaurant_id
    and tables.id = destination_table_id
    and tables.active = true;
  if destination.id is null then raise exception 'Destination table is not available.'; end if;
  if destination.id = target_order.table_id then return target_order; end if;

  source_table_number := nullif(target_order.table_number, '')::integer;
  -- Stable lock order prevents two waiters swapping tables concurrently.
  perform pg_advisory_xact_lock(hashtextextended(target_order.restaurant_id::text || ':' || least(source_table_number, destination.table_number)::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(target_order.restaurant_id::text || ':' || greatest(source_table_number, destination.table_number)::text, 0));

  if exists (
    select 1 from public.orders occupied
    where occupied.restaurant_id = target_order.restaurant_id
      and occupied.table_id = destination.id
      and occupied.id <> target_order.id
      and occupied.dining_session_status = 'open'
      and occupied.table_released_at is null
  ) then
    raise exception 'Destination table is currently occupied.';
  end if;

  update public.orders
  set table_id = destination.id,
      table_number = destination.table_number::text,
      dining_session_last_activity_at = now(),
      updated_at = now()
  where id = target_order.id
    and restaurant_id = target_order.restaurant_id
  returning * into moved_order;

  perform public.log_staff_activity(
    target_order.restaurant_id,
    acting_waiter.id,
    'dining_session_table_moved',
    target_order.id,
    jsonb_build_object(
      'from_table_number', target_order.table_number,
      'to_table_number', destination.table_number,
      'dining_session_id', target_order.id
    )
  );

  return moved_order;
end;
$$;

revoke all on function public.move_waiter_dining_session(uuid, uuid) from public, anon;
grant execute on function public.move_waiter_dining_session(uuid, uuid) to authenticated, service_role;


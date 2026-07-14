-- Phase W9.5: merge two open table sessions into the destination session.
-- Invoice IDs, payment records, kitchen ticket numbers, and item IDs are preserved.

create or replace function public.merge_waiter_dining_sessions(
  source_order_id uuid,
  destination_order_id uuid
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_waiter public.restaurant_staff;
  source_order public.orders;
  destination_order public.orders;
  merged_order public.orders;
  invoice_offset integer;
begin
  if auth.uid() is null then raise exception 'Authentication is required to merge tables.'; end if;
  if source_order_id is null or destination_order_id is null or source_order_id = destination_order_id then
    raise exception 'Choose two different active dining sessions.';
  end if;

  -- UUID lock order prevents reciprocal merge deadlocks.
  perform pg_advisory_xact_lock(hashtextextended(least(source_order_id::text, destination_order_id::text), 0));
  perform pg_advisory_xact_lock(hashtextextended(greatest(source_order_id::text, destination_order_id::text), 0));

  select * into source_order from public.orders where id = source_order_id for update;
  select * into destination_order from public.orders where id = destination_order_id for update;
  if source_order.id is null or destination_order.id is null then raise exception 'Dining session not found.'; end if;
  if source_order.restaurant_id <> destination_order.restaurant_id then raise exception 'Tables must belong to the same restaurant.'; end if;
  if source_order.dining_session_status <> 'open' or destination_order.dining_session_status <> 'open'
     or source_order.table_released_at is not null or destination_order.table_released_at is not null then
    raise exception 'Only two active dining sessions can be merged.';
  end if;

  select * into acting_waiter from public.restaurant_staff staff
  where staff.restaurant_id = source_order.restaurant_id and staff.user_id = auth.uid()
    and staff.role = 'waiter' and staff.active = true limit 1;
  if acting_waiter.id is null then raise exception 'Only an active waiter may merge tables.'; end if;

  if exists (select 1 from public.dining_session_bills bills where bills.dining_session_id in (source_order.id, destination_order.id)) then
    raise exception 'A table with a printed final bill cannot be merged.';
  end if;
  if exists (select 1 from public.public_order_feedback feedback where feedback.order_id in (source_order.id, destination_order.id)) then
    raise exception 'A table with submitted feedback cannot be merged.';
  end if;

  select coalesce(max(invoice_number), 0) into invoice_offset
  from public.order_invoices where restaurant_id = destination_order.restaurant_id and order_id = destination_order.id;

  update public.order_invoices invoices
  set invoice_number = invoices.invoice_number + invoice_offset,
      updated_at = now()
  where invoices.restaurant_id = source_order.restaurant_id and invoices.order_id = source_order.id;

  update public.order_invoices set order_id = destination_order.id, updated_at = now()
  where restaurant_id = source_order.restaurant_id and order_id = source_order.id;
  update public.order_items set order_id = destination_order.id
  where restaurant_id = source_order.restaurant_id and order_id = source_order.id;
  update public.receipt_generation_events set order_id = destination_order.id
  where restaurant_id = source_order.restaurant_id and order_id = source_order.id;
  update public.shift_activity_logs set order_id = destination_order.id where order_id = source_order.id;

  delete from public.kitchen_order_station_progress progress
  where progress.restaurant_id = source_order.restaurant_id
    and progress.order_id in (source_order.id, destination_order.id);

  update public.orders
  set total_price = (select coalesce(sum(items.price * items.quantity), 0) from public.order_items items where items.restaurant_id = destination_order.restaurant_id and items.order_id = destination_order.id),
      customer_name = nullif(concat_ws(' + ', nullif(trim(destination_order.customer_name), ''), nullif(trim(source_order.customer_name), '')), ''),
      customer_phone = nullif(concat_ws(' + ', nullif(trim(destination_order.customer_phone), ''), nullif(trim(source_order.customer_phone), '')), ''),
      dining_session_opened_at = least(destination_order.dining_session_opened_at, source_order.dining_session_opened_at),
      dining_session_last_activity_at = greatest(destination_order.dining_session_last_activity_at, source_order.dining_session_last_activity_at, now()),
      updated_at = now()
  where id = destination_order.id and restaurant_id = destination_order.restaurant_id;

  update public.orders
  set dining_session_status = 'closed', dining_session_closed_at = now(), dining_session_close_reason = 'merged_into_table_' || destination_order.table_number,
      table_released_at = now(), total_price = 0, updated_at = now()
  where id = source_order.id and restaurant_id = source_order.restaurant_id;

  perform public.refresh_kitchen_order_station_progress(destination_order.id);
  merged_order := public.derive_order_status_from_items(destination_order.id, acting_waiter.id);

  perform public.log_staff_activity(source_order.restaurant_id, acting_waiter.id, 'dining_sessions_merged', destination_order.id,
    jsonb_build_object('source_order_id', source_order.id, 'source_table_number', source_order.table_number, 'destination_order_id', destination_order.id, 'destination_table_number', destination_order.table_number));

  return merged_order;
end;
$$;

revoke all on function public.merge_waiter_dining_sessions(uuid, uuid) from public, anon;
grant execute on function public.merge_waiter_dining_sessions(uuid, uuid) to authenticated, service_role;


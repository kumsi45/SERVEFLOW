-- Fix kitchen workflow audit FKs.
-- The *_by columns on orders reference restaurant_staff.id, not auth.users.id.
-- This migration restores all kitchen transitions to store the acting staff row id.

create or replace function public.start_order_preparation(target_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_user_id uuid := auth.uid();
  acting_staff public.restaurant_staff;
  target_order public.orders;
  updated_order public.orders;
begin
  if caller_user_id is null then
    raise exception 'Authentication is required to start order preparation.';
  end if;

  select *
  into target_order
  from public.orders
  where id = target_order_id;

  if target_order.id is null then
    raise exception 'Order not found.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = caller_user_id
    and restaurant_id = target_order.restaurant_id
    and active = true
    and role in ('kitchen', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active kitchen staff and owners may start order preparation.';
  end if;

  if target_order.status::text <> 'paid' then
    raise exception 'Only paid orders may be started by kitchen.';
  end if;

  update public.orders
  set
    status = 'preparing',
    preparation_started_at = now(),
    preparation_started_by = acting_staff.id
  where id = target_order.id
    and restaurant_id = target_order.restaurant_id
    and status::text = 'paid'
  returning * into updated_order;

  if updated_order.id is null then
    raise exception 'Order preparation could not be started.';
  end if;

  if to_regprocedure('public.log_staff_activity(uuid, uuid, text, uuid, jsonb)') is not null then
    perform public.log_staff_activity(
      target_order.restaurant_id,
      caller_user_id,
      'start_preparation',
      target_order.id,
      jsonb_build_object('table_number', updated_order.table_number, 'staff_id', acting_staff.id)
    );
  end if;

  return updated_order;
end;
$$;

create or replace function public.mark_order_ready(target_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_user_id uuid := auth.uid();
  acting_staff public.restaurant_staff;
  target_order public.orders;
  updated_order public.orders;
begin
  if caller_user_id is null then
    raise exception 'Authentication is required to mark an order ready.';
  end if;

  select *
  into target_order
  from public.orders
  where id = target_order_id;

  if target_order.id is null then
    raise exception 'Order not found.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = caller_user_id
    and restaurant_id = target_order.restaurant_id
    and active = true
    and role in ('kitchen', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active kitchen staff and owners may mark orders ready.';
  end if;

  if target_order.status::text <> 'preparing' then
    raise exception 'Only preparing orders may be marked ready.';
  end if;

  update public.orders
  set
    status = 'ready',
    ready_marked_at = now(),
    ready_marked_by = acting_staff.id
  where id = target_order.id
    and restaurant_id = target_order.restaurant_id
    and status::text = 'preparing'
  returning * into updated_order;

  if updated_order.id is null then
    raise exception 'Order could not be marked ready.';
  end if;

  if to_regprocedure('public.log_staff_activity(uuid, uuid, text, uuid, jsonb)') is not null then
    perform public.log_staff_activity(
      target_order.restaurant_id,
      caller_user_id,
      'mark_ready',
      target_order.id,
      jsonb_build_object('table_number', updated_order.table_number, 'staff_id', acting_staff.id)
    );
  end if;

  return updated_order;
end;
$$;

create or replace function public.mark_order_completed(target_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_user_id uuid := auth.uid();
  acting_staff public.restaurant_staff;
  target_order public.orders;
  updated_order public.orders;
begin
  if caller_user_id is null then
    raise exception 'Authentication is required to complete an order.';
  end if;

  select *
  into target_order
  from public.orders
  where id = target_order_id;

  if target_order.id is null then
    raise exception 'Order not found.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = caller_user_id
    and restaurant_id = target_order.restaurant_id
    and active = true
    and role in ('kitchen', 'cashier', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active restaurant staff may complete orders.';
  end if;

  if target_order.status::text <> 'ready' then
    raise exception 'Only ready orders may be completed.';
  end if;

  update public.orders
  set
    status = 'completed',
    completed_at = now(),
    completed_by = acting_staff.id
  where id = target_order.id
    and restaurant_id = target_order.restaurant_id
    and status::text = 'ready'
  returning * into updated_order;

  if updated_order.id is null then
    raise exception 'Order could not be completed.';
  end if;

  if to_regprocedure('public.log_staff_activity(uuid, uuid, text, uuid, jsonb)') is not null then
    perform public.log_staff_activity(
      target_order.restaurant_id,
      caller_user_id,
      'complete_order',
      target_order.id,
      jsonb_build_object('table_number', updated_order.table_number, 'staff_id', acting_staff.id)
    );
  end if;

  return updated_order;
end;
$$;

revoke all on function public.start_order_preparation(uuid) from public;
revoke all on function public.mark_order_ready(uuid) from public;
revoke all on function public.mark_order_completed(uuid) from public;

grant execute on function public.start_order_preparation(uuid) to authenticated;
grant execute on function public.mark_order_ready(uuid) to authenticated;
grant execute on function public.mark_order_completed(uuid) to authenticated;

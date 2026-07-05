-- SERVEFLOW Phase 4B.1.
-- Ensure QR payment approval enters the existing kitchen station pipeline
-- in the same transaction as the payment status update.

create or replace function public.approve_order_payment(target_order_id uuid)
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
    raise exception 'Authentication is required to approve payment.';
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
    and role in ('cashier', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers and owners may approve payment.';
  end if;

  if target_order.payment_verified_at is not null then
    raise exception 'Order payment is already verified.';
  end if;

  if target_order.status::text = 'pending_payment' then
    update public.orders
    set
      status = 'paid',
      payment_verified_at = now(),
      payment_verified_by = acting_staff.id
    where id = target_order.id
      and restaurant_id = target_order.restaurant_id
      and status::text = 'pending_payment'
      and payment_verified_at is null
    returning * into updated_order;
  elsif target_order.order_source = 'cashier' and target_order.status::text = 'ready' then
    update public.orders
    set
      payment_verified_at = now(),
      payment_verified_by = acting_staff.id
    where id = target_order.id
      and restaurant_id = target_order.restaurant_id
      and order_source = 'cashier'
      and status::text = 'ready'
      and payment_verified_at is null
    returning * into updated_order;
  else
    raise exception 'Only pending payment orders or ready cashier orders may be approved.';
  end if;

  if updated_order.id is null then
    raise exception 'Order payment could not be approved.';
  end if;

  updated_order := public.derive_order_status_from_items(updated_order.id, acting_staff.id);

  if to_regprocedure('public.log_staff_activity(uuid, uuid, text, uuid, jsonb)') is not null then
    perform public.log_staff_activity(
      target_order.restaurant_id,
      caller_user_id,
      'approve_payment',
      target_order.id,
      jsonb_build_object(
        'order_total', updated_order.total_price,
        'payment_method', updated_order.payment_method,
        'table_number', updated_order.table_number,
        'staff_id', acting_staff.id
      )
    );
  end if;

  return updated_order;
end;
$$;

revoke all on function public.approve_order_payment(uuid) from public;
grant execute on function public.approve_order_payment(uuid) to authenticated;

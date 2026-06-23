-- Fix cashier payment approval audit FK.
-- orders.payment_verified_by references restaurant_staff.id, not auth.users.id.
-- A later ad-hoc fix accidentally wrote auth.uid() into payment_verified_by,
-- which violates orders_payment_verified_by_same_restaurant.

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

  if target_order.status::text <> 'pending_payment' then
    raise exception 'Only pending payment orders may be approved.';
  end if;

  update public.orders
  set
    status = 'paid',
    payment_verified_at = now(),
    payment_verified_by = acting_staff.id
  where id = target_order.id
    and restaurant_id = target_order.restaurant_id
    and status::text = 'pending_payment'
  returning * into updated_order;

  if updated_order.id is null then
    raise exception 'Order payment could not be approved.';
  end if;

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

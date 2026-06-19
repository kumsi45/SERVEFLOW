-- SERVEFLOW Phase 4 Step 2 cashier payment approval.
-- Generated only. Do not apply automatically.
-- This phase creates cashier approval infrastructure only; no kitchen dashboard, realtime, or payment integrations.

create or replace function public.approve_order_payment(target_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  target_order public.orders;
  updated_order public.orders;
begin
  if auth.uid() is null then
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
  where user_id = auth.uid()
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

  return updated_order;
end;
$$;

revoke all on function public.approve_order_payment(uuid) from public;
grant execute on function public.approve_order_payment(uuid) to authenticated;

-- Cashier POS orders are immediate-payment orders. Restaurant hold/mixed
-- timing applies only to authenticated waiter orders; assigning after_meal to
-- a cashier order makes the lifecycle trigger reject an otherwise valid POS
-- order before its menu items can be created.

create or replace function public.resolve_order_payment_timing(
  target_restaurant_id uuid,
  target_order_source text
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    -- Customer QR and cashier POS orders always pass through payment first.
    when coalesce(target_order_source, '') in ('public_qr', 'cashier')
      then 'before_kitchen'
    -- Deferred timing remains exclusive to authenticated waiter orders. The
    -- lifecycle trigger validates waiter identity before accepting the hold.
    when coalesce(target_order_source, '') = 'waiter'
      and restaurants.payment_policy = 'hold_payment'
      then 'after_meal'
    when coalesce(target_order_source, '') = 'waiter'
      and restaurants.payment_policy = 'mixed'
      then restaurants.mixed_waiter_payment_timing
    else 'before_kitchen'
  end
  from public.restaurants
  where restaurants.id = target_restaurant_id
$$;

revoke all on function public.resolve_order_payment_timing(uuid, text)
  from public, anon;
grant execute on function public.resolve_order_payment_timing(uuid, text)
  to authenticated, service_role;

comment on function public.resolve_order_payment_timing(uuid, text) is
  'Derives canonical payment timing by source: QR/cashier before kitchen; authenticated waiter orders may use restaurant deferred policy.';

-- Fix owner payment-policy updates for the current restaurants schema.
-- restaurants intentionally has no updated_at column.

create or replace function public.set_restaurant_payment_policy(
  target_restaurant_id uuid,
  requested_policy text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if requested_policy not in ('pay_before_kitchen', 'hold_payment', 'mixed') then
    raise exception 'Invalid payment policy.';
  end if;

  if not public.has_staff_role(
    target_restaurant_id,
    array['owner']::public.restaurant_staff_role[]
  ) then
    raise exception 'Only the restaurant owner may change payment policy.';
  end if;

  update public.restaurants
  set payment_policy = requested_policy
  where id = target_restaurant_id;

  if not found then
    raise exception 'Restaurant not found.';
  end if;

  return requested_policy;
end;
$$;

revoke all on function public.set_restaurant_payment_policy(uuid, text) from public, anon;
grant execute on function public.set_restaurant_payment_policy(uuid, text) to authenticated;

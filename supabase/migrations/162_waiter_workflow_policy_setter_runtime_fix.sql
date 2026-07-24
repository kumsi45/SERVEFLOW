-- The production restaurants table does not expose updated_at. Keep the
-- official two-mode policy setter compatible with the canonical schema.
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
  if requested_policy not in ('pay_before_kitchen', 'kitchen_before_payment') then
    raise exception 'Waiter workflow must be Pay Before Kitchen or Kitchen Before Payment.';
  end if;
  if not public.has_staff_role(
    target_restaurant_id,
    array['owner']::public.restaurant_staff_role[]
  ) then
    raise exception 'Only the restaurant owner may change the waiter workflow.';
  end if;

  update public.restaurants
  set payment_policy = requested_policy
  where id = target_restaurant_id;

  if not found then raise exception 'Restaurant not found.'; end if;
  return requested_policy;
end;
$$;

revoke all on function public.set_restaurant_payment_policy(uuid, text)
  from public, anon;
grant execute on function public.set_restaurant_payment_policy(uuid, text)
  to authenticated, service_role;

-- ServeFlow V1 supports customer QR, waiter, and cashier order entry only.
-- The legacy authenticated generic customer RPC has no table/QR authority and
-- represents no approved service mode. Preserve its API shape for stale
-- clients, but fail closed before any restaurant state can be mutated.

create or replace function public.create_customer_order(
  target_restaurant_slug text,
  requested_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'This ordering method is not supported. Use the restaurant table QR ordering flow.';
end;
$$;

revoke all on function public.create_customer_order(text, jsonb)
from public, anon;
grant execute on function public.create_customer_order(text, jsonb)
to authenticated, service_role;

comment on function public.create_customer_order(text, jsonb) is
  'Retired fail-closed legacy API. ServeFlow V1 customer orders require canonical restaurant table QR authority. This function performs no mutation.';

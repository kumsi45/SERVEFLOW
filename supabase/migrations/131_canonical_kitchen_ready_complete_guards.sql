-- Finish migration of kitchen action guards from legacy orders.status to the
-- canonical operational lifecycle. Preparation can only be entered through
-- the payment-policy-aware start_order_preparation authorization.

do $$
declare
  function_signature regprocedure;
  current_definition text;
  updated_definition text;
begin
  foreach function_signature in array array[
    'public.mark_order_ready(uuid,uuid,text)'::regprocedure,
    'public.mark_order_completed(uuid,uuid,text)'::regprocedure
  ]
  loop
    select pg_get_functiondef(function_signature) into current_definition;

    updated_definition := replace(
      current_definition,
      'if target_order.status::text not in (''paid'', ''preparing'', ''ready'') then',
      'if target_order.operational_status not in (''preparing'', ''ready'') then'
    );

    if updated_definition = current_definition then
      raise exception 'Expected legacy guard was not found in %.', function_signature;
    end if;

    execute updated_definition;
  end loop;
end;
$$;

revoke all on function public.mark_order_ready(uuid, uuid, text) from public, anon;
revoke all on function public.mark_order_completed(uuid, uuid, text) from public, anon;
grant execute on function public.mark_order_ready(uuid, uuid, text) to authenticated;
grant execute on function public.mark_order_completed(uuid, uuid, text) to authenticated;

-- Phase W9.4: waiters may perform the existing ready -> completed/served handoff.
-- The mature mark_order_completed implementation remains the single transition.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef('public.mark_order_completed(uuid,uuid,text)'::regprocedure)
  into function_definition;

  function_definition := replace(
    function_definition,
    'role in (''kitchen'', ''cashier'', ''owner'')',
    'role in (''kitchen'', ''cashier'', ''waiter'', ''owner'')'
  );
  function_definition := replace(
    function_definition,
    'acting_staff.role = ''cashier''',
    'acting_staff.role in (''cashier'', ''waiter'')'
  );

  execute function_definition;
end;
$$;


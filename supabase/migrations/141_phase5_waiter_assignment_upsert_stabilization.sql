-- Use the live named constraint so the waiter_staff_id parameter cannot be
-- interpreted as an index expression by PL/pgSQL.
do $stabilize$
declare
  definition text;
begin
  definition := pg_get_functiondef(
    'public.manager_assign_customer_waiter(uuid,uuid,uuid)'::regprocedure
  );
  definition := regexp_replace(
    definition,
    'on\s+conflict\s*\(restaurant_id,\s*table_id,\s*waiter_staff_id\)',
    'ON CONFLICT ON CONSTRAINT restaurant_table_waiter_assig_restaurant_id_table_id_waiter_key',
    'i'
  );
  if definition not like '%ON CONFLICT ON CONSTRAINT restaurant_table_waiter_assig_restaurant_id_table_id_waiter_key%' then
    raise exception 'Could not stabilize manager waiter assignment upsert';
  end if;
  execute definition;
end
$stabilize$;

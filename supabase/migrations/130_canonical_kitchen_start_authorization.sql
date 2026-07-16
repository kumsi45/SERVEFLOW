-- Replace the last legacy orders.status = 'paid' kitchen-start guard with the
-- canonical operational/payment lifecycle authorization.

do $$
declare
  current_definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
    'public.start_order_preparation(uuid,uuid,text)'::regprocedure
  )
  into current_definition;

  if position(
    'if target_order.status::text not in (''paid'', ''preparing'', ''ready'') then'
    in lower(current_definition)
  ) = 0 then
    raise exception 'Expected legacy kitchen start guard was not found.';
  end if;

  updated_definition := replace(
    current_definition,
    E'if target_order.status::text not in (''paid'', ''preparing'', ''ready'') then\n    raise exception ''Only active paid kitchen orders may be started.'';\n  end if;',
    E'if target_order.operational_status not in (''accepted'', ''preparing'', ''ready'')\n     or not exists (\n       select 1\n       from public.order_invoices invoices\n       where invoices.restaurant_id = target_order.restaurant_id\n         and invoices.order_id = target_order.id\n         and (\n           invoices.payment_status = ''paid''\n           or (\n             invoices.payment_status = ''held''\n             and target_order.payment_timing = ''after_meal''\n           )\n         )\n     ) then\n    raise exception ''This order has not been released to the kitchen.'';\n  end if;'
  );

  if updated_definition = current_definition then
    raise exception 'Kitchen start guard replacement did not apply.';
  end if;

  execute updated_definition;
end;
$$;

revoke all on function public.start_order_preparation(uuid, uuid, text)
from public, anon;
grant execute on function public.start_order_preparation(uuid, uuid, text)
to authenticated;

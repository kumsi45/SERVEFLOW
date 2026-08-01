-- The ambiguity fix allows execution to reach the diagnostic JSON added by
-- migration 218. orders has no payment_status column; invoice payment status
-- is already returned by the authoritative invoices payload. Keep the trace
-- key without reading a nonexistent order field.
do $$
declare
  definition text;
begin
  select pg_get_functiondef(
    'public.get_smart_qr_portal_state(text,text,text,text)'::regprocedure
  ) into definition;

  definition := replace(
    definition,
    '''payment_status'',active_order.payment_status',
    '''payment_status'',null'
  );

  if definition like '%active_order.payment_status%' then
    raise exception 'Invalid Smart QR order payment diagnostic could not be removed safely.';
  end if;

  execute definition;
end;
$$;

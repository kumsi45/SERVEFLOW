-- Phase 12.1 hotfix: resolve every active session by tenant + canonical table
-- identity. table_id is preferred but table_number remains the established
-- waiter lifecycle authority for legacy/merged sessions.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.get_smart_qr_portal_state(text,text,text,text)'::regprocedure)
  into definition;

  definition := replace(
    definition,
    'o.restaurant_id = business.id and o.table_id = business_table.id',
    'o.restaurant_id = business.id and (o.table_id = business_table.id or trim(coalesce(o.table_number, '''')) = business_table.table_number::text)'
  );

  definition := replace(
    definition,
    'if active_order.created_by_waiter_id is null then',
    'if active_order.created_by_waiter_id is null and coalesce(active_order.order_source, '''') <> ''waiter'' and not exists (select 1 from public.order_invoices source_invoice where source_invoice.restaurant_id = active_order.restaurant_id and source_invoice.order_id = active_order.id and source_invoice.invoice_source = ''waiter'') then'
  );

  definition := replace(
    definition,
    '''mode'',''available'',''restaurant_id'',business.id,''restaurant_name'',business.name,''table_number'',business_table.table_number',
    '''mode'',''available'',''decision_result'',''digital_menu'',''restaurant_id'',business.id,''restaurant_name'',business.name,''table_id'',business_table.id,''table_number'',business_table.table_number,''dining_session_id'',null,''created_by'',null,''session_status'',null,''payment_status'',null,''order_status'',null'
  );

  definition := replace(
    definition,
    '''mode'', case when active_order.browser_session_token = normalized_browser then ''customer'' else ''occupied'' end,',
    '''mode'', case when active_order.browser_session_token = normalized_browser then ''customer'' else ''occupied'' end,''decision_result'',case when active_order.browser_session_token = normalized_browser then ''current_orders'' else ''smart_customer_portal'' end,'
  );

  definition := replace(
    definition,
    '''restaurant_id'',business.id,''restaurant_name'',business.name,''table_number'',business_table.table_number,
      ''order_id'',active_order.id',
    '''restaurant_id'',business.id,''restaurant_name'',business.name,''table_id'',business_table.id,''table_number'',business_table.table_number,
      ''order_id'',active_order.id,''dining_session_id'',active_order.id,''created_by'',coalesce(active_order.created_by_waiter_id::text,active_order.order_source),''session_status'',active_order.dining_session_status,''payment_status'',active_order.payment_status,''order_status'',active_order.operational_status'
  );

  definition := replace(
    definition,
    '''mode'',''waiter'',''restaurant_id'',business.id,''restaurant_name'',business.name,',
    '''mode'',''waiter'',''decision_result'',''smart_customer_portal'',''restaurant_id'',business.id,''restaurant_name'',business.name,''table_id'',business_table.id,''dining_session_id'',active_order.id,''created_by'',coalesce(active_order.created_by_waiter_id::text,active_order.order_source),''session_status'',active_order.dining_session_status,''payment_status'',active_order.payment_status,''order_status'',active_order.operational_status,'
  );

  if definition not like '%trim(coalesce(o.table_number%'
     or definition not like '%source_invoice.invoice_source = ''waiter''%'
     or definition not like '%''decision_result'',''smart_customer_portal''%' then
    raise exception 'Smart QR decision function could not be hardened safely.';
  end if;
  execute definition;
end;
$$;

comment on function public.get_smart_qr_portal_state(text,text,text,text) is
  'Resolves QR tenant/table identity, then any active dining session using table UUID or canonical table number; returns structured decision diagnostics.';

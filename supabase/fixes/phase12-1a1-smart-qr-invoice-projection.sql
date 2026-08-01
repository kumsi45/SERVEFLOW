-- Phase 12.1A.1: project frozen invoice financial fields into Smart QR.
-- This changes projection only. It does not calculate or mutate invoice values.
do $$
declare
  definition text;
begin
  select pg_get_functiondef(
    'public.get_smart_qr_portal_state(text,text,text,text)'::regprocedure
  ) into definition;

  definition := replace(
    definition,
    'bill_subtotal numeric(12,2) := 0;',
    'bill_subtotal numeric(12,2) := 0;
  invoice_subtotal numeric(12,2) := 0;
  invoice_vat_amount numeric(12,2) := 0;
  invoice_service_charge_amount numeric(12,2) := 0;
  invoice_discount_amount numeric(12,2) := 0;
  invoice_grand_total numeric(12,2) := 0;'
  );

  definition := replace(
    definition,
    '''status'',coalesce(inv.payment_status,inv.status::text),''total_price'',inv.total_price,',
    '''status'',coalesce(inv.payment_status,inv.status::text),''total_price'',inv.total_price,
    ''subtotal'',inv.subtotal,''vat_amount'',inv.vat_amount,
    ''service_charge_amount'',inv.service_charge_amount,
    ''discount_amount'',inv.discount_amount,''grand_total'',inv.grand_total,'
  );

  definition := replace(
    definition,
    E'  return jsonb_build_object(\n    ''mode'',''waiter''',
    E'  select coalesce(sum(inv.subtotal),0), coalesce(sum(inv.vat_amount),0),\n    coalesce(sum(inv.service_charge_amount),0), coalesce(sum(inv.discount_amount),0),\n    coalesce(sum(inv.grand_total),0)\n  into invoice_subtotal, invoice_vat_amount, invoice_service_charge_amount,\n    invoice_discount_amount, invoice_grand_total\n  from public.order_invoices inv\n  where inv.restaurant_id=business.id and inv.order_id=active_order.id\n    and coalesce(inv.payment_status,inv.status::text) <> ''cancelled'';\n\n  return jsonb_build_object(\n    ''mode'',''waiter'''
  );

  definition := replace(
    definition,
    '''subtotal'',bill_subtotal,''vat_amount'',0,''service_charge_amount'',0,''discount_amount'',0,
    ''grand_total'',active_order.total_price',
    '''subtotal'',invoice_subtotal,''vat_amount'',invoice_vat_amount,
    ''service_charge_amount'',invoice_service_charge_amount,''discount_amount'',invoice_discount_amount,
    ''grand_total'',invoice_grand_total'
  );

  if definition not like '%''subtotal'',inv.subtotal%'
     or definition not like '%into invoice_subtotal, invoice_vat_amount%'
     or definition not like '%''vat_amount'',invoice_vat_amount%'
     or definition like '%''vat_amount'',0,''service_charge_amount'',0%' then
    raise exception 'Smart QR invoice projection could not be updated safely.';
  end if;

  execute definition;
end;
$$;

comment on function public.get_smart_qr_portal_state(text,text,text,text) is
  'Returns Smart QR state with subtotal, VAT, service charge, discount, and grand total projected directly from tenant-scoped authoritative invoices.';

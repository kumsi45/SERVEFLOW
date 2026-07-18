-- The legacy database value `paid` is the canonical Accepted kitchen state.
-- It does not represent invoice payment; payment is owned by order_invoices.payment_status.

create or replace function public.merge_open_session_invoice(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order_id uuid := nullif(payload->>'order_id', '')::uuid;
  created_invoice_id uuid := nullif(payload->>'invoice_id', '')::uuid;
  canonical_invoice public.order_invoices;
  created_invoice public.order_invoices;
begin
  if target_order_id is null or created_invoice_id is null then return payload; end if;
  update public.order_items set kitchen_status = 'paid'
  where order_id = target_order_id and invoice_id = created_invoice_id;

  select * into created_invoice from public.order_invoices invoices
  where invoices.id = created_invoice_id and invoices.order_id = target_order_id for update;
  if created_invoice.id is null then return payload; end if;

  select * into canonical_invoice from public.order_invoices invoices
  where invoices.order_id = target_order_id and invoices.id <> created_invoice_id
    and invoices.status::text = 'pending'
    and coalesce(invoices.payment_status::text, 'pending') not in ('paid','refunded','cancelled')
  order by invoices.invoice_number, invoices.created_at limit 1 for update;
  if canonical_invoice.id is null then return payload; end if;

  update public.order_items set invoice_id = canonical_invoice.id
  where order_id = target_order_id and invoice_id = created_invoice_id;
  update public.order_invoices
  set total_price = coalesce(total_price,0) + coalesce(created_invoice.total_price,0), updated_at=clock_timestamp()
  where id=canonical_invoice.id returning * into canonical_invoice;
  delete from public.order_invoices where id=created_invoice_id;
  return payload || jsonb_build_object('invoice_id',canonical_invoice.id,'invoice_number',canonical_invoice.invoice_number,
    'invoice_status',canonical_invoice.status,'invoice_total',canonical_invoice.total_price);
end;
$$;

do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.get_station_kitchen_orders(uuid,uuid,boolean,boolean)'::regprocedure);
  definition := replace(definition,
    'order_invoices.payment_status in (''paid'', ''held'')', 'true');
  definition := replace(definition,
    'order_invoices.payment_status IN (''paid'', ''held'')', 'true');
  definition := replace(definition,
    'order_invoices.status = ''verified'' AND order_invoices.verified_at IS NOT NULL', 'true');
  definition := replace(definition,
    E'order_invoices.status = ''verified''\n      and order_invoices.verified_at is not null', 'true');
  execute definition;

  definition := pg_get_functiondef('public.start_order_preparation(uuid,uuid,text)'::regprocedure);
  definition := regexp_replace(
    definition,
    E'if target_order\\.operational_status not in \\(\'accepted\', \'preparing\', \'ready\'\\)\\s+or not exists \\(.*?\\)\\s+then',
    E'if target_order.operational_status not in (''accepted'', ''preparing'', ''ready'') then',
    'nis'
  );
  execute definition;
end;
$$;

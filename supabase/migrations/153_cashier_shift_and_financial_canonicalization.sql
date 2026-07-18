-- Canonical tenant financial settings and invoice totals.
alter table public.restaurants
  add column if not exists vat_enabled boolean not null default false,
  add column if not exists vat_percentage numeric(5,2) not null default 15,
  add column if not exists service_charge_enabled boolean not null default false,
  add column if not exists service_charge_percentage numeric(5,2) not null default 0;

alter table public.restaurants
  drop constraint if exists restaurants_vat_percentage_range,
  add constraint restaurants_vat_percentage_range check (vat_percentage between 0 and 100),
  drop constraint if exists restaurants_service_charge_percentage_range,
  add constraint restaurants_service_charge_percentage_range check (service_charge_percentage between 0 and 100);

-- Preserve the legacy service-charge setting where one was explicitly configured.
update public.restaurants
set service_charge_percentage = least(greatest(coalesce(nullif(ordering_settings->>'service_charge_percent','')::numeric,0),0),100),
    service_charge_enabled = coalesce(nullif(ordering_settings->>'service_charge_percent','')::numeric,0) > 0;

alter table public.order_invoices
  add column if not exists subtotal numeric(12,2),
  add column if not exists vat_rate numeric(8,6),
  add column if not exists vat_amount numeric(12,2),
  add column if not exists service_charge_rate numeric(8,6),
  add column if not exists service_charge_amount numeric(12,2),
  add column if not exists discount_amount numeric(12,2),
  add column if not exists grand_total numeric(12,2),
  add column if not exists cashier_shift_id uuid references public.cashier_shifts(id) on delete restrict;

-- Existing paid history remains financially unchanged.
update public.order_invoices
set subtotal = coalesce(subtotal,total_price,0), vat_rate=coalesce(vat_rate,0), vat_amount=coalesce(vat_amount,0),
    service_charge_rate=coalesce(service_charge_rate,0), service_charge_amount=coalesce(service_charge_amount,0),
    discount_amount=coalesce(discount_amount,0), grand_total=coalesce(grand_total,total_price,0);

update public.order_invoices invoices
set cashier_shift_id = (
  select shifts.id from public.cashier_shifts shifts
  where shifts.restaurant_id=invoices.restaurant_id
    and shifts.opened_by=invoices.verified_by
    and invoices.verified_at>=shifts.opened_at
    and invoices.verified_at<=coalesce(shifts.closed_at,invoices.verified_at)
  order by shifts.opened_at desc limit 1)
where invoices.cashier_shift_id is null and invoices.verified_at is not null;

create index if not exists order_invoices_shift_paid_idx
on public.order_invoices(restaurant_id,cashier_shift_id,payment_status) where cashier_shift_id is not null;

create or replace function public.calculate_restaurant_financial_totals(
  target_restaurant_id uuid, base_subtotal numeric, discount_amount numeric default 0
) returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'subtotal',round(greatest(coalesce(base_subtotal,0),0),2),
    'vat_rate',case when r.vat_enabled then r.vat_percentage/100 else 0 end,
    'vat_amount',round(greatest(coalesce(base_subtotal,0),0)*(case when r.vat_enabled then r.vat_percentage/100 else 0 end),2),
    'service_charge_rate',case when r.service_charge_enabled then r.service_charge_percentage/100 else 0 end,
    'service_charge_amount',round(greatest(coalesce(base_subtotal,0),0)*(case when r.service_charge_enabled then r.service_charge_percentage/100 else 0 end),2),
    'discount_amount',round(greatest(coalesce(discount_amount,0),0),2),
    'grand_total',round(greatest(coalesce(base_subtotal,0),0)
      + greatest(coalesce(base_subtotal,0),0)*(case when r.vat_enabled then r.vat_percentage/100 else 0 end)
      + greatest(coalesce(base_subtotal,0),0)*(case when r.service_charge_enabled then r.service_charge_percentage/100 else 0 end)
      - greatest(coalesce(discount_amount,0),0),2)
  ) from public.restaurants r where r.id=target_restaurant_id;
$$;

create or replace function public.refresh_invoice_financial_totals(target_invoice_id uuid)
returns public.order_invoices language plpgsql security definer set search_path=public as $$
declare invoice public.order_invoices; base numeric(12,2); totals jsonb;
begin
  select * into invoice from public.order_invoices where id=target_invoice_id for update;
  if invoice.id is null then return null; end if;
  if invoice.payment_status in ('paid','refunded','cancelled') then return invoice; end if;
  select coalesce(sum(price*quantity),0)::numeric(12,2) into base
  from public.order_items where restaurant_id=invoice.restaurant_id and invoice_id=invoice.id;
  totals:=public.calculate_restaurant_financial_totals(invoice.restaurant_id,base,coalesce(invoice.discount_amount,0));
  update public.order_invoices set
    subtotal=(totals->>'subtotal')::numeric,vat_rate=(totals->>'vat_rate')::numeric,
    vat_amount=(totals->>'vat_amount')::numeric,service_charge_rate=(totals->>'service_charge_rate')::numeric,
    service_charge_amount=(totals->>'service_charge_amount')::numeric,discount_amount=(totals->>'discount_amount')::numeric,
    grand_total=(totals->>'grand_total')::numeric,total_price=(totals->>'grand_total')::numeric,updated_at=now()
  where id=invoice.id returning * into invoice;
  update public.orders o set total_price=(select coalesce(sum(i.grand_total),0) from public.order_invoices i where i.restaurant_id=o.restaurant_id and i.order_id=o.id and i.payment_status<>'cancelled'),updated_at=now()
  where o.id=invoice.order_id and o.restaurant_id=invoice.restaurant_id;
  return invoice;
end;$$;

create or replace function public.refresh_changed_invoice_financial_totals() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  if tg_op<>'INSERT' and old.invoice_id is not null then perform public.refresh_invoice_financial_totals(old.invoice_id); end if;
  if tg_op<>'DELETE' and new.invoice_id is not null and (tg_op='INSERT' or new.invoice_id is distinct from old.invoice_id or new.price is distinct from old.price or new.quantity is distinct from old.quantity) then perform public.refresh_invoice_financial_totals(new.invoice_id); end if;
  return coalesce(new,old); end;$$;
drop trigger if exists refresh_invoice_financial_totals_trigger on public.order_items;
create trigger refresh_invoice_financial_totals_trigger after insert or delete or update of invoice_id,price,quantity on public.order_items
for each row execute function public.refresh_changed_invoice_financial_totals();

create or replace function public.stamp_verified_invoice_shift() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  if new.cashier_shift_id is null and new.verified_by is not null and new.status in ('paid','verified') then
    select s.id into new.cashier_shift_id from public.cashier_shifts s
    where s.restaurant_id=new.restaurant_id and s.closed_at is null
      and (s.opened_by=new.verified_by or not exists(select 1 from public.cashier_shifts own where own.restaurant_id=new.restaurant_id and own.opened_by=new.verified_by and own.closed_at is null))
    order by (s.opened_by=new.verified_by) desc,s.opened_at desc limit 1;
  end if; return new; end;$$;
drop trigger if exists stamp_verified_invoice_shift_trigger on public.order_invoices;
create trigger stamp_verified_invoice_shift_trigger before insert or update of status,verified_by on public.order_invoices
for each row execute function public.stamp_verified_invoice_shift();

-- Close-shift reconciliation uses the same immutable invoice-to-shift link.
do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.close_cashier_shift(uuid,numeric,text)'::regprocedure);
  definition:=replace(definition,'sum(invoices.total_price)','sum(invoices.grand_total)');
  definition:=replace(definition,
    'and invoices.verified_by = target_shift.opened_by
    and invoices.verified_at >= target_shift.opened_at
    and invoices.verified_at <= now()',
    'and invoices.cashier_shift_id = target_shift.id');
  definition:=regexp_replace(definition,
    E'and verified_batches\\.verified_by = target_shift\\.opened_by\\s+and verified_batches\\.verified_at >= target_shift\\.opened_at\\s+and verified_batches\\.verified_at <= now\\(\\)',
    'and verified_batches.cashier_shift_id = target_shift.id','g');
  execute definition;
end $$;

create or replace function public.get_cashier_shift_summary(target_restaurant_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare staff public.restaurant_staff; shift public.cashier_shifts; cash numeric:=0; digital numeric:=0; orders_count int:=0; payments_count int:=0;
begin
  select * into staff from public.restaurant_staff where user_id=auth.uid() and restaurant_id=target_restaurant_id and active and role::text in ('cashier','owner','manager') limit 1;
  if staff.id is null then raise exception 'Only active cashiers, managers, and owners may view shift status.'; end if;
  if staff.role='cashier' then select * into shift from public.cashier_shifts where restaurant_id=target_restaurant_id and opened_by=staff.id and closed_at is null order by opened_at desc limit 1;
  else select * into shift from public.cashier_shifts where restaurant_id=target_restaurant_id and closed_at is null order by opened_at desc limit 1; end if;
  if shift.id is not null then
    select coalesce(sum(i.grand_total) filter(where coalesce(public.normalize_payment_method(i.payment_method),public.normalize_payment_method(o.payment_method))='Cash'),0),
      coalesce(sum(i.grand_total) filter(where coalesce(public.normalize_payment_method(i.payment_method),public.normalize_payment_method(o.payment_method))<>'Cash'),0),
      count(distinct i.order_id),count(i.id) into cash,digital,orders_count,payments_count
    from public.order_invoices i join public.orders o on o.restaurant_id=i.restaurant_id and o.id=i.order_id
    where i.restaurant_id=target_restaurant_id and i.cashier_shift_id=shift.id and i.payment_status='paid';
  end if;
  return jsonb_build_object('staff_id',staff.id,'active_shift',case when shift.id is null then null else jsonb_build_object('id',shift.id,'restaurant_id',shift.restaurant_id,'opened_by',shift.opened_by,'opened_at',shift.opened_at,'opening_cash',shift.opening_cash,'notes',shift.notes,'cash_collected',cash,'digital_collected',digital,'orders_processed',orders_count,'payments_processed',payments_count,'expected_cash',shift.opening_cash+cash) end);
end;$$;

-- The existing bill workflow owns authorization, numbering, item and payment rows.
-- Override only its incorrect reverse-tax totals with frozen invoice totals.
alter function public.print_final_dining_bill(uuid,text) rename to print_final_dining_bill_phase7a4_base;
create or replace function public.print_final_dining_bill(target_dining_session_id uuid,target_format text default '80mm') returns jsonb
language plpgsql security definer set search_path=public as $$
declare payload jsonb; totals record; bill_id uuid;
begin
  payload:=public.print_final_dining_bill_phase7a4_base(target_dining_session_id,target_format);
  select coalesce(sum(subtotal),0) subtotal,coalesce(sum(vat_amount),0) vat_amount,coalesce(sum(service_charge_amount),0) service_amount,
    coalesce(sum(discount_amount),0) discount_amount,coalesce(sum(grand_total),0) grand_total,
    case when sum(subtotal)>0 then sum(vat_amount)/sum(subtotal) else 0 end vat_rate,
    case when sum(subtotal)>0 then sum(service_charge_amount)/sum(subtotal) else 0 end service_rate
  into totals from public.order_invoices where order_id=target_dining_session_id and payment_status='paid';
  payload:=jsonb_set(payload,'{totals}',jsonb_build_object('subtotal',totals.subtotal,'vat_rate',totals.vat_rate,'vat_amount',totals.vat_amount,'service_charge_rate',totals.service_rate,'service_charge_amount',totals.service_amount,'discount_amount',totals.discount_amount,'grand_total',totals.grand_total),true);
  bill_id:=nullif(payload->'bill'->>'id','')::uuid;
  update public.dining_session_bills set subtotal=totals.subtotal,vat_amount=totals.vat_amount,service_charge_amount=totals.service_amount,discount_amount=totals.discount_amount,grand_total=totals.grand_total,updated_at=now() where id=bill_id;
  return payload;
end;$$;

create or replace function public.set_restaurant_financial_settings(target_restaurant_id uuid,requested_vat_enabled boolean,requested_vat_percentage numeric,requested_service_charge_enabled boolean,requested_service_charge_percentage numeric)
returns jsonb language plpgsql security definer set search_path=public as $$ begin
  if not public.has_staff_role(target_restaurant_id,array['owner']::public.restaurant_staff_role[]) then raise exception 'Only the restaurant owner may change financial settings.'; end if;
  if requested_vat_percentage not between 0 and 100 or requested_service_charge_percentage not between 0 and 100 then raise exception 'Financial percentages must be between 0 and 100.'; end if;
  update public.restaurants set vat_enabled=coalesce(requested_vat_enabled,false),vat_percentage=requested_vat_percentage,
    service_charge_enabled=coalesce(requested_service_charge_enabled,false),service_charge_percentage=requested_service_charge_percentage,
    ordering_settings=coalesce(ordering_settings,'{}'::jsonb)||jsonb_build_object('service_charge_percent',case when requested_service_charge_enabled then requested_service_charge_percentage else 0 end)
  where id=target_restaurant_id;
  return public.calculate_restaurant_financial_totals(target_restaurant_id,0,0); end;$$;

revoke all on function public.calculate_restaurant_financial_totals(uuid,numeric,numeric) from public,anon;
revoke all on function public.refresh_invoice_financial_totals(uuid) from public,anon,authenticated;
revoke all on function public.set_restaurant_financial_settings(uuid,boolean,numeric,boolean,numeric) from public,anon;
grant execute on function public.calculate_restaurant_financial_totals(uuid,numeric,numeric) to authenticated,service_role;
grant execute on function public.set_restaurant_financial_settings(uuid,boolean,numeric,boolean,numeric) to authenticated;

create or replace function public.get_owner_financial_module_report(target_restaurant_id uuid,range_start timestamptz,range_end timestamptz)
returns jsonb language sql stable security definer set search_path=public as $$
with eligible as(
  select i.grand_total,
    case when lower(coalesce(i.payment_method,''))='cash' then 'Cash' when lower(coalesce(i.payment_method,'')) like '%telebirr%' then 'Telebirr' when lower(coalesce(i.payment_method,'')) like '%cbe%' then 'CBE Birr' when lower(coalesce(i.payment_method,'')) ~ '(card|credit|debit)' then 'Card' else 'Other Digital' end method,
    i.subtotal,i.vat_amount,i.service_charge_amount,i.discount_amount
  from public.order_invoices i where i.restaurant_id=target_restaurant_id and i.payment_status in('paid','refunded') and i.paid_at>=range_start and i.paid_at<range_end
), totals as(select coalesce(sum(grand_total),0) gross,coalesce(sum(subtotal),0) subtotal,coalesce(sum(vat_amount),0) vat,coalesce(sum(service_charge_amount),0) service_charge,coalesce(sum(discount_amount),0) discount from eligible),
methods as(select method,count(*)::int invoices,sum(grand_total)::numeric revenue from eligible group by method)
select jsonb_build_object('revenue',jsonb_build_array(jsonb_build_object('metric','Total Revenue','value',gross),jsonb_build_object('metric','Base Subtotal','value',subtotal),jsonb_build_object('metric','VAT','value',vat),jsonb_build_object('metric','Service Charge','value',service_charge),jsonb_build_object('metric','Discounts','value',discount)),'payments',coalesce((select jsonb_agg(to_jsonb(m) order by revenue desc) from methods m),'[]'::jsonb),'tax',jsonb_build_array(jsonb_build_object('metric','Gross Revenue','value',gross),jsonb_build_object('metric','VAT','value',vat),jsonb_build_object('metric','Service Charge','value',service_charge),jsonb_build_object('metric','Base Subtotal','value',subtotal))) from totals where public.owner_can_report(target_restaurant_id);
$$;

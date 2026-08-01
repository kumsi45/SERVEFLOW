-- Phase 12.1: tenant-safe Smart QR decision and waiter-session customer portal.

create table if not exists public.smart_qr_portal_subscriptions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  table_id uuid not null references public.restaurant_tables(id) on delete cascade,
  browser_session_token text not null check (length(trim(browser_session_token)) between 16 and 200),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (restaurant_id, order_id, browser_session_token)
);

create index if not exists smart_qr_portal_subscriptions_order_idx
on public.smart_qr_portal_subscriptions (restaurant_id, order_id, last_seen_at desc);

alter table public.smart_qr_portal_subscriptions enable row level security;
revoke all on public.smart_qr_portal_subscriptions from public, anon, authenticated;

create table if not exists public.waiter_assistance_requests (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  table_id uuid not null references public.restaurant_tables(id) on delete cascade,
  waiter_staff_id uuid references public.restaurant_staff(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','acknowledged','resolved','cancelled')),
  requested_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists waiter_assistance_requests_one_pending_idx
on public.waiter_assistance_requests (restaurant_id, order_id)
where status = 'pending';
create index if not exists waiter_assistance_requests_waiter_queue_idx
on public.waiter_assistance_requests (restaurant_id, waiter_staff_id, status, requested_at desc);

alter table public.waiter_assistance_requests enable row level security;
revoke all on public.waiter_assistance_requests from public, anon;
grant select, update on public.waiter_assistance_requests to authenticated;

drop policy if exists waiter_assistance_requests_staff_tenant on public.waiter_assistance_requests;
create policy waiter_assistance_requests_staff_tenant on public.waiter_assistance_requests
for all to authenticated
using (exists (
  select 1 from public.restaurant_staff staff
  where staff.restaurant_id = waiter_assistance_requests.restaurant_id
    and staff.user_id = auth.uid() and staff.active = true
    and staff.role::text in ('waiter','manager','owner')
))
with check (exists (
  select 1 from public.restaurant_staff staff
  where staff.restaurant_id = waiter_assistance_requests.restaurant_id
    and staff.user_id = auth.uid() and staff.active = true
    and staff.role::text in ('waiter','manager','owner')
));

create or replace function public.get_smart_qr_portal_state(
  target_restaurant_slug text,
  table_number text,
  qr_token text,
  browser_session_token text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  business public.restaurants;
  business_table public.restaurant_tables;
  active_order public.orders;
  normalized_table integer;
  normalized_qr uuid;
  normalized_browser text := nullif(trim(browser_session_token), '');
  session_items jsonb := '[]'::jsonb;
  session_invoices jsonb := '[]'::jsonb;
  bill_subtotal numeric(12,2) := 0;
begin
  if nullif(trim(table_number), '') is null or trim(table_number) !~ '^[0-9]+$' then
    raise exception 'A valid table number is required.';
  end if;
  if normalized_browser is null or length(normalized_browser) < 16 then
    raise exception 'A valid browser session is required.';
  end if;
  normalized_table := trim(table_number)::integer;
  begin normalized_qr := trim(qr_token)::uuid;
  exception when invalid_text_representation then raise exception 'A valid table QR code is required.'; end;

  select * into business from public.restaurants r
  where r.slug = lower(trim(target_restaurant_slug)) and r.active = true limit 1;
  if business.id is null then raise exception 'Business not found.'; end if;

  select * into business_table from public.restaurant_tables t
  where t.restaurant_id = business.id and t.table_number = normalized_table
    and t.qr_token = normalized_qr and t.active = true limit 1;
  if business_table.id is null then raise exception 'Invalid or expired table QR code.'; end if;

  perform public.expire_stale_dining_sessions(business.id);
  select * into active_order from public.orders o
  where o.restaurant_id = business.id and o.table_id = business_table.id
    and public.is_public_qr_dining_session_open(o.id)
  order by o.created_at desc limit 1;

  if active_order.id is null then
    return jsonb_build_object('mode','available','restaurant_id',business.id,'restaurant_name',business.name,'table_number',business_table.table_number);
  end if;

  if active_order.created_by_waiter_id is null then
    return jsonb_build_object(
      'mode', case when active_order.browser_session_token = normalized_browser then 'customer' else 'occupied' end,
      'restaurant_id',business.id,'restaurant_name',business.name,'table_number',business_table.table_number,
      'order_id',active_order.id
    );
  end if;

  insert into public.smart_qr_portal_subscriptions
    (restaurant_id, order_id, table_id, browser_session_token, last_seen_at)
  values (business.id, active_order.id, business_table.id, normalized_browser, now())
  on conflict (restaurant_id, order_id, browser_session_token)
  do update set last_seen_at = excluded.last_seen_at;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'invoice_id',i.invoice_id,'menu_item_id',m.id,'name',m.name,
    'quantity',i.quantity,'unit_price',i.price,'line_total',(i.price*i.quantity)::numeric(12,2),
    'kitchen_status',i.kitchen_status,'created_at',i.created_at
  ) order by i.created_at,i.id),'[]'::jsonb),
  coalesce(sum(i.price*i.quantity),0)::numeric(12,2)
  into session_items,bill_subtotal
  from public.order_items i join public.menu_items m
    on m.restaurant_id=i.restaurant_id and m.id=i.menu_item_id
  where i.restaurant_id=business.id and i.order_id=active_order.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',inv.id,'invoice_number',inv.invoice_number,'display_number',inv.display_number,
    'status',coalesce(inv.payment_status,inv.status::text),'total_price',inv.total_price,
    'payment_method',public.normalize_payment_method(inv.payment_method),
    'paid_at',inv.paid_at,'created_at',inv.created_at
  ) order by inv.invoice_number),'[]'::jsonb)
  into session_invoices from public.order_invoices inv
  where inv.restaurant_id=business.id and inv.order_id=active_order.id;

  return jsonb_build_object(
    'mode','waiter','restaurant_id',business.id,'restaurant_name',business.name,
    'table_number',business_table.table_number,'order_id',active_order.id,
    'display_number',active_order.display_number,'dining_session_display_number',active_order.dining_session_display_number,
    'status',active_order.operational_status,'total_price',active_order.total_price,
    'subtotal',bill_subtotal,'vat_amount',0,'service_charge_amount',0,'discount_amount',0,
    'grand_total',active_order.total_price,'created_at',active_order.created_at,
    'items',session_items,'invoices',session_invoices
  );
end;
$$;

create or replace function public.call_waiter_from_smart_qr(
  target_restaurant_slug text, table_number text, qr_token text,
  browser_session_token text, target_order_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare state jsonb; target_order public.orders; request_id uuid;
begin
  state := public.get_smart_qr_portal_state(target_restaurant_slug,table_number,qr_token,browser_session_token);
  if state->>'mode' <> 'waiter' or (state->>'order_id')::uuid <> target_order_id then
    raise exception 'The active waiter session could not be verified.';
  end if;
  select * into target_order from public.orders where id=target_order_id and restaurant_id=(state->>'restaurant_id')::uuid;
  insert into public.waiter_assistance_requests(restaurant_id,order_id,table_id,waiter_staff_id)
  values(target_order.restaurant_id,target_order.id,target_order.table_id,target_order.created_by_waiter_id)
  on conflict (restaurant_id,order_id) where status='pending'
  do update set requested_at=now(),updated_at=now()
  returning id into request_id;
  return jsonb_build_object('requested',true,'request_id',request_id,'requested_at',now());
end;
$$;

create or replace function public.broadcast_customer_order_change()
returns trigger language plpgsql security definer set search_path = public, realtime
as $$
declare target_order public.orders; token_row record; payload jsonb;
begin
  if tg_table_name='orders' then target_order:=case when tg_op='DELETE' then old else new end;
  else select * into target_order from public.orders where id=coalesce(new.order_id,old.order_id) and restaurant_id=coalesce(new.restaurant_id,old.restaurant_id); end if;
  if target_order.id is null then return coalesce(new,old); end if;
  payload:=jsonb_build_object('record',jsonb_build_object('restaurant_id',target_order.restaurant_id,'order_id',target_order.id,'source_table',tg_table_name,'operation',tg_op));
  if nullif(trim(target_order.browser_session_token),'') is not null then
    perform realtime.send(payload,'order_changed','customer-order:'||target_order.browser_session_token,false);
  end if;
  for token_row in select distinct browser_session_token from public.smart_qr_portal_subscriptions s
    where s.restaurant_id=target_order.restaurant_id and s.order_id=target_order.id
      and s.last_seen_at > now()-interval '12 hours'
  loop perform realtime.send(payload,'order_changed','customer-order:'||token_row.browser_session_token,false); end loop;
  return coalesce(new,old);
end;
$$;

revoke all on function public.get_smart_qr_portal_state(text,text,text,text) from public;
revoke all on function public.call_waiter_from_smart_qr(text,text,text,text,uuid) from public;
grant execute on function public.get_smart_qr_portal_state(text,text,text,text) to anon,authenticated,service_role;
grant execute on function public.call_waiter_from_smart_qr(text,text,text,text,uuid) to anon,authenticated,service_role;
revoke all on function public.broadcast_customer_order_change() from public,anon,authenticated;

-- Keep the existing feedback authority, extending its ownership predicate only
-- for QR browsers registered against the waiter-owned dining session.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.submit_public_order_feedback(text,text,text,uuid,integer,text[],text,text,text)'::regprocedure)
  into definition;
  definition := replace(
    definition,
    'and orders.browser_session_token = normalized_browser_token',
    'and (orders.browser_session_token = normalized_browser_token or (orders.created_by_waiter_id is not null and exists (select 1 from public.smart_qr_portal_subscriptions subscriptions where subscriptions.restaurant_id = orders.restaurant_id and subscriptions.order_id = orders.id and subscriptions.browser_session_token = normalized_browser_token)))'
  );
  if definition not like '%smart_qr_portal_subscriptions%' then
    raise exception 'Feedback ownership predicate could not be extended safely.';
  end if;
  execute definition;
end;
$$;

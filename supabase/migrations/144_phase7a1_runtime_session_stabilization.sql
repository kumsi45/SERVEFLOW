-- Phase 7A.1: restore the runtime event path and enforce one bill per open table session.

do $$
declare
  relation_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach relation_name in array array[
      'orders', 'order_items', 'order_invoices', 'restaurant_tables',
      'restaurant_staff', 'cashier_shifts', 'cash_reconciliations',
      'shift_activity_logs', 'kitchen_order_station_progress',
      'restaurant_table_waiter_assignments', 'kitchen_inventory_requests',
      'inventory_items', 'manager_customer_complaints', 'menu_items',
      'kitchen_stations', 'restaurants'
    ] loop
      if to_regclass('public.' || relation_name) is not null
         and not exists (
           select 1 from pg_publication_tables
           where pubname = 'supabase_realtime'
             and schemaname = 'public'
             and tablename = relation_name
         ) then
        execute format('alter publication supabase_realtime add table public.%I', relation_name);
      end if;
    end loop;
  end if;
end;
$$;

-- Kitchen routing is operational. Payment state must not suppress an accepted batch.
drop trigger if exists enforce_verified_invoice_kitchen_gate_trigger on public.order_items;

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

  -- Every submitted batch is immediately visible to its configured kitchen station.
  update public.order_items
  set kitchen_status = 'paid'
  where order_id = target_order_id and invoice_id = created_invoice_id;

  select * into created_invoice
  from public.order_invoices invoices
  where invoices.id = created_invoice_id and invoices.order_id = target_order_id
  for update;
  if created_invoice.id is null then return payload; end if;

  select * into canonical_invoice
  from public.order_invoices invoices
  where invoices.order_id = target_order_id
    and invoices.id <> created_invoice_id
    and invoices.status::text = 'pending'
    and coalesce(invoices.payment_status::text, 'pending') not in ('paid', 'refunded', 'cancelled')
  order by invoices.invoice_number, invoices.created_at
  limit 1
  for update;

  if canonical_invoice.id is null then return payload; end if;

  update public.order_items
  set invoice_id = canonical_invoice.id
  where order_id = target_order_id and invoice_id = created_invoice_id;

  update public.order_invoices
  set total_price = coalesce(total_price, 0) + coalesce(created_invoice.total_price, 0),
      updated_at = clock_timestamp()
  where id = canonical_invoice.id
  returning * into canonical_invoice;

  delete from public.order_invoices where id = created_invoice_id;

  return payload
    || jsonb_build_object(
      'invoice_id', canonical_invoice.id,
      'invoice_number', canonical_invoice.invoice_number,
      'invoice_status', canonical_invoice.status,
      'invoice_total', canonical_invoice.total_price
    );
end;
$$;

revoke all on function public.merge_open_session_invoice(jsonb) from public, anon, authenticated;

alter function public.create_public_qr_order(text, text, text, text, text, text, jsonb)
rename to create_public_qr_order_phase7a1_base;

create or replace function public.create_public_qr_order(
  target_restaurant_slug text,
  table_number text,
  qr_token text,
  browser_session_token text,
  customer_name text,
  selected_payment_method text,
  requested_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
begin
  payload := public.create_public_qr_order_phase7a1_base(
    target_restaurant_slug, table_number, qr_token, browser_session_token,
    customer_name, selected_payment_method, requested_items
  );
  return public.merge_open_session_invoice(payload);
end;
$$;

alter function public.submit_waiter_order_batch(text, text, text, text, text, jsonb, uuid)
rename to submit_waiter_order_batch_phase7a1_base;

create or replace function public.submit_waiter_order_batch(
  target_restaurant_slug text,
  table_number text,
  customer_name text,
  customer_phone text,
  order_note text,
  requested_items jsonb,
  client_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
begin
  payload := public.submit_waiter_order_batch_phase7a1_base(
    target_restaurant_slug, table_number, customer_name, customer_phone,
    order_note, requested_items, client_request_id
  );
  payload := public.merge_open_session_invoice(payload);
  update public.waiter_batch_requests set response = payload where id = client_request_id;
  return payload;
end;
$$;

revoke all on function public.create_public_qr_order(text, text, text, text, text, text, jsonb) from public;
grant execute on function public.create_public_qr_order(text, text, text, text, text, text, jsonb) to anon, authenticated, service_role;
revoke all on function public.submit_waiter_order_batch(text, text, text, text, text, jsonb, uuid) from public, anon;
grant execute on function public.submit_waiter_order_batch(text, text, text, text, text, jsonb, uuid) to authenticated, service_role;

-- Phase 12.2: Cashier workflow foundation.
-- Existing orders, invoices, shifts, receipt events, assistance requests and
-- financial totals remain authoritative. This migration adds orchestration and
-- projections only; it does not recalculate money or alter order lifecycle.

alter table public.receipt_generation_events
  drop constraint if exists receipt_generation_events_status_allowed;
alter table public.receipt_generation_events
  add constraint receipt_generation_events_status_allowed
  check (status in ('pending','processing','processed','failed','waiting','printed','reprinted','cancelled'));

alter table public.waiter_assistance_requests
  add column if not exists request_type text not null default 'call_waiter',
  add column if not exists priority text not null default 'normal';
alter table public.waiter_assistance_requests
  drop constraint if exists waiter_assistance_requests_request_type_allowed,
  drop constraint if exists waiter_assistance_requests_priority_allowed;
alter table public.waiter_assistance_requests
  add constraint waiter_assistance_requests_request_type_allowed check (request_type in ('call_waiter','call_cashier')),
  add constraint waiter_assistance_requests_priority_allowed check (priority in ('normal','urgent'));
drop index if exists public.waiter_assistance_requests_one_pending_idx;
create unique index waiter_assistance_requests_one_pending_idx
  on public.waiter_assistance_requests(restaurant_id,order_id,request_type)
  where status='pending';

create or replace function public.call_cashier_from_smart_qr(
  target_restaurant_slug text, table_number text, qr_token text,
  browser_session_token text, target_order_id uuid, requested_priority text default 'normal'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare state jsonb; target_order public.orders; request_id uuid; priority text:=lower(trim(coalesce(requested_priority,'normal')));
begin
  if priority not in ('normal','urgent') then raise exception 'Invalid assistance priority.'; end if;
  state:=public.get_smart_qr_portal_state(target_restaurant_slug,table_number,qr_token,browser_session_token);
  if state->>'mode'<>'waiter' or (state->>'order_id')::uuid<>target_order_id then
    raise exception 'The active waiter session could not be verified.';
  end if;
  select * into target_order from public.orders
  where id=target_order_id and restaurant_id=(state->>'restaurant_id')::uuid;
  insert into public.waiter_assistance_requests
    (restaurant_id,order_id,table_id,waiter_staff_id,request_type,priority)
  values (target_order.restaurant_id,target_order.id,target_order.table_id,null,'call_cashier',priority)
  on conflict (restaurant_id,order_id,request_type) where status='pending'
  do update set requested_at=now(),priority=excluded.priority,updated_at=now()
  returning id into request_id;
  return jsonb_build_object('requested',true,'request_id',request_id,
    'request_type','call_cashier','priority',priority,'requested_at',now());
end;$$;

-- Existing functions allowed owners to mutate payments. Preserve their logic
-- behind cashier-only wrappers; owners retain read-only workflow visibility.
alter function public.verify_order_payment(uuid,text,text,text,boolean)
  rename to verify_order_payment_phase122_base;
revoke all on function public.verify_order_payment_phase122_base(uuid,text,text,text,boolean)
  from public, anon, authenticated;

create or replace function public.verify_order_payment(
  target_invoice_id uuid,
  payment_reference_number text default null,
  payment_transaction_id text default null,
  payment_screenshot_url text default null,
  owner_duplicate_override boolean default false
) returns public.orders
language plpgsql security definer set search_path=public as $$
declare target_restaurant_id uuid;
begin
  select restaurant_id into target_restaurant_id
  from public.order_invoices where id=target_invoice_id;
  if target_restaurant_id is null then raise exception 'Payment batch not found.'; end if;
  if not public.has_staff_role(target_restaurant_id,array['cashier']::public.restaurant_staff_role[]) then
    raise exception 'Only an active cashier may verify payment.';
  end if;
  if owner_duplicate_override then
    raise exception 'Duplicate payment evidence cannot be approved from the cashier workflow.';
  end if;
  return public.verify_order_payment_phase122_base(
    target_invoice_id,payment_reference_number,payment_transaction_id,
    payment_screenshot_url,false
  );
end;$$;

alter function public.verify_dining_session_payment(uuid,text,text,text,text,boolean)
  rename to verify_dining_session_payment_phase122_base;
revoke all on function public.verify_dining_session_payment_phase122_base(uuid,text,text,text,text,boolean)
  from public, anon, authenticated;

create or replace function public.verify_dining_session_payment(
  target_dining_session_id uuid,
  selected_payment_method text,
  payment_reference_number text default null,
  payment_transaction_id text default null,
  payment_screenshot_url text default null,
  owner_duplicate_override boolean default false
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare target_restaurant_id uuid;
begin
  select restaurant_id into target_restaurant_id
  from public.orders where id=target_dining_session_id;
  if target_restaurant_id is null then raise exception 'Dining session not found.'; end if;
  if not public.has_staff_role(target_restaurant_id,array['cashier']::public.restaurant_staff_role[]) then
    raise exception 'Only an active cashier may settle a dining session.';
  end if;
  if owner_duplicate_override then
    raise exception 'Duplicate payment evidence cannot be approved from the cashier workflow.';
  end if;
  return public.verify_dining_session_payment_phase122_base(
    target_dining_session_id,selected_payment_method,payment_reference_number,
    payment_transaction_id,payment_screenshot_url,false
  );
end;$$;

alter function public.reject_order_payment(uuid,text)
  rename to reject_order_payment_phase122_base;
revoke all on function public.reject_order_payment_phase122_base(uuid,text)
  from public, anon, authenticated;

create or replace function public.reject_order_payment(
  target_invoice_id uuid,
  rejection_note text default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare target_invoice public.order_invoices; actor public.restaurant_staff; result jsonb; shift_id uuid;
begin
  select * into target_invoice from public.order_invoices where id=target_invoice_id;
  if target_invoice.id is null then raise exception 'Payment batch not found.'; end if;
  select * into actor from public.restaurant_staff
  where restaurant_id=target_invoice.restaurant_id and user_id=auth.uid()
    and active and role='cashier' limit 1;
  if actor.id is null then raise exception 'Only an active cashier may reject payment.'; end if;
  if nullif(trim(coalesce(rejection_note,'')),'') is null then
    raise exception 'A rejection reason is required.';
  end if;
  result:=public.reject_order_payment_phase122_base(target_invoice_id,rejection_note);
  select id into shift_id from public.cashier_shifts
  where restaurant_id=target_invoice.restaurant_id and opened_by=actor.id and closed_at is null
  order by opened_at desc limit 1;
  insert into public.shift_activity_logs
    (restaurant_id,shift_id,order_id,actor_staff_id,action,message,amount,metadata)
  values (target_invoice.restaurant_id,shift_id,target_invoice.order_id,actor.id,
    'payment_rejected','Invoice payment rejected',target_invoice.grand_total,
    jsonb_build_object('invoice_id',target_invoice.id,'table_number',(select table_number from public.orders where id=target_invoice.order_id),'payment_method',target_invoice.payment_method,'reason',left(trim(rejection_note),500)));
  return result;
end;$$;

alter function public.request_order_payment_retry(uuid,text)
  rename to request_order_payment_retry_phase122_base;
revoke all on function public.request_order_payment_retry_phase122_base(uuid,text)
  from public, anon, authenticated;

create or replace function public.request_order_payment_retry(
  target_invoice_id uuid,
  retry_note text default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare target_invoice public.order_invoices; actor public.restaurant_staff; result jsonb; shift_id uuid;
begin
  select * into target_invoice from public.order_invoices where id=target_invoice_id;
  if target_invoice.id is null then raise exception 'Payment batch not found.'; end if;
  select * into actor from public.restaurant_staff
  where restaurant_id=target_invoice.restaurant_id and user_id=auth.uid()
    and active and role='cashier' limit 1;
  if actor.id is null then raise exception 'Only an active cashier may request payment retry.'; end if;
  result:=public.request_order_payment_retry_phase122_base(target_invoice_id,retry_note);
  select id into shift_id from public.cashier_shifts
  where restaurant_id=target_invoice.restaurant_id and opened_by=actor.id and closed_at is null
  order by opened_at desc limit 1;
  insert into public.shift_activity_logs
    (restaurant_id,shift_id,order_id,actor_staff_id,action,message,amount,metadata)
  values (target_invoice.restaurant_id,shift_id,target_invoice.order_id,actor.id,
    'payment_retry_requested','Payment retry requested',target_invoice.grand_total,
    jsonb_build_object('invoice_id',target_invoice.id,'table_number',(select table_number from public.orders where id=target_invoice.order_id),'payment_method',target_invoice.payment_method,'reason',left(trim(coalesce(retry_note,'')),500)));
  return result;
end;$$;

create or replace function public.record_cashier_receipt_action(
  target_invoice_id uuid,
  requested_action text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare invoice public.order_invoices; actor public.restaurant_staff; receipt public.receipt_generation_events;
  action text:=lower(trim(coalesce(requested_action,''))); shift_id uuid; next_status text;
begin
  select * into invoice from public.order_invoices where id=target_invoice_id for update;
  if invoice.id is null then raise exception 'Invoice not found.'; end if;
  select * into actor from public.restaurant_staff
  where restaurant_id=invoice.restaurant_id and user_id=auth.uid() and active and role='cashier' limit 1;
  if actor.id is null then raise exception 'Only an active cashier may manage receipts.'; end if;
  if invoice.payment_status <> 'paid' then raise exception 'Only paid invoices can produce receipts.'; end if;
  select * into receipt from public.receipt_generation_events
  where restaurant_id=invoice.restaurant_id and invoice_id=invoice.id for update;
  if receipt.id is null then raise exception 'Receipt job is not ready.'; end if;
  if action='print' then next_status:='printed';
  elsif action='reprint' and receipt.status in ('processed','printed','reprinted') then next_status:='reprinted';
  elsif action='cancel' and receipt.status not in ('cancelled') then next_status:='cancelled';
  else raise exception 'Receipt action is not valid for the current state.'; end if;
  update public.receipt_generation_events set status=next_status,
    processed_at=case when next_status in ('printed','reprinted') then now() else processed_at end,
    payload=coalesce(payload,'{}'::jsonb)||jsonb_build_object(
      'last_action',action,'last_action_at',now(),'last_action_by',actor.id,
      'print_count',coalesce((payload->>'print_count')::integer,0)+case when action in ('print','reprint') then 1 else 0 end)
  where id=receipt.id returning * into receipt;
  select id into shift_id from public.cashier_shifts where restaurant_id=invoice.restaurant_id
    and opened_by=actor.id and closed_at is null order by opened_at desc limit 1;
  insert into public.shift_activity_logs
    (restaurant_id,shift_id,order_id,actor_staff_id,action,message,amount,metadata)
  values (invoice.restaurant_id,shift_id,invoice.order_id,actor.id,'receipt_'||action,
    'Receipt '||action||' recorded',invoice.grand_total,
    jsonb_build_object('invoice_id',invoice.id,'receipt_job_id',receipt.id,'payment_method',invoice.payment_method));
  return jsonb_build_object('receipt_job_id',receipt.id,'invoice_id',invoice.id,
    'status',receipt.status,'processed_at',receipt.processed_at,'payload',receipt.payload);
end;$$;

create or replace function public.get_cashier_workflow_foundation(target_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor public.restaurant_staff; result jsonb;
begin
  select * into actor from public.restaurant_staff
  where restaurant_id=target_restaurant_id and user_id=auth.uid() and active
    and role in ('cashier','owner') limit 1;
  if actor.id is null then raise exception 'Only active cashiers and owners may view cashier workflow.'; end if;

  with invoice_rows as (
    select i.*,o.table_number,o.customer_name,o.display_number as order_number,
      o.payment_timing,o.operational_status as order_status,
      coalesce(i.invoice_source,o.order_source,'unknown') as source,
      creator.display_name as waiter_name,
      r.id as receipt_job_id,r.status as receipt_job_status,r.processed_at as receipt_processed_at,
      case
        when i.payment_status='cancelled' then 'cancelled'
        when i.payment_status='refunded' then 'refunded'
        when r.status in ('printed','reprinted','processed') and o.dining_session_status='closed' then 'closed'
        when r.status in ('printed','reprinted','processed') then 'receipt_printed'
        when i.payment_status='paid' then 'paid'
        when i.payment_status='held' and i.payment_recorded_at is not null then 'payment_submitted'
        else 'pending_payment'
      end as invoice_lifecycle,
      case
        when i.status='rejected' or i.rejected_at is not null then 'rejected'
        when i.duplicate_override_at is not null then 'duplicate'
        when i.payment_status='paid' then 'verified'
        when i.payment_status='cancelled' then 'expired'
        when i.payment_recorded_at is not null then 'submitted'
        else 'waiting'
      end as verification_status
    from public.order_invoices i
    join public.orders o on o.restaurant_id=i.restaurant_id and o.id=i.order_id
    left join public.restaurant_staff creator on creator.restaurant_id=i.restaurant_id and creator.id=i.created_by_staff_id
    left join public.receipt_generation_events r on r.restaurant_id=i.restaurant_id and r.invoice_id=i.id
    where i.restaurant_id=target_restaurant_id
      and (o.dining_session_status='open' or i.created_at>=now()-interval '36 hours')
  ), queue as (
    select jsonb_build_object(
      'invoice_id',id,'invoice_number',invoice_number,'invoice_display_number',display_number,
      'invoice_lifecycle',invoice_lifecycle,'verification_status',verification_status,
      'payment_status',payment_status,'table_number',table_number,'order_number',order_number,
      'customer_name',customer_name,'waiter_name',waiter_name,'source',source,
      'payment_method',public.normalize_payment_method(payment_method),'amount',grand_total,
      'submitted_at',payment_recorded_at,'reference_number',reference_number,
      'screenshot_available',(screenshot_url is not null),'screenshot_url',screenshot_url,
      'rejection_reason',rejection_reason,'created_at',created_at,
      'receipt_job_id',receipt_job_id,
      'receipt_status',case receipt_job_status when 'pending' then 'waiting' when 'processing' then 'waiting' when 'processed' then 'printed' else receipt_job_status end
    ) row_json,* from invoice_rows
  ), assistance as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'request_id',a.id,'request_type',a.request_type,'table_number',t.table_number,
      'requested_at',a.requested_at,'priority',case when a.priority='urgent' or a.requested_at<now()-interval '5 minutes' then 'urgent' else 'normal' end,
      'status',a.status,'order_id',a.order_id) order by a.requested_at),'[]'::jsonb) rows
    from public.waiter_assistance_requests a
    join public.restaurant_tables t on t.restaurant_id=a.restaurant_id and t.id=a.table_id
    where a.restaurant_id=target_restaurant_id and a.status in ('pending','acknowledged')
  ), settlement as (
    select jsonb_build_object(
      'cash_collected',coalesce(sum(grand_total) filter(where payment_status='paid' and public.normalize_payment_method(payment_method)='Cash'),0),
      'digital_collected',coalesce(sum(grand_total) filter(where payment_status='paid' and public.normalize_payment_method(payment_method)<>'Cash'),0),
      'pending_payments',count(*) filter(where payment_status in ('pending','held')),
      'verified_payments',count(*) filter(where payment_status='paid'),
      'rejected_payments',count(*) filter(where verification_status='rejected'),
      'ready_for_daily_closing',count(*) filter(where payment_status in ('pending','held'))=0
    ) row_json from invoice_rows where created_at>=date_trunc('day',now())
  )
  select jsonb_build_object(
    'restaurant_id',target_restaurant_id,'viewer_role',actor.role,'generated_at',now(),
    'payment_submitted_queue',coalesce((select jsonb_agg(row_json order by payment_recorded_at desc) from queue where verification_status='submitted'),'[]'::jsonb),
    'waiter_payment_due_queue',coalesce((select jsonb_agg(row_json order by created_at) from queue where payment_timing='after_meal' and payment_status in ('pending','held')),'[]'::jsonb),
    'cash_payment_queue',coalesce((select jsonb_agg(row_json order by created_at) from queue where public.normalize_payment_method(payment_method)='Cash' and payment_status in ('pending','held')),'[]'::jsonb),
    'digital_payment_queue',coalesce((select jsonb_agg(row_json order by payment_recorded_at) from queue where public.normalize_payment_method(payment_method)<>'Cash' and verification_status='submitted'),'[]'::jsonb),
    'verification_queue',coalesce((select jsonb_agg(row_json order by payment_recorded_at desc nulls last) from queue where verification_status in ('submitted','rejected','expired','duplicate')),'[]'::jsonb),
    'receipt_queue',coalesce((select jsonb_agg(row_json order by created_at) from queue where receipt_job_id is not null and receipt_job_status<>'cancelled'),'[]'::jsonb),
    'daily_settlement',(select row_json from settlement),
    'customer_assistance_queue',(select rows from assistance)
  ) into result;
  return result;
end;$$;

revoke all on function public.verify_order_payment(uuid,text,text,text,boolean) from public,anon;
revoke all on function public.verify_dining_session_payment(uuid,text,text,text,text,boolean) from public,anon;
revoke all on function public.reject_order_payment(uuid,text) from public,anon;
revoke all on function public.request_order_payment_retry(uuid,text) from public,anon;
revoke all on function public.record_cashier_receipt_action(uuid,text) from public,anon;
revoke all on function public.get_cashier_workflow_foundation(uuid) from public,anon;
revoke all on function public.call_cashier_from_smart_qr(text,text,text,text,uuid,text) from public;
grant execute on function public.verify_order_payment(uuid,text,text,text,boolean) to authenticated;
grant execute on function public.verify_dining_session_payment(uuid,text,text,text,text,boolean) to authenticated;
grant execute on function public.reject_order_payment(uuid,text) to authenticated;
grant execute on function public.request_order_payment_retry(uuid,text) to authenticated;
grant execute on function public.record_cashier_receipt_action(uuid,text) to authenticated;
grant execute on function public.get_cashier_workflow_foundation(uuid) to authenticated;
grant execute on function public.call_cashier_from_smart_qr(text,text,text,text,uuid,text) to anon,authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='order_invoices') then alter publication supabase_realtime add table public.order_invoices; end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='shift_activity_logs') then alter publication supabase_realtime add table public.shift_activity_logs; end if;
  end if;
end $$;

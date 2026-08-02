-- Phase 12.2A: cashier-primary settlement, manager emergency recovery,
-- canonical bill requests, and table occupancy protection.

alter table public.orders
  add column if not exists bill_prepared_at timestamptz,
  add column if not exists bill_prepared_by uuid,
  add column if not exists bill_printed_at timestamptz,
  add column if not exists bill_printed_by uuid,
  add column if not exists bill_request_ignored_at timestamptz,
  add column if not exists bill_request_ignored_by uuid;

create unique index if not exists orders_one_open_dining_session_per_table_id
  on public.orders(restaurant_id,table_id)
  where dining_session_status='open' and table_id is not null;

create or replace function public.enforce_canonical_open_table_identity()
returns trigger language plpgsql set search_path=public as $$
declare canonical_table public.restaurant_tables;
begin
  if new.dining_session_status<>'open' then return new; end if;
  select * into canonical_table from public.restaurant_tables t
  where t.restaurant_id=new.restaurant_id and t.active
    and (t.id=new.table_id or t.table_number::text=trim(coalesce(new.table_number,'')))
  order by case when t.id=new.table_id then 0 else 1 end limit 1;
  if canonical_table.id is null then raise exception 'An active tenant table is required for an open dining session.'; end if;
  if new.table_id is not null and new.table_id<>canonical_table.id then raise exception 'Dining session table identity does not match its tenant table.'; end if;
  if nullif(trim(coalesce(new.table_number,'')),'') is not null and trim(new.table_number)<>canonical_table.table_number::text then raise exception 'Dining session table number does not match its tenant table.'; end if;
  new.table_id:=canonical_table.id;
  new.table_number:=canonical_table.table_number::text;
  return new;
end;$$;
drop trigger if exists enforce_canonical_open_table_identity_trigger on public.orders;
create trigger enforce_canonical_open_table_identity_trigger
before insert or update of restaurant_id,table_id,table_number,dining_session_status
on public.orders for each row execute function public.enforce_canonical_open_table_identity();

alter function public.close_dining_session(uuid,text)
  rename to close_dining_session_phase122a_base;
revoke all on function public.close_dining_session_phase122a_base(uuid,text) from public,anon,authenticated;

create or replace function public.close_dining_session(target_order_id uuid,close_reason text default 'customer_left')
returns public.orders language plpgsql security definer set search_path=public as $$
declare target public.orders; actor public.restaurant_staff; closed public.orders;
begin
  select * into target from public.orders where id=target_order_id for update;
  if target.id is null then raise exception 'Dining session not found.'; end if;
  select * into actor from public.restaurant_staff where restaurant_id=target.restaurant_id
    and user_id=auth.uid() and active and role='cashier' limit 1;
  if actor.id is null then raise exception 'Only an active cashier may close an invoice and release its table.'; end if;
  if target.dining_session_status<>'open' then return target; end if;
  if exists(select 1 from public.order_invoices i where i.restaurant_id=target.restaurant_id and i.order_id=target.id
    and i.payment_status='paid' and not exists(select 1 from public.receipt_generation_events r
      where r.restaurant_id=i.restaurant_id and r.invoice_id=i.id and r.status in('printed','reprinted','processed'))) then
    raise exception 'Every paid invoice requires a printed receipt before settlement.';
  end if;
  closed:=public.close_dining_session_phase122a_base(target.id,close_reason);
  update public.order_invoices set operational_status='closed',updated_at=now()
  where restaurant_id=target.restaurant_id and order_id=target.id and payment_status in('paid','cancelled','refunded');
  insert into public.shift_activity_logs(restaurant_id,shift_id,order_id,actor_staff_id,action,message,amount,metadata)
  values(target.restaurant_id,(select id from public.cashier_shifts where restaurant_id=target.restaurant_id and opened_by=actor.id and closed_at is null order by opened_at desc limit 1),
    target.id,actor.id,'invoice_settled','Invoice closed and table released',target.total_price,
    jsonb_build_object('table_id',target.table_id,'table_number',target.table_number,'confirmation',true,'reason',left(trim(coalesce(close_reason,'customer_left')),80)));
  return closed;
end;$$;

create or replace function public.cashier_close_invoice_and_release_table(target_order_id uuid,confirmed boolean)
returns public.orders language plpgsql security definer set search_path=public as $$
begin
  if not coalesce(confirmed,false) then raise exception 'Cashier confirmation is required.'; end if;
  return public.close_dining_session(target_order_id,'cashier_invoice_settlement');
end;$$;

create or replace function public.manager_emergency_release_table(target_order_id uuid,confirmed boolean,override_reason text)
returns public.orders language plpgsql security definer set search_path=public as $$
declare target public.orders; actor public.restaurant_staff; released public.orders; reason text:=nullif(left(trim(coalesce(override_reason,'')),500),'');
begin
  if not coalesce(confirmed,false) then raise exception 'Emergency release confirmation is required.'; end if;
  if reason is null then raise exception 'An emergency release reason is required.'; end if;
  select * into target from public.orders where id=target_order_id for update;
  if target.id is null then raise exception 'Dining session not found.'; end if;
  select * into actor from public.restaurant_staff where restaurant_id=target.restaurant_id
    and user_id=auth.uid() and active and role='manager' limit 1;
  if actor.id is null then raise exception 'Only an active manager may perform emergency table release.'; end if;
  if target.dining_session_status<>'open' then raise exception 'Only an open dining session can be released.'; end if;
  if exists(select 1 from public.order_invoices i where i.restaurant_id=target.restaurant_id and i.order_id=target.id and i.payment_status in('pending','held')) then
    raise exception 'Emergency release cannot bypass payment verification.';
  end if;
  update public.orders set dining_session_status='closed',dining_session_closed_at=now(),
    dining_session_close_reason='manager_emergency_override',table_released_at=now(),
    operational_status='closed',completed_at=coalesce(completed_at,now()),completed_by=actor.id,updated_at=now()
  where id=target.id and restaurant_id=target.restaurant_id returning * into released;
  insert into public.shift_activity_logs(restaurant_id,shift_id,order_id,actor_staff_id,action,message,amount,metadata)
  values(target.restaurant_id,null,target.id,actor.id,'manager_emergency_table_release',
    'Manager emergency table release',null,jsonb_build_object(
      'manager_id',actor.id,'restaurant_id',target.restaurant_id,'table_id',target.table_id,
      'table_number',target.table_number,'dining_session_id',target.id,'reason',reason,'confirmed',true,'emergency_override',true));
  return released;
end;$$;

revoke execute on function public.close_waiter_table(uuid) from authenticated,service_role;

create or replace function public.request_customer_final_bill(
  target_restaurant_slug text,table_number text,qr_token text,browser_session_token text,target_order_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare state jsonb; updated public.orders;
begin
  state:=public.get_smart_qr_portal_state(target_restaurant_slug,table_number,qr_token,browser_session_token);
  if state->>'mode'<>'waiter' or (state->>'order_id')::uuid<>target_order_id then raise exception 'The active customer session could not be verified.'; end if;
  update public.orders set bill_requested_at=coalesce(bill_requested_at,now()),
    bill_request_ignored_at=null,bill_request_ignored_by=null,updated_at=now()
  where id=target_order_id and restaurant_id=(state->>'restaurant_id')::uuid and dining_session_status='open'
  returning * into updated;
  if updated.id is null then raise exception 'Open dining session not found.'; end if;
  return jsonb_build_object('requested',true,'order_id',updated.id,'restaurant_id',updated.restaurant_id,'table_id',updated.table_id,'requested_at',updated.bill_requested_at);
end;$$;

create or replace function public.record_cashier_bill_action(target_order_id uuid,requested_action text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare target public.orders; actor public.restaurant_staff; action text:=lower(trim(coalesce(requested_action,'')));
begin
  select * into target from public.orders where id=target_order_id for update;
  if target.id is null then raise exception 'Dining session not found.'; end if;
  select * into actor from public.restaurant_staff where restaurant_id=target.restaurant_id
    and user_id=auth.uid() and active and role='cashier' limit 1;
  if actor.id is null then raise exception 'Only an active cashier may manage bill requests.'; end if;
  if target.bill_requested_at is null then raise exception 'No bill has been requested.'; end if;
  if action='prepare' then update public.orders set bill_prepared_at=now(),bill_prepared_by=actor.id,updated_at=now() where id=target.id;
  elsif action='print' then update public.orders set bill_prepared_at=coalesce(bill_prepared_at,now()),bill_prepared_by=coalesce(bill_prepared_by,actor.id),bill_printed_at=now(),bill_printed_by=actor.id,updated_at=now() where id=target.id;
  elsif action='ignore' then update public.orders set bill_request_ignored_at=now(),bill_request_ignored_by=actor.id,updated_at=now() where id=target.id;
  else raise exception 'Bill action must be prepare, print, or ignore.'; end if;
  insert into public.shift_activity_logs(restaurant_id,shift_id,order_id,actor_staff_id,action,message,metadata)
  values(target.restaurant_id,(select id from public.cashier_shifts where restaurant_id=target.restaurant_id and opened_by=actor.id and closed_at is null order by opened_at desc limit 1),target.id,actor.id,
    'bill_'||action,'Bill request '||action||' recorded',jsonb_build_object('table_id',target.table_id,'table_number',target.table_number,'requested_at',target.bill_requested_at));
  return jsonb_build_object('order_id',target.id,'action',action,'recorded_at',now());
end;$$;

create or replace function public.mark_cashier_session_receipts_printed(target_order_id uuid,is_reprint boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare target public.orders; actor public.restaurant_staff; affected integer;
begin
  select * into target from public.orders where id=target_order_id;
  if target.id is null then raise exception 'Dining session not found.'; end if;
  select * into actor from public.restaurant_staff where restaurant_id=target.restaurant_id and user_id=auth.uid() and active and role='cashier' limit 1;
  if actor.id is null then raise exception 'Only an active cashier may record receipt printing.'; end if;
  update public.receipt_generation_events r set status=case when is_reprint then 'reprinted' else 'printed' end,processed_at=now(),
    payload=coalesce(payload,'{}'::jsonb)||jsonb_build_object('last_action',case when is_reprint then 'reprint' else 'print' end,'last_action_at',now(),'last_action_by',actor.id)
  where r.restaurant_id=target.restaurant_id and r.order_id=target.id
    and exists(select 1 from public.order_invoices i where i.restaurant_id=r.restaurant_id and i.id=r.invoice_id and i.payment_status='paid');
  get diagnostics affected=row_count;
  return jsonb_build_object('order_id',target.id,'receipt_jobs_updated',affected,'status',case when is_reprint then 'reprinted' else 'printed' end);
end;$$;

-- Extend the Phase 12.2 projection without replacing its canonical authorities.
do $$ declare definition text;
begin
  select pg_get_functiondef('public.get_cashier_workflow_foundation(uuid)'::regprocedure) into definition;
  definition:=replace(definition,
    'select i.*,o.table_number,o.customer_name,o.display_number as order_number,',
    'select i.*,o.table_number,o.customer_name,o.display_number as order_number,o.bill_requested_at,o.bill_prepared_at,o.bill_printed_at,o.bill_request_ignored_at,');
  definition:=replace(definition,
    '''rejection_reason'',rejection_reason,''created_at'',created_at,',
    '''rejection_reason'',rejection_reason,''created_at'',created_at,''bill_requested_at'',bill_requested_at,''bill_status'',case when bill_request_ignored_at is not null then ''ignored'' when bill_printed_at is not null then ''printed'' when bill_prepared_at is not null then ''prepared'' when bill_requested_at is not null then ''requested'' else null end,');
  definition:=replace(definition,
    '''daily_settlement'',(select row_json from settlement),
    ''customer_assistance_queue''',
    '''daily_settlement'',(select row_json from settlement),
    ''bill_requested_queue'',coalesce((select jsonb_agg(row_json order by bill_requested_at) from queue where bill_requested_at is not null and bill_request_ignored_at is null),''[]''::jsonb),
    ''payment_retry_queue'',coalesce((select jsonb_agg(row_json order by retry_requested_at desc) from queue where retry_requested_at is not null or verification_status=''rejected''),''[]''::jsonb),
    ''receipt_pending_queue'',coalesce((select jsonb_agg(row_json order by created_at) from queue where receipt_job_status in(''pending'',''processing'',''waiting'')),''[]''::jsonb),
    ''invoice_settlement_queue'',coalesce((select jsonb_agg(row_json order by created_at) from queue where payment_status=''paid'' and receipt_job_status in(''printed'',''reprinted'',''processed'') and invoice_lifecycle<>''closed''),''[]''::jsonb),
    ''customer_assistance_queue''');
  if definition not like '%''bill_requested_queue''%' or definition not like '%o.bill_requested_at%' then raise exception 'Cashier workflow projection could not be finalized safely.'; end if;
  execute definition;
end $$;

revoke all on function public.close_dining_session(uuid,text),public.cashier_close_invoice_and_release_table(uuid,boolean),public.manager_emergency_release_table(uuid,boolean,text),public.record_cashier_bill_action(uuid,text),public.mark_cashier_session_receipts_printed(uuid,boolean) from public,anon;
revoke all on function public.request_customer_final_bill(text,text,text,text,uuid) from public;
grant execute on function public.close_dining_session(uuid,text),public.cashier_close_invoice_and_release_table(uuid,boolean),public.record_cashier_bill_action(uuid,text),public.mark_cashier_session_receipts_printed(uuid,boolean) to authenticated;
grant execute on function public.manager_emergency_release_table(uuid,boolean,text) to authenticated;
grant execute on function public.request_customer_final_bill(text,text,text,text,uuid) to anon,authenticated;

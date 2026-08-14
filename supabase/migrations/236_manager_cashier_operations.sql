-- Manager Live Operations: tenant-safe cashier supervision, expenses and handovers.
-- Reuses cashier_shifts, order_invoices, cash_reconciliations and shift_activity_logs.

create table if not exists public.cashier_shift_expenses (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  shift_id uuid not null references public.cashier_shifts(id) on delete restrict,
  cashier_staff_id uuid not null references public.restaurant_staff(id) on delete restrict,
  created_by uuid not null references public.restaurant_staff(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  reason text not null check (length(trim(reason)) > 0),
  note text,
  evidence_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.restaurant_staff(id) on delete restrict,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  constraint cashier_shift_expenses_review_state check (
    (status='pending' and reviewed_by is null and reviewed_at is null and rejection_reason is null)
    or (status='approved' and reviewed_by is not null and reviewed_at is not null and rejection_reason is null)
    or (status='rejected' and reviewed_by is not null and reviewed_at is not null and length(trim(rejection_reason)) > 0)
  ),
  constraint cashier_shift_expenses_shift_same_restaurant foreign key (restaurant_id, shift_id)
    references public.cashier_shifts(restaurant_id, id) on delete restrict,
  constraint cashier_shift_expenses_cashier_same_restaurant foreign key (restaurant_id, cashier_staff_id)
    references public.restaurant_staff(restaurant_id, id) on delete restrict,
  constraint cashier_shift_expenses_created_by_same_restaurant foreign key (restaurant_id, created_by)
    references public.restaurant_staff(restaurant_id, id) on delete restrict,
  constraint cashier_shift_expenses_reviewed_by_same_restaurant foreign key (restaurant_id, reviewed_by)
    references public.restaurant_staff(restaurant_id, id) on delete restrict
);

create index if not exists cashier_shift_expenses_restaurant_status_idx
on public.cashier_shift_expenses(restaurant_id,status,created_at desc);
create index if not exists cashier_shift_expenses_shift_idx
on public.cashier_shift_expenses(shift_id,created_at desc);

create table if not exists public.cashier_cash_handovers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  outgoing_shift_id uuid not null references public.cashier_shifts(id) on delete restrict,
  incoming_shift_id uuid references public.cashier_shifts(id) on delete restrict,
  outgoing_cashier_id uuid not null references public.restaurant_staff(id) on delete restrict,
  incoming_cashier_id uuid not null references public.restaurant_staff(id) on delete restrict,
  expected_amount numeric(12,2) not null check (expected_amount >= 0),
  declared_amount numeric(12,2) not null check (declared_amount >= 0),
  received_amount numeric(12,2) check (received_amount >= 0),
  difference numeric(12,2),
  status text not null default 'awaiting_confirmation' check (status in ('awaiting_confirmation','confirmed','discrepancy')),
  initiated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  outgoing_note text,
  incoming_note text,
  constraint cashier_cash_handovers_distinct_staff check (outgoing_cashier_id <> incoming_cashier_id),
  constraint cashier_cash_handovers_confirmation_state check (
    (status='awaiting_confirmation' and received_amount is null and difference is null and confirmed_at is null)
    or (status in ('confirmed','discrepancy') and received_amount is not null and difference is not null and confirmed_at is not null)
  ),
  constraint cashier_cash_handovers_outgoing_shift_same_restaurant foreign key (restaurant_id, outgoing_shift_id)
    references public.cashier_shifts(restaurant_id, id) on delete restrict,
  constraint cashier_cash_handovers_incoming_shift_same_restaurant foreign key (restaurant_id, incoming_shift_id)
    references public.cashier_shifts(restaurant_id, id) on delete restrict,
  constraint cashier_cash_handovers_outgoing_staff_same_restaurant foreign key (restaurant_id, outgoing_cashier_id)
    references public.restaurant_staff(restaurant_id, id) on delete restrict,
  constraint cashier_cash_handovers_incoming_staff_same_restaurant foreign key (restaurant_id, incoming_cashier_id)
    references public.restaurant_staff(restaurant_id, id) on delete restrict
);

create unique index if not exists cashier_cash_handovers_one_pending_outgoing_shift
on public.cashier_cash_handovers(outgoing_shift_id) where status='awaiting_confirmation';
create index if not exists cashier_cash_handovers_restaurant_status_idx
on public.cashier_cash_handovers(restaurant_id,status,initiated_at desc);

alter table public.cashier_shift_expenses enable row level security;
alter table public.cashier_cash_handovers enable row level security;
revoke all on public.cashier_shift_expenses, public.cashier_cash_handovers from anon, authenticated;
grant select on public.cashier_shift_expenses, public.cashier_cash_handovers to authenticated;

drop policy if exists cashier_shift_expenses_select_authorized on public.cashier_shift_expenses;
create policy cashier_shift_expenses_select_authorized on public.cashier_shift_expenses
for select to authenticated using (
  public.has_shift_admin_role(restaurant_id)
  or exists(select 1 from public.restaurant_staff s where s.id=cashier_shift_expenses.cashier_staff_id and s.restaurant_id=cashier_shift_expenses.restaurant_id and s.user_id=auth.uid() and s.active and s.role::text='cashier')
);

drop policy if exists cashier_cash_handovers_select_authorized on public.cashier_cash_handovers;
create policy cashier_cash_handovers_select_authorized on public.cashier_cash_handovers
for select to authenticated using (
  public.has_shift_admin_role(restaurant_id)
  or exists(select 1 from public.restaurant_staff s where s.restaurant_id=cashier_cash_handovers.restaurant_id and s.user_id=auth.uid() and s.active and s.id in (cashier_cash_handovers.outgoing_cashier_id,cashier_cash_handovers.incoming_cashier_id))
);

create or replace function public.prevent_cash_control_delete() returns trigger
language plpgsql set search_path=public as $$ begin
  raise exception 'Cash-control records cannot be deleted.';
end; $$;
create or replace function public.protect_cashier_shift_expense_update() returns trigger
language plpgsql set search_path=public as $$
begin
  if old.restaurant_id is distinct from new.restaurant_id
    or old.shift_id is distinct from new.shift_id
    or old.cashier_staff_id is distinct from new.cashier_staff_id
    or old.created_by is distinct from new.created_by
    or old.amount is distinct from new.amount
    or old.reason is distinct from new.reason
    or old.note is distinct from new.note
    or old.evidence_path is distinct from new.evidence_path
    or old.created_at is distinct from new.created_at then
    raise exception 'Cash expense records cannot be rewritten.';
  end if;
  if old.status <> 'pending' then
    raise exception 'Reviewed cash expenses are immutable.';
  end if;
  return new;
end; $$;
create or replace function public.protect_cashier_cash_handover_update() returns trigger
language plpgsql set search_path=public as $$
begin
  if old.restaurant_id is distinct from new.restaurant_id
    or old.outgoing_shift_id is distinct from new.outgoing_shift_id
    or old.outgoing_cashier_id is distinct from new.outgoing_cashier_id
    or old.incoming_cashier_id is distinct from new.incoming_cashier_id
    or old.expected_amount is distinct from new.expected_amount
    or old.declared_amount is distinct from new.declared_amount
    or old.initiated_at is distinct from new.initiated_at
    or old.outgoing_note is distinct from new.outgoing_note then
    raise exception 'Cash handover records cannot be rewritten.';
  end if;
  if old.incoming_shift_id is not null and old.incoming_shift_id is distinct from new.incoming_shift_id then
    raise exception 'Cash handover records cannot be rewritten.';
  end if;
  if old.status <> 'awaiting_confirmation' then
    raise exception 'Confirmed cash handovers are immutable.';
  end if;
  return new;
end; $$;
drop trigger if exists cashier_shift_expenses_no_delete on public.cashier_shift_expenses;
create trigger cashier_shift_expenses_no_delete before delete on public.cashier_shift_expenses
for each row execute function public.prevent_cash_control_delete();
drop trigger if exists cashier_shift_expenses_protect_update on public.cashier_shift_expenses;
create trigger cashier_shift_expenses_protect_update before update on public.cashier_shift_expenses
for each row execute function public.protect_cashier_shift_expense_update();
drop trigger if exists cashier_cash_handovers_no_delete on public.cashier_cash_handovers;
create trigger cashier_cash_handovers_no_delete before delete on public.cashier_cash_handovers
for each row execute function public.prevent_cash_control_delete();
drop trigger if exists cashier_cash_handovers_protect_update on public.cashier_cash_handovers;
create trigger cashier_cash_handovers_protect_update before update on public.cashier_cash_handovers
for each row execute function public.protect_cashier_cash_handover_update();

create or replace function public.cashier_shift_drawer_totals(target_shift_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare target public.cashier_shifts; cash_sales numeric:=0; non_cash numeric:=0; cash_refunds numeric:=0; approved_expenses numeric:=0; pending_expenses numeric:=0;
begin
  select * into target from public.cashier_shifts where id=target_shift_id;
  if target.id is null then raise exception 'Shift not found.'; end if;
  if not public.has_shift_admin_role(target.restaurant_id) and not exists(
    select 1 from public.restaurant_staff s where s.id=target.opened_by and s.user_id=auth.uid() and s.active and s.role::text='cashier'
  ) then raise exception 'Not authorized to view this cashier shift.'; end if;

  select
    coalesce(sum(coalesce(i.grand_total,i.total_price,0)) filter(where i.payment_status='paid' and coalesce(public.normalize_payment_method(i.payment_method),public.normalize_payment_method(o.payment_method))='Cash'),0),
    coalesce(sum(coalesce(i.grand_total,i.total_price,0)) filter(where i.payment_status='paid' and coalesce(public.normalize_payment_method(i.payment_method),public.normalize_payment_method(o.payment_method))<>'Cash'),0),
    coalesce(sum(coalesce(i.grand_total,i.total_price,0)) filter(where i.payment_status='refunded' and coalesce(public.normalize_payment_method(i.payment_method),public.normalize_payment_method(o.payment_method))='Cash'),0)
  into cash_sales,non_cash,cash_refunds
  from public.order_invoices i join public.orders o on o.id=i.order_id and o.restaurant_id=i.restaurant_id
  where i.restaurant_id=target.restaurant_id and i.cashier_shift_id=target.id;

  select coalesce(sum(amount) filter(where status='approved'),0),coalesce(sum(amount) filter(where status='pending'),0)
  into approved_expenses,pending_expenses from public.cashier_shift_expenses where shift_id=target.id and restaurant_id=target.restaurant_id;

  return jsonb_build_object('cash_sales',cash_sales,'non_cash_sales',non_cash,'cash_refunds',cash_refunds,
    'approved_expenses',approved_expenses,'pending_expenses',pending_expenses,
    'expected_cash',target.opening_cash+cash_sales-cash_refunds-approved_expenses);
end; $$;
revoke all on function public.cashier_shift_drawer_totals(uuid) from public,anon;
grant execute on function public.cashier_shift_drawer_totals(uuid) to authenticated;

create or replace function public.record_cashier_shift_expense(target_shift_id uuid, expense_amount numeric, expense_reason text, expense_note text default null)
returns public.cashier_shift_expenses language plpgsql security definer set search_path=public as $$
declare actor public.restaurant_staff; target public.cashier_shifts; created public.cashier_shift_expenses;
begin
  if expense_amount is null or expense_amount<=0 then raise exception 'Expense amount must be greater than zero.'; end if;
  if nullif(trim(expense_reason),'') is null then raise exception 'Expense reason is required.'; end if;
  select * into target from public.cashier_shifts where id=target_shift_id for update;
  if target.id is null or target.closed_at is not null then raise exception 'An active cashier shift is required.'; end if;
  select * into actor from public.restaurant_staff where id=target.opened_by and restaurant_id=target.restaurant_id and user_id=auth.uid() and active and role::text='cashier';
  if actor.id is null then raise exception 'Only the cashier who opened this shift may record its expenses.'; end if;
  insert into public.cashier_shift_expenses(restaurant_id,shift_id,cashier_staff_id,created_by,amount,reason,note)
  values(target.restaurant_id,target.id,actor.id,actor.id,expense_amount,trim(expense_reason),nullif(trim(expense_note),'')) returning * into created;
  insert into public.shift_activity_logs(restaurant_id,shift_id,actor_staff_id,action,message,amount,metadata)
  values(target.restaurant_id,target.id,actor.id,'expense_created','Cash expense submitted for manager review',expense_amount,jsonb_build_object('expense_id',created.id,'reason',created.reason,'status','pending'));
  return created;
end; $$;
revoke all on function public.record_cashier_shift_expense(uuid,numeric,text,text) from public,anon;
grant execute on function public.record_cashier_shift_expense(uuid,numeric,text,text) to authenticated;

create or replace function public.review_cashier_shift_expense(target_expense_id uuid, decision text, rejection_explanation text default null)
returns public.cashier_shift_expenses language plpgsql security definer set search_path=public as $$
declare actor public.restaurant_staff; target public.cashier_shift_expenses; reviewed public.cashier_shift_expenses;
begin
  if decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected.'; end if;
  select * into target from public.cashier_shift_expenses where id=target_expense_id for update;
  if target.id is null then raise exception 'Expense not found.'; end if;
  if target.status<>'pending' then raise exception 'Expense has already been reviewed.'; end if;
  select * into actor from public.restaurant_staff where restaurant_id=target.restaurant_id and user_id=auth.uid() and active and role::text in ('owner','manager') limit 1;
  if actor.id is null then raise exception 'Manager or owner authority is required.'; end if;
  if decision='rejected' and nullif(trim(rejection_explanation),'') is null then raise exception 'A rejection reason is required.'; end if;
  update public.cashier_shift_expenses set status=decision,reviewed_by=actor.id,reviewed_at=now(),
    rejection_reason=case when decision='rejected' then trim(rejection_explanation) else null end
  where id=target.id returning * into reviewed;
  insert into public.shift_activity_logs(restaurant_id,shift_id,actor_staff_id,action,message,amount,metadata)
  values(target.restaurant_id,target.shift_id,actor.id,'expense_'||decision,'Cash expense '||decision,target.amount,
    jsonb_build_object('expense_id',target.id,'previous_status','pending','new_status',decision,'reason',target.reason,'rejection_reason',reviewed.rejection_reason));
  return reviewed;
end; $$;
revoke all on function public.review_cashier_shift_expense(uuid,text,text) from public,anon;
grant execute on function public.review_cashier_shift_expense(uuid,text,text) to authenticated;

create or replace function public.initiate_cashier_handover(target_shift_id uuid, incoming_staff_id uuid, declared_cash numeric, handover_note text default null)
returns public.cashier_cash_handovers language plpgsql security definer set search_path=public as $$
declare actor public.restaurant_staff; incoming public.restaurant_staff; target public.cashier_shifts; totals jsonb; created public.cashier_cash_handovers;
begin
  if declared_cash is null or declared_cash<0 then raise exception 'Declared cash must be zero or greater.'; end if;
  select * into target from public.cashier_shifts where id=target_shift_id and closed_at is null for update;
  if target.id is null then raise exception 'Active outgoing shift not found.'; end if;
  select * into actor from public.restaurant_staff where id=target.opened_by and restaurant_id=target.restaurant_id and user_id=auth.uid() and active and role::text='cashier';
  if actor.id is null then raise exception 'Only the outgoing cashier may initiate handover.'; end if;
  select * into incoming from public.restaurant_staff where id=incoming_staff_id and restaurant_id=target.restaurant_id and active and role::text='cashier';
  if incoming.id is null or incoming.id=actor.id then raise exception 'Select another eligible cashier in this business.'; end if;
  totals:=public.cashier_shift_drawer_totals(target.id);
  insert into public.cashier_cash_handovers(restaurant_id,outgoing_shift_id,incoming_shift_id,outgoing_cashier_id,incoming_cashier_id,expected_amount,declared_amount,outgoing_note)
  values(target.restaurant_id,target.id,(select id from public.cashier_shifts where restaurant_id=target.restaurant_id and opened_by=incoming.id and closed_at is null order by opened_at desc limit 1),actor.id,incoming.id,(totals->>'expected_cash')::numeric,declared_cash,nullif(trim(handover_note),'')) returning * into created;
  insert into public.shift_activity_logs(restaurant_id,shift_id,actor_staff_id,action,message,amount,metadata)
  values(target.restaurant_id,target.id,actor.id,'handover_initiated','Cash handover awaiting incoming cashier confirmation',declared_cash,jsonb_build_object('handover_id',created.id,'incoming_cashier_id',incoming.id,'expected_amount',created.expected_amount));
  return created;
end; $$;
revoke all on function public.initiate_cashier_handover(uuid,uuid,numeric,text) from public,anon;
grant execute on function public.initiate_cashier_handover(uuid,uuid,numeric,text) to authenticated;

create or replace function public.confirm_cashier_handover(target_handover_id uuid, counted_cash numeric, confirmation_note text default null)
returns public.cashier_cash_handovers language plpgsql security definer set search_path=public as $$
declare actor public.restaurant_staff; target public.cashier_cash_handovers; diff numeric; next_status text; confirmed public.cashier_cash_handovers;
begin
  if counted_cash is null or counted_cash<0 then raise exception 'Received cash must be zero or greater.'; end if;
  select * into target from public.cashier_cash_handovers where id=target_handover_id for update;
  if target.id is null then raise exception 'Handover not found.'; end if;
  if target.status<>'awaiting_confirmation' then raise exception 'Handover is already finalized.'; end if;
  select * into actor from public.restaurant_staff where id=target.incoming_cashier_id and restaurant_id=target.restaurant_id and user_id=auth.uid() and active and role::text='cashier';
  if actor.id is null then raise exception 'Only the designated incoming cashier may confirm this handover.'; end if;
  diff:=counted_cash-target.expected_amount; next_status:=case when diff=0 then 'confirmed' else 'discrepancy' end;
  if diff<>0 and nullif(trim(confirmation_note),'') is null then raise exception 'A discrepancy note is required when received cash differs from expected cash.'; end if;
  update public.cashier_cash_handovers set received_amount=counted_cash,difference=diff,status=next_status,confirmed_at=now(),incoming_note=nullif(trim(confirmation_note),''),
    incoming_shift_id=coalesce(incoming_shift_id,(select id from public.cashier_shifts where restaurant_id=target.restaurant_id and opened_by=actor.id and closed_at is null order by opened_at desc limit 1))
  where id=target.id returning * into confirmed;
  insert into public.shift_activity_logs(restaurant_id,shift_id,actor_staff_id,action,message,amount,metadata)
  values(target.restaurant_id,target.outgoing_shift_id,actor.id,'handover_'||next_status,case when next_status='confirmed' then 'Cash handover confirmed' else 'Cash handover discrepancy recorded' end,counted_cash,
    jsonb_build_object('handover_id',target.id,'expected_amount',target.expected_amount,'received_amount',counted_cash,'difference',diff));
  return confirmed;
end; $$;
revoke all on function public.confirm_cashier_handover(uuid,numeric,text) from public,anon;
grant execute on function public.confirm_cashier_handover(uuid,numeric,text) to authenticated;

create or replace function public.get_manager_cashier_operations(target_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  if not public.has_shift_admin_role(target_restaurant_id) then raise exception 'Manager or owner authority is required.'; end if;
  select jsonb_build_object(
    'active_shifts',coalesce((select jsonb_agg(row_data order by (row_data->>'opened_at') desc) from (
      select jsonb_build_object('id',cs.id,'cashier_id',s.id,'cashier_name',s.display_name,'employee_id',s.employee_id,'opened_at',cs.opened_at,'opening_cash',cs.opening_cash,
        'cash_collected',(drawer.data->>'cash_sales')::numeric,'non_cash_collected',(drawer.data->>'non_cash_sales')::numeric,'approved_expenses',(drawer.data->>'approved_expenses')::numeric,
        'pending_expenses',(drawer.data->>'pending_expenses')::numeric,'expected_cash',(drawer.data->>'expected_cash')::numeric,'status','active') row_data
      from public.cashier_shifts cs join public.restaurant_staff s on s.id=cs.opened_by and s.restaurant_id=cs.restaurant_id
      cross join lateral (select public.cashier_shift_drawer_totals(cs.id) data) drawer where cs.restaurant_id=target_restaurant_id and cs.closed_at is null
    ) active_rows),'[]'::jsonb),
    'expenses',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'shift_id',e.shift_id,'cashier_id',e.cashier_staff_id,'cashier_name',s.display_name,'employee_id',s.employee_id,'amount',e.amount,'reason',e.reason,'note',e.note,'status',e.status,'created_at',e.created_at,'reviewed_at',e.reviewed_at,'rejection_reason',e.rejection_reason) order by e.created_at desc)
      from public.cashier_shift_expenses e join public.restaurant_staff s on s.id=e.cashier_staff_id where e.restaurant_id=target_restaurant_id and e.created_at>=now()-interval '7 days'),'[]'::jsonb),
    'handovers',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'outgoing_shift_id',h.outgoing_shift_id,'outgoing_name',so.display_name,'incoming_name',si.display_name,'expected_amount',h.expected_amount,'declared_amount',h.declared_amount,'received_amount',h.received_amount,'difference',h.difference,'status',h.status,'initiated_at',h.initiated_at,'confirmed_at',h.confirmed_at,'incoming_note',h.incoming_note) order by h.initiated_at desc)
      from public.cashier_cash_handovers h join public.restaurant_staff so on so.id=h.outgoing_cashier_id join public.restaurant_staff si on si.id=h.incoming_cashier_id where h.restaurant_id=target_restaurant_id and h.initiated_at>=now()-interval '7 days'),'[]'::jsonb),
    'reconciliations',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'shift_id',r.shift_id,'cashier_name',s.display_name,'expected_cash',r.expected_cash,'actual_cash',r.actual_cash,'variance',r.variance,'variance_reason',r.variance_reason,'closed_at',r.closed_at) order by r.closed_at desc)
      from public.cash_reconciliations r join public.cashier_shifts cs on cs.id=r.shift_id join public.restaurant_staff s on s.id=cs.opened_by where r.restaurant_id=target_restaurant_id and r.closed_at>=now()-interval '7 days'),'[]'::jsonb),
    'cash_collected_today',coalesce((select sum(coalesce(i.grand_total,i.total_price,0)) from public.order_invoices i join public.orders o on o.id=i.order_id and o.restaurant_id=i.restaurant_id where i.restaurant_id=target_restaurant_id and i.payment_status='paid' and coalesce(public.normalize_payment_method(i.payment_method),public.normalize_payment_method(o.payment_method))='Cash' and i.verified_at>=date_trunc('day',now())),0),
    'recent_events',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'shift_id',l.shift_id,'actor_name',s.display_name,'action',l.action,'message',l.message,'amount',l.amount,'created_at',l.created_at) order by l.created_at desc) from public.shift_activity_logs l left join public.restaurant_staff s on s.id=l.actor_staff_id where l.restaurant_id=target_restaurant_id and l.action in ('shift_opened','shift_closed','expense_created','expense_approved','expense_rejected','handover_initiated','handover_confirmed','handover_discrepancy') and l.created_at>=now()-interval '7 days' limit 30),'[]'::jsonb)
  ) into result;
  return result;
end; $$;
revoke all on function public.get_manager_cashier_operations(uuid) from public,anon;
grant execute on function public.get_manager_cashier_operations(uuid) to authenticated;

-- Include recognized drawer expenses in the existing cashier summary and close calculation.
create or replace function public.get_cashier_shift_summary(target_restaurant_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare staff public.restaurant_staff; shift public.cashier_shifts; totals jsonb; orders_count int:=0; payments_count int:=0;
begin
  select * into staff from public.restaurant_staff where user_id=auth.uid() and restaurant_id=target_restaurant_id and active and role::text in ('cashier','owner','manager') limit 1;
  if staff.id is null then raise exception 'Only active cashiers, managers, and owners may view shift status.'; end if;
  if staff.role::text='cashier' then select * into shift from public.cashier_shifts where restaurant_id=target_restaurant_id and opened_by=staff.id and closed_at is null order by opened_at desc limit 1;
  else select * into shift from public.cashier_shifts where restaurant_id=target_restaurant_id and closed_at is null order by opened_at desc limit 1; end if;
  if shift.id is not null then
    totals:=public.cashier_shift_drawer_totals(shift.id);
    select count(distinct order_id),count(*) into orders_count,payments_count from public.order_invoices where restaurant_id=target_restaurant_id and cashier_shift_id=shift.id and payment_status='paid';
  end if;
  return jsonb_build_object('staff_id',staff.id,'active_shift',case when shift.id is null then null else jsonb_build_object('id',shift.id,'restaurant_id',shift.restaurant_id,'opened_by',shift.opened_by,'opened_at',shift.opened_at,'opening_cash',shift.opening_cash,'notes',shift.notes,
    'cash_collected',(totals->>'cash_sales')::numeric,'digital_collected',(totals->>'non_cash_sales')::numeric,'cash_refunds',(totals->>'cash_refunds')::numeric,'approved_expenses',(totals->>'approved_expenses')::numeric,'pending_expenses',(totals->>'pending_expenses')::numeric,
    'orders_processed',orders_count,'payments_processed',payments_count,'expected_cash',(totals->>'expected_cash')::numeric) end);
end; $$;

do $$ declare definition text; updated text; begin
  definition:=pg_get_functiondef('public.close_cashier_shift(uuid,numeric,text)'::regprocedure);
  updated:=replace(definition,
    'expected_drawer := target_shift.opening_cash + cash_payments - cash_refunds;',
    'if exists(select 1 from public.cashier_shift_expenses where shift_id=target_shift.id and status=''pending'') then raise exception ''Shift cannot close while cash expenses await manager review.''; end if;
     if exists(select 1 from public.cashier_cash_handovers where outgoing_shift_id=target_shift.id and status=''awaiting_confirmation'') then raise exception ''Shift cannot close while cash handover awaits incoming confirmation.''; end if;
     select (public.cashier_shift_drawer_totals(target_shift.id)->>''expected_cash'')::numeric into expected_drawer;');
  if updated=definition then raise exception 'Could not safely extend close_cashier_shift expected-cash calculation.'; end if;
  execute updated;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.cashier_shift_expenses;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.cashier_cash_handovers;
exception when duplicate_object then null; end $$;

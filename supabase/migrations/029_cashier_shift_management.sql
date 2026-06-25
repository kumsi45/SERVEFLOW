-- SERVEFLOW cashier shift management and reconciliation.
-- Adds operational shift audit tables and RPCs without changing order workflow semantics.

create or replace function public.has_shift_admin_role(target_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.restaurant_staff staff
    where staff.restaurant_id = target_restaurant_id
      and staff.user_id = auth.uid()
      and staff.active = true
      and staff.role::text in ('owner', 'manager')
  )
$$;

revoke all on function public.has_shift_admin_role(uuid) from public, anon;
grant execute on function public.has_shift_admin_role(uuid) to authenticated, service_role;

create table if not exists public.cashier_shifts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  opened_by uuid not null references public.restaurant_staff(id) on delete restrict,
  closed_by uuid references public.restaurant_staff(id) on delete restrict,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_cash numeric(12, 2) not null default 0 check (opening_cash >= 0),
  notes text,
  expected_cash numeric(12, 2),
  actual_cash numeric(12, 2),
  variance numeric(12, 2),
  variance_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, opened_by, id),
  constraint cashier_shifts_closed_values check (
    (closed_at is null and closed_by is null and expected_cash is null and actual_cash is null and variance is null)
    or
    (closed_at is not null and closed_by is not null and expected_cash is not null and actual_cash is not null and variance is not null)
  )
);

create unique index if not exists cashier_shifts_one_active_per_staff
on public.cashier_shifts (restaurant_id, opened_by)
where closed_at is null;

create index if not exists cashier_shifts_restaurant_opened_idx
on public.cashier_shifts (restaurant_id, opened_at desc);

create index if not exists cashier_shifts_restaurant_active_idx
on public.cashier_shifts (restaurant_id, opened_at desc)
where closed_at is null;

create table if not exists public.cash_reconciliations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  shift_id uuid not null references public.cashier_shifts(id) on delete cascade,
  closed_by uuid not null references public.restaurant_staff(id) on delete restrict,
  opening_cash numeric(12, 2) not null,
  cash_payments numeric(12, 2) not null default 0,
  cash_refunds numeric(12, 2) not null default 0,
  expected_cash numeric(12, 2) not null,
  actual_cash numeric(12, 2) not null,
  variance numeric(12, 2) not null,
  variance_reason text,
  closed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (shift_id),
  constraint cash_reconciliations_non_negative_amounts check (
    opening_cash >= 0
    and cash_payments >= 0
    and cash_refunds >= 0
    and expected_cash >= 0
    and actual_cash >= 0
  )
);

create index if not exists cash_reconciliations_restaurant_closed_idx
on public.cash_reconciliations (restaurant_id, closed_at desc);

create or replace function public.prevent_cash_reconciliation_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Cash reconciliation records are immutable.';
end;
$$;

drop trigger if exists cash_reconciliations_immutable_update on public.cash_reconciliations;
create trigger cash_reconciliations_immutable_update
before update on public.cash_reconciliations
for each row
execute function public.prevent_cash_reconciliation_mutation();

drop trigger if exists cash_reconciliations_immutable_delete on public.cash_reconciliations;
create trigger cash_reconciliations_immutable_delete
before delete on public.cash_reconciliations
for each row
execute function public.prevent_cash_reconciliation_mutation();

create table if not exists public.shift_activity_logs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  shift_id uuid references public.cashier_shifts(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  actor_staff_id uuid references public.restaurant_staff(id) on delete set null,
  action text not null,
  message text not null,
  amount numeric(12, 2),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists shift_activity_logs_restaurant_created_idx
on public.shift_activity_logs (restaurant_id, created_at desc);

create index if not exists shift_activity_logs_shift_created_idx
on public.shift_activity_logs (shift_id, created_at desc);

drop trigger if exists cashier_shifts_set_updated_at on public.cashier_shifts;
create trigger cashier_shifts_set_updated_at
before update on public.cashier_shifts
for each row
execute function public.set_updated_at();

alter table public.cashier_shifts enable row level security;
alter table public.cash_reconciliations enable row level security;
alter table public.shift_activity_logs enable row level security;

revoke all on public.cashier_shifts from anon, authenticated;
revoke all on public.cash_reconciliations from anon, authenticated;
revoke all on public.shift_activity_logs from anon, authenticated;
grant select on public.cashier_shifts to authenticated;
grant select on public.cash_reconciliations to authenticated;
grant select on public.shift_activity_logs to authenticated;

drop policy if exists cashier_shifts_select_staff_same_restaurant on public.cashier_shifts;
create policy cashier_shifts_select_staff_same_restaurant
on public.cashier_shifts
for select
to authenticated
using (
  public.has_shift_admin_role(restaurant_id)
  or exists (
    select 1
    from public.restaurant_staff staff
    where staff.id = cashier_shifts.opened_by
      and staff.restaurant_id = cashier_shifts.restaurant_id
      and staff.user_id = auth.uid()
      and staff.active = true
      and staff.role = 'cashier'
  )
);

drop policy if exists cash_reconciliations_select_staff_same_restaurant on public.cash_reconciliations;
create policy cash_reconciliations_select_staff_same_restaurant
on public.cash_reconciliations
for select
to authenticated
using (
  public.has_shift_admin_role(restaurant_id)
  or exists (
    select 1
    from public.cashier_shifts shifts
    join public.restaurant_staff staff
      on staff.id = shifts.opened_by
     and staff.restaurant_id = shifts.restaurant_id
    where shifts.id = cash_reconciliations.shift_id
      and shifts.restaurant_id = cash_reconciliations.restaurant_id
      and staff.user_id = auth.uid()
      and staff.active = true
      and staff.role = 'cashier'
  )
);

drop policy if exists shift_activity_logs_select_staff_same_restaurant on public.shift_activity_logs;
create policy shift_activity_logs_select_staff_same_restaurant
on public.shift_activity_logs
for select
to authenticated
using (
  public.has_shift_admin_role(restaurant_id)
  or exists (
    select 1
    from public.cashier_shifts shifts
    join public.restaurant_staff staff
      on staff.id = shifts.opened_by
     and staff.restaurant_id = shifts.restaurant_id
    where shifts.id = shift_activity_logs.shift_id
      and shifts.restaurant_id = shift_activity_logs.restaurant_id
      and staff.user_id = auth.uid()
      and staff.active = true
      and staff.role = 'cashier'
  )
);

create or replace function public.get_cashier_shift_summary(target_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  active_shift public.cashier_shifts;
  cash_total numeric(12, 2) := 0;
  digital_total numeric(12, 2) := 0;
  orders_processed integer := 0;
  payments_processed integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to view shift status.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = auth.uid()
    and restaurant_id = target_restaurant_id
    and active = true
    and role::text in ('cashier', 'owner', 'manager')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers, managers, and owners may view shift status.';
  end if;

  if acting_staff.role = 'cashier' then
    select *
    into active_shift
    from public.cashier_shifts
    where restaurant_id = target_restaurant_id
      and opened_by = acting_staff.id
      and closed_at is null
    order by opened_at desc
    limit 1;
  end if;

  if active_shift.id is not null then
    select
      coalesce(sum(o.total_price) filter (where o.payment_method = 'Cash' and o.payment_verified_at is not null and o.payment_verified_by = active_shift.opened_by), 0),
      coalesce(sum(o.total_price) filter (where coalesce(o.payment_method, '') <> 'Cash' and o.payment_verified_at is not null and o.payment_verified_by = active_shift.opened_by), 0),
      count(*) filter (where o.created_at >= active_shift.opened_at),
      count(*) filter (where o.payment_verified_at is not null)
    into cash_total, digital_total, orders_processed, payments_processed
    from public.orders o
    where o.restaurant_id = target_restaurant_id
      and o.created_at >= active_shift.opened_at;
  end if;

  return jsonb_build_object(
    'staff_id', acting_staff.id,
    'active_shift', case when active_shift.id is null then null else jsonb_build_object(
      'id', active_shift.id,
      'restaurant_id', active_shift.restaurant_id,
      'opened_by', active_shift.opened_by,
      'opened_at', active_shift.opened_at,
      'opening_cash', active_shift.opening_cash,
      'notes', active_shift.notes,
      'cash_collected', cash_total,
      'digital_collected', digital_total,
      'orders_processed', orders_processed,
      'payments_processed', payments_processed,
      'expected_cash', active_shift.opening_cash + cash_total
    ) end
  );
end;
$$;

revoke all on function public.get_cashier_shift_summary(uuid) from public, anon;
grant execute on function public.get_cashier_shift_summary(uuid) to authenticated;

create or replace function public.open_cashier_shift(
  target_restaurant_id uuid,
  opening_cash_amount numeric,
  opening_notes text default null
)
returns public.cashier_shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  created_shift public.cashier_shifts;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to open a shift.';
  end if;

  if opening_cash_amount is null or opening_cash_amount < 0 then
    raise exception 'Opening cash must be zero or greater.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = auth.uid()
    and restaurant_id = target_restaurant_id
    and active = true
    and role in ('cashier', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers and owners may open cashier shifts.';
  end if;

  if exists (
    select 1
    from public.cashier_shifts cs
    where cs.restaurant_id = target_restaurant_id
      and cs.opened_by = acting_staff.id
      and cs.closed_at is null
  ) then
    raise exception 'An active shift is already open.';
  end if;

  insert into public.cashier_shifts (restaurant_id, opened_by, opening_cash, notes)
  values (target_restaurant_id, acting_staff.id, opening_cash_amount, nullif(trim(opening_notes), ''))
  returning * into created_shift;

  insert into public.shift_activity_logs (restaurant_id, shift_id, actor_staff_id, action, message, amount)
  values (
    target_restaurant_id,
    created_shift.id,
    acting_staff.id,
    'shift_opened',
    'Shift opened',
    opening_cash_amount
  );

  return created_shift;
exception
  when unique_violation then
    raise exception 'An active shift is already open.';
end;
$$;

revoke all on function public.open_cashier_shift(uuid, numeric, text) from public, anon;
grant execute on function public.open_cashier_shift(uuid, numeric, text) to authenticated;

create or replace function public.close_cashier_shift(
  target_shift_id uuid,
  actual_cash_amount numeric,
  variance_explanation text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  target_shift public.cashier_shifts;
  cash_payments numeric(12, 2) := 0;
  cash_refunds numeric(12, 2) := 0;
  expected_drawer numeric(12, 2);
  variance_amount numeric(12, 2);
  unpaid_orders integer := 0;
  active_orders integer := 0;
  reconciliation_row public.cash_reconciliations;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to close a shift.';
  end if;

  if actual_cash_amount is null or actual_cash_amount < 0 then
    raise exception 'Actual cash must be zero or greater.';
  end if;

  select *
  into target_shift
  from public.cashier_shifts
  where id = target_shift_id
  for update;

  if target_shift.id is null then
    raise exception 'Shift not found.';
  end if;

  if target_shift.closed_at is not null then
    raise exception 'Shift is already closed.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = auth.uid()
    and restaurant_id = target_shift.restaurant_id
    and active = true
    and role in ('cashier', 'owner')
  limit 1;

  if acting_staff.id is null or acting_staff.id <> target_shift.opened_by then
    raise exception 'Only the cashier who opened this shift may close it.';
  end if;

  select coalesce(sum(o.total_price), 0)
  into cash_payments
  from public.orders o
  where o.restaurant_id = target_shift.restaurant_id
    and o.payment_method = 'Cash'
    and o.payment_verified_by = target_shift.opened_by
    and o.payment_verified_at >= target_shift.opened_at
    and o.payment_verified_at <= now();

  select
    count(*) filter (where o.payment_verified_at is null),
    count(*) filter (where o.status::text not in ('completed', 'cancelled'))
  into unpaid_orders, active_orders
  from public.orders o
  where o.restaurant_id = target_shift.restaurant_id
    and o.created_at >= target_shift.opened_at
    and o.created_at <= now();

  if unpaid_orders > 0 then
    raise exception 'Shift cannot close while % unpaid order(s) remain.', unpaid_orders;
  end if;

  if active_orders > 0 then
    raise exception 'Shift cannot close while % active order(s) remain.', active_orders;
  end if;

  expected_drawer := target_shift.opening_cash + cash_payments - cash_refunds;
  variance_amount := actual_cash_amount - expected_drawer;

  if variance_amount <> 0 and nullif(trim(variance_explanation), '') is null then
    raise exception 'Variance explanation is required when cash variance is non-zero.';
  end if;

  update public.cashier_shifts
  set
    closed_at = now(),
    closed_by = acting_staff.id,
    expected_cash = expected_drawer,
    actual_cash = actual_cash_amount,
    variance = variance_amount,
    variance_reason = nullif(trim(variance_explanation), '')
  where id = target_shift.id
  returning * into target_shift;

  insert into public.cash_reconciliations (
    restaurant_id,
    shift_id,
    closed_by,
    opening_cash,
    cash_payments,
    cash_refunds,
    expected_cash,
    actual_cash,
    variance,
    variance_reason,
    closed_at
  )
  values (
    target_shift.restaurant_id,
    target_shift.id,
    acting_staff.id,
    target_shift.opening_cash,
    cash_payments,
    cash_refunds,
    expected_drawer,
    actual_cash_amount,
    variance_amount,
    nullif(trim(variance_explanation), ''),
    target_shift.closed_at
  )
  returning * into reconciliation_row;

  insert into public.shift_activity_logs (restaurant_id, shift_id, actor_staff_id, action, message, amount, metadata)
  values (
    target_shift.restaurant_id,
    target_shift.id,
    acting_staff.id,
    'shift_closed',
    'Shift closed',
    actual_cash_amount,
    jsonb_build_object('expected_cash', expected_drawer, 'variance', variance_amount)
  );

  return jsonb_build_object('shift', to_jsonb(target_shift), 'reconciliation', to_jsonb(reconciliation_row));
end;
$$;

revoke all on function public.close_cashier_shift(uuid, numeric, text) from public, anon;
grant execute on function public.close_cashier_shift(uuid, numeric, text) to authenticated;

create or replace function public.get_owner_shift_visibility(
  target_restaurant_id uuid,
  range_start timestamptz default now() - interval '30 days',
  range_end timestamptz default now() + interval '1 day'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to view cashier shifts.';
  end if;

  if not public.has_shift_admin_role(target_restaurant_id) then
    raise exception 'Only restaurant owners and managers may view all cashier shifts.';
  end if;

  return jsonb_build_object(
    'active_shifts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', shifts.id,
        'opened_by', shifts.opened_by,
        'cashier_name', staff.display_name,
        'opened_at', shifts.opened_at,
        'opening_cash', shifts.opening_cash
      ) order by shifts.opened_at desc)
      from public.cashier_shifts shifts
      join public.restaurant_staff staff on staff.id = shifts.opened_by
      where shifts.restaurant_id = target_restaurant_id
        and shifts.closed_at is null
    ), '[]'::jsonb),
    'shift_history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', shifts.id,
        'cashier_name', staff.display_name,
        'opened_at', shifts.opened_at,
        'closed_at', shifts.closed_at,
        'opening_cash', shifts.opening_cash,
        'expected_cash', shifts.expected_cash,
        'actual_cash', shifts.actual_cash,
        'variance', shifts.variance,
        'variance_reason', shifts.variance_reason
      ) order by shifts.opened_at desc)
      from public.cashier_shifts shifts
      join public.restaurant_staff staff on staff.id = shifts.opened_by
      where shifts.restaurant_id = target_restaurant_id
        and shifts.opened_at >= range_start
        and shifts.opened_at < range_end
    ), '[]'::jsonb),
    'cash_variances', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', reconciliations.id,
        'shift_id', reconciliations.shift_id,
        'cashier_name', staff.display_name,
        'closed_at', reconciliations.closed_at,
        'expected_cash', reconciliations.expected_cash,
        'actual_cash', reconciliations.actual_cash,
        'variance', reconciliations.variance,
        'variance_reason', reconciliations.variance_reason
      ) order by reconciliations.closed_at desc)
      from public.cash_reconciliations reconciliations
      join public.cashier_shifts shifts on shifts.id = reconciliations.shift_id
      join public.restaurant_staff staff on staff.id = shifts.opened_by
      where reconciliations.restaurant_id = target_restaurant_id
        and reconciliations.closed_at >= range_start
        and reconciliations.closed_at < range_end
        and reconciliations.variance <> 0
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_owner_shift_visibility(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_owner_shift_visibility(uuid, timestamptz, timestamptz) to authenticated;

create or replace function public.log_shift_order_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_shift_id uuid;
  actor_staff_id uuid;
begin
  if tg_op = 'INSERT' then
    select cs.id, cs.opened_by
    into active_shift_id, actor_staff_id
    from public.cashier_shifts cs
    where cs.restaurant_id = new.restaurant_id
      and cs.closed_at is null
    order by cs.opened_at desc
    limit 1;

    insert into public.shift_activity_logs (restaurant_id, shift_id, order_id, actor_staff_id, action, message, amount, metadata)
    values (
      new.restaurant_id,
      active_shift_id,
      new.id,
      actor_staff_id,
      'order_created',
      'Order ' || left(new.id::text, 6) || ' created',
      new.total_price,
      jsonb_build_object('table_number', new.table_number, 'status', new.status::text)
    );
  elsif tg_op = 'UPDATE' then
    if old.payment_verified_at is null and new.payment_verified_at is not null then
      select cs.id
      into active_shift_id
      from public.cashier_shifts cs
      where cs.restaurant_id = new.restaurant_id
        and cs.opened_by = new.payment_verified_by
        and cs.closed_at is null
      order by cs.opened_at desc
      limit 1;

      insert into public.shift_activity_logs (restaurant_id, shift_id, order_id, actor_staff_id, action, message, amount, metadata)
      values (
        new.restaurant_id,
        active_shift_id,
        new.id,
        new.payment_verified_by,
        'payment_verified',
        'Table ' || coalesce(new.table_number, '-') || ' paid',
        new.total_price,
        jsonb_build_object('payment_method', new.payment_method, 'table_number', new.table_number)
      );
    end if;

    if old.status is distinct from new.status and new.status::text = 'completed' then
      select cs.id, cs.opened_by
      into active_shift_id, actor_staff_id
      from public.cashier_shifts cs
      where cs.restaurant_id = new.restaurant_id
        and cs.closed_at is null
      order by cs.opened_at desc
      limit 1;

      insert into public.shift_activity_logs (restaurant_id, shift_id, order_id, actor_staff_id, action, message, amount, metadata)
      values (
        new.restaurant_id,
        active_shift_id,
        new.id,
        actor_staff_id,
        'order_completed',
        'Order ' || left(new.id::text, 6) || ' completed',
        new.total_price,
        jsonb_build_object('table_number', new.table_number, 'status', new.status::text)
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists log_shift_order_activity on public.orders;
create trigger log_shift_order_activity
after insert or update of status, payment_verified_at, payment_verified_by
on public.orders
for each row
execute function public.log_shift_order_activity();

revoke all on function public.log_shift_order_activity() from public, anon, authenticated;
grant execute on function public.log_shift_order_activity() to service_role;

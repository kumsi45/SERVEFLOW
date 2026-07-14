-- ServeFlow Manager Dashboard M5: Customer Experience Management.
-- Manager supervision only. All data and actions are restaurant-scoped.

alter type public.staff_activity_action add value if not exists 'manager_waiter_assigned_to_customer';
alter type public.staff_activity_action add value if not exists 'manager_customer_kitchen_notified';
alter type public.staff_activity_action add value if not exists 'manager_customer_cashier_notified';
alter type public.staff_activity_action add value if not exists 'manager_customer_complaint_escalated';
alter type public.staff_activity_action add value if not exists 'manager_customer_complaint_resolved';

create table if not exists public.manager_customer_complaints (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  table_id uuid references public.restaurant_tables(id) on delete set null,
  table_number text,
  customer_name text,
  customer_phone text,
  category text not null default 'Service',
  description text not null,
  status text not null default 'open',
  severity text not null default 'medium',
  escalated_at timestamptz,
  resolved_at timestamptz,
  created_by_staff_id uuid references public.restaurant_staff(id) on delete set null,
  resolved_by_staff_id uuid references public.restaurant_staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manager_customer_complaints_status_check check (status in ('open', 'escalated', 'resolved')),
  constraint manager_customer_complaints_severity_check check (severity in ('low', 'medium', 'high')),
  constraint manager_customer_complaints_description_not_blank check (length(btrim(description)) > 0),
  constraint manager_customer_complaints_order_same_restaurant
    foreign key (restaurant_id, order_id)
    references public.orders (restaurant_id, id),
  constraint manager_customer_complaints_table_same_restaurant
    foreign key (restaurant_id, table_id)
    references public.restaurant_tables (restaurant_id, id)
);

create index if not exists manager_customer_complaints_restaurant_status_idx
on public.manager_customer_complaints (restaurant_id, status, created_at desc);

create index if not exists manager_customer_complaints_order_idx
on public.manager_customer_complaints (restaurant_id, order_id, created_at desc);

alter table public.manager_customer_complaints enable row level security;

grant select, insert, update on public.manager_customer_complaints to authenticated;

drop policy if exists manager_customer_complaints_select_manager_same_restaurant on public.manager_customer_complaints;
create policy manager_customer_complaints_select_manager_same_restaurant
on public.manager_customer_complaints
for select
to authenticated
using (
  public.has_staff_role(restaurant_id, array['owner','manager']::public.restaurant_staff_role[])
);

drop policy if exists manager_customer_complaints_insert_manager_same_restaurant on public.manager_customer_complaints;
create policy manager_customer_complaints_insert_manager_same_restaurant
on public.manager_customer_complaints
for insert
to authenticated
with check (
  public.has_staff_role(restaurant_id, array['manager']::public.restaurant_staff_role[])
);

drop policy if exists manager_customer_complaints_update_manager_same_restaurant on public.manager_customer_complaints;
create policy manager_customer_complaints_update_manager_same_restaurant
on public.manager_customer_complaints
for update
to authenticated
using (
  public.has_staff_role(restaurant_id, array['manager']::public.restaurant_staff_role[])
)
with check (
  public.has_staff_role(restaurant_id, array['manager']::public.restaurant_staff_role[])
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'manager_customer_complaints'
     ) then
    alter publication supabase_realtime add table public.manager_customer_complaints;
  end if;
end;
$$;

create or replace function public.set_manager_customer_complaints_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_manager_customer_complaints_updated_at_trigger on public.manager_customer_complaints;
create trigger set_manager_customer_complaints_updated_at_trigger
before update on public.manager_customer_complaints
for each row execute function public.set_manager_customer_complaints_updated_at();

create or replace function public.get_manager_staff_id(target_restaurant_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select staff.id
  from public.restaurant_staff staff
  where staff.restaurant_id = target_restaurant_id
    and staff.user_id = auth.uid()
    and staff.active = true
    and staff.role::text = 'manager'
  limit 1
$$;

create or replace function public.manager_assign_customer_waiter(target_restaurant_id uuid, target_order_id uuid, waiter_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_staff_id uuid;
  target_order public.orders;
begin
  manager_staff_id := public.get_manager_staff_id(target_restaurant_id);
  if manager_staff_id is null then raise exception 'Permission denied.'; end if;

  select * into target_order
  from public.orders
  where id = target_order_id
    and restaurant_id = target_restaurant_id
    and dining_session_status = 'open'
  for update;
  if target_order.id is null then raise exception 'Customer session not found.'; end if;

  if not exists (
    select 1 from public.restaurant_staff staff
    where staff.id = waiter_staff_id
      and staff.restaurant_id = target_restaurant_id
      and staff.role::text = 'waiter'
      and staff.active = true
  ) then
    raise exception 'Waiter not available for this restaurant.';
  end if;

  if target_order.table_id is null then
    raise exception 'This customer session is not attached to a table.';
  end if;

  update public.restaurant_table_waiter_assignments
  set active = false
  where restaurant_id = target_restaurant_id
    and table_id = target_order.table_id
    and active = true;

  insert into public.restaurant_table_waiter_assignments (restaurant_id, table_id, waiter_staff_id, assigned_by_staff_id, active)
  values (target_restaurant_id, target_order.table_id, waiter_staff_id, manager_staff_id, true)
  on conflict (restaurant_id, table_id, waiter_staff_id)
  do update set assigned_by_staff_id = excluded.assigned_by_staff_id, active = true, assigned_at = now();

  insert into public.staff_activity_log (restaurant_id, action, performed_by_staff_id, target_staff_id, details)
  values (
    target_restaurant_id,
    'manager_waiter_assigned_to_customer',
    manager_staff_id,
    waiter_staff_id,
    jsonb_build_object('order_id', target_order.id, 'table_id', target_order.table_id, 'table_number', target_order.table_number, 'timestamp', now())
  );
end;
$$;

create or replace function public.manager_notify_customer_kitchen(target_restaurant_id uuid, target_order_id uuid, message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_staff_id uuid;
  target_order public.orders;
  normalized_message text;
begin
  manager_staff_id := public.get_manager_staff_id(target_restaurant_id);
  if manager_staff_id is null then raise exception 'Permission denied.'; end if;

  normalized_message := nullif(left(btrim(coalesce(message, '')), 500), '');
  if normalized_message is null then raise exception 'Message is required.'; end if;

  select * into target_order from public.orders where id = target_order_id and restaurant_id = target_restaurant_id and dining_session_status = 'open';
  if target_order.id is null then raise exception 'Customer session not found.'; end if;

  insert into public.staff_activity_log (restaurant_id, action, performed_by_staff_id, details)
  values (
    target_restaurant_id,
    'manager_customer_kitchen_notified',
    manager_staff_id,
    jsonb_build_object('order_id', target_order.id, 'table_number', target_order.table_number, 'message', normalized_message, 'timestamp', now())
  );
end;
$$;

create or replace function public.manager_notify_customer_cashier(target_restaurant_id uuid, target_order_id uuid, message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_staff_id uuid;
  target_order public.orders;
  normalized_message text;
begin
  manager_staff_id := public.get_manager_staff_id(target_restaurant_id);
  if manager_staff_id is null then raise exception 'Permission denied.'; end if;

  normalized_message := nullif(left(btrim(coalesce(message, '')), 500), '');
  if normalized_message is null then raise exception 'Message is required.'; end if;

  select * into target_order from public.orders where id = target_order_id and restaurant_id = target_restaurant_id and dining_session_status = 'open';
  if target_order.id is null then raise exception 'Customer session not found.'; end if;

  insert into public.staff_activity_log (restaurant_id, action, performed_by_staff_id, details)
  values (
    target_restaurant_id,
    'manager_customer_cashier_notified',
    manager_staff_id,
    jsonb_build_object('order_id', target_order.id, 'table_number', target_order.table_number, 'message', normalized_message, 'timestamp', now())
  );
end;
$$;

create or replace function public.manager_escalate_customer_complaint(target_restaurant_id uuid, complaint_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_staff_id uuid;
  complaint public.manager_customer_complaints;
begin
  manager_staff_id := public.get_manager_staff_id(target_restaurant_id);
  if manager_staff_id is null then raise exception 'Permission denied.'; end if;

  select * into complaint
  from public.manager_customer_complaints
  where id = complaint_id
    and restaurant_id = target_restaurant_id
  for update;
  if complaint.id is null then raise exception 'Complaint not found.'; end if;
  if complaint.status = 'resolved' then raise exception 'Resolved complaints cannot be escalated.'; end if;

  update public.manager_customer_complaints
  set status = 'escalated',
      escalated_at = coalesce(escalated_at, now())
  where id = complaint.id
    and restaurant_id = target_restaurant_id;

  insert into public.staff_activity_log (restaurant_id, action, performed_by_staff_id, details)
  values (
    target_restaurant_id,
    'manager_customer_complaint_escalated',
    manager_staff_id,
    jsonb_build_object('complaint_id', complaint.id, 'order_id', complaint.order_id, 'table_number', complaint.table_number, 'timestamp', now())
  );
end;
$$;

create or replace function public.manager_resolve_customer_complaint(target_restaurant_id uuid, complaint_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_staff_id uuid;
  complaint public.manager_customer_complaints;
begin
  manager_staff_id := public.get_manager_staff_id(target_restaurant_id);
  if manager_staff_id is null then raise exception 'Permission denied.'; end if;

  select * into complaint
  from public.manager_customer_complaints
  where id = complaint_id
    and restaurant_id = target_restaurant_id
  for update;
  if complaint.id is null then raise exception 'Complaint not found.'; end if;

  update public.manager_customer_complaints
  set status = 'resolved',
      resolved_at = now(),
      resolved_by_staff_id = manager_staff_id
  where id = complaint.id
    and restaurant_id = target_restaurant_id;

  insert into public.staff_activity_log (restaurant_id, action, performed_by_staff_id, details)
  values (
    target_restaurant_id,
    'manager_customer_complaint_resolved',
    manager_staff_id,
    jsonb_build_object('complaint_id', complaint.id, 'order_id', complaint.order_id, 'table_number', complaint.table_number, 'timestamp', now())
  );
end;
$$;

revoke all on function public.manager_assign_customer_waiter(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.manager_notify_customer_kitchen(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.manager_notify_customer_cashier(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.manager_escalate_customer_complaint(uuid, uuid) from public, anon, authenticated;
revoke all on function public.manager_resolve_customer_complaint(uuid, uuid) from public, anon, authenticated;
grant execute on function public.manager_assign_customer_waiter(uuid, uuid, uuid) to authenticated;
grant execute on function public.manager_notify_customer_kitchen(uuid, uuid, text) to authenticated;
grant execute on function public.manager_notify_customer_cashier(uuid, uuid, text) to authenticated;
grant execute on function public.manager_escalate_customer_complaint(uuid, uuid) to authenticated;
grant execute on function public.manager_resolve_customer_complaint(uuid, uuid) to authenticated;

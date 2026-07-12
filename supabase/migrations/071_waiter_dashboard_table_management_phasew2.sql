-- ServeFlow Phase W2: waiter dashboard table management foundation.
-- Dashboard/read model only. No order creation, payment, kitchen, invoice,
-- customer, report, analytics, setup wizard, manager, or owner layout changes.

alter table public.restaurant_tables
  add column if not exists seats integer not null default 4;

alter table public.restaurant_tables
  drop constraint if exists restaurant_tables_seats_check;

alter table public.restaurant_tables
  add constraint restaurant_tables_seats_check
  check (seats >= 1 and seats <= 50);

create table if not exists public.restaurant_table_waiter_assignments (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id uuid not null references public.restaurant_tables(id) on delete cascade,
  waiter_staff_id uuid not null references public.restaurant_staff(id) on delete cascade,
  active boolean not null default true,
  assigned_at timestamptz not null default now(),
  assigned_by_staff_id uuid references public.restaurant_staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, table_id, waiter_staff_id)
);

create unique index if not exists restaurant_table_waiter_assignments_active_table_key
on public.restaurant_table_waiter_assignments (restaurant_id, table_id)
where active = true;

create index if not exists restaurant_table_waiter_assignments_waiter_idx
on public.restaurant_table_waiter_assignments (restaurant_id, waiter_staff_id)
where active = true;

drop trigger if exists restaurant_table_waiter_assignments_set_updated_at on public.restaurant_table_waiter_assignments;

create trigger restaurant_table_waiter_assignments_set_updated_at
before update on public.restaurant_table_waiter_assignments
for each row execute function public.set_updated_at();

alter table public.restaurant_table_waiter_assignments enable row level security;

grant select on public.restaurant_table_waiter_assignments to authenticated;
grant select, insert, update, delete on public.restaurant_table_waiter_assignments to service_role;

drop policy if exists restaurant_table_waiter_assignments_select_staff_same_restaurant on public.restaurant_table_waiter_assignments;
create policy restaurant_table_waiter_assignments_select_staff_same_restaurant
on public.restaurant_table_waiter_assignments
for select
to authenticated
using (
  public.has_staff_role(
    restaurant_id,
    array['owner', 'waiter']::public.restaurant_staff_role[]
  )
);

drop policy if exists restaurant_table_waiter_assignments_manage_owner_same_restaurant on public.restaurant_table_waiter_assignments;
create policy restaurant_table_waiter_assignments_manage_owner_same_restaurant
on public.restaurant_table_waiter_assignments
for all
to authenticated
using (public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[]))
with check (public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[]));

create or replace function public.get_waiter_dashboard_tables(target_restaurant_slug text)
returns table (
  restaurant_id uuid,
  restaurant_slug text,
  restaurant_name text,
  restaurant_logo_url text,
  waiter_staff_id uuid,
  waiter_display_name text,
  current_shift text,
  assignment_mode text,
  table_id uuid,
  table_number integer,
  table_label text,
  seats integer,
  table_active boolean,
  assigned_waiter_staff_id uuid,
  assigned_waiter_name text,
  table_status text,
  active_order_id uuid,
  active_order_status text,
  active_order_source text,
  qr_customer_name text,
  active_order_created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant public.restaurants;
  current_waiter public.restaurant_staff;
  has_assignments boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to view waiter tables.';
  end if;

  select *
  into target_restaurant
  from public.restaurants restaurants
  where restaurants.slug = target_restaurant_slug
    and restaurants.active = true
  limit 1;

  if target_restaurant.id is null then
    raise exception 'Restaurant not found.';
  end if;

  select *
  into current_waiter
  from public.restaurant_staff staff
  where staff.restaurant_id = target_restaurant.id
    and staff.user_id = auth.uid()
    and staff.role::text = 'waiter'
    and staff.active = true
  limit 1;

  if current_waiter.id is null then
    raise exception 'Active waiter membership not found for this restaurant.';
  end if;

  select exists (
    select 1
    from public.restaurant_table_waiter_assignments assignments
    where assignments.restaurant_id = target_restaurant.id
      and assignments.waiter_staff_id = current_waiter.id
      and assignments.active = true
  )
  into has_assignments;

  return query
  with visible_tables as (
    select
      tables.*,
      assignments.waiter_staff_id as assigned_staff_id,
      assigned_staff.display_name as assigned_staff_name
    from public.restaurant_tables tables
    left join public.restaurant_table_waiter_assignments assignments
      on assignments.restaurant_id = tables.restaurant_id
     and assignments.table_id = tables.id
     and assignments.active = true
    left join public.restaurant_staff assigned_staff
      on assigned_staff.restaurant_id = assignments.restaurant_id
     and assigned_staff.id = assignments.waiter_staff_id
     and assigned_staff.active = true
    where tables.restaurant_id = target_restaurant.id
      and tables.active = true
      and (
        has_assignments = false
        or assignments.waiter_staff_id = current_waiter.id
      )
  ),
  active_orders as (
    select distinct on (orders.table_number)
      orders.id,
      orders.status::text as status,
      orders.order_source,
      orders.customer_name,
      orders.table_number,
      orders.created_at
    from public.orders orders
    where orders.restaurant_id = target_restaurant.id
      and orders.table_number is not null
      and (
        orders.status::text in ('pending', 'pending_payment', 'paid', 'preparing', 'ready')
        or public.is_public_qr_dining_session_open(orders.id)
      )
    order by orders.table_number, orders.created_at desc
  )
  select
    target_restaurant.id,
    target_restaurant.slug,
    target_restaurant.name,
    nullif(coalesce(target_restaurant.branding->>'logo_url', ''), ''),
    current_waiter.id,
    current_waiter.display_name,
    coalesce(nullif(target_restaurant.business_hours->>'current_shift', ''), 'Current Shift'),
    case when has_assignments then 'assigned_tables' else 'all_tables' end,
    visible_tables.id,
    visible_tables.table_number,
    visible_tables.label,
    visible_tables.seats,
    visible_tables.active,
    visible_tables.assigned_staff_id,
    visible_tables.assigned_staff_name,
    case
      when active_orders.id is null then 'available'
      when active_orders.order_source = 'public_qr' then 'qr_ordering'
      else 'occupied'
    end,
    active_orders.id,
    active_orders.status,
    active_orders.order_source,
    case when active_orders.order_source = 'public_qr' then active_orders.customer_name else null end,
    active_orders.created_at
  from visible_tables
  left join active_orders
    on active_orders.table_number = visible_tables.table_number::text
  order by visible_tables.table_number;
end;
$$;

revoke all on function public.get_waiter_dashboard_tables(text) from public, anon, authenticated;
grant execute on function public.get_waiter_dashboard_tables(text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.restaurant_table_waiter_assignments;
    exception
      when duplicate_object then null;
    end;
  end if;
end;
$$;

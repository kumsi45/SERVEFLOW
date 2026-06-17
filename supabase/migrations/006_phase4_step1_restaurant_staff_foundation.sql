-- SERVEFLOW Phase 4 Step 1 restaurant staff foundation.
-- Generated only. Do not apply automatically.
-- This phase creates staff architecture only; no dashboards, realtime, or UI.

alter type public.user_role
  add value if not exists 'owner';

alter type public.user_role
  add value if not exists 'cashier';

alter type public.order_status
  add value if not exists 'pending_payment';

alter type public.order_status
  add value if not exists 'paid';

alter type public.order_status
  add value if not exists 'cancelled';

do $$
begin
  create type public.restaurant_staff_role as enum (
    'owner',
    'cashier',
    'kitchen'
  );
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.restaurant_staff (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.restaurant_staff_role not null,
  display_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, user_id),
  constraint restaurant_staff_display_name_required
    check (length(trim(display_name)) > 0),
  constraint restaurant_staff_user_same_restaurant
    foreign key (restaurant_id, user_id)
    references public.users (restaurant_id, id)
    on delete cascade
);

create unique index if not exists restaurant_staff_one_active_owner_per_restaurant
on public.restaurant_staff (restaurant_id)
where role = 'owner' and active = true;

create index if not exists restaurant_staff_restaurant_id_idx
on public.restaurant_staff (restaurant_id);

create index if not exists restaurant_staff_user_id_idx
on public.restaurant_staff (user_id);

create index if not exists restaurant_staff_active_role_idx
on public.restaurant_staff (restaurant_id, role, active);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists restaurant_staff_set_updated_at on public.restaurant_staff;

create trigger restaurant_staff_set_updated_at
before update on public.restaurant_staff
for each row
execute function public.set_updated_at();

alter table public.orders
  add column if not exists payment_verified_by uuid,
  add column if not exists payment_verified_at timestamptz,
  add column if not exists completed_by uuid,
  add column if not exists completed_at timestamptz;

alter table public.orders
  drop constraint if exists orders_payment_verified_by_same_restaurant,
  add constraint orders_payment_verified_by_same_restaurant
    foreign key (restaurant_id, payment_verified_by)
    references public.restaurant_staff (restaurant_id, id);

alter table public.orders
  drop constraint if exists orders_completed_by_same_restaurant,
  add constraint orders_completed_by_same_restaurant
    foreign key (restaurant_id, completed_by)
    references public.restaurant_staff (restaurant_id, id);

alter table public.orders
  drop constraint if exists orders_payment_verification_audit_complete,
  add constraint orders_payment_verification_audit_complete
    check (
      (payment_verified_by is null and payment_verified_at is null)
      or (payment_verified_by is not null and payment_verified_at is not null)
    );

alter table public.orders
  drop constraint if exists orders_completion_audit_complete,
  add constraint orders_completion_audit_complete
    check (
      (completed_by is null and completed_at is null)
      or (completed_by is not null and completed_at is not null)
    );

create index if not exists orders_payment_verified_by_idx
on public.orders (payment_verified_by);

create index if not exists orders_completed_by_idx
on public.orders (completed_by);

create or replace function public.current_restaurant_staff_role()
returns public.restaurant_staff_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.restaurant_staff
  where user_id = auth.uid()
    and restaurant_id = public.current_user_restaurant_id()
    and active = true
  limit 1
$$;

create or replace function public.has_staff_role(allowed_roles public.restaurant_staff_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_restaurant_staff_role() = any(allowed_roles)
$$;

create or replace function public.is_active_restaurant_staff_member(target_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.restaurant_staff
    where user_id = auth.uid()
      and restaurant_id = target_restaurant_id
      and active = true
  )
$$;

grant execute on function public.current_restaurant_staff_role() to authenticated;
grant execute on function public.has_staff_role(public.restaurant_staff_role[]) to authenticated;
grant execute on function public.is_active_restaurant_staff_member(uuid) to authenticated;

alter table public.restaurant_staff enable row level security;

grant select, insert, update on public.restaurant_staff to authenticated;

drop policy if exists restaurant_staff_select_self_or_owner_same_restaurant on public.restaurant_staff;

create policy restaurant_staff_select_self_or_owner_same_restaurant
on public.restaurant_staff
for select
to authenticated
using (
  user_id = auth.uid()
  or (
    restaurant_id = public.current_user_restaurant_id()
    and public.has_staff_role(array['owner']::public.restaurant_staff_role[])
  )
);

drop policy if exists restaurant_staff_insert_owner_same_restaurant on public.restaurant_staff;

create policy restaurant_staff_insert_owner_same_restaurant
on public.restaurant_staff
for insert
to authenticated
with check (
  restaurant_id = public.current_user_restaurant_id()
  and public.has_staff_role(array['owner']::public.restaurant_staff_role[])
);

drop policy if exists restaurant_staff_update_owner_same_restaurant on public.restaurant_staff;

create policy restaurant_staff_update_owner_same_restaurant
on public.restaurant_staff
for update
to authenticated
using (
  restaurant_id = public.current_user_restaurant_id()
  and public.has_staff_role(array['owner']::public.restaurant_staff_role[])
)
with check (
  restaurant_id = public.current_user_restaurant_id()
  and public.has_staff_role(array['owner']::public.restaurant_staff_role[])
);

drop policy if exists orders_select_by_role_same_restaurant on public.orders;

create policy orders_select_by_role_same_restaurant
on public.orders
for select
to authenticated
using (
  public.is_restaurant_member(restaurant_id)
  and (
    public.has_any_role(array['admin', 'kitchen']::public.user_role[])
    or customer_user_id = auth.uid()
    or public.has_staff_role(array['owner']::public.restaurant_staff_role[])
    or (
      public.has_staff_role(array['cashier']::public.restaurant_staff_role[])
      and status::text in (
        'pending_payment',
        'paid',
        'ready',
        'completed',
        'cancelled'
      )
    )
    or (
      public.has_staff_role(array['kitchen']::public.restaurant_staff_role[])
      and status::text in (
        'paid',
        'preparing',
        'ready'
      )
    )
  )
);

drop policy if exists order_items_select_by_order_visibility on public.order_items;

create policy order_items_select_by_order_visibility
on public.order_items
for select
to authenticated
using (
  public.is_restaurant_member(restaurant_id)
  and exists (
    select 1
    from public.orders
    where orders.id = order_items.order_id
      and orders.restaurant_id = order_items.restaurant_id
      and (
        public.has_any_role(array['admin', 'kitchen']::public.user_role[])
        or orders.customer_user_id = auth.uid()
        or public.has_staff_role(array['owner']::public.restaurant_staff_role[])
        or (
          public.has_staff_role(array['cashier']::public.restaurant_staff_role[])
          and orders.status::text in (
            'pending_payment',
            'paid',
            'ready',
            'completed',
            'cancelled'
          )
        )
        or (
          public.has_staff_role(array['kitchen']::public.restaurant_staff_role[])
          and orders.status::text in (
            'paid',
            'preparing',
            'ready'
          )
        )
      )
  )
);

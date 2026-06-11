-- SERVEFLOW Phase 1 SaaS backbone.
-- Backend foundation only: schema, tenant isolation, roles, and RLS.

create extension if not exists "pgcrypto";

create type public.user_role as enum (
  'customer',
  'admin',
  'kitchen',
  'super_admin'
);

create type public.order_status as enum (
  'pending',
  'preparing',
  'ready',
  'completed'
);

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  restaurant_id uuid references public.restaurants(id) on delete restrict,
  role public.user_role not null default 'customer',
  created_at timestamptz not null default now(),
  unique (restaurant_id, id),
  constraint users_restaurant_required_for_tenant_roles
    check (role = 'super_admin' or restaurant_id is not null)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, name)
);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  name text not null,
  price numeric(12, 2) not null check (price >= 0),
  image_url text,
  available boolean not null default true,
  created_at timestamptz not null default now(),
  unique (restaurant_id, id),
  constraint menu_items_category_same_restaurant
    foreign key (restaurant_id, category_id)
    references public.categories (restaurant_id, id)
    on delete restrict
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references public.users(id) on delete restrict,
  status public.order_status not null default 'pending',
  total_price numeric(12, 2) not null default 0 check (total_price >= 0),
  created_at timestamptz not null default now(),
  unique (restaurant_id, id),
  constraint orders_customer_same_restaurant
    foreign key (restaurant_id, customer_user_id)
    references public.users (restaurant_id, id)
    on delete restrict
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  price numeric(12, 2) not null check (price >= 0),
  created_at timestamptz not null default now(),
  constraint order_items_order_same_restaurant
    foreign key (restaurant_id, order_id)
    references public.orders (restaurant_id, id)
    on delete cascade,
  constraint order_items_menu_item_same_restaurant
    foreign key (restaurant_id, menu_item_id)
    references public.menu_items (restaurant_id, id)
    on delete restrict
);

create index categories_restaurant_id_idx on public.categories (restaurant_id);
create index menu_items_restaurant_id_idx on public.menu_items (restaurant_id);
create index orders_restaurant_id_idx on public.orders (restaurant_id);
create index orders_customer_user_id_idx on public.orders (customer_user_id);
create index order_items_restaurant_id_idx on public.order_items (restaurant_id);
create index order_items_order_id_idx on public.order_items (order_id);

create or replace function public.current_user_restaurant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select restaurant_id
  from public.users
  where id = auth.uid()
$$;

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.users
  where id = auth.uid()
$$;

create or replace function public.is_restaurant_member(target_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_restaurant_id = public.current_user_restaurant_id()
$$;

create or replace function public.has_any_role(allowed_roles public.user_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = any(allowed_roles)
$$;

create or replace function public.update_order_status(
  target_order_id uuid,
  next_status public.order_status
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_order public.orders;
begin
  if not public.has_any_role(array['admin', 'kitchen']::public.user_role[]) then
    raise exception 'Only restaurant admins and kitchen staff may update order status.';
  end if;

  update public.orders
  set status = next_status
  where id = target_order_id
    and restaurant_id = public.current_user_restaurant_id()
  returning * into updated_order;

  if updated_order.id is null then
    raise exception 'Order not found for current restaurant.';
  end if;

  return updated_order;
end;
$$;

grant execute on function public.update_order_status(uuid, public.order_status) to authenticated;

alter table public.restaurants enable row level security;
alter table public.users enable row level security;
alter table public.categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

create policy restaurants_select_own
on public.restaurants
for select
to authenticated
using (id = public.current_user_restaurant_id());

create policy restaurants_update_admin_own
on public.restaurants
for update
to authenticated
using (
  id = public.current_user_restaurant_id()
  and public.has_any_role(array['admin']::public.user_role[])
)
with check (
  id = public.current_user_restaurant_id()
  and public.has_any_role(array['admin']::public.user_role[])
);

create policy users_select_self
on public.users
for select
to authenticated
using (id = auth.uid());

create policy users_select_admin_same_restaurant
on public.users
for select
to authenticated
using (
  restaurant_id = public.current_user_restaurant_id()
  and public.has_any_role(array['admin']::public.user_role[])
);

create policy users_update_admin_same_restaurant
on public.users
for update
to authenticated
using (
  restaurant_id = public.current_user_restaurant_id()
  and role <> 'super_admin'
  and public.has_any_role(array['admin']::public.user_role[])
)
with check (
  restaurant_id = public.current_user_restaurant_id()
  and role <> 'super_admin'
  and public.has_any_role(array['admin']::public.user_role[])
);

create policy categories_select_same_restaurant
on public.categories
for select
to authenticated
using (public.is_restaurant_member(restaurant_id));

create policy categories_manage_admin_same_restaurant
on public.categories
for all
to authenticated
using (
  public.is_restaurant_member(restaurant_id)
  and public.has_any_role(array['admin']::public.user_role[])
)
with check (
  public.is_restaurant_member(restaurant_id)
  and public.has_any_role(array['admin']::public.user_role[])
);

create policy menu_items_select_same_restaurant
on public.menu_items
for select
to authenticated
using (public.is_restaurant_member(restaurant_id));

create policy menu_items_manage_admin_same_restaurant
on public.menu_items
for all
to authenticated
using (
  public.is_restaurant_member(restaurant_id)
  and public.has_any_role(array['admin']::public.user_role[])
)
with check (
  public.is_restaurant_member(restaurant_id)
  and public.has_any_role(array['admin']::public.user_role[])
);

create policy orders_select_by_role_same_restaurant
on public.orders
for select
to authenticated
using (
  public.is_restaurant_member(restaurant_id)
  and (
    public.has_any_role(array['admin', 'kitchen']::public.user_role[])
    or customer_user_id = auth.uid()
  )
);

create policy orders_insert_customer_same_restaurant
on public.orders
for insert
to authenticated
with check (
  public.is_restaurant_member(restaurant_id)
  and public.has_any_role(array['customer']::public.user_role[])
  and customer_user_id = auth.uid()
  and status = 'pending'
);

create policy orders_update_admin_same_restaurant
on public.orders
for update
to authenticated
using (
  public.is_restaurant_member(restaurant_id)
  and public.has_any_role(array['admin']::public.user_role[])
)
with check (
  public.is_restaurant_member(restaurant_id)
  and public.has_any_role(array['admin']::public.user_role[])
);

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
      )
  )
);

create policy order_items_insert_customer_same_restaurant
on public.order_items
for insert
to authenticated
with check (
  public.is_restaurant_member(restaurant_id)
  and public.has_any_role(array['customer']::public.user_role[])
  and exists (
    select 1
    from public.orders
    where orders.id = order_items.order_id
      and orders.restaurant_id = order_items.restaurant_id
      and orders.customer_user_id = auth.uid()
      and orders.status = 'pending'
  )
);

create policy order_items_manage_admin_same_restaurant
on public.order_items
for update
to authenticated
using (
  public.is_restaurant_member(restaurant_id)
  and public.has_any_role(array['admin']::public.user_role[])
)
with check (
  public.is_restaurant_member(restaurant_id)
  and public.has_any_role(array['admin']::public.user_role[])
);

-- SERVEFLOW Phase 4 Step 3 kitchen dashboard foundation.
-- Adds kitchen preparation audit fields and narrow RPCs for kitchen status transitions.

alter table public.orders
  add column if not exists preparation_started_by uuid,
  add column if not exists preparation_started_at timestamptz,
  add column if not exists ready_marked_by uuid,
  add column if not exists ready_marked_at timestamptz;

alter table public.orders
  drop constraint if exists orders_preparation_started_by_same_restaurant,
  add constraint orders_preparation_started_by_same_restaurant
    foreign key (restaurant_id, preparation_started_by)
    references public.restaurant_staff (restaurant_id, id);

alter table public.orders
  drop constraint if exists orders_ready_marked_by_same_restaurant,
  add constraint orders_ready_marked_by_same_restaurant
    foreign key (restaurant_id, ready_marked_by)
    references public.restaurant_staff (restaurant_id, id);

alter table public.orders
  drop constraint if exists orders_preparation_started_audit_complete,
  add constraint orders_preparation_started_audit_complete
    check (
      (preparation_started_by is null and preparation_started_at is null)
      or (preparation_started_by is not null and preparation_started_at is not null)
    );

alter table public.orders
  drop constraint if exists orders_ready_marked_audit_complete,
  add constraint orders_ready_marked_audit_complete
    check (
      (ready_marked_by is null and ready_marked_at is null)
      or (ready_marked_by is not null and ready_marked_at is not null)
    );

create index if not exists orders_preparation_started_by_idx
on public.orders (preparation_started_by);

create index if not exists orders_ready_marked_by_idx
on public.orders (ready_marked_by);

create index if not exists orders_restaurant_status_created_at_idx
on public.orders (restaurant_id, status, created_at);

create or replace function public.start_order_preparation(target_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  target_order public.orders;
  updated_order public.orders;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to start order preparation.';
  end if;

  select *
  into target_order
  from public.orders
  where id = target_order_id;

  if target_order.id is null then
    raise exception 'Order not found.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = auth.uid()
    and restaurant_id = target_order.restaurant_id
    and active = true
    and role in ('kitchen', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active kitchen staff and owners may start order preparation.';
  end if;

  if target_order.status::text <> 'paid' then
    raise exception 'Only paid orders may be started by kitchen.';
  end if;

  update public.orders
  set
    status = 'preparing',
    preparation_started_at = now(),
    preparation_started_by = acting_staff.id
  where id = target_order.id
    and restaurant_id = target_order.restaurant_id
    and status::text = 'paid'
  returning * into updated_order;

  if updated_order.id is null then
    raise exception 'Order preparation could not be started.';
  end if;

  return updated_order;
end;
$$;

create or replace function public.mark_order_ready(target_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  target_order public.orders;
  updated_order public.orders;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to mark an order ready.';
  end if;

  select *
  into target_order
  from public.orders
  where id = target_order_id;

  if target_order.id is null then
    raise exception 'Order not found.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = auth.uid()
    and restaurant_id = target_order.restaurant_id
    and active = true
    and role in ('kitchen', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active kitchen staff and owners may mark orders ready.';
  end if;

  if target_order.status::text <> 'preparing' then
    raise exception 'Only preparing orders may be marked ready.';
  end if;

  update public.orders
  set
    status = 'ready',
    ready_marked_at = now(),
    ready_marked_by = acting_staff.id
  where id = target_order.id
    and restaurant_id = target_order.restaurant_id
    and status::text = 'preparing'
  returning * into updated_order;

  if updated_order.id is null then
    raise exception 'Order could not be marked ready.';
  end if;

  return updated_order;
end;
$$;

revoke all on function public.start_order_preparation(uuid) from public;
revoke all on function public.mark_order_ready(uuid) from public;

grant execute on function public.start_order_preparation(uuid) to authenticated;
grant execute on function public.mark_order_ready(uuid) to authenticated;

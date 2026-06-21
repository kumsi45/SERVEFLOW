-- SERVEFLOW Phase 4 staff URL-authoritative RLS correction.
-- Makes restaurant_staff the source of staff restaurant membership for multi-restaurant users.

alter table public.restaurant_staff
  drop constraint if exists restaurant_staff_user_same_restaurant;

create or replace function public.current_restaurant_staff_role(target_restaurant_id uuid)
returns public.restaurant_staff_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.restaurant_staff
  where user_id = auth.uid()
    and restaurant_id = target_restaurant_id
    and active = true
  limit 1
$$;

create or replace function public.has_staff_role(
  target_restaurant_id uuid,
  allowed_roles public.restaurant_staff_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_restaurant_staff_role(target_restaurant_id) = any(allowed_roles)
$$;

grant execute on function public.current_restaurant_staff_role(uuid) to authenticated;
grant execute on function public.has_staff_role(uuid, public.restaurant_staff_role[]) to authenticated;

drop policy if exists restaurant_staff_select_self_or_owner_same_restaurant on public.restaurant_staff;

create policy restaurant_staff_select_self_or_owner_same_restaurant
on public.restaurant_staff
for select
to authenticated
using (
  user_id = auth.uid()
  or public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])
);

drop policy if exists restaurant_staff_insert_owner_same_restaurant on public.restaurant_staff;

create policy restaurant_staff_insert_owner_same_restaurant
on public.restaurant_staff
for insert
to authenticated
with check (
  public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])
);

drop policy if exists restaurant_staff_update_owner_same_restaurant on public.restaurant_staff;

create policy restaurant_staff_update_owner_same_restaurant
on public.restaurant_staff
for update
to authenticated
using (
  public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])
)
with check (
  public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])
);

drop policy if exists orders_select_by_role_same_restaurant on public.orders;

create policy orders_select_by_role_same_restaurant
on public.orders
for select
to authenticated
using (
  (
    public.has_any_role(array['admin', 'kitchen']::public.user_role[])
    and public.is_restaurant_member(restaurant_id)
  )
  or customer_user_id = auth.uid()
  or public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])
  or (
    public.has_staff_role(restaurant_id, array['cashier']::public.restaurant_staff_role[])
    and status::text in (
      'pending_payment',
      'paid',
      'ready',
      'completed',
      'cancelled'
    )
  )
  or (
    public.has_staff_role(restaurant_id, array['kitchen']::public.restaurant_staff_role[])
    and status::text in (
      'paid',
      'preparing',
      'ready'
    )
  )
);

drop policy if exists order_items_select_by_order_visibility on public.order_items;

create policy order_items_select_by_order_visibility
on public.order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.orders
    where orders.id = order_items.order_id
      and orders.restaurant_id = order_items.restaurant_id
      and (
        (
          public.has_any_role(array['admin', 'kitchen']::public.user_role[])
          and public.is_restaurant_member(order_items.restaurant_id)
        )
        or orders.customer_user_id = auth.uid()
        or public.has_staff_role(order_items.restaurant_id, array['owner']::public.restaurant_staff_role[])
        or (
          public.has_staff_role(order_items.restaurant_id, array['cashier']::public.restaurant_staff_role[])
          and orders.status::text in (
            'pending_payment',
            'paid',
            'ready',
            'completed',
            'cancelled'
          )
        )
        or (
          public.has_staff_role(order_items.restaurant_id, array['kitchen']::public.restaurant_staff_role[])
          and orders.status::text in (
            'paid',
            'preparing',
            'ready'
          )
        )
      )
  )
);

drop function if exists public.has_staff_role(public.restaurant_staff_role[]);
drop function if exists public.current_restaurant_staff_role();

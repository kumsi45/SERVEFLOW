-- SERVEFLOW Phase 1 security corrections.
-- Apply this after 001 if the initial Phase 1 migration was already deployed.
-- It is safe to keep alongside the corrected 001 migration for audit clarity.

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

drop policy if exists users_select_same_restaurant_or_self on public.users;
drop policy if exists users_select_self on public.users;
drop policy if exists users_select_admin_same_restaurant on public.users;
drop policy if exists users_update_admin_same_restaurant on public.users;

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

drop policy if exists orders_insert_customer_same_restaurant on public.orders;
drop policy if exists orders_update_staff_same_restaurant on public.orders;
drop policy if exists orders_update_admin_same_restaurant on public.orders;

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

drop policy if exists order_items_insert_customer_same_restaurant on public.order_items;

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

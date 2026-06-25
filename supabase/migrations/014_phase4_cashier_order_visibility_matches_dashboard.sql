-- SERVEFLOW Phase 4 cashier visibility tightening.
-- The cashier dashboard currently supports only pending-payment review and
-- paid-order confirmation. Keep kitchen visibility separate except for the
-- required paid handoff state.

drop policy if exists orders_select_by_role_same_restaurant on public.orders;

create policy orders_select_by_role_same_restaurant
on public.orders
for select
to authenticated
using (
  customer_user_id = auth.uid()
  or public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])
  or (
    public.has_staff_role(restaurant_id, array['cashier']::public.restaurant_staff_role[])
    and status::text in (
      'pending_payment',
      'paid'
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
        orders.customer_user_id = auth.uid()
        or public.has_staff_role(order_items.restaurant_id, array['owner']::public.restaurant_staff_role[])
        or (
          public.has_staff_role(order_items.restaurant_id, array['cashier']::public.restaurant_staff_role[])
          and orders.status::text in (
            'pending_payment',
            'paid'
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

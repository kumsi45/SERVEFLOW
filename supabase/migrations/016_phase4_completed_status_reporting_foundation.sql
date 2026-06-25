-- SERVEFLOW Phase 4 stabilization: completed status and daily reporting foundation.
-- Generated only. Do not apply automatically.

alter table public.orders
  add column if not exists completed_by uuid,
  add column if not exists completed_at timestamptz;

alter table public.orders
  drop constraint if exists orders_completed_by_same_restaurant,
  add constraint orders_completed_by_same_restaurant
    foreign key (restaurant_id, completed_by)
    references public.restaurant_staff (restaurant_id, id);

alter table public.orders
  drop constraint if exists orders_completed_audit_complete,
  add constraint orders_completed_audit_complete
    check (
      (completed_by is null and completed_at is null)
      or (completed_by is not null and completed_at is not null)
    );

create index if not exists orders_restaurant_payment_verified_at_idx
on public.orders (restaurant_id, payment_verified_at);

create index if not exists orders_restaurant_completed_at_idx
on public.orders (restaurant_id, completed_at);

drop function if exists public.mark_order_completed(uuid);

create or replace function public.mark_order_completed(target_order_id uuid)
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
    raise exception 'Authentication is required to complete an order.';
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
    and role in ('kitchen', 'cashier', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active restaurant staff may complete orders.';
  end if;

  if target_order.status::text <> 'ready' then
    raise exception 'Only ready orders may be completed.';
  end if;

  update public.orders
  set
    status = 'completed',
    completed_at = now(),
    completed_by = acting_staff.id
  where id = target_order.id
    and restaurant_id = target_order.restaurant_id
    and status::text = 'ready'
  returning * into updated_order;

  if updated_order.id is null then
    raise exception 'Order could not be completed.';
  end if;

  return updated_order;
end;
$$;

revoke all on function public.mark_order_completed(uuid) from public;
grant execute on function public.mark_order_completed(uuid) to authenticated;

create or replace function public.get_daily_order_report(
  target_restaurant_id uuid,
  report_date date default current_date
)
returns table (
  revenue_today numeric,
  orders_today bigint,
  completed_orders_today bigint,
  average_order_value numeric,
  cash_collected_today numeric,
  digital_payments_today numeric,
  preparing_orders bigint,
  ready_orders bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  day_start timestamptz;
  day_end timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to view reports.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = auth.uid()
    and restaurant_id = target_restaurant_id
    and active = true
    and role in ('cashier', 'kitchen', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active restaurant staff may view reports.';
  end if;

  day_start := report_date::timestamptz;
  day_end := day_start + interval '1 day';

  return query
  select
    coalesce(sum(o.total_price) filter (
      where o.payment_verified_at >= day_start and o.payment_verified_at < day_end
    ), 0)::numeric as revenue_today,
    count(*) filter (
      where o.created_at >= day_start and o.created_at < day_end
    ) as orders_today,
    count(*) filter (
      where o.completed_at >= day_start and o.completed_at < day_end
    ) as completed_orders_today,
    coalesce(avg(o.total_price) filter (
      where o.payment_verified_at >= day_start and o.payment_verified_at < day_end
    ), 0)::numeric as average_order_value,
    coalesce(sum(o.total_price) filter (
      where o.payment_verified_at >= day_start
        and o.payment_verified_at < day_end
        and o.payment_method = 'Cash'
    ), 0)::numeric as cash_collected_today,
    coalesce(sum(o.total_price) filter (
      where o.payment_verified_at >= day_start
        and o.payment_verified_at < day_end
        and o.payment_method <> 'Cash'
    ), 0)::numeric as digital_payments_today,
    count(*) filter (where o.status::text = 'preparing') as preparing_orders,
    count(*) filter (where o.status::text = 'ready') as ready_orders
  from public.orders o
  where o.restaurant_id = target_restaurant_id;
end;
$$;

revoke all on function public.get_daily_order_report(uuid, date) from public;
grant execute on function public.get_daily_order_report(uuid, date) to authenticated;

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
      'paid',
      'preparing',
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
        orders.customer_user_id = auth.uid()
        or public.has_staff_role(order_items.restaurant_id, array['owner']::public.restaurant_staff_role[])
        or (
          public.has_staff_role(order_items.restaurant_id, array['cashier']::public.restaurant_staff_role[])
          and orders.status::text in (
            'pending_payment',
            'paid',
            'preparing',
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

-- SERVEFLOW Phase 4 RLS + multi-tenant isolation audit hardening.
-- Applies tenant invariants at the database boundary after the staff system
-- introduced restaurant_staff as the authoritative multi-restaurant membership
-- source for staff dashboards and staff management.

alter table public.restaurants enable row level security;
alter table public.restaurant_staff enable row level security;
alter table public.staff_activity_log enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- staff_activity_log already stores restaurant_id, but the original staff
-- references were single-column FKs. Enforce that referenced staff rows belong
-- to the same tenant as the activity row.
update public.staff_activity_log activity
set performed_by_staff_id = null
where performed_by_staff_id is not null
  and not exists (
    select 1
    from public.restaurant_staff staff
    where staff.id = activity.performed_by_staff_id
      and staff.restaurant_id = activity.restaurant_id
  );

update public.staff_activity_log activity
set target_staff_id = null
where target_staff_id is not null
  and not exists (
    select 1
    from public.restaurant_staff staff
    where staff.id = activity.target_staff_id
      and staff.restaurant_id = activity.restaurant_id
  );

alter table public.staff_activity_log
  drop constraint if exists staff_activity_log_performed_by_staff_id_fkey,
  drop constraint if exists staff_activity_log_target_staff_id_fkey,
  drop constraint if exists staff_activity_log_performed_by_same_restaurant,
  drop constraint if exists staff_activity_log_target_staff_same_restaurant,
  add constraint staff_activity_log_performed_by_same_restaurant
    foreign key (restaurant_id, performed_by_staff_id)
    references public.restaurant_staff (restaurant_id, id)
    on delete set null (performed_by_staff_id),
  add constraint staff_activity_log_target_staff_same_restaurant
    foreign key (restaurant_id, target_staff_id)
    references public.restaurant_staff (restaurant_id, id)
    on delete set null (target_staff_id);

-- Re-assert final policies for the audited tables. These policies keep tenant
-- visibility tied to either public.users.restaurant_id for legacy/customer
-- flows or restaurant_staff membership for staff multi-tenant flows.
drop policy if exists restaurants_select_own on public.restaurants;
drop policy if exists restaurants_select_own_or_active_staff on public.restaurants;

create policy restaurants_select_own_or_active_staff
on public.restaurants
for select
to authenticated
using (
  id = public.current_user_restaurant_id()
  or public.is_active_restaurant_staff_member(id)
);

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

drop policy if exists staff_activity_log_select_owner_same_restaurant on public.staff_activity_log;

create policy staff_activity_log_select_owner_same_restaurant
on public.staff_activity_log
for select
to authenticated
using (
  public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])
);

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

-- Optional payments table hardening for deployments that add it outside this
-- repo's current migrations. The current repo stores payment state on orders.
do $$
begin
  if to_regclass('public.payments') is not null then
    execute 'alter table public.payments enable row level security';

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'payments'
        and column_name = 'restaurant_id'
    ) then
      execute 'drop policy if exists payments_select_same_restaurant_or_staff on public.payments';
      execute $policy$
        create policy payments_select_same_restaurant_or_staff
        on public.payments
        for select
        to authenticated
        using (
          public.is_restaurant_member(restaurant_id)
          or public.is_active_restaurant_staff_member(restaurant_id)
        )
      $policy$;
    end if;
  end if;
end;
$$;

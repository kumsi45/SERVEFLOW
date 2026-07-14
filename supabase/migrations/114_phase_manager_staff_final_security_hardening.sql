-- ServeFlow Manager M3 final security hardening.
-- Managers may manage only operational staff in their own restaurant.
-- Owner authority remains unchanged.

drop policy if exists restaurant_staff_update_manager_operational_same_restaurant on public.restaurant_staff;

create policy restaurant_staff_update_manager_operational_same_restaurant
on public.restaurant_staff
for update
to authenticated
using (
  public.has_staff_role(restaurant_id, array['manager']::public.restaurant_staff_role[])
  and role::text in ('waiter', 'cashier', 'kitchen', 'reception')
)
with check (
  public.has_staff_role(restaurant_id, array['manager']::public.restaurant_staff_role[])
  and role::text in ('waiter', 'cashier', 'kitchen', 'reception')
);

drop policy if exists restaurant_staff_delete_manager_operational_same_restaurant on public.restaurant_staff;

create policy restaurant_staff_delete_manager_operational_same_restaurant
on public.restaurant_staff
for delete
to authenticated
using (
  public.has_staff_role(restaurant_id, array['manager']::public.restaurant_staff_role[])
  and role::text in ('waiter', 'cashier', 'kitchen', 'reception')
);

drop policy if exists staff_activity_log_select_owner_or_manager_same_restaurant on public.staff_activity_log;

create policy staff_activity_log_select_owner_or_manager_same_restaurant
on public.staff_activity_log
for select
to authenticated
using (
  public.has_staff_role(restaurant_id, array['owner','manager']::public.restaurant_staff_role[])
);

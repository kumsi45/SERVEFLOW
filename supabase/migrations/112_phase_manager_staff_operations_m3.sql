-- ServeFlow Manager Dashboard M3: manager staff operations visibility.
-- Managers can manage day-to-day non-owner staff in their own restaurant only.
-- No owner account, billing, subscription, branding, settings, AI, tenant, or super-admin access.

alter type public.staff_activity_action add value if not exists 'staff_suspended';
alter type public.staff_activity_action add value if not exists 'staff_break_started';
alter type public.staff_activity_action add value if not exists 'staff_break_ended';
alter type public.staff_activity_action add value if not exists 'waiter_tables_assigned';
alter type public.staff_activity_action add value if not exists 'staff_announcement_sent';
alter type public.staff_activity_action add value if not exists 'staff_notification_sent';
alter type public.user_role add value if not exists 'reception';
alter type public.restaurant_staff_role add value if not exists 'reception';

drop policy if exists restaurant_staff_select_self_or_owner_same_restaurant on public.restaurant_staff;
drop policy if exists restaurant_staff_select_self_owner_or_manager_same_restaurant on public.restaurant_staff;

create policy restaurant_staff_select_self_owner_or_manager_same_restaurant
on public.restaurant_staff
for select
to authenticated
using (
  user_id = auth.uid()
  or public.has_staff_role(restaurant_id, array['owner','manager']::public.restaurant_staff_role[])
  and (
    public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])
    or role::text not in ('owner', 'manager')
  )
);

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

drop policy if exists restaurant_table_waiter_assignments_select_manager_same_restaurant on public.restaurant_table_waiter_assignments;

create policy restaurant_table_waiter_assignments_select_manager_same_restaurant
on public.restaurant_table_waiter_assignments
for select
to authenticated
using (
  public.has_staff_role(restaurant_id, array['manager']::public.restaurant_staff_role[])
);

drop policy if exists kitchen_stations_select_manager_same_restaurant on public.kitchen_stations;

create policy kitchen_stations_select_manager_same_restaurant
on public.kitchen_stations
for select
to authenticated
using (
  public.has_staff_role(restaurant_id, array['manager']::public.restaurant_staff_role[])
);

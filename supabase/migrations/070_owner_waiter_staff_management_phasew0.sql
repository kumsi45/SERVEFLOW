-- ServeFlow Phase W0: owner staff management support for waiter accounts.
-- Staff management only. No waiter dashboard, ordering, table assignment,
-- payments, shifts, kitchen, cashier, reports, or analytics changes.

alter type public.user_role
  add value if not exists 'waiter';

alter type public.restaurant_staff_role
  add value if not exists 'waiter';

alter type public.staff_activity_action
  add value if not exists 'waiter_created';

alter type public.staff_activity_action
  add value if not exists 'waiter_updated';

alter type public.staff_activity_action
  add value if not exists 'waiter_activated';

alter type public.staff_activity_action
  add value if not exists 'waiter_deactivated';

alter type public.staff_activity_action
  add value if not exists 'waiter_pin_reset';

alter type public.staff_activity_action
  add value if not exists 'waiter_deleted';

alter table public.restaurant_staff
  add column if not exists username text,
  add column if not exists phone_number text,
  add column if not exists waiter_session_active boolean not null default false;

create unique index if not exists restaurant_staff_restaurant_username_unique
on public.restaurant_staff (restaurant_id, lower(username))
where username is not null;

create index if not exists restaurant_staff_waiter_session_active_idx
on public.restaurant_staff (restaurant_id, role, waiter_session_active)
where waiter_session_active = true;

create or replace function public.record_waiter_login(target_restaurant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.restaurant_staff
  set
    last_login_at = now(),
    waiter_session_active = true
  where restaurant_id = target_restaurant_id
    and user_id = auth.uid()
    and role::text = 'waiter'
    and active = true;

  if not found then
    raise exception 'Active waiter membership not found for this restaurant.';
  end if;
end;
$$;

create or replace function public.record_waiter_logout(target_restaurant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.restaurant_staff
  set waiter_session_active = false
  where restaurant_id = target_restaurant_id
    and user_id = auth.uid()
    and role::text = 'waiter';
end;
$$;

revoke all on function public.record_waiter_login(uuid) from public, anon, authenticated;
revoke all on function public.record_waiter_logout(uuid) from public, anon, authenticated;

grant execute on function public.record_waiter_login(uuid) to authenticated;
grant execute on function public.record_waiter_logout(uuid) to authenticated;

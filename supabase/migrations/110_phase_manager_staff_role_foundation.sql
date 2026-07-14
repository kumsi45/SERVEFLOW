-- Manager account foundation. Manager operations remain isolated from Owner-only capabilities.
alter type public.user_role add value if not exists 'manager';
alter type public.restaurant_staff_role add value if not exists 'manager';

alter table public.restaurant_staff
  add column if not exists staff_session_active boolean not null default false,
  add column if not exists last_logout_at timestamptz;

create index if not exists restaurant_staff_session_active_idx
on public.restaurant_staff (restaurant_id, role, staff_session_active)
where staff_session_active = true;

create or replace function public.record_staff_login(target_restaurant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.restaurant_staff
  set last_login_at = now(),
      staff_session_active = true
  where restaurant_id = target_restaurant_id
    and user_id = auth.uid()
    and active = true
    and role::text in ('owner', 'manager', 'cashier', 'kitchen');

  if not found then
    raise exception 'Active staff membership not found for this restaurant.';
  end if;
end;
$$;

create or replace function public.record_staff_logout(target_restaurant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.restaurant_staff
  set staff_session_active = false,
      last_logout_at = now()
  where restaurant_id = target_restaurant_id
    and user_id = auth.uid()
    and role::text in ('owner', 'manager', 'cashier', 'kitchen');
end;
$$;

create or replace function public.is_active_manager(target_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.restaurant_staff staff
    where staff.restaurant_id = target_restaurant_id
      and staff.user_id = auth.uid()
      and staff.role::text = 'manager'
      and staff.active = true
  )
$$;

revoke all on function public.record_staff_login(uuid) from public, anon, authenticated;
revoke all on function public.record_staff_logout(uuid) from public, anon, authenticated;
revoke all on function public.is_active_manager(uuid) from public, anon, authenticated;
grant execute on function public.record_staff_login(uuid) to authenticated, service_role;
grant execute on function public.record_staff_logout(uuid) to authenticated, service_role;
grant execute on function public.is_active_manager(uuid) to authenticated, service_role;

-- Existing restaurant_staff write policies deliberately remain Owner-only.
-- Manager accounts can read only their own membership row and cannot mutate staff.

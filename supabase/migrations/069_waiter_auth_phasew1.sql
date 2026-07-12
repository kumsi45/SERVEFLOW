-- ServeFlow Phase W1: waiter authentication foundation only.
-- This adds waiter as a restaurant_staff role and exposes minimal waiter-only
-- helper RPCs for shared-terminal login. No ordering, table, kitchen, cashier,
-- payment, report, or dashboard behavior is changed.

alter type public.restaurant_staff_role
  add value if not exists 'waiter';

alter table public.restaurant_staff
  add column if not exists username text;

alter table public.restaurants
  add column if not exists active boolean not null default true;

create index if not exists restaurant_staff_waiter_login_lookup_idx
on public.restaurant_staff (
  restaurant_id,
  role,
  active,
  lower(coalesce(username, '')),
  lower(coalesce(email, '')),
  lower(display_name)
);

create or replace function public.get_waiter_terminal_context(target_restaurant_slug text)
returns table (
  restaurant_id uuid,
  restaurant_slug text,
  restaurant_name text,
  logo_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    restaurants.id,
    restaurants.slug,
    restaurants.name,
    restaurants.branding->>'logo_url'
  from public.restaurants
  where restaurants.slug = lower(trim(target_restaurant_slug))
    and restaurants.active = true
  limit 1
$$;

create or replace function public.resolve_waiter_login_identity(
  target_restaurant_slug text,
  waiter_username text
)
returns table (
  staff_id uuid,
  user_id uuid,
  email text,
  display_name text,
  restaurant_id uuid,
  restaurant_slug text,
  restaurant_name text,
  logo_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    staff.id,
    staff.user_id,
    staff.email,
    staff.display_name,
    restaurants.id,
    restaurants.slug,
    restaurants.name,
    restaurants.branding->>'logo_url'
  from public.restaurant_staff staff
  join public.restaurants restaurants
    on restaurants.id = staff.restaurant_id
  where restaurants.slug = lower(trim(target_restaurant_slug))
    and restaurants.active = true
    and staff.active = true
    and staff.role::text = 'waiter'
    and (
      lower(coalesce(staff.username, '')) = lower(trim(waiter_username))
      or lower(coalesce(staff.email, '')) = lower(trim(waiter_username))
      or lower(staff.display_name) = lower(trim(waiter_username))
    )
  order by
    case
      when lower(coalesce(staff.username, '')) = lower(trim(waiter_username)) then 0
      when lower(coalesce(staff.email, '')) = lower(trim(waiter_username)) then 1
      else 2
    end,
    staff.created_at
  limit 1
$$;

revoke all on function public.get_waiter_terminal_context(text) from public, anon, authenticated;
revoke all on function public.resolve_waiter_login_identity(text, text) from public, anon, authenticated;

grant execute on function public.get_waiter_terminal_context(text) to anon, authenticated;
grant execute on function public.resolve_waiter_login_identity(text, text) to anon, authenticated;

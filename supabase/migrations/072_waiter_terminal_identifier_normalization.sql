-- ServeFlow waiter terminal lookup hardening.
-- Keep waiter auth isolated, but allow terminal URLs to resolve the same active
-- restaurant by slug, restaurant id, exact name, or slugified name.

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
  with normalized_input as (
    select
      lower(trim(target_restaurant_slug)) as raw_value,
      regexp_replace(lower(trim(target_restaurant_slug)), '[^a-z0-9]+', '-', 'g') as slug_value
  )
  select
    restaurants.id,
    restaurants.slug,
    restaurants.name,
    restaurants.branding->>'logo_url'
  from public.restaurants restaurants
  cross join normalized_input
  where restaurants.active = true
    and (
      restaurants.slug = normalized_input.raw_value
      or restaurants.id::text = normalized_input.raw_value
      or lower(trim(restaurants.name)) = normalized_input.raw_value
      or restaurants.slug = trim(both '-' from normalized_input.slug_value)
    )
  order by
    case
      when restaurants.slug = normalized_input.raw_value then 0
      when restaurants.id::text = normalized_input.raw_value then 1
      when lower(trim(restaurants.name)) = normalized_input.raw_value then 2
      else 3
    end
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
  with normalized_input as (
    select
      lower(trim(target_restaurant_slug)) as raw_value,
      regexp_replace(lower(trim(target_restaurant_slug)), '[^a-z0-9]+', '-', 'g') as slug_value,
      lower(trim(waiter_username)) as waiter_value
  ),
  target_restaurant as (
    select restaurants.*
    from public.restaurants restaurants
    cross join normalized_input
    where restaurants.active = true
      and (
        restaurants.slug = normalized_input.raw_value
        or restaurants.id::text = normalized_input.raw_value
        or lower(trim(restaurants.name)) = normalized_input.raw_value
        or restaurants.slug = trim(both '-' from normalized_input.slug_value)
      )
    order by
      case
        when restaurants.slug = normalized_input.raw_value then 0
        when restaurants.id::text = normalized_input.raw_value then 1
        when lower(trim(restaurants.name)) = normalized_input.raw_value then 2
        else 3
      end
    limit 1
  )
  select
    staff.id,
    staff.user_id,
    staff.email,
    staff.display_name,
    target_restaurant.id,
    target_restaurant.slug,
    target_restaurant.name,
    target_restaurant.branding->>'logo_url'
  from public.restaurant_staff staff
  join target_restaurant
    on target_restaurant.id = staff.restaurant_id
  cross join normalized_input
  where staff.active = true
    and staff.role::text = 'waiter'
    and (
      lower(coalesce(staff.username, '')) = normalized_input.waiter_value
      or lower(coalesce(staff.email, '')) = normalized_input.waiter_value
      or lower(staff.display_name) = normalized_input.waiter_value
    )
  order by
    case
      when lower(coalesce(staff.username, '')) = normalized_input.waiter_value then 0
      when lower(coalesce(staff.email, '')) = normalized_input.waiter_value then 1
      else 2
    end,
    staff.created_at
  limit 1
$$;

revoke all on function public.get_waiter_terminal_context(text) from public, anon, authenticated;
revoke all on function public.resolve_waiter_login_identity(text, text) from public, anon, authenticated;

grant execute on function public.get_waiter_terminal_context(text) to anon, authenticated;
grant execute on function public.resolve_waiter_login_identity(text, text) to anon, authenticated;
